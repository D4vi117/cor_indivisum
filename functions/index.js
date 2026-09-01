const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { setGlobalOptions } = require("firebase-functions/v2");
const crypto = require("crypto");

// Define a região global para TODAS as funções v2 deste arquivo
setGlobalOptions({ region: "southamerica-east1" });

// Inicializa o app do Firebase Admin
initializeApp();

// Instancia o banco de dados
const db = getFirestore();

// ======================================================
// CONFIGURAÇÕES VIA .ENV
// ======================================================
const INFINITEPAY_HANDLE = process.env.INFINITEPAY_HANDLE;
const MELHOR_ENVIO_CLIENT_ID = process.env.MELHOR_ENVIO_CLIENT_ID;
const MELHOR_ENVIO_BASE_URL = process.env.MELHOR_ENVIO_BASE_URL;
const MELHOR_ENVIO_REDIRECT_URI = process.env.MELHOR_ENVIO_REDIRECT_URI;
const REMETENTE_POSTAL_CODE = process.env.REMETENTE_POSTAL_CODE;
const MP_WEBHOOK_URL = "https://corindivisum.com.br/api/webhook-mp";

function cepOrigemConfigurado() {
  const cep = String(REMETENTE_POSTAL_CODE || "").replace(/\D/g, "");
  return cep.length === 8 ? cep : null;
}

function melhorEnvioAmbiente() {
  return MELHOR_ENVIO_BASE_URL?.includes("sandbox.melhorenvio.com.br")
    ? "sandbox"
    : "producao";
}

function melhorEnvioConfigRef() {
  return db.collection("melhor_envio_config").doc(melhorEnvioAmbiente());
}

// ======================================================
// MERCADO PAGO - Client helper
// ======================================================
const {
  MercadoPagoConfig,
  Preference,
  Payment,
  WebhookSignatureValidator,
  InvalidWebhookSignatureError,
} = require("mercadopago");

let mpClient = null;
function getClients() {
  if (!mpClient) {
    mpClient = new MercadoPagoConfig({
      accessToken: process.env.MP_ACCESS_TOKEN,
    });
  }
  return {
    preference: new Preference(mpClient),
    payment: new Payment(mpClient),
  };
}

// ======================================================
// PEDIDOS - Helpers
// ======================================================
function pedidoRef(pedidoId) {
  return db.collection("pedidos").doc(pedidoId);
}

// Busca um pedido pelo ID e lança erro se não existir.
async function getPedido(pedidoId) {
  const snap = await pedidoRef(pedidoId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Pedido não encontrado");
  }
  return { id: snap.id, ...snap.data() };
}

function exigirDonoDoPedido(request, pedido) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "É preciso estar logado.");
  }

  if (pedido.cliente?.uid !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Este pedido não pertence a este usuário.");
  }
}

function precoAtualProduto(produto) {
  const precos = produto.precos;
  const precoBase = Number(precos?.de ?? produto.preco) || 0;
  const precoPromocional = Number(precos?.por ?? produto.precoPromocional) || 0;
  const emOferta = precos?.emOferta === true || precos?.emOferta === "true";

  if (emOferta && precoPromocional > 0 && precoPromocional < precoBase) {
    return precoPromocional;
  }

  return precoBase > 0 ? precoBase : precoPromocional;
}

async function carregarItensDoCatalogo(itensSolicitados) {
  if (!Array.isArray(itensSolicitados) || itensSolicitados.length === 0) {
    throw new HttpsError("invalid-argument", "Carrinho vazio");
  }

  const quantidades = new Map();
  for (const item of itensSolicitados) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    const qtd = Number(item?.qtd ?? item?.quantidade);
    if (!id || !Number.isInteger(qtd) || qtd < 1 || qtd > 20) {
      throw new HttpsError("invalid-argument", "Item do carrinho inválido");
    }
    quantidades.set(id, (quantidades.get(id) || 0) + qtd);
  }

  if (quantidades.size > 10 || [...quantidades.values()].some((qtd) => qtd > 20)) {
    throw new HttpsError("invalid-argument", "Carrinho excede o limite permitido");
  }

  return Promise.all(
    [...quantidades.keys()].map(async (id) => {
      const snap = await db.collection("produtos").doc(id).get();
      if (!snap.exists) {
        throw new HttpsError("not-found", "Produto não encontrado");
      }

      const produto = snap.data();
      const ativo = produto.status?.ativo ?? produto.ativo;
      const publicado = produto.status?.publicado ?? produto.publicado;
      const preco = precoAtualProduto(produto);
      if (ativo !== true || publicado !== true || !Number.isFinite(preco) || preco <= 0) {
        throw new HttpsError("failed-precondition", "Produto indisponível");
      }

      const dimensoes = produto.dimensoesEmbalagem || {};
      return {
        id,
        nome: produto.nome || "Produto",
        preco,
        qtd: quantidades.get(id),
        dimensoes: {
          altura: Number(dimensoes.alturaCm) || 4,
          largura: Number(dimensoes.larguraCm) || 16,
          comprimento: Number(dimensoes.comprimentoCm) || 23,
          peso: Number(dimensoes.pesoKg) || 0.3,
        },
      };
    })
  );
}

function itensParaPagamento(pedido) {
  const itens = Array.isArray(pedido.itens) ? [...pedido.itens] : [];
  const valorFrete = Number(pedido.frete?.valor) || 0;
  if (valorFrete > 0) {
    itens.push({
      id: "frete",
      nome: pedido.frete?.nome ? `Frete — ${pedido.frete.nome}` : "Frete",
      preco: valorFrete,
      qtd: 1,
    });
  }
  return itens;
}

function assinaturaMelhorEnvioValida(req) {
  const assinaturaRecebida = req.get("x-me-signature");
  if (!assinaturaRecebida || !req.rawBody) {
    return false;
  }

  const assinaturaEsperada = crypto
    .createHmac("sha256", process.env.MELHOR_ENVIO_CLIENT_SECRET)
    .update(req.rawBody)
    .digest("base64");
  const recebida = Buffer.from(assinaturaRecebida, "utf8");
  const esperada = Buffer.from(assinaturaEsperada, "utf8");
  return recebida.length === esperada.length && crypto.timingSafeEqual(recebida, esperada);
}

async function consumirCotaDeFrete(req) {
  const ip = req.ip || req.socket?.remoteAddress || "desconhecido";
  const chave = crypto
    .createHmac("sha256", process.env.RATE_LIMIT_SECRET)
    .update(`cotacao-frete:${ip}`)
    .digest("hex");
  const ref = db.collection("rate_limits").doc(`cotacao_frete_${chave}`);
  const agora = Date.now();
  const janelaMs = 60_000;
  const limite = 20;

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const dados = snap.exists ? snap.data() : {};
    const inicioJanela = dados.inicioJanela?.toMillis?.() || 0;
    const dentroDaJanela = agora - inicioJanela < janelaMs;
    const quantidade = dentroDaJanela ? Number(dados.quantidade || 0) : 0;

    if (quantidade >= limite) {
      return false;
    }

    transaction.set(
      ref,
      {
        quantidade: quantidade + 1,
        inicioJanela: dentroDaJanela ? dados.inicioJanela : new Date(agora),
        expiraEm: new Date(agora + 24 * 60 * 60 * 1000),
      },
      { merge: true }
    );
    return true;
  });
}

// ======================================================
// NOTIFICAÇÕES PUSH (admins)
// ======================================================
async function enviarPushAdmins({ title, body, url }) {
  const adminsSnap = await db
    .collection("usuarios")
    .where("isAdmin", "==", true)
    .get();

  const tokens = [];
  adminsSnap.forEach((doc) => {
    const data = doc.data();
    if (Array.isArray(data.fcmTokens)) {
      tokens.push(...data.fcmTokens);
    } else if (data.fcmToken) {
      tokens.push(data.fcmToken);
    }
  });

  if (tokens.length === 0) {
    console.log("enviarPushAdmins: nenhum token de admin encontrado.");
    return;
  }

  const message = {
    notification: { title, body },
    webpush: url ? { fcmOptions: { link: url } } : undefined,
    tokens,
  };

  const resposta = await getMessaging().sendEachForMulticast(message);
  console.log(
    `enviarPushAdmins: ${resposta.successCount} enviados, ${resposta.failureCount} falharam`
  );
  return resposta;
}

// ======================================================
// MELHOR ENVIO & INFINITEPAY - CONFIGURAÇÕES E HELPERS
// ======================================================

const MELHOR_ENVIO_REMETENTE = {
  name: process.env.REMETENTE_NAME,
  phone: process.env.REMETENTE_PHONE,
  email: process.env.REMETENTE_EMAIL,
  document: process.env.REMETENTE_DOCUMENT,
  address: process.env.REMETENTE_ADDRESS,
  complement: process.env.REMETENTE_COMPLEMENT || "",
  number: process.env.REMETENTE_NUMBER,
  district: process.env.REMETENTE_DISTRICT,
  city: process.env.REMETENTE_CITY,
  state_abbr: process.env.REMETENTE_STATE_ABBR,
  country_id: process.env.REMETENTE_COUNTRY_ID || "BR",
  postal_code: REMETENTE_POSTAL_CODE,
};

async function criarCheckoutInfinitePay({ orderId, email, itens, total }) {
  const items = Array.isArray(itens) && itens.length > 0
    ? itens.map((item) => ({
        description: item.nome || item.title || "Item",
        quantity: Number(item.qtd || item.quantidade || 1),
        price: Math.round((Number(item.preco) || 0) * 100),
      }))
    : [
        {
          description: `Pedido #${orderId}`,
          quantity: 1,
          price: Math.round(Number(total) * 100),
        },
      ];

  const payload = {
    handle: INFINITEPAY_HANDLE,
    items,
    order_nsu: orderId,
    webhook_url: `https://southamerica-east1-cor-indivisum.cloudfunctions.net/webhookInfinitePay`,
    redirect_url: `https://corindivisum.com.br/loja/pedido-confirmado?id=${orderId}`,
    customer: {
      email,
    },
  };

  const res = await fetch("https://api.checkout.infinitepay.io/links", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`InfinitePay ${res.status}: ${err}`);
  }

  return res.json();
}

// Callable para contingência do InfinitePay
exports.processarPagamentoInfinitePay = onCall(async (request) => {
  const { pedidoId } = request.data;

  if (!pedidoId) {
    throw new HttpsError("invalid-argument", "pedidoId é obrigatório");
  }

  try {
    const pedido = await getPedido(pedidoId);
    exigirDonoDoPedido(request, pedido);

    const checkout = await criarCheckoutInfinitePay({
      orderId: pedidoId,
      email: pedido.cliente?.email || pedido.email,
      itens: itensParaPagamento(pedido),
      total: pedido.total,
    });

    const paymentLink =
      checkout?.link ||
      checkout?.url ||
      checkout?.payment_link ||
      checkout?.checkout_url;

    if (!paymentLink) {
      throw new Error("Não foi possível obter o link do InfinitePay.");
    }

    await pedidoRef(pedidoId).update({
      plataformaPagamento: "infinitepay",
      infinitepay: checkout,
      atualizadoEm: FieldValue.serverTimestamp(),
    });

    return { paymentLink };
  } catch (err) {
    console.error("Erro ao gerar fallback InfinitePay:", err);
    throw new HttpsError(
      "internal",
      err.message || "Erro ao processar contingência de pagamento."
    );
  }
});

// ======================================================
// WEBHOOK INFINITEPAY
// ======================================================

exports.webhookInfinitePay = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }
  try {
    const event = req.body;

    await db.collection("webhook_logs").add({
      recebidoEm: FieldValue.serverTimestamp(),
      headers: req.headers,
      body: event,
    });

    const { order_nsu, transaction_nsu, capture_method, receipt_url } = event;
    const invoiceSlug = event.invoice_slug || event.slug;

    if (!order_nsu || !transaction_nsu || !invoiceSlug || !receipt_url) {
      return res.status(400).send("Dados incompletos no webhook");
    }

    const pedidoDocRef = pedidoRef(order_nsu);
    const pedidoSnap = await pedidoDocRef.get();

    if (!pedidoSnap.exists) {
      return res.status(404).send("Pedido não encontrado");
    }

    const pedido = pedidoSnap.data();

    if (pedido.status === "pago" || pedido.status === "paid") {
      return res.status(200).send("already paid");
    }

    const confirmacaoRes = await fetch(
      "https://api.infinitepay.io/invoices/public/checkout/payment_check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: INFINITEPAY_HANDLE,
          order_nsu,
          transaction_nsu,
          slug: invoiceSlug,
        }),
      }
    );
    const confirmacao = await confirmacaoRes.json().catch(() => null);
    const valorEsperado = Math.round(Number(pedido.total) * 100);
    if (
      !confirmacaoRes.ok ||
      !confirmacao?.success ||
      !confirmacao?.paid ||
      !Number.isFinite(valorEsperado) ||
      Number(confirmacao.amount) !== valorEsperado
    ) {
      console.error("webhookInfinitePay: pagamento não confirmado", {
        pedidoId: order_nsu,
        statusHttp: confirmacaoRes.status,
        valorEsperado,
        valorConfirmado: confirmacao?.amount,
      });
      return res.status(422).send("Pagamento não confirmado");
    }

    await pedidoDocRef.update({
      status: "pago",
      plataformaPagamento: "infinitepay",
      atualizadoEm: FieldValue.serverTimestamp(),
      pagamento: {
        plataforma: "infinitepay",
        metodo: capture_method || "pix_ou_cartao",
        status: "approved",
        receiptUrl: receipt_url,
        transactionNsu: transaction_nsu,
        valorPago: (confirmacao.paid_amount || confirmacao.amount) / 100,
        atualizadoEm: FieldValue.serverTimestamp(),
      },
      infinitepay: {
        ...event,
        validated: true,
        validatedAt: FieldValue.serverTimestamp(),
      },
    });

    const numeroPedido = pedido.numeroPedido || order_nsu;
    enviarPushAdmins({
      title: "Pagamento confirmado (InfinitePay)",
      body: `Pedido #${numeroPedido} confirmado via InfinitePay!`,
      url: `/admin/?pedido=${numeroPedido}`,
    }).catch((err) => console.error("Push falhou:", err));

    return res.status(200).send("ok");
  } catch (err) {
    console.error("webhook error:", err);
    return res.status(500).send("internal error");
  }
});

// ======================================================
// MELHOR ENVIO - AUTENTICAÇÃO (OAuth2)
// ======================================================

exports.iniciarAutorizacaoMelhorEnvio = onCall(async (request) => {
  await verificarAdmin(request.auth?.uid);

  const state = crypto.randomUUID();
  await db.collection("melhor_envio_oauth_states").doc(state).set({
    uid: request.auth.uid,
    criadoEm: FieldValue.serverTimestamp(),
    expiraEm: new Date(Date.now() + 10 * 60 * 1000),
  });

  return {
    authUrl: `https://corindivisum.com.br/api/melhor-envio/auth-start?state=${encodeURIComponent(state)}`,
  };
});

exports.melhorEnvioAuthStart = onRequest(async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const stateRef = state ? db.collection("melhor_envio_oauth_states").doc(state) : null;
  const stateSnap = stateRef ? await stateRef.get() : null;
  const expiraEm = stateSnap?.data()?.expiraEm?.toDate?.();
  if (!stateSnap?.exists || !expiraEm || expiraEm.getTime() < Date.now()) {
    if (stateSnap?.exists) await stateRef.delete();
    return res.status(403).send("Solicitação de autorização inválida ou expirada");
  }

  const params = new URLSearchParams({
    client_id: MELHOR_ENVIO_CLIENT_ID,
    redirect_uri: MELHOR_ENVIO_REDIRECT_URI,
    response_type: "code",
    scope: [
      "shipping-calculate",
      "shipping-checkout",
      "shipping-cancel",
      "shipping-generate",
      "shipping-print",
      "shipping-tracking",
      "cart-read",
      "cart-write",
      "companies-read",
    ].join(" "),
    state,
  });

  const authUrl = `${MELHOR_ENVIO_BASE_URL}/oauth/authorize?${params.toString()}`;

  return res.redirect(authUrl);
});

exports.melhorEnvioAuthCallback = onRequest(
  { cors: true, secrets: ["MELHOR_ENVIO_CLIENT_SECRET"] },
  async (req, res) => {
    try {
      const { code, error, state } = req.query;

      if (error) {
        console.error("melhorEnvioAuthCallback erro do provedor:", error);
        return res.status(400).send(`Autorização negada: ${error}`);
      }

      if (!code) {
        return res.status(400).send("Parâmetro 'code' ausente");
      }

      const stateValue = typeof state === "string" ? state : "";
      const stateRef = stateValue ? db.collection("melhor_envio_oauth_states").doc(stateValue) : null;
      const stateSnap = stateRef ? await stateRef.get() : null;
      const expiraEm = stateSnap?.data()?.expiraEm?.toDate?.();
      if (!stateSnap?.exists || !expiraEm || expiraEm.getTime() < Date.now()) {
        if (stateSnap?.exists) await stateRef.delete();
        return res.status(403).send("Estado de autorização inválido ou expirado");
      }
      await stateRef.delete();

      const tokenRes = await fetch(`${MELHOR_ENVIO_BASE_URL}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: MELHOR_ENVIO_CLIENT_ID,
          client_secret: process.env.MELHOR_ENVIO_CLIENT_SECRET,
          redirect_uri: MELHOR_ENVIO_REDIRECT_URI,
          code,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error("melhorEnvioAuthCallback token error:", errText);
        return res
          .status(502)
          .send("Falha ao trocar o código pelo token do Melhor Envio");
      }

      const tokenData = await tokenRes.json();

      await melhorEnvioConfigRef().set(
        {
          ...tokenData,
          state: state || null,
          ambiente: melhorEnvioAmbiente(),
          atualizadoEm: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return res
        .status(200)
        .send("Autenticação com o Melhor Envio concluída com sucesso. Você já pode fechar esta janela.");
    } catch (err) {
      console.error("melhorEnvioAuthCallback error:", err);
      return res.status(500).send("Erro interno na autenticação do Melhor Envio");
    }
  }
);

async function getMelhorEnvioAccessToken() {
  const ref = melhorEnvioConfigRef();
  const snap = await ref.get();

  if (!snap.exists) {
    throw new Error(
      "Nenhum token salvo. Rode /melhorEnvioAuthStart primeiro para autenticar."
    );
  }

  const data = snap.data();

  const salvoEm = data.atualizadoEm?.toDate
    ? data.atualizadoEm.toDate()
    : new Date(0);
  const expiraEm = new Date(
    salvoEm.getTime() + (data.expires_in || 0) * 1000
  );

  const expirado = Date.now() > expiraEm.getTime() - 60_000;

  if (!expirado) {
    return data.access_token;
  }

  if (!data.refresh_token) {
    throw new Error(
      "Token expirado e sem refresh_token salvo. Autentique novamente em /melhorEnvioAuthStart."
    );
  }

  const refreshRes = await fetch(`${MELHOR_ENVIO_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: MELHOR_ENVIO_CLIENT_ID,
      client_secret: process.env.MELHOR_ENVIO_CLIENT_SECRET,
      refresh_token: data.refresh_token,
    }),
  });

  if (!refreshRes.ok) {
    const errText = await refreshRes.text();
    throw new Error(`Falha ao renovar token: ${errText}`);
  }

  const novoToken = await refreshRes.json();

  await ref.set(
    {
      ...novoToken,
      atualizadoEm: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return novoToken.access_token;
}

async function comprarEtiquetaMelhorEnvio(pedidoId, pedido) {
  const accessToken = await getMelhorEnvioAccessToken();

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "Cor Indivisum (contato@corindivisum.com.br)",
  };

  const itens = pedido.itens || [];
  const produtosSnaps = await Promise.all(
    itens.map((item) => db.collection("produtos").doc(item.id).get())
  );

  const volumes = itens.map((item, idx) => {
    const produto = produtosSnaps[idx].exists ? produtosSnaps[idx].data() : {};
    const dim = produto.dimensoesEmbalagem || {};
    return {
      height: Number(dim.alturaCm) || 4,
      width: Number(dim.larguraCm) || 16,
      length: Number(dim.comprimentoCm) || 23,
      weight: Number(dim.pesoKg) || 0.3,
    };
  });

  const valorSegurado = Math.max(Number(pedido.total) || 0, 1);

  const entrega = pedido.entrega || {};

  const documentoDestinatario = String(pedido.cliente?.documento || "").replace(/\D/g, "");
  if (!documentoDestinatario) {
    throw new Error(
      "Pedido sem CPF/CNPJ do destinatário (pedido feito antes desse campo existir no checkout). Peça o documento ao cliente e adicione manualmente em cliente.documento no Firestore antes de gerar a etiqueta."
    );
  }

  const cartPayload = {
    service: pedido.frete?.id,
    from: MELHOR_ENVIO_REMETENTE,
    to: {
      name: pedido.cliente?.nome || "Cliente",
      phone: pedido.cliente?.telefone || "",
      email: pedido.cliente?.email || "",
      document: documentoDestinatario,
      address: entrega.rua || "",
      complement: entrega.complemento || "",
      number: entrega.numero || "",
      district: entrega.bairro || "",
      city: entrega.cidade || "",
      state_abbr: entrega.estado || "",
      country_id: "BR",
      postal_code: String(entrega.cep || "").replace(/\D/g, ""),
    },
    products: itens.map((item) => ({
      name: item.nome,
      quantity: item.qtd || 1,
      unitary_value: item.preco || 0,
    })),
    volumes,
    options: {
      insurance_value: valorSegurado,
      receipt: false,
      own_hand: false,
      reverse: false,
      non_commercial: false,
      platform: "Cor Indivisum",
    },
  };

  const cartRes = await fetch(`${MELHOR_ENVIO_BASE_URL}/api/v2/me/cart`, {
    method: "POST",
    headers,
    body: JSON.stringify(cartPayload),
  });
  const cartData = await cartRes.json();
  if (!cartRes.ok) {
    throw new Error(`Melhor Envio /cart falhou: ${JSON.stringify(cartData)}`);
  }
  const cartItemId = cartData.id;

  const checkoutRes = await fetch(`${MELHOR_ENVIO_BASE_URL}/api/v2/me/shipment/checkout`, {
    method: "POST",
    headers,
    body: JSON.stringify({ orders: [cartItemId] }),
  });
  const checkoutData = await checkoutRes.json();
  if (!checkoutRes.ok) {
    throw new Error(`Melhor Envio /checkout falhou: ${JSON.stringify(checkoutData)}`);
  }

  const generateRes = await fetch(`${MELHOR_ENVIO_BASE_URL}/api/v2/me/shipment/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ orders: [cartItemId] }),
  });
  const generateData = await generateRes.json();
  if (!generateRes.ok) {
    throw new Error(`Melhor Envio /generate falhou: ${JSON.stringify(generateData)}`);
  }

  const printRes = await fetch(`${MELHOR_ENVIO_BASE_URL}/api/v2/me/shipment/print`, {
    method: "POST",
    headers,
    body: JSON.stringify({ mode: "public", orders: [cartItemId] }),
  });
  const printData = await printRes.json();
  if (!printRes.ok) {
    throw new Error(`Melhor Envio /print falhou: ${JSON.stringify(printData)}`);
  }

  return {
    cartItemId,
    protocol: checkoutData.purchase?.protocol || null,
    printUrl: printData.url || null,
  };
}

exports.melhorEnvioStatus = onRequest({ cors: true }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const snap = await melhorEnvioConfigRef().get();

    if (!snap.exists) {
      return res.status(200).json({ autenticado: false });
    }

    const data = snap.data();
    const salvoEm = data.atualizadoEm?.toDate
      ? data.atualizadoEm.toDate()
      : null;
    const expiraEm = salvoEm
      ? new Date(salvoEm.getTime() + (data.expires_in || 0) * 1000)
      : null;

    return res.status(200).json({
      autenticado: true,
      ambiente: data.ambiente || null,
      tokenExpiraEm: expiraEm,
      expirado: expiraEm ? Date.now() > expiraEm.getTime() : null,
    });
  } catch (err) {
    console.error("melhorEnvioStatus error:", err);
    return res.status(500).json({ error: "erro interno" });
  }
});

exports.obterStatusMelhorEnvioAdmin = onCall(async (request) => {
  await verificarAdmin(request.auth?.uid);

  const snap = await melhorEnvioConfigRef().get();
  if (!snap.exists) {
    return { autenticado: false, ambiente: melhorEnvioAmbiente() };
  }

  const data = snap.data();
  const salvoEm = data.atualizadoEm?.toDate ? data.atualizadoEm.toDate() : null;
  const expiraEm = salvoEm
    ? new Date(salvoEm.getTime() + (data.expires_in || 0) * 1000)
    : null;

  return {
    autenticado: true,
    ambiente: data.ambiente || melhorEnvioAmbiente(),
    expirado: expiraEm ? Date.now() > expiraEm.getTime() : null,
  };
});

exports.melhorEnvioCalcularFrete = onRequest(
  {
    cors: ["https://corindivisum.com.br", "https://www.corindivisum.com.br"],
    secrets: ["RATE_LIMIT_SECRET", "MELHOR_ENVIO_CLIENT_SECRET"],
  },
  async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const { cepDestino, produtos } = req.body ?? {};
    const cepOrigem = cepOrigemConfigurado();
    const destinoNormalizado = String(cepDestino || "").replace(/\D/g, "");
    if (!cepOrigem || destinoNormalizado.length !== 8) {
      return res.status(400).json({
        error: "Configuração de frete ou CEP de destino inválidos",
      });
    }

    if (!Array.isArray(produtos) || produtos.length === 0 || produtos.length > 10) {
      return res.status(400).json({
        error: "produtos deve ser uma lista com ao menos 1 item",
      });
    }

    const permitido = await consumirCotaDeFrete(req);
    if (!permitido) {
      return res.status(429).json({
        error: "Muitas cotações em sequência. Aguarde um minuto e tente novamente.",
      });
    }

    const itens = await carregarItensDoCatalogo(
      produtos.map((produto) => ({
        id: produto?.id,
        qtd: produto?.quantidade ?? produto?.qtd,
      }))
    );

    const accessToken = await getMelhorEnvioAccessToken();

    const payload = {
      from: { postal_code: String(cepOrigem).replace(/\D/g, "") },
      to: { postal_code: destinoNormalizado },
      products: itens.map((item) => ({
        id: item.id,
        width: item.dimensoes.largura,
        height: item.dimensoes.altura,
        length: item.dimensoes.comprimento,
        weight: item.dimensoes.peso,
        insurance_value: item.preco,
        quantity: item.qtd,
      })),
    };

    const calcRes = await fetch(
      `${MELHOR_ENVIO_BASE_URL}/api/v2/me/shipment/calculate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Aplicacao teste (contato@corindivisum.com.br)",
        },
        body: JSON.stringify(payload),
      }
    );

    const resultado = await calcRes.json();

    if (!calcRes.ok) {
      console.error("melhorEnvioCalcularFrete erro:", resultado);
      return res.status(502).json({
        error: "Falha ao calcular frete no Melhor Envio",
      });
    }

    return res.status(200).json({ opcoes: resultado });
  } catch (err) {
    console.error("melhorEnvioCalcularFrete error:", err);
    if (err instanceof HttpsError) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: "erro interno" });
  }
});

const RASTREIO_STATUS_LABEL = {
  generated: "Etiqueta gerada",
  paid: "Etiqueta paga",
  posted: "Postado",
  delivered: "Entregue",
  canceled: "Cancelado",
  expired: "Expirado",
};

const RASTREIO_PARA_STATUS_PEDIDO = {
  posted: "saiu",
  delivered: "entregue",
};

exports.webhookMelhorEnvio = onRequest(
  { secrets: ["MELHOR_ENVIO_CLIENT_SECRET"] },
  async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  if (!assinaturaMelhorEnvioValida(req)) {
    console.warn("webhookMelhorEnvio: assinatura inválida");
    return res.sendStatus(401);
  }

  try {
    const { event, data } = req.body ?? {};

    if (!data?.id) {
      console.warn("webhookMelhorEnvio: payload sem data.id", req.body);
      return res.status(200).json({ ignorado: true });
    }

    const pedidosSnap = await db
      .collection("pedidos")
      .where("etiqueta.cartItemId", "==", data.id)
      .limit(1)
      .get();

    if (pedidosSnap.empty) {
      console.warn(
        `webhookMelhorEnvio: nenhum pedido encontrado para cartItemId ${data.id} (evento ${event})`
      );
      return res.status(200).json({ encontrado: false });
    }

    const pedidoDoc = pedidosSnap.docs[0];
    const pedido = pedidoDoc.data();

    const statusBruto = data.status || null;

    const rastreio = {
      evento: event || null,
      status: statusBruto,
      statusLabel: RASTREIO_STATUS_LABEL[statusBruto] || statusBruto || "Atualização recebida",
      codigo: data.tracking || pedido.rastreio?.codigo || null,
      urlRastreio: data.tracking_url || pedido.rastreio?.urlRastreio || null,
      protocolo: data.protocol || pedido.rastreio?.protocolo || null,
      postadoEm: data.posted_at || pedido.rastreio?.postadoEm || null,
      entregueEm: data.delivered_at || pedido.rastreio?.entregueEm || null,
      canceladoEm: data.canceled_at || pedido.rastreio?.canceladoEm || null,
      atualizadoEm: FieldValue.serverTimestamp(),
    };

    const atualizacao = {
      rastreio,
      rastreioHistorico: FieldValue.arrayUnion({
        evento: event || null,
        status: statusBruto,
        recebidoEm: new Date().toISOString(),
      }),
    };

    const novoStatusPedido = RASTREIO_PARA_STATUS_PEDIDO[statusBruto];
    if (novoStatusPedido && pedido.status && pedido.status !== "aguardando_pagamento") {
      atualizacao.status = novoStatusPedido;
    }

    await pedidoDoc.ref.update(atualizacao);

    return res.status(200).json({
      message: "Webhook do Melhor Envio processado com sucesso.",
      pedidoId: pedidoDoc.id,
      status: statusBruto,
    });
  } catch (err) {
    console.error("webhookMelhorEnvio error:", err);
    return res.status(500).json({ erro: "erro interno" });
  }
});

// ======================================================
// MERCADO PAGO & PEDIDOS (CALLABLES)
// ======================================================

exports.criarPreferencia = onCall(
  { secrets: ["MP_ACCESS_TOKEN"] },
  async (request) => {
    const { pedidoId } = request.data;

    if (!pedidoId) {
      throw new HttpsError("invalid-argument", "pedidoId obrigatório");
    }

    try {
      const pedido = await getPedido(pedidoId);
      exigirDonoDoPedido(request, pedido);
      const { preference } = getClients();

      const pref = await preference.create({
        body: {
          external_reference: pedidoId,
          notification_url: MP_WEBHOOK_URL,
          items: itensParaPagamento(pedido).map((item) => ({
            id: item.id,
            title: item.nome,
            quantity: item.qtd || item.quantidade || 1,
            unit_price: Number(item.preco),
            currency_id: "BRL",
          })),
          back_urls: {
            success: `https://corindivisum.com.br/loja/pedido-confirmado?id=${pedidoId}`,
            failure: `https://corindivisum.com.br/loja/pagamento?id=${pedidoId}`,
            pending: `https://corindivisum.com.br/loja/pedido-confirmado?id=${pedidoId}`,
          },
        },
      });

      return { preferenceId: pref.id };
    } catch (err) {
      console.error("criarPreferencia error:", err);
      throw new HttpsError("internal", err?.message || "Falha ao criar preferência de pagamento");
    }
  }
);

exports.criarPedido = onCall({ secrets: ["MELHOR_ENVIO_CLIENT_SECRET"] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "É preciso estar logado.");
  }

  const { cliente: clienteRecebido, endereco, itens: itensSolicitados, freteId, salvarEndereco } = request.data;
  const nome = typeof clienteRecebido?.nome === "string" ? clienteRecebido.nome.trim() : "";
  const telefone = typeof clienteRecebido?.telefone === "string" ? clienteRecebido.telefone.trim() : "";
  const documento = String(clienteRecebido?.documento || "").replace(/\D/g, "");
  const cepDestino = String(endereco?.cep || "").replace(/\D/g, "");
  const cepOrigem = cepOrigemConfigurado();

  if (!nome || !telefone || ![11, 14].includes(documento.length) || cepDestino.length !== 8) {
    throw new HttpsError("invalid-argument", "Dados de cliente ou entrega inválidos");
  }
  if (typeof freteId !== "number" && typeof freteId !== "string") {
    throw new HttpsError("invalid-argument", "Opção de frete inválida");
  }
  if (!cepOrigem) {
    console.error("criarPedido: REMETENTE_POSTAL_CODE não configurado ou inválido");
    throw new HttpsError("failed-precondition", "A configuração de frete está indisponível");
  }

  const itens = await carregarItensDoCatalogo(itensSolicitados);
  const accessToken = await getMelhorEnvioAccessToken();
  const freteRes = await fetch(`${MELHOR_ENVIO_BASE_URL}/api/v2/me/shipment/calculate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Cor Indivisum (contato@corindivisum.com.br)",
    },
    body: JSON.stringify({
      from: { postal_code: cepOrigem },
      to: { postal_code: cepDestino },
      products: itens.map((item) => ({
        id: item.id,
        width: item.dimensoes.largura,
        height: item.dimensoes.altura,
        length: item.dimensoes.comprimento,
        weight: item.dimensoes.peso,
        insurance_value: item.preco,
        quantity: item.qtd,
      })),
    }),
  });
  const opcoesFrete = await freteRes.json();
  if (!freteRes.ok || !Array.isArray(opcoesFrete)) {
    throw new HttpsError("unavailable", "Não foi possível validar o frete");
  }

  const freteEscolhido = opcoesFrete.find(
    (opcao) => String(opcao.id) === String(freteId) && !opcao.error && Number(opcao.price) >= 0
  );
  if (!freteEscolhido) {
    throw new HttpsError("failed-precondition", "A opção de frete expirou; calcule novamente");
  }

  const subtotalCentavos = itens.reduce(
    (soma, item) => soma + Math.round(item.preco * 100) * item.qtd,
    0
  );
  const freteCentavos = Math.round(Number(freteEscolhido.price) * 100);
  const total = (subtotalCentavos + freteCentavos) / 100;
  const pedidoRefDoc = db.collection("pedidos").doc();
  const cliente = {
    uid: request.auth.uid,
    nome,
    email: request.auth.token.email || null,
    telefone,
    documento,
  };
  const entrega = {
    cep: cepDestino,
    estado: String(endereco.estado || "").trim(),
    rua: String(endereco.rua || "").trim(),
    numero: String(endereco.numero || "").trim(),
    complemento: String(endereco.complemento || "").trim(),
    bairro: String(endereco.bairro || "").trim(),
    cidade: String(endereco.cidade || "").trim(),
  };

  await pedidoRefDoc.set({
    cliente,
    entrega,
    itens: itens.map(({ dimensoes, ...item }) => item),
    subtotal: subtotalCentavos / 100,
    frete: {
      id: freteEscolhido.id,
      nome: freteEscolhido.name || null,
      transportadora: freteEscolhido.company?.name || null,
      valor: freteCentavos / 100,
      prazo: freteEscolhido.delivery_time ?? freteEscolhido.custom_delivery_time ?? null,
    },
    total,
    status: "aguardando_pagamento",
    numeroPedido: pedidoRefDoc.id,
    criadoEm: FieldValue.serverTimestamp(),
  });

  const perfil = { documento };
  if (salvarEndereco) {
    const perfilAtual = await db.collection("usuarios").doc(request.auth.uid).get();
    const enderecosAnteriores = Array.isArray(perfilAtual.data()?.enderecos)
      ? perfilAtual.data().enderecos
      : [];
    perfil.enderecos = [
      entrega,
      ...enderecosAnteriores.filter(
        (item) => !(item.cep === entrega.cep && item.numero === entrega.numero && item.complemento === entrega.complemento)
      ),
    ].slice(0, 3);
  }
  await db.collection("usuarios").doc(request.auth.uid).set(perfil, { merge: true });

  return { pedidoId: pedidoRefDoc.id, total };
});

exports.process_payment = onCall(
  { secrets: ["MP_ACCESS_TOKEN"] },
  async (request) => {
    const { pedidoId, formData } = request.data;

    if (!pedidoId || !formData) {
      throw new HttpsError("invalid-argument", "pedidoId e formData são obrigatórios");
    }

    const pedido = await getPedido(pedidoId);
    exigirDonoDoPedido(request, pedido);
    const totalNumerico = Math.round(Number(pedido.total) * 100) / 100;

    const payload = {
      ...formData,
      transaction_amount: totalNumerico,
      description: `Pedido Cor Indivisum #${pedidoId}`,
      external_reference: pedidoId,
      notification_url: MP_WEBHOOK_URL,
    };

    if (payload.payment_method_id === "pix") {
      payload.date_of_expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    } else {
      payload.three_d_secure_mode = "optional";
    }

    try {
      const { payment } = getClients();
      const crypto = require("crypto");

      const pagamento = await payment.create({
        body: payload,
        requestOptions: { idempotencyKey: crypto.randomUUID() },
      });

      await pedidoRef(pedidoId).update({
        plataformaPagamento: "mercadopago",
        status: pagamento.status === "approved" ? "pago" : pedido.status,
        pagamento: {
          plataforma: "mercadopago",
          id: pagamento.id,
          metodo: payload.payment_method_id,
          status: pagamento.status,
          statusDetail: pagamento.status_detail,
          atualizadoEm: FieldValue.serverTimestamp(),
        },
        atualizadoEm: FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        status: pagamento.status,
        statusDetail: pagamento.status_detail,
        paymentId: pagamento.id,
        pixQrCodeBase64: pagamento?.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        pixCopiaECola: pagamento?.point_of_interaction?.transaction_data?.qr_code || null,
      };
    } catch (err) {
      console.error("Erro no pagamento MP:", err);
      throw new HttpsError("invalid-argument", err?.cause?.[0]?.description || "Pagamento recusado pelo Mercado Pago");
    }
  }
);

exports.webhookMP = onRequest(
  { secrets: ["MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET"] },
  async (req, res) => {
    if (req.method !== "POST") return res.sendStatus(405);

    const dataIdRecebido = req.query["data.id"];
    const dataId = Array.isArray(dataIdRecebido) ? dataIdRecebido[0] : dataIdRecebido;
    if (typeof dataId !== "string" || !dataId) {
      return res.status(400).send("data.id ausente");
    }

    try {
      WebhookSignatureValidator.validate({
        xSignature: req.get("x-signature"),
        xRequestId: req.get("x-request-id"),
        dataId,
        secret: process.env.MP_WEBHOOK_SECRET,
        toleranceSeconds: 300,
      });
    } catch (err) {
      if (err instanceof InvalidWebhookSignatureError) {
        console.warn("webhookMP: assinatura inválida", err.reason);
        return res.sendStatus(401);
      }
      console.error("webhookMP: erro ao validar assinatura", err);
      return res.sendStatus(500);
    }

    const { type, data } = req.body ?? {};
    if (type !== "payment") return res.sendStatus(200);
    if (data?.id && String(data.id) !== String(dataId)) {
      return res.status(400).send("data.id divergente");
    }

    const { payment } = getClients();

    try {
      const pag = await payment.get({ id: dataId });

      const pedidoId = pag.external_reference;
      if (!pedidoId) return res.sendStatus(200);

      const pedidoRefDoc = pedidoRef(pedidoId);
      const pedidoSnap = await pedidoRefDoc.get();

      if (!pedidoSnap.exists) {
        console.warn(`Pedido ${pedidoId} não encontrado.`);
        return res.sendStatus(200);
      }

      const pedido = pedidoSnap.data();
      const totalPedidoEmCentavos = Math.round(Number(pedido.total) * 100);
      const totalPagoEmCentavos = Math.round(Number(pag.transaction_amount) * 100);
      if (
        !Number.isFinite(totalPedidoEmCentavos) ||
        totalPedidoEmCentavos <= 0 ||
        totalPagoEmCentavos !== totalPedidoEmCentavos ||
        pag.currency_id !== "BRL"
      ) {
        console.error("webhookMP: pagamento com valor ou moeda divergente", {
          pedidoId,
          totalPedidoEmCentavos,
          totalPagoEmCentavos,
          moeda: pag.currency_id,
        });
        return res.status(422).send("Pagamento divergente");
      }

      const criadoEm = pedido.criadoEm?.toDate
        ? pedido.criadoEm.toDate()
        : new Date(pedido.criadoEm);

      const cancelamento = {
        permitidoAte: new Date(criadoEm.getTime() + 2 * 60 * 60 * 1000)
      };

      const statusMap = {
        approved: "pago",
        pending: "aguardando_pagamento",
        in_process: "aguardando_pagamento",
        rejected: "recusado",
        cancelled: "cancelado",
        refunded: "reembolsado",
      };

      const pagamento = {
        metodo: pag.payment_type_id === "bank_transfer" ? "pix" : pag.payment_type_id,
        status: pag.status,
        id: pag.id,
        statusDetail: pag.status_detail,
        metodoId: pag.payment_method_id,
        tipo: pag.payment_type_id,
        qrCode: pag.point_of_interaction?.transaction_data?.qr_code || null,
        qrCodeBase64: pag.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        ticketUrl: pag.point_of_interaction?.transaction_data?.ticket_url || null,
        aprovadoEm: pag.date_approved || null,
        atualizadoEm: FieldValue.serverTimestamp()
      };

      await pedidoRefDoc.update({
        status: statusMap[pag.status] || pag.status,
        pagamento,
        cancelamento
      });

      if (pedido.cliente?.uid) {
        await db.collection("usuarios")
          .doc(pedido.cliente.uid)
          .update({ pedidoAtivo: FieldValue.delete() })
          .catch((err) => console.error("webhookMP: não foi possível limpar pedido ativo", err));
      }

      const numeroPedido = pedido.numeroPedido || pedidoId;

      if (pag.status === "approved" && pedido.status !== "pago") {
        enviarPushAdmins({
          title: "Pagamento confirmado",
          body: `Pedido #${numeroPedido} confirmado!`,
          url: `/admin/?pedido=${numeroPedido}`
        }).catch(err => console.error("Push falhou:", err));
      }

      return res.sendStatus(200);
    } catch (err) {
      console.error("Webhook error:", err);
      return res.sendStatus(500);
    }
  }
);

exports.obterPedido = onCall(async (request) => {
  const { pedidoId } = request.data;

  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "É preciso estar logado.");
  }

  if (!pedidoId) {
    throw new HttpsError("invalid-argument", "pedidoId obrigatório");
  }

  const pedidoSnap = await db.collection("pedidos").doc(pedidoId).get();

  if (!pedidoSnap.exists) {
    throw new HttpsError("not-found", "Pedido não encontrado");
  }

  const pedido = pedidoSnap.data();

  if (pedido.cliente?.uid !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Este pedido não pertence a este usuário.");
  }

  const rastreio = pedido.rastreio
    ? {
        status: pedido.rastreio.status || null,
        statusLabel: pedido.rastreio.statusLabel || null,
        codigo: pedido.rastreio.codigo || null,
        urlRastreio: pedido.rastreio.urlRastreio || null,
        atualizadoEm: pedido.rastreio.atualizadoEm?.toDate
          ? pedido.rastreio.atualizadoEm.toDate().toISOString()
          : null,
      }
    : null;

  return {
    numeroPedido: pedido.numeroPedido || pedidoId,
    itens: pedido.itens || [],
    pacoteNome: pedido.pacoteNome || null,
    total: pedido.total,
    status: pedido.status,
    email: pedido.cliente?.email || null,
    rastreio,
  };
});

exports.listarPedidos = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "É preciso estar logado.");
  }

  const snap = await db
    .collection("pedidos")
    .where("cliente.uid", "==", request.auth.uid)
    .orderBy("criadoEm", "desc")
    .get();

  const pedidos = snap.docs.map((doc) => {
    const p = doc.data();
    return {
      id: doc.id,
      numeroPedido: p.numeroPedido || doc.id,
      itens: p.itens || [],
      total: p.total,
      status: p.status,
      criadoEm: p.criadoEm?.toDate ? p.criadoEm.toDate().toISOString() : null,
    };
  });

  return { pedidos };
});

// A inscrição é concluída somente depois do login. O navegador não recebe
// permissão direta para alterar campos operacionais do perfil.
exports.inscreverNewsletter = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "É preciso estar logado.");
  }

  await db.collection("usuarios").doc(request.auth.uid).set(
    { newsletter: true },
    { merge: true }
  );

  return { inscrito: true };
});

async function verificarAdmin(uid) {
  if (!uid) {
    throw new HttpsError("unauthenticated", "É preciso estar logado.");
  }
  const snap = await db.collection("usuarios").doc(uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (role !== "admin" && role !== "dev") {
    throw new HttpsError("permission-denied", "Apenas administradores podem fazer isso.");
  }
}

function validarPedidoParaGerarEtiqueta(pedido) {
  if (pedido.status !== "pago") {
    throw new HttpsError(
      "failed-precondition",
      "A etiqueta só pode ser gerada depois da confirmação do pagamento do pedido."
    );
  }

  if (pedido.etiqueta?.cartItemId) {
    throw new HttpsError(
      "already-exists",
      "Este pedido já possui uma etiqueta gerada."
    );
  }
}

exports.gerarEtiquetaPedido = onCall({ secrets: ["MELHOR_ENVIO_CLIENT_SECRET"] }, async (request) => {
  await verificarAdmin(request.auth?.uid);

  const { pedidoId } = request.data;
  if (!pedidoId) {
    throw new HttpsError("invalid-argument", "pedidoId obrigatório");
  }

  const pedido = await getPedido(pedidoId);
  validarPedidoParaGerarEtiqueta(pedido);

  try {
    const etiqueta = await comprarEtiquetaMelhorEnvio(pedidoId, pedido);
    await pedidoRef(pedidoId).update({
      etiqueta: { ...etiqueta, geradaEm: FieldValue.serverTimestamp() },
      etiquetaErro: FieldValue.delete(),
    });
    return { sucesso: true, ...etiqueta };
  } catch (err) {
    console.error(`gerarEtiquetaPedido falhou (${pedidoId}):`, err);
    await pedidoRef(pedidoId)
      .update({ etiquetaErro: err.message || "erro desconhecido" })
      .catch(() => {});
    throw new HttpsError("internal", err.message || "Falha ao gerar etiqueta");
  }
});

exports.gerarEtiquetasEmLote = onCall({ secrets: ["MELHOR_ENVIO_CLIENT_SECRET"] }, async (request) => {
  await verificarAdmin(request.auth?.uid);

  const { pedidoIds } = request.data;
  if (!Array.isArray(pedidoIds) || pedidoIds.length === 0) {
    throw new HttpsError("invalid-argument", "pedidoIds deve ser uma lista com ao menos 1 item");
  }

  const resultados = [];

  for (const pedidoId of pedidoIds) {
    try {
      const pedido = await getPedido(pedidoId);
      validarPedidoParaGerarEtiqueta(pedido);
      const etiqueta = await comprarEtiquetaMelhorEnvio(pedidoId, pedido);
      await pedidoRef(pedidoId).update({
        etiqueta: { ...etiqueta, geradaEm: FieldValue.serverTimestamp() },
        etiquetaErro: FieldValue.delete(),
      });
      resultados.push({ pedidoId, sucesso: true, ...etiqueta });
    } catch (err) {
      console.error(`gerarEtiquetasEmLote falhou (${pedidoId}):`, err);
      if (err.code !== "failed-precondition" && err.code !== "already-exists") {
        await pedidoRef(pedidoId)
          .update({ etiquetaErro: err.message || "erro desconhecido" })
          .catch(() => {});
      }
      resultados.push({ pedidoId, sucesso: false, erro: err.message || "erro desconhecido" });
    }
  }

  return { resultados };
});
