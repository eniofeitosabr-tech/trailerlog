// Synthetic in-memory accounts only: no browser profile, network, or real files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { Blob } = require('node:buffer');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
const plain = value => JSON.parse(JSON.stringify(value));
const empty = () => ({ trailersSalvos: [], trucksCadastrados: [], jornadaAtiva: null, jornadasSalvas: [] });
function environment(map = new Map(), initialOwner = A) {
    let owner = initialOwner, fail = false, blob, confirmations = 0;
    const elements = new Map(), events = {};
    const get = id => { if (!elements.has(id)) elements.set(id, { textContent: '', hidden: true }); return elements.get(id); };
    const context = vm.createContext({ console, crypto, Date, Intl, TextEncoder, Blob,
        Event: class { constructor(type) { this.type = type; } },
        TrailerAuth: { scope: () => owner, authorize: async expected => assert.equal(expected, owner) },
        navigator: { locks: { request: async (_, callback) => callback() } },
        localStorage: { getItem: key => map.get(key) ?? null, setItem: (key, value) => {
            if (fail) throw Error('QuotaExceededError'); map.set(key, value);
        } },
        URL: { createObjectURL: value => { blob = value; return 'blob:fixture'; }, revokeObjectURL() {} },
        setTimeout: fn => fn(),
        window: { addEventListener: (name, fn) => (events[name] ??= []).push(fn),
            dispatchEvent(event) { for (const fn of events[event.type] || []) fn(event); } },
        PaycheckUI: { language: 'pt', number: String, money: cents => 'US$ ' + (cents / 100).toFixed(2) }
    });
    for (const file of ['sha256.js', 'payments.js', 'storage.js', 'equipment-history.js', 'detailed-report.js']) vm.runInContext(source(file), context);
    function node(tag) { return { tag, dataset: {}, setAttribute(name, value) { this[name] = value; }, textContent: '', children: [], appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; } }; }
    context.document = { getElementById: get, createElement: tag => tag === 'a' ? { click() {}, remove() {} } : node(tag), body: { appendChild() {} } };
    context.confirm = () => { confirmations++; return true; };
    vm.runInContext(source('backup.js'), context);
    return { context, map, get, node, run: code => vm.runInContext(code, context),
        store: vm.runInContext('TrailerStorage', context), pay: vm.runInContext('TrailerPay', context),
        report: vm.runInContext('DetailedReport', context), fail: value => { fail = value; }, owner: value => { owner = value; },
        confirmations: () => confirmations,
        async exported() { vm.runInContext('exportarBackup()', context); assert(blob, get('statusBackup').textContent); return blob.text(); },
        async restore(text) { context.input = { files: [{ text: async () => text }], value: 'fixture.json' }; await vm.runInContext('restaurarBackup(input)', context); }
    };
}
const base = { version: 1, localDate: '2026-10-24', originalMiles: 300, storeToBackhaul: 25, backhaulToBase: 75,
    backhaul: true, destination: 'ACME Logistics', extraDayCents: 20000, rateCents: 65, initialTrailer: 'INITIAL' };
const detention = { version: 1, id: 'det-1', localDate: '2026-10-24', minutes: 90, rateCents: 1500, createdAt: '2026-10-24T15:00:00Z', recordedValueCents: 2250 };
function fixture() {
    const finished = { id: 'finished', truck: 'TRUCK-1', trailer: 'LAST', inicio: '2026-10-24T08:00:00Z', fim: '2026-10-24T18:00:00Z',
        status: 'Finalizada', pagamento: { ...base, payableMiles: 250, backhaulBonusCents: 5150 },
        backhauls: [{ company: 'ACME Logistics' }, { empresa: 'Second Company' }, { company: 'ACME Logistics' }],
        truckHistory: [{ truck: 'TRUCK-1', at: '2026-10-24T08:00:00Z' }],
        detentions: [detention, { ...detention, id: 'det-2', minutes: 30, rateCents: 2000, recordedValueCents: 1000 }],
        pagamentoCorrecoes: [{ at: '2026-10-24T19:00:00Z', before: { ...base, originalMiles: 280 }, after: base, reason: 'fixture' }],
        detentionCorrections: [{ at: '2026-10-24T19:00:00Z', detentionId: detention.id, before: null, after: detention }],
        custom: { historicalWeekend: 5000, nested: ['preserve', { company: 'Original Name' }] } };
    return { ...empty(), trucksCadastrados: [{ numero: 'TRUCK-1', dataCadastro: '2026-10-23T08:00:00Z', observacoes: 'fixture' }],
        trailersSalvos: [{ trailer: 'INITIAL', jornadaId: 'finished', data: '2026-10-24T08:00:00Z' },
            { trailer: 'LAST', jornadaId: 'finished', data: '2026-10-24T12:00:00Z', troca: { de: 'INITIAL', para: 'LAST' } }],
        jornadasSalvas: [finished, { ...plain(finished), id: 'same-saturday', detentions: [], detentionCorrections: [] },
            { id: 'legacy-undated', truck: 'OLD', empresaBackhaul: 'Legacy Freight' }],
        jornadaAtiva: { id: 'active', truck: 'TRUCK-1', trailer: 'ACTIVE', inicio: '2026-10-25T08:00:00Z',
            pagamento: { ...base, localDate: '2026-10-25', additionalBackhaulMiles: 110, rateCents: 75 },
            detentions: [{ ...detention, id: 'active-det', localDate: '2026-10-25', rateCents: 2000 }] },
        paymentSettings: { rateCents: 85, detentionRateCents: 2500 }, metadata: { future: { preserved: true } } };
}
async function main() {
    const origin = environment(), target = environment();
    await origin.store.change(data => Object.assign(data, fixture()));
    const before = plain(origin.store.read().data), originalMap = JSON.stringify([...origin.map]);
    const exported = await origin.exported(), envelope = JSON.parse(exported);
    assert.deepEqual(envelope.dados, before, 'real download payload includes every field');
    assert.equal(envelope.versao, 1); assert.equal(envelope.aplicativo, 'Trailer Log');
    assert(Number.isFinite(Date.parse(envelope.exportadoEm)));
    assert.equal(JSON.stringify([...origin.map]), originalMap, 'export never writes');
    // Destination has existing records and another account: only explicit confirmed restore replaces A.
    await target.store.change(data => data.trucksCadastrados.push({ numero: 'EXISTING' }));
    target.owner(B); await target.store.change(data => data.trucksCadastrados.push({ numero: 'PRIVATE-B' }));
    const accountB = JSON.stringify([...target.map].filter(([key]) => key.includes(B)));
    target.owner(A); const notConfirmed = JSON.stringify([...target.map]);
    target.context.confirm = () => false; await target.restore(exported);
    assert.equal(JSON.stringify([...target.map]), notConfirmed);
    target.context.confirm = () => true; await target.restore(exported);
    assert.match(target.get('statusBackup').textContent, /sucesso/);
    assert.deepEqual(plain(target.store.read().data), before, 'deep field-by-field round trip, including all IDs and metadata');
    assert.equal(JSON.stringify([...target.map].filter(([key]) => key.includes(B))), accountB);
    await target.restore(exported);
    assert.deepEqual(plain(target.store.read().data), before, 'repeated restore replaces, never appends duplicates');
    for (const [from, to] of [['2026-10-24','2026-10-24'],['2026-10-25','2026-10-25'],['2026-10-23','2026-10-30']]) {
        assert.deepEqual(plain(target.pay.report(target.store.read().data, from, to)), plain(origin.pay.report(before, from, to)));
        const a = origin.report.build(before, from, to), b = target.report.build(target.store.read().data, from, to);
        delete a.issuedAt; delete b.issuedAt; assert.deepEqual(plain(a), plain(b));
        const left = origin.node('section'), right = target.node('section');
        origin.report.render(left, a); target.report.render(right, b);
        const text = node => node.textContent + node.children.map(text).join('');
        assert.equal(text(left), text(right), 'screen/native-print report content remains identical');
    }
    assert.equal(target.pay.report(before, '2026-10-24','2026-10-25').totals.saturdayCents,5000);
    assert.equal(target.pay.report(before, '2026-10-24','2026-10-25').totals.sundayCents,5000);
    // Bare legacy JSON, missing optional start dates, and optional settings absent.
    const old = empty(); old.jornadasSalvas.push({ id: 'legacy', truck: 'OLD', empresaBackhaul: 'Old Company' });
    await target.restore('\uFEFF' + JSON.stringify(old));
    assert.deepEqual(plain(target.store.read().data.paymentSettings),before.paymentSettings);
    assert.equal(target.store.read().data.jornadasSalvas[0].empresaBackhaul,'Old Company');
    assert.equal(target.store.read().data.jornadasSalvas[0].inicio,undefined);
    const oldExport = await target.exported(), oldTarget = environment(); await oldTarget.restore(oldExport);
    assert.match(oldTarget.get('statusBackup').textContent,/sucesso/);
    assert.deepEqual(plain(oldTarget.store.read().data),plain(target.store.read().data));
    // Unknown root keys remain JSON data; they must never mutate object prototypes.
    const special = JSON.parse(exported);
    Object.defineProperty(special.dados,'__proto__',{value:{polluted:true},enumerable:true});
    const specialTarget=environment();await specialTarget.restore(JSON.stringify(special));
    assert.match(specialTarget.get('statusBackup').textContent,/sucesso/);
    assert.equal(specialTarget.run('({}).polluted'),undefined);
    assert.equal(Object.hasOwn(specialTarget.store.read().data,'__proto__'),true);
    // Bad envelopes, missing collections, wrong types/dates/payments/detention and repeated IDs.
    const bad = [ '{', 'null', '{}', JSON.stringify({ ...envelope, versao: 99 }),
        JSON.stringify({ ...envelope, aplicativo: 'Other' }), JSON.stringify({ ...empty(), trailersSalvos: null }),
        JSON.stringify({ ...empty(), jornadasSalvas: [{ id:'x',truck:'T',inicio:'invalid' }] }) ];
    for (const mutate of [d=>delete d.trucksCadastrados, d=>d.paymentSettings.rateCents=-1,
        d=>d.jornadaAtiva.pagamento.originalMiles=-1,
        d=>d.jornadasSalvas[0].detentions.push(d.jornadasSalvas[0].detentions[0]),
        d=>d.trailersSalvos.push(d.trailersSalvos[0])]) {
        const data=plain(before); mutate(data); bad.push(JSON.stringify({ ...envelope, dados:data }));
    }
    for (const payload of bad) {
        const unchanged=JSON.stringify([...target.map]); let confirmed=false;
        target.context.confirm=()=>{confirmed=true;return true;}; await target.restore(payload);
        assert.equal(confirmed,false,'invalid backup is rejected before confirmation');
        assert.equal(JSON.stringify([...target.map]),unchanged);
        assert.match(target.get('statusBackup').textContent,/poss/);
    }
    const unchanged=JSON.stringify([...target.map]); target.context.confirm=()=>true; target.fail(true);
    await target.restore(exported); target.fail(false); assert.equal(JSON.stringify([...target.map]),unchanged,'quota failure is atomic');
    target.context.confirm=()=>{target.map.set('unrelated','preserved'); target.owner(B); return true;};
    const bBefore=target.map.get('trailerlog:user:'+B+':trailerLogEstadoV2'); await target.restore(exported);
    assert.equal(target.map.get('trailerlog:user:'+B+':trailerLogEstadoV2'),bBefore,'account change in confirmation aborts');
    target.owner(A); let finish;
    target.context.input={value:'fixture.json',files:[{text:()=>new Promise(resolve=>{finish=resolve;})}]};
    const reading=target.run('restaurarBackup(input)'); target.owner(B); finish(exported); await reading;
    assert.equal(target.map.get('trailerlog:user:'+B+':trailerLogEstadoV2'),bBefore,'account change while reading aborts');
    assert.match(target.get('statusBackup').textContent,/conta mudou/);
    // A concurrent write after confirmation invalidates the captured token.
    target.owner(A); target.context.confirm=()=>{target.map.set('trailerlog:user:'+A+':trucksCadastrados','[]');return true;};
    const rawBefore=target.map.get('trailerlog:user:'+A+':trailerLogEstadoV2');await target.restore(exported);
    assert.equal(target.map.get('trailerlog:user:'+A+':trailerLogEstadoV2'),rawBefore);
    console.log('PASSOU: backup real completo, round trip campo a campo, legado/novos, relatorios e totais iguais, sem duplicar, invalidos, quota, confirmacao, concorrencia e isolamento de contas. Sem rede/dados reais.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
