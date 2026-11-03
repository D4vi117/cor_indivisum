(() => {
  let unsubscribe;
  const feedback = document.getElementById('cursos-feedback');
  auth.onAuthStateChanged(async (user) => {
    if (unsubscribe) unsubscribe();
    if (!user) return;
    try {
      const perfil = await db.collection('usuarios').doc(user.uid).get();
      if (!['admin', 'dev'].includes(perfil.data()?.role)) return;
      unsubscribe = db.collection('cursos').onSnapshot((snapshot) => {
        const lista = document.getElementById('cursos-lista');
        lista.replaceChildren();
        snapshot.docs.sort((a, b) => a.data().nome.localeCompare(b.data().nome, 'pt-BR')).forEach((doc) => {
          const curso = doc.data();
          const row = document.createElement('tr');
          [curso.nome, Number(curso.preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), curso.status === 'publicado' ? 'Publicado' : 'Rascunho'].forEach((valor) => {
            const cell = document.createElement('td');
            cell.textContent = valor;
            row.append(cell);
          });
          const cell = document.createElement('td');
          const link = document.createElement('a');
          link.href = `/admin/curso/?id=${encodeURIComponent(doc.id)}`;
          link.textContent = 'Editar curso';
          cell.append(link);
          row.append(cell);
          lista.append(row);
        });
        feedback.textContent = snapshot.empty ? 'Nenhum curso cadastrado ainda.' : '';
      }, () => { feedback.textContent = 'Não foi possível carregar os cursos. Confira as regras do Firestore.'; });
    } catch {
      feedback.textContent = 'Não foi possível verificar o acesso aos cursos.';
    }
  });
})();
