// Synthetic accounts and storage only. No Supabase, real records or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const base = { version: 1, localDate: '2026-10-23', originalMiles: 100, storeToBackhaul: 0,
    backhaulToBase: 0, backhaul: false, destination: '', extraDayCents: 0, rateCents: 65, initialTrailer: 'TRAILER-1' };
const blank = () => ({ trailersSalvos: [], trucksCadastrados: [], jornadaAtiva: null, jornadasSalvas: [] });
function environment(shared = new Map(), owner = '10000000-0000-4000-8000-000000000001') {
    const events = {}, prefix = 'trailerlog:user:' + owner + ':';
    const context = vm.createContext({ console, crypto, Date, Intl, TextEncoder,
        Event: class { constructor(type) { this.type = type; } },
        TrailerAuth: { scope: () => owner, authorize: async id => assert.equal(id, owner), ready: Promise.resolve() },
        navigator: { locks: { request: async (name, fn) => fn() } },
        localStorage: { getItem: key => shared.get(key) ?? null, setItem: (key, value) => {
            assert(key.startsWith(prefix)); shared.set(key, value);
        } },
        window: { addEventListener: (name, fn) => (events[name] ??= []).push(fn), dispatchEvent(event) {
            for (const fn of events[event.type] || []) fn(event);
        } },
        document: { addEventListener() {}, getElementById: () => ({ textContent: '' }) }
    });
    for (const file of ['sha256.js', 'payments.js', 'storage.js', 'backup.js']) vm.runInContext(source(file), context);
    return { context, map: shared, pay: vm.runInContext('TrailerPay', context), store: vm.runInContext('TrailerStorage', context),
        run: text => vm.runInContext(text, context) };
}
const journey = (id, date, payment = {}) => ({ id, truck: 'TRUCK-1', trailer: 'TRAILER-1', inicio: date + 'T14:00:00Z',
    pagamento: { ...base, localDate: date, ...payment } });
async function main() {
    const env = environment(), p = env.pay;
    // Regression: initial minimum survives return miles, storage reload and backup.
    const regressionEnv = environment();
    const regressionJourney = journey('backhaul-minimum', '2026-11-09');
    regressionJourney.pagamento = p.create({ ...base, originalMiles: 98, backhaul: true,
        destination: 'SYNTHETIC', additionalBackhaulMiles: 72 }, regressionJourney, { rateCents: 65 });
    await regressionEnv.store.change(d => { d.jornadasSalvas.push(regressionJourney); });
    const reloaded = environment(regressionEnv.map).store.read().data;
    assert.equal(p.calculate(reloaded.jornadasSalvas[0].pagamento).totalCents, 14330);
    assert.equal(p.report(reloaded, '2026-11-09', '2026-11-09').totals.totalCents, 14330);
    assert.equal(p.calculate(JSON.parse(JSON.stringify(reloaded)).jornadasSalvas[0].pagamento).totalCents, 14330);
    assert.equal(p.calculate(base).payableMiles, 100);
    assert.equal(p.calculate(base).mileageCents, 6500);
    assert.equal(p.calculate(base).totalCents, 6500);
    const backhaul = { ...base, backhaul: true, destination: 'STORE → BACKHAUL', originalMiles: 300 };
    assert.equal(p.calculate(backhaul).payableMiles, 150);
    assert.equal(p.calculate(backhaul).backhaulCents, 5150);
    assert.equal(p.calculate(backhaul).totalCents, 14900);
    assert.equal(p.calculate({ ...backhaul, storeToBackhaul: 25, backhaulToBase: 75 }).payableMiles, 250);
    assert.equal(p.calculate({ ...base, originalMiles: 0.01, backhaul: true, destination: 'X' }).payableMiles, 0.005);
    for (const amount of [15000, 20000, 25000, 30000]) assert.equal(p.calculate({ ...base, extraDayCents: amount }).totalCents, 6500 + amount);
    for (const invalid of [{ originalMiles: -1 }, { originalMiles: NaN }, { originalMiles: Infinity }, { originalMiles: 0.001 },
        { originalMiles: '100' }, { extraDayCents: 15100 }, { rateCents: 0 }, { localDate: '2026-02-30' },
        { backhaul: true, destination: '' }]) assert.throws(() => p.calculate({ ...base, ...invalid }));
    const data = blank();
    data.jornadasSalvas = [journey('fri', '2026-10-23'), journey('sat-a', '2026-10-24'), journey('sat-b', '2026-10-24'),
        journey('sun-a', '2026-10-25'), journey('sun-b', '2026-10-25')];
    let report = p.report(data, '2026-10-23', '2026-10-25');
    assert.equal(report.totals.saturdayCents, 5000); assert.equal(report.totals.sundayCents, 5000);
    assert.equal(report.totals.totalCents, 42500);
    assert.equal(p.report(data, '2026-10-24', '2026-10-24').totals.totalCents, 18000);
    assert.equal(p.report(data, '2026-10-26', '2026-10-27').rows.length, 0);
    assert.throws(() => p.report(data, '2026-10-25', '2026-10-24'));
    // Free selection: Wednesday to Tuesday, no Monday/Sunday restriction.
    assert.equal(p.report(data, '2026-10-21', '2026-10-27').totals.totalCents, 42500);
    assert.equal(p.report(data, '2026-10-23', '2026-10-29').totals.totalCents, 42500);
    data.jornadaAtiva = data.jornadasSalvas[0];
    data.jornadasSalvas.push(data.jornadasSalvas[1]);
    assert.equal(p.report(data, '2026-10-23', '2026-10-25').rows.length, 5, 'duplicate journey IDs cannot duplicate pay');
    data.jornadaAtiva = null; data.jornadasSalvas.pop();
    data.jornadasSalvas[0].fim = '2026-10-23T20:00:00Z';
    const corrected = { ...base, backhaul: true, destination: '<script>synthetic</script>', extraDayCents: 20000, storeToBackhaul: 10 };
    p.edit(data, 'fri', corrected, '2026-10-28T00:00:00Z');
    assert.equal(data.jornadasSalvas[0].pagamentoCorrecoes.length, 1);
    assert.equal(data.jornadasSalvas[0].pagamentoCorrecoes[0].before.backhaul, false);
    assert.equal(data.jornadasSalvas[0].pagamentoCorrecoes[0].after.extraDayCents, 20000);
    assert.equal(data.jornadasSalvas[0].fim, '2026-10-23T20:00:00Z');
    assert.equal(p.edit(data, 'fri', corrected), false, 'repeated save is idempotent');
    assert.equal(data.jornadasSalvas[0].pagamentoCorrecoes.length, 1);
    assert.equal(p.report(data, '2026-10-23', '2026-10-23').totals.totalCents, 29050);
    p.edit(data, 'fri', { ...corrected, extraDayCents: 15000 });
    assert.equal(p.report(data, '2026-10-23', '2026-10-23').totals.extraDayCents, 15000, 'replace rather than add Extra Day');
    const older = { id: 'old', truck: 'LEGACY', trailer: 'OLD', inicio: '2026-10-24T12:00:00Z', custom: 'preserve' };
    data.jornadasSalvas.push(older);
    assert.equal(p.report(data, '2026-10-24', '2026-10-24').rows.find(r => r.journey.id === 'old').totalCents, 0);
    assert.equal(older.pagamento, undefined, 'read never migrates older records');
    p.edit(data, 'old', { ...base, localDate: '2026-10-24' });
    assert.equal(older.custom, 'preserve'); assert.equal(older.pagamentoCorrecoes[0].before, null);
    assert.equal(p.report(data, '2026-10-24', '2026-10-24').totals.saturdayCents, 5000);
    const created = p.create({ ...base, originalMiles: 10 }, { inicio: new Date(2026, 9, 24, 23, 59).toISOString(), trailer: 'START' }, { rateCents: 75 });
    assert.equal(created.localDate, '2026-10-24'); assert.equal(created.rateCents, 75);
    assert.equal(created.payableMiles, 10); assert.equal(created.backhaulBonusCents, 0);
    assert.equal(p.calculate(created).mileageCents, 4500);
    await env.store.change(d => Object.assign(d, data, { paymentSettings: { rateCents: 80 } }));
    const persisted = env.store.read().data;
    assert.equal(persisted.jornadasSalvas[0].pagamento.rateCents, 65, 'future setting leaves previous rates unchanged');
    const token = env.store.read().token;
    await env.store.change(d => { d.paymentSettings.rateCents = 90; });
    await assert.rejects(env.store.change(d => p.edit(d, 'fri', base), token), /mudaram/);
    const unchanged = JSON.stringify([...env.map]);
    await assert.rejects(env.store.change(d => { d.jornadasSalvas[0].pagamento.originalMiles = -1; }));
    assert.equal(JSON.stringify([...env.map]), unchanged, 'invalid payment never publishes a partial state');
    const other = environment(env.map, '10000000-0000-4000-8000-000000000002');
    assert.equal(other.store.read().data.jornadasSalvas.length, 0);
    const archive = { aplicativo: 'Trailer Log', versao: 1, dados: env.store.read().data };
    env.context.payload = JSON.stringify(archive);
    const restored = env.run('lerArquivoBackup(payload)');
    assert.equal(restored.jornadasSalvas[0].pagamentoCorrecoes.length, 2);
    assert.equal(restored.paymentSettings.rateCents, 90);
    await env.run('aplicarDadosBackup(lerArquivoBackup(payload), TrailerStorage.read().token)');
    assert.equal(env.store.read().data.jornadasSalvas[0].pagamentoCorrecoes.length, 2);
    const oldBackup = blank(); oldBackup.jornadasSalvas.push({ ...older }); delete oldBackup.jornadasSalvas[0].pagamento; delete oldBackup.jornadasSalvas[0].pagamentoCorrecoes;
    env.context.oldPayload = JSON.stringify(oldBackup);
    await env.run('aplicarDadosBackup(lerArquivoBackup(oldPayload), TrailerStorage.read().token)');
    assert.equal(env.store.read().data.paymentSettings.rateCents, 90, 'older backups preserve the configured rate');
    assert.equal(env.store.read().data.jornadasSalvas[0].custom, 'preserve');
    // Real journey actions keep payment on the same journey through trailer changes/finalization.
    const integration = environment(), controls = new Map();
    const get = id => { if (!controls.has(id)) controls.set(id, { value: '', style: {}, selectedOptions: [{ text: 'Fixture' }] }); return controls.get(id); };
    get('truck').value = 'FIXTURE-TRUCK'; get('trailer').value = 'FIRST';
    integration.context.document = { getElementById: get, querySelector: () => ({ style: {} }), addEventListener() {} };
    integration.context.mostrarModal = () => {};
    integration.context.PaycheckUI = { signature: () => '', startInput: () => ({ ...backhaul, extraDayCents: 15000 }), active() {} };
    vm.runInContext(source('registros.js'), integration.context);
    await integration.run('iniciarJornada()');
    const first = integration.store.read().data.jornadaAtiva;
    get('trailer').value = 'SECOND'; await integration.run('trocarTrailer()');
    await integration.store.change(d => p.edit(d, first.id, { ...d.jornadaAtiva.pagamento, storeToBackhaul: 25, backhaulToBase: 75 }));
    await integration.run('finalizarJornada()');
    const finished = integration.store.read().data;
    assert.equal(finished.jornadasSalvas.length, 1); assert.equal(finished.trailersSalvos.length, 2);
    assert.equal(finished.jornadasSalvas[0].pagamento.extraDayCents, 15000);
    assert.equal(finished.jornadasSalvas[0].pagamento.payableMiles, 250);
    assert.equal(finished.jornadasSalvas[0].pagamento.originalMiles, 300);
    assert.equal(finished.jornadasSalvas[0].pagamento.initialTrailer, 'FIRST');
    assert.equal(finished.jornadasSalvas[0].trailer, 'SECOND');
    assert.equal(p.calculate(finished.jornadasSalvas[0].pagamento).payableMiles, 250);
    assert.equal(p.calculate(finished.jornadasSalvas[0].pagamento).backhaulCents, 5150);
    // Unified additional miles override, rather than add to, preserved legacy legs.
    const unified = environment(), oldPayment = { ...backhaul, storeToBackhaul: 25, backhaulToBase: 75 };
    await unified.store.change(d => {
        d.jornadasSalvas.push({ id: 'unified', truck: 'LEGACY', trailer: 'TRAILER', inicio: '2026-10-23T12:00:00Z',
            fim: '2026-10-23T18:00:00Z', pagamento: oldPayment,
            pagamentoCorrecoes: [{ at: '2026-10-23T12:00:00Z', before: null, after: oldPayment }] });
    });
    const originalState = JSON.stringify([...unified.map]);
    assert.equal(p.additionalMiles(unified.store.read().data.jornadasSalvas[0].pagamento), 100);
    assert.equal(JSON.stringify([...unified.map]), originalState, 'legacy sum is read without migration');
    assert.equal(p.edit(unified.store.read().data, 'unified', { ...oldPayment, additionalBackhaulMiles: 100 }), false,
        'saving unchanged legacy total must not create a correction or change representation');
    await unified.store.change(d => p.edit(d, 'unified', { ...d.jornadasSalvas[0].pagamento, additionalBackhaulMiles: 130 }));
    let paid = unified.store.read().data.jornadasSalvas[0];
    assert.equal(p.calculate(paid.pagamento).payableMiles, 280);
    assert.equal(paid.pagamento.originalMiles, 300);
    assert.equal(paid.pagamento.storeToBackhaul, 25); assert.equal(paid.pagamento.backhaulToBase, 75);
    assert.equal(paid.pagamentoCorrecoes.length, 2);
    assert.equal(p.additionalMiles(paid.pagamentoCorrecoes[1].before), 100);
    assert.equal(p.additionalMiles(paid.pagamentoCorrecoes[1].after), 130);
    assert.equal(p.additionalMiles(paid.pagamentoCorrecoes[0].after), 100, 'existing history remains intact');
    await unified.store.change(d => p.edit(d, 'unified', { ...d.jornadasSalvas[0].pagamento, additionalBackhaulMiles: 130 }));
    assert.equal(unified.store.read().data.jornadasSalvas[0].pagamentoCorrecoes.length, 2);
    assert.equal(p.calculate({ ...oldPayment, additionalBackhaulMiles: 0 }).payableMiles, 150, 'explicit zero must override legacy sum');
    assert.equal(p.calculate({ ...oldPayment, backhaul: false, additionalBackhaulMiles: 130 }).payableMiles, 430);
    assert.equal(p.calculate({ ...oldPayment, additionalBackhaulMiles: 130 }).backhaulCents, 5150);
    assert.equal(p.calculate({ ...oldPayment, originalMiles: 0.01, additionalBackhaulMiles: 0.01 }).payableMiles, 0.015);
    assert.equal(p.additionalMiles({ ...oldPayment, storeToBackhaul: 1000000, backhaulToBase: 1000000 }), 2000000);
    assert.equal(p.additionalMiles({ additionalBackhaulMiles: 2000000 }), 2000000);
    for (const value of [-1, NaN, Infinity, '100', 0.001, 2000000.01])
        assert.throws(() => p.calculate({ ...oldPayment, additionalBackhaulMiles: value }));
    unified.context.unifiedBackup = JSON.stringify({ aplicativo: 'Trailer Log', versao: 1, dados: unified.store.read().data });
    await unified.run('aplicarDadosBackup(lerArquivoBackup(unifiedBackup), TrailerStorage.read().token)');
    paid = unified.store.read().data.jornadasSalvas[0];
    assert.equal(paid.pagamento.additionalBackhaulMiles, 130);
    assert.equal(p.calculate(paid.pagamento).payableMiles, 280);
    assert.equal(paid.pagamentoCorrecoes.length, 2);
    assert.equal(paid.pagamento.storeToBackhaul, 25); assert.equal(paid.pagamento.backhaulToBase, 75);
    for (const file of ['payments.js', 'payments-ui.js', 'paycheck-page.js']) new vm.Script(source(file));
    for (const file of ['index.html', 'historico.html', 'configuracoes.html', 'sobre.html', 'paycheck.html']) assert(source(file).includes('href="paycheck.html"'));
    const html = source('paycheck.html');
    assert(html.indexOf('auth.js') < html.indexOf('storage.js')); assert(html.includes('app-startup.js')); assert(html.includes('theme-body.js'));
    assert(!source('paycheck-page.js').includes('innerHTML'), 'report and correction history render user content as text');
    console.log('PASSOU: milhas, backhaul/51.50, adicionais unificados/legados sem duplicar, sábado/domingo únicos, Extra Day, arredondamento, datas livres/semanais, correções idempotentes, histórico, tarifa, backup/restauração, isolamento, conflitos e jornada/troca/finalização. Sem rede.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
