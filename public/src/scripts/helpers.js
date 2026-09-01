// =============================================================
// HELPERS COMPARTILHADOS
// Depende de: firebase-init.js
// Usado por: script.js, loja.js, checkout.js, pagamento.js,
//            minha-conta.js, login.js
// =============================================================

/**
 * Exibe uma mensagem de erro temporária na caixa #erro-msg.
 * Todas as páginas de fluxo (checkout, pagamento) têm esse elemento.
 */
function mostrarErro(msg, duracaoMs = 4000) {
  const box = document.getElementById("erro-msg");
  if (!box) { console.warn("mostrarErro: elemento #erro-msg não encontrado"); return; }
  box.textContent = msg;
  box.style.display = "block";
  setTimeout(() => { box.style.display = "none"; }, duracaoMs);
}

/**
 * Formata um valor numérico como moeda BRL.
 * Ex.: formatarBRL(29.9) → "R$ 29,90"
 */
function formatarBRL(valor) {
  return `R$ ${Number(valor).toFixed(2).replace(".", ",")}`;
}

/**
 * Lê o usuário atual do Firebase Auth.
 * Retorna null se não houver sessão ativa.
 */
function usuarioAtual() {
  return auth.currentUser || null;
}

/**
 * Redireciona para /login preservando a URL de destino como query param.
 * Ex.: redirecionarLogin() → /login?next=/loja/checkout
 */
function redirecionarLogin(destino = window.location.pathname) {
  window.location.href = `/login?next=${encodeURIComponent(destino)}`;
}