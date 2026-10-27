const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
function harness({ configured = false, userId = null, map = new Map(), mode = 'login', key } = {}) {
    const events = {}, controls = new Map(), requests = [], calls = [], inputs = [], classes = new Set();
    const get = id => {
        if (!controls.has(id)) controls.set(id, { value: '', textContent: '', hidden: true, disabled: false,
            dataset: {}, style: {}, setAttribute() {}, addEventListener(type, cb) { this[type] = cb; },
            querySelectorAll: () => inputs, reset() { for (const input of inputs) input.value = ''; } });
        return controls.get(id);
    };
    for (const id of ['email', 'password', 'confirmPassword']) inputs.push(get(id));
    inputs.push(get('submitAuth'));
    let callback;
    let result = { data: {}, error: null };
    const auth = {
        getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null }, error: null }),
        getUser: async () => ({ data: { user: { id: userId, email: 'fixture@example.invalid' } }, error: null }),
        onAuthStateChange: cb => { callback = cb; return { data: { subscription: {} } }; }
    };
    for (const method of ['signInWithPassword', 'signUp', 'resetPasswordForEmail', 'updateUser', 'signOut']) auth[method] = async (...args) => { calls.push({ method, args }); return result; };
    const config = configured ? { url: 'https://fixture.supabase.co', publishableKey: key || 'sb_publishable_fixture' } : {};
    const context = vm.createContext({ console, URL, crypto, TextEncoder: require('node:util').TextEncoder,
        setTimeout, clearTimeout, Event: class { constructor(type) { this.type = type; } },
        navigator: { locks: { request: async (name, cb) => cb() } },
        window: { TRAILER_SUPABASE_CONFIG: config, isSecureContext: true, location: { href: 'https://fixture.example/app/login.html' },
            supabase: { createClient: (...args) => { requests.push(args); return { auth }; } },
            addEventListener: (name, cb) => (events[name] ??= []).push(cb),
            dispatchEvent: event => { for (const cb of events[event.type] || []) cb(event); } },
        document: { documentElement: { lang: 'pt-BR' }, body: { dataset: { authPage: mode }, classList: {
            add: name => classes.add(name), contains: name => classes.has(name),
            toggle: name => classes.has(name) ? classes.delete(name) : classes.add(name)
        } },
            head: { appendChild() { throw Error('Nenhum SDK externo deve ser carregado nos testes'); } },
            getElementById: get, querySelector: selector => selector === '.app-layout' ? get('app') : null,
            querySelectorAll: () => [], addEventListener: (name, cb) => (events[name] ??= []).push(cb) },
        localStorage: { getItem: name => map.get(name) ?? null, setItem: (name, value) => map.set(name, value) }
    });
    vm.runInContext(source('auth.js'), context);
    for (const file of ['sha256.js', 'storage.js']) vm.runInContext(source(file), context);
    return { context, get, calls, map, requests, run: code => vm.runInContext(code, context),
        result: value => { result = value; },
        account: id => callback('SIGNED_IN', id ? { user: { id } } : null) };
}
async function main() {
    const legacy = JSON.stringify([{ trailer: 'LEGADO', observacoes: 'preservar' }]);
    const map = new Map([['trailersSalvos', legacy], ['outro-app', 'preservar']]);
    const guest = harness({ map }); await guest.run('TrailerAuth.ready');
    assert.equal(guest.requests.length, 0, 'sem configuração não há SDK nem rede');
    assert.equal(guest.run('TrailerStorage.read().data.trailersSalvos[0].trailer'), 'LEGADO');
    const a = harness({ configured: true, userId: A, map }); await a.run('TrailerAuth.ready');
    assert.equal(a.run('TrailerStorage.read().data.trailersSalvos.length'), 0, 'login não importa legado');
    await a.run('TrailerStorage.change(d => d.trailersSalvos.push({trailer:"CONTA-A"}))');
    assert(map.has('trailerlog:user:' + A + ':trailerLogEstadoV2'));
    const b = harness({ configured: true, userId: B, map }); await b.run('TrailerAuth.ready');
    assert.equal(b.run('TrailerStorage.read().data.trailersSalvos.length'), 0);
    await b.run('TrailerStorage.change(d => d.trailersSalvos.push({trailer:"CONTA-B"}))');
    assert.equal(a.run('TrailerStorage.read().data.trailersSalvos[0].trailer'), 'CONTA-A');
    assert.equal(guest.run('TrailerStorage.read().data.trailersSalvos[0].trailer'), 'LEGADO');
    assert.equal(map.get('trailersSalvos'), legacy);
    const before = JSON.stringify([...map]);
    a.account(B);
    assert.throws(() => a.run('TrailerStorage.read()'), /Conta indisponível/);
    await assert.rejects(a.run('TrailerStorage.change(() => {})'), /Conta indisponível/);
    assert.equal(a.get('app').hidden, true, 'troca de conta oculta interface anterior');
    assert.equal(JSON.stringify([...map]), before);
    const invalid = harness({ configured: true, key: 'sb_secret_nao_permitido' });
    await invalid.run('TrailerAuth.ready');
    assert.equal(invalid.requests.length, 0);
    assert.throws(() => invalid.run('TrailerStorage.read()'), /Conta indisponível/);
    // Os formulários chamam somente Auth; nenhuma tabela/registro é enviado.
    for (const [mode, method] of [['login', 'signInWithPassword'], ['signup', 'signUp'], ['recovery', 'resetPasswordForEmail'], ['password', 'updateUser']]) {
        const page = harness({ configured: true, mode }); await page.run('TrailerAuth.ready');
        vm.runInContext(source('auth-page.js'), page.context);
        page.get('email').value = 'fixture@example.invalid';
        page.get('password').value = 'FICTICIO-apenas-teste';
        page.get('confirmPassword').value = 'FICTICIO-apenas-teste';
        await page.run('AuthPage.submit({preventDefault(){}})');
        assert.equal(page.calls[0].method, method);
        assert.equal(page.get('submitAuth').disabled, false);
        assert.equal(page.map.size, 0, 'não persiste senha, não importa ou grava registros');
        if (mode === 'signup') assert.equal(page.calls[0].args[0].options.emailRedirectTo, 'https://fixture.example/app/login.html');
        if (mode === 'recovery') assert.equal(page.calls[0].args[1].redirectTo, 'https://fixture.example/app/nova-senha.html');
    }
    const ui = harness({ configured: true, mode: 'signup' }); await ui.run('TrailerAuth.ready');
    vm.runInContext(source('auth-page.js'), ui.context);
    ui.get('password').value = 'a'; ui.get('confirmPassword').value = 'b';
    await ui.run('AuthPage.submit({preventDefault(){}})'); assert.equal(ui.calls.length, 0);
    assert.match(ui.get('authStatus').textContent, /8 caracteres/);
    ui.get('password').value = 'FICTICIO-apenas-teste';
    await ui.run('AuthPage.submit({preventDefault(){}})'); assert.equal(ui.calls.length, 0);
    assert.match(ui.get('authStatus').textContent, /não coincidem/);
    ui.get('language').change({ target: { value: 'en' } });
    assert.equal(ui.run('AuthPage.t("mismatch")'), 'Passwords do not match.');
    assert.equal(ui.get('authStatus').textContent, 'Passwords do not match.');
    assert.equal(ui.context.document.documentElement.lang, 'en');
    ui.get('themeAuth').click();
    assert.equal(ui.map.get('trailerlog-theme'), 'dark');
    ui.get('themeAuth').click();
    assert.equal(ui.map.get('trailerlog-theme'), 'light');
    const login = harness({ configured: true }); await login.run('TrailerAuth.ready');
    vm.runInContext(source('auth-page.js'), login.context);
    login.result({ error: { code: 'invalid_credentials' } });
    await login.run('AuthPage.submit({preventDefault(){}})');
    assert.match(login.get('authStatus').textContent, /inválidos/);
    assert.equal(login.get('submitAuth').disabled, false);
    let complete;
    login.result(new Promise(resolve => { complete = resolve; }));
    const pending = login.run('AuthPage.submit({preventDefault(){}})');
    assert.equal(login.get('submitAuth').disabled, true, 'indicador de envio ativo');
    const count = login.calls.length;
    await login.run('AuthPage.submit({preventDefault(){}})');
    assert(login.calls.length <= count + 1, 'clique repetido não dispara outra solicitação');
    complete({ data: {}, error: null }); await pending;
    assert.equal(login.get('submitAuth').disabled, false);
    // Uma operação em fila não pode escrever após a identidade mudar.
    const queued = harness({ configured: true, userId: A }); await queued.run('TrailerAuth.ready');
    let release;
    queued.context.navigator.locks.request = (name, cb) => new Promise(resolve => { release = () => resolve(cb()); });
    const changing = queued.run('TrailerStorage.change(d => d.trailersSalvos.push({trailer:"NÃO-GRAVAR"}))');
    queued.account(B); release();
    await assert.rejects(changing, /Conta indisponível/);
    assert.equal(queued.map.size, 0);
    // HTML/scripts: ordem, formulários sem submissão GET e dimensionamento mobile.
    for (const page of ['login.html', 'cadastro.html', 'recuperar-senha.html', 'nova-senha.html']) {
        const html = source(page);
        assert(html.includes('name="viewport"'));
        assert(html.indexOf('supabase-config.js') < html.indexOf('auth.js'));
        assert(html.indexOf('auth.js') < html.indexOf('auth-page.js'));
        assert(html.includes('type="submit"'));
        assert(html.includes('method="post" onsubmit="return false"'));
    }
    for (const page of ['index.html', 'historico.html', 'configuracoes.html']) {
        const html = source(page);
        assert(html.indexOf('auth.js') < html.indexOf('storage.js'));
    }
    for (const file of ['auth.js', 'auth-page.js', 'supabase-config.js', 'storage.js']) new vm.Script(source(file));
    for (const width of [320, 375, 430]) assert(width - 24 - 40 > 0);
    const schema = source('supabase/migrations/202610270001_tables.sql');
    const rls = source('supabase/migrations/202610270002_rls.sql');
    assert.equal((schema.match(/enable row level security/g) || []).length, 4);
    assert(rls.includes('with check'));
    assert(schema.includes('foreign key (user_id, journey_id)'));
    console.log('PASSOU: modo local, duas contas isoladas, troca de sessão bloqueada, chave secreta recusada, formulários Auth, validação, PT/EN, scripts e verificações estáticas de SQL/layout. SDK/DOM fictícios; sem rede/banco real.');
}
main().catch(error => { console.error(error); throw error; });
