const TrailerTheme = (() => {
    const key = "trailerlog-theme";
    let dark = false;
    try { dark = localStorage.getItem(key) === "dark"; } catch (_) {}
    function apply() {
        document.documentElement.classList.toggle("dark-mode", dark);
        if (document.body) document.body.classList.toggle("dark-mode", dark);
    }
    apply();
    document.addEventListener("DOMContentLoaded", apply);
    window.addEventListener("storage", event => {
        if (event.key === key) { dark = event.newValue === "dark"; apply(); }
    });
    return { apply, toggle() {
        dark = !dark; apply();
        try { localStorage.setItem(key, dark ? "dark" : "light"); } catch (_) {}
    } };
})();