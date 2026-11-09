const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ui = { language: 'pt', number: value => String(value), money: cents => 'US$ ' + (cents / 100).toFixed(2) };
const context = vm.createContext({ console, Date, Intl, PaycheckUI: ui });
vm.runInContext(source('payments.js'), context); vm.runInContext(source('equipment-history.js'), context); vm.runInContext(source('detailed-report.js'), context);
const pay = vm.runInContext('TrailerPay', context), report = vm.runInContext('DetailedReport', context);
const p = { version: 1, localDate: '2026-10-24', originalMiles: 300, storeToBackhaul: 25, backhaulToBase: 75,
    backhaul: true, destination: '<img src=x onerror=alert(1)>', extraDayCents: 20000, rateCents: 65, initialTrailer: 'INITIAL' };
const detained = { version: 1, id: 'det', localDate: '2026-10-24', minutes: 90, rateCents: 1500, createdAt: '2026-10-24T15:00:00Z' };
const a = { id: 'a', truck: 'TRUCK-A', trailer: 'LAST', inicio: '2026-10-24T12:00:00Z', fim: '2026-10-24T20:30:00Z',
    pagamento: p, detentions: [detained], loja: 'Recorded store', truckHistory: [{ truck: 'RECORDED-TRUCK', at: '2026-10-24T13:00:00Z' }] };
const b = { id: 'b', truck: 'TRUCK-B', inicio: '2026-10-24T21:00:00Z', pagamento: { ...p, backhaul: false, originalMiles: 100, storeToBackhaul: 0, backhaulToBase: 0, extraDayCents: 15000 } };
const c = { id: 'c', truck: 'TRUCK-A', inicio: '2026-10-25T12:00:00Z', pagamento: { ...p, localDate: '2026-10-25', rateCents: 75 } };
const old = { id: 'old', truck: 'OLDER', inicio: '2026-10-24T10:00:00Z' };
const missing = { id: 'missing', truck: 'NO-DATE' };
const missingWithDetention = { id: 'missing-det', truck: 'DETENTION-ONLY', detentions: [{ ...detained, id: 'legacy-det' }] };
const data = { jornadasSalvas: [c, b, a, old, missing, missingWithDetention], jornadaAtiva: null, trucksCadastrados: [], trailersSalvos: [
    { trailer: 'LAST', jornadaId: 'a', data: '2026-10-24T18:00:00Z' },
    { trailer: 'INITIAL', jornadaId: 'a', data: '2026-10-24T12:00:00Z' },
    { trailer: 'NO-TIME', jornadaId: 'a' }, { trailer: 'UNRELATED', jornadaId: 'different' }
] };
const raw = JSON.stringify(data);
const caseVariants = {...data, trailersSalvos:[...data.trailersSalvos,{trailer:'last',jornadaId:'a',data:'2026-10-24T19:00:00Z'}]};
assert.equal(report.build(caseVariants,'2026-10-24','2026-10-25').trailers.filter(value=>value.toLowerCase()==='last').length,1);
assert.equal(report.build(caseVariants,'2026-10-24','2026-10-25').rows.find(row=>row.journey.id==='a').trailerHistory.filter(entry=>entry.trailer.toLowerCase()==='last').length,2,'visit records remain distinct');
let detailed = report.build(data, '2026-10-24', '2026-10-25');
assert.equal(JSON.stringify(detailed.totals), JSON.stringify(pay.report(data, '2026-10-24', '2026-10-25').totals));
assert.equal(detailed.rows.length, 5); assert.equal(detailed.backhauls, 2);
assert.equal(detailed.totals.saturdayCents, 5000); assert.equal(detailed.totals.sundayCents, 5000);
assert.equal(detailed.hasUndated, true);
const row = detailed.rows.find(row => row.journey.id === 'a');
assert.equal(row.durationMinutes, 510); assert.equal(row.initialMiles, 150); assert.equal(row.additionalMiles, 100); assert.equal(row.payableMiles, 250);
assert.equal(row.mileageCents, 16250); assert.equal(row.detentionCents, 2250);
assert.equal(row.initialTrailer, 'INITIAL'); assert.equal(row.destination, 'Recorded store');
assert.equal(row.trailerHistory[0].trailer, 'INITIAL'); assert.equal(row.trailerHistory[1].trailer, 'LAST'); assert.equal(row.trailerHistory[2].at, null);
assert.equal(row.truckHistory[0].truck, 'RECORDED-TRUCK');
assert(detailed.trucks.includes('TRUCK-A') && detailed.trucks.includes('TRUCK-B')); assert(!detailed.trailers.includes('UNRELATED'));
assert.equal(new Set(detailed.trailers).size, detailed.trailers.length);
assert.equal(report.build(data, '2026-10-25', '2026-10-25').rows.length, 1);
const older = detailed.rows.find(row => row.journey.id === 'old'); assert.equal(older.payment, null); assert.equal(older.initialTrailer, null); assert.equal(older.durationMinutes, null);
assert.equal(detailed.rows.find(row => row.journey.id === 'missing-det').start, null);
assert(!detailed.rows.some(row => row.journey.id === 'missing'));
data.jornadaAtiva = b; // same ID in saved and active data must not duplicate totals.
assert.equal(report.build(data, '2026-10-24', '2026-10-25').rows.length, 5);
data.jornadaAtiva = null;
assert.equal(JSON.stringify(data), raw, 'report generation never modifies stored values');
function node(tag) { return { tag, dataset: {}, setAttribute(name, value) { this[name] = value; }, textContent: '', children: [], appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; } }; }
context.document = { createElement: node };
const container = node('section'); report.render(container, detailed);
const flatten = item => item.textContent + '\n' + item.children.map(flatten).join('\n');
let output = flatten(container);
assert(output.includes('Não informado')); assert(output.includes('300 milhas')); assert(output.includes('8 horas 30 minutos'));
assert(output.includes('US$ 22.50')); assert(output.includes(p.destination));
assert(!JSON.stringify(container).includes('"tag":"img"'), 'descriptions are text, never injected markup');
ui.language = 'en'; report.render(container, detailed); output = flatten(container);
assert(output.includes('Not provided')); assert(output.includes('300 miles')); assert(output.includes('Detailed Payment Report')); assert(output.includes('8 hours 30 minutes'));
assert(!output.includes('Não informado'));

// Company names are metadata: resolve original payloads without changing financial rules.
const companyCases = [
    {id:'active-company', inicio:'2026-10-24T12:00:00Z', pagamento:{...p,destination:'ACME Logistics'}},
    {id:'finished-company', inicio:'2026-10-24T12:00:00Z', fim:'2026-10-24T15:00:00Z', pagamento:{...p,destination:'Cooper Transport'}},
    {id:'legacy-company', inicio:'2026-10-24T12:00:00Z', empresaBackhaul:'Legacy Freight'},
    {id:'raw-company', inicio:'2026-10-24T12:00:00Z', pagamento:{...p,destination:'',backhaul:false,backhaulCompany:'Raw Freight'}},
    {id:'multiple-companies', inicio:'2026-10-24T12:00:00Z', pagamento:{...p,destination:'ACME Logistics'},
        backhauls:[{company:'ACME Logistics'},{empresa:'Second Company'},{company:'ACME Logistics'},{}]},
    {id:'missing-company', inicio:'2026-10-24T12:00:00Z', backhaul:true, loja:'Do not infer company from store'}
];
const companyData={...data,jornadasSalvas:companyCases.slice(1),jornadaAtiva:companyCases[0]};
const originalCompanies=JSON.stringify(companyData);
const companyReport=report.build(companyData,'2026-10-24','2026-10-24');
assert.equal(JSON.stringify(companyReport.totals),JSON.stringify(pay.report(companyData,'2026-10-24','2026-10-24').totals));
assert.equal(companyReport.rows.find(r=>r.journey.id==='active-company').active,true);
for(const [id,name] of [['active-company','ACME Logistics'],['finished-company','Cooper Transport'],['legacy-company','Legacy Freight'],['raw-company','Raw Freight']])
    assert.equal(companyReport.rows.find(r=>r.journey.id===id).backhaulCompanies[0],name);
assert.equal(JSON.stringify(companyReport.rows.find(r=>r.journey.id==='multiple-companies').backhaulCompanies),JSON.stringify(['ACME Logistics','Second Company','ACME Logistics',null]));
assert.equal(JSON.stringify(report.backhaulCompanies(companyCases[5])),JSON.stringify([null]));
assert.equal(JSON.stringify(report.backhaulCompanies({payment:{backhaulName:'Previous Format'}})),JSON.stringify(['Previous Format']));
assert.equal(JSON.stringify(report.backhaulCompanies({payment:{backhaul:true,destination:'Previous Destination'}})),JSON.stringify(['Previous Destination']));
for(const language of ['pt','en']) {
    ui.language=language; report.render(container,companyReport); const rendered=flatten(container);
    for(const name of ['ACME Logistics','Cooper Transport','Legacy Freight','Raw Freight','Second Company']) assert(rendered.includes(name));
    assert(rendered.includes(language==='pt'?'Empresa do Backhaul':'Backhaul Company'));
    assert(rendered.includes(language==='pt'?'Data de emissão':'Issue date'));
}
assert.equal(JSON.stringify(companyData),originalCompanies,'legacy and active metadata must never be rewritten');
for (const file of ['index.html','historico.html','paycheck.html','configuracoes.html','sobre.html']) {
    const html = source(file), nav = html.match(/<nav>[\s\S]*?<\/nav>/)[0];
    const keys = [...nav.matchAll(/<a\b[^>]*data-pay-i18n="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(keys, ['navRegister','menu','navHistory','navReports','navSettings','navAbout','navLogout'], file);
    assert.equal((nav.match(/id="contaStatus"/g) || []).length, 1); assert(nav.indexOf('contaStatus') < nav.indexOf('data-auth-logout'));
    assert.equal((nav.match(/data-auth-logout/g) || []).length, 1);
    assert(/<button[\s\S]*<\/button>\s*<\/nav>/.test(nav));
    const links = [...nav.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(links, ['index.html','paycheck.html','historico.html','historico.html','configuracoes.html','sobre.html','login.html']);
    assert(!nav.includes('data-pay-language')); assert(html.includes('pay-footer-language'));
}
const css = source('payments.css'); assert(css.includes('@media print')); assert(css.includes('body:not(.pay-print-ready) .app-layout'));
assert(source('detailed-report.js').includes('window.print()')); assert(source('detailed-report.js').includes('TrailerAuth.authorize(owner)'));
assert(!source('paycheck.html').includes('payEditForm'));
console.log('PASSOU: relatório somente leitura, valores do motor original, datas, viagens, trailers, histórico explícito de caminhões, legado incompleto, unidades/PT-EN, duplicações e menus uniformes.');
