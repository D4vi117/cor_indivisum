(() => {
  const form=document.getElementById('resgate-admin-form');
  const feedback=document.getElementById('resgate-admin-feedback');
  const api=name=>functions.httpsCallable(name);
  let itens=[];
  async function listar() {
    const {data}=await api('listarCodigosResgate')({});
    const lista=document.getElementById('resgate-admin-lista'); lista.replaceChildren();
    if (!data.codigos.length) { lista.textContent='Nenhum código gerado.'; return; }
    data.codigos.forEach(c=>{
      const row=document.createElement('p'); row.textContent=`${c.nome} · final ${c.final} · ${c.status} `;
      if(c.status==='disponivel') {
        const btn=document.createElement('button');btn.type='button';btn.className='btn-secundario';btn.textContent='Revogar';
        btn.onclick=async()=>{if(!confirm('Revogar este código?'))return;btn.disabled=true;try{await api('revogarCodigoResgate')({id:c.id});await listar();}catch(e){feedback.textContent=e.message;btn.disabled=false;}};
        row.append(btn);
      }
      lista.append(row);
    });
  }
  document.querySelector('[data-tab="resgates"]').addEventListener('click',async()=>{
    try {
      const [cursos,produtos]=await Promise.all([db.collection('cursos').get(),db.collection('produtos').where('modalidade','==','digital').get()]);
      itens=[...cursos.docs.map(d=>({tipo:'curso',itemId:d.id,nome:d.data().nome})),...produtos.docs.map(d=>({tipo:'produto',itemId:d.id,nome:d.data().nome}))];
      const select=document.getElementById('resgate-item');select.replaceChildren();
      const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Selecione um item';select.append(placeholder);
      itens.forEach((item,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`${item.tipo === 'curso' ? 'Curso' : 'Digital'} · ${item.nome}`;select.append(option);});
      await listar();
    } catch(e){feedback.textContent=`Não foi possível carregar: ${e.message}`;}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();const select=document.getElementById('resgate-item');
    if(select.value==='')return;
    const button=form.querySelector('button');button.disabled=true;
    document.getElementById('resgate-gerado').hidden=true;
    try {
      const item=itens[Number(select.value)];
      const {data}=await api('criarCodigoResgate')({...item,validadeDias:Number(document.getElementById('resgate-dias').value)});
      document.getElementById('resgate-codigo').textContent=data.codigo;
      document.getElementById('resgate-gerado').hidden=false;
      feedback.textContent=`Código gerado para ${data.nome}. Válido até ${new Date(data.expiraEm).toLocaleDateString('pt-BR')}.`;
      await listar();
    }catch(e){feedback.textContent=e.message;}finally{button.disabled=false;}
  });
  document.getElementById('resgate-copiar').onclick=async()=>{
    try{await navigator.clipboard.writeText(document.getElementById('resgate-codigo').textContent);feedback.textContent='Código copiado.';}
    catch{feedback.textContent='Selecione o código exibido e copie manualmente.';}
  };
})();
