// Requer Chrome/Edge headless isolado em --remote-debugging-port=9229.
// HTTP/WebSocket locais, sem dependências npm. Intercepta toda rede externa.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function jsonGet(url) {
    return new Promise((resolve, reject) => http.get(url, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    }).on('error', reject));
}
// Node.js 22+ native WebSocket handles CDP framing/fragmentation. No npm dependency.
async function connect(url) {
    const pending = new Map(), listeners = new Set();
    const socket = new WebSocket(url);
    let serial = 0;
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const request = pending.get(message.id);
            if (!request) return;
            pending.delete(message.id); clearTimeout(request.timer);
            if (message.error) request.reject(Error(message.error.message));
            else request.resolve(message.result);
        } else for (const listener of listeners) listener(message);
    });
    socket.addEventListener('close', () => {
        for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error('Browser disconnected')); }
        pending.clear();
    });
    return {
        send(method, params = {}, sessionId) {
            return new Promise((resolve, reject) => {
                const id = ++serial;
                const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
                pending.set(id, { resolve, reject, timer });
                socket.send(JSON.stringify({ id, method, params, sessionId }));
            });
        },
        listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        close() { socket.close(); }
    };
}
async function main() {
    let posts = 0, tamperSDK = false, missingHandlers = false, signupMode = 'confirm';
    const server = http.createServer(async (request, response) => {
        if (request.method !== 'GET') { posts++; request.resume(); response.writeHead(405).end(); return; }
        const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/trailerlog\//, '').replace(/^\//, '');
        const file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep) || !/\.(html|js|css|jpg)$/.test(file)) { response.writeHead(404).end(); return; }
        if (missingHandlers && relative === 'auth-page.js') { response.writeHead(404).end(); return; }
        try {
            let data = await fs.readFile(file);
            // This suite simulates Auth, not sync RPCs. Keep its legacy/local payment
            // fixtures independent from the production dailySync setting.
            if (relative === 'supabase-config.js') data = Buffer.from('window.TRAILER_SUPABASE_CONFIG = { url: '+JSON.stringify('https://fixture.supabase.co')+', publishableKey: '+JSON.stringify('sb_publishable_fixture')+', dailySync: false };');
            if (relative.endsWith('.html')) data = Buffer.from(data.toString().replaceAll('https://oeolpogdfqtqcjnqqfqm.supabase.co', 'https://fixture.supabase.co'));
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
            let tokenRequests = 0, cspBlocks = 0, unexpectedDialogs = 0;
            const unlisten = browser.listen(event => {
                if (event.sessionId !== sessionId) return;
                if (event.method === 'Page.javascriptDialogOpening') {
                    unexpectedDialogs++;
                    console.error('Unexpected test dialog:', event.params.type, event.params.message);
                    send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
                }
                if (event.method === 'Network.loadingFailed' && event.params.blockedReason === 'csp') cspBlocks++;
                if (event.method === 'Log.entryAdded' && event.params.entry.text.includes('form-action')) cspBlocks++;
                if (event.method !== 'Fetch.requestPaused') return;
                const { requestId, request } = event.params;
                if (request.url.startsWith(origin + '/')) { send('Fetch.continueRequest', { requestId }).catch(() => {}); return; }
                external.push(new URL(request.url).origin);
                const isToken = request.url.startsWith('https://fixture.supabase.co/auth/v1/token?grant_type=password');
                const isUser = request.url === 'https://fixture.supabase.co/auth/v1/user';
                const isLogout = request.url.startsWith('https://fixture.supabase.co/auth/v1/logout');
                const isSignup = request.url.startsWith('https://fixture.supabase.co/auth/v1/signup');
                if ((isToken || isUser || isLogout || isSignup) && request.method === 'OPTIONS') {
                    send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [
                        { name: 'Access-Control-Allow-Origin', value: '*' },
                        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
                        { name: 'Access-Control-Allow-Headers', value: 'authorization, apikey, content-type, x-client-info, x-supabase-api-version' }
                    ] }).catch(() => {});
                } else if (isToken || isUser || isLogout || isSignup) {
                    if (isToken) tokenRequests++;
                    const user = { id: '10000000-0000-4000-8000-000000000001', email: 'fixture@example.invalid' };
                    const body = isSignup && signupMode === 'error' ? { code: 'over_email_send_rate_limit', msg: 'Fixture rate limit' } : isSignup && signupMode === 'confirm' ? { ...user, identities: [], aud: 'authenticated' } : isUser ? user : isLogout ? {} : { access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user };
                    send('Fetch.fulfillRequest', { requestId, responseCode: isSignup && signupMode === 'error' ? 429 : 200, responseHeaders: [
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
                tokens: () => tokenRequests, blocked: () => cspBlocks, dialogs: () => unexpectedDialogs,
                async open(page) { await send('Page.navigate', { url: origin + appPath + page }); },
                async navigate(page) { await send('Page.navigate', { url: origin + appPath + page }); await waitFor('document.readyState === "complete" && !!document.getElementById("authForm")'); },
                async close() { unlisten(); await browser.send('Target.disposeBrowserContext', { browserContextId }); }
            };
        }

        const client=await tab();
        try {
            await client.navigate('login.html');
            await client.waitFor('!document.getElementById("submitAuth").disabled');
            await client.evaluate('document.getElementById("email").value="fixture@example.invalid";document.getElementById("password").value="FICTICIO-apenas-teste";document.getElementById("submitAuth").click();true');
            await client.waitFor('location.pathname.endsWith("/index.html") && !!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden');
            for (const [miles, cents] of [[0,4500],[17,4500],[69,4500],[70,4550],[80,5200],[96,6240],[97,6305]]) {
                await client.evaluate(`document.getElementById('startPayoriginal').value='${miles}';document.getElementById('startPayoriginal').dispatchEvent(new Event('input',{bubbles:true}));true`);
                assert.equal(await client.evaluate('TrailerPay.calculate(PaycheckUI.startInput()).mileageCents'), cents);
                assert(await client.evaluate(`document.getElementById('startPaypreview').textContent.includes(PaycheckUI.money(${cents}))`));
            }
            await client.evaluate('document.getElementById("truck").value="STOPS-TEST";document.getElementById("startPayoriginal").value="150";iniciarJornada().then(()=>{fecharModal();return true})');
            assert.equal(await client.evaluate('TrailerStorage.read().data.jornadaAtiva.pagamento.rateCents'),65);
            for(const count of [2,4,2]){
                await client.evaluate('document.getElementById("payStops").value="'+count+'";document.getElementById("payStopsForm").requestSubmit();true');
                await client.waitFor('TrailerStorage.read().data.jornadaAtiva.pagamento.numeroParadas==='+count+' && !document.getElementById("paySaveStops").disabled');
                assert.equal(await client.evaluate('TrailerPay.calculate(TrailerStorage.read().data.jornadaAtiva.pagamento).stopBonusCents'),(count-1)*2000);
            }
            await client.open('configuracoes.html');
            await client.waitFor('!!document.getElementById("settingsRate") && !!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden');
            await client.evaluate('document.getElementById("settingsRate").value="0.68";document.getElementById("settingsRateForm").requestSubmit();true');
            await client.waitFor('TrailerStorage.read().data.paymentSettings?.rateCents===68');
            assert.equal(await client.evaluate('TrailerStorage.read().data.jornadaAtiva.pagamento.rateCents'),65);
            for(const page of ['configuracoes.html','index.html','paycheck.html']){
                await client.open(page);
                await client.waitFor('document.readyState==="complete" && !!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden && location.pathname.endsWith("/'+page+'")');
                if(page==='paycheck.html'){
                    await client.evaluate('var day=TrailerStorage.read().data.jornadaAtiva.pagamento.localDate;document.getElementById("payFrom").value=day;document.getElementById("payTo").value=day;document.getElementById("payFilter").requestSubmit();true');
                    assert(await client.evaluate('document.getElementById("payReport").textContent.includes(PaycheckUI.money(2000))'));
                    assert.equal(await client.evaluate('TrailerPay.report(TrailerStorage.read().data,document.getElementById("payFrom").value,document.getElementById("payTo").value).totals.stopBonusCents'),2000);
                }
                for(const lang of ['pt','en']) for(const dark of [false,true]) for(const width of [320,1920]){
                    await client.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===320});
                    await client.evaluate('var lang=document.querySelector("[data-pay-language]");lang.value="'+lang+'";lang.dispatchEvent(new Event("change"));if(document.body.classList.contains("dark-mode")!=='+dark+')TrailerTheme.toggle();true');
                    assert(await client.evaluate('document.documentElement.scrollWidth<=innerWidth'),page+' '+lang+' '+dark+' '+width);
                }
            }
            await client.open('index.html');
            await client.waitFor('location.pathname.endsWith("/index.html") && !!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden');
            await client.evaluate('finalizarJornada().then(()=>{fecharModal();return true})');
            await client.evaluate('document.getElementById("truck").value="STOPS-TEST";document.getElementById("startPayoriginal").value="150";iniciarJornada().then(()=>{fecharModal();return true})');
            assert.equal(await client.evaluate('TrailerStorage.read().data.jornadaAtiva.pagamento.rateCents'),68);
            assert.equal(await client.evaluate('TrailerStorage.read().data.jornadasSalvas[0].pagamento.numeroParadas'),2);
            assert.equal(await client.evaluate('TrailerPay.calculate(TrailerStorage.read().data.jornadaAtiva.pagamento).mileageCents'),10200);
            // Persist a new minimum payment through the real UI in this disposable account.
            await client.evaluate('finalizarJornada().then(()=>{fecharModal();return true})');
            await client.evaluate('document.getElementById("truck").value="STOPS-TEST";document.getElementById("startPayoriginal").value="17";iniciarJornada().then(()=>{fecharModal();return true})');
            assert.equal(await client.evaluate('TrailerPay.calculate(TrailerStorage.read().data.jornadaAtiva.pagamento).mileageCents'),4500);
            assert(await client.evaluate('document.getElementById("payActiveSummary").textContent.includes(PaycheckUI.money(4500))'));
            await client.open('paycheck.html');
            await client.waitFor('!!document.getElementById("payFilter") && !!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden');
            await client.evaluate('var day=TrailerStorage.read().data.jornadaAtiva.pagamento.localDate;document.getElementById("payFrom").value=day;document.getElementById("payTo").value=day;document.getElementById("payFilter").requestSubmit();true');
            assert(await client.evaluate('document.getElementById("payReport").textContent.includes(PaycheckUI.money(4500))'));
            await client.send('Page.reload',{ignoreCache:true});
            await client.waitFor('!!document.getElementById("payFilter") && !!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden');
            assert.equal(await client.evaluate('TrailerPay.calculate(TrailerStorage.read().data.jornadaAtiva.pagamento).mileageCents'),4500);
            console.log('PASS Chrome rates/stops: settings, active edits 1/2/4/2, finalization, new rate, PT/EN, light/dark, 320/1920px. External network intercepted.');
        } finally { await client.close(); }
    } catch(error) { console.error(error); throw error; } finally {
        if(browser)browser.close();
        server.closeAllConnections(); server.close();
    }
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1)});
