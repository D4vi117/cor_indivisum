/* ID confirmado no catálogo público do Firestore. */
const PRODUTO_ID = '0K6Fd5rWJhDMjiVf1EVq';

(() => {
  const buttons = [...document.querySelectorAll('[data-buy]')];
  const prices = [...document.querySelectorAll('[data-product-price]')];
  const status = document.getElementById('purchase-status');
  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  async function carregarProduto() {
    try {
      const produto = await obterProdutoPorId(PRODUTO_ID);
      if (!produto || produto.status?.ativo !== true || produto.status?.publicado !== true) {
        throw new Error('Produto indisponível');
      }
      const { precoFinal, precoOriginal, temDesconto } = extrairDadosPreco(produto);
      if (!Number.isFinite(precoFinal) || precoFinal <= 0) throw new Error('Preço indisponível');
      prices.forEach(element => {
        element.replaceChildren();
        if (temDesconto) {
          const previous = document.createElement('del');
          previous.textContent = currency.format(precoOriginal);
          element.append(previous, ' ');
        }
        element.append(currency.format(precoFinal));
      });
      if (produto.estoque?.disponivel === false) {
        status.textContent = 'Produto indisponível no momento.';
        buttons.forEach(button => { button.textContent = 'Indisponível'; });
        return;
      }
      status.textContent = 'Pré-venda disponível.';
      buttons.forEach(button => { button.disabled = false; });
    } catch (error) {
      prices.forEach(element => { element.textContent = 'Preço indisponível'; });
      status.textContent = 'Não foi possível consultar este produto. Recarregue a página ou consulte a loja.';
    }
  }

  buttons.forEach(button => button.addEventListener('click', async () => {
    buttons.forEach(item => { item.disabled = true; });
    status.textContent = 'Preparando sua compra…';
    try {
      await comprarDireto(PRODUTO_ID);
      status.textContent = 'Se o checkout não abrir, tente novamente.';
    } catch (error) {
      status.textContent = 'Não foi possível iniciar a compra. Tente novamente.';
    } finally {
      buttons.forEach(item => { item.disabled = false; });
    }
  }));

  carregarProduto();
})();
