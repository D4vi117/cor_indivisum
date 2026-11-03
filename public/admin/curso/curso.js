(() => {
  const form = document.getElementById('curso-form');
  const feedback = document.getElementById('feedback');
  const campos = document.getElementById('editor-campos');
  const container = document.getElementById('modulos');
  let cursoId = new URLSearchParams(location.search).get('id');
  let criadoEm;
  let versao = null;
  let modulos = [];
  let alterado = false;
  let salvando = false;
  const abertos = new Map();
  const salvarTopo = document.getElementById('salvar-topo');
  function atualizarResumo() {
    document.getElementById('curso-status-preview').textContent = form.elements.status.value === 'publicado' ? 'Publicado' : 'Rascunho';
    document.getElementById('curso-link-publico').href = '/cursos/' + encodeURIComponent(form.elements.slug.value);
    document.getElementById('curso-nome-preview').textContent = form.elements.nome.value.trim() || 'Novo curso';
    document.getElementById('curso-preco-preview').textContent = Number(form.elements.preco.value || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
    document.getElementById('curso-contagem').textContent = `${modulos.reduce((n, m) => n + m.aulas.length, 0)} aulas`;
    const imagem = document.getElementById('curso-capa-preview');
    const capa = form.elements.capa.value.trim();
    const valida = /^https:\/\//i.test(capa);
    imagem.hidden = !valida;
    document.getElementById('curso-sem-capa').hidden = valida;
    if (valida && imagem.getAttribute('src') !== capa) imagem.src = capa;
  }
  const novoId = () => crypto.randomUUID();
  const marcar = () => { alterado = true; };
  const campo = (parent, rotulo, objeto, chave, limite, multiline = false) => {
    const label = document.createElement('label');
    label.textContent = rotulo;
    const input = document.createElement(multiline ? 'textarea' : 'input');
    input.value = objeto[chave] || '';
    input.maxLength = limite;
    if (multiline) input.rows = 4;
    input.addEventListener('input', () => { objeto[chave] = input.value; marcar(); });
    label.append(input);
    parent.append(label);
    return input;
  };
  const botao = (parent, texto, acao, disabled = false) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn-secundario'; button.textContent = texto; button.disabled = disabled;
    button.addEventListener('click', acao); parent.append(button);
  };
  const mover = (lista, indice, delta) => {
    [lista[indice], lista[indice + delta]] = [lista[indice + delta], lista[indice]];
    marcar(); renderizar();
  };
  const remover = (lista, indice, descricao) => {
    if (confirm(`Remover ${descricao}? A alteração será aplicada ao salvar.`)) {
      lista.splice(indice, 1); marcar(); renderizar();
    }
  };
  function renderizar() {
    container.querySelectorAll('details[data-id]').forEach((details) => abertos.set(details.dataset.id, details.open));
    container.replaceChildren();
    if (!modulos.length) {
      const vazio = document.createElement('p'); vazio.className = 'curso-vazio';
      vazio.textContent = 'Comece adicionando o primeiro módulo. Depois, inclua as aulas na ordem em que o aluno deve assistir.';
      container.append(vazio);
    }
    let total = 0;
    modulos.forEach((modulo, mi) => {
      const section = document.createElement('details'); section.className = 'curso-modulo';
      section.dataset.id = modulo.id; section.open = abertos.get(modulo.id) ?? true;
      const titulo = document.createElement('summary');
      const atualizarTitulo = () => { titulo.textContent = `Módulo ${mi + 1} · ${modulo.titulo || 'Novo módulo'} · ${modulo.aulas.length} aula(s)`; };
      atualizarTitulo(); section.append(titulo);
      const corpo = document.createElement('div'); corpo.className = 'curso-modulo-corpo'; section.append(corpo);
      const nomeModulo = campo(corpo, 'Título do módulo', modulo, 'titulo', 200);
      nomeModulo.required = true; nomeModulo.addEventListener('input', atualizarTitulo);
      const acoes = document.createElement('div'); acoes.className = 'curso-acoes'; corpo.append(acoes);
      botao(acoes, 'Subir módulo', () => mover(modulos, mi, -1), mi === 0);
      botao(acoes, 'Descer módulo', () => mover(modulos, mi, 1), mi === modulos.length - 1);
      botao(acoes, 'Remover módulo', () => remover(modulos, mi, 'o módulo e suas aulas'));
      modulo.aulas.forEach((aula, ai) => {
        total++;
        const article = document.createElement('details'); article.className = 'curso-aula';
        article.dataset.id = aula.id; article.open = abertos.get(aula.id) ?? true;
        const heading = document.createElement('summary');
        const atualizarAula = () => { heading.textContent = `Aula ${ai + 1} · ${aula.titulo || 'Nova aula'}`; };
        atualizarAula(); article.append(heading);
        const aulaCorpo = document.createElement('div'); aulaCorpo.className = 'curso-aula-corpo'; article.append(aulaCorpo);
        const nomeAula = campo(aulaCorpo, 'Título da aula', aula, 'titulo', 200);
        nomeAula.required = true; nomeAula.addEventListener('input', atualizarAula);
        campo(aulaCorpo, 'Conteúdo em texto', aula, 'texto', 15000, true);
        campo(aulaCorpo, 'Materiais complementares (uma referência por linha)', aula, 'materiais', 5000, true);
        const controles = document.createElement('div'); controles.className = 'curso-acoes'; aulaCorpo.append(controles);
        botao(controles, 'Subir aula', () => mover(modulo.aulas, ai, -1), ai === 0);
        botao(controles, 'Descer aula', () => mover(modulo.aulas, ai, 1), ai === modulo.aulas.length - 1);
        botao(controles, 'Remover aula', () => remover(modulo.aulas, ai, 'a aula'));
        corpo.append(article);
      });
      botao(corpo, '+ Adicionar aula', () => {
        modulo.aulas.push({ id: novoId(), titulo: '', texto: '', provedor: 'pendente', videoRef: '', materiais: '' });
        marcar(); renderizar();
      }, modulo.aulas.length >= 100);
      container.append(section);
    });
    document.getElementById('estrutura-resumo').textContent = `${modulos.length} módulo(s) · ${total} aula(s)`;
    document.getElementById('adicionar-modulo').disabled = modulos.length >= 30;
    atualizarResumo();
  }
  form.addEventListener('input', atualizarResumo);
  form.elements.status.addEventListener('change', () => {
    salvarTopo.textContent = 'Salvar curso';
    atualizarResumo(); marcar();
  });
  form.addEventListener('invalid', (event) => {
    let parent = event.target.parentElement;
    while (parent && parent !== form) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
  }, true);
  form.addEventListener('input', marcar);
  document.getElementById('adicionar-modulo').addEventListener('click', () => {
    modulos.push({ id: novoId(), titulo: '', aulas: [] }); marcar(); renderizar();
  });
  form.elements.nome.addEventListener('blur', () => {
    if (!form.elements.slug.value) form.elements.slug.value = form.elements.nome.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 160);
  });
  window.addEventListener('beforeunload', (event) => { if (alterado) { event.preventDefault(); event.returnValue = ''; } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (salvando) return;
    if (form.elements.status.value === 'publicado' && Number(form.elements.preco.value) <= 0) {
      feedback.textContent = 'Informe um preço maior que zero para publicar o curso.'; return;
    }
    const estrutura = modulos.map((m) => ({ ...m, titulo: m.titulo.trim(), aulas: m.aulas.map((a) => ({ ...a, titulo: a.titulo.trim() })) }));
    if (!form.elements.nome.value.trim() || estrutura.some((m) => !m.titulo || m.aulas.some((a) => !a.titulo))) {
      feedback.textContent = 'Preencha o nome do curso e os títulos dos módulos e aulas.'; return;
    }
    if (new TextEncoder().encode(JSON.stringify(estrutura)).length > 700000) {
      feedback.textContent = 'O conteúdo está muito grande. Reduza os textos e use referências para os materiais.'; return;
    }
    salvando = true; campos.disabled = true; salvarTopo.disabled = true; feedback.textContent = 'Salvando curso...';
    try {
      const ref = cursoId ? db.collection('cursos').doc(cursoId) : db.collection('cursos').doc();
      const conteudoRef = db.collection('cursos_conteudos').doc(ref.id);
      const stamp = firebase.firestore.FieldValue.serverTimestamp;
      await db.runTransaction(async (transaction) => {
        const atual = await transaction.get(ref);
        const atualVersao = atual.data()?.editadoEm || null;
        if (atual.exists && (!versao || !atualVersao?.isEqual(versao))) throw new Error('O curso foi alterado em outra janela. Recarregue antes de editar novamente.');
        if (cursoId && !atual.exists) throw new Error('O curso não existe mais. Recarregue a página.');
        transaction.set(ref, {
          tipo: 'curso', nome: form.elements.nome.value.trim(), slug: form.elements.slug.value.trim(),
          professor: form.elements.professor.value.trim(), resumo: form.elements.resumo.value.trim(),
          descricao: form.elements.descricao.value.trim(), capa: form.elements.capa.value.trim(),
          preco: Number(form.elements.preco.value), status: form.elements.status.value,
          criadoEm: criadoEm || stamp(), editadoEm: stamp()
        });
        transaction.set(conteudoRef, { modulos: estrutura, editadoEm: stamp() });
      });
      cursoId = ref.id;
      // Server timestamps are needed for the next edit conflict check.
      const salvo = await ref.get({ source: 'server' });
      criadoEm = salvo.data().criadoEm; versao = salvo.data().editadoEm;
      history.replaceState(null, '', `?id=${encodeURIComponent(cursoId)}`);
      alterado = false; feedback.textContent = form.elements.status.value === 'publicado' ? 'Curso salvo e disponível para compra.' : 'Rascunho salvo. O curso ainda não está à venda.';
      document.getElementById('titulo-editor').textContent = 'Editar curso';
    } catch (error) {
      feedback.textContent = `Não foi possível salvar: ${error.message}`;
    } finally { salvando = false; campos.disabled = false; salvarTopo.disabled = false; }
  });
  auth.onAuthStateChanged(async (user) => {
    form.hidden = true;
    salvarTopo.disabled = true;
    if (!user) { location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search); return; }
    try {
      const perfil = await db.collection('usuarios').doc(user.uid).get();
      if (!['admin', 'dev'].includes(perfil.data()?.role)) { feedback.textContent = 'Acesso restrito à equipe.'; return; }
      if (cursoId) {
        const [curso, conteudo] = await Promise.all([db.collection('cursos').doc(cursoId).get(), db.collection('cursos_conteudos').doc(cursoId).get()]);
        if (!curso.exists) { feedback.textContent = 'Curso não encontrado.'; return; }
        const dados = curso.data(); criadoEm = dados.criadoEm; versao = dados.editadoEm;
        ['nome', 'slug', 'professor', 'resumo', 'descricao', 'capa', 'preco', 'status'].forEach((key) => { form.elements[key].value = dados[key] ?? ''; });
        modulos = conteudo.data()?.modulos || [];
        document.getElementById('titulo-editor').textContent = 'Editar curso';
      }
      renderizar(); form.hidden = false; salvarTopo.disabled = false; feedback.textContent = '';
    } catch { feedback.textContent = 'Não foi possível abrir o editor. Confira a conexão e as regras do Firestore.'; }
  });
})();
