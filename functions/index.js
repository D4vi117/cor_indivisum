// 1. Importe o onRequest da v2 de HTTPS (firebase-functions)
const { onRequest } = require("firebase-functions/v2/https");

// 2. Importe e inicialize o Firebase Admin e o Firestore (para 'db' e 'FieldValue')
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// Inicializa o app do Firebase Admin
initializeApp();

// Instancia o banco de dados
const db = getFirestore();

const INFINITEPAY_HANDLE = "igor-tadeu-u08"



// Seus objetos de pacotes e itens (garanta que estejam definidos)
const PACOTES = {
  "maria-a-flauta-de-Deus": {
    nome: "Maria, a Flauta de Deus",
    valorCentavos: 6490,
    itens: ["livro-1"]
  }
};

const ITENS = {
  "livro-1": { nome: "Livro - Maria, a Flauta de Deus" }
};

// Exemplo de função mock para criar checkout (substitua pela sua lógica real)
async function criarCheckoutInfinitePay({
  orderId,
  email,
  pacote,
}) {
  const payload = {
    handle: INFINITEPAY_HANDLE,

    items: [
      {
        quantity: 1,

        price: pacote.valorCentavos,

        description: pacote.nome,
      },
    ],

    order_nsu: orderId,

    webhook_url:
      "https://southamerica-east1-levatelit.cloudfunctions.net/webhook",

    redirect_url:
      "https://corindivisum.com.br/pagamento/sucesso",

    customer: {
      email,
    },
  };

  const res = await fetch(
    "https://api.checkout.infinitepay.io/links",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const err = await res.text();

    throw new Error(
      `InfinitePay ${res.status}: ${err}`
    );
  }

  return res.json();
}
// ======================================================
// CHECKOUT
// ======================================================

exports.checkout = onRequest(
  {
    cors: true,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "POST");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      // 1. Extraia também telefone e endereco da requisição
      const { pacoteId, email, nome, telefone, endereco } = req.body ?? {};

      if (!email || !pacoteId) {
        return res.status(400).json({
          error: "email e pacoteId são obrigatórios",
        });
      }

      const pacote = PACOTES[pacoteId];
      if (!pacote) {
        return res.status(400).json({ error: "pacote não encontrado" });
      }

      const orderRef = db.collection("orders").doc();

      // 2. Salve todos os dados do cliente e do endereço no Firestore
      await orderRef.set({
        customerId: null,
        nome: nome || null,
        email: email.toLowerCase().trim(),
        telefone: telefone || null,
        endereco: endereco ? {
          cep: endereco.cep || null,
          rua: endereco.rua || null,
          numero: endereco.numero || null,
          complemento: endereco.complemento || null,
          bairro: endereco.bairro || null,
          cidade: endereco.cidade || null,
          estado: endereco.estado || null,
        } : null,
        pacoteId: String(pacoteId),
        pacoteNome: pacote.nome,
        valorCentavos: pacote.valorCentavos,
        status: "pending",
        criadoEm: FieldValue.serverTimestamp(),
        atualizadoEm: FieldValue.serverTimestamp(),
      });

      const checkout = await criarCheckoutInfinitePay({
        orderId: orderRef.id,
        email,
        pacote,
      });

      await orderRef.update({
        infinitepay: checkout,
        atualizadoEm: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({
        orderId: orderRef.id,
        paymentLink:
          checkout?.link ||
          checkout?.url ||
          checkout?.payment_link ||
          checkout?.checkout_url,
      });
    } catch (err) {
      console.error("checkout error:", err);
      return res.status(500).json({ error: "erro interno" });
    }
  }
);

// ======================================================
// WEBHOOK
// ======================================================

exports.webhook = onRequest(
  {
    cors: true,
  },

  async (req, res) => {

    if (req.method !== "POST") {
      return res
        .status(405)
        .send("Method Not Allowed");
    }

    try {

      const event = req.body;

      await db
        .collection("webhook_logs")
        .add({
          recebidoEm:
            FieldValue.serverTimestamp(),

          headers: req.headers,

          body: event,
        });

      console.log(
        "WEBHOOK:",
        JSON.stringify(event, null, 2)
      );

      const {
        order_nsu,
        transaction_nsu,
        amount,
        paid_amount,
        capture_method,
        receipt_url,
      } = event;

      if (!order_nsu) {
        return res
          .status(400)
          .send("missing order_nsu");
      }

      if (!receipt_url) {
        return res
          .status(400)
          .send("missing receipt_url");
      }

      const orderRef =
        db.collection("orders")
          .doc(order_nsu);

      // =====================================
      // ORDER
      // =====================================

      const orderSnap =
        await orderRef.get();

      if (!orderSnap.exists) {
        return res
          .status(404)
          .send("order not found");
      }

      const order =
        orderSnap.data();

      // idempotência
      if (order.status === "paid") {
        return res
          .status(200)
          .send("already paid");
      }

      const pacote =
        PACOTES[
          order.pacoteId
        ];

      if (!pacote) {
        return res
          .status(400)
          .send("invalid package");
      }

      // =====================================
      // UPDATE ORDER
      // =====================================

      await orderRef.update({

        status: "paid",

        atualizadoEm:
          FieldValue.serverTimestamp(),

        infinitepay: {
          ...event,

          validated: true,

          validatedAt:
            FieldValue.serverTimestamp(),
        },
      });

      // =====================================
      // PURCHASE
      // =====================================

      const purchaseRef =
        db.collection("purchases")
          .doc();

      await purchaseRef.set({

        customerId:
          order.customerId,

        orderId:
          order_nsu,

        email:
          order.email,

        pacoteId:
          order.pacoteId,

        pacoteNome:
          order.pacoteNome,

        itens:
          pacote.itens.map(
            (id) => ({
              id,
              ...ITENS[id],
            })
          ),

        criadoEm:
          FieldValue.serverTimestamp(),
      });

      // =====================================
      // LOG
      // =====================================

      await db
        .collection("payment_events")
        .add({

          customerId:
            order.customerId,

          tipo:
            "pagamento_confirmado",

          criadoEm:
            FieldValue.serverTimestamp(),

          payload: {
            order_nsu,
            transaction_nsu,
            amount,
            paid_amount,
            capture_method,
            receipt_url,
          },
        });

      return res
        .status(200)
        .send("ok");

    } catch (err) {

      console.error(
        "webhook",
        err
      );

      return res
        .status(500)
        .send("internal error");
    }
  }
);