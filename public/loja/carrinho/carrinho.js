function obterCarrinho() {
  return JSON.parse(localStorage.getItem("carrinho_cor_indivisum")) || [];
}

function salvarCarrinho(carrinho) {
  localStorage.setItem("carrinho_cor_indivisum", JSON.stringify(carrinho));
  renderizarPaginaCarrinho();
}

function renderizarPaginaCarrinho() {
  const carrinho = obterCarrinho();
  const tbody = document.getElementById("carrinho-tbody");
  const msgVazio = document.getElementById("carrinho-vazio-msg");
  const subtotalEl = document.getElementById("carrinho-subtotal");
  const btnCheckout = document.getElementById("btn-ir-checkout");

  tbody.innerHTML = "";

  if (carrinho.length === 0) {
    msgVazio.hidden = false;
    document.querySelector(".carrinho-tabela").hidden = true;
    subtotalEl.textContent = "R$ 0,00";
    btnCheckout.style.pointerEvents = "none";
    btnCheckout.style.opacity = "0.5";
    return;
  }

  msgVazio.hidden = true;
  document.querySelector(".carrinho-tabela").hidden = false;
  btnCheckout.style.pointerEvents = "auto";
  btnCheckout.style.opacity = "1";

  let subtotal = 0;

  carrinho.forEach((item, idx) => {
    const totalItem = item.preco * item.qtd;
    subtotal += totalItem;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-produto">
        <img src="/loja/${item.foto || '/assets/placeholder-produto.png'}" alt="${item.nome}">
        <span>${item.nome}</span>
      </td>
      <td>R$ ${item.preco.toFixed(2).replace('.', ',')}</td>
      <td>
        <div class="qtd-control">
          <button onclick="alterarQtd(${idx}, -1)">-</button>
          <span>${item.qtd}</span>
          <button onclick="alterarQtd(${idx}, 1)">+</button>
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