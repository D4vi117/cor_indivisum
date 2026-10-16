function obterCarrinho() {
  return JSON.parse(localStorage.getItem("carrinho_cor_indivisum")) || [];
}

function salvarCarrinho(carrinho) {
  localStorage.setItem("carrinho_cor_indivisum", JSON.stringify(carrinho));
  renderizarPaginaCarrinho();
}

async function renderizarPaginaCarrinho() {
  const carrinho = obterCarrinho();
  const tbody = document.getElementById("carrinho-tbody");
  const msgVazio = document.getElementById("carrinho-vazio-msg");
  const subtotalEl = document.getElementById("carrinho-subtotal");
  const btnCheckout = document.getElementById("btn-ir-checkout");
  btnCheckout.onclick = (event) => {
    if (btnCheckout.getAttribute("aria-disabled") === "true") event.preventDefault();
  };
  const estoquePorId = new Map();

  try {
    await Promise.all(carrinho.map(async (item) => {
      const doc = await db.collection("produtos").doc(item.id).get();
      const produto = doc.exists ? doc.data() : {};
      const ignoraEstoque = produto.status?.preVenda === true &&
        produto.status?.preVendaIgnoraEstoque === true;
      estoquePorId.set(item.id, ignoraEstoque ? Infinity : Number(produto.estoque?.quantidade) || 0);
    }));
  } catch (err) {
    console.error("Erro ao validar estoque do carrinho:", err);
    btnCheckout.setAttribute("aria-disabled", "true");
    btnCheckout.setAttribute("tabindex", "-1");
    btnCheckout.style.pointerEvents = "none";
    btnCheckout.style.opacity = "0.5";
    tbody.innerHTML = '<tr><td colspan="5">Não foi possível conferir o estoque. Atualize a página e tente novamente.</td></tr>';
    return;
  }

  const temEstoqueInsuficiente = carrinho.some((item) => (estoquePorId.get(item.id) || 0) < item.qtd);

  tbody.innerHTML = "";

  if (carrinho.length === 0) {
    msgVazio.hidden = false;
    document.querySelector(".carrinho-tabela").hidden = true;
    subtotalEl.textContent = "R$ 0,00";
    btnCheckout.setAttribute("aria-disabled", "true");
    btnCheckout.setAttribute("tabindex", "-1");
    btnCheckout.style.pointerEvents = "none";
    btnCheckout.style.opacity = "0.5";
    return;
  }

  msgVazio.hidden = true;
  document.querySelector(".carrinho-tabela").hidden = false;
  btnCheckout.setAttribute("aria-disabled", String(temEstoqueInsuficiente));
  if (temEstoqueInsuficiente) btnCheckout.setAttribute("tabindex", "-1");
  else btnCheckout.removeAttribute("tabindex");
  btnCheckout.style.pointerEvents = temEstoqueInsuficiente ? "none" : "auto";
  btnCheckout.style.opacity = temEstoqueInsuficiente ? "0.5" : "1";

  let subtotal = 0;

  carrinho.forEach((item, idx) => {
    const totalItem = item.preco * item.qtd;
    subtotal += totalItem;
    const estoque = estoquePorId.get(item.id) || 0;
    const indisponivel = item.qtd > estoque;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-produto">
        <img src="/loja/${item.foto || '/assets/placeholder-produto.png'}" alt="${item.nome}">
        <span>${item.nome}${indisponivel ? ` — ${estoque > 0 ? `apenas ${estoque} disponível(is)` : "esgotado"}` : ""}</span>
      </td>
      <td>R$ ${item.preco.toFixed(2).replace('.', ',')}</td>
      <td>
        <div class="qtd-control">
          <button onclick="alterarQtd(${idx}, -1)">-</button>
          <span>${item.qtd}</span>
          <button onclick="alterarQtd(${idx}, 1)" ${item.qtd >= estoque ? "disabled" : ""}>+</button>
        </div>
      </td>
      <td><strong>R$ ${totalItem.toFixed(2).replace('.', ',')}</strong></td>
      <td>
        <button class="btn-remover" onclick="removerItem(${idx})">&times;</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  subtotalEl.textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
}

function alterarQtd(index, delta) {
  let carrinho = obterCarrinho();
  if (delta > 0) {
    db.collection("produtos").doc(carrinho[index].id).get().then((doc) => {
      const produto = doc.exists ? doc.data() : {};
      const ignoraEstoque = produto.status?.preVenda === true &&
        produto.status?.preVendaIgnoraEstoque === true;
      const estoque = ignoraEstoque ? Infinity : Number(produto.estoque?.quantidade) || 0;
      if (!ignoraEstoque && carrinho[index].qtd + delta > estoque) {
        alert(estoque > 0 ? `Há apenas ${estoque} unidade(s) disponíveis.` : "Este produto está esgotado.");
        return;
      }
      carrinho[index].qtd += delta;
      salvarCarrinho(carrinho);
    }).catch(() => alert("Não foi possível conferir o estoque. Tente novamente."));
    return;
  }
  carrinho[index].qtd += delta;

  if (carrinho[index].qtd <= 0) {
    carrinho.splice(index, 1);
  }

  salvarCarrinho(carrinho);
}

function removerItem(index) {
  let carrinho = obterCarrinho();
  carrinho.splice(index, 1);
  salvarCarrinho(carrinho);
}

document.addEventListener("DOMContentLoaded", renderizarPaginaCarrinho);
