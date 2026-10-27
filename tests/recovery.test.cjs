// SDK/DOM fictícios: não envia e-mails, senhas nem solicitações reais.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const base = 'https://fixture.example/trailerlog/';
// Strings sintéticas; nunca usar um link de recuperação real em testes.
const link = '#access_token=fixture-access&refresh_token=fixture-refresh&type=recovery';
const session = { access_token: 'fixture-access', user: { id: A } };
function harness({ page = 'nova-senha.html', suffix = link, emit = true, verified = A,
    serverError = null, updateError = null, signoutError = null, stall = false } = {}) {
    const calls = [], navigations = [], timers = new Map(), events = {}, nodes = new Map();
    const records = new Map([['trailersSalvos', 'preservar'], ['trailerlog-auth-session', 'sessão normal fictícia']]);
    let listener, options;
    const get = id => {
        if (!nodes.has(id)) nodes.set(id, { value: '', hidden: true, disabled: false, textContent: '',
            setAttribute() {}, addEventListener() {}, reset() {},
            querySelectorAll: () => ['password', 'confirmPassword', 'submitAuth'].map(get) });
        return nodes.get(id);
    };
    const location = { href: base + page + suffix,
        replace(url) { navigations.push(url); } };
    const auth = {
        onAuthStateChange(fn) { calls.push('subscribe'); listener = fn; },
        async getSession() {
            calls.push('session');
            assert(listener, 'inscrição precisa anteceder a inicialização da sessão');
            if (emit) listener('PASSWORD_RECOVERY', session);
            if (stall) return new Promise(() => {});
            return { data: { session: page === 'recuperar-senha.html' ? null : session }, error: null };
        },
        async getUser(token) {
            calls.push('verify'); assert.equal(token, session.access_token);
            return { data: { user: { id: verified } }, error: serverError };
        },
        async updateUser() { calls.push('update'); return { data: { user: { id: A } }, error: updateError }; },
        async signOut(params) { calls.push('signout'); assert.equal(params.scope, 'local');
            if (!signoutError) listener('SIGNED_OUT', null);
            return { error: signoutError }; },
        async resetPasswordForEmail(email, params) {
            calls.push('reset'); assert.equal(params.redirectTo, base + 'nova-senha.html');
            return { error: null };
        }
    };
    const context = vm.createContext({ URL, URLSearchParams, console,
        Event: class { constructor(type) { this.type = type; } },
        setTimeout(fn, ms) { const id = {}; timers.set(id, { fn, ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        localStorage: { getItem: key => records.get(key) ?? null, setItem() { throw Error('Sem gravação permitida'); } },
        document: { documentElement: { lang: 'pt-BR' }, body: {
            dataset: { authPage: page === 'nova-senha.html' ? 'password' : 'recovery' },
            classList: { add() {}, contains() { return false; } } },
            getElementById: get, querySelector: () => get('app'), querySelectorAll: () => [], addEventListener() {} },
        window: { location, history: { replaceState(_, __, url) { location.href = url; } },
            isSecureContext: true, TRAILER_SUPABASE_CONFIG: {
                url: 'https://fixture.supabase.co', publishableKey: 'sb_publishable_fixture'
            }, supabase: { createClient(_, __, opts) { calls.push('client'); options = opts; return { auth }; } },
            addEventListener(name, fn) { (events[name] ??= []).push(fn); },
            dispatchEvent(event) { for (const fn of events[event.type] || []) fn(event); } }
    });
    const run = code => vm.runInContext(code, context);
    run(source('auth.js'));
    return { run, calls, records, navigations, get, location, options: () => options,
        ready: () => run('TrailerAuth.ready'), ui: () => run(source('auth-page.js')),
        signoutError(value) { signoutError = value; },
        verifyError(value) { serverError = value; },
        expire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } },
        change(id) { listener('SIGNED_IN', { user: { id } }); } };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function main() {
    const valid = harness(); valid.ui();
    assert.equal(valid.get('submitAuth').disabled, true);
    await valid.ready(); await flush();
    assert.equal(valid.run('TrailerAuth.recoveryReady'), true);
    assert.equal(valid.get('submitAuth').disabled, false);
    assert.equal(valid.location.href, base + 'nova-senha.html', 'tokens removidos da URL');
    assert.equal(valid.options().auth.persistSession, false);
    assert.equal(valid.options().auth.autoRefreshToken, false);
    assert.equal(valid.options().auth.storageKey, 'trailerlog-password-recovery');
    assert.throws(() => valid.run('TrailerAuth.scope()'), /Conta indisponível/);
    const before = JSON.stringify([...valid.records]);
    valid.get('password').value = valid.get('confirmPassword').value = 'FICTICIO-apenas-teste';
    await valid.run('AuthPage.submit({preventDefault(){}})');
    assert.deepEqual(valid.calls, ['client', 'subscribe', 'session', 'verify', 'verify', 'update', 'signout']);
    assert.deepEqual(valid.navigations, [base + 'login.html']);
    assert.equal(valid.run('TrailerAuth.recoveryReady'), false);
    assert.equal(valid.get('openApp').hidden, true);
    assert.equal(JSON.stringify([...valid.records]), before);

    for (const page of ['index.html', 'historico.html', 'login.html']) {
        const wrong = harness({ page }); await wrong.ready();
        assert.deepEqual(wrong.navigations, [base + 'nova-senha.html' + link]);
        assert.equal(wrong.calls.length, 0, 'tokens não são consumidos na página errada');
        assert.equal(wrong.get('app').hidden, true);
        assert.throws(() => wrong.run('TrailerAuth.scope()'), /Conta indisponível/);
    }
    for (const opts of [
        { suffix: '' }, // sessão normal preexistente não autoriza recuperação
        { suffix: '#error=access_denied&error_code=otp_expired' },
        { serverError: { code: 'bad_jwt' } },
        { verified: B }
    ]) {
        const invalid = harness(opts); invalid.ui(); await invalid.ready(); await flush();
        assert.equal(invalid.run('TrailerAuth.recoveryReady'), false);
        assert.equal(invalid.get('submitAuth').disabled, true);
        assert.equal(invalid.location.href, base + 'nova-senha.html');
        await assert.rejects(invalid.run('TrailerAuth.updatePassword("FICTICIO-apenas-teste")'));
        assert(!invalid.calls.includes('update'));
        assert(!invalid.calls.includes('signout'));
        assert.equal(invalid.navigations.length, 0);
    }
    for (const opts of [{ emit: false }, { stall: true }]) {
        const slow = harness(opts); await flush(); slow.expire(); await slow.ready();
        assert.equal(slow.run('TrailerAuth.recoveryReady'), false);
        assert(!slow.calls.includes('update'));
        assert.equal(slow.location.href, base + 'nova-senha.html');
    }
    const swapped = harness(); await swapped.ready(); swapped.change(B);
    await assert.rejects(swapped.run('TrailerAuth.updatePassword("FICTICIO-apenas-teste")'));
    assert(!swapped.calls.includes('update'));
    const expiredLater = harness(); await expiredLater.ready();
    expiredLater.verifyError({ code: 'bad_jwt' });
    await assert.rejects(expiredLater.run('TrailerAuth.updatePassword("FICTICIO-apenas-teste")'));
    assert(!expiredLater.calls.includes('update'), 'revalidar no servidor antes de alterar a senha');
    assert.equal(expiredLater.run('TrailerAuth.recoveryReady'), false);
    const failedUpdate = harness({ updateError: { code: 'weak_password' } }); await failedUpdate.ready();
    await assert.rejects(failedUpdate.run('TrailerAuth.updatePassword("FICTICIO-apenas-teste")'));
    assert(!failedUpdate.calls.includes('signout'));
    assert.equal(failedUpdate.navigations.length, 0);
    const failedSignout = harness({ signoutError: { code: 'network_error' } }); await failedSignout.ready();
    await assert.rejects(failedSignout.run('TrailerAuth.updatePassword("FICTICIO-apenas-teste")'));
    assert.equal(failedSignout.navigations.length, 0, 'não indicar conclusão se o encerramento falhou');
    failedSignout.signoutError(null);
    await failedSignout.run('TrailerAuth.updatePassword("FICTICIO-apenas-teste")');
    assert.equal(failedSignout.calls.filter(call => call === 'update').length, 1, 'retry só encerra a sessão');
    assert.deepEqual(failedSignout.navigations, [base + 'login.html']);
    const request = harness({ page: 'recuperar-senha.html', suffix: '', emit: false });
    // Sessão vazia na solicitação: não precisa de getUser nem de tokens.
    // O destino é validado pelo mock do próprio método resetPasswordForEmail.
    await request.ready();
    await request.run('TrailerAuth.reset("fixture@example.invalid")');
    assert(request.calls.includes('reset'));
    console.log('PASSOU: recuperação validada, isolamento em memória, evento inicial, destino explícito, links inválidos/expirados, timeout, troca de usuário, atualização, logout, redirecionamento e dados preservados. SDK/DOM fictícios; sem rede/Supabase.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
