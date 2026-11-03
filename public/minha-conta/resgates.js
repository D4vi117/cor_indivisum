(() => {
  const form=document.getElementById('form-resgatar');
  const feedback=document.getElementById('resgate-feedback');
  const lista=document.getElementById('resgate-acessos');
  const cursos=document.getElementById('digitais-cursos');
  const produtos=document.getElementById('digitais-produtos');
  const digitaisFeedback=document.getElementById('digitais-feedback');
  document.getElementById('resgate-ver-produtos').onclick=()=>document.querySelector('[data-tab="digitais"]').click();
  async function listar(){
    const {data}=await functions.httpsCallable('listarMeusAcessos')({});
    cursos.replaceChildren();produtos.replaceChildren();
    if(!data.acessos.some(item=>item.tipo==='curso'))cursos.textContent='Você ainda não possui cursos liberados nesta conta.';
    if(!data.acessos.some(item=>item.tipo==='produto'))produtos.textContent='Você ainda não possui outros produtos digitais liberados nesta conta.';
    data.acessos.forEach(item=>{
      const row=document.createElement('p');row.textContent=`${item.nome} · Acesso liberado `;
      if(item.tipo==='curso') {
        const link=document.createElement('a');link.className='btn-secundario';link.textContent='Acessar curso';
        link.href=item.slug ? '/cursos/'+encodeURIComponent(item.slug) : '/cursos/?cursoId='+encodeURIComponent(item.itemId);
        row.append(link);cursos.append(row);return;
      }
      const button=document.createElement('button');button.type='button';button.className='btn-secundario';button.textContent='Abrir conteúdo';
      button.onclick=async()=>{
        button.disabled=true;
        try{
          const {data}=await functions.httpsCallable('obterConteudoResgatado')({tipo:item.tipo,itemId:item.itemId});
          const content=document.getElementById('resgate-conteudo');content.replaceChildren();
          const title=document.createElement('h2');title.textContent=data.nome;content.append(title);
          if(!data.modulos.length && !data.texto){const p=document.createElement('p');p.textContent='Seu acesso está registrado. O conteúdo deste item ainda está sendo preparado.';content.append(p);}
          if(data.texto){const p=document.createElement('p');p.textContent=data.texto;content.append(p);}
          data.modulos.forEach(modulo=>{
            const h=document.createElement('h3');h.textContent=modulo.titulo;content.append(h);
            (modulo.aulas||[]).forEach(aula=>{
              const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=aula.titulo;details.append(summary);
              const p=document.createElement('p');p.textContent=aula.texto || 'O conteúdo desta aula ainda está sendo preparado.';details.append(p);
              // Materials remain plain text until private file delivery is implemented.
              if(aula.materiais){const material=document.createElement('p');material.textContent=aula.materiais;details.append(material);}
              content.append(details);
            });
          });
          content.hidden=false;content.scrollIntoView({block:'start'});
        }catch(e){digitaisFeedback.textContent=e.message;}finally{button.disabled=false;}
      };
      row.append(button);(item.tipo==='curso' ? cursos : produtos).append(row);
    });
  }
  auth.onAuthStateChanged(async user=>{
    form.querySelector('button').disabled=!user;
    cursos.replaceChildren();produtos.replaceChildren();digitaisFeedback.textContent='';
    document.getElementById('resgate-conteudo').replaceChildren();
    document.getElementById('resgate-conteudo').hidden=true;
    if(user){try{await listar();}catch(e){digitaisFeedback.textContent=e.message;}}
    else {cursos.textContent='Entre na sua conta para consultar seus cursos.';produtos.textContent='Entre na sua conta para consultar seus produtos.';}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('button');button.disabled=true;
    try{
      const {data}=await functions.httpsCallable('resgatarCodigo')({codigo:document.getElementById('codigo-resgate').value});
      feedback.textContent=`Acesso a ${data.nome} liberado. Você já pode encontrá-lo em Meus produtos digitais.`;form.reset();await listar();
    }catch(e){feedback.textContent=e.message;}finally{button.disabled=!auth.currentUser;}
  });
})();
