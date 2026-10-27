/* Uma única gravação publica todo o estado; as quatro chaves antigas ficam intactas.
 * Web Locks serializa operações entre abas. Sem esse recurso, gravar é bloqueado. */
const TrailerStorage = (() => {
    const keys = ["trailersSalvos", "trucksCadastrados", "jornadaAtiva", "jornadasSalvas"];
    const key = "trailerLogEstadoV2";
    const clone = value => JSON.parse(JSON.stringify(value));
    const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
    const compatibility = "Use Chrome ou Safari atualizados. No computador, abra por HTTPS ou localhost; no celular, use HTTPS com certificado válido (HTTP pelo IP da rede não basta).";
    function stable(value) {
        if (Array.isArray(value)) return value.map(stable);
        if (!object(value)) return value;
        return Object.fromEntries(Object.keys(value).sort().map(name => [name, stable(value[name])]));
    }
    function semantic(value) {
        const clean = item => {
            if (!object(item)) return item;
            return Object.fromEntries(Object.entries(item).filter(([name]) => name !== "registroId"));
        };
        return trailerSha256(JSON.stringify(stable(Array.isArray(value) ? value.map(clean) : clean(value))));
    }
    const parseLegacy = (raw, name) => raw === null ? (name === "jornadaAtiva" ? null : []) : JSON.parse(raw);
    function signature(raw, name) {
        let content = null;
        try { content = semantic(parseLegacy(raw, name)); } catch (_) { /* Mantém o JSON inválido intacto. */ }
        return { raw: trailerSha256(JSON.stringify(raw)), semantic: content };
    }
    function validate(data) {
        if (!object(data)) throw Error("Estado de registros inválido.");
        for (const name of keys) {
            const list = name === "jornadaAtiva" ? (data[name] === null ? [] : [data[name]]) : data[name];
            if (!Array.isArray(list) || list.some(item => !object(item))) throw Error("Registros inválidos em " + name + ". Nenhum dado foi alterado.");
            const ids = new Set();
            for (const item of list) {
                const field = name === "trucksCadastrados" ? "numero" : name === "trailersSalvos" ? "trailer" : "truck";
                if (typeof item[field] !== "string" || !item[field].trim()) throw Error("Registro sem " + field + " válido em " + name + ".");
                if ((name === "jornadaAtiva" || name === "jornadasSalvas") && (typeof item.id !== "string" || !item.id)) throw Error("Jornada sem identificação válida.");
                if (item.registroId !== undefined) {
                    if (typeof item.registroId !== "string" || !item.registroId || ids.has(item.registroId)) throw Error("Identificação de registro inválida ou repetida.");
                    ids.add(item.registroId);
                }
            }
        }
    }
    function identify(data) {
        for (const name of keys) {
            const list = name === "jornadaAtiva" ? (data[name] ? [data[name]] : []) : data[name];
            const seen = new Map();
            for (const item of list) {
                // SHA-256 evita repetir observações e outros textos dentro do ID.
                if (item.registroId) continue; // Não recalcula nem renomeia IDs já existentes.
                const content = trailerSha256(JSON.stringify(stable(item)));
                const occurrence = seen.get(content) || 0;
                seen.set(content, occurrence + 1);
                item.registroId = "legacy-sha256:" + name + ":" + content + ":" + occurrence;
            }
        }
    }
    function inspect() {
        try {
            const legacy = Object.fromEntries(keys.map(name => [name, localStorage.getItem(name)]));
            const raw = localStorage.getItem(key);
            let data, baseline, revision = 0;
            const signatures = Object.fromEntries(keys.map(name => [name, signature(legacy[name], name)]));
            if (raw !== null) {
                const state = JSON.parse(raw);
                if (!object(state) || ![2, 3].includes(state.version) || !object(state.legacy) || !Number.isSafeInteger(state.revision) || state.revision < 0) throw Error("Formato de armazenamento não suportado.");
                baseline = Object.fromEntries(keys.map(name => {
                    if (!Object.prototype.hasOwnProperty.call(state.legacy, name)) throw Error("Resumo legado incompleto.");
                    const entry = state.version === 2 ? signature(state.legacy[name], name) : state.legacy[name];
                    if (!object(entry) || typeof entry.raw !== "string" || !/^[a-f0-9]{64}$/.test(entry.raw) || !(entry.semantic === null || /^[a-f0-9]{64}$/.test(entry.semantic))) throw Error("Resumo legado inválido.");
                    return [name, entry];
                }));
                revision = state.revision;
                data = state.data;
            } else {
                data = Object.fromEntries(keys.map(name => [name, parseLegacy(legacy[name], name)]));
                baseline = signatures;
            }
            validate(data);
            const storedData = data;
            data = clone(data);
            identify(data);
            validate(data);
            return { data, storedData, token: trailerSha256(JSON.stringify([raw, legacy])), legacy, baseline, signatures, revision,
                conflict: keys.some(name => baseline[name].raw !== signatures[name].raw) };
        } catch (error) {
            throw Error("Não foi possível ler os registros: " + error.message);
        }
    }
    function read() {
        const current = inspect();
        if (current.conflict) throw Error("Uma aba antiga alterou os registros. Feche as abas antigas e abra Configurações → Recuperação entre versões. Nenhuma cópia será descartada automaticamente.");
        return current;
    }
    function notify(external) {
        const event = new Event("trailerlogchange");
        event.external = external;
        window.dispatchEvent(event);
    }
    function checkLocks() {
        if (!navigator.locks || !navigator.locks.request) throw Error("Gravação segura entre abas indisponível neste navegador ou endereço. " + compatibility);
    }
    function save(current, data) {
        const raw = JSON.stringify({ version: 3, revision: current.revision + 1, legacy: current.signatures, data });
        if (inspect().token !== current.token) throw Error("Conflito entre abas. Nenhuma alteração foi gravada.");
        try { localStorage.setItem(key, raw); }
        catch (error) { throw Error("Não foi possível salvar os registros. O estado anterior foi preservado. " + error.message); }
        notify(false);
    }
    async function change(update, expectedToken) {
        checkLocks();
        return navigator.locks.request("trailer-log-registros", async () => {
            const current = read();
            if (expectedToken !== undefined && current.token !== expectedToken) throw Error("Os registros mudaram em outra aba. Confira os dados e tente novamente.");
            const data = clone(current.data);
            update(data);
            validate(data);
            identify(data);
            validate(data);
            save(current, data);
            return clone(data);
        });
    }
    function id() {
        if (!crypto.randomUUID) throw Error("Geração segura de identificação indisponível. " + compatibility);
        return crypto.randomUUID();
    }
    window.addEventListener("storage", event => {
        if (event.key === null || event.key === key || keys.includes(event.key)) notify(true);
    });
    function planRecovery() {
        const current = inspect();
        const unsafe = keys.filter(name => current.baseline[name].raw !== current.signatures[name].raw &&
            (current.signatures[name].semantic === null ||
            (current.signatures[name].semantic !== current.baseline[name].semantic && current.signatures[name].semantic !== semantic(current.data[name]))));
        return { token: current.token, conflict: current.conflict, safe: unsafe.length === 0,
            message: unsafe.length ? "Recuperação bloqueada: existem diferenças que podem representar inclusões, exclusões ou alterações em " + unsafe.join(", ") + ". Salve as cópias para recuperação e solicite uma comparação manual. Nenhum dado foi alterado." :
                current.conflict ? "As diferenças não exigem alterar registros: o conteúdo é equivalente à cópia original ou ao estado atual. É possível atualizar somente os resumos de integridade, preservando todas as cópias." : "Não há conflito entre versões." };
    }
    async function recover(token) {
        checkLocks();
        return navigator.locks.request("trailer-log-registros", () => {
            const current = inspect();
            if (current.token !== token) throw Error("Os dados mudaram desde a verificação. Verifique a recuperação novamente.");
            const plan = planRecovery();
            if (!plan.safe) throw Error(plan.message);
            if (plan.conflict) save(current, current.storedData);
            return plan.message;
        });
    }
    function recoveryArchive() {
        // Não exige parse: permite salvar também JSON corrompido para recuperação manual.
        return { aplicativo: "Trailer Log", tipo: "recuperacao", versaoRecuperacao: 1, exportadoEm: new Date().toISOString(),
            aviso: "Arquivo de diagnóstico com todas as cópias brutas. Não é um backup comum e não deve ser restaurado diretamente.",
            estadoAtualBruto: localStorage.getItem(key), legadoBruto: Object.fromEntries(keys.map(name => [name, localStorage.getItem(name)])) };
    }
    function subscribe(update, onError) {
        let token, dataToken, lastError;
        function refresh(event) {
            try {
                const current = read();
                lastError = undefined;
                if (current.token === token) return;
                token = current.token;
                const nextDataToken = trailerSha256(JSON.stringify(current.data));
                const dataChanged = nextDataToken !== dataToken;
                dataToken = nextDataToken;
                update(current, event && event.type === "trailerlogchange" ? !!event.external : true, dataChanged);
            } catch (error) {
                // Uma cópia reparada pode voltar ao mesmo token anterior ao erro.
                token = undefined;
                dataToken = undefined;
                if (lastError !== error.message) {
                    lastError = error.message;
                    onError(error);
                }
            }
        }
        window.addEventListener("trailerlogchange", refresh);
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState !== "hidden") refresh();
        });
        // Uma leitura inicial também permite detectar mudanças ocorridas com a aba suspensa.
        refresh({ external: false, type: "trailerlogchange" });
    }
    return { read, change, id, keys, validate, planRecovery, recover, recoveryArchive, subscribe };
})();
