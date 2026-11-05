/* Opt-in preparation only. No network, persistence, login hooks or DOM effects. */
const TrailerImportPreview = (() => {
    const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
    const copy = x => JSON.parse(JSON.stringify(x));
    const text = x => typeof x === 'string' && x.trim().length > 0;
    const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
    const stable = x => Array.isArray(x) ? x.map(stable) : object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
    const hash = x => trailerSha256(JSON.stringify(stable(x)));
    const iso = x => {
        if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(x) || !Number.isFinite(Date.parse(x))) return false;
        const year = +x.slice(0, 4), month = +x.slice(5, 7), day = +x.slice(8, 10);
        const days = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && +x.slice(11, 13) <= 23 && +x.slice(14, 16) <= 59 && +x.slice(17, 19) <= 59;
    };
    const instant = value => {
        if (!iso(value)) return null;
        // Normalize the offset without losing sub-millisecond precision. Never
        // treat two different PostgreSQL microsecond values as an identical row.
        const fraction = value.match(/\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/)?.[1] || '';
        const seconds = value.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/, '');
        return Date.parse(seconds) + ':' + fraction.replace(/0+$/, '');
    };
    const keys = ['trailersSalvos', 'trucksCadastrados', 'jornadaAtiva', 'jornadasSalvas'];
    function backup(input) {
        const parsed = typeof input === 'string' ? JSON.parse(input.replace(/^\uFEFF/, '')) : copy(input);
        if (object(parsed) && Object.hasOwn(parsed, 'versao')) {
            if (parsed.aplicativo !== 'Trailer Log' || parsed.versao !== 1) throw Error('Backup não suportado.');
            return copy(parsed.dados);
        }
        return copy(parsed);
    }
    function prepare({ account, data, token = null, generation = 1, remote = null, batchSize = 50 }) {
        if (!uuid(account) || !Number.isSafeInteger(generation) || generation < 1 || generation > 999999999999999 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw Error('Conta, geração ou lote inválido.');
        const raw = copy(data);
        if (!object(raw) || keys.some(k => !Object.hasOwn(raw, k)) || !Array.isArray(raw.trailersSalvos) || !Array.isArray(raw.trucksCadastrados) || !Array.isArray(raw.jornadasSalvas) || !(raw.jornadaAtiva === null || object(raw.jornadaAtiva))) throw Error('Coleções locais inválidas.');
        if (remote && (!remote.complete || remote.account !== account || remote.generation !== generation || !Array.isArray(remote.items))) throw Error('Snapshot remoto completo da mesma conta/geração obrigatório.');
        const rows = [], catalog = new Map(), journeyMap = new Map();
        if (remote) for (const item of remote.items) {
            if (!object(item) || !object(item.data) || item.data.user_id !== account || !Number.isSafeInteger(item.data.revision)) throw Error('Registro remoto inválido.');
            const source = item.entity === 'payment_settings' ? account : item.data.source_id;
            const key = item.entity + '/' + source;
            if (catalog.has(key)) throw Error('Snapshot remoto duplicado.');
            catalog.set(key, item.data);
        }
        const add = (collection, entity, item, index, source) => {
            const row = { collection, index, entity, source_id: source, disposition: 'ready', reasons: [], original: copy(item), data: null, dependency: null };
            rows.push(row); return row;
        };
        const review = (row, reason) => { row.disposition = 'review'; if (!row.reasons.includes(reason)) row.reasons.push(reason); };
        for (const collection of keys) {
            const list = collection === 'jornadaAtiva' ? (raw[collection] ? [raw[collection]] : []) : raw[collection];
            const seen = new Map();
            list.forEach((item, index) => {
                if (!object(item)) { review(add(collection, 'unknown', item, index, null), 'invalid_record'); return; }
                const fingerprint = hash(item), occurrence = seen.get(fingerprint) || 0;
                seen.set(fingerprint, occurrence + 1);
                // Exactly the fallback used by storage.identify; never mutate local rows.
                const source = item.source_id ?? item.registroId ?? ('legacy-sha256:' + collection + ':' + fingerprint + ':' + occurrence);
                const entity = collection === 'trucksCadastrados' ? 'trucks' : collection === 'trailersSalvos' ? 'trailer_uses' : 'journeys';
                const row = add(collection, entity, item, index, source);
                if (!text(source) || source.length > 512) review(row, 'invalid_source_id');
                if (item.source_id !== undefined && item.registroId !== undefined && item.source_id !== item.registroId) review(row, 'ambiguous_source_id');
                if (entity === 'trucks') {
                    row.data = { truck_number: item.numero, legacy_data: copy(item) };
                    if (!text(item.numero)) review(row, 'missing_truck_number');
                    for (const [from, to] of [['condicao', 'condition'], ['observacoes', 'notes']]) {
                        if (Object.hasOwn(item, from)) { if (typeof item[from] !== 'string') review(row, 'invalid_' + from); else row.data[to] = item[from]; }
                    }
                } else if (entity === 'journeys') {
                    row.data = { truck_number: item.truck, started_at: item.inicio, status: item.status, legacy_data: copy(item) };
                    if (!text(item.id)) review(row, 'missing_journey_id');
                    else { const group = journeyMap.get(item.id) || []; group.push(row); journeyMap.set(item.id, group); }
                    if (!text(item.truck)) review(row, 'missing_truck_number');
                    if (!iso(item.inicio)) review(row, 'missing_or_ambiguous_start');
                    if (collection === 'jornadaAtiva' ? item.status !== 'Em andamento' || item.fim != null : item.status !== 'Finalizada' || !iso(item.fim)) review(row, 'incomplete_journey_status_dates');
                    if (item.fim != null) row.data.ended_at = item.fim;
                    if (iso(item.inicio) && iso(item.fim) && Date.parse(item.fim) < Date.parse(item.inicio)) review(row, 'end_before_start');
                } else {
                    row.data = { trailer_number: item.trailer, legacy_data: copy(item) };
                    if (!text(item.trailer)) review(row, 'missing_trailer_number');
                    if (Object.hasOwn(item, 'truck')) { if (typeof item.truck !== 'string') review(row, 'invalid_truck'); else row.data.truck_number = item.truck; }
                    if (Object.hasOwn(item, 'data')) { if (!iso(item.data)) review(row, 'ambiguous_use_date'); else row.data.used_at = item.data; }
                    if (Object.hasOwn(item, 'jornadaId')) row.local_journey_id = item.jornadaId;
                }
            });
        }
        if (Object.hasOwn(raw, 'paymentSettings')) {
            const settings = raw.paymentSettings;
            const row = add('paymentSettings', 'payment_settings', settings, 0, account);
            if (!object(settings) || !Number.isInteger(settings.rateCents) || settings.rateCents < 1 || settings.rateCents > 100000 || !Number.isInteger(settings.detentionRateCents) || settings.detentionRateCents < 1 || settings.detentionRateCents > 100000) review(row, 'incomplete_payment_settings');
            else row.data = { rate_cents: settings.rateCents, detention_rate_cents: settings.detentionRateCents, legacy_data: copy(settings) };
        }
        for (const name of Object.keys(raw).filter(k => ![...keys, 'paymentSettings'].includes(k))) review(add(name, 'unknown', raw[name], 0, null), 'unmapped_top_level_field');
        const groups = new Map();
        for (const row of rows) {
            for (const key of [row.source_id ? row.entity + '/' + row.source_id : null, row.entity === 'trucks' && text(row.data?.truck_number) ? 'truck-number/' + row.data.truck_number.trim() : null].filter(Boolean)) {
                const list = groups.get(key) || []; list.push(row); groups.set(key, list);
            }
        }
        for (const list of [...groups.values(), ...journeyMap.values()]) if (list.length > 1) list.forEach(r => review(r, 'duplicate_identity'));
        // Parents first; trailer links are resolved only through confirmed server UUIDs.
        for (const row of rows.filter(r => r.entity !== 'trailer_uses')) compare(row);
        for (const row of rows.filter(r => r.entity === 'trailer_uses')) {
            if (Object.hasOwn(row, 'local_journey_id')) {
                const matches = journeyMap.get(row.local_journey_id);
                if (!text(row.local_journey_id) || !matches || matches.length !== 1 || matches[0].disposition === 'review') review(row, 'unresolved_journey');
                else {
                    const parent = matches[0], cloud = catalog.get('journeys/' + parent.source_id);
                    if (cloud && uuid(cloud.id) && cloud.deleted_at == null) row.data.journey_id = cloud.id;
                    else row.dependency = { entity: 'journeys', source_id: parent.source_id };
                }
            }
            if (!row.dependency) compare(row);
            else if (catalog.has('trailer_uses/' + row.source_id)) review(row, 'remote_link_requires_review');
        }
        function compare(row) {
            if (row.disposition !== 'ready') return;
            const cloud = catalog.get(row.entity + '/' + row.source_id);
            if (cloud) {
                if (cloud.deleted_at != null || Object.keys(row.data).some(k => {
                    if (['started_at', 'ended_at', 'used_at'].includes(k) && row.data[k] != null && cloud[k] != null)
                        return instant(cloud[k]) === null || instant(cloud[k]) !== instant(row.data[k]);
                    return hash(cloud[k] ?? null) !== hash(row.data[k] ?? null);
                })) review(row, 'remote_differs_or_deleted');
                else { row.disposition = 'ignored'; row.reasons.push('already_present_identical'); }
            }
            if (row.entity === 'trucks' && remote && remote.items.some(x => x.entity === 'trucks' && x.data.deleted_at == null && x.data.source_id !== row.source_id && typeof x.data.truck_number === 'string' && x.data.truck_number.trim() === row.data.truck_number.trim())) review(row, 'remote_duplicate_truck');
            if (row.entity === 'journeys' && row.data.status === 'Em andamento' && remote && remote.items.some(x => x.entity === 'journeys' && x.data.deleted_at == null && x.data.status === 'Em andamento' && x.data.source_id !== row.source_id)) review(row, 'remote_active_journey');
        }
        const plan = { version: 1, account, generation, token, batchSize, input_hash: hash(raw), remote_verified: !!remote, rows,
            warnings: remote ? [] : ['Sem snapshot remoto completo: criações usam revisão 0; conflitos ainda podem ocorrer.'] };
        plan.plan_id = hash(plan);
        plan.summary = Object.fromEntries(['ready', 'ignored', 'review'].map(k => [k, rows.filter(r => r.disposition === k).length]));
        return copy(plan);
    }
    function materialize(plan, { account, completed = {} } = {}) {
        if (account !== plan.account || !uuid(account)) throw Error('Conta mudou. Refaça a prévia.');
        const { plan_id, summary, ...body } = plan;
        if (hash(body) !== plan_id) throw Error('Plano alterado. Refaça a prévia.');
        const parentIds = new Map(), batches = [], blocked = [];
        const phases = ['journeys', 'payment_settings', 'trucks', 'trailer_uses'];
        for (const entity of phases) {
            const phaseRows = plan.rows.filter(r => r.entity === entity && r.disposition === 'ready');
            if (entity === 'trailer_uses' && phaseRows.some(r => r.dependency && !parentIds.has(r.dependency.source_id))) {
                // Freeze child batch membership until ALL parent UUIDs are known.
                // Otherwise later receipts could shift already-completed batch IDs.
                blocked.push(...phaseRows.map(r => ({ source_id: r.source_id, reason: 'awaiting_all_journey_receipts', dependency: r.dependency })));
                continue;
            }
            const candidates = [];
            for (const row of phaseRows.sort((a, b) => a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0)) {
                const data = copy(row.data);
                if (row.dependency) {
                    const id = parentIds.get(row.dependency.source_id);
                    if (!id) { blocked.push({ source_id: row.source_id, reason: 'awaiting_journey_receipt', dependency: row.dependency }); continue; }
                    data.journey_id = id;
                }
                candidates.push({ entity, source_id: row.source_id, action: 'create', data });
            }
            for (let i = 0; i < candidates.length; i += plan.batchSize) {
                const changes = candidates.slice(i, i + plan.batchSize);
                const request = { generation: plan.generation, expected_revisions: Object.fromEntries(changes.map(c => [c.entity + '/' + c.source_id, 0])), changes };
                const digest = hash(['trailerlog-import-v1', plan.account, plan.plan_id, request]);
                // UUID-shaped deterministic operation key, namespace/version explicit.
                const operation_id = digest.slice(0, 8) + '-' + digest.slice(8, 12) + '-8' + digest.slice(13, 16) + '-a' + digest.slice(17, 20) + '-' + digest.slice(20, 32);
                const bytes = new TextEncoder().encode(JSON.stringify(request)).length;
                // PostgreSQL JSONB text adds separators' spaces. Bound that growth
                // without pretending our serialization equals the server's hash.
                const separators = value => Array.isArray(value) ? Math.max(0, value.length - 1) + value.reduce((n, x) => n + separators(x), 0) : object(value) ? Object.keys(value).length + Math.max(0, Object.keys(value).length - 1) + Object.values(value).reduce((n, x) => n + separators(x), 0) : 0;
                const estimatedServerBytes = bytes + separators(request);
                if (estimatedServerBytes > 900000) { blocked.push({ operation_id, reason: 'batch_payload_too_large', bytes, estimatedServerBytes }); continue; }
                const receipt = completed[operation_id];
                if (receipt) {
                    if (receipt.operation_id !== operation_id || receipt.status !== 'completed' || receipt.generation !== plan.generation || !Array.isArray(receipt.changes) || receipt.changes.length !== changes.length) throw Error('Recibo inválido ou conflito: revisão manual obrigatória.');
                    for (const change of changes) {
                        const matches = receipt.changes.filter(r => r.entity === change.entity && r.source_id === change.source_id && r.revision === 1 && r.deleted_at == null);
                        if (matches.length !== 1) throw Error('Recibo não corresponde ao lote.');
                        if (entity === 'journeys') { if (!uuid(matches[0].id)) throw Error('UUID de jornada ausente.'); parentIds.set(change.source_id, matches[0].id); }
                    }
                }
                batches.push({ operation_id, request, state: receipt ? 'completed' : 'pending', bytes });
            }
        }
        if (Object.keys(completed).some(id => !batches.some(b => b.operation_id === id))) throw Error('Checkpoint pertence a outro plano.');
        return { plan_id, account, batches, blocked };
    }
    function current(options = {}, dependencies = {}) {
        const auth = dependencies.auth || TrailerAuth, storage = dependencies.storage || TrailerStorage;
        const account = auth.scope(), snapshot = storage.read();
        if (auth.scope() !== account) throw Error('Conta mudou durante a leitura.');
        return prepare({ ...options, account, data: snapshot.data, token: snapshot.token });
    }
    function describe(plan) {
        const names = { ready: 'Apto para preparação', ignored: 'Ignorado: já existente', review: 'Revisão obrigatória' };
        return { account: plan.account, summary: copy(plan.summary), warnings: copy(plan.warnings), entries: plan.rows.map(r => ({ collection: r.collection, index: r.index, source_id: r.source_id, status: names[r.disposition], reasons: copy(r.reasons), dependency: copy(r.dependency) })) };
    }
    return { prepare, current, backup, materialize, describe };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TrailerImportPreview;
