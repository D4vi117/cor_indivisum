function createCouponFunctions({ onCall, HttpsError, db, FieldValue, verificarAdmin, carregarItensDoCatalogo, now = () => Date.now() }) {
  const coupons = db.collection("cupons");

  function normalizeCode(value) {
    return typeof value === "string" ? value.trim().toLocaleUpperCase("pt-BR") : "";
  }

  function parseDate(value, endOfDay = false) {
    if (value === null || value === "") return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const timestamp = Date.parse(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}-03:00`);
    return Number.isFinite(timestamp) ? timestamp : NaN;
  }

  function validateCouponInput(input) {
    const codigo = normalizeCode(input?.codigo);
    const escopo = input?.escopo;
    const tipo = input?.tipo;
    const valor = Number(input?.valor);
    const limiteDesconto = input?.limiteDesconto === null || input?.limiteDesconto === "" || input?.limiteDesconto === undefined
      ? null : Number(input.limiteDesconto);
    const pedidoMinimo = Number(input?.pedidoMinimo ?? 0);
    const limiteEmissoes = input?.limiteEmissoes === null || input?.limiteEmissoes === "" || input?.limiteEmissoes === undefined
      ? null : Number(input.limiteEmissoes);
    const limiteUsos = input?.limiteUsos === null || input?.limiteUsos === "" || input?.limiteUsos === undefined
      ? null : Number(input.limiteUsos);
    const inicio = input?.validade?.inicio || null;
    const fim = input?.validade?.fim || null;
    const inicioTimestamp = parseDate(inicio);
    const fimTimestamp = parseDate(fim, true);

    if (!/^[A-Z0-9_-]{3,40}$/.test(codigo)) {
      throw new HttpsError("invalid-argument", "Use um código de 3 a 40 caracteres: letras, números, hífen ou sublinhado.");
    }
    if (!["universal", "exclusivo"].includes(escopo)) {
      throw new HttpsError("invalid-argument", "Escolha se o cupom é universal ou exclusivo para clientes selecionados.");
    }
    if (typeof input?.descricao !== "string" || input.descricao.trim().length > 240) {
      throw new HttpsError("invalid-argument", "A descrição deve ter até 240 caracteres.");
    }
    if (!["percentual", "valor_fixo"].includes(tipo) || !Number.isFinite(valor) || valor <= 0 || (tipo === "percentual" && valor > 100)) {
      throw new HttpsError("invalid-argument", "Informe um tipo e valor de desconto válidos.");
    }
    if (tipo === "valor_fixo" && limiteDesconto !== null || (limiteDesconto !== null && (!Number.isFinite(limiteDesconto) || limiteDesconto <= 0))) {
      throw new HttpsError("invalid-argument", "O limite máximo só pode ser usado em descontos percentuais e deve ser maior que zero.");
    }
    if (!Number.isFinite(pedidoMinimo) || pedidoMinimo < 0 || (limiteEmissoes !== null && (!Number.isInteger(limiteEmissoes) || limiteEmissoes < 1)) || (limiteUsos !== null && (!Number.isInteger(limiteUsos) || limiteUsos < 1))) {
      throw new HttpsError("invalid-argument", "Confira o pedido mínimo e o limite de emissões.");
    }
    if (escopo === "exclusivo" && limiteUsos !== null || escopo === "universal" && limiteEmissoes !== null) {
      throw new HttpsError("invalid-argument", "O limite precisa corresponder ao tipo de cupom selecionado.");
    }
    if (Number.isNaN(inicioTimestamp) || Number.isNaN(fimTimestamp) || (inicioTimestamp !== null && fimTimestamp !== null && fimTimestamp < inicioTimestamp)) {
      throw new HttpsError("invalid-argument", "Confira o período de validade do cupom.");
    }
    if (!["ativo", "inativo"].includes(input.status)) {
      throw new HttpsError("invalid-argument", "Status do cupom inválido.");
    }

    return {
      codigo,
      escopo,
      descricao: input.descricao.trim(),
      tipo,
      valor,
      limiteDesconto: tipo === "percentual" ? limiteDesconto : null,
      status: input.status,
      validade: { inicio, fim },
      pedidoMinimo,
      limiteEmissoes,
      limiteUsos,
    };
  }

  function calculateDiscountCentavos(coupon, subtotalCentavos) {
    let desconto = coupon.tipo === "percentual"
      ? Math.round(subtotalCentavos * Number(coupon.valor) / 100)
      : Math.round(Number(coupon.valor) * 100);
    if (coupon.tipo === "percentual" && coupon.limiteDesconto != null) {
      desconto = Math.min(desconto, Math.round(Number(coupon.limiteDesconto) * 100));
    }
    return Math.max(0, Math.min(subtotalCentavos, desconto));
  }

  function couponIsActive(coupon, currentTime = now()) {
    const start = parseDate(coupon.validade?.inicio);
    const end = parseDate(coupon.validade?.fim, true);
    return coupon.status === "ativo" && !Number.isNaN(start) && !Number.isNaN(end)
      && (start === null || currentTime >= start) && (end === null || currentTime <= end);
  }

  async function findCouponByCode(transaction, code) {
    const normalized = normalizeCode(code);
    if (!/^[A-Z0-9_-]{3,40}$/.test(normalized)) {
      throw new HttpsError("invalid-argument", "Informe um código de cupom válido.");
    }
    const snapshot = await transaction.get(coupons.where("codigo", "==", normalized).limit(2));
    if (snapshot.size !== 1) throw new HttpsError("not-found", "Cupom não encontrado ou indisponível.");
    return { ref: snapshot.docs[0].ref, coupon: snapshot.docs[0].data() };
  }

  async function validarCupomParaCliente({ uid, codigo, subtotalCentavos, transaction = null }) {
    const lookup = transaction
      ? await findCouponByCode(transaction, codigo)
      : await (async () => {
          const normalized = normalizeCode(codigo);
          if (!/^[A-Z0-9_-]{3,40}$/.test(normalized)) throw new HttpsError("invalid-argument", "Informe um código de cupom válido.");
          const snapshot = await coupons.where("codigo", "==", normalized).limit(2).get();
          if (snapshot.size !== 1) throw new HttpsError("not-found", "Cupom não encontrado ou indisponível.");
          return { ref: snapshot.docs[0].ref, coupon: snapshot.docs[0].data() };
        })();
    const { ref, coupon } = lookup;
    if (!couponIsActive(coupon)) throw new HttpsError("failed-precondition", "Este cupom está inativo ou fora do prazo de validade.");
    if (subtotalCentavos < Math.round(Number(coupon.pedidoMinimo || 0) * 100)) {
      throw new HttpsError("failed-precondition", `O pedido mínimo para este cupom é ${Number(coupon.pedidoMinimo || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`);
    }

    let assignmentRef = null;
    let assignment = null;
    if (coupon.escopo === "exclusivo") {
      if (!uid) throw new HttpsError("unauthenticated", "Entre na sua conta para usar este cupom.");
      assignmentRef = ref.collection("clientes").doc(uid);
      const assignmentSnap = transaction ? await transaction.get(assignmentRef) : await assignmentRef.get();
      assignment = assignmentSnap.exists ? assignmentSnap.data() : null;
      if (!assignment || assignment.status !== "disponivel") {
        throw new HttpsError("permission-denied", "Este cupom não foi emitido para sua conta ou já está reservado/usado.");
      }
    } else if (coupon.escopo !== "universal") {
      throw new HttpsError("failed-precondition", "A configuração deste cupom está inválida.");
    }

    const reservados = Number(coupon.reservados) || 0;
    const usados = Number(coupon.usados) || 0;
    if (coupon.escopo === "universal" && coupon.limiteUsos != null && usados + reservados >= Number(coupon.limiteUsos)) {
      throw new HttpsError("resource-exhausted", "O limite de usos deste cupom foi atingido.");
    }

    const descontoCentavos = calculateDiscountCentavos(coupon, subtotalCentavos);
    if (descontoCentavos <= 0) throw new HttpsError("failed-precondition", "O cupom não gera desconto para este pedido.");
    return { ref, coupon, assignmentRef, assignment, descontoCentavos };
  }

  async function reservarCupomNoPedido(transaction, { uid, codigo, subtotalCentavos, pedidoId }) {
    if (!codigo) return null;
    const { ref, coupon, assignmentRef, descontoCentavos } = await validarCupomParaCliente({
      uid, codigo, subtotalCentavos, transaction,
    });
    const resgateRef = ref.collection("resgates").doc(pedidoId);
    const resgateExistente = await transaction.get(resgateRef);
    if (resgateExistente.exists) throw new HttpsError("already-exists", "Este pedido já reservou o cupom.");

    transaction.update(ref, {
      reservados: FieldValue.increment(1),
      atualizadoEm: FieldValue.serverTimestamp(),
    });
    transaction.create(resgateRef, {
      pedidoId,
      uid,
      status: "reservado",
      desconto: descontoCentavos / 100,
      criadoEm: FieldValue.serverTimestamp(),
    });
    if (assignmentRef) {
      transaction.update(assignmentRef, {
        status: "reservado",
        pedidoId,
        reservadoEm: FieldValue.serverTimestamp(),
      });
    }

    return {
      cupomId: ref.id,
      codigo: coupon.codigo,
      escopo: coupon.escopo,
      tipo: coupon.tipo,
      valor: coupon.valor,
      desconto: descontoCentavos / 100,
      status: "reservado",
    };
  }

  async function confirmarUsoCupom(pedido) {
    const cupomId = pedido?.cupom?.cupomId;
    const pedidoId = pedido?.id || pedido?.numeroPedido;
    const uid = pedido?.cliente?.uid;
    if (!cupomId || !pedidoId) return;
    const couponRef = coupons.doc(cupomId);
    const redemptionRef = couponRef.collection("resgates").doc(pedidoId);
    const assignmentRef = uid ? couponRef.collection("clientes").doc(uid) : null;

    await db.runTransaction(async (transaction) => {
      const [couponSnap, redemptionSnap, assignmentSnap] = await Promise.all([
        transaction.get(couponRef), transaction.get(redemptionRef), ...(assignmentRef ? [transaction.get(assignmentRef)] : []),
      ]);
      if (!couponSnap.exists || !redemptionSnap.exists) return;
      const redemption = redemptionSnap.data();
      if (redemption.status === "usado") return;
      if (redemption.status !== "reservado") return;
      transaction.update(redemptionRef, { status: "usado", usadoEm: FieldValue.serverTimestamp() });
      transaction.update(couponRef, {
        reservados: FieldValue.increment(-1),
        usados: FieldValue.increment(1),
        atualizadoEm: FieldValue.serverTimestamp(),
      });
      if (assignmentRef && assignmentSnap?.exists && assignmentSnap.data().pedidoId === pedidoId) {
        transaction.update(assignmentRef, { status: "usado", usadoEm: FieldValue.serverTimestamp() });
      }
    });
  }

  async function liberarReservaCupom(pedido, motivo = "cancelado") {
    const cupomId = pedido?.cupom?.cupomId;
    const pedidoId = pedido?.id || pedido?.numeroPedido;
    const uid = pedido?.cliente?.uid;
    if (!cupomId || !pedidoId) return;
    const couponRef = coupons.doc(cupomId);
    const redemptionRef = couponRef.collection("resgates").doc(pedidoId);
    const assignmentRef = uid ? couponRef.collection("clientes").doc(uid) : null;

    await db.runTransaction(async (transaction) => {
      const snapshots = await Promise.all([
        transaction.get(couponRef),
        transaction.get(redemptionRef),
        ...(assignmentRef ? [transaction.get(assignmentRef)] : []),
      ]);
      const [couponSnap, redemptionSnap, assignmentSnap] = snapshots;
      if (!couponSnap.exists || !redemptionSnap.exists || redemptionSnap.data().status !== "reservado") return;
      transaction.update(redemptionRef, {
        status: "liberado",
        motivo,
        liberadoEm: FieldValue.serverTimestamp(),
      });
      transaction.update(couponRef, {
        reservados: FieldValue.increment(-1),
        atualizadoEm: FieldValue.serverTimestamp(),
      });
      if (assignmentRef && assignmentSnap?.exists && assignmentSnap.data().pedidoId === pedidoId) {
        transaction.update(assignmentRef, {
          status: "disponivel",
          pedidoId: FieldValue.delete(),
          reservadoEm: FieldValue.delete(),
        });
      }
    });
  }

  const validarCupom = onCall(async (request) => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "É preciso estar logado.");
    const itens = await carregarItensDoCatalogo(request.data?.itens);
    const subtotalCentavos = itens.reduce((sum, item) => sum + Math.round(Number(item.preco) * 100) * item.qtd, 0);
    const result = await validarCupomParaCliente({
      uid: request.auth.uid,
      codigo: request.data?.codigo,
      subtotalCentavos,
    });
    return {
      codigo: result.coupon.codigo,
      tipo: result.coupon.tipo,
      valor: result.coupon.valor,
      subtotal: subtotalCentavos / 100,
      desconto: result.descontoCentavos / 100,
      totalComDesconto: (subtotalCentavos - result.descontoCentavos) / 100,
    };
  });

  const listarCuponsAdmin = onCall(async (request) => {
    await verificarAdmin(request.auth?.uid);
    const snapshot = await coupons.get();
    const cupons = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    cupons.sort((a, b) => {
      const dataA = a.criadoEm?.toMillis?.() ?? 0;
      const dataB = b.criadoEm?.toMillis?.() ?? 0;
      return dataB - dataA;
    });
    return {
      cupons,
    };
  });

  const salvarCupomAdmin = onCall(async (request) => {
    await verificarAdmin(request.auth?.uid);
    const { cupomId = null } = request.data || {};
    const dados = validateCouponInput(request.data?.cupom);
    const ref = cupomId ? coupons.doc(String(cupomId)) : coupons.doc();
    const duplicateQuery = coupons.where("codigo", "==", dados.codigo).limit(2);

    await db.runTransaction(async (transaction) => {
      const duplicateSnapshot = await transaction.get(duplicateQuery);
      if (duplicateSnapshot.docs.some((doc) => doc.id !== ref.id)) {
        throw new HttpsError("already-exists", "Já existe um cupom com esse código.");
      }

      const existing = await transaction.get(ref);
      if (cupomId && !existing.exists) throw new HttpsError("not-found", "Cupom não encontrado.");
      const current = existing.data() || {};
      if (cupomId && current.escopo && current.escopo !== dados.escopo && ((Number(current.emitidos) || 0) > 0 || (Number(current.usados) || 0) > 0 || (Number(current.reservados) || 0) > 0)) {
        throw new HttpsError("failed-precondition", "O tipo de distribuição não pode mudar depois que o cupom já foi distribuído ou usado.");
      }
      if (dados.escopo === "exclusivo" && dados.limiteEmissoes !== null && dados.limiteEmissoes < (Number(current.emitidos) || 0)) {
        throw new HttpsError("failed-precondition", "O limite de emissões não pode ser menor que os cupons já emitidos.");
      }
      if (dados.escopo === "universal" && dados.limiteUsos !== null && dados.limiteUsos < ((Number(current.usados) || 0) + (Number(current.reservados) || 0))) {
        throw new HttpsError("failed-precondition", "O limite de usos não pode ser menor que os usos e reservas em andamento.");
      }
      transaction.set(ref, {
        ...dados,
        emitidos: Number(current.emitidos) || 0,
        usados: Number(current.usados) || 0,
        posses: Number(current.posses) || 0,
        reservados: Number(current.reservados) || 0,
        criadoEm: current.criadoEm || FieldValue.serverTimestamp(),
        atualizadoEm: FieldValue.serverTimestamp(),
      });
    });

    const saved = await ref.get();
    return { cupom: { id: ref.id, ...saved.data() } };
  });

  const excluirCupomAdmin = onCall(async (request) => {
    await verificarAdmin(request.auth?.uid);
    const cupomId = String(request.data?.cupomId || "");
    if (!cupomId) throw new HttpsError("invalid-argument", "cupomId é obrigatório.");
    const ref = coupons.doc(cupomId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpsError("not-found", "Cupom não encontrado.");
      const data = snapshot.data();
      if ((Number(data.emitidos) || 0) > 0 || (Number(data.usados) || 0) > 0 || (Number(data.reservados) || 0) > 0) {
        throw new HttpsError("failed-precondition", "Este cupom já foi emitido. Desative-o para preservar o histórico.");
      }
      transaction.delete(ref);
    });
    return { excluido: true };
  });

  const listarClientesCupomAdmin = onCall(async (request) => {
    await verificarAdmin(request.auth?.uid);
    const cupomId = String(request.data?.cupomId || "");
    if (!cupomId) throw new HttpsError("invalid-argument", "cupomId é obrigatório.");
    const snapshot = await coupons.doc(cupomId).collection("clientes").orderBy("emitidoEm", "desc").get();
    return { clientes: snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() })) };
  });

  const emitirCupomAdmin = onCall(async (request) => {
    await verificarAdmin(request.auth?.uid);
    const cupomId = String(request.data?.cupomId || "");
    const uid = String(request.data?.uid || "");
    if (!cupomId || !uid) throw new HttpsError("invalid-argument", "cupomId e uid são obrigatórios.");

    const couponRef = coupons.doc(cupomId);
    const userRef = db.collection("usuarios").doc(uid);
    const assignmentRef = couponRef.collection("clientes").doc(uid);
    const issuedAt = FieldValue.serverTimestamp();

    await db.runTransaction(async (transaction) => {
      const [couponSnapshot, userSnapshot, assignmentSnapshot] = await Promise.all([
        transaction.get(couponRef), transaction.get(userRef), transaction.get(assignmentRef),
      ]);
      if (!couponSnapshot.exists) throw new HttpsError("not-found", "Cupom não encontrado.");
      if (!userSnapshot.exists) throw new HttpsError("not-found", "Cliente não encontrado.");
      if (assignmentSnapshot.exists) throw new HttpsError("already-exists", "Este cliente já recebeu este cupom.");

      const coupon = couponSnapshot.data();
      if (coupon.escopo !== "exclusivo") {
        throw new HttpsError("failed-precondition", "Este cupom é universal e não precisa ser emitido para um cliente.");
      }
      const start = parseDate(coupon.validade?.inicio);
      const end = parseDate(coupon.validade?.fim, true);
      const currentTime = now();
      if (coupon.status !== "ativo" || (start !== null && currentTime < start) || (end !== null && currentTime > end)) {
        throw new HttpsError("failed-precondition", "Este cupom está inativo ou fora do período de validade.");
      }
      if (coupon.limiteEmissoes !== null && (Number(coupon.emitidos) || 0) >= Number(coupon.limiteEmissoes)) {
        throw new HttpsError("resource-exhausted", "O limite de emissões deste cupom foi atingido.");
      }

      const user = userSnapshot.data();
      transaction.create(assignmentRef, {
        uid,
        nome: typeof user.nome === "string" ? user.nome : "",
        email: typeof user.email === "string" ? user.email : "",
        telefone: typeof user.telefone === "string" ? user.telefone : "",
        documento: typeof user.documento === "string" ? user.documento : "",
        role: typeof user.role === "string" ? user.role : "",
        emitidoEm: issuedAt,
        status: "disponivel",
        usadoEm: null,
        pedidoId: null,
      });
      transaction.update(couponRef, {
        emitidos: FieldValue.increment(1),
        posses: FieldValue.increment(1),
        atualizadoEm: FieldValue.serverTimestamp(),
      });
    });
    return { emitido: true };
  });

  const removerCupomClienteAdmin = onCall(async (request) => {
    await verificarAdmin(request.auth?.uid);
    const cupomId = String(request.data?.cupomId || "");
    const uid = String(request.data?.uid || "");
    if (!cupomId || !uid) throw new HttpsError("invalid-argument", "cupomId e uid são obrigatórios.");
    const couponRef = coupons.doc(cupomId);
    const assignmentRef = couponRef.collection("clientes").doc(uid);

    await db.runTransaction(async (transaction) => {
      const [couponSnapshot, assignmentSnapshot] = await Promise.all([
        transaction.get(couponRef), transaction.get(assignmentRef),
      ]);
      if (!couponSnapshot.exists || !assignmentSnapshot.exists) throw new HttpsError("not-found", "Emissão não encontrada.");
      if (["reservado", "usado"].includes(assignmentSnapshot.data().status)) {
        throw new HttpsError("failed-precondition", "Este cupom está reservado ou já foi usado; o histórico foi preservado.");
      }
      transaction.delete(assignmentRef);
      transaction.update(couponRef, {
        emitidos: FieldValue.increment(-1),
        posses: FieldValue.increment(-1),
        atualizadoEm: FieldValue.serverTimestamp(),
      });
    });
    return { removido: true };
  });

  return {
    validarCupom,
    listarCuponsAdmin,
    salvarCupomAdmin,
    excluirCupomAdmin,
    listarClientesCupomAdmin,
    emitirCupomAdmin,
    removerCupomClienteAdmin,
    reservarCupomNoPedido,
    confirmarUsoCupom,
    liberarReservaCupom,
  };
}

module.exports = { createCouponFunctions };
