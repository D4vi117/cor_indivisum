(() => {
  const status = document.getElementById('cursos-status');
  const container = document.getElementById('cursos-conteudo');
  const moeda = (valor) => Number(valor).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
  try { const carrinho = JSON.parse(localStorage.getItem('carrinho_cor_indivisum') || '[]'); document.getElementById('cursos-cart-count').textContent = carrinho.reduce((n, item) => n + Number(item.qtd || 0), 0); } catch { /* Empty count if local storage is unavailable. */ }
  function texto(parent, tag, valor, className = '') {
    const node = document.createElement(tag); node.textContent = valor || ''; node.className = className; parent.append(node); return node;
  }
  function renderizar(doc, detalhe) {
    const curso = doc.data();
    const article = document.createElement('article'); article.className = detalhe ? 'curso-publico curso-detalhe' : 'curso-publico produto-card';
    const visual = document.createElement('div'); visual.className = 'curso-visual'; article.append(visual);
    if (/^https:\/\//i.test(curso.capa || '')) { const img = document.createElement('img'); img.src = curso.capa; img.alt = curso.nome; img.loading = detalhe ? 'eager' : 'lazy'; visual.append(img); }
    else texto(visual, 'span', 'Cor Indivisum', 'curso-sem-capa');
    const info = document.createElement('div'); info.className = detalhe ? 'curso-compra' : 'card-content'; article.append(info);
    texto(info, 'span', 'Curso online', 'card-categoria');
    texto(info, 'h2', detalhe ? 'Sua próxima formação' : curso.nome, 'card-titulo');
    if (curso.professor) texto(info, 'p', `Com ${curso.professor}`, 'curso-professor');
    texto(info, 'p', curso.resumo, 'card-descricao');
    texto(info, 'strong', moeda(curso.preco), 'curso-preco');
    texto(info, 'p', 'Sem cobrança de frete', 'curso-entrega');
    if (!detalhe) { const link = texto(info, 'a', 'Conhecer curso', 'btn-primary'); link.href = '/cursos/' + encodeURIComponent(curso.slug); }
    else {
      const button = texto(info, 'button', 'Comprar curso', 'btn-primary'); button.type = 'button';
      button.addEventListener('click', () => {
        button.disabled = true;
        try {
          const carrinho = JSON.parse(localStorage.getItem('carrinho_cor_indivisum') || '[]');
          if (!Array.isArray(carrinho)) throw new Error('Carrinho inválido');
          const id = 'curso:' + doc.id;
          const existente = carrinho.findIndex((item) => item.id === id);
          const item = {id, nome:curso.nome, preco:curso.preco, qtd:1, foto:curso.capa || '', tipoItem:'curso'};
          if (existente >= 0) carrinho[existente] = item; else carrinho.push(item);
          localStorage.setItem('carrinho_cor_indivisum', JSON.stringify(carrinho));
          location.href = '/loja/checkout/';
        } catch { status.textContent = 'Não foi possível atualizar o carrinho. Verifique o armazenamento do navegador.'; button.disabled = false; }
      });
    }
    if (detalhe && curso.descricao) { const descricao = document.createElement('section'); descricao.className = 'curso-apresentacao'; texto(descricao, 'h2', 'Sobre o curso'); texto(descricao, 'p', curso.descricao, 'descricao'); article.append(descricao); }
    container.append(article);
    if (detalhe && typeof auth !== 'undefined') {
      const aulas = document.createElement('section'); aulas.className = 'curso-apresentacao curso-aulas'; aulas.hidden = true; article.append(aulas);
      let consulta = 0;
      auth.onAuthStateChanged(async user => {
        const atual = ++consulta;
        aulas.replaceChildren(); aulas.hidden = true;
        const comprar = info.querySelector('button'); if (comprar) comprar.hidden = false;
        if (!user) return;
        try {
          const {data} = await functions.httpsCallable('obterConteudoResgatado')({tipo:'curso',itemId:doc.id});
          if (atual !== consulta) return;
          if (comprar) comprar.hidden = true;
          texto(aulas,'h2','Conteúdo do curso');
          if (!data.modulos.length) texto(aulas,'p','Seu acesso está liberado. As aulas deste curso ainda estão sendo preparadas.');
          data.modulos.forEach(modulo => {
            texto(aulas,'h3',modulo.titulo);
            (modulo.aulas || []).forEach(aula => {
              const details=document.createElement('details'); texto(details,'summary',aula.titulo);
              texto(details,'p',aula.texto || 'O conteúdo desta aula ainda está sendo preparado.','descricao');
              if(aula.materiais) texto(details,'p',aula.materiais,'descricao');
              aulas.append(details);
            });
          });
          aulas.hidden=false;
        } catch (error) {
          if (atual !== consulta || error.code === 'functions/permission-denied') return;
          texto(aulas,'p','Não foi possível carregar suas aulas. Atualize a página para tentar novamente.'); aulas.hidden=false;
        }
      });
    }
  }
  async function iniciar() {
    try {
      const slug = decodeURIComponent(location.pathname.replace(/^\/cursos\/?/, '').replace(/\/$/, ''));
      const cursoId = new URLSearchParams(location.search).get('cursoId');
      if (cursoId && typeof auth !== 'undefined') {
        status.textContent='Verificando acesso ao curso...';
        auth.onAuthStateChanged(async user=>{
          if(!user){status.textContent='Entre na sua conta para acessar este curso.';return;}
          try {
            const {data}=await functions.httpsCallable('listarMeusAcessos')({});
            const acesso=data.acessos.find(item=>item.tipo==='curso' && item.itemId===cursoId);
            if(acesso?.slug){location.replace('/cursos/'+encodeURIComponent(acesso.slug));return;}
            status.textContent='A página deste curso ainda não está disponível. Seu acesso continua registrado na sua conta.';
          }catch{status.textContent='Não foi possível consultar seu acesso. Tente novamente.';}
        });
        return;
      }
      let query = db.collection('cursos').where('status', '==', 'publicado');
      if (slug && slug !== 'index.html') query = query.where('slug', '==', slug);
      const snapshot = await query.get();
      const detalhe = Boolean(slug && slug !== 'index.html');
      if (snapshot.empty) { status.textContent = detalhe ? 'Curso não encontrado ou indisponível.' : 'Novos cursos em breve.'; return; }
      if (detalhe) { const doc = snapshot.docs[0]; document.getElementById('cursos-titulo').textContent = doc.data().nome; document.getElementById('cursos-intro-texto').hidden = true; document.title = doc.data().nome + ' · Cor Indivisum'; renderizar(doc, true); }
      else { container.className = 'cursos-grid'; snapshot.docs.forEach((doc) => renderizar(doc, false)); }
      status.textContent = '';
    } catch { status.textContent = 'Não foi possível carregar os cursos. Atualize a página para tentar novamente.'; }
    finally { container.setAttribute('aria-busy', 'false'); }
  }
  iniciar();
})();
