const TrailerAuth = (() => {
    const config = window.TRAILER_SUPABASE_CONFIG || {};
    const configured = !!(config.url || config.publishableKey);
    let client, user = null, initialized = !configured, changed = false, failure = null;
    const text = (pt, en) => document.documentElement.lang === "en" ? en : pt;
    function scope() {
        if (!initialized || failure || changed) throw Error(text("Conta indisponível ou alterada. Abra Conta para conferir a sessão; seus dados foram preservados.", "Account unavailable or changed. Open Account to review your session; your data was preserved."));
        return user ? user.id : "guest";
    }
    function event(name) { window.dispatchEvent(new Event(name)); }
    function render() {
        const label = document.getElementById("contaStatus");
        if (label) label.textContent = changed ? text("Sessão alterada — reabra o aplicativo.", "Session changed — reopen the app.") : failure ? text("Conta indisponível. Verifique a configuração.", "Account unavailable. Check configuration.") : !initialized ? text("Verificando sessão…", "Checking session…") : user ? user.email : text("Modo local — dados neste navegador", "Local mode — data in this browser");
        const app = document.querySelector(".app-layout");
        if (window.TrailerStartup) {
            window.TrailerStartup.auth({ ready: initialized, blocked: changed, error: failure });
            return;
        }
        if (app) app.hidden = configured && (!initialized || changed || !!failure);
        const notice = document.getElementById("contaBloqueada");
        if (notice) notice.hidden = !configured || (initialized && !changed && !failure);
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
            script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js";
            const timer = setTimeout(() => reject(Error(text("Não foi possível carregar a autenticação. Verifique a conexão.", "Unable to load authentication. Check your connection."))), 15000);
            script.onload = () => { clearTimeout(timer); resolve(); };
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
        if (!configured) return;
        try {
            validateConfig();
            await loadSDK();
            client = window.supabase.createClient(config.url, config.publishableKey, { auth: {
                persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
                storageKey: "trailerlog-auth-session"
            } });
            const sessionResult = await bounded(client.auth.getSession());
            if (sessionResult.error) throw sessionResult.error;
            if (sessionResult.data.session) {
                const result = await bounded(client.auth.getUser());
                if (result.error) throw result.error;
                user = result.data.user;
                if (!user || !/^[a-f0-9-]{36}$/i.test(user.id)) throw Error("Invalid user identifier.");
            }
            initialized = true;
            client.auth.onAuthStateChange((name, session) => {
                if (name === "PASSWORD_RECOVERY") event("trailerpasswordrecovery");
                acceptSession(session);
            });
        } catch (error) { failure = error; }
        finally { render(); event("traileraccountready"); }
    }
    const ready = initialize();
    async function api() {
        await ready;
        if (!configured) throw Error(text("Supabase ainda não configurado. O modo local continua disponível.", "Supabase is not configured yet. Local mode is still available."));
        if (failure) throw failure;
        return client.auth;
    }
    function redirect(page) { return new URL(page, window.location.href).href; }
    document.addEventListener("DOMContentLoaded", render);
    return { ready, scope, configured, render,
        login: async (email, password) => (await api()).signInWithPassword({ email, password }),
        signup: async (email, password) => (await api()).signUp({ email, password, options: { emailRedirectTo: redirect("login.html") } }),
        reset: async email => (await api()).resetPasswordForEmail(email, { redirectTo: redirect("nova-senha.html") }),
        updatePassword: async password => (await api()).updateUser({ password }),
        logout: async () => (await api()).signOut({ scope: "local" }),
        get error() { return failure; }
    };
})();
