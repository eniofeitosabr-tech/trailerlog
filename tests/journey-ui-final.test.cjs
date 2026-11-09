'use strict';
// Synthetic DOM and records only; no network, database or persistent user storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'historico.html'), 'utf8');
const controls = new Map();
const element = id => {
    if (!controls.has(id)) controls.set(id, { value: '', hidden: false, textContent: '', innerHTML: '', classList: { toggle() {} } });
    return controls.get(id);
};
const journey = (id, truck, day, active = false) => ({
    id, registroId: 'record-' + id, truck, trailer: 'T-' + id,
    inicio: day + 'T10:00:00', fim: active ? undefined : day + 'T18:00:00',
    status: active ? 'Em andamento' : 'Finalizada'
});
const data = {
    jornadasSalvas: [journey('first', 'A', '2026-11-02'), journey('second', 'B', '2026-11-03')],
    jornadaAtiva: journey('active', 'C', '2026-11-02', true),
    trailersSalvos: [{ registroId: 'use', jornadaId: 'first', trailer: 'T-first', truck: 'A' }],
    trucksCadastrados: []
};
const original = JSON.stringify(data);
const context = vm.createContext({
    Date, Intl, document: { getElementById: element, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {} }, PaycheckUI: { language: 'pt' },
    TrailerAuth: { scope: () => 'synthetic-owner' },
    TrailerStorage: { read: () => ({ data, token: 'synthetic-token' }), change() { throw Error('Filtering must not write'); } }
});
vm.runInContext(fs.readFileSync(path.join(root, 'equipment-history.js'), 'utf8'), context);
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const run = code => vm.runInContext(code, context);
const cards = () => (element('historico').innerHTML.match(/class="registro-historico truck"/g) || []).length;
const deletes = () => (element('historico').innerHTML.match(/onclick="excluirJornada/g) || []).length;
assert(!html.includes('trailerPesquisa') && !html.includes('filtroTrailerJornada'));
run('selecionarAba("journey")');
assert(element('pesquisaNumeroHistorico').hidden);
assert.equal(cards(), 3, 'All saved and active journeys are visible without a day');
assert.equal(deletes(), 2, 'Only the two finalized journeys offer deletion');
element('campoPesquisa').value = 'must-not-filter-journeys';
element('dataPesquisa').value = '2026-11-02';
element('dataPesquisaAte').value = '2026-11-02';
run('mostrarHistorico()');
assert.equal(cards(), 2); assert.equal(deletes(), 1);
assert(!element('historico').innerHTML.includes('T-second'));
element('dataPesquisa').value = '2026-11-03'; element('dataPesquisaAte').value = '2026-11-03'; run('mostrarHistorico()');
assert.equal(cards(), 1); assert.equal(deletes(), 1);
element('dataPesquisa').value = '2026-11-05'; element('dataPesquisaAte').value = '2026-11-05'; run('mostrarHistorico()');
assert.equal(cards(), 0);
run('limparDataHistorico()'); assert.equal(cards(), 3);
for (const language of ['pt', 'en']) {
    context.PaycheckUI.language = language;
    run('selecionarAba("truck")'); assert(!element('pesquisaNumeroHistorico').hidden);
    element('campoPesquisa').value = 'A'; run('mostrarHistorico()'); assert.equal(cards(), 1);
    run('selecionarAba("trailer")'); assert(!element('pesquisaNumeroHistorico').hidden);
    element('campoPesquisa').value = 'T-first'; run('mostrarHistorico()');
    assert(element('historico').innerHTML.includes('excluirTrailer(0)'));
    run('selecionarAba("journey")'); assert.equal(cards(), 3);
}
assert.equal(JSON.stringify(data), original, 'Filtering and language changes must not mutate source records');
console.log('PASS journey UI: date-only tab, all/selected/cleared days, active journey protected, truck/trailer filters preserved, PT/EN and no data writes.');
