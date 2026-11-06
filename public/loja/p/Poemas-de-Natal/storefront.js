(() => {
  'use strict';
  const productId = window.POEMAS_NATAL_STOREFRONT?.productId;
  const buttons = [...document.querySelectorAll('[data-action]')];
  const status = document.getElementById('purchase-status');
  const message = (text) => { status.textContent = text; };
  let pending = false;

  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      if (pending) return;
      const action = button.dataset.action === 'buy-now'
        ? window.comprarDireto : window.adicionarAoCarrinho;
      if (!productId || typeof action !== 'function') {
        message('Não foi possível iniciar a compra. Recarregue a página ou acesse a loja.');
        return;
      }
      pending = true;
      buttons.forEach((item) => { item.disabled = true; });
      message('Processando sua solicitação…');
      try {
        await action(productId);
        message('');
      } catch (error) {
        message('Não foi possível concluir a solicitação. Tente novamente ou acesse a loja.');
      } finally {
        pending = false;
        buttons.forEach((item) => { item.disabled = false; });
      }
    });
  });

  async function loadPrice() {
    try {
      if (!productId || typeof window.obterProdutoPorId !== 'function' ||
          typeof window.extrairDadosPreco !== 'function') throw new Error('Integração indisponível');
      const product = await window.obterProdutoPorId(productId);
      if (!product) throw new Error('Produto indisponível');
      const price = window.extrairDadosPreco(product);
      if (!Number.isFinite(price.precoFinal) || price.precoFinal <= 0) throw new Error('Preço indisponível');
      const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
      document.querySelectorAll('[data-product-price]').forEach((node) => {
        node.textContent = currency.format(price.precoFinal);
      });
      document.querySelectorAll('[data-product-original]').forEach((node) => {
        node.hidden = !price.temDesconto;
        node.textContent = price.temDesconto ? `Preço anterior: ${currency.format(price.precoOriginal)}` : '';
      });
    } catch (error) {
      document.querySelectorAll('[data-product-price]').forEach((node) => {
        node.textContent = 'Consulte o preço na loja';
      });
      message('Não foi possível consultar o preço agora. Você pode tentar novamente pela loja.');
    }
  }
  loadPrice();
})();
