/* Read-only projection. Financial amounts come exclusively from TrailerPay. */
const DetailedReport = (() => {
    const labels = {
        pt: { title: "Trailer Log — Relatório Detalhado", toggle: "Relatório Detalhado", print: "Imprimir / Salvar PDF",
            reportTitle: "Relatório Detalhado de Pagamentos", issued: "Data de emissão", executive: "Resumo executivo",
            periodTotals: "Totais do período por categoria", category: "Categoria", quantity: "Distância", appliedRate: "Tarifa aplicada",
            journeyId: "Identificação da jornada", date: "Data", time: "Horário", trailer: "Trailer",
            period: "Período", summary: "Resumo do período", journeys: "Quantidade de jornadas", trucks: "Caminhões utilizados", trailers: "Trailers utilizados",
            backhauls: "Quantidade de backhauls", trip: "Dados da jornada", mileage: "Milhas", bonuses: "Pagamentos e bônus",
            startDate: "Data de início", startTime: "Horário de início", endDate: "Data de finalização", endTime: "Horário de finalização",
            duration: "Duração total da jornada", truck: "Caminhão", initialTrailer: "Trailer inicial", allTrailers: "Todos os trailers utilizados",
            trailerHistory: "Histórico de registros e trocas de trailer", truckHistory: "Histórico registrado de caminhões e trocas",
            destination: "Loja ou destino registrado", backhaul: "Empresa do Backhaul", status: "Estado", active: "Ativa", finished: "Finalizada",
            originalMiles: "Milhas originais", initialMiles: "Milhas iniciais pagáveis", additionalMiles: "Milhas adicionais do Backhaul", payableMiles: "Total de milhas pagáveis",
            stops: "Número de paradas", additionalStops: "Paradas adicionais remuneradas", stopBonusCents: "Bônus por paradas", rate: "Tarifa histórica por milha", mileageCents: "Valor das milhas", backhaulCents: "Bônus de backhaul", saturdayCents: "Bônus de sábado",
            sundayCents: "Bônus de domingo", extraDayCents: "Dia Extra — valor selecionado", detention: "Registros de detenção", detentionDate: "Data da detenção",
            detentionMinutes: "Detenção remunerada", hourlyRate: "Tarifa histórica por hora", amount: "Valor", detentionCents: "Total de detenção",
            totalCents: "TOTAL BRUTO ESTIMADO", unknown: "Não informado", empty: "Nenhuma jornada neste período.", noDetention: "Nenhuma detenção registrada neste período.",
            note: "Estimativa bruta em US$, antes de impostos e descontos. Totais somam os valores registrados e conhecidos. Informações ausentes não são estimadas.",
            excluded: "A data de início/pagamento desta jornada está fora do filtro ou não foi informada. Somente as detenções nas datas selecionadas entram nos valores deste período.",
            undated: "Jornadas sem data de pagamento/início não podem ser atribuídas ao período. São incluídas somente se houver detenções datadas no intervalo.",
            denied: "Não foi possível imprimir. Confira sua sessão e o período selecionado.", miles: "milhas", hours: "horas", hour: "hora", minutes: "minutos", minute: "minuto" },
        en: { title: "Trailer Log — Detailed Report", toggle: "Detailed Report", print: "Print / Save PDF",
            reportTitle: "Detailed Payment Report", issued: "Issue date", executive: "Executive summary",
            periodTotals: "Period totals by category", category: "Category", quantity: "Distance", appliedRate: "Applied rate",
            journeyId: "Journey ID", date: "Date", time: "Time", trailer: "Trailer",
            period: "Period", summary: "Period summary", journeys: "Number of journeys", trucks: "Trucks used", trailers: "Trailers used",
            backhauls: "Number of backhauls", trip: "Journey details", mileage: "Miles", bonuses: "Payments and bonuses",
            startDate: "Start date", startTime: "Start time", endDate: "End date", endTime: "End time", duration: "Total journey duration",
            truck: "Truck", initialTrailer: "Initial trailer", allTrailers: "All trailers used", trailerHistory: "Trailer records and change history",
            truckHistory: "Recorded truck and change history", destination: "Recorded store or destination", backhaul: "Backhaul Company", status: "Status", active: "Active", finished: "Completed",
            originalMiles: "Original miles", initialMiles: "Initial payable miles", additionalMiles: "Additional Backhaul Miles", payableMiles: "Total payable miles",
            stops: "Number of stops", additionalStops: "Paid additional stops", stopBonusCents: "Stop bonus", rate: "Historical rate per mile", mileageCents: "Mileage pay", backhaulCents: "Backhaul bonus", saturdayCents: "Saturday bonus",
            sundayCents: "Sunday bonus", extraDayCents: "Extra Day — selected amount", detention: "Detention records", detentionDate: "Detention date",
            detentionMinutes: "Paid detention", hourlyRate: "Historical hourly rate", amount: "Amount", detentionCents: "Detention total",
            totalCents: "ESTIMATED GROSS TOTAL", unknown: "Not provided", empty: "No journeys in this period.", noDetention: "No detention recorded in this period.",
            note: "Gross estimate in US$, before taxes and deductions. Totals sum recorded, known amounts. Missing information is not estimated.",
            excluded: "This journey's start/payment date is outside the filter or missing. Only detentions on the selected dates count toward this period's amounts.",
            undated: "Journeys without a payment/start date cannot be assigned to the period. They are included only if dated detentions fall within the interval.",
            denied: "Unable to print. Check your session and selected period.", miles: "miles", hours: "hours", hour: "hour", minutes: "minutes", minute: "minute" }
    };
    const language = () => typeof PaycheckUI !== "undefined" && PaycheckUI.language === "en" ? "en" : "pt";
    const t = key => labels[language()][key] || key;
    const text = value => typeof value === "string" && value.trim() ? value.trim() : null;
    const date = value => typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value)) ? new Date(value) : null;
    const locale = () => language() === "en" ? "en-US" : "pt-BR";
    function first(...values) { return values.map(text).find(Boolean) || null; }
    function byTime(a, b) {
        const start = date(a.at), end = date(b.at);
        return start && end ? start - end : start ? -1 : end ? 1 : 0;
    }
    function backhaulCompanies(journey) {
        // Use the original payload, not just normalize()'s financial projection.
        const raw = journey.pagamento || {}, previous = journey.payment || {};
        const named = value => !value || typeof value !== "object" ? text(value) : first(value.companyName, value.company,
            value.empresa, value.name, value.nome, value.destination, value.identifier);
        const aliases = source => first(source.backhaulCompany, source.backhaulName, source.empresaBackhaul,
            source.nomeBackhaul, source.backhaulEmpresa, source.backhaul_company, source.backhaul_name, source.empresa_backhaul);
        const current = first(raw.backhaul === true ? raw.destination : null, aliases(raw), aliases(journey),
            previous.backhaul === true ? previous.destination : null, aliases(previous),
            typeof journey.backhaul !== "boolean" ? named(journey.backhaul) : null);
        const groups = [raw.backhauls, journey.backhauls, previous.backhauls, journey.backhaulRecords, journey.empresasBackhaul];
        const entries = groups.filter(Array.isArray).flatMap(group => group.map(named));
        // Lists may contain separate visits to the same company: keep every recorded entry.
        // The single canonical field is often a mirror of one listed entry, not another visit.
        if (current && !entries.includes(current)) entries.unshift(current);
        if (!entries.length && (raw.backhaul === true || journey.backhaul === true || previous.backhaul === true)) entries.push(null);
        return entries;
    }
    function metadata(data, row) {
        const j = row.journey, p = row.payment;
        const trailerHistory = data.trailersSalvos.filter(entry => entry.jornadaId === j.id)
            .map(entry => ({ trailer: text(entry.trailer), at: date(entry.data) ? entry.data : null }));
        trailerHistory.sort(byTime);
        // Only explicit recorded histories are shown; a truck change is never inferred.
        const recordedTrucks = Array.isArray(j.truckHistory) ? j.truckHistory : Array.isArray(j.historicoTrucks) ? j.historicoTrucks : [];
        const truckHistory = recordedTrucks.filter(entry => entry && typeof entry === "object")
            .map(entry => ({ truck: first(entry.truck, entry.numero), at: first(entry.at, entry.data) }))
            .filter(entry => entry.truck);
        truckHistory.sort(byTime);
        const initialTrailer = first(p && p.initialTrailer, j.initialTrailer, j.trailerInicial);
        const trailers = [...new Set([initialTrailer, text(j.trailer), ...trailerHistory.map(entry => entry.trailer)].filter(Boolean))];
        const trucks = [...new Set([text(j.truck), ...truckHistory.map(entry => entry.truck)].filter(Boolean))];
        const start = date(j.inicio), end = date(j.fim);
        const durationMinutes = start && end && end >= start ? Math.floor((end - start) / 60000) : null;
        const companies = backhaulCompanies(j);
        return { ...row, start: start ? j.inicio : null, end: end ? j.fim : null, durationMinutes,
            initialTrailer, trailers, trucks, trailerHistory, truckHistory,
            destination: first(j.loja, j.store, j.destino, j.destination),
            backhaul: companies[0] || null, backhaulCompanies: companies,
            // Reuse the existing miles engine; do not introduce a second division rule.
            initialMiles: p ? TrailerPay.calculate({ ...p, additionalBackhaulMiles: 0 }).payableMiles : null };
    }
    function build(data, from, to) {
        const calculated = TrailerPay.report(data, from, to);
        const rows = calculated.rows.map(row => metadata(data, row)).sort((a, b) =>
            (a.date || "9999").localeCompare(b.date || "9999") || byTime({ at: a.start }, { at: b.start }) || a.journey.id.localeCompare(b.journey.id));
        const all = [...data.jornadasSalvas, ...(data.jornadaAtiva ? [data.jornadaAtiva] : [])];
        return { from, to, issuedAt: new Date().toISOString(), rows, totals: calculated.totals,
            trucks: [...new Set(rows.flatMap(row => row.trucks))], trailers: [...new Set(rows.flatMap(row => row.trailers))],
            backhauls: rows.filter(row => row.paymentIncluded && row.payment && row.payment.backhaul).length,
            hasUndated: all.some(j => !j.pagamento && !date(j.inicio)) };
    }
    function render(container, report) {
        const ui = PaycheckUI;
        const node = (tag, content, parent, className) => {
            const item = document.createElement(tag);
            if (content !== undefined) item.textContent = content;
            if (className) item.className = className;
            if (parent) parent.appendChild(item);
            return item;
        };
        const known = value => value === null || value === undefined || value === "" ? t("unknown") : value;
        const distance = value => value === null || value === undefined ? t("unknown") : `${ui.number(value)} ${t("miles")}`;
        const duration = value => value === null || value === undefined ? t("unknown") :
            `${Math.floor(value / 60)} ${t(Math.floor(value / 60) === 1 ? "hour" : "hours")} ${value % 60} ${t(value % 60 === 1 ? "minute" : "minutes")}`;
        const money = value => value === null || value === undefined ? t("unknown") : ui.money(value);
        const day = value => TrailerPay.dateValid(value) ? new Intl.DateTimeFormat(locale()).format(new Date(value + "T12:00:00")) : t("unknown");
        const stamp = (value, time) => !date(value) ? t("unknown") : time ? new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(date(value)) : new Intl.DateTimeFormat(locale()).format(date(value));
        function pairs(parent, entries) {
            const dl = node("dl", undefined, parent, "pay-breakdown");
            for (const [key, value] of entries) { const pair = node("div", undefined, dl); node("dt", t(key), pair); node("dd", known(value), pair); }
        }
        function table(parent, headers, rows, className = "") {
            const grid = node("table", undefined, parent, "detailed-table " + className);
            grid.setAttribute("role", "table");
            const head = node("tr", undefined, node("thead", undefined, grid));
            for (const key of headers) node("th", t(key), head).scope = "col";
            const body = node("tbody", undefined, grid);
            for (const values of rows) {
                const line = node("tr", undefined, body);
                for (let index = 0; index < values.length; index++) {
                    const cell = node("td", known(values[index]), line, index ? "report-value" : "");
                    cell.dataset.label = t(headers[index]);
                }
            }
            return grid;
        }
        function section(card, title) {
            const block = node("section", undefined, card, "detailed-section"); node("h4", t(title), block); return block;
        }
        container.replaceChildren();
        const header = node("header", undefined, container, "detailed-heading");
        node("p", "TRAILER LOG", header, "report-brand");
        node("h2", t("reportTitle"), header);
        const meta = node("div", undefined, header, "report-meta");
        node("p", `${t("period")}: ${day(report.from)} — ${day(report.to)}`, meta);
        node("p", `${t("issued")}: ${stamp(report.issuedAt)}`, meta);
        node("p", t("note"), header, "report-note");
        const executive = node("section", undefined, container, "detailed-summary");
        node("h3", t("executive"), executive);
        pairs(executive, [["journeys", String(report.rows.length)], ["payableMiles", distance(report.totals.payableMiles)], ["totalCents", money(report.totals.totalCents)]]);
        if (report.hasUndated) node("p", t("undated"), container, "report-note");
        if (!report.rows.length) node("p", t("empty"), container);
        let previousDay;
        for (let index = 0; index < report.rows.length; index++) {
            const row = report.rows[index];
            if (row.date !== previousDay) { node("h3", day(row.date), container, "detailed-day"); previousDay = row.date; }
            const card = node("section", undefined, container, "pay-card detailed-journey");
            const heading = node("header", undefined, card, "journey-heading");
            node("h3", `${String(index + 1).padStart(2, "0")} · ${t("truck")}: ${known(row.journey.truck)}`, heading);
            node("p", `${t("journeyId")}: ${row.journey.id}`, heading, "report-reference");
            node("p", `${t("status")}: ${row.active ? t("active") : row.end || row.journey.status === "Finalizada" ? t("finished") : t("unknown")}`, heading, "report-status");
            const trip = section(card, "trip");
            pairs(trip, [["startDate", `${stamp(row.start)} · ${stamp(row.start, true)}`], ["endDate", `${stamp(row.end)} · ${stamp(row.end, true)}`],
                ["duration", duration(row.durationMinutes)], ["truck", row.journey.truck], ["initialTrailer", row.initialTrailer],
                ["allTrailers", row.trailers.join(", ") || null], ["destination", row.destination]]);
            const companies = section(card, "backhaul"); companies.className += " backhaul-companies";
            if (!row.backhaulCompanies.length) node("p", t("unknown"), companies);
            else table(companies, ["backhaul"], row.backhaulCompanies.map(company => [known(company)]), "company-table");
            for (const [key, entries, id] of [["trailerHistory", row.trailerHistory, "trailer"], ["truckHistory", row.truckHistory, "truck"]]) {
                const history = section(card, key);
                if (!entries.length) node("p", t("unknown"), history);
                else table(history, [id, "date", "time"], entries.map(entry => [known(entry[id]), stamp(entry.at), stamp(entry.at, true)]));
            }
            if (!row.paymentIncluded) node("p", t("excluded"), card, "report-note");
            table(section(card, "mileage"), ["category", "quantity", "appliedRate", "amount"], [
                [t("originalMiles"), distance(row.payment ? row.payment.originalMiles : null), "—", "—"],
                [t("initialMiles"), distance(row.initialMiles), "—", "—"],
                [t("additionalMiles"), distance(row.payment ? TrailerPay.additionalMiles(row.payment) : null), "—", "—"],
                [t("payableMiles"), distance(row.payment ? row.payableMiles : null), money(row.payment ? row.payment.rateCents : null), money(row.payment ? row.mileageCents : null)]
            ], "mileage-table");
            if (row.payment) pairs(card, [["stops", ui.number(row.numeroParadas)], ["additionalStops", ui.number(row.additionalStops)]]);
            table(section(card, "bonuses"), ["category", "amount"], ["stopBonusCents", "backhaulCents", "saturdayCents", "sundayCents", "extraDayCents"].map(key => [t(key), money(row.payment ? row[key] : null)]), "amount-table");
            const detained = section(card, "detention");
            if (!row.detentions.length) node("p", t("noDetention"), detained);
            else table(detained, ["detentionDate", "detentionMinutes", "hourlyRate", "amount"], [...row.detentions].sort((a,b)=>a.localDate.localeCompare(b.localDate)).map(entry => [
                day(entry.localDate), `${entry.minutes} ${t("minutes")} (${duration(entry.minutes)})`, money(entry.rateCents), money(TrailerPay.detentionCents(entry.minutes, entry.rateCents))
            ]), "detention-table");
            const subtotal = node("div", undefined, detained, "report-subtotal");
            node("span", `${t("detentionCents")} · ${duration(row.detentionMinutes)}`, subtotal); node("strong", money(row.detentionCents), subtotal);
            const total = node("div", undefined, card, "detailed-total"); node("span", t("totalCents"), total); node("strong", money(row.totalCents), total);
        }
        const closing = node("section", undefined, container, "detailed-period-totals");
        node("h3", t("periodTotals"), closing);
        pairs(closing, [["journeys", String(report.rows.length)], ["trucks", report.trucks.join(", ") || null], ["trailers", report.trailers.join(", ") || null],
            ["originalMiles", distance(report.totals.originalMiles)], ["additionalMiles", distance(report.totals.additionalMiles)], ["payableMiles", distance(report.totals.payableMiles)],
            ["backhauls", String(report.backhauls)], ["detentionMinutes", duration(report.totals.detentionMinutes)]]);
        table(closing, ["category", "amount"], ["mileageCents", "stopBonusCents", "backhaulCents", "saturdayCents", "sundayCents", "extraDayCents", "detentionCents"].map(key => [t(key), money(report.totals[key])]), "amount-table");
        const total = node("div", undefined, closing, "detailed-total report-grand-total"); node("span", t("totalCents"), total); node("strong", money(report.totals.totalCents), total);
    }
    return { build, render, t, backhaulCompanies };
})();

// Native print integration. Every render/print reads the currently authorized account.
if (typeof document !== "undefined" && document.getElementById("payDetailToggle")) (() => {
    const el = id => document.getElementById(id), api = DetailedReport;
    const toggle = el("payDetailToggle"), print = el("payPrint"), region = el("payDetailed");
    function access() { TrailerAuth.scope(); return !document.querySelector(".app-layout").hidden; }
    function refresh(snapshot) {
        if (!access()) throw Error(api.t("denied"));
        const current = snapshot || TrailerStorage.read();
        const from = el("payFrom").value || el("payTo").value, to = el("payTo").value || el("payFrom").value;
        api.render(region, api.build(current.data, from, to));
    }
    function clear() {
        document.body.classList.remove("pay-print-ready"); region.replaceChildren(); region.hidden = true;
        toggle.setAttribute("aria-expanded", "false"); print.disabled = true; toggle.disabled = true;
    }
    function translate() { toggle.textContent = api.t("toggle"); print.textContent = api.t("print"); el("payPrintDenied").textContent = api.t("denied"); }
    toggle.addEventListener("click", () => {
        try { if (region.hidden) refresh(); region.hidden = !region.hidden; toggle.setAttribute("aria-expanded", String(!region.hidden)); }
        catch (error) { el("payStatus").textContent = error.message; }
    });
    function beforePrint() {
        try { refresh(); document.body.classList.add("pay-print-ready"); }
        catch (_) { document.body.classList.remove("pay-print-ready"); region.replaceChildren(); }
    }
    print.addEventListener("click", async () => {
        print.disabled = true;
        try {
            const owner = TrailerAuth.scope(); await TrailerAuth.authorize(owner);
            if (TrailerAuth.scope() !== owner) throw Error(api.t("denied"));
            refresh(); document.body.classList.add("pay-print-ready"); window.print();
        } catch (error) { el("payStatus").textContent = error.message; }
        finally { document.body.classList.remove("pay-print-ready"); try { print.disabled = !access(); } catch (_) { print.disabled = true; } }
    });
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", () => document.body.classList.remove("pay-print-ready"));
    window.addEventListener("trailerpaylanguage", () => { translate(); if (!region.hidden) { try { refresh(); } catch (_) { clear(); } } });
    for (const name of ["traileraccountchange", "offline", "pagehide"]) window.addEventListener(name, clear);
    window.addEventListener("traileraccountready", () => {
        try { print.disabled = toggle.disabled = !access(); } catch (_) { clear(); }
    });
    el("payFilter").addEventListener("submit", () => { if (!region.hidden) { try { refresh(); } catch (_) { region.replaceChildren(); } } });
    TrailerStorage.subscribe(snapshot => {
        print.disabled = toggle.disabled = false;
        if (!region.hidden) { try { refresh(snapshot); } catch (_) { region.replaceChildren(); } }
    }, clear);
    translate();
})();
