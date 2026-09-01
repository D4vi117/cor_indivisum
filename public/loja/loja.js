let todosProdutos = [];
let ultimoElementoFocadoNoCarrinho = null;

/* ==========================================================================
   1. GERENCIAMENTO DO CARRINHO (LOCALSTORAGE)
   ========================================================================== */

function obterCarrinho() {
  return JSON.parse(localStorage.getItem("carrinho_cor_indivisum")) || [];
}

function salvarCarrinho(carrinho) {
  localStorage.setItem("carrinho_cor_indivisum", JSON.stringify(carrinho));
  atualizarCarrinhoUI();
}

function atualizarCarrinhoUI() {
  const carrinho = obterCarrinho();
  const totalItens = carrinho.reduce((acc, item) => acc + item.qtd, 0);

  // Atualizar contador do topo
  const countEl = document.getElementById("cart-count");
  if (countEl) countEl.textContent = totalItens;

  // Atualizar conteúdo do Modal
  renderizarModalCarrinho(carrinho);
}

/* ==========================================================================
   2. INTERFACES DO MODAL DO CARRINHO
   ========================================================================== */

function renderizarModalCarrinho(carrinho) {
  const container = document.getElementById("modal-carrinho-itens");
  const subtotalEl = document.getElementById("modal-carrinho-subtotal");
  if (!container) return;

  container.innerHTML = "";

  if (carrinho.length === 0) {
    container.innerHTML = `<p class="carrinho-vazio-text">Seu carrinho está vazio.</p>`;
    if (subtotalEl) subtotalEl.textContent = "R$ 0,00";
    return;
  }

  let subtotal = 0;

  carrinho.forEach((item, idx) => {
    const itemTotal = item.preco * item.qtd;
    subtotal += itemTotal;

    const div = document.createElement("div");
    div.className = "cart-item-row";
    div.innerHTML = `
      <img src="${item.foto || '/assets/placeholder-produto.png'}" alt="${item.nome}">
      <div class="cart-item-details">
        <h4>${item.nome}</h4>
        <span class="cart-item-price">R$ ${item.preco.toFixed(2).replace('.', ',')}</span>
        <div class="cart-item-qtd-ctrl">
          <button type="button" onclick="alterarQtdModal(${idx}, -1)">-</button>
          <span>${item.qtd}</span>
          <button type="button" onclick="alterarQtdModal(${idx}, 1)">+</button>
        </div>
      </div>
      <button type="button" class="btn-remover-item" onclick="removerDoCarrinho(${idx})">&times;</button>
    `;
    container.appendChild(div);
  });

  if (subtotalEl) subtotalEl.textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
}

function alterarQtdModal(index, delta) {
  let carrinho = obterCarrinho();
  carrinho[index].qtd += delta;

  if (carrinho[index].qtd <= 0) {
    carrinho.splice(index, 1);
  }

  salvarCarrinho(carrinho);
}

function removerDoCarrinho(index) {
  let carrinho = obterCarrinho();
  carrinho.splice(index, 1);
  salvarCarrinho(carrinho);
}

function abrirModalCarrinho() {
  const modal = document.getElementById("carrinho-modal");
  if (!modal) return;

  ultimoElementoFocadoNoCarrinho = document.activeElement;
  modal.hidden = false;
  document.body.classList.add("carrinho-modal-aberto");
  requestAnimationFrame(() => document.getElementById("btn-fechar-carrinho")?.focus());
}

function fecharModalCarrinho() {
  const modal = document.getElementById("carrinho-modal");
  if (!modal || modal.hidden) return;

  modal.hidden = true;
  document.body.classList.remove("carrinho-modal-aberto");
  ultimoElementoFocadoNoCarrinho?.focus?.();
}

function manterFocoNoModalCarrinho(event) {
  const modal = document.getElementById("carrinho-modal");
  if (!modal || modal.hidden) return;

  if (event.key === "Escape") {
    event.preventDefault();
    fecharModalCarrinho();
    return;
  }

  if (event.key !== "Tab") return;

  const focaveis = [...modal.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((elemento) => !elemento.hidden);
  if (focaveis.length === 0) return;

  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];
  if (event.shiftKey && document.activeElement === primeiro) {
    event.preventDefault();
    ultimo.focus();
  } else if (!event.shiftKey && document.activeElement === ultimo) {
    event.preventDefault();
    primeiro.focus();
  }
}

/* ==========================================================================
   3. HELPER DE EXTRAÇÃO DE PREÇOS (SUPORTE À NOVA E ANTIGA ESTRUTURA)
   ========================================================================== */

function extrairDadosPreco(p) {
  let precoOriginal = 0;
  let precoPromocional = 0;
  let emOfertaFlag = false;

  // 1. Tenta extrair da estrutura nova
  if (p.precos && typeof p.precos === "object") {
    precoOriginal = Number(p.precos.de) || 0;
    precoPromocional = Number(p.precos.por) || 0;
    emOfertaFlag = p.precos.emOferta === true || p.precos.emOferta === "true";
  } else {
    // 2. Fallback para estrutura antiga
    precoOriginal = Number(p.preco) || 0;
    precoPromocional = Number(p.precoPromocional) || 0;
    emOfertaFlag = precoPromocional > 0 && precoPromocional < precoOriginal;
  }

  // Define se realmente tem desconto válido a ser exibido
  const temDesconto = emOfertaFlag && precoPromocional > 0 && precoPromocional < precoOriginal;
  const precoFinal = temDesconto ? precoPromocional : (precoOriginal > 0 ? precoOriginal : precoPromocional);

  return {
    precoOriginal,
    precoPromocional,
    precoFinal,
    temDesconto
  };
}

/* ==========================================================================
   4. AÇÕES DE COMPRA / ADIÇÃO
   ========================================================================== */

// Adiciona ao carrinho acumulativo e abre o Modal Drawer
function adicionarAoCarrinho(produtoId) {
  const produto = todosProdutos.find(p => p.id === produtoId);
  if (!produto) return;

  let carrinho = obterCarrinho();
  const index = carrinho.findIndex(item => item.id === produtoId);

  const { precoFinal } = extrairDadosPreco(produto);
  const foto = produto.midias?.fotoPrincipal || produto.fotoPrincipal || "";

  if (index > -1) {
    carrinho[index].qtd += 1;
  } else {
    carrinho.push({
      id: produto.id,
      nome: produto.nome,
      preco: precoFinal,
      foto: foto,
      slug: produto.slug || "",
      qtd: 1
    });
  }

  salvarCarrinho(carrinho);
  abrirModalCarrinho();
}

/* ==========================================================================
   5. CARREGAMENTO DO FIRESTORE E FILTROS
   ========================================================================== */

async function carregarProdutos() {
  const container = document.getElementById("produtos-container");

  try {
    const snap = await db
      .collection("produtos")
      .where("status.ativo", "==", true)
      .where("status.publicado", "==", true)
      .get();

    if (snap.empty) {
      container.innerHTML = `<p class="empty-state">Nenhum produto disponível no momento.</p>`;
      return;
    }

    todosProdutos = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(p => p.status?.ativo === true && p.status?.publicado === true);

    if (todosProdutos.length === 0) {
      container.innerHTML = `<p class="empty-state">Nenhum produto publicado no momento.</p>`;
      return;
    }

    preencherFiltroCategorias(todosProdutos);
    renderizarProdutos(todosProdutos);

  } catch (err) {
    console.error("Erro ao carregar produtos:", err);
    container.innerHTML = `<p class="error-state">Erro ao carregar os produtos. Tente novamente mais tarde.</p>`;
  }
}

function preencherFiltroCategorias(produtos) {
  const selectCat = document.getElementById("select-categoria");
  if (!selectCat) return;

  const categorias = [...new Set(produtos.map(p => p.categoria).filter(Boolean))];

  categorias.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    selectCat.appendChild(opt);
  });
}

function renderizarProdutos(produtos) {
  const container = document.getElementById("produtos-container");
  if (!container) return;
  
  container.innerHTML = "";

  if (produtos.length === 0) {
    container.innerHTML = `<p class="empty-state">Nenhum produto encontrado com esses filtros.</p>`;
    return;
  }

  produtos.forEach(p => {
    const card = document.createElement("article");
    card.className = "produto-card";

    // Preços tratados via helper
    const { precoOriginal, precoPromocional, precoFinal, temDesconto } = extrairDadosPreco(p);

    // Mídias e descrições com suporte à estrutura nova e antiga
    const fotoPrincipal = p.midias?.fotoPrincipal || '/assets/placeholder-produto.png';
    const descricaoCurta = p.conteudo?.descricaoCurta || '';
    const eDestaque = p.status?.destaque;

    card.innerHTML = `
      <div class="card-thumb">
        ${eDestaque ? `<span class="tag-destaque">Destaque</span>` : ""}
        <a href="/loja/p/${p.slug || p.id}">
          <img src="${fotoPrincipal}" alt="${p.nome}" loading="lazy">
        </a>
      </div>
      
      <div class="card-content">
        <span class="card-categoria">${p.categoria || ''}</span>
        <h2 class="card-titulo"><a href="/loja/p/${p.slug || p.id}">${p.nome}</a></h2>
        <p class="card-descricao">${descricaoCurta}</p>
        <a href="/loja/p/${p.slug || p.id}" class="card-detalhes-link">Ver detalhes</a>
        <div class="card-preco-wrap">
          ${temDesconto 
            ? `<span class="preco-antigo">R$ ${precoOriginal.toFixed(2).replace('.', ',')}</span>
               <span class="preco-atual">R$ ${precoPromocional.toFixed(2).replace('.', ',')}</span>`
            : `<span class="preco-atual">R$ ${precoFinal.toFixed(2).replace('.', ',')}</span>`
          }
        </div>

        <div class="card-acoes">
          <button class="btn-adicionar-carrinho" onclick="adicionarAoCarrinho('${p.id}')">
            + Carrinho
          </button>
          <button class="btn-comprar-direto" onclick="comprarDireto('${p.id}')">
            Comprar Agora
          </button>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function aplicarFiltros() {
  const busca = document.getElementById("input-busca").value.toLowerCase().trim();
  const categoria = document.getElementById("select-categoria").value;

  const filtrados = todosProdutos.filter(p => {
    const desc = p.conteudo?.descricaoCurta || p.descricaoCurta || '';
    const bateBusca = p.nome.toLowerCase().includes(busca) || desc.toLowerCase().includes(busca);
    const bateCategoria = categoria === "" || p.categoria === categoria;

    return bateBusca && bateCategoria;
  });

  renderizarProdutos(filtrados);
}

/* ==========================================================================
   6. INICIALIZAÇÃO DE EVENTOS
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  carregarProdutos();
  atualizarCarrinhoUI();

  // Controles de Busca e Filtro
  const inputBusca = document.getElementById("input-busca");
  const selectCat = document.getElementById("select-categoria");

  if (inputBusca) inputBusca.addEventListener("input", aplicarFiltros);
  if (selectCat) selectCat.addEventListener("change", aplicarFiltros);

  // Abertura e fechamento do Modal
  const btnAbrir = document.getElementById("btn-abrir-carrinho");
  const btnFechar = document.getElementById("btn-fechar-carrinho");
  const modalOverlay = document.getElementById("carrinho-modal");

  if (btnAbrir) btnAbrir.onclick = abrirModalCarrinho;
  if (btnFechar) btnFechar.onclick = fecharModalCarrinho;
  
  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target.id === "carrinho-modal") fecharModalCarrinho();
    });
  }

  document.addEventListener("keydown", manterFocoNoModalCarrinho);
});
