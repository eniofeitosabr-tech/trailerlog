/* Daily workspace, independent from legacy storage/import checkpoints. No bulk import. */
const TrailerDailySync = (() => {
    const copy = x => JSON.parse(JSON.stringify(x));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const error = code => { throw Object.assign(Error(code), { code }); };
    const empty = () => ({ trucksCadastrados: [], jornadasSalvas: [], jornadaAtiva: null, trailersSalvos: [], paymentSettings: { rateCents: 65, detentionRateCents: 1500 } });
    const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
    const safe = x => Number.isSafeInteger(x) && x >= 0;
    function create({ account, environment, storage, locks, getContext, rpc, validate, identify, id, hash, notify = () => {} }) {
        if (!uuid(account) || new URL(environment).origin !== environment || !locks?.request) error('daily_invalid_configuration');
        const key = 'trailerlog:daily:v1:' + encodeURIComponent(environment) + ':' + account;
        const scope = () => { const ctx = getContext(); if (ctx.account !== account || ctx.environment !== environment) error('daily_scope_changed'); };
        function load() {
            scope(); const raw = storage.getItem(key);
            if (!raw) return { version: 1, account, environment, data: empty(), catalog: {}, queue: [], receipts: [], cursor: null, generation: 1, initialized: false, revision: 0, status: 'initializing' };
            const s = JSON.parse(raw), { digest, ...body } = s;
            if (s.version !== 1 || s.account !== account || s.environment !== environment || hash(body) !== digest || !Array.isArray(s.queue) || !safe(s.cursor ?? 0) || !safe(s.generation) || !s.generation) error('daily_corrupt_state');
            validate(s.data); return s;
        }
        function save(s) {
            scope(); validate(s.data); s.revision++;
            const { digest, ...body } = s; s.digest = hash(body);
            const raw = JSON.stringify(s); storage.setItem(key, raw);
            if (storage.getItem(key) !== raw) error('daily_storage_failure');
        }
        const locked = fn => locks.request(key, { mode: 'exclusive' }, () => { scope(); return fn(load()); });
        function documents(data) {
            const docs = {};
            function add(entity, source, payload, dependency) {
                if (!source || docs[entity + '/' + source]) error('daily_duplicate_identity');
                docs[entity + '/' + source] = { entity, source_id: source, data: payload, dependency };
            }
            for (const r of data.trucksCadastrados) add('trucks', r.registroId, { truck_number: r.numero, condition: r.condicao ?? null, notes: r.observacoes ?? null, legacy_data: copy(r) });
            const journeys = [...data.jornadasSalvas, ...(data.jornadaAtiva ? [data.jornadaAtiva] : [])];
            for (const r of journeys) add('journeys', r.registroId, { truck_number: r.truck, started_at: r.inicio, ended_at: r.fim ?? null, status: r.status, legacy_data: copy(r) });
            for (const r of data.trailersSalvos) {
                const parents = r.jornadaId ? journeys.filter(j => j.id === r.jornadaId) : [];
                if (r.jornadaId && parents.length !== 1) error('daily_missing_journey');
                add('trailer_uses', r.registroId, { trailer_number: r.trailer, truck_number: r.truck ?? null, used_at: r.data ?? null, legacy_data: copy(r) }, parents[0]?.registroId ?? null);
            }
            if (data.paymentSettings) add('payment_settings', account, { rate_cents: data.paymentSettings.rateCents, detention_rate_cents: data.paymentSettings.detentionRateCents, legacy_data: copy(data.paymentSettings) });
            return docs;
        }
        function snapshot() {
            const s = load(); return { data: copy(s.data), storedData: copy(s.data), token: hash([account, environment, s.data]), revision: s.revision, conflict: false };
        }
        async function change(update, token) {
            return locked(s => {
                if (!s.initialized) error('daily_initial_read_required');
                if (s.queue.some(q => q.conflict)) error('daily_conflict_requires_review');
                if (token !== undefined && token !== hash([account, environment, s.data])) error('daily_local_conflict');
                const before = documents(s.data), next = copy(s.data); update(next); identify(next); validate(next);
                const after = documents(next), additions = [];
                for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
                    if (same(before[name], after[name])) continue;
                    const doc = after[name] || before[name], existing = s.queue.filter(q => q.identity === name).at(-1);
                    const expected = existing ? existing.expected + 1 : s.catalog[name]?.revision ?? 0;
                    const action = !after[name] ? 'delete' : !before[name] || expected === 0 ? 'create' : 'update';
                    const entry = { operation_id: id(), identity: name, entity: doc.entity, source_id: doc.source_id, action, expected, data: action === 'delete' ? {} : doc.data, dependency: doc.dependency };
                    if (new TextEncoder().encode(JSON.stringify(entry)).length > 900000) error('daily_payload_too_large');
                    additions.push(entry);
                }
                const rank = { trucks: 0, journeys: 1, trailer_uses: 2, payment_settings: 3 };
                additions.sort((a, b) => (a.action === 'delete' ? -rank[a.entity] - 10 : rank[a.entity]) - (b.action === 'delete' ? -rank[b.entity] - 10 : rank[b.entity]));
                s.data = next; s.queue.push(...additions); s.status = s.queue.length ? 'pending' : 'ready';
                save(s); notify(true, false); return copy(next);
            });
        }
        function publishCatalog(s) {
            if (s.queue.length) return; // Never replace optimistic or conflicting local documents.
            const data = empty();
            for (const [name, row] of Object.entries(s.catalog)) {
                if (row.deleted_at != null || name.startsWith('data_imports/')) continue;
                const original = copy(row.legacy_data);
                if (!original || typeof original !== 'object' || Array.isArray(original)) error('daily_remote_document_invalid');
                if (name.startsWith('trucks/')) data.trucksCadastrados.push(original);
                else if (name.startsWith('journeys/')) {
                    if (row.status === 'Em andamento') { if (data.jornadaAtiva) error('daily_remote_active_conflict'); data.jornadaAtiva = original; }
                    else data.jornadasSalvas.push(original);
                } else if (name.startsWith('trailer_uses/')) data.trailersSalvos.push(original);
                else if (name.startsWith('payment_settings/')) data.paymentSettings = original;
            }
            validate(data); s.data = data;
        }
        function rowIdentity(entity, row) {
            if (!['trucks', 'journeys', 'trailer_uses', 'payment_settings', 'data_imports'].includes(entity) || row.user_id !== account || !safe(row.revision) || row.revision < 1) error('daily_invalid_remote');
            return entity + '/' + (entity === 'payment_settings' ? account : row.source_id);
        }
        async function readRemote() {
            const initial = load(); let catalog = copy(initial.catalog), cursor = initial.cursor, generation = initial.generation;
            if (cursor === null) {
                catalog = {}; let next = {}, watermark;
                for (let n = 0; n < 10000; n++) {
                    const page = await rpc('trailer_sync_snapshot', { ...next, page_size: 100 }); scope();
                    if (page.status !== 'ok' || !safe(page.generation) || !page.generation || !safe(page.watermark)) error('daily_resnapshot_required');
                    if (watermark !== undefined && (watermark !== page.watermark || generation !== page.generation)) error('daily_inconsistent_snapshot');
                    watermark = page.watermark; generation = page.generation;
                    for (const item of page.items) catalog[rowIdentity(item.entity, item.data)] = item.data;
                    if (!page.has_more) { cursor = watermark; break; }
                    if (!page.next_cursor || n === 9999) error('daily_incomplete_snapshot'); next = page.next_cursor;
                }
            } else {
                let until;
                for (let n = 0; n < 10000; n++) {
                    const page = await rpc('trailer_sync_pull', { expected_generation: generation, after_sequence: cursor, ...(until === undefined ? {} : { until_sequence: until }), page_size: 100 }); scope();
                    if (page.status !== 'ok' || page.generation !== generation || !safe(page.watermark) || !safe(page.next_sequence)) error('daily_resnapshot_required');
                    until ??= page.watermark; if (page.watermark !== until) error('daily_inconsistent_pull');
                    for (const event of page.changes) {
                        if (!safe(event.sequence) || event.sequence !== cursor + 1 || event.generation !== generation) error('daily_history_gap');
                        catalog[rowIdentity(event.entity, event.after_data)] = event.after_data; cursor = event.sequence;
                    }
                    if (page.next_sequence !== cursor) error('daily_history_gap');
                    if (!page.has_more) { if (cursor !== until) error('daily_history_gap'); break; }
                    if (n === 9999) error('daily_incomplete_pull');
                }
            }
            await locked(s => {
                const before = JSON.stringify(s.data); s.catalog = catalog; s.cursor = cursor; s.generation = generation; s.initialized = true;
                publishCatalog(s); s.error = null; s.status = s.queue.length ? (s.queue[0].conflict ? 'conflict' : 'pending') : 'ready'; save(s); notify(before !== JSON.stringify(s.data));
            });
        }
        async function sync() {
            scope();
            return locks.request(key + ':network', { mode: 'exclusive', ifAvailable: true }, async lock => {
                if (lock === null) return;
                try {
                    await readRemote();
                    for (;;) {
                        const entry = await locked(s => {
                            const q = s.queue[0]; if (!q || q.conflict) return null;
                            if (!q.request) {
                                const data = copy(q.data);
                                if (q.dependency && q.action !== 'delete') {
                                    const parent = s.catalog['journeys/' + q.dependency];
                                    if (!parent || parent.deleted_at != null || !uuid(parent.id)) error('daily_waiting_parent');
                                    data.journey_id = parent.id;
                                }
                                q.request = { generation: s.generation, expected_revisions: { [q.identity]: q.expected }, changes: [{ entity: q.entity, source_id: q.source_id, action: q.action, data }] };
                                save(s);
                            }
                            return copy(q);
                        });
                        if (!entry) break;
                        const result = await rpc('trailer_sync_write', { operation_id: entry.operation_id, request: entry.request }); scope();
                        if (result.operation_id !== entry.operation_id || !safe(result.last_sequence) || !safe(result.generation)) error('daily_invalid_receipt');
                        await locked(s => {
                            const q = s.queue[0]; if (!q || q.operation_id !== entry.operation_id || !same(q.request, entry.request)) error('daily_queue_changed');
                            if (result.status === 'conflict') {
                                if (result.changes.length || !['revision_conflict', 'generation_conflict', 'constraint_conflict', 'invalid_data'].includes(result.code)) error('daily_invalid_receipt');
                                q.conflict = copy(result); s.status = 'conflict'; save(s); notify(false); return;
                            }
                            const r = result.changes?.[0];
                            if (result.status !== 'completed' || result.generation !== entry.request.generation || result.last_sequence < 1 || result.changes.length !== 1 || r.entity !== q.entity || r.source_id !== q.source_id || r.revision !== q.expected + 1 || (q.entity === 'payment_settings' ? r.id !== null : !uuid(r.id)) || (q.action === 'delete' ? typeof r.deleted_at !== 'string' : r.deleted_at !== null)) error('daily_invalid_receipt');
                            s.catalog[q.identity] = { ...s.catalog[q.identity], ...q.request.changes[0].data, user_id: account, source_id: q.source_id, id: r.id, revision: r.revision, deleted_at: r.deleted_at };
                            s.receipts.push({ operation_id: q.operation_id, request: q.request, result }); s.queue.shift(); save(s); notify(false);
                        });
                        if (load().queue[0]?.conflict) break;
                    }
                    await readRemote();
                } catch (e) {
                    // The front request remains unchanged after any uncertain result.
                    await locked(s => { s.status = s.queue.some(q => q.conflict) ? 'conflict' : 'paused'; s.error = e.code || 'daily_network_error'; save(s); notify(false); }).catch(() => {});
                }
                return info();
            });
        }
        function info() { const s = load(); return { account, environment, initialized: s.initialized, status: s.status, pending: s.queue.length, code: s.queue.find(q => q.conflict)?.conflict.code || s.error || null, cursor: s.cursor }; }
        return { read: snapshot, change, sync, info, key };
    }
    return { create, get enabled() { return typeof window !== 'undefined' && window.TRAILER_SUPABASE_CONFIG?.dailySync === true; } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TrailerDailySync;

if (typeof window !== 'undefined' && TrailerDailySync.enabled) (() => {
    const config = window.TRAILER_SUPABASE_CONFIG, environment = new URL(config.url).origin;
    let instance, boundAccount, scheduling = false, reschedule = false;
    const get = () => {
        const account = TrailerAuth.importIdentity().account;
        if (!instance || boundAccount !== account) {
            boundAccount = account;
            instance = TrailerDailySync.create({ account, environment, storage: localStorage, locks: navigator.locks,
                getContext: () => ({ account: TrailerAuth.importIdentity().account, environment: new URL(window.TRAILER_SUPABASE_CONFIG.url).origin }),
                validate: data => TrailerStorage.validate(data), identify: data => TrailerStorage.identify(data), id: () => TrailerStorage.id(), hash: value => trailerSha256(JSON.stringify(value)),
                notify(changed, external = true) { if (changed) { const e = new Event('trailerlogchange'); e.external = external; window.dispatchEvent(e); } window.dispatchEvent(new Event('trailerdailystatus')); },
                rpc: async (name, body) => {
                    const session = await TrailerAuth.importSession(account);
                    if (session.account !== account || session.environment !== environment) throw Error('daily_scope_changed');
                    const response = await fetch(environment + '/rest/v1/rpc/' + name, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { apikey: config.publishableKey, Authorization: 'Bearer ' + session.accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                    if (!response.ok) throw Error('daily_http_error'); return response.json();
                } });
        }
        return instance;
    };
    const schedule = () => {
        if (navigator.onLine === false || document.visibilityState === 'hidden') return;
        if (scheduling) { reschedule = true; return; }
        try {
            scheduling = true;
            get().sync().catch(() => {}).finally(() => {
                scheduling = false;
                if (reschedule) { reschedule = false; setTimeout(schedule, 0); }
            });
        } catch (_) { scheduling = false; }
    };
    window.TrailerDailyWorkspace = { read: () => get().read(), async change(fn, token) { TrailerAuth.scope(); const result = await get().change(fn, token); schedule(); return result; }, sync: () => get().sync(), info: () => get().info() };
    function render() {
        let bar = document.getElementById('dailySyncStatus');
        if (!bar) { const parent = document.querySelector('.conteudo-principal'); if (!parent) return; bar = document.createElement('section'); bar.id = 'dailySyncStatus'; bar.className = 'cartao-backup'; bar.setAttribute('role', 'status'); parent.prepend(bar); }
        const en = document.documentElement.lang === 'en';
        try {
            const s = get().info();
            bar.hidden = s.initialized && s.status === 'ready' && s.pending === 0 && !s.code;
            bar.textContent = bar.hidden ? '' : (s.status === 'conflict' ? (en ? 'Conflict: review required; nothing overwritten. ' : 'Conflito: revisão necessária; nada sobrescrito. ') : s.status === 'paused' || s.code ? (en ? 'Connection/session paused. ' : 'Conexão/sessão pausada. ') : !s.initialized ? (en ? 'Loading account… ' : 'Carregando conta… ') : '') + (en ? 'Pending: ' : 'Pendentes: ') + s.pending;
        }
        catch (_) { bar.hidden = false; bar.textContent = en ? 'Review your account to resume.' : 'Confira sua conta para retomar.'; }
    }
    for (const name of ['online', 'focus', 'traileraccountready']) window.addEventListener(name, schedule);
    window.addEventListener('trailerdailystatus', render); window.addEventListener('trailerpaylanguage', render);
    window.addEventListener('storage', e => { if (e.key?.startsWith('trailerlog:daily:')) { const event = new Event('trailerlogchange'); event.external = true; window.dispatchEvent(event); render(); } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') schedule(); });
    document.addEventListener('DOMContentLoaded', () => { render(); TrailerAuth.ready.then(schedule); });
    setInterval(schedule, 15000);
})();
