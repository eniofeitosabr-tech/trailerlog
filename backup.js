/* Formato versionado. Não renomear as chaves: são usadas pelos registros antigos. */
const CHAVES_BACKUP = ["trailersSalvos", "trucksCadastrados", "jornadaAtiva", "jornadasSalvas"];

function objetoBackup(valor) {
    return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function validarDadosBackup(dados) {
    if (!objetoBackup(dados) || CHAVES_BACKUP.some(chave =>
        !Object.prototype.hasOwnProperty.call(dados, chave))) {
        throw new Error("O arquivo deve conter as quatro coleções do Trailer Log.");
    }
    const texto = valor => typeof valor === "string" && valor.trim() !== "";
    const data = valor => texto(valor) && Number.isFinite(Date.parse(valor));
    function validarRegistro(item, tipo) {
        if (!objetoBackup(item)) throw new Error("Registro inválido em " + tipo + ".");
        // Campos opcionais antigos são aceitos; campos adicionais são preservados.
        const camposTexto = ["truck", "trailer", "numero", "condition", "estado", "estadoTruck",
            "observacoes", "observacoesTruck", "observacoesTrailer", "condicao", "condicaoTruck",
            "condicaoTrailer", "condicaoCarga", "status", "id", "jornadaId"];
        for (const campo of camposTexto) {
            if (campo in item && typeof item[campo] !== "string") {
                throw new Error("Campo inválido: " + campo + ".");
            }
        }
        for (const campo of ["data", "dataCadastro", "inicio", "fim"]) {
            if (campo in item && !data(item[campo])) throw new Error("Data inválida: " + campo + ".");
        }
        if (tipo === "trailersSalvos" && !texto(item.trailer)) throw new Error("Trailer sem número.");
        if (tipo === "trucksCadastrados" && !texto(item.numero)) throw new Error("Caminhão sem número.");
        if (tipo === "jornadasSalvas" || tipo === "jornadaAtiva") {
            if (!texto(item.id) || !texto(item.truck) || !data(item.inicio)) {
                throw new Error("Jornada sem identificação, caminhão ou início válido.");
            }
            if (item.fim && Date.parse(item.fim) < Date.parse(item.inicio)) {
                throw new Error("Jornada com término anterior ao início.");
            }
        }
    }
    for (const chave of CHAVES_BACKUP) {
        if (chave === "jornadaAtiva") {
            if (dados[chave] !== null) validarRegistro(dados[chave], chave);
        } else {
            if (!Array.isArray(dados[chave])) throw new Error("Lista inválida: " + chave + ".");
            dados[chave].forEach(item => validarRegistro(item, chave));
        }
    }
    return dados;
}

function lerArquivoBackup(conteudo) {
    const arquivo = JSON.parse(conteudo.replace(/^\uFEFF/, ""));
    if (objetoBackup(arquivo) && Object.prototype.hasOwnProperty.call(arquivo, "versao")) {
        if (arquivo.aplicativo !== "Trailer Log" || arquivo.versao !== 1) {
            throw new Error("Aplicativo ou versão de backup não suportado.");
        }
        return validarDadosBackup(arquivo.dados);
    }
    // Também aceita JSON antigo com as quatro chaves diretamente na raiz.
    return validarDadosBackup(arquivo);
}

function informarBackup(mensagem) {
    document.getElementById("statusBackup").textContent = mensagem;
}

function exportarBackup() {
    let url;
    try {
        const dados = {};
        for (const chave of CHAVES_BACKUP) {
            const bruto = localStorage.getItem(chave);
            dados[chave] = bruto === null ? (chave === "jornadaAtiva" ? null : []) : JSON.parse(bruto);
        }
        validarDadosBackup(dados);
        const arquivo = { aplicativo: "Trailer Log", versao: 1, exportadoEm: new Date().toISOString(), dados };
        url = URL.createObjectURL(new Blob([JSON.stringify(arquivo, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "trailer-log-backup-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        informarBackup("Download do backup solicitado. Guarde o arquivo JSON em um local seguro.");
    } catch (erro) {
        informarBackup("Não foi possível exportar o backup. " + erro.message);
    } finally {
        if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}

function aplicarDadosBackup(dados) {
    validarDadosBackup(dados);
    const anteriores = {};
    const novos = {};
    // Leitura e serialização completas antes da primeira alteração.
    for (const chave of CHAVES_BACKUP) {
        anteriores[chave] = localStorage.getItem(chave);
        novos[chave] = JSON.stringify(dados[chave]);
    }
    const alteradas = [];
    try {
        for (const chave of CHAVES_BACKUP) {
            localStorage.setItem(chave, novos[chave]);
            alteradas.push(chave);
        }
    } catch (erro) {
        // Desfaz somente escritas concluídas, preservando até o texto JSON original.
        for (const chave of alteradas) localStorage.removeItem(chave);
        for (const chave of alteradas) {
            if (anteriores[chave] !== null) localStorage.setItem(chave, anteriores[chave]);
        }
        throw erro;
    }
}

async function restaurarBackup(input) {
    try {
        const arquivo = input.files[0];
        if (!arquivo) return;
        const dados = lerArquivoBackup(await arquivo.text());
        const resumo = `${dados.trucksCadastrados.length} caminhão(ões), ${dados.trailersSalvos.length} utilização(ões) de trailer, ${dados.jornadasSalvas.length} jornada(s) salva(s) e ${dados.jornadaAtiva ? "1 jornada ativa" : "nenhuma jornada ativa"}.`;
        if (!confirm("Backup validado: " + resumo + "\n\nA restauração SUBSTITUI todos os registros atuais, incluindo a jornada ativa. Feche outras abas do Trailer Log antes de continuar.\n\nDeseja restaurar este backup?")) {
            informarBackup("Restauração cancelada. Nenhum dado foi alterado.");
            return;
        }
        aplicarDadosBackup(dados);
        informarBackup("Backup restaurado com sucesso: " + resumo);
    } catch (erro) {
        informarBackup("Não foi possível restaurar o backup. " + erro.message);
    } finally {
        input.value = "";
    }
}
