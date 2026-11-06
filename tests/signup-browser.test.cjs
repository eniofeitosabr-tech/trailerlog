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
            if (relative === 'supabase-config.js') data = Buffer.concat([data, Buffer.from('\nwindow.TRAILER_SUPABASE_CONFIG = { ...window.TRAILER_SUPABASE_CONFIG, dailySync: false };')]);
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
                const isToken = request.url.startsWith('https://oeolpogdfqtqcjnqqfqm.supabase.co/auth/v1/token?grant_type=password');
                const isUser = request.url === 'https://oeolpogdfqtqcjnqqfqm.supabase.co/auth/v1/user';
                const isLogout = request.url.startsWith('https://oeolpogdfqtqcjnqqfqm.supabase.co/auth/v1/logout');
                const isSignup = request.url.startsWith('https://oeolpogdfqtqcjnqqfqm.supabase.co/auth/v1/signup');
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
        async function auditMobile(client, label) {
            for (const theme of ['light','dark']) for (const width of [320,375,390,428,768]) {
                await client.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
                await client.evaluate(`if(document.body.classList.contains('dark-mode')!==${theme==='dark'})TrailerTheme.toggle();true`);
                const language=width===375||width===428?'en':'pt';
                await client.evaluate(`var languageControl=document.querySelector('[data-pay-language],#language');if(languageControl){languageControl.value='${language}';languageControl.dispatchEvent(new Event('change'));}true`);
                const metrics=await client.evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,
                    smallInputs:Array.from(document.querySelectorAll('input:not([type=checkbox]):not([type=file]),select,textarea')).filter(n=>n.getBoundingClientRect().width&&parseFloat(getComputedStyle(n).fontSize)<16).map(n=>n.id),
                    smallTargets:Array.from(document.querySelectorAll('button,.pay-check,.auth-links a')).filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.height<43.5}).map(n=>n.id||n.tagName),
                    overflow:Array.from(document.querySelectorAll('main input,main select,main button,main table,main article')).filter(n=>{const r=n.getBoundingClientRect();return r.width&&(r.right>innerWidth+1||r.left< -1)}).map(n=>n.id||n.tagName)})`);
                assert(metrics.scroll<=metrics.width,`${label}/${width}/${theme}: horizontal overflow ${JSON.stringify(metrics)}`);
                assert.deepEqual(metrics.smallInputs,[],`${label}/${width}: small control font can trigger iOS focus zoom`);
                assert.deepEqual(metrics.smallTargets,[],`${label}/${width}: touch targets below 44px`);
                if(label==='detailed-report'&&width<=600)assert(await client.evaluate('Array.from(document.querySelectorAll(".mileage-table td:nth-child(n+3),.detention-table td:nth-child(n+3)")).every(n=>n.scrollWidth<=n.clientWidth && getComputedStyle(n).whiteSpace==="nowrap")'),'monetary values fit without splitting digits');
                if(process.env.TRAILERLOG_MOBILE_AUDIT_DIR){
                    await fs.mkdir(process.env.TRAILERLOG_MOBILE_AUDIT_DIR,{recursive:true});
                    const layout=await client.send('Page.getLayoutMetrics');
                    const size=layout.cssContentSize;
                    const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:Math.min(Math.ceil(size.height),18000),scale:1}});
                    await fs.writeFile(path.join(process.env.TRAILERLOG_MOBILE_AUDIT_DIR,`${label}-${theme}-${width}.png`),Buffer.from(shot.data,'base64'));
                    await fs.writeFile(path.join(process.env.TRAILERLOG_MOBILE_AUDIT_DIR,`${label}-${theme}-${width}.json`),JSON.stringify(metrics,null,2));
                }
            }
        }
        for (const language of ['pt','en']) for (const dark of [false,true]) {
            signupMode = 'confirm';
            const signup = await tab();
            try {
                await signup.navigate('cadastro.html');
                await signup.waitFor('!document.getElementById("submitAuth").disabled');
                await signup.send('Emulation.setDeviceMetricsOverride', {width:390,height:664,deviceScaleFactor:1,mobile:true});
                await signup.evaluate(`document.getElementById('language').value='${language}';document.getElementById('language').dispatchEvent(new Event('change'));if(document.body.classList.contains('dark-mode')!==${dark})TrailerTheme.toggle();true`);
                await signup.evaluate(`document.getElementById('email').value='fixture@example.invalid';document.getElementById('password').value=document.getElementById('confirmPassword').value='fixture-password';document.getElementById('submitAuth').click();true`);
                await signup.waitFor('document.getElementById("signupConfirmation").open');
                assert(await signup.evaluate(`location.pathname.endsWith('/cadastro.html') && document.activeElement.id==='closeSignupConfirmation'`));
                assert.match(await signup.evaluate('document.getElementById("signupConfirmationMessage").textContent'),language==='pt'?/caixa de entrada.*spam/:/inbox.*spam/);
                assert.equal(await signup.evaluate('getComputedStyle(document.getElementById("signupConfirmation")).backgroundColor'),dark?'rgb(15, 23, 42)':'rgb(255, 255, 255)');
                assert(await signup.evaluate('document.documentElement.scrollWidth<=innerWidth'));
                await signup.evaluate('document.getElementById("closeSignupConfirmation").click();true');
                await signup.waitFor('location.pathname.endsWith("/login.html")');
            } finally { await signup.close(); }
        }
        for (const scenario of ['error','ready']) {
            signupMode = scenario;
            const signup = await tab();
            try {
                await signup.navigate('cadastro.html');
                await signup.waitFor('!document.getElementById("submitAuth").disabled');
                await signup.evaluate(`document.getElementById('email').value='fixture@example.invalid';document.getElementById('password').value=document.getElementById('confirmPassword').value='fixture-password';document.getElementById('submitAuth').click();true`);
                await signup.waitFor('!document.getElementById("submitAuth").disabled && document.getElementById("authStatus").textContent.length>0');
                assert.match(await signup.evaluate('document.getElementById("authStatus").textContent'),scenario==='error'?/Muitas tentativas|Não foi possível/:/confirmação não é necessária/);
                if (scenario === 'error') assert.equal(await signup.evaluate('document.getElementById("authStatus").getAttribute("role")'), 'alert');
                assert(await signup.evaluate('!document.getElementById("signupConfirmation").open && location.pathname.endsWith("/cadastro.html")'));
            } finally { await signup.close(); }
        }
        console.log('PASS signup: PT/EN, light/dark, modal focus/mobile, dismissal then login, API error and confirmation disabled; all external requests intercepted.');
    } finally {
        if (browser) browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
