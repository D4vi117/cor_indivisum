const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRedemptionFunctions}=require('./redemptions');
function setup(){
  const docs=new Map([
    ['cursos/c1',{nome:'Curso'}],['cursos_conteudos/c1',{modulos:[{titulo:'Módulo',aulas:[{titulo:'Aula',texto:'Texto restrito'}]}]}],
    ['produtos/p1',{nome:'Livro físico'}],['produtos/d1',{nome:'Livro digital',modalidade:'digital'}]
  ]);
  const snap=(id,data)=>({id,exists:!!data,data:()=>data && ({...data,...(data.expiraEm instanceof Date ? {expiraEm:{toMillis:()=>data.expiraEm.getTime()}}:{})})});
  const reference=path=>({path,id:path.split('/').pop(),collection:name=>collection(path+'/'+name),get:async()=>snap(path.split('/').pop(),docs.get(path)),create:async data=>{assert(!docs.has(path));docs.set(path,data);}});
  const collection=path=>{
    let filter=null,max=Infinity;
    return {doc:id=>reference(path+'/'+id),where:(key,op,value)=>{filter=[key,value];return collectionQuery();},orderBy:()=>collectionQuery(),get:async()=>query()};
    function query(){return {docs:[...docs].filter(([key,value])=>key.startsWith(path+'/') && key.slice(path.length+1).indexOf('/')<0 && (!filter || filter[0].split('.').reduce((d,k)=>d?.[k],value)===filter[1])).slice(0,max).map(([key,value])=>snap(key.split('/').pop(),value))};}
    function collectionQuery(){return {limit:n=>{max=n;return collectionQuery();},get:async()=>query()};}
  };
  let tail=Promise.resolve();
  const db={collection,runTransaction:fn=>{
    const task=tail.then(async()=>{
      const changes=[];
      const result=await fn({get:ref=>ref.get(),set:(ref,d)=>changes.push([ref.path,d]),update:(ref,d)=>changes.push([ref.path,{...docs.get(ref.path),...d}])});
      changes.forEach(([path,d])=>docs.set(path,d));return result;
    });tail=task.catch(()=>{});return task;
  }};
  class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
  const api=createRedemptionFunctions({db,HttpsError,onCall:fn=>fn,FieldValue:{serverTimestamp:()=>new Date()},verificarAdmin:async uid=>{if(uid!=='admin')throw new HttpsError('permission-denied','Equipe');}});
  const request=(uid,data)=>({auth:uid?{uid,token:{}}:null,data});
  const generate=(extra={})=>api.criarCodigoResgate(request('admin',{tipo:'curso',itemId:'c1',...extra}));
  return {api,request,generate,docs};
}
test('generates 20 digits and stores only a hash; staff-only generation',async()=>{
  const {api,request,generate,docs}=setup();const {codigo}=await generate();
  assert.match(codigo,/^\d{20}$/);assert(!JSON.stringify([...docs]).includes(codigo));
  await assert.rejects(api.criarCodigoResgate(request('user',{tipo:'curso',itemId:'c1'})),{code:'permission-denied'});
});
test('redeems once, grants only the redeemer and authorizes private course text',async()=>{
  const {api,request,generate}=setup();const {codigo}=await generate();
  await api.resgatarCodigo(request('u1',{codigo}));
  await assert.rejects(api.resgatarCodigo(request('u2',{codigo})),{code:'failed-precondition'});
  const access=await api.listarMeusAcessos(request('u1',{}));assert.equal(access.acessos.length,1);
  assert.equal((await api.listarMeusAcessos(request('u2',{}))).acessos.length,0);
  await assert.rejects(api.obterConteudoResgatado(request('u2',{tipo:'curso',itemId:'c1'})),{code:'permission-denied'});
  assert.equal((await api.obterConteudoResgatado(request('u1',{tipo:'curso',itemId:'c1'}))).modulos[0].aulas[0].texto,'Texto restrito');
});
test('simultaneous redemption has one winner',async()=>{
  const {api,request,generate}=setup();const {codigo}=await generate();
  const results=await Promise.allSettled(['a','b'].map(uid=>api.resgatarCodigo(request(uid,{codigo}))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('expiry, revocation, malformed and unauthenticated redemption are rejected',async()=>{
  const {api,request,generate,docs}=setup();const {codigo}=await generate();
  const key=[...docs.keys()].find(key=>key.startsWith('codigos_resgate/'));
  docs.get(key).expiraEm=new Date(0);
  await assert.rejects(api.resgatarCodigo(request('u1',{codigo})),{code:'failed-precondition'});
  await assert.rejects(api.resgatarCodigo(request(null,{codigo})),{code:'unauthenticated'});
  await assert.rejects(api.resgatarCodigo(request('u1',{codigo:'abc'})),{code:'invalid-argument'});
  docs.get(key).expiraEm=new Date(Date.now()+86400000);
  await api.revogarCodigoResgate(request('admin',{id:key.split('/')[1]}));
  await assert.rejects(api.resgatarCodigo(request('u1',{codigo})),{code:'failed-precondition'});
});
test('repeated invalid attempts consume rate limit',async()=>{
  const {api,request}=setup();
  for(let i=0;i<10;i++)await assert.rejects(api.resgatarCodigo(request('u1',{codigo:'00000000000000000000'})),{code:'failed-precondition'});
  await assert.rejects(api.resgatarCodigo(request('u1',{codigo:'00000000000000000000'})),{code:'resource-exhausted'});
});
test('physical products excluded, digital products supported, duplicate access keeps code usable',async()=>{
  const {api,request,generate}=setup();
  await assert.rejects(generate({tipo:'produto',itemId:'p1'}),{code:'failed-precondition'});
  const first=await generate({tipo:'produto',itemId:'d1'});await api.resgatarCodigo(request('u1',{codigo:first.codigo}));
  const next=await generate({tipo:'produto',itemId:'d1'});
  await assert.rejects(api.resgatarCodigo(request('u1',{codigo:next.codigo})),{code:'already-exists'});
  await api.resgatarCodigo(request('u2',{codigo:next.codigo}));
});
test('paid course is listed and readable only by buyer; pending and refunded are denied',async()=>{
  const {api,request,docs}=setup();
  const order={cliente:{uid:'buyer'},status:'aguardando_pagamento',itens:[{tipoItem:'curso',cursoId:'c1',nome:'Curso'}]};
  docs.set('pedidos/order',order);
  await assert.rejects(api.obterConteudoResgatado(request('buyer',{tipo:'curso',itemId:'c1'})),{code:'permission-denied'});
  order.status='pago';
  assert.equal((await api.listarMeusAcessos(request('buyer',{}))).acessos.length,1);
  assert.equal((await api.obterConteudoResgatado(request('buyer',{tipo:'curso',itemId:'c1'}))).modulos.length,1);
  await assert.rejects(api.obterConteudoResgatado(request('other',{tipo:'curso',itemId:'c1'})),{code:'permission-denied'});
  order.status='estornado';
  assert.equal((await api.listarMeusAcessos(request('buyer',{}))).acessos.length,0);
  await assert.rejects(api.obterConteudoResgatado(request('buyer',{tipo:'curso',itemId:'c1'})),{code:'permission-denied'});
});
