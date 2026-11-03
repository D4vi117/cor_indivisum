(() => {
  if (document.querySelector('footer.site-footer')) return;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/src/styles/site-footer.css?v=4'; document.head.append(css);
  const footer = document.createElement('footer'); footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="sf-inner"><div class="sf-top">
      <div class="sf-identity">
        <a class="sf-brand" href="/loja/">COR INDIVISUM</a>
        <p class="sf-description">Iniciativa católica leiga.<br>Produção audiovisual, editora e formação.</p>
        <nav class="sf-social" aria-label="Redes sociais">
          <a href="https://www.youtube.com/@CORINDIVISUM" target="_blank" rel="noopener noreferrer">YouTube <span class="sf-sr">(abre em nova aba)</span></a>
          <a href="https://www.instagram.com/corindivisum/" target="_blank" rel="noopener noreferrer">Instagram <span class="sf-sr">(abre em nova aba)</span></a>
        </nav>
      </div>
      <nav class="sf-column" aria-label="Links úteis"><h2>Explore</h2>
        <a href="/loja/">Loja</a><a href="/cursos/">Cursos</a><a href="/minha-conta/">Minha conta</a><a href="/loja/carrinho/">Carrinho</a>
      </nav>
      <div class="sf-column sf-contact"><h2>Fale conosco</h2>
        <a href="mailto:contato@corindivisum.com.br"><span class="sf-label">Contato</span>contato@corindivisum.com.br</a>
        <a href="mailto:suporte@corindivisum.com.br"><span class="sf-label">Suporte</span>suporte@corindivisum.com.br</a>
        <a href="https://wa.me/5521969800918" target="_blank" rel="noopener noreferrer"><span class="sf-label">WhatsApp</span>+55 (21) 96980-0918<span class="sf-sr"> (abre em nova aba)</span></a>
        <p class="sf-note">Responderemos o mais rápido possível.</p>
      </div>
      <div class="sf-column"><h2>Informações</h2>
        <span class="sf-pending">Política de Privacidade<small>Em elaboração</small></span>
        <span class="sf-pending">Termos de Uso<small>Em elaboração</small></span>
        <span class="sf-pending">Trocas e cancelamentos<small>Em elaboração</small></span>
      </div>
    </div>
    <div class="sf-assurances" aria-label="Pagamentos e consulta de segurança">
      <div class="sf-payments"><span class="sf-label">Meios de pagamento</span><div class="sf-payment-brands">
        <a class="sf-payment-logo" href="https://www.infinitepay.io/" target="_blank" rel="noopener noreferrer"><img src="/src/images/badges/Infinitepay.svg" alt="InfinitePay" width="146" height="30" loading="lazy"><span class="sf-sr"> (abre em nova aba)</span></a>
      </div></div>
      <div class="sf-security"><a class="sf-cloudflare-badge" href="https://www.cloudflare.com/" target="_blank" rel="noopener noreferrer"><img src="/src/images/badges/ProtectedByCloudflareBadge_web_badges_1.webp" alt="Protected by Cloudflare" width="92" height="32" loading="lazy"><span class="sf-sr"> (abre em nova aba)</span></a>
      <a class="sf-security-link" href="https://transparencyreport.google.com/safe-browsing/search?url=corindivisum.com.br&amp;hl=pt_BR" target="_blank" rel="noopener noreferrer" aria-label="Consultar domínio no Google Safe Browsing (abre em nova aba)"><img src="/src/images/badges/GoogleSafeBrowsing.svg" alt="Google Safe Browsing" width="106" height="32" loading="lazy"></a></div>
    </div>
    <div class="sf-bottom"><div class="sf-business"><p>53.537.087 IGOR TADEU FLORENCIO BARBOSA</p><p>CNPJ: 53.537.087/0001-05</p></div><p class="sf-copyright">© ${new Date().getFullYear()} Cor Indivisum</p></div></div>`;
  const existing = document.querySelector('body > footer');
  if (existing) existing.replaceWith(footer); else document.body.append(footer);
})();
