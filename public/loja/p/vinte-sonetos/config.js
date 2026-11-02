/* ID do documento em produtos, informado pelo responsável pela loja. */
const PRODUTO_ID = '2fgfDyZmJ9g7H8BzyOC8';
(() => {
  const buttons = [...document.querySelectorAll('[data-purchase]')];
  const status = document.getElementById('purchase-status');
  buttons.forEach(button => button.addEventListener('click', async () => {
    buttons.forEach(item => { item.disabled = true; });
    status.textContent = 'Preparando sua compra…';
    try {
      if (button.dataset.purchase === 'comprar') {
        await comprarDireto(PRODUTO_ID);
      } else {
        await adicionarAoCarrinho(PRODUTO_ID);
      }
      status.textContent = '';
    } catch (error) {
      status.textContent = 'Não foi possível concluir a ação. Tente novamente ou acesse a loja.';
    } finally {
      buttons.forEach(item => { item.disabled = false; });
    }
  }));
})();
