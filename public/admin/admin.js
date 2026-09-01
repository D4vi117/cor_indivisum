document.querySelectorAll(".admin-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("is-active"));
    document.querySelectorAll(".admin-panel").forEach((p) => p.classList.remove("is-active"));

    tab.classList.add("is-active");
    document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("is-active");
  });
});

const modal = document.getElementById("modal-produto");
const form = document.getElementById("form-produto");

// Dados de clientes e pedidos podem conter texto digitado pelo usuário.
// Nunca os inserimos como HTML no painel administrativo.
function escaparHtml(valor) {
  return String(valor ?? "").replace(/[&<>'"]/g, (caractere) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[caractere]);
}

function urlHttpsSegura(valor) {
  try {
    const url = new URL(String(valor), window.location.origin);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function abrirModal() {
  modal.hidden = false;
  form.reset();
}

function fecharModal() {
  modal.hidden = true;
  form.reset();
}

document.querySelector('[data-action="novo-produto"]').onclick = () => abrirModal();
document.querySelector('[data-action="fechar-modal"]').onclick = fecharModal;

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const dados = {
    nome: form.nome.value.trim(),
    conteudo: {
      descricaoCurta: form.descricaoCurta ? form.descricaoCurta.value.trim() : "",
    },
    precos: {
      de: 0,
      por: 0,
      emOferta: false
    },
    status: {
      ativo: false,
      publicado: false,
      destaque: false
    },
    meta: {
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      editadoEm: firebase.firestore.FieldValue.serverTimestamp()
    }
  };

  try {
    const docRef = await db.collection("produtos").add(dados);
    fecharModal();
    window.location.href = `/admin/produto?id=${docRef.id}`;
  } catch (err) {
    console.error("Erro ao criar produto:", err);
    alert("Erro ao criar produto: " + err.message);
  }
});

async function excluirProduto(id) {
  const confirmar = confirm("Tem certeza que deseja excluir este produto?");
  if (!confirmar) return;

  try {
    await db.collection("produtos").doc(id).delete();
  } catch (err) {
    console.error(err);
    alert("Erro ao excluir produto.");
  }
}

const tbodyProdutos = document.querySelector("#tabela-produtos tbody");
const vazioProdutos = document.querySelector("#painel-produtos .tabela-vazia");

/* ==========================================================================
   RENDERIZAÇÃO DA TABELA DO ADMIN
   ========================================================================== */

function renderizarProdutos(produtos) {
  tbodyProdutos.innerHTML = "";

  if (produtos.length === 0) {
    vazioProdutos.hidden = false;
    return;
  }

  vazioProdutos.hidden = true;

  produtos.forEach((p) => {
    const tr = document.createElement("tr");

    // Preço: suporta tanto a estrutura nova (p.precos.de/por) quanto a antiga (p.preco)
    let precoValido = 0;
    if (p.precos && typeof p.precos === "object") {
      precoValido = Number(p.precos.por || p.precos.de) || 0;
    } else {
      precoValido = Number(p.preco) || 0;
    }

    const precoFormatado = `R$ ${precoValido.toFixed(2).replace('.', ',')}`;
    const estoqueQtd = typeof p.estoque === "number" ? p.estoque : 0;
    const categoriaNome = p.categoria || "-";

    tr.innerHTML = `
      <td>${escaparHtml(p.nome || "Sem nome")}</td>
      <td>${escaparHtml(categoriaNome)}</td>
      <td>${precoFormatado}</td>
      <td>${estoqueQtd}</td>
      <td class="col-acoes">
        <button class="btn-tabela" data-editar="${escaparHtml(p.id)}">Editar</button>
        <button class="btn-tabela btn-danger" data-excluir="${escaparHtml(p.id)}">Excluir</button>
      </td>
    `;

    tbodyProdutos.appendChild(tr);
  });

  // Eventos dos botões
  tbodyProdutos.querySelectorAll("[data-editar]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.editar;
      window.location.href = `/admin/produto?id=${id}`;
    };
  });

  tbodyProdutos.querySelectorAll("[data-excluir]").forEach((btn) => {
    btn.onclick = () => excluirProduto(btn.dataset.excluir);
  });
}

/* ==========================================================================
   CONSULTA EM TEMPO REAL (SEM FILTRO QUE ESCONDE PRODUTOS ANTIGOS)
   ========================================================================== */

function iniciarListenerProdutos() {
  db.collection("produtos")
    .onSnapshot((snapshot) => {
      const produtos = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));

      // Ordenação manual por data na memória
      // Evita que produtos sem o campo "meta.criadoEm" fiquem invisíveis
      produtos.sort((a, b) => {
        const dataA = a.meta?.criadoEm?.toDate ? a.meta.criadoEm.toDate() : (a.criadoEm?.toDate ? a.criadoEm.toDate() : new Date(0));
        const dataB = b.meta?.criadoEm?.toDate ? b.meta.criadoEm.toDate() : (b.criadoEm?.toDate ? b.criadoEm.toDate() : new Date(0));
        return dataB - dataA;
      });

      renderizarProdutos(produtos);
    }, (error) => {
      console.error("Erro no listener de produtos:", error);
    });
}

/* ========================================================================== 
   AUTENTICAÇÃO — só libera a página (e os listeners) para admin/dev
   ========================================================================== */

const melhorEnvioStatusEl = document.getElementById("melhor-envio-status");
const btnReconectarMelhorEnvio = document.getElementById("btn-reconectar-melhor-envio");

async function atualizarStatusMelhorEnvio() {
  if (!melhorEnvioStatusEl || !btnReconectarMelhorEnvio) return;

  try {
    const obterStatus = functions.httpsCallable("obterStatusMelhorEnvioAdmin");
    const { data } = await obterStatus();
    const precisaReconectar = !data.autenticado || data.expirado;

    melhorEnvioStatusEl.classList.toggle("conectada", !precisaReconectar);
    melhorEnvioStatusEl.classList.toggle("atencao", precisaReconectar);
    melhorEnvioStatusEl.textContent = precisaReconectar
      ? "A conexão precisa ser renovada para calcular fretes e gerar etiquetas."
      : "Conectado e pronto para calcular fretes e gerar etiquetas.";
    btnReconectarMelhorEnvio.hidden = !precisaReconectar;
  } catch (err) {
    console.error("Erro ao consultar o Melhor Envio:", err);
    melhorEnvioStatusEl.classList.remove("conectada");
    melhorEnvioStatusEl.classList.add("atencao");
    melhorEnvioStatusEl.textContent = "Não foi possível verificar a conexão agora.";
    btnReconectarMelhorEnvio.hidden = false;
  }
}

btnReconectarMelhorEnvio?.addEventListener("click", async () => {
  const textoOriginal = btnReconectarMelhorEnvio.textContent;
  btnReconectarMelhorEnvio.disabled = true;
  btnReconectarMelhorEnvio.textContent = "Abrindo Melhor Envio...";

  try {
    const iniciarAutorizacao = functions.httpsCallable("iniciarAutorizacaoMelhorEnvio");
    const { data } = await iniciarAutorizacao();
    const popup = window.open(data.authUrl, "_blank");
    if (!popup) {
      throw new Error("O navegador bloqueou a janela de autorização.");
    }
    popup.opener = null;
    melhorEnvioStatusEl.textContent = "Conclua a autorização na nova janela e depois atualize esta página.";
  } catch (err) {
    console.error("Erro ao iniciar autorização do Melhor Envio:", err);
    melhorEnvioStatusEl.classList.add("atencao");
    melhorEnvioStatusEl.textContent = "Não foi possível iniciar a reconexão. Tente novamente.";
  } finally {
    btnReconectarMelhorEnvio.disabled = false;
    btnReconectarMelhorEnvio.textContent = textoOriginal;
  }
});

firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "/login";
    return;
  }

  const snap = await db.collection("usuarios").doc(user.uid).get();
  const dados = snap.data();

  if (!dados || (dados.role !== "admin" && dados.role !== "dev")) {
    alert("Acesso negado.");
    window.location.href = "/";
    return;
  }

  // Só começa a ouvir as coleções depois de confirmar que é staff
  iniciarListenerProdutos();
  iniciarListenerPedidos();
  iniciarListenerContas();
  atualizarStatusMelhorEnvio();
});

/* ==========================================================================
   ABA PEDIDOS — listagem, geração de etiqueta individual e em lote
   ========================================================================== */

const rotulosStatusPedido = {
  "Pendente": "Pendente",
  "pago": "Pago",
  "aguardando_pagamento": "Aguardando pagamento",
  "recusado": "Recusado",
  "cancelado": "Cancelado",
  "reembolsado": "Reembolsado",
};

function formatBRLAdmin(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarDataAdmin(ts) {
  if (ts && typeof ts.toDate === "function") {
    return ts.toDate().toLocaleString("pt-BR");
  }
  return "—";
}

// Monta o HTML da linha de detalhes de um pedido. O campo de migração
// (origemMigracao / migradoEm) é ignorado de propósito — não deve aparecer.
function construirDetalhesPedido(p) {
  const cliente = p.cliente || {};
  const entrega = p.entrega || {};
  const pagamento = p.pagamento || {};
  const itens = p.itens || [];

  const enderecoLinhas = [
    entrega.rua ? `${entrega.rua}${entrega.numero ? ", " + entrega.numero : ""}` : "",
    entrega.complemento || "",
    entrega.bairro || "",
    [entrega.cidade, entrega.estado].filter(Boolean).join(" - "),
    entrega.cep || ""
  ].filter(Boolean);

  const itensHtml = itens.length
    ? itens.map((i) => `<li>${escaparHtml(i.qtd || 1)}× ${escaparHtml(i.nome || "Item")} — ${formatBRLAdmin(i.preco)}</li>`).join("")
    : "<li>—</li>";

  const pagamentoUrl = urlHttpsSegura(p.infinitepay?.url);
  const linkPagamento = pagamentoUrl
    ? `<a href="${escaparHtml(pagamentoUrl)}" target="_blank" rel="noopener">Abrir link de pagamento</a>`
    : "—";

  return `
    <div class="detalhes-pedido">
      <div class="detalhes-coluna">
        <h4>Cliente</h4>
        <p>${escaparHtml(cliente.nome || "—")}</p>
        <p>${escaparHtml(cliente.email || "—")}</p>
        <p>${escaparHtml(cliente.telefone || "—")}</p>
      </div>
      <div class="detalhes-coluna">
        <h4>Entrega</h4>
        ${enderecoLinhas.length ? enderecoLinhas.map((l) => `<p>${escaparHtml(l)}</p>`).join("") : "<p>—</p>"}
      </div>
      <div class="detalhes-coluna">
        <h4>Itens</h4>
        <ul>${itensHtml}</ul>
      </div>
      <div class="detalhes-coluna">
        <h4>Pagamento</h4>
        <p>Plataforma: ${escaparHtml(pagamento.plataforma || p.plataformaPagamento || "—")}</p>
        <p>Método: ${escaparHtml(pagamento.metodo || "—")}</p>
        <p>Status: ${escaparHtml(pagamento.status || "—")}</p>
        <p>Valor pago: ${pagamento.valorPago != null ? formatBRLAdmin(pagamento.valorPago) : "—"}</p>
        <p>${linkPagamento}</p>
      </div>
      <div class="detalhes-coluna">
        <h4>Datas</h4>
        <p>Criado em: ${formatarDataAdmin(p.criadoEm)}</p>
        <p>Atualizado em: ${formatarDataAdmin(p.atualizadoEm)}</p>
      </div>
    </div>
  `;
}

const tbodyPedidos = document.querySelector("#tabela-pedidos tbody");
const vazioPedidos = document.querySelector("#painel-pedidos .tabela-vazia");
const checkboxSelecionarTodos = document.getElementById("checkbox-selecionar-todos");
const btnGerarEtiquetasLote = document.getElementById("btn-gerar-etiquetas-lote");

let pedidosCache = [];

function atualizarEstadoBotaoLote() {
  const algumSelecionado = !!tbodyPedidos.querySelector('input[type="checkbox"][data-pedido-id]:checked');
  btnGerarEtiquetasLote.disabled = !algumSelecionado;
}

function renderizarPedidos(pedidos) {
  pedidosCache = pedidos;
  tbodyPedidos.innerHTML = "";

  if (pedidos.length === 0) {
    vazioPedidos.hidden = false;
    return;
  }

  vazioPedidos.hidden = true;

  pedidos.forEach((p) => {
    const tr = document.createElement("tr");
    tr.className = "linha-pedido";

    const nomeItens = (p.itens || []).map((i) => i.nome).join(", ") || "—";
    const statusLabel = rotulosStatusPedido[p.status] || p.status || "—";

    let etiquetaCelula;
    if (p.etiqueta?.printUrl) {
      const etiquetaUrl = urlHttpsSegura(p.etiqueta.printUrl);
      etiquetaCelula = etiquetaUrl
        ? `<a href="${escaparHtml(etiquetaUrl)}" target="_blank" rel="noopener">Ver etiqueta</a>`
        : "—";
    } else if (p.etiquetaErro) {
      etiquetaCelula = `<span class="etiqueta-erro" title="${escaparHtml(p.etiquetaErro)}">Falhou</span>`;
    } else {
      etiquetaCelula = "—";
    }

    // Só faz sentido gerar etiqueta de pedido pago e que ainda não tem uma.
    const podeGerar = p.status === "pago" && !p.etiqueta?.printUrl;

    tr.innerHTML = `
      <td><input type="checkbox" data-pedido-id="${escaparHtml(p.id)}" ${podeGerar ? "" : "disabled"}></td>
      <td><span class="seta-expandir">▸</span>#${escaparHtml(p.numeroPedido || p.id)}</td>
      <td>${escaparHtml(p.cliente?.nome || p.cliente?.email || "—")}</td>
      <td>${escaparHtml(nomeItens)}</td>
      <td>${formatBRLAdmin(p.total)}</td>
      <td>${escaparHtml(statusLabel)}</td>
      <td>${etiquetaCelula}</td>
      <td class="col-acoes">
        <button class="btn-tabela" data-gerar-etiqueta="${escaparHtml(p.id)}" ${podeGerar ? "" : "disabled"}>
          Gerar etiqueta
        </button>
      </td>
    `;

    const trDetalhes = document.createElement("tr");
    trDetalhes.className = "linha-detalhes";
    trDetalhes.hidden = true;
    trDetalhes.innerHTML = `<td colspan="8">${construirDetalhesPedido(p)}</td>`;

    tr.addEventListener("click", (e) => {
      if (e.target.closest("input, button, a")) return;
      const vaiAbrir = trDetalhes.hidden;
      trDetalhes.hidden = !vaiAbrir;
      tr.classList.toggle("is-expandida", vaiAbrir);
    });

    tbodyPedidos.appendChild(tr);
    tbodyPedidos.appendChild(trDetalhes);
  });

  tbodyPedidos.querySelectorAll("[data-gerar-etiqueta]").forEach((btn) => {
    btn.onclick = () => gerarEtiquetaIndividual(btn.dataset.gerarEtiqueta, btn);
  });

  tbodyPedidos.querySelectorAll('input[type="checkbox"][data-pedido-id]').forEach((cb) => {
    cb.addEventListener("change", atualizarEstadoBotaoLote);
  });

  checkboxSelecionarTodos.checked = false;
  atualizarEstadoBotaoLote();
}

async function gerarEtiquetaIndividual(pedidoId, btn) {
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Gerando…";

  try {
    const gerarEtiquetaPedido = functions.httpsCallable("gerarEtiquetaPedido");
    await gerarEtiquetaPedido({ pedidoId });
    // O onSnapshot de /pedidos vai re-renderizar a linha automaticamente
    // assim que o Firestore atualizar com o resultado.
  } catch (err) {
    console.error(err);
    alert(`Erro ao gerar etiqueta do pedido ${pedidoId}: ${err.message}`);
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

checkboxSelecionarTodos.addEventListener("change", () => {
  tbodyPedidos.querySelectorAll('input[type="checkbox"][data-pedido-id]:not(:disabled)').forEach((cb) => {
    cb.checked = checkboxSelecionarTodos.checked;
  });
  atualizarEstadoBotaoLote();
});

btnGerarEtiquetasLote.addEventListener("click", async () => {
  const selecionados = Array.from(
    tbodyPedidos.querySelectorAll('input[type="checkbox"][data-pedido-id]:checked')
  ).map((cb) => cb.dataset.pedidoId);

  if (selecionados.length === 0) return;

  const confirmar = confirm(`Gerar etiqueta para ${selecionados.length} pedido(s) selecionado(s)?`);
  if (!confirmar) return;

  btnGerarEtiquetasLote.disabled = true;
  btnGerarEtiquetasLote.textContent = "Gerando…";

  try {
    const gerarEtiquetasEmLote = functions.httpsCallable("gerarEtiquetasEmLote");
    const { data } = await gerarEtiquetasEmLote({ pedidoIds: selecionados });

    const falhas = (data.resultados || []).filter((r) => !r.sucesso);
    if (falhas.length > 0) {
      alert(
        `${data.resultados.length - falhas.length} etiqueta(s) geradas com sucesso.\n` +
        `${falhas.length} falharam:\n` +
        falhas.map((f) => `- Pedido ${f.pedidoId}: ${f.erro}`).join("\n")
      );
    }
    // onSnapshot re-renderiza as linhas automaticamente.
  } catch (err) {
    console.error(err);
    alert("Erro ao gerar etiquetas em lote: " + err.message);
  } finally {
    btnGerarEtiquetasLote.textContent = "Gerar etiquetas selecionadas";
    atualizarEstadoBotaoLote();
  }
});

function iniciarListenerPedidos() {
  db.collection("pedidos")
    .onSnapshot((snapshot) => {
      const pedidos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      pedidos.sort((a, b) => {
        const dataA = a.criadoEm?.toDate ? a.criadoEm.toDate() : new Date(0);
        const dataB = b.criadoEm?.toDate ? b.criadoEm.toDate() : new Date(0);
        return dataB - dataA;
      });

      renderizarPedidos(pedidos);
    }, (error) => {
      console.error("Erro no listener de pedidos:", error);
    });
}

/* ==========================================================================
   ABA CONTAS — listagem de usuários + mensagem por e-mail/WhatsApp
   ========================================================================== */

const tbodyContas = document.querySelector("#tabela-contas tbody");
const vazioContas = document.querySelector("#painel-contas .tabela-vazia");

let usuariosCache = [];

function renderizarContas(usuarios) {
  tbodyContas.innerHTML = "";

  if (usuarios.length === 0) {
    vazioContas.hidden = false;
    return;
  }

  vazioContas.hidden = true;

  usuarios.forEach((u) => {
    const tr = document.createElement("tr");
    const temEmail = !!u.email;
    const temTelefone = !!u.telefone;

    tr.innerHTML = `
      <td>${escaparHtml(u.nome || "Sem nome")}</td>
      <td>${escaparHtml(u.email || "—")}</td>
      <td>${escaparHtml(u.telefone || "—")}</td>
      <td class="col-acoes">
        <button class="btn-tabela" data-msg-email="${escaparHtml(u.id)}" ${temEmail ? "" : "disabled"}>E-mail</button>
        <button class="btn-tabela" data-msg-whatsapp="${escaparHtml(u.id)}" ${temTelefone ? "" : "disabled"}>WhatsApp</button>
      </td>
    `;

    tbodyContas.appendChild(tr);
  });

  tbodyContas.querySelectorAll("[data-msg-email]").forEach((btn) => {
    btn.onclick = () => {
      const u = usuariosCache.find((x) => x.id === btn.dataset.msgEmail);
      if (u) abrirModalMensagem("email", u.email, u.nome);
    };
  });

  tbodyContas.querySelectorAll("[data-msg-whatsapp]").forEach((btn) => {
    btn.onclick = () => {
      const u = usuariosCache.find((x) => x.id === btn.dataset.msgWhatsapp);
      if (u) abrirModalMensagem("whatsapp", u.telefone, u.nome);
    };
  });
}

function iniciarListenerContas() {
  db.collection("usuarios")
    .onSnapshot((snapshot) => {
      usuariosCache = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      usuariosCache.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
      renderizarContas(usuariosCache);
    }, (error) => {
      console.error("Erro no listener de usuários:", error);
    });
}

/* ---------- Modal de mensagem ---------- */

const modalMensagem = document.getElementById("modal-mensagem");
const formMensagem = document.getElementById("form-mensagem");
const mensagemDestinatarioInfo = document.getElementById("mensagem-destinatario-info");
const mensagemAssuntoLabel = document.getElementById("mensagem-assunto-label");
const mensagemAssuntoInput = document.getElementById("mensagem-assunto");
const mensagemCorpoInput = document.getElementById("mensagem-corpo");

let mensagemAtual = null; // { tipo: 'email'|'whatsapp', valor, nome }

function abrirModalMensagem(tipo, valor, nome) {
  if (!valor) return; // sem email/telefone cadastrado — botão já vem disabled, mas por segurança

  mensagemAtual = { tipo, valor, nome };

  const canal = tipo === "email" ? "E-mail" : "WhatsApp";
  mensagemDestinatarioInfo.textContent = `Para ${nome || "cliente"} — ${canal}: ${valor}`;

  mensagemAssuntoLabel.hidden = tipo !== "email";
  mensagemAssuntoInput.value = "";
  mensagemCorpoInput.value = "";

  modalMensagem.hidden = false;
}

function fecharModalMensagem() {
  modalMensagem.hidden = true;
  mensagemAtual = null;
  formMensagem.reset();
}

document.querySelector('[data-action="fechar-modal-mensagem"]').onclick = fecharModalMensagem;

formMensagem.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!mensagemAtual) return;

  const corpo = mensagemCorpoInput.value.trim();
  if (!corpo) return;

  if (mensagemAtual.tipo === "email") {
    const assunto = mensagemAssuntoInput.value.trim();
    const url = `mailto:${encodeURIComponent(mensagemAtual.valor)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
    // mailto abre o cliente de e-mail padrão do computador/celular de
    // quem está no admin — não existe envio "pelo servidor" aqui.
    window.location.href = url;
  } else {
    // WhatsApp: precisa do número só com dígitos e prefixo do país (55 =
    // Brasil). Se o telefone salvo já tiver o "55" na frente, não duplica.
    let numero = String(mensagemAtual.valor).replace(/\D/g, "");
    if (!numero.startsWith("55")) numero = "55" + numero;
    const url = `https://wa.me/${numero}?text=${encodeURIComponent(corpo)}`;
    window.open(url, "_blank");
  }

  fecharModalMensagem();
});
