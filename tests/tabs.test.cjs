// Duas abas e eventos storage simulados; nenhum navegador/localStorage real é acessado.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
async function main() {
    const owner = '10000000-0000-4000-8000-000000000001';
    const prefix = 'trailerlog:user:' + owner + ':';
    const logicalKey = key => { assert(key.startsWith(prefix), 'acesso sem conta'); return key.slice(prefix.length); };
    const data = new Map(), tabs = [], events = [];
    let queue = Promise.resolve();
    const locks = { request: (name, callback) => {
        const promise = queue.then(callback); queue = promise.catch(() => {}); return promise;
    } };
    function tab(kind) {
        const handlers = {}, docHandlers = {}, controls = new Map(), messages = [];
        const element = () => ({ value: '', style: {}, hidden: true, textContent: '', innerHTML: '',
            selectedIndex: 0, selectedOptions: [{ text: 'Bom' }], classList: { toggle() {} }, focus() {} });
        const get = id => { if (!controls.has(id)) controls.set(id, element()); return controls.get(id); };
        const fire = event => {
            if (event.type === 'storage' && event.key !== null && !event.key.startsWith(prefix)) event = { ...event, key: prefix + event.key };
            for (const callback of handlers[event.type] || []) callback(event);
        };
        const context = vm.createContext({ console, crypto, TextEncoder: require('node:util').TextEncoder,
            TrailerAuth: { configured: true, scope: () => owner, authorize: async expected => { assert.equal(expected, owner); },
                ready: { then(fn) { fn(); } } },
            Event: class { constructor(type) { this.type = type; } },
            navigator: { locks },
            window: { addEventListener: (type, fn) => (handlers[type] ??= []).push(fn), dispatchEvent: fire },
            document: { getElementById: get, querySelector: () => get('startButton'), visibilityState: 'visible',
                addEventListener: (type, fn) => (docHandlers[type] ??= []).push(fn) },
            localStorage: { getItem: key => data.get(logicalKey(key)) ?? null, setItem: (key, value) => {
                const previous = data.get(logicalKey(key)); data.set(logicalKey(key), value);
                if (previous !== value) for (const other of tabs) if (other.context !== context) events.push(() => other.fire({ type: 'storage', key }));
            } },
            mostrarModal: message => messages.push(message), alert: message => messages.push(message), confirm: () => true
        });
        for (const file of ['sha256.js', 'storage.js']) vm.runInContext(source(file), context);
        if (kind === 'registrar') {
            get('condition').selectedOptions = [{ text: 'Vazio' }];
            get('truckCondition').value = 'Bom';
            vm.runInContext(source('registros.js'), context);
            vm.runInContext('var renders = 0; var renderOriginal = exibirJornada; exibirJornada = (...args) => { renders++; return renderOriginal(...args); }', context);
        } else {
            const html = source(kind === 'historico' ? 'historico.html' : 'configuracoes.html');
            if (kind === 'config') vm.runInContext(source('backup.js'), context);
            vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
        }
        const result = { context, fire, get, messages, run: code => vm.runInContext(code, context),
            ready: () => { for (const fn of docHandlers.DOMContentLoaded || []) fn(); },
            visible: () => { for (const fn of docHandlers.visibilitychange || []) fn(); } };
        tabs.push(result); result.ready(); return result;
    }
    const flush = () => { while (events.length) events.shift()(); };
    const a = tab('registrar'), b = tab('registrar'), history = tab('historico'), config = tab('config');
    history.run('tipoHistorico="truck"'); history.get('campoPesquisa').value = '10'; history.run('mostrarHistorico()');
    a.get('truck').value = '10'; a.get('trailer').value = '20';
    await a.run('iniciarJornada()'); flush();
    assert.match(b.get('saida').textContent, /Caminhão: 10.*Trailer: 20/);
    assert.equal(b.get('startButton').style.display, 'none');
    assert.equal(b.get('btnFinalizarJornada').style.display, 'block');
    assert.equal(b.get('avisoAtualizacao').hidden, true);
    assert.match(history.get('historico').innerHTML, /Em andamento/);
    assert.equal(b.messages.length, 0);
    a.get('trailer').value = '30'; await a.run('trocarTrailer()'); flush();
    assert.match(b.get('saida').textContent, /Trailer: 30/);
    assert.match(history.get('historico').innerHTML, /30/);
    // Eventos repetidos e retorno ao foco sem mudança não redesenham a interface.
    const renders = b.run('renders');
    for (let i = 0; i < 4; i++) b.fire({ type: 'storage', key: 'trailerLogEstadoV2' });
    b.fire({ type: 'focus' }); b.visible();
    assert.equal(b.run('renders'), renders);
    // Um formulário parcial permanece intacto quando a outra aba finaliza.
    b.get('trailer').value = 'RASCUNHO'; b.get('observacoesTruck').value = '  texto não salvo  ';
    const draft = b.run('assinaturaFormulario()');
    await a.run('TrailerStorage.change(() => {})'); flush();
    assert.equal(b.get('avisoAtualizacao').hidden, true, 'somente revisão de metadados não dispara aviso');
    await a.run('finalizarJornada()'); flush();
    assert.equal(b.run('assinaturaFormulario()'), draft);
    assert.equal(b.get('avisoAtualizacao').hidden, false);
    assert.equal(b.get('btnFinalizarJornada').style.display, 'none');
    assert.equal(b.get('startButton').style.display, 'block');
    assert.match(history.get('historico').innerHTML, /Finalizada/);
    const before = JSON.stringify([...data]);
    await b.run('trocarTrailer()');
    assert.equal(JSON.stringify([...data]), before, 'edição pendente não grava sobre novo estado');
    b.run('continuarEditando()');
    assert.equal(b.get('btnContinuarEditando').hidden, true);
    assert.equal(b.run('assinaturaFormulario()'), draft);
    a.get('truck').value = '40'; await a.run('iniciarJornada()'); flush();
    assert.match(b.get('saida').textContent, /Caminhão: 40/);
    assert.equal(b.get('btnContinuarEditando').hidden, true, 'não repete oferta já respondida');
    assert.equal(b.run('assinaturaFormulario()'), draft);
    b.run('aceitarAtualizacao()');
    assert.equal(b.get('avisoAtualizacao').hidden, true);
    assert.equal(b.run('assinaturaFormulario()'), draft, 'Atualizar também preserva rascunho');
    assert.equal(b.run('jornadaExibida'), a.run('jornadaExibida'));
    // Uma seleção de arquivo não é descartada, e limpeza antiga perde validade.
    config.get('arquivoBackup').value = 'backup-ficticio.json';
    config.run('abrirConfirmacao()');
    a.get('trailer').value = '50'; await a.run('trocarTrailer()'); flush();
    assert.equal(config.get('arquivoBackup').value, 'backup-ficticio.json');
    assert.equal(config.run('tokenLimpeza'), null);
    assert.match(config.get('statusBackup').textContent, /confirmação de limpeza foi cancelada/);
    // Se os registros mudarem durante a leitura do arquivo, preserva a seleção
    // e aguarda Atualizar antes de apresentar a confirmação da restauração.
    let finishRead;
    const fileInput = config.get('arquivoBackup');
    fileInput.files = [{ text: () => new Promise(resolve => { finishRead = resolve; }) }];
    const restoring = config.run('restaurarBackup(document.getElementById("arquivoBackup"))');
    a.get('trailer').value = '60'; await a.run('trocarTrailer()'); flush();
    assert.equal(config.get('avisoAtualizacaoBackup').hidden, false);
    const exportData = a.run('TrailerStorage.read().data');
    finishRead(JSON.stringify({ aplicativo: 'Trailer Log', versao: 1, dados: exportData }));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(config.run('atualizacaoBackupPendente'), true);
    config.run('continuarEditandoBackup()');
    assert.equal(fileInput.value, 'backup-ficticio.json');
    config.run('aceitarAtualizacaoBackup()');
    await restoring; flush();
    assert.match(config.get('statusBackup').textContent, /restaurado com sucesso/);
    assert.equal(fileInput.disabled, false);
    // Digitação enquanto o lock aguarda não pode ser apagada após o salvamento.
    const originalRequest = locks.request;
    let releaseLock;
    const gate = new Promise(resolve => { releaseLock = resolve; });
    locks.request = (name, callback) => gate.then(() => originalRequest(name, callback));
    a.get('trailer').value = '70';
    const swapping = a.run('trocarTrailer()');
    a.get('trailer').value = 'RASCUNHO-DURANTE-SALVAMENTO';
    releaseLock(); await swapping; locks.request = originalRequest; flush();
    assert.equal(a.get('trailer').value, 'RASCUNHO-DURANTE-SALVAMENTO');
    // Aba suspensa recupera o estado ao voltar, mesmo sem receber storage.
    const clean = tab('registrar');
    await a.run('finalizarJornada()'); events.length = 0;
    clean.fire({ type: 'focus' });
    assert.equal(clean.get('btnFinalizarJornada').style.display, 'none');
    assert.equal(clean.get('startButton').style.display, 'block');
    // Erros externos não são repetidos nem provocam gravações de recuperação.
    const errorBefore = clean.messages.length;
    const originalLegacy = data.get('trailersSalvos');
    data.set('trailersSalvos', '{invalido');
    clean.fire({ type: 'storage', key: 'trailersSalvos' }); clean.fire({ type: 'focus' });
    assert.equal(clean.messages.length, errorBefore + 1);
    const conflicted = JSON.stringify([...data]);
    await clean.run('iniciarJornada()');
    assert.equal(JSON.stringify([...data]), conflicted);
    const rendersBeforeRepair = clean.run('renders');
    if (originalLegacy === undefined) data.delete('trailersSalvos'); else data.set('trailersSalvos', originalLegacy);
    clean.fire({ type: 'focus' });
    assert.equal(clean.run('renders'), rendersBeforeRepair + 1, 'reparo para o mesmo token anterior atualiza novamente');
    console.log('PASSOU: duas abas simuladas, início/troca/finalização, histórico automático, rascunho preservado, Atualizar/Continuar editando, deduplicação, retorno do foco, configurações e conflitos.');
}
main().catch(error => { console.error(error); throw error; });
