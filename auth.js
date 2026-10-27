const TrailerAuth = (() => {
    const config = window.TRAILER_SUPABASE_CONFIG || {};
    const configured = !!(config.url || config.publishableKey);
    let client, user = null, initialized = false, changed = false, failure = null;
    // A recuperação usa armazenamento em memória separado da sessão normal.
    const entry = new URL(window.location.href);
    const protectedPage = !/\/(login|cadastro|recuperar-senha|nova-senha|sobre)\.html$/.test(entry.pathname);
    const loginPage = /\/login\.html$/.test(entry.pathname);
    const logoutKey = "trailerlog-auth-logout";
    let checking = false, signingOut = false, suspended = false, expiresAt = 0, epoch = 0;
    let validation = null, validationTimer, navigation = null;
    let observedIdentity;
    const fragment = new URLSearchParams(entry.hash.slice(1));
    const passwordPage = /\/nova-senha\.html$/.test(entry.pathname);
    const recoveryLink = fragment.get("type") === "recovery" || entry.searchParams.get("type") === "recovery";
    const linkError = fragment.has("error") || entry.searchParams.has("error");
    let recovering = passwordPage || recoveryLink || linkError;
    let recoverySession = null, recoveryUser = null, recoveryValid = false, passwordUpdated = false;
    let recoveryBusy = false, recoveryRevoked = false;
    const invalidRecovery = () => Object.assign(Error("Link de recuperação inválido ou expirado."), { code: "recovery_invalid" });
    function cleanRecoveryURL() {
        try {
            const clean = new URL(window.location.href);
            for (const key of ["access_token", "refresh_token", "expires_at", "expires_in", "token_type", "type", "code", "token_hash", "error", "error_code", "error_description"]) clean.searchParams.delete(key);
            clean.hash = "";
            window.history.replaceState(null, "", clean.href);
            return true;
        } catch (_) { return false; }
    }
    const text = (pt, en) => document.documentElement.lang === "en" ? en : pt;
    function logoutPending() {
        try { return localStorage.getItem(logoutKey) === "1"; }
        catch (_) { return true; }
    }
    function accessible() {
        return configured && initialized && user && !failure && !changed && !recovering && !checking
            && !signingOut && !suspended && navigator.onLine !== false && expiresAt > Date.now() && !logoutPending();
    }
    function scope() {
        if (!accessible()) throw Error(text("Conta indisponível ou alterada. Abra Conta para conferir a sessão; seus dados foram preservados.", "Account unavailable or changed. Open Account to review your session; your data was preserved."));
        return user.id;
    }
    function event(name) { window.dispatchEvent(new Event(name)); }
    function render() {
        const label = document.getElementById("contaStatus");
        if (label) label.textContent = changed ? text("Sessão alterada — entre novamente.", "Session changed — sign in again.") : failure ? text("Conta indisponível. Tente novamente.", "Account unavailable. Try again.") : !initialized || checking ? text("Verificando sessão…", "Checking session…") : accessible() ? user.email : text("Login necessário", "Sign in required");
        const app = document.querySelector(".app-layout");
        if (window.TrailerStartup) {
            window.TrailerStartup.auth({ ready: !!accessible(), blocked: changed || recovering, error: failure });
            return;
        }
        if (app && protectedPage) app.hidden = !accessible();
        const notice = document.getElementById("contaBloqueada");
        if (notice) notice.hidden = !recovering && !changed;
    }
    function validateConfig() {
        const url = new URL(config.url);
        if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey || "")) {
            throw Error(text("Configure uma URL HTTPS do Supabase e a chave publicável sb_publishable_. Não use chaves secretas.", "Configure a Supabase HTTPS URL and sb_publishable_ key. Do not use secret keys."));
        }
        if (!window.isSecureContext) throw Error(text("Autenticação requer HTTPS ou localhost.", "Authentication requires HTTPS or localhost."));
    }
    function loadSDK() {
        if (window.supabase && window.supabase.createClient) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "vendor/supabase-js/supabase-2.118.0.js";
            script.integrity = "sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK";
            script.crossOrigin = "anonymous";
            script.referrerPolicy = "no-referrer";
            const timer = setTimeout(() => reject(Error(text("Não foi possível carregar a autenticação. Verifique a conexão.", "Unable to load authentication. Check your connection."))), 15000);
            script.onload = () => {
                clearTimeout(timer);
                if (window.supabase && window.supabase.createClient) resolve();
                else reject(Error(text("Não foi possível iniciar a autenticação.", "Unable to initialize authentication.")));
            };
            script.onerror = () => { clearTimeout(timer); reject(Error(text("Falha ao carregar Supabase Auth.", "Unable to load Supabase Auth."))); };
            document.head.appendChild(script);
        });
    }
    function navigate(page) {
        const target = redirect(page);
        if (navigation === target) return;
        navigation = target;
        window.location.replace(target);
    }
    function revoke() {
        epoch++;
        changed = true;
        expiresAt = 0;
        clearTimeout(validationTimer);
        render();
        event("traileraccountchange");
    }
    function acceptSession(name, session) {
        const next = session && session.user;
        if (name === "SIGNED_OUT" || (user && (!next || next.id !== user.id))) {
            revoke();
            if (protectedPage && !signingOut) navigate("login.html");
        } else if (user && name !== "INITIAL_SESSION" && !changed && !signingOut) {
            checking = true;
            render();
            // Fora do callback/lock do SDK; nunca aguardar Auth dentro do listener.
            setTimeout(() => { revalidate().catch(() => {}); }, 0);
        }
        event("trailerauthstate");
    }
    function bounded(request) {
        let timer;
        return Promise.race([request, new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error("Tempo esgotado ao verificar a sessão. Tente novamente.")), 12000);
        })]).finally(() => clearTimeout(timer));
    }
    async function initialize() {
        if (!configured) {
            failure = recovering ? invalidRecovery() : Error("Autenticação não configurada. Não é possível abrir os registros.");
            if (recovering) cleanRecoveryURL();
            render();
            return;
        }
        try {
            if (recovering && !passwordPage) {
                // Destino fixo e mesma origem: encaminha antes de consumir os tokens.
                const target = new URL("nova-senha.html", entry);
                target.search = entry.search;
                target.hash = entry.hash;
                window.location.replace(target.href);
                return;
            }
            if (passwordPage && (linkError || !recoveryLink)) throw invalidRecovery();
            validateConfig();
            await loadSDK();
            client = window.supabase.createClient(config.url, config.publishableKey, { auth: {
                persistSession: !recovering, autoRefreshToken: !recovering, detectSessionInUrl: true,
                flowType: "implicit",
                storageKey: recovering ? "trailerlog-password-recovery" : "trailerlog-auth-session"
            } });
            let signalRecovery;
            const recoveryEvent = new Promise(resolve => { signalRecovery = resolve; });
            // Inscrever imediatamente, antes de aguardar qualquer operação do SDK.
            // O callback é síncrono: chamadas Auth aqui podem causar deadlock.
            client.auth.onAuthStateChange((name, session) => {
                if (name === "PASSWORD_RECOVERY") {
                    recovering = true;
                    recoverySession = session;
                    recoveryValid = false;
                    recoveryRevoked = false;
                    render();
                    signalRecovery();
                    event("trailerpasswordrecovery");
                    return;
                }
                if (recovering) {
                    if (!session || !session.user || (recoverySession && recoverySession.user && session.user.id !== recoverySession.user.id)) {
                        recoveryRevoked = true;
                        recoveryValid = false;
                    }
                    event("trailerauthstate");
                    return;
                }
                observedIdentity = session && session.user ? session.user.id : null;
                // INITIAL_SESSION pode chegar antes de getUser validar a identidade.
                if (initialized || name === "SIGNED_OUT") acceptSession(name, session);
            });
            if (!recovering && logoutPending()) {
                signingOut = true;
                const result = await bounded(client.auth.signOut({ scope: "local" }));
                if (result.error) throw result.error;
                localStorage.removeItem(logoutKey);
                signingOut = false;
                user = null;
                initialized = true;
                if (protectedPage) navigate("login.html");
                return;
            }
            const sessionResult = await bounded(client.auth.getSession());
            if (sessionResult.error) throw sessionResult.error;
            if (recovering) {
                if (!sessionResult.data.session) throw invalidRecovery();
                await bounded(recoveryEvent);
                const result = await validateRecovery();
                recoveryUser = result;
                recoveryValid = true;
                if (!cleanRecoveryURL()) throw invalidRecovery();
            } else await verifyNormal(sessionResult.data.session);
            initialized = true;
            if (!recovering) {
                if (protectedPage && !user) navigate("login.html");
                else if (loginPage && user) navigate("index.html");
                scheduleValidation();
            }
        } catch (error) {
            if (!recovering && invalidSession(error)) {
                user = null; expiresAt = 0; initialized = true;
                if (protectedPage) navigate("login.html");
            } else failure = error;
            if (recovering) { recoveryValid = false; cleanRecoveryURL(); }
        }
        finally { render(); event("traileraccountready"); }
    }
    const ready = initialize();
    async function api(allowRecovery = false) {
        await ready;
        if (!configured) throw Error(text("Autenticação não configurada. Tente novamente mais tarde.", "Authentication is not configured. Try again later."));
        if (failure) throw failure;
        if (recovering && !allowRecovery) throw invalidRecovery();
        return client.auth;
    }
    function redirect(page) { return new URL(page, window.location.href).href; }
    function invalidSession(error) {
        return error.status === 401 || error.status === 403 || /bad_jwt|session_expired|session_not_found|refresh_token_not_found|refresh_token_already_used|user_not_found/.test(error.code || "");
    }
    async function verifyNormal(session) {
        if (!session) { user = null; expiresAt = 0; return; }
        if (!session.access_token || !session.user || !Number.isFinite(session.expires_at)
            || session.expires_at * 1000 <= Date.now()) throw Object.assign(Error("Sessão expirada."), { code: "session_expired" });
        const version = epoch;
        const result = await bounded(client.auth.getUser(session.access_token));
        if (result.error) throw result.error;
        if (version !== epoch || signingOut || (observedIdentity !== undefined && observedIdentity !== session.user.id)) {
            revoke();
            if (protectedPage) navigate("login.html");
            throw Error("A sessão mudou durante a verificação.");
        }
        const verified = result.data.user;
        if (!verified || !/^[a-f0-9-]{36}$/i.test(verified.id) || verified.id !== session.user.id) {
            throw Object.assign(Error("Sessão inválida."), { code: "bad_jwt" });
        }
        if (user && user.id !== verified.id) { revoke(); if (protectedPage) navigate("login.html"); throw Error("A conta foi alterada."); }
        user = verified;
        expiresAt = session.expires_at * 1000;
    }
    function scheduleValidation() {
        clearTimeout(validationTimer);
        if (!protectedPage || !accessible()) return;
        validationTimer = setTimeout(() => { revalidate(expiresAt <= Date.now()).catch(() => {}); }, Math.min(60000, Math.max(0, expiresAt - Date.now())));
        if (validationTimer && typeof validationTimer.unref === "function") validationTimer.unref();
    }
    async function revalidate(hide = true) {
        if (validation) {
            if (hide) { checking = true; render(); }
            return validation;
        }
        if (failure || changed || recovering || signingOut || suspended || !client) throw Error("Conta indisponível para verificação.");
        // Checagens preventivas mantêm a tela da mesma conta já validada estável.
        // Retorno à aba, renovação/expiração e inicialização continuam bloqueados.
        if (hide) { checking = true; render(); }
        validation = (async () => {
            try {
                if (navigator.onLine === false) throw Error("Sem conexão. Tente novamente.");
                const result = await bounded(client.auth.getSession());
                if (result.error) throw result.error;
                await verifyNormal(result.data.session);
                if (!user) { revoke(); if (protectedPage) navigate("login.html"); }
            } catch (error) {
                if (invalidSession(error)) { revoke(); if (protectedPage) navigate("login.html"); }
                else failure = error;
                throw error;
            } finally {
                checking = false;
                validation = null;
                render();
                scheduleValidation();
                event("traileraccountready");
            }
        })();
        return validation;
    }
    async function authorize(expected) {
        await ready;
        await revalidate(false);
        if (scope() !== expected) throw Error("A conta mudou. Nenhum registro foi alterado.");
        return expected;
    }
    async function login(email, password) {
        const auth = await api();
        const result = await bounded(auth.signInWithPassword({ email, password }));
        if (result.error) return result;
        changed = false;
        user = null;
        await verifyNormal(result.data.session);
        if (!user) throw Object.assign(Error("Sessão inválida."), { code: "bad_jwt" });
        initialized = true;
        navigate("index.html");
        return result;
    }
    async function logout() {
        if (recovering) {
            recoveryValid = false;
            const result = await bounded((await api(true)).signOut({ scope: "local" }));
            if (result.error) throw result.error;
            recoverySession = null;
            navigate("login.html");
            return result;
        }
        // Bloqueio imediato, antes de qualquer espera ou acesso à rede.
        signingOut = true;
        revoke();
        try {
            // Falta de espaço para o marcador não pode impedir o logout no SDK.
            try { localStorage.setItem(logoutKey, "1"); } catch (_) { /* A aba já está bloqueada. */ }
            await ready;
            if (!client) throw Error("Autenticação indisponível. Tente novamente.");
            const result = await bounded(client.auth.signOut({ scope: "local" }));
            if (result.error) throw result.error;
            localStorage.removeItem(logoutKey);
            user = null;
            expiresAt = 0;
            navigate("login.html");
            return result;
        } catch (error) { failure = error; render(); throw error; }
    }
    async function validateRecovery() {
        if (recoveryRevoked || !recoverySession || !recoverySession.access_token || !recoverySession.user) throw invalidRecovery();
        const result = await bounded(client.auth.getUser(recoverySession.access_token));
        if (result.error) throw result.error;
        const verified = result.data.user;
        if (recoveryRevoked || !verified || !/^[a-f0-9-]{36}$/i.test(verified.id)
            || verified.id !== recoverySession.user.id
            || (recoveryUser && verified.id !== recoveryUser.id)) throw invalidRecovery();
        return verified;
    }
    async function updatePassword(password) {
        await ready;
        if (failure) throw failure;
        if (!passwordPage || !recovering || !recoveryValid || recoveryBusy) throw invalidRecovery();
        recoveryBusy = true;
        try {
            if (!passwordUpdated) {
                await validateRecovery();
                if (!recoveryValid) throw invalidRecovery();
                const result = await bounded(client.auth.updateUser({ password }));
                if (result.error) throw result.error;
                passwordUpdated = true;
            }
            const signedOut = await bounded(client.auth.signOut({ scope: "local" }));
            if (signedOut.error) throw signedOut.error;
            recoveryValid = false;
            recoverySession = null;
            recoveryUser = null;
            cleanRecoveryURL();
            window.location.replace(redirect("login.html"));
            return { data: {}, error: null };
        } catch (error) {
            if (/recovery_invalid|otp_expired|bad_jwt|session_not_found|session_expired/.test(error.code || "")) {
                recoveryValid = false;
                recoveryRevoked = true;
                event("trailerauthstate");
            }
            throw error;
        } finally { recoveryBusy = false; }
    }
    function resume() {
        suspended = false;
        if (protectedPage && initialized && user && !failure && !changed && !recovering && !signingOut) revalidate().catch(() => {});
    }
    function suspend() {
        if (!protectedPage) return;
        suspended = true;
        checking = true;
        clearTimeout(validationTimer);
        render();
    }
    window.addEventListener("offline", () => {
        if (!protectedPage || recovering) return;
        failure = Error("Sem conexão. Verifique a rede e tente novamente.");
        render();
    });
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("storage", event => {
        if (!recovering && event.key === logoutKey && event.newValue === "1") {
            revoke();
            if (protectedPage) navigate("login.html");
        }
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") suspend(); else resume();
    });
    document.addEventListener("DOMContentLoaded", () => {
        render();
        for (const link of document.querySelectorAll("[data-auth-logout]")) link.addEventListener("click", event => {
            event.preventDefault();
            logout().catch(() => { render(); });
        });
    });
    return { ready, scope, authorize, configured, render,
        login,
        signup: async (email, password) => (await api()).signUp({ email, password, options: { emailRedirectTo: redirect("login.html") } }),
        reset: async email => (await api()).resetPasswordForEmail(email, { redirectTo: redirect("nova-senha.html") }),
        updatePassword,
        logout,
        get verificationPending() {
            return !failure && !changed && !recovering && !signingOut && (!initialized || checking || suspended);
        },
        get recoveryReady() { return initialized && recoveryValid && !failure; },
        get recoveryPasswordUpdated() { return passwordUpdated; },
        get error() { return failure; }
    };
})();
