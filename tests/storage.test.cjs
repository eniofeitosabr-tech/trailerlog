// Executar com: node tests/storage.test.cjs. Usa somente Map e contextos VM isolados.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'storage.js'), 'utf8');
const empty = () => ({ trailersSalvos: [], trucksCadastrados: [], jornadaAtiva: null, jornadasSalvas: [] });
function environment(initial = {}) {
    const map = new Map(Object.entries(initial));
    let queue = Promise.resolve();
    let fail = false;
    const locks = { request: (name, callback) => {
        const result = queue.then(callback);
        queue = result.catch(() => {});
        return result;
    } };
    function tab() {
        const listeners = {};
        const context = vm.createContext({
            localStorage: {
                getItem: key => map.get(key) ?? null,
                setItem: (key, value) => { if (fail) throw Error('QuotaExceededError'); map.set(key, value); },
                removeItem: () => { throw Error('Remoção física não permitida neste teste'); }
            },
            navigator: { locks }, crypto, TextEncoder: require('node:util').TextEncoder,
            Event: class Event { constructor(type) { this.type = type; } },
            window: {
                addEventListener: (type, callback) => (listeners[type] ??= []).push(callback),
                dispatchEvent: event => { for (const callback of listeners[event.type] || []) callback(event); }
            }, console
        });
        vm.runInContext(fs.readFileSync(path.join(root, 'sha256.js'), 'utf8'), context);
        vm.runInContext(source, context);
        return { store: vm.runInContext('TrailerStorage', context), context };
    }
    return { map, tab, fail: value => { fail = value; } };
}
async function main() {
    const legacy = [{ truck: '10', trailer: '20', data: '2020-01-01T00:00:00Z', extra: 'preservar' }];
    const env = environment({ trailersSalvos: JSON.stringify(legacy), outroApp: 'intacto' });
    const a = env.tab(), b = env.tab();
    const original = JSON.stringify([...env.map]);
    const first = a.store.read();
    assert.equal(JSON.stringify([...env.map]), original, 'ler não migra nem grava');
    assert.equal(first.data.trailersSalvos[0].registroId, b.store.read().data.trailersSalvos[0].registroId);
    await Promise.all([a.store.change(d => d.trucksCadastrados.push({ numero: 'A', registroId: a.store.id() })),
        b.store.change(d => d.trucksCadastrados.push({ numero: 'B', registroId: b.store.id() }))]);
    assert.equal(a.store.read().data.trucksCadastrados.length, 2, 'adições simultâneas preservadas');
    const deletedId = first.data.trailersSalvos[0].registroId;
    await a.store.change(d => { d.trailersSalvos = d.trailersSalvos.filter(r => r.registroId !== deletedId); });
    await b.store.change(d => d.trailersSalvos.push({ trailer: '30', registroId: b.store.id() }));
    assert.equal(a.store.read().data.trailersSalvos.some(r => r.registroId === deletedId), false);
    assert.equal(env.map.get('trailersSalvos'), JSON.stringify(legacy), 'fonte antiga intacta');
    assert.equal(env.map.get('outroApp'), 'intacto');
    const token = a.store.read().token;
    await b.store.change(d => d.trucksCadastrados.push({ numero: 'C' }));
    await assert.rejects(a.store.change(d => Object.assign(d, empty()), token), /mudaram/);
    const beforeFailure = JSON.stringify([...env.map]);
    env.fail(true);
    await assert.rejects(a.store.change(d => { d.jornadaAtiva = { id: 'J', truck: '10' }; d.trailersSalvos.push({ trailer: '40' }); }), /preservado/);
    assert.equal(JSON.stringify([...env.map]), beforeFailure, 'quota não deixa alteração parcial');
    env.fail(false);
    await a.store.change(d => { d.jornadaAtiva = { id: 'J', truck: '10' }; });
    const finish = store => store.change(d => {
        if (!d.jornadaAtiva) throw Error('já finalizada');
        d.jornadasSalvas.push(d.jornadaAtiva); d.jornadaAtiva = null;
    });
    const results = await Promise.allSettled([finish(a.store), finish(b.store)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(a.store.read().data.jornadasSalvas.length, 1);
    for (const invalid of ['{', 'null', '[null]', '{}']) {
        const bad = environment({ trailersSalvos: invalid });
        const snapshot = JSON.stringify([...bad.map]);
        await assert.rejects(bad.tab().store.change(() => {}));
        assert.equal(JSON.stringify([...bad.map]), snapshot);
    }
    const duplicate = environment({ trailersSalvos: JSON.stringify([...legacy, ...legacy]) });
    const dup = duplicate.tab().store;
    const ids = dup.read().data.trailersSalvos.map(r => r.registroId);
    assert.notEqual(ids[0], ids[1]);
    await dup.change(d => { d.trailersSalvos.splice(0, 1); });
    assert.equal(dup.read().data.trailersSalvos[0].registroId, ids[1]);
    a.context.navigator.locks = null;
    await assert.rejects(a.store.change(() => {}), /navegador/);
    a.context.navigator.locks = { request: (name, fn) => fn() };
    env.map.set('trailersSalvos', '[]');
    await assert.rejects(a.store.change(() => {}), /aba antiga/);
    // Backup 1.1.0, JSON legado, confirmação cancelada e substituição atômica.
    const back = environment();
    const bt = back.tab();
    const status = { textContent: '' };
    bt.context.document = { getElementById: () => status };
    bt.context.confirm = () => false;
    vm.runInContext(fs.readFileSync(path.join(root, 'backup.js'), 'utf8'), bt.context);
    const data = { ...empty(), trailersSalvos: legacy };
    bt.context.input = { files: [{ text: async () => JSON.stringify(data) }], value: 'file' };
    await vm.runInContext('restaurarBackup(input)', bt.context);
    assert.equal(back.map.size, 0);
    bt.context.confirm = () => true;
    await vm.runInContext('restaurarBackup(input)', bt.context);
    assert.equal(bt.store.read().data.trailersSalvos[0].extra, 'preservar');
    const saved = JSON.stringify([...back.map]);
    bt.context.input.files[0].text = async () => '{';
    await vm.runInContext('restaurarBackup(input)', bt.context);
    assert.equal(JSON.stringify([...back.map]), saved);
    bt.context.payload = JSON.stringify({ aplicativo: 'Trailer Log', versao: 1, dados: data });
    assert.equal(vm.runInContext('lerArquivoBackup(payload).trailersSalvos.length', bt.context), 1);
    // Exercita as funções usadas pelos botões, não apenas o armazenamento.
    const app = environment();
    const page = app.tab();
    const elements = Object.fromEntries(['truck', 'trailer', 'truckCondition', 'condition', 'trailerCondition',
        'observacoesTruck', 'Observacoes', 'areaObservacoes', 'btnFinalizarJornada', 'btnTrocarTrailer',
        'campoPesquisa', 'historico', 'saida', 'avisoAtualizacao', 'textoAtualizacao', 'btnContinuarEditando'].map(name => [name, { value: '', style: {}, selectedIndex: 0 }]));
    Object.assign(elements.truck, { value: 'FICTICIO-10' });
    elements.trailer.value = 'FICTICIO-20';
    elements.truckCondition.value = 'Bom';
    elements.condition.selectedOptions = [{ text: 'Vazio' }];
    elements.trailerCondition.selectedOptions = [{ text: 'Bom' }];
    const ready = [];
    page.context.document = { getElementById: name => elements[name], querySelector: () => ({ style: {} }), addEventListener: (type, callback) => { if (type === 'DOMContentLoaded') ready.push(callback); } };
    const messages = [];
    page.context.mostrarModal = message => messages.push(message);
    vm.runInContext(fs.readFileSync(path.join(root, 'registros.js'), 'utf8'), page.context);
    ready.forEach(callback => callback());
    await vm.runInContext('iniciarJornada()', page.context);
    elements.trailer.value = 'FICTICIO-30';
    await vm.runInContext('trocarTrailer()', page.context);
    await vm.runInContext('finalizarJornada()', page.context);
    assert.equal(messages.filter(message => /outra aba/.test(message)).length, 0, 'operações locais não geram aviso falso');
    await app.tab().store.change(d => { d.jornadaAtiva = { truck: 'OUTRA-ABA', id: 'EXTERNA' }; });
    page.context.window.dispatchEvent({ type: 'storage', key: 'trailerLogEstadoV2' });
    assert.match(elements.saida.textContent, /OUTRA-ABA/, 'eventos de outra aba atualizam o estado sem aviso desnecessário');
    await page.store.change(d => { d.jornadaAtiva = null; });
    assert.equal(page.store.read().data.trailersSalvos.length, 2);
    assert.equal(page.store.read().data.jornadasSalvas.length, 1);
    assert.equal(page.store.read().data.jornadaAtiva, null);
    assert.equal(page.store.read().data.trucksCadastrados.length, 1);
    const history = fs.readFileSync(path.join(root, 'historico.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
    const hp = app.tab();
    hp.context.document = page.context.document;
    hp.context.confirm = () => true;
    let warning = '';
    hp.context.alert = message => { warning = message; };
    vm.runInContext(history, hp.context);
    vm.runInContext('snapshotHistorico = TrailerStorage.read()', hp.context);
    const target = hp.store.read().data.trailersSalvos[0].registroId;
    await page.store.change(d => { d.trailersSalvos = d.trailersSalvos.filter(r => r.registroId !== target); });
    await vm.runInContext('excluirTrailer(0)', hp.context);
    assert.match(warning, /excluído ou alterado/);
    assert.equal(hp.store.read().data.trailersSalvos.length, 1, 'índice antigo não exclui outro registro');
    vm.runInContext('snapshotHistorico = TrailerStorage.read()', hp.context);
    await vm.runInContext('excluirTrailer(0)', hp.context);
    assert.equal(hp.store.read().data.trailersSalvos.length, 0);
    assert.equal(hp.store.read().data.jornadasSalvas[0].trailer, '', 'jornada reconciliada na mesma transação');
    // Exportação real da função usa o estado atual, não a cópia legada.
    let exportedBlob;
    bt.context.Blob = require('node:buffer').Blob;
    bt.context.URL = { createObjectURL: blob => { exportedBlob = blob; return 'blob:ficticio'; }, revokeObjectURL() {} };
    bt.context.setTimeout = fn => fn();
    bt.context.document.body = { appendChild() {} };
    bt.context.document.createElement = () => ({ click() {}, remove() {} });
    vm.runInContext('exportarBackup()', bt.context);
    const exported = JSON.parse(await exportedBlob.text());
    assert.equal(exported.versao, 1);
    assert.equal(exported.dados.trailersSalvos[0].extra, 'preservar');
    // SHA-256: vetores e múltiplos blocos, comparados ao Node (incluindo UTF-8).
    for (const value of ['', 'abc', 'á 🚛', 'x'.repeat(10000)]) {
        bt.context.hashInput = value;
        assert.equal(vm.runInContext('trailerSha256(hashInput)', bt.context), crypto.createHash('sha256').update(value).digest('hex'));
    }
    // Recuperação segura: apenas formatação mudou; registros excluídos no estado
    // atual não podem reaparecer. Nenhuma chave antiga é alterada.
    const re = environment({ trailersSalvos: JSON.stringify(legacy) });
    const rs = re.tab().store;
    await rs.change(d => { d.trailersSalvos = []; });
    const legacyPretty = JSON.stringify(legacy, null, 2);
    re.map.set('trailersSalvos', legacyPretty);
    const plan = rs.planRecovery();
    assert.equal(plan.safe, true);
    assert.throws(() => rs.read(), /Recuperação/);
    re.fail(true);
    const quotaRecovery = JSON.stringify([...re.map]);
    await assert.rejects(rs.recover(plan.token), /preservado/);
    assert.equal(JSON.stringify([...re.map]), quotaRecovery);
    re.fail(false);
    await rs.recover(plan.token);
    assert.equal(rs.read().data.trailersSalvos.length, 0);
    assert.equal(re.map.get('trailersSalvos'), legacyPretty);
    // Caso ambíguo: registro novo de aba antiga. Bloqueia sem escolher cópia.
    re.map.set('trailersSalvos', JSON.stringify([...legacy, { trailer: 'NOVO-ANTIGO' }]));
    const unsafe = rs.planRecovery();
    assert.equal(unsafe.safe, false);
    const rawCopies = JSON.stringify([...re.map]);
    await assert.rejects(rs.recover(unsafe.token), /bloqueada/);
    assert.equal(JSON.stringify([...re.map]), rawCopies);
    const archive = rs.recoveryArchive();
    assert.equal(archive.legadoBruto.trailersSalvos, re.map.get('trailersSalvos'));
    assert.equal(archive.estadoAtualBruto, re.map.get('trailerLogEstadoV2'));
    bt.context.payload = JSON.stringify(archive);
    assert.throws(() => vm.runInContext('lerArquivoBackup(payload)', bt.context), /quatro coleções/);
    re.map.set('trailersSalvos', '{invalido');
    assert.equal(rs.planRecovery().safe, false);
    assert.equal(rs.recoveryArchive().legadoBruto.trailersSalvos, '{invalido');
    const damaged = environment({ trailerLogEstadoV2: '{estado-invalido', trailersSalvos: '{legado-invalido' });
    const ds = damaged.tab().store;
    const damagedBefore = JSON.stringify([...damaged.map]);
    assert.throws(() => ds.planRecovery(), /ler os registros/);
    assert.equal(ds.recoveryArchive().estadoAtualBruto, '{estado-invalido');
    assert.equal(JSON.stringify([...damaged.map]), damagedBefore);
    // As duas cópias equivalentes também podem ser reconhecidas após uma aba
    // antiga receber a versão atual; alteração posterior invalida a confirmação.
    re.map.set('trailersSalvos', '[]');
    const stalePlan = rs.planRecovery();
    assert.equal(stalePlan.safe, true);
    re.map.set('trucksCadastrados', '[]');
    await assert.rejects(rs.recover(stalePlan.token), /mudaram/);
    await rs.recover(rs.planRecovery().token);
    assert.equal(rs.read().conflict, false);
    // Formato V2 anterior continua legível; próxima gravação compacta apenas
    // metadados, mantendo dados, IDs e chaves originais.
    const oldId = 'legacy:' + JSON.stringify(['trailersSalvos', JSON.stringify(legacy[0]), 0]);
    const oldData = { ...empty(), trailersSalvos: [{ ...legacy[0], registroId: oldId }] };
    const oldLegacy = { trailersSalvos: JSON.stringify(legacy), trucksCadastrados: null, jornadaAtiva: null, jornadasSalvas: null };
    const oldRaw = JSON.stringify({ version: 2, revision: 8, legacy: oldLegacy, data: oldData });
    const ve = environment({ trailersSalvos: oldLegacy.trailersSalvos, trailerLogEstadoV2: oldRaw });
    const vs = ve.tab().store;
    assert.equal(ve.map.get('trailerLogEstadoV2'), oldRaw);
    assert.equal(vs.read().data.trailersSalvos[0].registroId, oldId);
    await vs.change(() => {});
    assert.equal(vs.read().data.trailersSalvos[0].registroId, oldId);
    assert.equal(JSON.parse(ve.map.get('trailerLogEstadoV2')).version, 3);
    assert.equal(ve.map.get('trailersSalvos'), oldLegacy.trailersSalvos);
    // A recuperação também atende ao formato V2 sem tocar em registros ou IDs.
    const vr = environment({ trailersSalvos: legacyPretty, trailerLogEstadoV2: oldRaw });
    const vrs = vr.tab().store;
    await vrs.recover(vrs.planRecovery().token);
    assert.equal(JSON.stringify(vrs.read().storedData), JSON.stringify(oldData));
    assert.equal(vr.map.get('trailersSalvos'), legacyPretty);
    // Volume: IDs de tamanho fixo e sem duplicação integral do legado no estado.
    const largeLegacy = Array.from({ length: 500 }, (_, i) => ({ trailer: String(i), observacoes: 'x'.repeat(500) }));
    const largeText = JSON.stringify(largeLegacy);
    const le = environment({ trailersSalvos: largeText });
    const ls = le.tab().store;
    await ls.change(() => {});
    const largeRaw = le.map.get('trailerLogEstadoV2');
    assert(ls.read().data.trailersSalvos.every(item => item.registroId.length < 120));
    assert(largeRaw.length < largeText.length * 1.3, 'estado compacto não duplica integralmente o legado');
    assert.equal(le.map.get('trailersSalvos'), largeText);
    console.log('Volume fictício: fonte=' + largeText.length + ', estado compacto=' + largeRaw.length + ' caracteres.');
    // Mensagens e recuperação cancelada na interface.
    const ce = environment({ trailersSalvos: JSON.stringify(legacy) });
    const ct = ce.tab();
    await ct.store.change(() => {});
    ce.map.set('trailersSalvos', legacyPretty);
    ct.context.document = { getElementById: () => status };
    ct.context.confirm = () => false;
    vm.runInContext(fs.readFileSync(path.join(root, 'backup.js'), 'utf8'), ct.context);
    const beforeCancel = JSON.stringify([...ce.map]);
    await vm.runInContext('verificarRecuperacao()', ct.context);
    assert.equal(JSON.stringify([...ce.map]), beforeCancel);
    assert.match(status.textContent, /cancelada/);
    ct.context.navigator.locks = null;
    await assert.rejects(ct.store.change(() => {}), /Chrome.*Safari.*HTTPS.*localhost/);
    ct.context.crypto = {};
    assert.throws(() => ct.store.id(), /Chrome.*Safari.*HTTPS/);
    // Sintaxe de todos os scripts principais, inclusive os inline.
    for (const name of ['sha256.js', 'storage.js', 'registros.js', 'backup.js']) new vm.Script(fs.readFileSync(path.join(root, name), 'utf8'));
    for (const name of ['index.html', 'historico.html', 'configuracoes.html']) {
        for (const match of fs.readFileSync(path.join(root, name), 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
    }
    console.log('PASSOU: concorrência, exclusão sem reaparecimento, IDs legados/duplicados, JSON inválido, quota atômica, finalização concorrente, conflitos, backup e sintaxe. Armazenamento fictício isolado.');
}
main().catch(error => { console.error(error); throw error; });
