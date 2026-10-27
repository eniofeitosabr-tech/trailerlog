// Autenticação, SDK, relógio e armazenamento fictícios; sem rede/Supabase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
const sessionFor = id => ({ access_token: 'fixture-access', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id } });
const prefix = id => 'trailerlog:user:' + id + ':';
const base = 'https://fixture.example/trailerlog/';
function harness({ page = 'index.html', id = null, configured = true, map = new Map(), expired = false,
    getUserError = null, signoutError = null, stalled = false, metadataWriteFails = false } = {}) {
    const events = {}, docEvents = {}, timers = new Map(), nodes = new Map(), navigations = [], calls = [], readKeys = [];
    let session = id ? sessionFor(id) : null, callback, releaseUser, releaseLock;
    if (expired) session.expires_at = 0;
    const node = key => {
        if (!nodes.has(key)) nodes.set(key, { hidden: key !== 'appCarregando', textContent: '', addEventListener() {} });
        return nodes.get(key);
    };
    const fire = event => { for (const listener of events[event.type] || []) listener(event); };
    const auth = {
        async getSession() { calls.push('session'); return { data: { session }, error: null }; },
        async getUser() {
            calls.push('verify');
            if (stalled) return new Promise(resolve => { releaseUser = resolve; });
            return { data: { user: session && session.user }, error: getUserError };
        },
        onAuthStateChange(fn) { callback = fn; },
        async signOut() {
            calls.push('signout');
            if (!signoutError) { session = null; callback('SIGNED_OUT', null); }
            return { error: signoutError };
        },
        async signInWithPassword() {
            calls.push('login'); session = sessionFor(A); callback('SIGNED_IN', session);
            return { data: { session }, error: null };
        }
    };
    const context = vm.createContext({ URL, URLSearchParams, crypto, TextEncoder: require('node:util').TextEncoder,
        setTimeout(fn, ms) { const key = {}; timers.set(key, { fn, ms }); return key; },
        clearTimeout(key) { timers.delete(key); },
        Event: class { constructor(type) { this.type = type; } },
        localStorage: { getItem(key) { readKeys.push(key); return map.get(key) ?? null; },
            setItem(key, value) { if (metadataWriteFails && key === 'trailerlog-auth-logout') throw Error('Quota fictícia'); map.set(key, value); },
            removeItem: key => map.delete(key) },
        navigator: { onLine: true, locks: { request: async (_, fn) => fn() } },
        document: { documentElement: { lang: 'pt-BR' }, visibilityState: 'visible',
            getElementById: node, querySelector: () => node('app'), querySelectorAll: () => [],
            addEventListener(name, fn) { (docEvents[name] ??= []).push(fn); } },
        window: { location: { href: base + page, replace(url) { navigations.push(url); } },
            isSecureContext: true, TRAILER_SUPABASE_CONFIG: configured ? { url: 'https://fixture.supabase.co', publishableKey: 'sb_publishable_fixture' } : {},
            supabase: { createClient() { return { auth }; } }, addEventListener(name, fn) { (events[name] ??= []).push(fn); }, dispatchEvent: fire }
    });
    const run = code => vm.runInContext(code, context);
    if (!/login|cadastro|recuperar-senha|nova-senha|sobre/.test(page)) run(source('app-startup.js'));
    run(source('auth.js')); run(source('sha256.js')); run(source('storage.js'));
    return { run, node, navigations, map, readKeys, calls, context, fire,
        ready: () => run('TrailerAuth.ready'),
        failVerification(error) { getUserError = error; },
        expireVerification() { for (const [key, timer] of [...timers]) if (timer.ms === 12000) { timers.delete(key); timer.fn(); } },
        releaseUser() { releaseUser({ data: { user: { id: A } }, error: null }); },
        switchTo(id) { session = id ? sessionFor(id) : null; callback(id ? 'SIGNED_IN' : 'SIGNED_OUT', session); },
        visibility(state) {
            context.document.visibilityState = state;
            for (const listener of docEvents.visibilitychange || []) listener();
        },
        holdLock() { context.navigator.locks.request = (_, fn) => new Promise(resolve => { releaseLock = () => resolve(fn()); }); },
        unlock() { releaseLock(); },
        hasLock: () => !!releaseLock,
        setSignoutError(error) { signoutError = error; }
    };
}
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
async function denied(h) {
    assert.throws(() => h.run('TrailerStorage.read()'));
    assert.throws(() => h.run('TrailerStorage.recoveryArchive()'));
    assert.throws(() => h.run('TrailerStorage.planRecovery()'));
    await assert.rejects(h.run('TrailerStorage.change(() => {})'));
    await assert.rejects(h.run('TrailerStorage.recover("fixture")'));
}
async function main() {
    const focusing = harness({ id: A }); await focusing.ready();
    focusing.run('var syncErrors = []; var firstRenders = 0; TrailerStorage.subscribe(() => { firstRenders++; }, error => syncErrors.push(error.message))');
    await flush();
    focusing.fire({ type: 'focus' });
    assert.throws(() => focusing.run('TrailerAuth.scope()'), 'leituras diretas continuam bloqueadas durante a revalidação');
    assert.equal(focusing.run('syncErrors.length'), 0, 'foco não deve tratar verificação em andamento como falha de conta');
    await flush();
    assert.equal(focusing.run('TrailerAuth.scope()'), A);
    focusing.visibility('hidden'); focusing.visibility('visible');
    assert.equal(focusing.run('syncErrors.length'), 0, 'retorno de aba não deve emitir erro transitório');
    await flush();
    assert.equal(focusing.run('firstRenders'), 1, 'foco não deve duplicar nem invalidar a leitura inicial');
    assert.equal(focusing.node('app').hidden, false);
    const initialFocus = harness({ id: A }); await initialFocus.ready();
    initialFocus.run('TrailerStorage.subscribe(() => {}, () => {})');
    initialFocus.fire({ type: 'focus' }); await flush();
    assert.equal(initialFocus.node('app').hidden, false, 'primeira assinatura durante revalidação deve retomar ao concluir');
    const legacy = JSON.stringify([{ trailer: 'GLOBAL-NAO-IMPORTAR' }]);
    for (const page of ['index.html', 'historico.html', 'configuracoes.html']) {
        const visitor = harness({ page, map: new Map([['trailersSalvos', legacy]]) });
        await visitor.ready(); await denied(visitor);
        assert.deepEqual(visitor.navigations, [base + 'login.html']);
        assert.equal(visitor.node('app').hidden, true);
        assert.equal(visitor.map.get('trailersSalvos'), legacy);
        assert(!visitor.readKeys.some(key => key.startsWith('trailerlog:user:') || key === 'trailersSalvos'));
        const html = source(page);
        assert(html.includes('<div class="app-layout" hidden>'));
        assert(html.includes('data-auth-logout'));
        assert(html.includes('Tentar novamente'));
    }
    for (const page of ['login.html', 'cadastro.html', 'recuperar-senha.html']) {
        const publicPage = harness({ page }); await publicPage.ready();
        assert.equal(publicPage.navigations.length, 0, 'não redirecionar os formulários públicos');
        await denied(publicPage);
    }
    const missing = harness({ configured: false }); await missing.ready(); await denied(missing);
    assert.equal(missing.node('appFalhou').hidden, false);
    const expired = harness({ id: A, expired: true }); await expired.ready(); await denied(expired);
    assert.deepEqual(expired.navigations, [base + 'login.html']);
    const invalid = harness({ id: A, getUserError: { status: 401, code: 'bad_jwt' } });
    await invalid.ready(); await denied(invalid);
    assert.deepEqual(invalid.navigations, [base + 'login.html']);
    const offline = harness({ id: A, getUserError: Error('rede fictícia indisponível') });
    await offline.ready(); await denied(offline);
    assert.equal(offline.node('appFalhou').hidden, false);
    assert.equal(offline.navigations.length, 0, 'falha de rede não deve virar visitante/mode local');
    const timeout = harness({ id: A, stalled: true }); await flush();
    timeout.expireVerification(); await timeout.ready(); await denied(timeout);
    timeout.releaseUser(); await flush();
    assert.equal(timeout.node('app').hidden, true, 'resposta tardia não libera dados');
    const race = harness({ id: A, stalled: true }); await flush();
    race.switchTo(B); race.releaseUser(); await race.ready(); await denied(race);
    assert.deepEqual(race.navigations, [base + 'login.html'], 'não aceitar resposta da conta anterior durante a inicialização');
    assert(!race.readKeys.some(key => key.startsWith('trailerlog:user:')));

    const map = new Map([['trailersSalvos', legacy],
        [prefix(A) + 'trailersSalvos', JSON.stringify([{ trailer: 'CONTA-A' }])],
        [prefix(B) + 'trailersSalvos', JSON.stringify([{ trailer: 'CONTA-B' }])]]);
    const a = harness({ id: A, map });
    assert.equal(a.node('app').hidden, true);
    await a.ready();
    assert.equal(a.node('app').hidden, true, 'validar sessão não dispensa a primeira renderização');
    a.run('TrailerStorage.subscribe(() => {}, () => {})'); await flush();
    assert.equal(a.node('app').hidden, false);
    assert.equal(a.run('TrailerStorage.read().data.trailersSalvos[0].trailer'), 'CONTA-A');
    const b = harness({ id: B, map }); await b.ready();
    assert.equal(b.run('TrailerStorage.read().data.trailersSalvos[0].trailer'), 'CONTA-B');
    assert(!a.readKeys.includes(prefix(B) + 'trailersSalvos'));
    assert(!b.readKeys.includes(prefix(A) + 'trailersSalvos'));
    assert.equal(map.get('trailersSalvos'), legacy);
    const cached = harness({ id: A, map }); await cached.ready();
    cached.run(source('historico.html').match(/<script>([\s\S]*?)<\/script>/)[1]);
    cached.run('snapshotHistorico = TrailerStorage.read()');
    assert.equal(cached.run('carregarLista("trailersSalvos")[0].trailer'), 'CONTA-A');
    cached.switchTo(B);
    assert.equal(cached.run('snapshotHistorico'), null, 'descartar somente cache de leitura, sem alterar registros');
    assert.throws(() => cached.run('carregarLista("trailersSalvos")'));
    const resumed = harness({ id: A }); await resumed.ready();
    resumed.fire({ type: 'pagehide' }); await denied(resumed);
    resumed.fire({ type: 'pageshow' }); await flush();
    assert.equal(resumed.run('TrailerAuth.scope()'), A);
    resumed.context.navigator.onLine = false;
    resumed.fire({ type: 'offline' }); await denied(resumed);
    assert.equal(resumed.node('appFalhou').hidden, false);
    const c = harness({ id: A, page: 'login.html', map }); await c.ready();
    assert.deepEqual(c.navigations, [base + 'index.html']);
    const login = harness({ page: 'login.html' }); await login.ready();
    await login.run('TrailerAuth.login("fixture@example.invalid", "FICTICIO-apenas-teste")');
    assert.deepEqual(login.navigations, [base + 'index.html']);

    const before = JSON.stringify([...map]);
    a.holdLock();
    const queued = a.run('TrailerStorage.change(d => d.trailersSalvos.push({trailer:"NÃO-GRAVAR"}))');
    await flush(); assert(a.hasLock());
    a.switchTo(B); a.unlock(); await assert.rejects(queued); await denied(a);
    assert.equal(JSON.stringify([...map]), before);
    assert.equal(a.node('app').hidden, true);

    const live = harness({ id: A, map }); await live.ready();
    live.failVerification(Error('rede fictícia indisponível'));
    const snapshot = JSON.stringify([...map]);
    await assert.rejects(live.run('TrailerStorage.change(() => {})'));
    assert.equal(JSON.stringify([...map]), snapshot);
    await denied(live);
    const logout = harness({ id: A, map }); await logout.ready();
    const signingOut = logout.run('TrailerAuth.logout()'); await denied(logout); await signingOut;
    assert.equal(logout.calls.filter(call => call === 'signout').length, 1);
    assert.deepEqual(logout.navigations, [base + 'login.html']);
    assert.equal(map.get('trailersSalvos'), legacy);
    assert.equal(map.get(prefix(A) + 'trailersSalvos'), JSON.parse(before).find(([key]) => key === prefix(A) + 'trailersSalvos')[1]);

    const failed = harness({ id: A, map, signoutError: Error('logout indisponível fictício') }); await failed.ready();
    await assert.rejects(failed.run('TrailerAuth.logout()')); await denied(failed);
    assert.equal(map.get('trailerlog-auth-logout'), '1');
    const otherTab = harness({ id: B }); await otherTab.ready();
    otherTab.fire({ type: 'storage', key: 'trailerlog-auth-logout', newValue: '1' }); await denied(otherTab);
    const retry = harness({ id: A, map }); await retry.ready(); await denied(retry);
    assert(retry.calls.includes('signout'), 'recarregar deve concluir logout pendente, sem reabrir a conta');
    assert.deepEqual(retry.navigations, [base + 'login.html']);
    assert(!map.has('trailerlog-auth-logout'));
    const quota = harness({ id: A, metadataWriteFails: true }); await quota.ready();
    await quota.run('TrailerAuth.logout()');
    assert(quota.calls.includes('signout'), 'quota no marcador não deve impedir revogação pelo SDK');
    assert.deepEqual(quota.navigations, [base + 'login.html']);

    const absent = vm.createContext({ window: { addEventListener() {} }, navigator: {},
        localStorage: { getItem() { throw Error('Leitura de registros sem autenticação'); } } });
    vm.runInContext(source('storage.js'), absent);
    assert.throws(() => vm.runInContext('TrailerStorage.read()', absent), /Autenticação obrigatória/);
    console.log('PASSOU: login obrigatório, páginas públicas, sessão válida/inválida, timeout, outage, namespaces, legado preservado, revalidação de gravações, fila e troca de contas, logout imediato, broadcast e retry seguro. Sem rede/Supabase.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
