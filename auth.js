const TrailerAuth = (() => {
    const config = window.TRAILER_SUPABASE_CONFIG || {};
    const configured = !!(config.url || config.publishableKey);
    let client, user = null, initialized = !configured, changed = false, failure = null;
    // A recuperação usa armazenamento em memória separado da sessão normal.
    const entry = new URL(window.location.href);
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
    function scope() {
        if (!initialized || failure || changed || recovering) throw Error(text("Conta indisponível ou alterada. Abra Conta para conferir a sessão; seus dados foram preservados.", "Account unavailable or changed. Open Account to review your session; your data was preserved."));
        return user ? user.id : "guest";
    }
    function event(name) { window.dispatchEvent(new Event(name)); }
    function render() {
        const label = document.getElementById("contaStatus");
        if (label) label.textContent = changed ? text("Sessão alterada — reabra o aplicativo.", "Session changed — reopen the app.") : failure ? text("Conta indisponível. Verifique a configuração.", "Account unavailable. Check configuration.") : !initialized ? text("Verificando sessão…", "Checking session…") : user ? user.email : text("Modo local — dados neste navegador", "Local mode — data in this browser");
        const app = document.querySelector(".app-layout");
        if (window.TrailerStartup) {
            window.TrailerStartup.auth({ ready: initialized && !recovering, blocked: changed || recovering, error: failure });
            return;
        }
        if (app) app.hidden = recovering || (configured && (!initialized || changed || !!failure));
        const notice = document.getElementById("contaBloqueada");
        if (notice) notice.hidden = !recovering && (!configured || (initialized && !changed && !failure));
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
    function acceptSession(session) {
        const next = session && session.user;
        if ((next ? next.id : null) !== (user ? user.id : null)) {
            changed = true;
            render();
            event("traileraccountchange");
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
            if (recovering) { failure = invalidRecovery(); cleanRecoveryURL(); }
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
                // INITIAL_SESSION pode chegar antes de getUser validar a identidade.
                if (initialized) acceptSession(session);
            });
            const sessionResult = await bounded(client.auth.getSession());
            if (sessionResult.error) throw sessionResult.error;
            if (recovering) {
                if (!sessionResult.data.session) throw invalidRecovery();
                await bounded(recoveryEvent);
                const result = await validateRecovery();
                recoveryUser = result;
                recoveryValid = true;
                if (!cleanRecoveryURL()) throw invalidRecovery();
            } else if (sessionResult.data.session) {
                const result = await bounded(client.auth.getUser());
                if (result.error) throw result.error;
                user = result.data.user;
                if (!user || !/^[a-f0-9-]{36}$/i.test(user.id)) throw Error("Invalid user identifier.");
            }
            initialized = true;
        } catch (error) {
            failure = error;
            if (recovering) { recoveryValid = false; cleanRecoveryURL(); }
        }
        finally { render(); event("traileraccountready"); }
    }
    const ready = initialize();
    async function api(allowRecovery = false) {
        await ready;
        if (!configured) throw Error(text("Supabase ainda não configurado. O modo local continua disponível.", "Supabase is not configured yet. Local mode is still available."));
        if (failure) throw failure;
        if (recovering && !allowRecovery) throw invalidRecovery();
        return client.auth;
    }
    function redirect(page) { return new URL(page, window.location.href).href; }
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
    document.addEventListener("DOMContentLoaded", render);
    return { ready, scope, configured, render,
        login: async (email, password) => (await api()).signInWithPassword({ email, password }),
        signup: async (email, password) => (await api()).signUp({ email, password, options: { emailRedirectTo: redirect("login.html") } }),
        reset: async email => (await api()).resetPasswordForEmail(email, { redirectTo: redirect("nova-senha.html") }),
        updatePassword,
        logout: async () => (await api(true)).signOut({ scope: "local" }),
        get recoveryReady() { return initialized && recoveryValid && !failure; },
        get recoveryPasswordUpdated() { return passwordUpdated; },
        get error() { return failure; }
    };
})();
