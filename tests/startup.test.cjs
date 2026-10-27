// DOM, relógio, SDK e armazenamento simulados; sem rede ou dados reais.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
function harness({ stalled = false, session = null, stalledUser = false, broken = false } = {}) {
    const nodes = new Map(), timers = new Map(), events = {};
    let callback, releaseSession;
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, { hidden: id !== 'appCarregando', textContent: '' });
        return nodes.get(id);
    };
    const context = vm.createContext({ URL, console,
        crypto: require('node:crypto'), TextEncoder: require('node:util').TextEncoder,
        localStorage: { getItem: () => null },
        Event: class { constructor(type) { this.type = type; } },
        setTimeout(fn, ms) { const id = {}; timers.set(id, { fn, ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        document: { getElementById: node, querySelector: () => node('app'),
            documentElement: { lang: 'pt-BR' }, addEventListener() {} },
        window: { isSecureContext: true, TRAILER_SUPABASE_CONFIG: {
            url: 'https://fixture.supabase.co', publishableKey: 'sb_publishable_fixture'
        }, dispatchEvent(event) { for (const fn of events[event.type] || []) fn(event); },
        addEventListener(name, fn) { (events[name] ??= []).push(fn); },
        supabase: { createClient() { return { auth: {
            getSession: () => stalled ? new Promise(resolve => { releaseSession = resolve; })
                : Promise.resolve({ data: { session }, error: null }),
            getUser: () => stalledUser ? new Promise(() => {})
                : Promise.resolve({ data: { user: session.user }, error: null }),
            onAuthStateChange(fn) { callback = fn; }
        } }; } } }
    });
    const run = code => vm.runInContext(code, context);
    if (broken) context.window.trailerStartupExpired = true;
    run(source('app-startup.js'));
    return { run, node, context, timers, events,
        auth: () => run(source('auth.js')),
        change: user => callback({ type: 'SIGNED_IN' }, { user }),
        release: value => releaseSession(value),
        expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } }
    };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function main() {
    const h = harness();
    assert.equal(h.node('app').hidden, true);
    assert.equal(h.node('appCarregando').hidden, false);
    assert.equal(h.node('contaBloqueada').hidden, true);
    h.auth(); await h.run('TrailerAuth.ready');
    assert.equal(h.node('app').hidden, true, 'sessão pronta não basta para revelar dados');
    h.run('window.TrailerStartup.dataReady()');
    assert.equal(h.node('app').hidden, false);
    h.change({ id: B });
    assert.equal(h.node('app').hidden, true, 'troca de identidade oculta a interface imediatamente');
    assert.equal(h.node('contaBloqueada').hidden, false);
    h.run('window.TrailerStartup.dataReady()');
    assert.equal(h.node('app').hidden, true);

    const reverse = harness();
    reverse.run('window.TrailerStartup.dataReady()');
    assert.equal(reverse.node('app').hidden, true, 'dados antes da identidade permanecem ocultos');
    reverse.auth(); await reverse.run('TrailerAuth.ready');
    assert.equal(reverse.node('app').hidden, false);

    for (const options of [{ stalled: true }, { session: { user: { id: A } }, stalledUser: true }]) {
        const slow = harness(options);
        slow.auth(); await flush();
        slow.expire(12000); await slow.run('TrailerAuth.ready');
        assert.equal(slow.node('app').hidden, true);
        assert.equal(slow.node('appFalhou').hidden, false, 'timeout da sessão/usuário vira erro visível');
        assert.equal(slow.node('appCarregando').hidden, true);
        if (options.stalled) {
            slow.release({ data: { session: null }, error: null }); await flush();
            slow.run('window.TrailerStartup.dataReady()');
            assert.equal(slow.node('app').hidden, true, 'resposta tardia não desfaz o erro');
        }
    }
    const broken = harness({ broken: true });
    broken.auth(); await broken.run('TrailerAuth.ready');
    broken.run('window.TrailerStartup.dataReady()');
    assert.equal(broken.node('app').hidden, true, 'watchdog vencido impede liberação tardia');
    assert.equal(broken.node('appFalhou').hidden, false);

    // Integração real de subscribe: eventos anteriores à sessão não leem dados;
    // somente o retorno bem-sucedido do primeiro renderer libera a interface.
    for (const renderFails of [false, true]) {
        const data = harness({ stalled: true });
        data.auth(); await flush();
        data.run(source('sha256.js')); data.run(source('storage.js'));
        data.context.renderFails = renderFails;
        data.run(`var renderCount = 0; var errorCount = 0;
            TrailerStorage.subscribe(() => {
                if (!document.querySelector('.app-layout').hidden) throw Error('Interface liberada antes do renderer');
                renderCount++;
                if (renderFails) throw Error('Falha fictícia na renderização');
            }, () => { errorCount++; });`);
        for (const fn of data.events.focus || []) fn({ type: 'focus' });
        assert.equal(data.run('renderCount'), 0);
        assert.equal(data.run('errorCount'), 0);
        data.release({ data: { session: null }, error: null });
        await data.run('TrailerAuth.ready'); await flush();
        assert.equal(data.run('renderCount'), 1);
        assert.equal(data.node('app').hidden, renderFails);
        assert.equal(data.node('appFalhou').hidden, !renderFails);
    }

    // O watchdog funciona mesmo se app-startup.js/auth.js não carregarem.
    for (const page of ['index.html', 'historico.html', 'configuracoes.html']) {
        const html = source(page);
        assert(html.includes('<div class="app-layout" hidden>'));
        assert(html.includes('Carregando Trailer Log...'));
        assert(html.includes('<noscript>'));
        assert(html.includes('onclick="location.reload()">Tentar novamente'));
        assert(html.indexOf('app-startup.js') < html.indexOf('auth.js'));
        const watchdog = html.match(/<script data-startup-watchdog>([\s\S]*?)<\/script>/)[1];
        const missing = harness();
        delete missing.context.window.TrailerStartup;
        missing.run(watchdog); missing.expire(20000);
        assert.equal(missing.node('appFalhou').hidden, false);
        assert.equal(missing.node('app').hidden, true);
    }
    console.log('PASSOU: carregamento, barreira sessão/dados, troca de conta, timeout de sessão/usuário, respostas tardias e watchdog independente nas três páginas. Sem rede/banco real.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
