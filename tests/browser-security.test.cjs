// Requer Chrome/Edge headless isolado em --remote-debugging-port=9229.
// HTTP/WebSocket locais, sem dependências npm. Intercepta toda rede externa.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');

function jsonGet(url) {
    return new Promise((resolve, reject) => http.get(url, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    }).on('error', reject));
}
// Cliente mínimo de CDP; payloads de credenciais nunca são impressos.
async function connect(url) {
    const pending = new Map(), listeners = new Set();
    let socket, buffer = Buffer.alloc(0), serial = 0;
    function frame(payload, opcode = 1) {
        const mask = crypto.randomBytes(4);
        const header = Buffer.alloc(payload.length < 126 ? 2 : 4);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | (payload.length < 126 ? payload.length : 126);
        if (payload.length >= 126) header.writeUInt16BE(payload.length, 2);
        const masked = Buffer.from(payload);
        for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
        socket.write(Buffer.concat([header, mask, masked]));
    }
    function receive(chunk) {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
            const opcode = buffer[0] & 15;
            let length = buffer[1] & 127, offset = 2;
            if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
            if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
            if (buffer.length < offset + length) return;
            const payload = buffer.subarray(offset, offset + length);
            buffer = buffer.subarray(offset + length);
            if (opcode === 9) { frame(payload, 10); continue; }
            if (opcode !== 1) continue;
            const message = JSON.parse(payload.toString());
            if (message.id) {
                const request = pending.get(message.id);
                if (!request) continue;
                pending.delete(message.id); clearTimeout(request.timer);
                if (message.error) request.reject(Error(message.error.message));
                else request.resolve(message.result);
            } else for (const listener of listeners) listener(message);
        }
    }
    await new Promise((resolve, reject) => {
        const request = http.request(url.replace('ws:', 'http:'), { headers: {
            Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64')
        } });
        request.on('upgrade', (_, upgraded, head) => { socket = upgraded; socket.on('data', receive); if (head.length) receive(head); resolve(); });
        request.on('error', reject); request.end();
    });
    return {
        send(method, params = {}, sessionId) {
            return new Promise((resolve, reject) => {
                const id = ++serial;
                const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
                pending.set(id, { resolve, reject, timer });
                frame(Buffer.from(JSON.stringify({ id, method, params, sessionId })));
            });
        },
        listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        close() { socket.destroy(); }
    };
}
async function main() {
    let posts = 0, tamperSDK = false, missingHandlers = false;
    const server = http.createServer(async (request, response) => {
        if (request.method !== 'GET') { posts++; request.resume(); response.writeHead(405).end(); return; }
        const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/trailerlog\//, '').replace(/^\//, '');
        const file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep) || !/\.(html|js|css|jpg)$/.test(file)) { response.writeHead(404).end(); return; }
        if (missingHandlers && relative === 'auth-page.js') { response.writeHead(404).end(); return; }
        try {
            let data = await fs.readFile(file);
            if (tamperSDK && relative === 'vendor/supabase-js/supabase-2.118.0.js') data = Buffer.concat([data, Buffer.from('\n// fixture adulterada')]);
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' }[path.extname(file)];
            response.writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'Cache-Control': 'no-store' }).end(data);
        } catch (_) { response.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;
    try {
        const version = await jsonGet('http://127.0.0.1:9229/json/version');
        browser = await connect(version.webSocketDebuggerUrl);
        async function tab(disableJS = false, appPath = '/trailerlog/') {
            const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true });
            const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
            const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
            const send = (method, params) => browser.send(method, params, sessionId);
            const external = [];
            let tokenRequests = 0, cspBlocks = 0;
            const unlisten = browser.listen(event => {
                if (event.sessionId !== sessionId) return;
                if (event.method === 'Network.loadingFailed' && event.params.blockedReason === 'csp') cspBlocks++;
                if (event.method === 'Log.entryAdded' && event.params.entry.text.includes('form-action')) cspBlocks++;
                if (event.method !== 'Fetch.requestPaused') return;
                const { requestId, request } = event.params;
                if (request.url.startsWith(origin + '/')) { send('Fetch.continueRequest', { requestId }).catch(() => {}); return; }
                external.push(new URL(request.url).origin);
                const isToken = request.url.startsWith('https://oeolpogdfqtqcjnqqfqm.supabase.co/auth/v1/token?grant_type=password');
                const isUser = request.url === 'https://oeolpogdfqtqcjnqqfqm.supabase.co/auth/v1/user';
                const isLogout = request.url.startsWith('https://oeolpogdfqtqcjnqqfqm.supabase.co/auth/v1/logout');
                if ((isToken || isUser || isLogout) && request.method === 'OPTIONS') {
                    send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [
                        { name: 'Access-Control-Allow-Origin', value: '*' },
                        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
                        { name: 'Access-Control-Allow-Headers', value: 'authorization, apikey, content-type, x-client-info, x-supabase-api-version' }
                    ] }).catch(() => {});
                } else if (isToken || isUser || isLogout) {
                    if (isToken) tokenRequests++;
                    const user = { id: '10000000-0000-4000-8000-000000000001', email: 'fixture@example.invalid' };
                    const body = isUser ? user : isLogout ? {} : { access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user };
                    send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [
                        { name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }
                    ], body: Buffer.from(JSON.stringify(body)).toString('base64') }).catch(() => {});
                } else send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
            });
            await send('Page.enable'); await send('Network.enable'); await send('Log.enable');
            await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
            await send('Emulation.setScriptExecutionDisabled', { value: disableJS });
            async function evaluate(expression) {
                const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
                assert(!result.exceptionDetails, 'Erro no navegador: ' + (result.exceptionDetails && result.exceptionDetails.exception && result.exceptionDetails.exception.description || '').split('\n')[0]);
                return result.result.value;
            }
            async function waitFor(expression) {
                for (let i = 0; i < 150; i++) {
                    if (typeof expression === 'function' ? expression() : await evaluate(expression)) return;
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                throw Error('Estado esperado não alcançado no navegador: ' + String(expression));
            }
            return { send, evaluate, waitFor, external,
                tokens: () => tokenRequests, blocked: () => cspBlocks,
                async open(page) { await send('Page.navigate', { url: origin + appPath + page }); },
                async navigate(page) { await send('Page.navigate', { url: origin + appPath + page }); await waitFor('document.readyState === "complete" && !!document.getElementById("authForm")'); },
                async close() { unlisten(); await browser.send('Target.disposeBrowserContext', { browserContextId }); }
            };
        }
        for (const page of ['login.html', 'cadastro.html', 'recuperar-senha.html', 'nova-senha.html']) {
            console.log('Chrome sem JS: ' + page);
            const noJS = await tab(true);
            try {
                await noJS.navigate(page);
                assert(await noJS.evaluate('Array.from(document.querySelectorAll("#authForm input, #authForm button")).every(e => e.disabled)'));
                assert(await noJS.evaluate('!!document.querySelector("noscript p")'), 'mensagem noscript renderizada');
                // Mesmo removendo os disabled via DevTools, a CSP deve bloquear a
                // tentativa de POST nativo, sem depender de nenhum handler JS.
                const before = noJS.blocked();
                await noJS.evaluate('document.querySelectorAll("#authForm input, #authForm button").forEach(e => e.disabled = false); HTMLFormElement.prototype.submit.call(document.getElementById("authForm")); true');
                await noJS.waitFor(() => noJS.blocked() > before);
                assert(noJS.blocked() > before, 'CSP não bloqueou submissão nativa sem JS');
                assert.equal(posts, 0);
                assert.equal(noJS.external.length, 0);
            } finally { await noJS.close(); }
        }
        for (const page of ['index.html', 'historico.html', 'configuracoes.html']) {
            console.log('Chrome visitante: ' + page);
            const visitor = await tab();
            try {
                await visitor.open(page);
                await visitor.waitFor('location.pathname.endsWith("/login.html") && !!document.getElementById("authForm")');
                assert(await visitor.evaluate('typeof TrailerStorage === "undefined"'), 'nenhum armazenamento privado na tela de login');
            } finally { await visitor.close(); }
            const noJSPrivate = await tab(true);
            try {
                console.log('Chrome privado sem JS: ' + page);
                await noJSPrivate.open(page);
                await noJSPrivate.waitFor('document.readyState === "complete" && !!document.querySelector(".app-layout")');
                assert(await noJSPrivate.evaluate('document.querySelector(".app-layout").hidden'));
            } finally { await noJSPrivate.close(); }
        }
        // Contexto anônimo novo na raiz do localhost, como no Live Server.
        const normal = await tab(false, '/');
        try {
            console.log('Chrome anônimo: login inicial');
            await normal.navigate('login.html');
            await normal.waitFor('!document.getElementById("submitAuth").disabled');
            assert(await normal.evaluate('typeof window.supabase.createClient === "function"'), 'SDK local executa sob CSP/SRI');
            for (const width of [320, 1280]) {
                await normal.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 320 });
                assert(await normal.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'overflow no formulário');
            }
            await normal.evaluate('localStorage.setItem("trailersSalvos",JSON.stringify([{trailer:"GLOBAL-FICTICIO"}])); localStorage.setItem("trailerlog:user:10000000-0000-4000-8000-000000000002:trailersSalvos",JSON.stringify([{trailer:"CONTA-B-FICTICIA"}])); true');
            await normal.evaluate('document.getElementById("email").value="fixture@example.invalid"; document.getElementById("password").value="FICTICIO-apenas-teste"; document.getElementById("submitAuth").click(); true');
            await normal.waitFor('location.pathname.endsWith("/index.html") && !!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden');
            console.log('Chrome anônimo: foco e revalidação');
            for (let i = 0; i < 3; i++) {
                await normal.evaluate('window.dispatchEvent(new Event("focus")); true');
                await normal.waitFor('!TrailerAuth.verificationPending && !document.querySelector(".app-layout").hidden');
                assert(await normal.evaluate('getComputedStyle(document.getElementById("modalSucesso")).display === "none"'), 'foco não deve abrir aviso de conta indisponível');
                assert(await normal.evaluate('document.getElementById("contaStatus").textContent.includes("fixture@example.invalid")'));
            }
            assert.equal(await normal.evaluate('TrailerStorage.read().data.trailersSalvos.length'), 0, 'não importar legado global nem dados de B');
            console.log('Chrome anônimo: iniciar jornada e cadastrar caminhão');
            await normal.evaluate('document.getElementById("truck").value="TRUCK-TESTE-ANONIMO"; document.getElementById("truckCondition").value="Bom"; document.querySelector(\'button[onclick="iniciarJornada()"]\').click(); true');
            await normal.waitFor('document.getElementById("modalSucesso").querySelector("h2").textContent.includes("Jornada iniciada")');
            assert(await normal.evaluate('TrailerStorage.read().data.trucksCadastrados.some(t => t.numero === "TRUCK-TESTE-ANONIMO")'));
            await normal.evaluate('fecharModal(); true');
            console.log('Chrome anônimo: leitura e navegação');
            await normal.evaluate('TrailerStorage.change(d=>d.trailersSalvos.push({trailer:"CONTA-A-FICTICIA"})).then(()=>true)');
            for (const page of ['historico.html', 'configuracoes.html', 'index.html']) {
                await normal.open(page);
                await normal.waitFor('!!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden && location.pathname.endsWith("/' + page + '")');
                assert.equal(await normal.evaluate('TrailerStorage.read().data.trailersSalvos[0].trailer'), 'CONTA-A-FICTICIA');
            }
            assert.equal(normal.tokens(), 1, 'login deve chamar somente o endpoint Auth interceptado');
            assert(normal.external.every(host => host === 'https://oeolpogdfqtqcjnqqfqm.supabase.co'));
            assert.equal(posts, 0);
            await normal.evaluate('document.querySelector("[data-auth-logout]").click(); true');
            console.log('Chrome anônimo: logout');
            await normal.waitFor('location.pathname.endsWith("/login.html") && !!document.getElementById("authForm") && !document.getElementById("submitAuth").disabled');
            assert(await normal.evaluate('localStorage.getItem("trailerlog:user:10000000-0000-4000-8000-000000000001:trailerLogEstadoV2").includes("CONTA-A-FICTICIA")'));
            assert(await normal.evaluate('localStorage.getItem("trailersSalvos").includes("GLOBAL-FICTICIO")'));
            await normal.open('configuracoes.html');
            await normal.waitFor('location.pathname.endsWith("/login.html") && !!document.getElementById("authForm")');
            await normal.waitFor('!document.getElementById("submitAuth").disabled');
            console.log('Chrome anônimo: novo login');
            await normal.evaluate('document.getElementById("email").value="fixture@example.invalid"; document.getElementById("password").value="FICTICIO-apenas-teste"; document.getElementById("submitAuth").click(); true');
            await normal.waitFor('location.pathname.endsWith("/index.html") && !!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden');
            assert(await normal.evaluate('TrailerStorage.read().data.trucksCadastrados.some(t => t.numero === "TRUCK-TESTE-ANONIMO")'), 'registro criado pela interface deve continuar disponível após novo login');
            await normal.evaluate('window.dispatchEvent(new Event("focus")); true');
            await normal.waitFor('!TrailerAuth.verificationPending && !document.querySelector(".app-layout").hidden');
            assert(await normal.evaluate('getComputedStyle(document.getElementById("modalSucesso")).display === "none"'));
            assert.equal(normal.tokens(), 2);
        } finally { await normal.close(); }
        tamperSDK = true;
        const tampered = await tab();
        try {
            await tampered.navigate('login.html');
            await tampered.waitFor('document.getElementById("authStatus").textContent.includes("Não foi possível iniciar")');
            assert(await tampered.evaluate('document.getElementById("submitAuth").disabled && !window.supabase'));
            assert.equal(tampered.external.length, 0);
        } finally { await tampered.close(); }
        tamperSDK = false;
        missingHandlers = true;
        const missing = await tab();
        try {
            await missing.navigate('login.html');
            assert(await missing.evaluate('Array.from(document.querySelectorAll("#authForm input, #authForm button")).every(e => e.disabled)'));
            assert.equal(missing.external.length, 0);
        } finally { await missing.close(); }
        console.log('PASSOU Chrome: contexto anônimo em localhost, foco sem erro transitório, login, Registrar, cadastro/leitura de caminhão pela interface, logout, novo login e registro preservado; CSP/SRI, visitantes, isolamento e legado. SDK real com rede simulada; nenhum pedido chegou ao Supabase.');
    } finally {
        if (browser) browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
