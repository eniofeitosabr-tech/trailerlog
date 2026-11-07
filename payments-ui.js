/* Shared PT/EN payment controls; all user content is inserted as text. */
const PaycheckUI = (() => {
    const messages = {
        pt: {
            stops: "Número de paradas", additionalStops: "Paradas adicionais remuneradas", stopBonus: "Bônus por paradas", saveStops: "Atualizar paradas", unknown: "Não informado",
            navRegister: "📝 Registrar", navHistory: "🕘 Histórico", navReports: "📊 Relatórios", navSettings: "⚙️ Configurações", navAbout: "ℹ️ Sobre", navLogout: "👤 Sair da conta",
            menu: "💵 Meus Pagamentos", title: "Meus Pagamentos", language: "Idioma", theme: "Alternar tema",
            start: "Pagamento da jornada", original: "Milhas originais da jornada", backhaul: "Backhaul",
            destination: "Destino / identificação do backhaul", extra: "Dia Extra (Extra Day)", extraValue: "Valor do Dia Extra",
            store: "Milhas da loja até o backhaul (total acumulado)", base: "Milhas do backhaul até a base (total acumulado)",
            active: "Pagamento da jornada ativa", saveMiles: "Salvar milhas adicionais",
            payable: "Milhas para pagamento", preview: "Estimativa da jornada (sem bônus diário de fim de semana)",
            rate: "Valor por milha (US$)", detentionRate: "Tarifa de detenção por hora (US$)", detentionMinutes: "Minutos de detenção", detentionCents: "Subtotal de detenção", date: "Data local da jornada", from: "De", to: "Até",
            filter: "Exibir período", settings: "Tarifa para novas jornadas",
            saveRate: "Salvar tarifa", rateNote: "A alteração vale para novas jornadas. Jornadas existentes preservam a tarifa registrada.",
            detentionRateNote: "A tarifa de detenção vale apenas para novos registros, inclusive na jornada ativa. Detenções anteriores preservam a tarifa histórica.",
            confirmDetentionRate: "Salvar esta tarifa para novas detenções? Os registros anteriores não serão alterados.", detentionRateSaved: "Tarifa salva para novas detenções. Valores anteriores preservados.",
            estimate: "Total bruto estimado", disclaimer: "Estimativa em US$, antes de impostos e descontos. Inclui jornadas ativas. Bônus de sábado/domingo conta uma vez por data local de início. Jornadas antigas sem pagamento ficam zeradas até serem preenchidas.",
            mileage: "Valor das milhas", bonusBackhaul: "Bônus de backhaul", saturday: "Bônus de sábado", sunday: "Bônus de domingo",
            extraBonus: "Bônus de Dia Extra", total: "Total", additional: "Milhas adicionais do Backhaul", milesUnit: "milhas", truck: "Caminhão", trailer: "Trailer(s)",
            journey: "Jornada", ongoing: "Em andamento", finished: "Finalizada", legacy: "Sem dados de pagamento (registro antigo)",
            confirm: "Confirma a alteração? O registro original será atualizado e a correção ficará no histórico.",
            confirmRate: "Salvar esta tarifa para as próximas jornadas?", saved: "Pagamento salvo. Totais recalculados.",
            rateSaved: "Tarifa salva para as próximas jornadas.", corrections: "Histórico de correções", none: "Nenhuma correção.",
            before: "Antes", after: "Depois", empty: "Nenhuma jornada neste período.", invalid: "Informe números válidos, sem valores negativos (até 2 casas decimais).",
            changed: "Os dados mudaram. Cancele e abra a correção novamente antes de salvar.",
            activeNote: "Informe a soma total Loja → Backhaul → Base. O valor substitui o total anterior; salvar novamente não duplica milhas nem bônus.",
            initialTrailer: "Trailer inicial", allocation: "O bônus diário fica na primeira jornada com pagamento naquela data.",
            pending: "Aguarde…", field: "Campo", old: "Anterior", next: "Novo"
        },
        en: {
            stops: "Number of stops", additionalStops: "Paid additional stops", stopBonus: "Stop bonus", saveStops: "Update stops", unknown: "Not provided",
            navRegister: "📝 Register", navHistory: "🕘 History", navReports: "📊 Reports", navSettings: "⚙️ Settings", navAbout: "ℹ️ About", navLogout: "👤 Sign out",
            menu: "💵 My Paycheck", title: "My Paycheck", language: "Language", theme: "Toggle theme",
            start: "Journey payment", original: "Original journey miles", backhaul: "Backhaul",
            destination: "Destination / backhaul identifier", extra: "Extra Day", extraValue: "Extra Day amount",
            store: "Store to backhaul miles (accumulated total)", base: "Backhaul to base miles (accumulated total)",
            active: "Active journey payment", saveMiles: "Save additional miles",
            payable: "Payable miles", preview: "Journey estimate (excluding daily weekend bonus)",
            rate: "Rate per mile (US$)", detentionRate: "Detention rate per hour (US$)", detentionMinutes: "Detention minutes", detentionCents: "Detention subtotal", date: "Journey local date", from: "From", to: "To",
            filter: "Show Period", settings: "Rate for new journeys",
            saveRate: "Save rate", rateNote: "Changes apply to new journeys. Existing journeys retain their recorded rate.",
            detentionRateNote: "The detention rate applies only to new records, including during an active journey. Previous detentions retain their historical rate.",
            confirmDetentionRate: "Save this rate for new detentions? Previous records will not change.", detentionRateSaved: "Rate saved for new detentions. Previous amounts preserved.",
            estimate: "Estimated gross pay", disclaimer: "Estimate in US$, before taxes and deductions. Includes active journeys. Saturday/Sunday bonus counts once per local start date. Older journeys without payment data remain at zero until completed.",
            mileage: "Mileage pay", bonusBackhaul: "Backhaul bonus", saturday: "Saturday bonus", sunday: "Sunday bonus",
            extraBonus: "Extra Day bonus", total: "Total", additional: "Additional Backhaul Miles", milesUnit: "miles", truck: "Truck", trailer: "Trailer(s)",
            journey: "Journey", ongoing: "Active", finished: "Completed", legacy: "No payment data (older record)",
            confirm: "Confirm this change? The original record will be updated and the correction added to its history.",
            confirmRate: "Save this rate for future journeys?", saved: "Payment saved. Totals recalculated.",
            rateSaved: "Rate saved for future journeys.", corrections: "Correction history", none: "No corrections.",
            before: "Before", after: "After", empty: "No journeys in this period.", invalid: "Enter valid, nonnegative numbers (up to 2 decimal places).",
            changed: "The data changed. Cancel and reopen the correction before saving.",
            activeNote: "Enter the total Store → Backhaul → Base miles. This replaces the previous total; saving again does not duplicate miles or bonuses.",
            initialTrailer: "Initial trailer", allocation: "The daily bonus is assigned to the first journey with payment data on that date.",
            pending: "Please wait…", field: "Field", old: "Previous", next: "New"
        }
    };
    let language = "pt", activeId = null, activeToken = null, saving = false, startRateCents = TrailerPay.DEFAULT_RATE;
    try { language = localStorage.getItem("trailerlog-language") === "en" ? "en" : "pt"; } catch (_) {}
    const el = id => document.getElementById(id);
    const t = key => messages[language][key] || key;
    const money = cents => new Intl.NumberFormat(language === "en" ? "en-US" : "pt-BR", { style: "currency", currency: "USD" })
        .formatToParts(cents / 100).map(part => part.type === "currency" ? "US$" : part.value).join("");
    const number = value => new Intl.NumberFormat(language === "en" ? "en-US" : "pt-BR", { maximumFractionDigits: 3 }).format(value);
    const distance = value => `${number(value)} ${t("milesUnit")}`;
    function translate() {
        document.querySelectorAll("[data-pay-i18n]").forEach(node => { node.textContent = t(node.dataset.payI18n); });
        document.querySelectorAll("[data-pay-language]").forEach(node => { node.value = language; });
        document.documentElement.lang = language === "en" ? "en" : "pt-BR";
        document.querySelectorAll("[data-pay-form]").forEach(node => preview(node.dataset.payForm));
        window.dispatchEvent(new Event("trailerpaylanguage"));
    }
    function label(key, input) { return `<label><span data-pay-i18n="${key}">${t(key)}</span>${input}</label>`; }
    function numeric(id, value = 0, max = 1000000) { return `<input id="${id}" type="number" inputmode="decimal" min="0" max="${max}" step="0.01" value="${value}" required>`; }
    function form(container, prefix) {
        container.dataset.payForm = prefix;
        container.innerHTML = `<div class="pay-grid">
            ${label("stops", `<select id="${prefix}stops">${[1,2,3,4,5].map(n => `<option value="${n}">${n}</option>`).join("")}</select>`)}
            <div class="pay-original">${label("original", numeric(prefix + "original"))}</div>
            <div class="pay-option">
                <label class="pay-check"><input id="${prefix}backhaul" type="checkbox"><span data-pay-i18n="backhaul">${t("backhaul")}</span></label>
                <div id="${prefix}destinationWrap">${label("destination", `<input id="${prefix}destination" type="text" maxlength="300">`)}</div>
            </div>
            <div class="pay-option">
                <label class="pay-check"><input id="${prefix}extra" type="checkbox"><span data-pay-i18n="extra">${t("extra")}</span></label>
                <div id="${prefix}extraWrap">${label("extraValue", `<select id="${prefix}extraValue">${[150, 200, 250, 300].map(value => `<option value="${value * 100}">US$ ${value.toFixed(2)}</option>`).join("")}</select>`)}</div>
            </div>
            </div><p id="${prefix}preview" role="status" aria-live="polite"></p>`;
        container.addEventListener("input", () => preview(prefix));
        container.addEventListener("change", () => preview(prefix));
        preview(prefix);
    }
    function numericValue(id, additional = false) {
        const value = el(id).value;
        if (value.trim() === "") throw Error(t("invalid"));
        return additional ? TrailerPay.additionalMiles({ additionalBackhaulMiles: Number(value) }) : TrailerPay.miles(Number(value));
    }
    function input(prefix) {
        return TrailerPay.normalize({ version: 1, localDate: TrailerPay.localDate(), rateCents: startRateCents,
            numeroParadas: TrailerPay.stops(Number(el(prefix + "stops").value)), initialTrailer: "", originalMiles: numericValue(prefix + "original"),
            backhaul: el(prefix + "backhaul").checked, destination: el(prefix + "destination").value.trim(),
            extraDayCents: el(prefix + "extra").checked ? Number(el(prefix + "extraValue").value) : 0,
            storeToBackhaul: 0, backhaulToBase: 0, additionalBackhaulMiles: 0 });
    }
    function preview(prefix) {
        const backhaul = el(prefix + "backhaul");
        if (!backhaul) return;
        el(prefix + "destinationWrap").hidden = !backhaul.checked;
        el(prefix + "destination").required = backhaul.checked;
        el(prefix + "extraWrap").hidden = !el(prefix + "extra").checked;
        try {
            const result = TrailerPay.calculate(input(prefix));
            el(prefix + "preview").textContent = `${t("payable")}: ${distance(result.payableMiles)} · ${t("preview")}: ${money(result.totalCents)}`;
        } catch (_) { el(prefix + "preview").textContent = ""; }
    }
    function signature() {
        const mount = el("payJourney");
        return mount ? JSON.stringify([...mount.querySelectorAll("input, select")].map(node => [node.value, node.checked])) : "";
    }
    function active(journey, acceptTarget = true) {
        if (!el("payStart")) return;
        el("payStart").hidden = !!journey;
        el("payActive").hidden = !journey;
        if (acceptTarget) {
            activeId = journey ? journey.id : null;
            try {
                const current = TrailerStorage.read();
                activeToken = current.token;
                startRateCents = current.data.paymentSettings ? current.data.paymentSettings.rateCents : TrailerPay.DEFAULT_RATE;
                preview("startPay");
            } catch (_) { activeToken = null; }
        }
        if (!journey) return;
        const payment = journey.pagamento;
        if (acceptTarget && el("payStops")) el("payStops").value = TrailerPay.stops(payment?.numeroParadas);
        if (el("paySaveStops")) el("paySaveStops").disabled = !payment || saving;
        const detentionTotal = TrailerPay.detentionRecords(journey).reduce((sum, entry) => sum + TrailerPay.detentionCents(entry.minutes, entry.rateCents), 0);
        el("payActiveSummary").textContent = payment ? `${t("payable")}: ${distance(TrailerPay.calculate(payment).payableMiles)} · ${t("preview")}: ${money(TrailerPay.calculate(payment).totalCents + detentionTotal)} · ${t("stops")}: ${TrailerPay.stops(payment.numeroParadas)} · ${t("stopBonus")}: ${money(TrailerPay.calculate(payment).stopBonusCents)}` : t("legacy");
        if (typeof DetentionUI !== "undefined") DetentionUI.mount(el("payActiveDetention"), journey, { activeOnly: true });
        // Preserve draft input while another tab updates the journey.
        if (acceptTarget && el("payAdditional").dataset.journey !== journey.id) {
            el("payAdditional").value = payment ? TrailerPay.additionalMiles(payment) : 0;
            el("payAdditional").dataset.journey = journey.id;
        }
        el("paySaveMiles").disabled = !payment || saving;
    }
    async function saveMiles(event) {
        if (event) event.preventDefault();
        if (saving) return;
        saving = true; el("paySaveMiles").disabled = true;
        try {
            const expected = activeId, token = activeToken;
            const submitted = el("payAdditional").value;
            const additionalBackhaulMiles = numericValue("payAdditional", true);
            if (!window.confirm(t("confirm"))) return;
            await TrailerStorage.change(data => {
                if (!data.jornadaAtiva || data.jornadaAtiva.id !== expected || !data.jornadaAtiva.pagamento) throw Error(t("changed"));
                TrailerPay.edit(data, expected, { ...data.jornadaAtiva.pagamento, additionalBackhaulMiles });
            }, token);
            active(TrailerStorage.read().data.jornadaAtiva);
            if (el("payAdditional").value === submitted) el("payAdditional").value = "";
            el("payJourneyStatus").textContent = t("saved");
        } catch (error) { el("payJourneyStatus").textContent = error.message; }
        finally { saving = false; el("paySaveMiles").disabled = false; }
    }
    async function saveStops(event) {
        event.preventDefault(); if (saving) return;
        saving = true; el("paySaveStops").disabled = true;
        try {
            const expected = activeId, token = activeToken;
            const numeroParadas = TrailerPay.stops(Number(el("payStops").value));
            await TrailerStorage.change(data => {
                if (!data.jornadaAtiva || data.jornadaAtiva.id !== expected || !data.jornadaAtiva.pagamento) throw Error(t("changed"));
                TrailerPay.edit(data, expected, { ...data.jornadaAtiva.pagamento, numeroParadas });
            }, token);
            active(TrailerStorage.read().data.jornadaAtiva);
            el("payJourneyStatus").textContent = t("saved");
        } catch (error) { el("payJourneyStatus").textContent = error.message; }
        finally { saving = false; el("paySaveStops").disabled = false; }
    }
    function setup() {
        document.querySelectorAll("[data-pay-language]").forEach(node => node.addEventListener("change", () => {
            language = node.value === "en" ? "en" : "pt";
            try { localStorage.setItem("trailerlog-language", language); } catch (_) {}
            translate();
        }));
        if (el("payStartForm")) {
            form(el("payStartForm"), "startPay");
            el("payStopsForm").addEventListener("submit", saveStops);
            el("payMilesForm").addEventListener("submit", saveMiles);
            window.addEventListener("trailerpaylanguage", () => {
                try { active(TrailerStorage.read().data.jornadaAtiva, false); } catch (_) {}
            });
            window.addEventListener("trailerdetentionchange", () => {
                try { active(TrailerStorage.read().data.jornadaAtiva); } catch (_) {}
            });
        }
        translate();
    }
    setup();
    function startSignature() {
        return JSON.stringify([...el("payStartForm").querySelectorAll("input, select")].map(node => [node.value, node.checked]));
    }
    function clearStart(submitted) {
        if (startSignature() !== submitted) return;
        for (const suffix of ["original", "destination"]) el("startPay" + suffix).value = "";
        for (const suffix of ["backhaul", "extra"]) el("startPay" + suffix).checked = false;
        el("startPayextraValue").selectedIndex = 0;
        el("startPaystops").value = "1";
        preview("startPay");
    }
    return { t, money, number, distance, translate, form, input, signature, active, startSignature, clearStart, get language() { return language; },
        startInput: () => input("startPay") };
})();
