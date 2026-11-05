/* Detention editor shared by active journeys and completed-journey reports. */
const DetentionUI = (() => {
    const ui = PaycheckUI, el = id => document.getElementById(id);
    const messages = {
        pt: { title: "Detenção", add: "+ Adicionar Detenção", edit: "Corrigir detenção", remove: "Excluir detenção",
            date: "Data da detenção", minutes: "Minutos remunerados (incrementos de 15)", rate: "Tarifa histórica por hora",
            amount: "Valor estimado", note: "Informe somente o tempo que a empresa deve pagar. Não é calculada carência.",
            newRate: "A tarifa atual será registrada nesta nova detenção. Alterações futuras não serão retroativas.",
            save: "Confirmar e salvar", cancel: "Cancelar", confirm: "Confirma salvar esta detenção? A alteração ficará no histórico.",
            confirmDelete: "Confirma excluir esta detenção? A exclusão ficará no histórico.", saved: "Detenção salva. Totais recalculados.",
            deleted: "Detenção excluída. Totais recalculados.", history: "Histórico de detenção", added: "Inclusão", edited: "Correção", removed: "Exclusão",
            empty: "Nenhuma detenção registrada neste período.", total: "Subtotal de detenção", journey: "Jornada / Caminhão",
            invalid: "Informe minutos positivos em incrementos de 15 e uma data válida.",
            stale: "Os registros mudaram. Feche e reabra o formulário para conferir os dados atuais.",
            outside: "Milhas e demais bônus desta jornada estão fora do período selecionado; somente as detenções abaixo entram neste total." },
        en: { title: "Detention", add: "+ Add Detention", edit: "Edit detention", remove: "Delete detention",
            date: "Detention date", minutes: "Paid minutes (15-minute increments)", rate: "Historical hourly rate",
            amount: "Estimated amount", note: "Enter only the time the company must pay. No grace period is calculated.",
            newRate: "The current rate will be saved with this new detention. Future rate changes will not apply retroactively.",
            save: "Confirm and save", cancel: "Cancel", confirm: "Save this detention? The change will be recorded in its history.",
            confirmDelete: "Delete this detention? The deletion will be recorded in its history.", saved: "Detention saved. Totals recalculated.",
            deleted: "Detention deleted. Totals recalculated.", history: "Detention history", added: "Added", edited: "Corrected", removed: "Deleted",
            empty: "No detention recorded in this period.", total: "Detention subtotal", journey: "Journey / Truck",
            invalid: "Enter positive minutes in 15-minute increments and a valid date.",
            stale: "The records changed. Close and reopen the form to review current data.",
            outside: "Mileage and other bonuses for this journey are outside the selected period; only the detentions below are included in this total." }
    };
    const t = key => messages[ui.language === "en" ? "en" : "pt"][key] || key;
    const locale = () => ui.language === "en" ? "en-US" : "pt-BR";
    let state = null, busy = false;
    function node(tag, text, parent, className) {
        const item = document.createElement(tag);
        if (text !== undefined) item.textContent = text;
        if (className) item.className = className;
        if (parent) parent.appendChild(item);
        return item;
    }
    function description(entry) {
        return `${entry.localDate} · ${ui.number(entry.minutes)} min · ${ui.money(entry.rateCents)}/h · ${ui.money(TrailerPay.detentionCents(entry.minutes, entry.rateCents))}`;
    }
    function notify(text) {
        const target = el("payJourneyStatus") || el("payStatus");
        if (target) target.textContent = text;
    }
    const dialog = node("dialog", undefined, document.body, "detention-dialog");
    dialog.id = "detentionDialog"; dialog.setAttribute("aria-labelledby", "detentionTitle");
    dialog.innerHTML = `<h2 id="detentionTitle"></h2><p id="detentionJourney"></p>
        <form id="detentionForm">
            <label><span data-det-i18n="date"></span><input id="detentionDate" type="date" required></label>
            <label><span data-det-i18n="minutes"></span><input id="detentionMinutes" type="number" inputmode="numeric" min="15" step="15" value="15" required></label>
            <p data-det-i18n="note"></p><p id="detentionRateLabel"></p><p id="detentionRateNote" data-det-i18n="newRate"></p>
            <p id="detentionEstimate" role="status" aria-live="polite"></p>
            <p id="detentionError" role="alert"></p>
            <div class="detention-actions"><button id="detentionSave" type="submit" data-det-i18n="save"></button>
            <button id="detentionCancel" type="button" data-det-i18n="cancel"></button></div>
        </form>`;
    function preview() {
        if (!state) return;
        try {
            const minutes = Number(el("detentionMinutes").value);
            el("detentionEstimate").textContent = `${t("amount")}: ${ui.money(TrailerPay.detentionCents(minutes, state.rateCents))}`;
        } catch (_) { el("detentionEstimate").textContent = t("invalid"); }
    }
    function translate() {
        dialog.querySelectorAll("[data-det-i18n]").forEach(item => { item.textContent = t(item.dataset.detI18n); });
        if (state) {
            el("detentionTitle").textContent = t(state.mode === "add" ? "add" : "edit");
            el("detentionRateLabel").textContent = `${t("rate")}: ${ui.money(state.rateCents)}/h`;
            preview();
        }
    }
    function open(journeyId, entryId, activeOnly) {
        if (busy) return;
        try {
            const snapshot = TrailerStorage.read(), journey = TrailerPay.findJourney(snapshot.data, journeyId);
            if (activeOnly && (!snapshot.data.jornadaAtiva || snapshot.data.jornadaAtiva.id !== journeyId)) throw Error(t("stale"));
            const entry = entryId ? TrailerPay.detentionRecords(journey).find(item => item.id === entryId) : null;
            if (entryId && !entry) throw Error(t("stale"));
            state = { journeyId, activeOnly, token: snapshot.token, mode: entry ? "edit" : "add",
                id: entry ? entry.id : TrailerStorage.id(), rateCents: entry ? entry.rateCents :
                    snapshot.data.paymentSettings && snapshot.data.paymentSettings.detentionRateCents !== undefined ? snapshot.data.paymentSettings.detentionRateCents : TrailerPay.DEFAULT_DETENTION_RATE };
            el("detentionJourney").textContent = `${t("journey")}: ${journey.truck} · ${new Date(journey.inicio).toLocaleString(locale())}`;
            el("detentionDate").value = entry ? entry.localDate : activeOnly ? TrailerPay.localDate() : journey.pagamento ? journey.pagamento.localDate : TrailerPay.localDate(journey.inicio);
            el("detentionMinutes").value = entry ? entry.minutes : 15;
            el("detentionError").textContent = ""; el("detentionRateNote").hidden = !!entry;
            translate(); dialog.showModal(); el("detentionMinutes").focus();
        } catch (error) { notify(error.message); }
    }
    function requireActive(data, captured) {
        if (captured.activeOnly && (!data.jornadaAtiva || data.jornadaAtiva.id !== captured.journeyId)) throw Error(t("stale"));
    }
    el("detentionForm").addEventListener("submit", async event => {
        event.preventDefault();
        if (busy || !state) return;
        try {
            const captured = { ...state }, minutes = Number(el("detentionMinutes").value), localDate = el("detentionDate").value;
            TrailerPay.detentionCents(minutes, captured.rateCents);
            if (!TrailerPay.dateValid(localDate)) throw Error(t("invalid"));
            if (!window.confirm(t("confirm"))) return;
            busy = true;
            for (const id of ["detentionSave", "detentionCancel", "detentionMinutes", "detentionDate"]) el(id).disabled = true;
            await TrailerStorage.change(data => {
                requireActive(data, captured);
                TrailerPay.changeDetention(data, captured.journeyId, captured.id, { minutes, localDate }, captured.mode);
            }, captured.token);
            dialog.close(); state = null;
            el("detentionForm").reset();
            el("detentionMinutes").value = ""; el("detentionDate").value = "";
            el("detentionEstimate").textContent = "";
            notify(t("saved"));
            window.dispatchEvent(new Event("trailerdetentionchange"));
            const panel = [...document.querySelectorAll(".detention-panel")].find(item => item.dataset.journey === captured.journeyId);
            if (panel) panel.querySelector(".detention-add").focus();
        } catch (error) { el("detentionError").textContent = error.message + " " + t("stale"); }
        finally {
            busy = false;
            for (const id of ["detentionSave", "detentionCancel", "detentionMinutes", "detentionDate"]) el(id).disabled = false;
        }
    });
    el("detentionMinutes").addEventListener("input", preview);
    el("detentionCancel").addEventListener("click", () => { if (!busy) { dialog.close(); state = null; } });
    dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); else state = null; });
    window.addEventListener("trailerpaylanguage", translate);
    function dismiss() { if (dialog.open) dialog.close(); state = null; }
    // The native dialog lives outside the app gate; hide it when the account is blocked.
    for (const event of ["traileraccountchange", "offline", "pagehide"]) window.addEventListener(event, dismiss);
    window.addEventListener("traileraccountready", () => {
        if (typeof TrailerAuth !== "undefined" && TrailerAuth.error) dismiss();
    });
    async function remove(journeyId, entryId, token, activeOnly) {
        if (busy || !window.confirm(t("confirmDelete"))) return;
        busy = true;
        try {
            await TrailerStorage.change(data => {
                requireActive(data, { journeyId, activeOnly });
                TrailerPay.changeDetention(data, journeyId, entryId, null, "delete");
            }, token);
            notify(t("deleted")); window.dispatchEvent(new Event("trailerdetentionchange"));
        } catch (error) { notify(error.message); }
        finally { busy = false; }
    }
    function mount(container, journey, options = {}) {
        if (!container) return;
        let renderedToken = options.token;
        if (!renderedToken) { try { renderedToken = TrailerStorage.read().token; } catch (_) {} }
        container.replaceChildren(); container.classList.add("detention-panel");
        container.dataset.journey = journey.id;
        const entries = options.entries || TrailerPay.detentionRecords(journey);
        node("h3", t("title"), container);
        const add = node("button", t("add"), container, "detention-add"); add.type = "button";
        add.addEventListener("click", () => open(journey.id, null, !!options.activeOnly));
        if (!entries.length) node("p", t("empty"), container);
        for (const entry of entries) {
            const item = node("div", undefined, container, "detention-entry");
            node("p", description(entry), item);
            const actions = node("div", undefined, item, "detention-actions");
            const edit = node("button", t("edit"), actions, "detention-edit"); edit.type = "button";
            edit.addEventListener("click", () => open(journey.id, entry.id, !!options.activeOnly));
            const del = node("button", t("remove"), actions, "detention-delete"); del.type = "button";
            del.addEventListener("click", () => {
                try {
                    if (!renderedToken) throw Error(t("stale"));
                    remove(journey.id, entry.id, renderedToken, !!options.activeOnly);
                }
                catch (error) { notify(error.message); }
            });
        }
        const cents = entries.reduce((sum, entry) => sum + TrailerPay.detentionCents(entry.minutes, entry.rateCents), 0);
        const minutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
        node("p", `${t("total")}: ${ui.number(minutes)} min · ${ui.money(cents)}`, container, "detention-subtotal");
        const changes = journey.detentionCorrections || [];
        if (changes.length) {
            const history = node("details", undefined, container, "detention-history");
            node("summary", `${t("history")} (${changes.length})`, history);
            for (const change of changes) {
                const action = !change.before ? "added" : !change.after ? "removed" : "edited";
                node("p", `${t(action)} · ${new Date(change.at).toLocaleString(locale())}`, history);
                if (change.before) node("p", `${ui.t("before")}: ${description(change.before)}`, history);
                if (change.after) node("p", `${ui.t("after")}: ${description(change.after)}`, history);
            }
        }
    }
    translate();
    return { mount, t };
})();
