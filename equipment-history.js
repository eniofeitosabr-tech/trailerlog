/* Read-only equipment summary from the authorized pre-save transaction snapshot. */
const EquipmentHistory = (() => {
    const trailerKey = value => typeof value === "string" ? value.trim().toLowerCase() : "";
    const sameTrailer = (a, b) => !!trailerKey(a) && trailerKey(a) === trailerKey(b);
    const distinctTrailers = values => [...new Map(values.filter(value => trailerKey(value)).map(value => [trailerKey(value), value])).values()];
    const uniqueJourney = (journeys, id) => {
        if (!id) return null;
        const matches = journeys.filter(journey => journey.id === id);
        return matches.length === 1 ? matches[0] : null;
    };
    const text = value => typeof value === "string" && value.trim() ? value.trim() : null;
    const first = (...values) => values.map(text).find(Boolean) || null;
    const time = value => text(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
    function summarize(data, form) {
        const journeys = new Map();
        for (const j of [...data.jornadasSalvas, ...(data.jornadaAtiva ? [data.jornadaAtiva] : [])])
            if (!journeys.has(j.id)) journeys.set(j.id, j);
        const uses = data.trailersSalvos;
        function linkedJourney(use) {
            if (use.jornadaId) return uniqueJourney([...data.jornadasSalvas, ...(data.jornadaAtiva ? [data.jornadaAtiva] : [])], use.jornadaId);
            // Only an unambiguous recorded interval can identify a legacy mirror.
            const candidates = [...journeys.values()].filter(j => j.truck === use.truck && time(j.inicio) !== null && time(use.data) !== null &&
                (time(j.inicio) === time(use.data) || time(j.fim) !== null && time(use.data) >= time(j.inicio) && time(use.data) <= time(j.fim)));
            return candidates.length === 1 ? candidates[0] : null;
        }
        const associations = new Map(), representedTrailers = new Map();
        for (const use of uses) {
            const linked = linkedJourney(use); associations.set(use, linked);
            const id = use.jornadaId || linked?.id;
            if (id) { if (!representedTrailers.has(id)) representedTrailers.set(id,new Set()); representedTrailers.get(id).add(trailerKey(use.trailer)); }
        }
        function equipment(number, kind) {
            const entries = new Map();
            function add(key, at, condition, load) {
                const previous = entries.get(key);
                const entry = { at: time(at), condition: text(condition), load: text(load) };
                if (!previous) entries.set(key, entry);
                else if (entry.at !== null && (previous.at === null || entry.at > previous.at)) entries.set(key,
                    { ...entry, condition: entry.condition || previous.condition, load: entry.load || previous.load });
                else if (entry.at === previous.at) entries.set(key, { ...previous, condition: previous.condition || entry.condition, load: previous.load || entry.load });
                else entries.set(key, { ...previous, condition: previous.condition || entry.condition, load: previous.load || entry.load });
            }
            for (const use of [...uses].sort((a,b)=>(time(a.data)??-Infinity)-(time(b.data)??-Infinity))) {
                const mirror = associations.get(use);
                if (kind === "truck" ? first(use.truck,mirror && mirror.truck) !== number : !sameTrailer(use.trailer, number)) continue;
                const journeyKey = mirror ? mirror.id : use.jornadaId;
                const key = kind === "truck" && journeyKey ? "journey:" + journeyKey :
                    "use:" + JSON.stringify([journeyKey || null, kind === "truck" ? use.truck : trailerKey(use.trailer),
                        kind === "trailer" && !journeyKey ? use.registroId || JSON.stringify(use) : time(use.data) ?? use.registroId ?? JSON.stringify(use)]);
                add(key, use.data, kind === "truck" ? first(use.estadoTruck, use.condicaoTruck) : first(use.estado, use.condicaoTrailer, use.trailerCondition),
                    kind === "trailer" ? first(use.condicaoCarga, use.condition) : null);
            }
            for (const j of journeys.values()) {
                if (kind === "truck") {
                    if (j.truck === number) add("journey:" + j.id, j.inicio, first(j.condicaoTruck, j.estadoTruck), null);
                } else {
                    const initial = first(j.pagamento && j.pagamento.initialTrailer, j.initialTrailer, j.trailerInicial);
                    if (!sameTrailer(j.trailer, number) && !sameTrailer(initial, number)) continue;
                    const represented = representedTrailers.get(j.id)?.has(trailerKey(number));
                    if (!represented) add("journey:" + j.id, j.inicio,
                        sameTrailer(j.trailer, number) ? first(j.condicaoTrailer, j.estadoTrailer) : null,
                        sameTrailer(j.trailer, number) ? j.condicaoCarga : null);
                }
            }
            const sorted = [...entries.values()].sort((a,b) => (b.at ?? -Infinity) - (a.at ?? -Infinity));
            const last = sorted[0] || null;
            const registered = kind === "truck" ? data.trucksCadastrados.filter(item => item.numero === number)
                .sort((a,b)=>(time(b.dataCadastro)??-Infinity)-(time(a.dataCadastro)??-Infinity)) : [];
            const condition = sorted.find(entry => entry.condition)?.condition || registered.map(item=>first(item.condicao,item.condicaoTruck,item.estadoTruck)).find(Boolean) || null;
            return { kind, number, count: entries.size, condition, last: last && { ...last,
                condition,
                load: sorted.find(entry => entry.load)?.load || null } };
        }
        return { truck: equipment(form.truck, "truck"), trailer: form.trailer ? equipment(form.trailer, "trailer") : null };
    }
    const labels = {
        pt: { success: "Jornada iniciada com sucesso!", truck: "Caminhão", trailer: "Trailer", count: "Utilizações anteriores", last: "Última utilização anterior",
            condition: "Última condição registrada", load: "Condição da carga", state: "Estado de conservação", never: "Nunca utilizado", unknown: "Não informado",
            unavailable: "Jornada salva. Não foi possível consultar o histórico dos equipamentos." },
        en: { success: "Journey started successfully!", truck: "Truck", trailer: "Trailer", count: "Previous uses", last: "Last previous use",
            condition: "Last recorded condition", load: "Load condition", state: "Equipment condition", never: "Never used", unknown: "Not provided",
            unavailable: "Journey saved. Equipment history is unavailable." }
    };
    let current;
    const language = () => typeof PaycheckUI !== "undefined" && PaycheckUI.language === "en" ? "en" : "pt";
    function clear() {
        current = undefined;
        const area = document.getElementById("equipmentHistory");
        if (area) { area.replaceChildren(); area.hidden = true; }
        document.getElementById("modalSucesso")?.classList.remove("has-equipment-history");
    }
    function show(summary) {
        current = summary;
        const area = document.getElementById("equipmentHistory"), lang = language(), t = labels[lang];
        if (!area) return;
        area.replaceChildren(); area.hidden = false;
        document.getElementById("modalSucesso").classList.add("has-equipment-history");
        document.getElementById("tituloModal").textContent = t.success;
        function node(tag, content, parent) { const n = document.createElement(tag); n.textContent = content; parent.appendChild(n); return n; }
        const known = value => {
            if (!value) return t.unknown;
            const translations = { Empty: ["Vazio","Empty"], Vazio: ["Vazio","Empty"], Loaded: ["Carregado","Loaded"], Carregado: ["Carregado","Loaded"],
                "With Pallets": ["Com Pallets","With Pallets"], "Com Pallets": ["Com Pallets","With Pallets"], Good: ["Bom","Good"], Bom: ["Bom","Good"],
                "Needs Attention": ["Precisa de Atenção","Needs Attention"], "Precisa de Atenção": ["Precisa de Atenção","Needs Attention"],
                Excelente: ["Excelente","Excellent"], Excellent: ["Excelente","Excellent"], Regular: ["Regular","Fair"], Ruim: ["Ruim","Poor"] };
            return Object.hasOwn(translations,value) ? translations[value][lang === "en" ? 1 : 0] : value;
        };
        if (!summary) { node("p",t.unavailable,area); return; }
        for (const item of [summary.truck, summary.trailer].filter(Boolean)) {
            const card = node("section","",area); card.className = "equipment-history-card";
            node("h3",`${t[item.kind]} · ${item.number}`,card);
            const dl = node("dl","",card);
            const at = item.last && item.last.at;
            const entries = [[t.count,String(item.count)], [t.last, !item.count ? t.never : at === null ? t.unknown : new Intl.DateTimeFormat(lang === "en" ? "en-US" : "pt-BR", { dateStyle:"short",timeStyle:"short" }).format(new Date(at))]];
            if (item.kind === "truck") entries.push([t.condition,known(item.condition)]);
            else entries.push([t.load,known(item.last && item.last.load)],[t.state,known(item.last && item.last.condition)]);
            for (const [label,value] of entries) { const pair=node("div","",dl); node("dt",label,pair); node("dd",value,pair); }
        }
    }
    if (typeof window !== "undefined") {
        window.addEventListener("trailerpaylanguage",()=>{if(current !== undefined)show(current);});
        for (const event of ["traileraccountchange","pagehide","offline"]) window.addEventListener(event,clear);
    }
    return { summarize, show, clear, trailerKey, sameTrailer, distinctTrailers, uniqueJourney };
})();
