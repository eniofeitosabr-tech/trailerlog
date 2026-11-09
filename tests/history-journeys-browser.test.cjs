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
            await client.evaluate(`TrailerStorage.change(d=>{
                const p={version:1,localDate:'2026-11-02',originalMiles:150,storeToBackhaul:0,backhaulToBase:0,backhaul:false,destination:'',extraDayCents:0,rateCents:65,initialTrailer:'T1',numeroParadas:2};
                d.jornadasSalvas=[
                    {id:'delete-fixture',registroId:'delete-fixture',truck:'TEST',trailer:'T1',inicio:'2026-11-02T10:00:00',fim:'2026-11-02T18:00:00',status:'Finalizada',pagamento:{...p}},
                    {id:'keep-fixture',registroId:'keep-fixture',truck:'TEST',trailer:'T3',inicio:'2026-11-03T10:00:00',fim:'2026-11-03T18:00:00',status:'Finalizada',pagamento:{...p,localDate:'2026-11-03'}}
                ];
                d.jornadaAtiva={id:'active-fixture',registroId:'active-fixture',truck:'TEST',trailer:'T4',inicio:'2026-11-04T10:00:00',status:'Em andamento',pagamento:{...p,localDate:'2026-11-04'}};
                d.trucksCadastrados=[{registroId:'truck-fixture',numero:'TEST'}];
                d.trailersSalvos=[{registroId:'delete-use',trailer:'T2',jornadaId:'delete-fixture'},{registroId:'keep-use',trailer:'T3',jornadaId:'keep-fixture'},{registroId:'legacy-use',trailer:'LEGACY',truck:'TEST'}];
            }).then(()=>true)`);
            await client.open('historico.html');
            await client.waitFor('!!document.getElementById("abaJornadas") && !!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden');
            const today = await client.evaluate('diaLocalHistorico(new Date())');
            assert.equal(await client.evaluate('document.getElementById("dataPesquisa").value'),today);
            assert.equal(await client.evaluate('document.getElementById("dataPesquisaAte").value'),today);
            await client.evaluate('limparDataHistorico();true');
            await client.evaluate('selecionarAba("journey");true');
            assert.equal(await client.evaluate('document.querySelectorAll("[onclick^=excluirJornada]").length'),2);
            await client.evaluate('document.getElementById("campoPesquisa").value="TEST";document.getElementById("dataPesquisa").value="2026-11-02";document.getElementById("dataPesquisaAte").value="2026-11-03";mostrarHistorico();true');
            assert.equal(await client.evaluate('document.querySelectorAll("[onclick^=excluirJornada]").length'),2);
            await client.evaluate('document.getElementById("dataPesquisaAte").value="2026-11-02";mostrarHistorico();true');
            assert.equal(await client.evaluate('document.querySelectorAll("[onclick^=excluirJornada]").length'),1);
            for(const lang of ['pt','en'])for(const dark of [false,true])for(const width of [320,1920]){
                await client.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===320});
                await client.evaluate('var control=document.querySelector("[data-pay-language]");control.value="'+lang+'";control.dispatchEvent(new Event("change"));if(document.body.classList.contains("dark-mode")!=='+dark+')TrailerTheme.toggle();true');
                assert(await client.evaluate('document.documentElement.scrollWidth<=innerWidth'),'history fits '+width);
                assert.equal(await client.evaluate('document.getElementById("dataPesquisa").value'),'2026-11-02');
                assert.equal(await client.evaluate('document.getElementById("dataPesquisaAte").value'),'2026-11-02');
                assert.equal(await client.evaluate('document.querySelector("[onclick^=excluirJornada]").textContent'),lang==='en'?'Delete journey':'Excluir jornada');
            }
            await client.evaluate('window.confirm=message=>{window.fixtureConfirmation=message;return false};document.querySelector("[onclick^=excluirJornada]").click();true');
            assert.equal(await client.evaluate('TrailerStorage.read().data.jornadasSalvas.length'),2);
            assert(await client.evaluate('fixtureConfirmation.includes("delete-fixture") && fixtureConfirmation.includes("TEST") && fixtureConfirmation.includes("2026")'));
            // Removing the last visit must be explicitly described as keeping payment.
            for (const number of ['T2','t2']) {
                await client.evaluate(`selecionarAba('trailer');document.getElementById('campoPesquisa').value='${number}';mostrarHistorico();true`);
                assert.equal(await client.evaluate('document.querySelectorAll("[onclick^=excluirTrailer]").length'),1);
            }
            assert(await client.evaluate('document.getElementById("historico").textContent.includes("keeps payment")'));
            assert(await client.evaluate('document.getElementById("historico").textContent.includes("Delete journey and payment")'));
            await client.evaluate('window.confirm=()=>true;excluirTrailer(0).then(()=>true)');
            assert.equal(await client.evaluate('TrailerStorage.read().data.jornadasSalvas.length'),2);
            assert.equal(await client.evaluate('TrailerPay.report(TrailerStorage.read().data,"2026-11-01","2026-11-07").totals.totalCents'),35250);
            await client.evaluate('selecionarAba("journey");document.getElementById("campoPesquisa").value="TEST";mostrarHistorico();true');
            await client.evaluate('excluirJornada(0).then(()=>true)');
            await client.waitFor('TrailerStorage.read().data.jornadasSalvas.length===1');
            assert.equal(await client.evaluate('TrailerStorage.read().data.trailersSalvos.length'),2);
            assert.equal(await client.evaluate('TrailerStorage.read().data.trucksCadastrados.length'),1);
            await client.evaluate('limparDataHistorico();true');
            assert.equal(await client.evaluate('document.getElementById("dataPesquisaAte").value'),'');
            assert.equal(await client.evaluate('document.querySelectorAll("[onclick^=excluirJornada]").length'),1);
            await client.open('paycheck.html');
            await client.waitFor('!!document.getElementById("payFilter") && !!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden');
            await client.evaluate('document.getElementById("payFrom").value="2026-11-01";document.getElementById("payTo").value="2026-11-07";document.getElementById("payFilter").requestSubmit();true');
            assert.equal(await client.evaluate('TrailerPay.report(TrailerStorage.read().data,"2026-11-01","2026-11-07").totals.totalCents'),23500);
            assert.equal(await client.evaluate('document.querySelectorAll("#payReport > article").length'),2);
            await client.send('Page.reload',{ignoreCache:true});
            await client.waitFor('!!document.getElementById("payFilter") && !!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden');
            await client.evaluate('document.getElementById("payFrom").value="2026-11-01";document.getElementById("payTo").value="2026-11-07";document.getElementById("payFilter").requestSubmit();true');
            assert.equal(await client.evaluate('document.querySelectorAll("#payReport > article").length'),2);
            assert(await client.evaluate('!document.getElementById("payReport").textContent.includes("delete-fixture")'));
            assert(await client.evaluate('document.getElementById("payReport").textContent.includes("keep-fixture")'));
            await client.open('index.html');
            await client.waitFor('!!document.getElementById("payStopsForm") && !!document.querySelector(".app-layout") && !document.querySelector(".app-layout").hidden');
            for(const lang of ['pt','en'])for(const dark of [false,true])for(const width of [320,1920]){
                await client.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===320});
                await client.evaluate('var control=document.querySelector("[data-pay-language]");control.value="'+lang+'";control.dispatchEvent(new Event("change"));if(document.body.classList.contains("dark-mode")!=='+dark+')TrailerTheme.toggle();true');
                assert(await client.evaluate('document.documentElement.scrollWidth<=innerWidth'));
                assert(await client.evaluate('(()=>{const a=document.getElementById("payStops").getBoundingClientRect(),b=document.getElementById("paySaveStops").getBoundingClientRect();return innerWidth<=600 ? b.top>=a.bottom : Math.abs(a.bottom-b.bottom)<1 && Math.abs(a.height-b.height)<1})()'),'stop control alignment '+width);
            }
            console.log('PASS Chrome history: date-only filters/clear, identified confirmation/cancel/delete, payments, PT/EN/light/dark/320/1920 and stop alignment. All external requests intercepted.');
        } finally { await client.close(); }
    } catch(error) { console.error(error); throw error; } finally {
        if(browser)browser.close();server.closeAllConnections();server.close();
    }
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1)});
