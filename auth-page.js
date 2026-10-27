const AuthPage = (() => {
    const messages = {
        pt: { login: "Entrar", signup: "Criar conta", recovery: "Recuperar senha", password: "Definir nova senha",
            email: "E-mail", pass: "Senha do Trailer Log", confirm: "Confirmar senha", newPass: "Nova senha do Trailer Log (mínimo de 8 caracteres)",
            forgot: "Esqueci minha senha", back: "Voltar ao aplicativo", language: "Idioma", theme: "Alternar tema",
            intro: "Use uma senha exclusiva para sua conta Trailer Log. A autenticação é feita pelo Supabase. Seus registros continuam neste navegador, sem sincronização na nuvem.",
            unavailable: "Autenticação não configurada. O acesso aos registros está bloqueado.",
            busy: "Aguarde…", mismatch: "As senhas não coincidem.", weak: "Use uma senha com pelo menos 8 caracteres.",
            signed: "Login realizado. Abra o aplicativo para acessar o espaço local desta conta; a sincronização na nuvem ainda não está habilitada.",
            created: "Se o cadastro puder ser concluído, você receberá as instruções por e-mail. Confira sua caixa de entrada e spam.",
            sent: "Se houver uma conta com esse e-mail, enviaremos instruções para recuperar a senha.",
            updated: "Senha atualizada. Entre novamente com sua nova senha.",
            recoveryReady: "Link validado. Defina sua nova senha.",
            finishRecovery: "Senha alterada, mas não foi possível encerrar a sessão. Tente novamente para concluir.",
            invalid: "E-mail ou senha inválidos.", verify: "Confirme seu e-mail antes de entrar.",
            expired: "Link ou sessão inválidos/expirados. Solicite um novo e-mail de recuperação.",
            rate: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
            generic: "Não foi possível concluir. Verifique a conexão e tente novamente.",
            logout: "Sair da conta neste navegador", loggedOut: "Sessão encerrada. Os registros locais foram preservados.",
            open: "Abrir aplicativo", title: "Trailer Log · Conta", configuration: "Não foi possível iniciar a autenticação. Confira o endereço HTTPS, a conexão e a configuração pública do Supabase." },
        en: { login: "Sign in", signup: "Create account", recovery: "Reset password", password: "Set new password",
            email: "Email", pass: "Trailer Log password", confirm: "Confirm password", newPass: "New Trailer Log password (at least 8 characters)",
            forgot: "Forgot password", back: "Back to app", language: "Language", theme: "Toggle theme",
            intro: "Use a unique password for your Trailer Log account. Supabase handles authentication. Your records stay in this browser, without cloud sync.",
            unavailable: "Authentication is not configured. Access to records is blocked.",
            busy: "Please wait…", mismatch: "Passwords do not match.", weak: "Use a password with at least 8 characters.",
            signed: "Signed in. Open the app to access this account's local workspace; cloud sync is not enabled yet.",
            created: "If registration can be completed, instructions will be sent by email. Check your inbox and spam folder.",
            sent: "If an account exists for this email, we will send password reset instructions.",
            updated: "Password updated. Sign in again with your new password.",
            recoveryReady: "Link verified. Set your new password.",
            finishRecovery: "Password changed, but the session could not be closed. Try again to finish.",
            invalid: "Invalid email or password.", verify: "Confirm your email before signing in.",
            expired: "Invalid or expired link/session. Request a new password reset email.",
            rate: "Too many attempts. Please wait a few minutes before trying again.",
            generic: "Unable to complete the request. Check your connection and try again.",
            logout: "Sign out on this browser", loggedOut: "Signed out. Local records were preserved.",
            open: "Open app", title: "Trailer Log · Account", configuration: "Unable to initialize authentication. Check HTTPS, your connection and the public Supabase configuration." }
    };
    let language = "pt", busy = false, handlersReady = false, authReady = false, statusKey = null, statusError = false;
    const mode = document.body.dataset.authPage;
    const el = id => document.getElementById(id);
    const t = key => messages[language][key] || key;
    function status(key, error = false) {
        statusKey = key; statusError = error;
        el("authStatus").textContent = t(key);
        el("authStatus").setAttribute("role", error ? "alert" : "status");
    }
    function translate() {
        document.documentElement.lang = language === "en" ? "en" : "pt-BR";
        document.title = t("title");
        document.querySelectorAll("[data-i18n]").forEach(node => { node.textContent = t(node.dataset.i18n); });
        el("submitAuth").textContent = t(busy ? "busy" : mode);
        if (!TrailerAuth.configured) status("unavailable");
        else if (statusKey) status(statusKey, statusError);
    }
    function errorKey(error) {
        if (error && error.code === "invalid_credentials") return "invalid";
        if (error && error.code === "email_not_confirmed") return "verify";
        if (error && /rate_limit/.test(error.code || "")) return "rate";
        if (error && /recovery_invalid|otp_expired|session_not_found|session_expired|bad_jwt|flow_state_expired/.test(error.code || "")) return "expired";
        if (error && error.code === "weak_password") return "weak";
        return TrailerAuth.error ? "configuration" : "generic";
    }
    function loading(value) {
        busy = value;
        el("authForm").setAttribute("aria-busy", String(value));
        const disabled = value || !handlersReady || !authReady || !TrailerAuth.configured || !!TrailerAuth.error
            || (mode === "password" && !TrailerAuth.recoveryReady);
        el("authForm").querySelectorAll("input, button").forEach(node => { node.disabled = disabled; });
        el("logoutAuth").disabled = value || !handlersReady || !authReady || !TrailerAuth.configured || !!TrailerAuth.error;
        el("retryAuth").hidden = !TrailerAuth.error;
        el("submitAuth").textContent = t(value ? "busy" : mode);
    }
    async function submit(event) {
        event.preventDefault();
        if (busy) return;
        if (!handlersReady || !authReady) return status("busy");
        if (!TrailerAuth.configured) return status("unavailable", true);
        if (mode === "password" && !TrailerAuth.recoveryReady) return status("expired", true);
        const password = el("password") ? el("password").value : "";
        if (["signup", "password"].includes(mode)) {
            if (password.length < 8) return status("weak", true);
            if (password !== el("confirmPassword").value) return status("mismatch", true);
        }
        loading(true); status("busy");
        try {
            const email = el("email") ? el("email").value.trim() : "";
            const result = mode === "login" ? await TrailerAuth.login(email, password) : mode === "signup" ? await TrailerAuth.signup(email, password) : mode === "recovery" ? await TrailerAuth.reset(email) : await TrailerAuth.updatePassword(password);
            if (result.error) throw result.error;
            el("authForm").reset();
            status({ login: "signed", signup: "created", recovery: "sent", password: "updated" }[mode]);
            el("openApp").hidden = mode !== "login";
        } catch (error) { status(mode === "password" && TrailerAuth.recoveryPasswordUpdated ? "finishRecovery" : errorKey(error), true); }
        finally { loading(false); }
    }
    try {
        language = localStorage.getItem("trailerlog-language") === "en" ? "en" : "pt";
        if (localStorage.getItem("trailerlog-theme") === "dark") document.body.classList.add("dark-mode");
    } catch (_) { /* Preferências indisponíveis não bloqueiam o formulário. */ }
    translate(); el("language").value = language;
    el("language").addEventListener("change", event => {
        language = event.target.value === "en" ? "en" : "pt";
        try { localStorage.setItem("trailerlog-language", language); } catch (_) {}
        translate();
    });
    el("themeAuth").addEventListener("click", () => {
        document.body.classList.toggle("dark-mode");
        try { localStorage.setItem("trailerlog-theme", document.body.classList.contains("dark-mode") ? "dark" : "light"); } catch (_) {}
    });
    el("authForm").addEventListener("submit", submit);
    el("retryAuth").addEventListener("click", () => window.location.reload());
    el("logoutAuth").addEventListener("click", async () => {
        if (busy) return;
        if (!TrailerAuth.configured) return status("unavailable", true);
        loading(true);
        try { const result = await TrailerAuth.logout(); if (result.error) throw result.error; status("loggedOut"); el("openApp").hidden = mode === "password"; }
        catch (error) { status(errorKey(error), true); }
        finally { loading(false); }
    });
    handlersReady = true;
    loading(false);
    if (TrailerAuth.configured) status("busy");
    window.addEventListener("trailerauthstate", () => loading(busy));
    const ready = TrailerAuth.ready.then(() => {
        authReady = true;
        loading(false);
        if (TrailerAuth.error) status(errorKey(TrailerAuth.error), true);
        else if (mode === "password") status(TrailerAuth.recoveryReady ? "recoveryReady" : "expired", !TrailerAuth.recoveryReady);
        else if (TrailerAuth.configured) { statusKey = null; el("authStatus").textContent = ""; }
    }).catch(() => { authReady = false; loading(false); status("configuration", true); });
    return { ready, errorKey, submit, t };
})();
