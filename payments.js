/* Pure payment rules. Money is calculated in cents; no network or storage here. */
const TrailerPay = (() => {
    const DEFAULT_RATE = 65, DEFAULT_DETENTION_RATE = 1500, BACKHAUL = 5150, WEEKEND = 5000;
    const extras = [0, 15000, 20000, 25000, 30000];
    const fail = () => { throw Error("Dados de pagamento inválidos. Confira datas, milhas e valores. / Invalid payment data. Check dates, miles and amounts."); };
    const copy = value => JSON.parse(JSON.stringify(value));
    function dateValid(value) {
        return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
            Number.isFinite(Date.parse(value + "T12:00:00Z")) && new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
    }
    function localDate(value = new Date()) {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) fail();
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    }
    function miles(value) {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) fail();
        return value;
    }
    function rate(value) {
        if (!Number.isSafeInteger(value) || value < 1 || value > 100000) fail();
        return value;
    }
    function additionalMiles(input) {
        if (input.additionalBackhaulMiles !== undefined) {
            const value = input.additionalBackhaulMiles;
            // Each legacy leg allowed one million miles; preserve their full sum.
            if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2000000 ||
                Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) fail();
            return value;
        }
        return (Math.round(miles(input.storeToBackhaul) * 100) + Math.round(miles(input.backhaulToBase) * 100)) / 100;
    }
    function normalize(input) {
        if (!input || input.version !== 1 || !dateValid(input.localDate) || typeof input.backhaul !== "boolean" ||
            typeof input.destination !== "string" || input.destination.length > 300 ||
            (input.backhaul && !input.destination.trim()) || !extras.includes(input.extraDayCents) ||
            typeof input.initialTrailer !== "string" || input.initialTrailer.length > 300) fail();
        const payment = { version: 1, localDate: input.localDate, originalMiles: miles(input.originalMiles),
            storeToBackhaul: miles(input.storeToBackhaul === undefined && input.additionalBackhaulMiles !== undefined ? 0 : input.storeToBackhaul),
            backhaulToBase: miles(input.backhaulToBase === undefined && input.additionalBackhaulMiles !== undefined ? 0 : input.backhaulToBase),
            backhaul: input.backhaul, destination: input.destination.trim(), extraDayCents: input.extraDayCents,
            rateCents: rate(input.rateCents), initialTrailer: input.initialTrailer };
        // Persist originals and derived payable miles separately; always recompute derived fields.
        if (input.additionalBackhaulMiles !== undefined) payment.additionalBackhaulMiles = additionalMiles(input);
        const additional = Math.round(additionalMiles(payment) * 100);
        payment.payableMiles = ((payment.backhaul ? 1 : 2) * Math.round(payment.originalMiles * 100) + 2 * additional) / 200;
        payment.backhaulBonusCents = payment.backhaul ? BACKHAUL : 0;
        return payment;
    }
    function validateData(data) {
        if (data.paymentSettings !== undefined) rate(data.paymentSettings.rateCents);
        if (data.paymentSettings && data.paymentSettings.detentionRateCents !== undefined) rate(data.paymentSettings.detentionRateCents);
        for (const journey of [...data.jornadasSalvas, ...(data.jornadaAtiva ? [data.jornadaAtiva] : [])]) {
            detentionRecords(journey);
            if (journey.detentionCorrections !== undefined) {
                if (!Array.isArray(journey.detentionCorrections)) fail();
                for (const change of journey.detentionCorrections) {
                    if (!change || typeof change.at !== "string" || !Number.isFinite(Date.parse(change.at)) ||
                        typeof change.detentionId !== "string" || (!change.before && !change.after)) fail();
                    for (const entry of [change.before, change.after]) {
                        if (entry !== null && detention(entry).id !== change.detentionId) fail();
                    }
                }
            }
            if (journey.pagamento !== undefined) normalize(journey.pagamento);
            if (journey.pagamentoCorrecoes !== undefined) {
                if (!Array.isArray(journey.pagamentoCorrecoes)) fail();
                for (const correction of journey.pagamentoCorrecoes) {
                    if (!correction || typeof correction.at !== "string" || !Number.isFinite(Date.parse(correction.at))) fail();
                    if (correction.before !== null) normalize(correction.before);
                    normalize(correction.after);
                }
            }
        }
    }
    function create(input, journey, settings) {
        return normalize({ ...input, version: 1, localDate: localDate(journey.inicio),
            rateCents: settings ? rate(settings.rateCents) : DEFAULT_RATE, initialTrailer: journey.trailer || "" });
    }
    function calculate(payment) {
        const p = normalize(payment);
        // Hundredths of miles are integers. Backhaul can produce half a hundredth.
        const originalUnits = Math.round(p.originalMiles * 100);
        const additionalUnits = Math.round(additionalMiles(p) * 100);
        const payableUnits = (p.backhaul ? originalUnits : originalUnits * 2) + additionalUnits * 2;
        const mileageCents = Math.round(payableUnits * p.rateCents / 200);
        const backhaulCents = p.backhaul ? BACKHAUL : 0;
        return { originalMiles: p.originalMiles, additionalMiles: additionalUnits / 100,
            payableMiles: payableUnits / 200, mileageCents, backhaulCents,
            extraDayCents: p.extraDayCents, saturdayCents: 0, sundayCents: 0,
            totalCents: mileageCents + backhaulCents + p.extraDayCents };
    }
    function report(data, from, to) {
        if (!dateValid(from) || !dateValid(to) || from > to) fail();
        validateData(data);
        const unique = new Map();
        for (const journey of data.jornadasSalvas) if (!unique.has(journey.id)) unique.set(journey.id, journey);
        if (data.jornadaAtiva && !unique.has(data.jornadaAtiva.id)) unique.set(data.jornadaAtiva.id, data.jornadaAtiva);
        const all = [...unique.values()].map(journey => {
            const payment = journey.pagamento === undefined ? null : normalize(journey.pagamento);
            return { journey, payment, date: payment ? payment.localDate : journey.inicio && Number.isFinite(Date.parse(journey.inicio)) ? localDate(journey.inicio) : null,
                active: !!data.jornadaAtiva && data.jornadaAtiva.id === journey.id,
                ...(payment ? calculate(payment) : { originalMiles: 0, additionalMiles: 0, payableMiles: 0,
                    mileageCents: 0, backhaulCents: 0, extraDayCents: 0, saturdayCents: 0, sundayCents: 0, totalCents: 0 }) };
        }).sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.journey.inicio || "").localeCompare(String(b.journey.inicio || "")) || a.journey.id.localeCompare(b.journey.id));
        const days = new Set();
        for (const row of all) {
            if (!row.payment || days.has(row.date)) continue;
            days.add(row.date);
            const day = new Date(row.date + "T12:00:00Z").getUTCDay();
            if (day === 6) row.saturdayCents = WEEKEND;
            if (day === 0) row.sundayCents = WEEKEND;
            row.totalCents += row.saturdayCents + row.sundayCents;
        }
        const fields = ["originalMiles", "additionalMiles", "payableMiles", "mileageCents", "backhaulCents", "extraDayCents", "saturdayCents", "sundayCents", "totalCents"];
        // Mileage/bonuses retain their journey date. Detention uses its own local date.
        for (const row of all) {
            row.paymentIncluded = !!row.date && row.date >= from && row.date <= to;
            if (!row.paymentIncluded) for (const field of fields) row[field] = 0;
            row.detentions = detentionRecords(row.journey).filter(entry => entry.localDate >= from && entry.localDate <= to);
            row.detentionMinutes = row.detentions.reduce((sum, entry) => sum + entry.minutes, 0);
            row.detentionCents = row.detentions.reduce((sum, entry) => sum + detentionCents(entry.minutes, entry.rateCents), 0);
            if (!Number.isSafeInteger(row.detentionMinutes) || !Number.isSafeInteger(row.detentionCents) || !Number.isSafeInteger(row.totalCents + row.detentionCents)) fail();
            row.totalCents += row.detentionCents;
        }
        const rows = all.filter(row => row.paymentIncluded || row.detentions.length);
        fields.push("detentionMinutes", "detentionCents");
        const totals = Object.fromEntries(fields.map(field => [field, rows.reduce((sum, row) => sum + row[field], 0)]));
        for (const field of fields.filter(name => name.endsWith("Cents") || name === "detentionMinutes")) if (!Number.isSafeInteger(totals[field])) fail();
        for (const field of ["originalMiles", "additionalMiles", "payableMiles"]) totals[field] = Math.round(totals[field] * 1000) / 1000;
        return { rows, totals };
    }
    function edit(data, id, payment, at = new Date().toISOString()) {
        const matches = [...data.jornadasSalvas, ...(data.jornadaAtiva ? [data.jornadaAtiva] : [])].filter(journey => journey.id === id);
        if (matches.length !== 1) throw Error("Jornada alterada ou duplicada. Atualize a página. / Journey changed or duplicated. Refresh the page.");
        const journey = matches[0], after = normalize(payment);
        const before = journey.pagamento === undefined ? null : normalize(journey.pagamento);
        if (before) {
            const previous = { ...before, additionalBackhaulMiles: additionalMiles(before) };
            const next = { ...after, additionalBackhaulMiles: additionalMiles(after) };
            if (Object.keys({ ...previous, ...next }).every(key => previous[key] === next[key])) return false;
        }
        if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) fail();
        const audit = [...(journey.pagamentoCorrecoes || []), { at, before: copy(before), after: copy(after) }];
        journey.pagamento = after;
        journey.pagamentoCorrecoes = audit;
        return true;
    }
    function detentionCents(minutes, rateCents) {
        if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes % 15 !== 0) fail();
        rate(rateCents);
        const numerator = minutes / 15 * rateCents;
        if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(numerator + 2)) fail();
        // Quarter hours × cents/hour / 4. Half a cent rounds up, per record.
        return Math.floor((numerator + 2) / 4);
    }
    function detention(input) {
        if (!input || input.version !== 1 || typeof input.id !== "string" || !input.id ||
            !dateValid(input.localDate) || typeof input.createdAt !== "string" || !Number.isFinite(Date.parse(input.createdAt))) fail();
        detentionCents(input.minutes, input.rateCents);
        return { version: 1, id: input.id, localDate: input.localDate, minutes: input.minutes,
            rateCents: input.rateCents, createdAt: input.createdAt };
    }
    function detentionRecords(journey) {
        if (journey.detentions === undefined) return [];
        if (!Array.isArray(journey.detentions)) fail();
        const entries = journey.detentions.map(detention), ids = new Set();
        for (const entry of entries) { if (ids.has(entry.id)) fail(); ids.add(entry.id); }
        return entries;
    }
    function findJourney(data, id) {
        const matches = [...data.jornadasSalvas, ...(data.jornadaAtiva ? [data.jornadaAtiva] : [])].filter(item => item.id === id);
        if (matches.length !== 1) throw Error("Jornada alterada ou duplicada. Atualize a página. / Journey changed or duplicated. Refresh the page.");
        return matches[0];
    }
    function changeDetention(data, journeyId, id, input, mode, at = new Date().toISOString()) {
        if (!["add", "edit", "delete"].includes(mode) || typeof id !== "string" || !id ||
            typeof at !== "string" || !Number.isFinite(Date.parse(at))) fail();
        const journey = findJourney(data, journeyId), entries = detentionRecords(journey);
        const before = entries.find(entry => entry.id === id) || null;
        if (mode === "add" && !before && (journey.detentionCorrections || []).some(change => change.detentionId === id))
            throw Error("Identificação já utilizada. Reabra o formulário. / ID already used. Reopen the form.");
        if (mode === "delete" && !before) return false;
        if (mode === "edit" && !before) throw Error("Detenção alterada ou excluída. Reabra o formulário. / Detention changed or deleted. Reopen the form.");
        let after = null;
        if (mode !== "delete") {
            after = detention({ version: 1, id, localDate: input.localDate, minutes: input.minutes,
                rateCents: mode === "edit" ? before.rateCents :
                    data.paymentSettings && data.paymentSettings.detentionRateCents !== undefined ? data.paymentSettings.detentionRateCents : DEFAULT_DETENTION_RATE,
                createdAt: before ? before.createdAt : at });
            if (mode === "add" && before) {
                if (before.minutes === after.minutes && before.localDate === after.localDate) return false;
                throw Error("Registro já salvo. Reabra para corrigir. / Record already saved. Reopen to edit.");
            }
        }
        if (JSON.stringify(before) === JSON.stringify(after)) return false;
        journey.detentions = [...entries.filter(entry => entry.id !== id), ...(after ? [after] : [])];
        journey.detentionCorrections = [...(journey.detentionCorrections || []), { at, detentionId: id, before: copy(before), after: copy(after) }];
        return true;
    }
    return { DEFAULT_RATE, DEFAULT_DETENTION_RATE, BACKHAUL, WEEKEND, extras, localDate, dateValid, miles, rate,
        normalize, validateData, create, calculate, report, edit, additionalMiles,
        detentionCents, detention, detentionRecords, findJourney, changeDetention };
})();
