'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('daily-sync.js', 'utf8');
// Synthetic identity: this test must never identify a production account.
const account = '10000000-0000-4000-8000-000000000099';
const environment = 'https://fixture.supabase.co';
for (const language of ['pt-BR', 'en']) {
    const events = {}, nodes = {};
    let state, badAccount = false;
    const context = vm.createContext({ URL, Event, setInterval() {}, setTimeout() {},
        trailerSha256: value => value,
        localStorage: { getItem() { return state; }, setItem() { throw Error('Rendering must not write'); } },
        navigator: { locks: { request() { throw Error('Rendering must not lock or send'); } } },
        TrailerAuth: { importIdentity() { if (badAccount) throw Error('session_required'); return { account }; }, ready: { then() {} } },
        TrailerStorage: { validate() {}, identify() {}, id() {} },
        window: { TRAILER_SUPABASE_CONFIG: { url: environment, dailySync: true }, addEventListener(n, f) { events[n] = f; } },
        document: { documentElement: { lang: language }, getElementById: id => nodes[id],
            querySelector() { return { prepend(node) { nodes[node.id] = node; } }; },
            createElement() { return { hidden: false, textContent: '', setAttribute() {} }; },
            addEventListener(n, f) { events[n] = f; } }
    });
    vm.runInContext(source, context);
    function render(status, pending = 0, code = null, initialized = true) {
        const body = { version: 1, account, environment, queue: Array.from({ length: pending }, () => ({})),
            generation: 1, cursor: 0, status, error: code, initialized, data: {} };
        state = JSON.stringify({ ...body, digest: JSON.stringify(body) });
        events.trailerdailystatus();
        return nodes.dailySyncStatus;
    }
    assert.equal(render('ready').hidden, true);
    assert.equal(nodes.dailySyncStatus.textContent, '');
    for (const status of ['paused', 'conflict', 'pending', 'initializing']) {
        const node = render(status, status === 'pending' ? 2 : 0, null, status !== 'initializing');
        assert.equal(node.hidden, false);
        assert(!/New daily records|Novos registros diários/.test(node.textContent));
    }
    assert.match(render('conflict').textContent, /Conflito|Conflict/);
    assert.match(render('paused').textContent, /pausada|paused/);
    assert.match(render('pending', 2).textContent, /2/);
    assert.equal(render('ready', 0, 'daily_resnapshot_required').hidden, false);
    badAccount = true;
    events.trailerdailystatus();
    assert.equal(nodes.dailySyncStatus.hidden, false);
    assert.match(nodes.dailySyncStatus.textContent, /Confira sua conta|Review your account/);
}
for (const page of ['index.html', 'historico.html', 'configuracoes.html', 'paycheck.html']) {
    assert(fs.readFileSync(page, 'utf8').includes('src="daily-sync.js"'));
}
assert(!/New daily records|Novos registros diários/.test(source));
console.log('PASS daily status PT/EN: healthy banner hidden, pending/loading/errors/conflicts retained; render performs no writes or sends; all four pages use shared renderer.');
