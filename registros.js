let jornadaExibida = null;
let atualizacaoPendente = false;
let formularioBase;
let registroEmAndamento = false;
const camposTrailer = ["trailer", "condition", "trailerCondition", "Observacoes"];
const camposTruck = ["truckCondition", "observacoesTruck"];
function campo(id) { return document.getElementById(id); }
function assinaturaCampos(ids) { return JSON.stringify(ids.map(id => campo(id).value)); }
function limparCamposSalvos(ids, submitted, area) {
    if (assinaturaCampos(ids) !== submitted) return;
    for (const id of ids) {
        const node = campo(id);
        if (["condition", "trailerCondition", "truckCondition"].includes(id)) node.selectedIndex = 0;
        else node.value = "";
    }
    if (campo(area)) campo(area).style.display = "none";
}
function assinaturaFormulario() {
    return JSON.stringify(["truck", "trailer", "truckCondition", "condition", "trailerCondition", "observacoesTruck", "Observacoes"].map(id => campo(id).value)) +
        (typeof PaycheckUI !== "undefined" ? PaycheckUI.signature() : "");
}
function dadosFormulario() {
    return {
        truck: campo("truck").value.trim(), trailer: campo("trailer").value.trim(),
        condicaoTruck: campo("truckCondition").value,
        condicaoCarga: campo("condition").selectedOptions[0].text,
        condicaoTrailer: campo("trailerCondition").selectedOptions[0].text,
        observacoesTruck: campo("observacoesTruck").value.trim(),
        observacoesTrailer: campo("Observacoes").value.trim()
    };
}
function usoTrailer(jornada, form) {
    return { registroId: TrailerStorage.id(), truck: jornada.truck,
        estadoTruck: jornada.condicaoTruck, observacoesTruck: jornada.observacoesTruck,
        trailer: form.trailer, condition: form.condicaoCarga, estado: form.condicaoTrailer,
        observacoes: form.observacoesTrailer, data: new Date().toISOString(), jornadaId: jornada.id };
}
function cadastrarAutomaticamente(data, form) {
    if (!data.trucksCadastrados.some(item => item.numero === form.truck)) {
        data.trucksCadastrados.push({ registroId: TrailerStorage.id(), numero: form.truck,
            condicao: form.condicaoTruck, observacoes: form.observacoesTruck, dataCadastro: new Date().toISOString() });
    }
}
async function executarRegistro(action, mensagem) {
    if (registroEmAndamento) return false;
    try {
        if (atualizacaoPendente) throw Error("Confira a atualização da outra aba usando Atualizar. Seus campos serão mantidos antes de salvar.");
        const assinaturaSalva = assinaturaFormulario();
        registroEmAndamento = true;
        await TrailerStorage.change(action);
        atualizarBotoesJornada();
        formularioBase = assinaturaSalva;
        mostrarModal(mensagem);
        return true;
    } catch (error) { mostrarModal(error.message, "aviso"); return false; }
    finally { registroEmAndamento = false; }
}
async function iniciarJornada() {
    const form = dadosFormulario();
    if (!form.truck) return mostrarModal("Informe o número do Caminhão!", "aviso");
    let pagamentoInput;
    try { if (typeof PaycheckUI !== "undefined") pagamentoInput = PaycheckUI.startInput(); }
    catch (error) { return mostrarModal(error.message, "aviso"); }
    const trailerEnviado = assinaturaCampos(camposTrailer), truckEnviado = assinaturaCampos(camposTruck);
    const paymentSent = typeof PaycheckUI !== "undefined" && PaycheckUI.startSignature ? PaycheckUI.startSignature() : null;
    let historicoEquipamentos = null, contaHistorico;
    const saved = await executarRegistro(data => {
        if (data.jornadaAtiva) throw Error("Já existe uma jornada em andamento!");
        if (typeof EquipmentHistory !== "undefined") {
            try {
                if (typeof TrailerAuth !== "undefined") contaHistorico = TrailerAuth.scope();
                historicoEquipamentos = EquipmentHistory.summarize(data, form);
            } catch (_) { /* History must never block saving. */ }
        }
        const jornada = { ...form, id: TrailerStorage.id(), registroId: TrailerStorage.id(), inicio: new Date().toISOString(), status: "Em andamento" };
        if (pagamentoInput) jornada.pagamento = TrailerPay.create(pagamentoInput, jornada, data.paymentSettings);
        cadastrarAutomaticamente(data, form);
        data.jornadaAtiva = jornada;
        if (form.trailer) data.trailersSalvos.push(usoTrailer(jornada, form));
    }, "Jornada iniciada com sucesso!");
    if (saved) {
        if (typeof EquipmentHistory !== "undefined") {
            try {
                if (typeof TrailerAuth === "undefined" || TrailerAuth.scope() === contaHistorico) EquipmentHistory.show(historicoEquipamentos);
            } catch (_) { /* Keep the normal success/close flow. */ }
        }
        const unchanged = assinaturaFormulario() === formularioBase;
        limparCamposSalvos(camposTrailer, trailerEnviado, "areaObservacoes");
        limparCamposSalvos(camposTruck, truckEnviado, "areaObservacoesTruck");
        if (paymentSent !== null) PaycheckUI.clearStart(paymentSent);
        if (unchanged) formularioBase = assinaturaFormulario();
    }
}
async function trocarTrailer() {
    const form = dadosFormulario();
    const assinaturaEnviada = assinaturaCampos(camposTrailer);
    const expected = jornadaExibida;
    if (!form.trailer) return mostrarModal("Informe o número do Trailer!", "aviso");
    const saved = await executarRegistro(data => {
        if (!data.jornadaAtiva || data.jornadaAtiva.id !== expected) throw Error("A jornada mudou em outra aba. Confira a jornada atual antes de continuar.");
        data.trailersSalvos.push(usoTrailer(data.jornadaAtiva, form));
        Object.assign(data.jornadaAtiva, { trailer: form.trailer, condicaoTrailer: form.condicaoTrailer,
            condicaoCarga: form.condicaoCarga, observacoesTrailer: form.observacoesTrailer });
    }, "Trailer registrado com sucesso!");
    if (saved) {
        const unchanged = assinaturaFormulario() === formularioBase;
        limparCamposSalvos(camposTrailer, assinaturaEnviada, "areaObservacoes");
        if (unchanged) formularioBase = assinaturaFormulario();
    }
}
async function finalizarJornada() {
    const expected = jornadaExibida;
    await executarRegistro(data => {
        if (!data.jornadaAtiva || data.jornadaAtiva.id !== expected) throw Error("A jornada mudou ou já foi finalizada em outra aba.");
        const jornada = data.jornadaAtiva;
        if (data.jornadasSalvas.some(item => item.id === jornada.id)) throw Error("Esta jornada já consta no histórico. Confira os registros antes de continuar.");
        data.jornadasSalvas.push({ ...jornada, fim: new Date().toISOString(), status: "Finalizada" });
        data.jornadaAtiva = null;
    }, "Jornada finalizada com sucesso!");
}
async function cadastrarTruck() {
    const form = dadosFormulario();
    if (!form.truck) return mostrarModal("Informe o número do Caminhão!", "aviso");
    const submitted = assinaturaCampos(camposTruck), number = campo("truck").value;
    const saved = await executarRegistro(data => {
        if (data.trucksCadastrados.some(item => item.numero === form.truck)) throw Error("Este caminhão já está cadastrado!");
        cadastrarAutomaticamente(data, form);
    }, "Cadastro efetuado com sucesso!");
    if (saved) {
        limparCamposSalvos(camposTruck, submitted, "areaObservacoesTruck");
        if (!jornadaExibida && campo("truck").value === number) campo("truck").value = "";
    }
}
// Entrada antiga preservada, usando a mesma transação segura.
async function Mostrar() {
    const form = dadosFormulario();
    if (!form.truck || !form.trailer) return mostrarModal("Informe o número do Caminhão e do Trailer!", "aviso");
    const submitted = assinaturaCampos(camposTrailer);
    const saved = await executarRegistro(data => {
        const uso = usoTrailer({ truck: form.truck, condicaoTruck: form.condicaoTruck, observacoesTruck: form.observacoesTruck }, form);
        delete uso.jornadaId;
        data.trailersSalvos.push(uso);
    }, "Cadastro efetuado com sucesso!");
    if (saved) limparCamposSalvos(camposTrailer, submitted, "areaObservacoes");
}
function exibirJornada(ativa, aceitarAlvo = true) {
    if (aceitarAlvo) jornadaExibida = ativa ? ativa.id : null;
    campo("truck").readOnly = !!ativa;
    if (ativa && aceitarAlvo) campo("truck").value = ativa.truck;
    document.querySelector('button[onclick="iniciarJornada()"]').style.display = ativa ? "none" : "block";
    campo("btnFinalizarJornada").style.display = ativa ? "block" : "none";
    campo("btnTrocarTrailer").style.display = ativa ? "block" : "none";
    campo("saida").textContent = ativa
        ? "Jornada em andamento — Caminhão: " + ativa.truck + " | Trailer: " + (ativa.trailer || "Nenhum")
        : "Nenhuma jornada em andamento.";
    if (typeof PaycheckUI !== "undefined") PaycheckUI.active(ativa, aceitarAlvo);
}
function atualizarBotoesJornada() {
    try {
        const ativa = TrailerStorage.read().data.jornadaAtiva;
        exibirJornada(ativa);
    } catch (error) { mostrarModal(error.message, "aviso"); }
}
function aceitarAtualizacao() {
    try {
        exibirJornada(TrailerStorage.read().data.jornadaAtiva);
        atualizacaoPendente = false;
        campo("avisoAtualizacao").hidden = true;
    } catch (error) { mostrarModal(error.message, "aviso"); }
}
function continuarEditando() {
    campo("textoAtualizacao").textContent = "Continue editando: seus campos estão preservados. Antes de salvar, escolha Atualizar para conferir a jornada atual.";
    campo("btnContinuarEditando").hidden = true;
}
document.addEventListener("DOMContentLoaded", () => {
    formularioBase = assinaturaFormulario();
    let inicializada = false;
    TrailerStorage.subscribe((current, external, dataChanged) => {
        if (!inicializada) {
            inicializada = true;
            exibirJornada(current.data.jornadaAtiva);
            formularioBase = assinaturaFormulario();
            return;
        }
        // A operação local atualiza seus botões ao concluir, sem renderização dupla.
        if (!external || !dataChanged) return;
        const dirty = assinaturaFormulario() !== formularioBase;
        if (dirty || atualizacaoPendente) {
            // Atualiza botões/estado, mas não muda silenciosamente o alvo da edição.
            exibirJornada(current.data.jornadaAtiva, false);
            if (!atualizacaoPendente) {
                campo("textoAtualizacao").textContent = "Outra aba atualizou os registros. Seus campos foram preservados. Atualizar confere a jornada atual sem apagar os campos; você também pode Continuar editando.";
                campo("btnContinuarEditando").hidden = false;
            }
            atualizacaoPendente = true;
            campo("avisoAtualizacao").hidden = false;
        } else {
            exibirJornada(current.data.jornadaAtiva);
            formularioBase = assinaturaFormulario();
        }
    }, error => mostrarModal(error.message, "aviso"));
});
// Enter submits only the relevant registration group; textareas/selects keep native behavior.
document.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing || event.repeat || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (!target || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
    const startFields = ["truck", "trailer", "startPayoriginal", "startPaydestination"];
    if (jornadaExibida && target.id === "trailer") { event.preventDefault(); trocarTrailer(); }
    else if (!jornadaExibida && startFields.includes(target.id)) { event.preventDefault(); iniciarJornada(); }
});
