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
    TrailerStorage.validate(dados);
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
        const dados = TrailerStorage.read().data;
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

async function aplicarDadosBackup(dados, token) {
    validarDadosBackup(dados);
    return TrailerStorage.change(atual => {
        for (const chave of CHAVES_BACKUP) atual[chave] = JSON.parse(JSON.stringify(dados[chave]));
    }, token);
}

let restauracaoEmAndamento = false;
let atualizacaoBackupPendente = false;
let liberarAtualizacaoBackup = null;
function avisarAtualizacaoBackup() {
    const input = document.getElementById("arquivoBackup");
    if (!restauracaoEmAndamento && !(input.files && input.files.length)) return;
    if (!atualizacaoBackupPendente) {
        document.getElementById("textoAtualizacaoBackup").textContent = "Outra aba atualizou os registros. O arquivo selecionado foi preservado. Escolha Atualizar para conferir o estado antes de restaurar, ou Continuar editando para aguardar.";
        document.getElementById("btnContinuarBackup").hidden = false;
    }
    atualizacaoBackupPendente = true;
    document.getElementById("avisoAtualizacaoBackup").hidden = false;
}
function aceitarAtualizacaoBackup() {
    try {
        TrailerStorage.read();
        atualizacaoBackupPendente = false;
        document.getElementById("avisoAtualizacaoBackup").hidden = true;
        if (liberarAtualizacaoBackup) { const liberar = liberarAtualizacaoBackup; liberarAtualizacaoBackup = null; liberar(); }
    } catch (error) { informarBackup(error.message); }
}
function continuarEditandoBackup() {
    document.getElementById("textoAtualizacaoBackup").textContent = "Arquivo preservado. A restauração aguardará sua escolha em Atualizar e uma nova confirmação antes de substituir registros.";
    document.getElementById("btnContinuarBackup").hidden = true;
}
async function restaurarBackup(input) {
    if (restauracaoEmAndamento) return informarBackup("Já existe uma restauração em preparação. Conclua a escolha pendente antes de selecionar outro arquivo.");
    try {
        const arquivo = input.files[0];
        if (!arquivo) return;
        restauracaoEmAndamento = true;
        input.disabled = true;
        const dados = lerArquivoBackup(await arquivo.text());
        if (atualizacaoBackupPendente) await new Promise(resolve => { liberarAtualizacaoBackup = resolve; });
        const resumo = `${dados.trucksCadastrados.length} caminhão(ões), ${dados.trailersSalvos.length} utilização(ões) de trailer, ${dados.jornadasSalvas.length} jornada(s) salva(s) e ${dados.jornadaAtiva ? "1 jornada ativa" : "nenhuma jornada ativa"}.`;
        const token = TrailerStorage.read().token;
        if (!confirm("Backup validado: " + resumo + "\n\nA restauração SUBSTITUI todos os registros atuais, incluindo a jornada ativa. Feche outras abas do Trailer Log antes de continuar.\n\nDeseja restaurar este backup?")) {
            informarBackup("Restauração cancelada. Nenhum dado foi alterado.");
            return;
        }
        await aplicarDadosBackup(dados, token);
        informarBackup("Backup restaurado com sucesso: " + resumo);
    } catch (erro) {
        informarBackup("Não foi possível restaurar o backup. " + erro.message);
    } finally {
        input.value = "";
        input.disabled = false;
        restauracaoEmAndamento = false;
        atualizacaoBackupPendente = false;
        document.getElementById("avisoAtualizacaoBackup").hidden = true;
    }
}

function informarRecuperacao(mensagem) {
    document.getElementById("statusRecuperacao").textContent = mensagem;
}

function exportarRecuperacao() {
    let url;
    try {
        const arquivo = TrailerStorage.recoveryArchive();
        url = URL.createObjectURL(new Blob([JSON.stringify(arquivo, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "trailer-log-recuperacao-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        informarRecuperacao("Download das cópias solicitado. Confirme que o arquivo foi salvo e guarde-o para comparação manual; ele não é um backup comum.");
    } catch (error) { informarRecuperacao("Não foi possível salvar as cópias. " + error.message); }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

async function verificarRecuperacao() {
    try {
        const plano = TrailerStorage.planRecovery();
        informarRecuperacao(plano.message);
        if (!plano.safe || !plano.conflict) return;
        if (!confirm(plano.message + "\n\nFeche as outras abas antes de continuar. Confirmar recuperação sem alterar registros nem apagar cópias?")) {
            informarRecuperacao("Recuperação cancelada. Nenhum dado foi alterado.");
            return;
        }
        await TrailerStorage.recover(plano.token);
        informarRecuperacao("Funcionamento recuperado. Registros e cópias legadas preservados. Recarregue as outras páginas do aplicativo.");
    } catch (error) { informarRecuperacao(error.message); }
}
