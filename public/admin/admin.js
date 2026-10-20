document.querySelectorAll(".admin-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("is-active"));
    document.querySelectorAll(".admin-panel").forEach((p) => p.classList.remove("is-active"));

    tab.classList.add("is-active");
    document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("is-active");
    if (tab.dataset.tab === "newsletter" && typeof window.iniciarNewsletterAdmin === "function") {
      window.iniciarNewsletterAdmin();
    }
    if (tab.dataset.tab === "cupons" && typeof window.iniciarCuponsAdmin === "function") {
      window.iniciarCuponsAdmin();
    }
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

function linkPagamentoDoPedido(pedido) {
  const checkout = pedido?.infinitepay || {};
  return checkout.url || checkout.link || checkout.checkout_link || checkout.paymentLink ||
    checkout.payment_url || checkout.payment_link || checkout.checkout_url ||
    checkout.data?.link || checkout.data?.url || checkout.data?.checkout_url || "";
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
  if (new URLSearchParams(window.location.search).get("tab") === "newsletter") {
    document.querySelector('[data-tab="newsletter"]')?.click();
  }
});

/* ==========================================================================
   ABA PEDIDOS — listagem, geração de etiqueta individual e em lote
   ========================================================================== */

const rotulosStatusPedido = {
  "Pendente": "Pendente",
  "pago": "Pago",
  "aguardando_pagamento": "Aguardando pagamento",
  "enviado": "Enviado",
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

  const pagamentoUrl = urlHttpsSegura(linkPagamentoDoPedido(p));
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
        <button type="button" class="btn-tabela" data-ver-cliente-pedido="${escaparHtml(p.id)}">Ver cliente e pedidos</button>
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
const buscaPedidos = document.getElementById("pedidos-busca");
const filtroStatusPedidos = document.getElementById("pedidos-status");
const contagemPedidos = document.getElementById("pedidos-contagem");
const modalClientePedidos = document.getElementById("modal-cliente-pedidos");
const modalEditarPedido = document.getElementById("modal-editar-pedido");
const formEditarPedido = document.getElementById("form-editar-pedido");
const feedbackEditarPedido = document.getElementById("editar-pedido-feedback");

let pedidosCache = [];

function atualizarEstadoBotaoLote() {
  const algumSelecionado = !!tbodyPedidos.querySelector('input[type="checkbox"][data-pedido-id]:checked');
  btnGerarEtiquetasLote.disabled = !algumSelecionado;
}

function renderizarPedidos(pedidos) {
  pedidosCache = pedidos;
  const query = normalizarBusca(buscaPedidos?.value);
  const queryDigitos = query.replace(/\D/g, "");
  const statusFiltro = filtroStatusPedidos?.value || "";
  const filtrados = pedidos.filter((p) => {
    if (statusFiltro && p.status !== statusFiltro) return false;
    const cliente = p.cliente || {};
    const texto = normalizarBusca([
      p.numeroPedido, p.id, cliente.nome, cliente.email, cliente.documento,
      cliente.telefone, ...(p.itens || []).map((item) => item.nome),
    ].join(" "));
    return !query || texto.includes(query) || (queryDigitos.length >= 2 && String(cliente.documento || "").replace(/\D/g, "").includes(queryDigitos));
  });
  tbodyPedidos.innerHTML = "";
  if (contagemPedidos) contagemPedidos.textContent = `${filtrados.length} de ${pedidos.length} pedidos`;

  if (filtrados.length === 0) {
    vazioPedidos.hidden = false;
    vazioPedidos.textContent = pedidos.length ? "Nenhum pedido corresponde aos filtros." : "Nenhum pedido registrado ainda.";
    checkboxSelecionarTodos.checked = false;
    atualizarEstadoBotaoLote();
    return;
  }

  vazioPedidos.hidden = true;

  filtrados.forEach((p) => {
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
        <button class="btn-tabela" data-editar-pedido="${escaparHtml(p.id)}">Editar</button>
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
    tr.dataset.pedidoRowId = p.id;
  });

  tbodyPedidos.querySelectorAll("[data-editar-pedido]").forEach((btn) => {
    btn.onclick = () => abrirEdicaoPedido(btn.dataset.editarPedido);
  });
  tbodyPedidos.querySelectorAll("[data-ver-cliente-pedido]").forEach((btn) => {
    btn.onclick = () => abrirPerfilClienteDoPedido(btn.dataset.verClientePedido);
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

function abrirEdicaoPedido(pedidoId) {
  const pedido = pedidosCache.find((item) => item.id === pedidoId);
  if (!pedido || !formEditarPedido) return;
  formEditarPedido.dataset.pedidoId = pedidoId;
  formEditarPedido.querySelector('[name="status"]').value = rotulosStatusPedido[pedido.status] ? pedido.status : "aguardando_pagamento";
  formEditarPedido.querySelector('[name="linkPagamento"]').value = linkPagamentoDoPedido(pedido);
  document.getElementById("editar-pedido-numero").textContent = `Pedido #${pedido.numeroPedido || pedido.id}`;
  feedbackEditarPedido.textContent = "";
  modalEditarPedido.hidden = false;
}

function pedidosDoCliente(cliente = {}) {
  const uid = cliente.uid || cliente.id || "";
  const documento = String(cliente.documento || "").replace(/\D/g, "");
  const email = normalizarBusca(cliente.email);
  return pedidosCache.filter((item) => {
    const outro = item.cliente || {};
    if (uid && outro.uid) return uid === outro.uid;
    if (documento && String(outro.documento || "").replace(/\D/g, "") === documento) return true;
    return Boolean(email && normalizarBusca(outro.email) === email);
  }).sort((a, b) => {
    const timeA = a.criadoEm?.toMillis?.() || 0;
    const timeB = b.criadoEm?.toMillis?.() || 0;
    return timeB - timeA;
  });
}

function abrirPerfilClienteDoPedido(pedidoId) {
  const pedido = pedidosCache.find((item) => item.id === pedidoId);
  if (pedido) abrirPerfilCliente(pedido.cliente || {});
}

function abrirPerfilCliente(cliente = {}) {
  const relacionados = pedidosDoCliente(cliente);

  document.getElementById("cliente-pedidos-titulo").textContent = cliente.nome || "Cliente";
  const profile = document.getElementById("cliente-pedidos-perfil");
  profile.replaceChildren();
  [cliente.documento && `Documento: ${cliente.documento}`, cliente.email && `E-mail: ${cliente.email}`, cliente.telefone && `Telefone: ${cliente.telefone}`]
    .filter(Boolean).forEach((value) => {
      const line = document.createElement("p");
      line.textContent = value;
      profile.appendChild(line);
    });

  const list = document.getElementById("cliente-pedidos-lista");
  list.replaceChildren();
  relacionados.forEach((item) => {
    const row = document.createElement("article");
    row.className = "cliente-pedido-card";
    const info = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = `#${item.numeroPedido || item.id} · ${rotulosStatusPedido[item.status] || item.status || "—"}`;
    const summary = document.createElement("span");
    summary.textContent = `${formatarDataAdmin(item.criadoEm)} · ${formatBRLAdmin(item.total)}`;
    info.append(heading, summary);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn-tabela";
    open.textContent = "Abrir pedido";
    open.addEventListener("click", () => focarPedido(item.id));
    row.append(info, open);
    list.appendChild(row);
  });
  if (!relacionados.length) list.textContent = "Nenhum pedido encontrado para este cliente.";
  modalClientePedidos.hidden = false;
}

function contarPedidosDaConta(conta) {
  return pedidosDoCliente(conta).length;
}

function focarPedido(pedidoId) {
  modalClientePedidos.hidden = true;
  if (buscaPedidos) buscaPedidos.value = "";
  if (filtroStatusPedidos) filtroStatusPedidos.value = "";
  renderizarPedidos(pedidosCache);
  const row = Array.from(tbodyPedidos.querySelectorAll("[data-pedido-row-id]"))
    .find((item) => item.dataset.pedidoRowId === pedidoId);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  const details = row.nextElementSibling;
  if (details?.classList.contains("linha-detalhes")) {
    details.hidden = false;
    row.classList.add("is-expandida");
  }
}

document.querySelectorAll('[data-action="fechar-cliente-pedidos"]').forEach((button) => {
  button.addEventListener("click", () => { modalClientePedidos.hidden = true; });
});
document.querySelectorAll('[data-action="fechar-editar-pedido"]').forEach((button) => {
  button.addEventListener("click", () => { modalEditarPedido.hidden = true; });
});
modalClientePedidos?.addEventListener("click", (event) => {
  if (event.target === modalClientePedidos) modalClientePedidos.hidden = true;
});
modalEditarPedido?.addEventListener("click", (event) => {
  if (event.target === modalEditarPedido) modalEditarPedido.hidden = true;
});

formEditarPedido?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pedidoId = formEditarPedido.dataset.pedidoId;
  const status = formEditarPedido.querySelector('[name="status"]').value;
  const linkPagamento = formEditarPedido.querySelector('[name="linkPagamento"]').value.trim();
  if (["pago", "cancelado", "reembolsado"].includes(status) && !window.confirm(`Confirmar a alteração do status para “${rotulosStatusPedido[status]}”?`)) return;
  const submit = formEditarPedido.querySelector('[type="submit"]');
  submit.disabled = true;
  feedbackEditarPedido.textContent = "Salvando…";
  try {
    const call = functions.httpsCallable("adminAtualizarPedido");
    await call({ pedidoId, status, linkPagamento });
    feedbackEditarPedido.textContent = "Pedido atualizado.";
    modalEditarPedido.hidden = true;
  } catch (error) {
    console.error("Não foi possível atualizar o pedido:", error);
    feedbackEditarPedido.textContent = error.message || "Não foi possível salvar as alterações.";
  } finally {
    submit.disabled = false;
  }
});

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
      renderizarContas(usuariosCache);
    }, (error) => {
      console.error("Erro no listener de pedidos:", error);
    });
}

/* ==========================================================================
   ABA CONTAS — listagem de usuários + mensagem por e-mail/WhatsApp
   ========================================================================== */

const tbodyContas = document.querySelector("#tabela-contas tbody");
const vazioContas = document.querySelector("#painel-contas .tabela-vazia");
const buscaContas = document.getElementById("contas-busca");
const contagemContas = document.getElementById("contas-contagem");

let usuariosCache = [];

function renderizarContas(usuarios) {
  const query = normalizarBusca(buscaContas?.value);
  const queryDigitos = query.replace(/\D/g, "");
  const filtrados = usuarios.filter((u) => {
    const texto = normalizarBusca([u.documento, u.nome, u.email, u.telefone].join(" "));
    return !query || texto.includes(query) || (queryDigitos.length >= 2 && String(u.documento || "").replace(/\D/g, "").includes(queryDigitos));
  });
  tbodyContas.innerHTML = "";
  if (contagemContas) contagemContas.textContent = `${filtrados.length} de ${usuarios.length} contas`;

  if (filtrados.length === 0) {
    vazioContas.hidden = false;
    vazioContas.textContent = usuarios.length ? "Nenhuma conta corresponde à busca." : "Nenhuma conta cadastrada ainda.";
    return;
  }

  vazioContas.hidden = true;

  usuarios.forEach((u) => {
    if (!filtrados.includes(u)) return;
    const tr = document.createElement("tr");
    const temEmail = !!u.email;
    const temTelefone = !!u.telefone;

    tr.innerHTML = `
      <td>${escaparHtml(u.nome || "Sem nome")}</td>
      <td>${escaparHtml(u.documento || "—")}</td>
      <td>${escaparHtml(u.email || "—")}</td>
      <td>${escaparHtml(u.telefone || "—")}</td>
      <td><button class="btn-tabela" data-ver-conta-pedidos="${escaparHtml(u.id)}">${contarPedidosDaConta(u)} pedido(s)</button></td>
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

  tbodyContas.querySelectorAll("[data-ver-conta-pedidos]").forEach((btn) => {
    btn.onclick = () => {
      const conta = usuariosCache.find((item) => item.id === btn.dataset.verContaPedidos);
      if (conta) abrirPerfilCliente(conta);
    };
  });

  tbodyContas.querySelectorAll("[data-msg-whatsapp]").forEach((btn) => {
    btn.onclick = () => {
      const u = usuariosCache.find((x) => x.id === btn.dataset.msgWhatsapp);
      if (u) abrirModalMensagem("whatsapp", u.telefone, u.nome);
    };
  });
}

function normalizarBusca(valor) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");
}

buscaPedidos?.addEventListener("input", () => renderizarPedidos(pedidosCache));
filtroStatusPedidos?.addEventListener("change", () => renderizarPedidos(pedidosCache));
buscaContas?.addEventListener("input", () => renderizarContas(usuariosCache));

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
