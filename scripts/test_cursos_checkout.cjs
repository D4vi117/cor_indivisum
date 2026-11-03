const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');
const source = fs.readFileSync('functions/index.js', 'utf8');
const loader = source.slice(source.indexOf('async function carregarItensDoCatalogo('), source.indexOf('function itensParaPagamento('));
const checkout = source.slice(source.indexOf('exports.criarPedido ='), source.indexOf('exports.process_payment ='));
function setup() {
  const docs = {
    'cursos/c1': { nome: 'Curso', status: 'publicado', preco: 80 },
    'produtos/p1': { nome: 'Livro', status: { ativo:true, publicado:true }, preco: 30, estoque:{quantidade:5} },
  };
  const requests = [];
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const ref = (path) => ({ id:path.split('/').pop(), path, get: async () => ({exists:!!docs[path], data:()=>docs[path]}) });
  const context = {
    exports: {}, HttpsError, crypto, console, FieldValue:{serverTimestamp:()=> 'now'},
    onCall: (_, fn) => fn,
    db: { collection: (name) => ({ doc: (id) => ref(name+'/'+id) }), runTransaction: async fn => fn({
      get: r => r.get(), create:(r,data)=>{docs[r.path]=data;}, set:(r,data)=>{docs[r.path]=data;}
    }) },
    precoAtualProduto: p=>p.preco, pedidoRef:id=>ref('pedidos/'+id),
    cepOrigemConfigurado:()=> '26115680', getMelhorEnvioAccessToken:async()=>{requests.push('token');return 'token';},
    MELHOR_ENVIO_BASE_URL:'https://example.test',
    fetch:async (_,opts)=>{requests.push(JSON.parse(opts.body));return {ok:true,json:async()=>[{id:3,name:'Jadlog',price:12}]};},
  };
  vm.createContext(context); vm.runInContext(loader + checkout, context);
  const buy = (itens, extra={}) => context.exports.criarPedido({auth:{uid:'u1',token:{email:'aluno@example.test'}},data:{
    requestId:'12345678-1234-4234-8234-123456789abc',cliente:{nome:'Aluno',telefone:'21999999999',documento:'12345678901'},itens,...extra,
  }});
  return {docs,requests,buy,context};
}
test('course uses server price, records course ID, skips shipping and does not save address', async()=>{
  const {buy,docs,requests} = setup();
  const result = await buy([{id:'curso:c1',qtd:1,preco:1}],{salvarEndereco:true});
  assert.equal(result.total,80); assert.equal(result.frete,0); assert.equal(requests.length,0);
  const order=docs['pedidos/'+result.pedidoId]; assert.equal(order.itens[0].cursoId,'c1');
  assert.equal(order.itens[0].tipoItem,'curso'); assert.equal(docs['usuarios/u1'].enderecos,undefined);
});
test('physical item cannot bypass shipping by claiming to be a course', async()=>{
  const {buy} = setup();
  await assert.rejects(buy([{id:'p1',qtd:1,tipoItem:'curso'}]), /entrega inválidos/);
});
test('mixed order quotes physical products only, but charges for all items', async()=>{
  const {buy,requests} = setup();
  const result=await buy([{id:'curso:c1',qtd:1},{id:'p1',qtd:1}],{endereco:{cep:'01001000'},freteId:3});
  assert.equal(result.total,122); assert.equal(requests[1].products.length,1); assert.equal(requests[1].products[0].id,'p1');
});
test('draft course and duplicate quantities cannot be purchased', async()=>{
  const a=setup(); a.docs['cursos/c1'].status='rascunho';
  await assert.rejects(a.buy([{id:'curso:c1',qtd:1}]), /indisponível/);
  const b=setup(); await assert.rejects(b.buy([{id:'curso:c1',qtd:2}]), /uma inscrição/);
});
test('physical-only checkout keeps shipping in the total', async()=>{
  const {buy}=setup();
  const result=await buy([{id:'p1',qtd:1}],{endereco:{cep:'01001000'},freteId:3});
  assert.equal(result.total,42);
});
