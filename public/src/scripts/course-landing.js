// Shared commerce adapter for custom course landing pages.
(() => {
  const buttons = [...document.querySelectorAll('[data-course-purchase]')];
  const prices = [...document.querySelectorAll('[data-course-price]')];
  const status = document.getElementById('course-purchase-status');
  const config = document.currentScript?.dataset || {};
  const slug = config.courseSlug || decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
  const configuredId = config.courseId;
  let possuiAcesso=false;
  const links = [...document.querySelectorAll('[data-course-enroll-link]')];
  const originalLinks = links.map(link=>({href:link.getAttribute('href'),text:link.textContent}));
  const ownership = [...document.querySelectorAll('[data-course-ownership]')];
  function showOwnership(owned) {
    possuiAcesso=owned;
    ownership.forEach(el=>{el.hidden=!owned;el.textContent=owned ? 'Você já possui este curso. Acesse suas aulas abaixo.' : '';});
    links.forEach((link,i)=>{link.href=owned ? '#aulas' : originalLinks[i].href;link.textContent=owned ? 'Acessar minhas aulas' : originalLinks[i].text;});
  }
  const money = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
  let course;
  let courseId;
  function cart() {
    const value = JSON.parse(localStorage.getItem('carrinho_cor_indivisum') || '[]');
    if (!Array.isArray(value)) throw new Error('Carrinho inválido');
    return value;
  }
  function count() {
    try { document.querySelectorAll('[data-course-cart-count]').forEach(el => { el.textContent = cart().reduce((n,item)=>n+Number(item.qtd||0),0); }); } catch { /* Storage can be unavailable. */ }
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    if (!course || possuiAcesso) return;
    buttons.forEach(el => { el.disabled = true; });
    status.textContent = 'Preparando sua inscrição...';
    try {
      const items = cart();
      const id = 'curso:' + courseId;
      const item = {id, nome:course.nome, preco:course.preco, qtd:1, tipoItem:'curso', foto:course.capa || '', slug:course.slug};
      const existing = items.findIndex(el=>el.id===id);
      if (existing >= 0) items[existing]=item; else items.push(item);
      localStorage.setItem('carrinho_cor_indivisum',JSON.stringify(items));
      count();
      if (button.dataset.coursePurchase === 'comprar') location.href = '/loja/checkout/';
      else status.textContent = 'Curso adicionado ao carrinho. Você pode continuar navegando ou finalizar a compra.';
    } catch { status.textContent = 'Não foi possível atualizar o carrinho. Tente novamente.'; }
    finally { buttons.forEach(el=>{el.disabled=false;}); }
  }));
  window.addEventListener('storage',count);
  function text(parent,tag,value) { const node=document.createElement(tag);node.textContent=value||'';parent.append(node);return node; }
  async function load() {
    count();
    try {
      if (configuredId) {
        const doc=await db.collection('cursos').doc(configuredId).get();
        if (!doc.exists) throw new Error('Curso indisponível');
        course=doc.data();courseId=doc.id;
      } else {
        const result=await db.collection('cursos').where('status','==','publicado').where('slug','==',slug).get();
        if (result.empty || result.docs.length !== 1) throw new Error('Curso indisponível');
        course=result.docs[0].data();courseId=result.docs[0].id;
      }
      if (course.status !== 'publicado') throw new Error('Curso indisponível');
      if (!Number.isFinite(course.preco) || course.preco<=0) throw new Error('Preço indisponível');
      prices.forEach(el=>{el.textContent=money.format(course.preco);});
      status.textContent='Inscrições disponíveis · curso online, sem frete.';
      buttons.forEach(el=>{el.disabled=false;});
      let sequence=0;
      auth.onAuthStateChanged(async user=>{
        const current=++sequence;
        showOwnership(false);
        const section=document.getElementById('aulas');
        const lessons=document.getElementById('course-lessons');
        const open=document.getElementById('course-open-lessons');
        section.hidden=true;open.hidden=true;lessons.replaceChildren();buttons.forEach(el=>{el.hidden=false;});
        status.textContent='Inscrições disponíveis · curso online, sem frete.';
        if (!user) return;
        try {
          const {data}=await functions.httpsCallable('obterConteudoResgatado')({tipo:'curso',itemId:courseId});
          if (current!==sequence) return;
          showOwnership(true);
          buttons.forEach(el=>{el.hidden=true;});open.hidden=false;section.hidden=false;
          status.textContent='Você já possui este curso. Sua inscrição está liberada.';
          if (!data.modulos.length) text(lessons,'p','Seu acesso está liberado. O conteúdo das aulas ainda está sendo preparado.');
          data.modulos.forEach(modulo=>{
            text(lessons,'h3',modulo.titulo);
            (modulo.aulas||[]).forEach(aula=>{
              const details=document.createElement('details');text(details,'summary',aula.titulo);
              text(details,'p',aula.texto || 'O conteúdo desta aula ainda está sendo preparado.');
              if(aula.materiais)text(details,'p',aula.materiais);
              lessons.append(details);
            });
          });
        } catch(error) {
          if(current!==sequence || error.code==='functions/permission-denied')return;
          status.textContent='Inscrições disponíveis. Não foi possível consultar seus acessos agora.';
        }
      });
    } catch {
      course=null;prices.forEach(el=>{el.textContent='Inscrições indisponíveis';});
      buttons.forEach(el=>{el.disabled=true;});
      status.textContent='Não foi possível consultar este curso. Recarregue a página ou consulte a página de cursos.';
    }
  }
  load();
})();
