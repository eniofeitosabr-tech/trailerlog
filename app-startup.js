// Controla apenas a visibilidade; não lê nem grava registros ou sessões.
window.TrailerStartup = (() => {
    let authenticated = false, rendered = false, failed = !!window.trailerStartupExpired, blocked = false;
    const element = id => document.getElementById(id);
    function render() {
        const ready = authenticated && rendered && !failed && !blocked;
        document.querySelector('.app-layout').hidden = !ready;
        element('appCarregando').hidden = ready || failed || blocked;
        element('appFalhou').hidden = !failed || blocked;
        element('contaBloqueada').hidden = !blocked;
        if (ready || failed || blocked) clearTimeout(window.trailerStartupTimer);
    }
    const api = {
        auth(state) {
            authenticated = state.ready;
            blocked = state.blocked;
            if (state.error) failed = true;
            render();
        },
        dataReady() { rendered = true; render(); },
        fail() { failed = true; render(); },
        get pending() { return !rendered; }
    };
    render();
    return api;
})();
