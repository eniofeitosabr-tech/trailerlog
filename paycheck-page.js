(() => {
    const el = id => document.getElementById(id);
    const ui = PaycheckUI;
    let current = null, busy = false;
    const fields = { originalMiles: "original", additionalMiles: "additional", payableMiles: "payable", mileageCents: "mileage",
        stopBonusCents: "stopBonus", backhaulCents: "bonusBackhaul", saturdayCents: "saturday", sundayCents: "sunday", extraDayCents: "extraBonus",
        detentionMinutes: "detentionMinutes", detentionCents: "detentionCents", totalCents: "total" };
    function node(tag, text, parent, className) {
        const item = document.createElement(tag);
        if (text !== undefined) item.textContent = text;
        if (className) item.className = className;
        if (parent) parent.appendChild(item);
        return item;
    }
    function pairs(parent, entries) {
        const dl = node("dl", undefined, parent, "pay-breakdown");
        for (const [label, value] of entries) {
            const pair = node("div", undefined, dl);
            node("dt", label, pair); node("dd", value, pair);
        }
    }
    function format(field, value) {
        if (/Cents$/.test(field)) return ui.money(value);
        return ui.number(value) + (/Miles$/.test(field) ? " " + ui.t("milesUnit") : "");
    }
    function dateLabel(value) {
        if (!TrailerPay.dateValid(value)) return ui.t("unknown");
        return new Intl.DateTimeFormat(document.documentElement.lang === "en" ? "en-US" : "pt-BR").format(new Date(value + "T12:00:00"));
    }
    const auditLabels = { localDate: "date", originalMiles: "original", storeToBackhaul: "store", backhaulToBase: "base",
        numeroParadas: "stops", backhaul: "backhaul", destination: "destination", extraDayCents: "extraBonus", rateCents: "rate", initialTrailer: "initialTrailer",
        payableMiles: "payable", additionalBackhaulMiles: "additional", backhaulBonusCents: "bonusBackhaul" };
    function auditValue(field, value) {
        if (value === undefined || value === null || value === "") return "—";
        if (typeof value === "boolean") return value ? "✓" : "—";
        if (/Cents$/.test(field)) return ui.money(value);
        if (field === "localDate") return dateLabel(value);
        return typeof value === "number" ? ui.number(value) + (/Miles$/.test(field) || ["storeToBackhaul", "backhaulToBase"].includes(field) ? " " + ui.t("milesUnit") : "") : value;
    }
    function history(parent, journey) {
        const details = node("details", undefined, parent);
        node("summary", `${ui.t("corrections")} (${(journey.pagamentoCorrecoes || []).length})`, details);
        if (!journey.pagamentoCorrecoes || !journey.pagamentoCorrecoes.length) return node("p", ui.t("none"), details);
        for (const change of journey.pagamentoCorrecoes) {
            node("h4", new Date(change.at).toLocaleString(document.documentElement.lang === "en" ? "en-US" : "pt-BR"), details);
            const value = (snapshot, key) => !snapshot ? undefined : key === "additionalBackhaulMiles" ? TrailerPay.additionalMiles(snapshot) : snapshot[key];
            const entries = Object.entries(auditLabels).filter(([key]) => !change.before || value(change.before, key) !== value(change.after, key));
            pairs(details, entries.map(([key, label]) => [ui.t(label), `${ui.t("before")}: ${auditValue(key, value(change.before, key))} → ${ui.t("after")}: ${auditValue(key, value(change.after, key))}`]));
        }
    }
    function render() {
        if (!current) return;
        try {
            const from = el("payFrom").value || el("payTo").value;
            const to = el("payTo").value || el("payFrom").value;
            const result = TrailerPay.report(current.data, from, to);
            el("payTotal").textContent = ui.money(result.totals.totalCents);
            el("payTotals").replaceChildren();
            pairs(el("payTotals"), Object.entries(fields).map(([field, label]) => [ui.t(label), format(field, result.totals[field])]));
            const list = el("payReport"); list.replaceChildren();
            if (!result.rows.length) node("p", ui.t("empty"), list);
            for (const row of result.rows) {
                const card = node("article", undefined, list, "pay-card");
                node("h2", `${dateLabel(row.date)} · ${ui.t("truck")} ${row.journey.truck}`, card);
                node("p", ui.t(row.active ? "ongoing" : "finished"), card);
                node("p", ui.t("journey") + ": " + row.journey.id, card, "report-reference");
                const trailers = new Set([row.payment && row.payment.initialTrailer, row.journey.trailer,
                    ...current.data.trailersSalvos.filter(use => use.jornadaId === row.journey.id).map(use => use.trailer)].filter(Boolean));
                pairs(card, [[ui.t("trailer"), [...trailers].join(", ") || "—"],
                    [ui.t("destination"), row.payment ? row.payment.destination || "—" : "—"],
                    ...Object.entries(fields).map(([field, label]) => [ui.t(label), format(field, row[field])])]);
                if (row.payment) pairs(card, [[ui.t("rate"), ui.money(row.payment.rateCents)], [ui.t("stops"), ui.number(row.numeroParadas)], [ui.t("additionalStops"), ui.number(row.additionalStops)]]);
                else node("p", ui.t("legacy"), card);
                if (typeof DetentionUI !== "undefined") {
                    if (!row.paymentIncluded) node("p", DetentionUI.t("outside"), card);
                    DetentionUI.mount(node("section", undefined, card), row.journey, { entries: row.detentions, token: current.token });
                }
                history(card, row.journey);
            }
        } catch (error) {
            el("payTotals").replaceChildren(); el("payReport").replaceChildren(); el("payTotal").textContent = "—";
            el("payStatus").textContent = error.message;
        }
    }
    function clearReport() {
        current = null;
        el("payTotals").replaceChildren(); el("payReport").replaceChildren(); el("payTotal").textContent = "—";
    }
    window.addEventListener("traileraccountchange", clearReport);
    el("payFilter").addEventListener("submit", event => { event.preventDefault(); el("payStatus").textContent = ""; render(); });
    el("payRateForm").addEventListener("submit", async event => {
        event.preventDefault();
        if (busy) return;
        try {
            const raw = Number(el("payRate").value);
            TrailerPay.miles(raw);
            const rateCents = TrailerPay.newRate(Math.round(raw * 100));
            const snapshot = TrailerStorage.read();
            if (!window.confirm(ui.t("confirmRate"))) return;
            busy = true; el("paySaveRate").disabled = true;
            await TrailerStorage.change(data => { data.paymentSettings = { ...(data.paymentSettings || {}), rateCents }; }, snapshot.token);
            el("payStatus").textContent = ui.t("rateSaved");
        } catch (error) { el("payStatus").textContent = error.message; }
        finally { busy = false; el("paySaveRate").disabled = false; }
    });
    el("payTheme").addEventListener("click", () => TrailerTheme.toggle());
    el("payDetentionRateForm").addEventListener("submit", async event => {
        event.preventDefault();
        if (busy) return;
        try {
            const raw = Number(el("payDetentionRate").value);
            TrailerPay.miles(raw);
            const detentionRateCents = TrailerPay.rate(Math.round(raw * 100));
            const snapshot = TrailerStorage.read();
            if (!window.confirm(ui.t("confirmDetentionRate"))) return;
            busy = true; el("paySaveDetentionRate").disabled = true;
            await TrailerStorage.change(data => {
                data.paymentSettings = { rateCents: TrailerPay.DEFAULT_RATE, ...(data.paymentSettings || {}), detentionRateCents };
            }, snapshot.token);
            el("payStatus").textContent = ui.t("detentionRateSaved");
        } catch (error) { el("payStatus").textContent = error.message; }
        finally { busy = false; el("paySaveDetentionRate").disabled = false; }
    });
    const today = TrailerPay.localDate();
    el("payFrom").value = today.slice(0, 8) + "01"; el("payTo").value = today;
    window.addEventListener("trailerpaylanguage", () => { document.title = "Trailer Log · " + ui.t("title"); render(); });
    document.title = "Trailer Log · " + ui.t("title");
    let initialized = false;
    TrailerStorage.subscribe(snapshot => {
        current = snapshot;
        if (!initialized) {
            initialized = true;
            el("payRate").value = (snapshot.data.paymentSettings ? snapshot.data.paymentSettings.rateCents : TrailerPay.DEFAULT_RATE) / 100;
            el("payDetentionRate").value = (snapshot.data.paymentSettings && snapshot.data.paymentSettings.detentionRateCents !== undefined ? snapshot.data.paymentSettings.detentionRateCents : TrailerPay.DEFAULT_DETENTION_RATE) / 100;
        }
        render();
    }, error => { clearReport(); el("payStatus").textContent = error.message; });
})();
