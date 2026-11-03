const crypto = require('node:crypto');

function createRedemptionFunctions({ onCall, HttpsError, db, FieldValue, verificarAdmin }) {
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  function requireUser(request) {
    if (!request.auth?.uid || request.auth.token?.firebase?.sign_in_provider === 'anonymous') {
      throw new HttpsError('unauthenticated', 'Entre na sua conta para resgatar.');
    }
    return request.auth.uid;
  }
  function target(data) {
    if (!['curso', 'produto'].includes(data?.tipo) || typeof data?.itemId !== 'string' || !/^[\w-]{1,160}$/.test(data.itemId)) {
      throw new HttpsError('invalid-argument', 'Selecione um curso ou produto digital válido.');
    }
    return { tipo: data.tipo, itemId: data.itemId };
  }
  async function itemData(tipo, id) {
    const snap = await db.collection(tipo === 'curso' ? 'cursos' : 'produtos').doc(id).get();
    const item = snap.data();
    if (!item || (tipo === 'produto' && item.modalidade !== 'digital')) {
      throw new HttpsError('failed-precondition', 'Item não encontrado ou não é digital.');
    }
    return item;
  }
  const accessRef = (uid, tipo, id) => db.collection('acessos_digitais').doc(uid).collection('itens').doc(hash(`${tipo}:${id}`));
  async function cursosPagos(uid) {
    const pedidos = await db.collection('pedidos').where('cliente.uid', '==', uid).get();
    const cursos = new Map();
    pedidos.docs.forEach(doc => {
      const pedido=doc.data();
      if (!['pago','paid'].includes(pedido.status)) return;
      (pedido.itens || []).forEach(item => {
        if (item.tipoItem === 'curso' && item.cursoId) cursos.set(item.cursoId, {tipo:'curso',itemId:item.cursoId,nome:item.nome,status:'ativo',origem:'compra'});
      });
    });
    return cursos;
  }
  async function temAcesso(uid,tipo,id) {
    const grant=await accessRef(uid,tipo,id).get();
    // An explicit suspension takes precedence over a paid order.
    if (grant.exists) return grant.data().status === 'ativo';
    return tipo === 'curso' && (await cursosPagos(uid)).has(id);
  }
  const criarCodigoResgate = onCall(async request => {
    await verificarAdmin(request.auth?.uid);
    const { tipo, itemId } = target(request.data);
    const item = await itemData(tipo, itemId);
    const dias = request.data?.validadeDias ?? 30;
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw new HttpsError('invalid-argument', 'Validade deve ser de 1 a 365 dias.');
    const codigo = Array.from({ length: 4 }, () => String(crypto.randomInt(100000)).padStart(5, '0')).join('');
    const expiraEm = new Date(Date.now() + dias * 86400000);
    await db.collection('codigos_resgate').doc(hash(codigo)).create({
      tipo, itemId, nome: item.nome, final: codigo.slice(-4), status: 'disponivel',
      criadoPor: request.auth.uid, criadoEm: FieldValue.serverTimestamp(), expiraEm,
    });
    return { codigo, nome: item.nome, expiraEm: expiraEm.toISOString() };
  });
  const listarCodigosResgate = onCall(async request => {
    await verificarAdmin(request.auth?.uid);
    const snap = await db.collection('codigos_resgate').orderBy('criadoEm', 'desc').limit(100).get();
    return { codigos: snap.docs.map(doc => {
      const d = doc.data();
      return { id: doc.id, nome:d.nome, final:d.final, status:d.status === 'disponivel' && d.expiraEm.toMillis() < Date.now() ? 'expirado' : d.status, resgatadoPor:d.resgatadoPor || null };
    }) };
  });
  const revogarCodigoResgate = onCall(async request => {
    await verificarAdmin(request.auth?.uid);
    if (!/^[a-f0-9]{64}$/.test(request.data?.id || '')) throw new HttpsError('invalid-argument', 'Código inválido.');
    const ref = db.collection('codigos_resgate').doc(request.data.id);
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().status !== 'disponivel') throw new HttpsError('failed-precondition', 'Código indisponível para revogação.');
      tx.update(ref, { status:'revogado', revogadoEm:FieldValue.serverTimestamp() });
    });
    return { revogado:true };
  });
  const resgatarCodigo = onCall(async request => {
    const uid = requireUser(request);
    // Separate transaction ensures invalid attempts also consume the quota.
    const limitRef = db.collection('rate_limits').doc('resgate_' + hash(uid));
    await db.runTransaction(async tx => {
      const snap = await tx.get(limitRef);
      const d = snap.data();
      const agora = Date.now();
      const mesmaJanela = d && agora - d.inicio < 900000;
      if (mesmaJanela && d.tentativas >= 10) throw new HttpsError('resource-exhausted', 'Muitas tentativas. Aguarde 15 minutos.');
      tx.set(limitRef, { inicio:mesmaJanela ? d.inicio : agora, tentativas:mesmaJanela ? d.tentativas + 1 : 1, expiraEm:new Date(agora + 86400000) });
    });
    const codigo = typeof request.data?.codigo === 'string' ? request.data.codigo.replace(/[\s-]/g, '') : '';
    if (!/^\d{20}$/.test(codigo)) throw new HttpsError('invalid-argument', 'Informe os 20 dígitos do código.');
    const ref = db.collection('codigos_resgate').doc(hash(codigo));
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const d = snap.data();
      if (!d || d.status !== 'disponivel' || d.expiraEm.toMillis() <= Date.now()) {
        throw new HttpsError('failed-precondition', 'Código inválido, expirado ou já utilizado.');
      }
      const grantRef = accessRef(uid, d.tipo, d.itemId);
      const grant = await tx.get(grantRef);
      if (grant.exists && grant.data().status === 'ativo') throw new HttpsError('already-exists', 'Você já possui acesso a este item. O código não foi consumido.');
      const itemRef = db.collection(d.tipo === 'curso' ? 'cursos' : 'produtos').doc(d.itemId);
      const item = (await tx.get(itemRef)).data();
      if (!item || (d.tipo === 'produto' && item.modalidade !== 'digital')) throw new HttpsError('failed-precondition', 'Este item não está disponível para resgate.');
      tx.set(grantRef, { tipo:d.tipo, itemId:d.itemId, nome:item.nome, status:'ativo', origem:'resgate', concedidoEm:FieldValue.serverTimestamp() });
      tx.update(ref, { status:'resgatado', resgatadoPor:uid, resgatadoEm:FieldValue.serverTimestamp() });
      return { resgatado:true, nome:item.nome, tipo:d.tipo };
    });
  });
  const listarMeusAcessos = onCall(async request => {
    const uid = requireUser(request);
    const [snap,pagos] = await Promise.all([db.collection('acessos_digitais').doc(uid).collection('itens').get(),cursosPagos(uid)]);
    const itens=new Map([...pagos.values()].map(item=>[`${item.tipo}:${item.itemId}`,item]));
    snap.docs.forEach(doc=>{const d=doc.data();const key=`${d.tipo}:${d.itemId}`;if(d.status==='ativo')itens.set(key,d);else itens.delete(key);});
    const acessos = await Promise.all([...itens.values()].map(async d => {
      const curso = d.tipo === 'curso' ? (await db.collection('cursos').doc(d.itemId).get()).data() : null;
      return { tipo:d.tipo, itemId:d.itemId, nome:d.nome, slug:curso?.slug || null };
    }));
    return { acessos };
  });
  const obterConteudoResgatado = onCall(async request => {
    const uid = requireUser(request);
    const {tipo,itemId} = target(request.data);
    if (!await temAcesso(uid,tipo,itemId)) throw new HttpsError('permission-denied','Sua conta não tem acesso a este item.');
    const item = await itemData(tipo,itemId);
    // Content stays private; only this authenticated callable returns it.
    const content = await db.collection(tipo === 'curso' ? 'cursos_conteudos' : 'produtos_digitais_conteudos').doc(itemId).get();
    const d=content.data();
    return {nome:item.nome,tipo,modulos:tipo==='curso' ? d?.modulos || [] : [],texto:tipo==='produto' ? d?.texto || '' : ''};
  });
  return { criarCodigoResgate, listarCodigosResgate, revogarCodigoResgate, resgatarCodigo, listarMeusAcessos, obterConteudoResgatado };
}
module.exports = { createRedemptionFunctions };
