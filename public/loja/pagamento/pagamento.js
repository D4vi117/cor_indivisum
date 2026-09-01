const MP_PUBLIC_KEY = "APP_USR-4aa49daa-a0a9-4311-8b05-e77c2a27706c";
const PEDIDOS_COLLECTION = "pedidos";
const FUNCTIONS_REGION = "southamerica-east1";
// ------------------------------------------------------
// As regras do Firestore só deixam admin/dev lerem /pedidos
// diretamente — por isso o resumo do pedido é buscado pela
// function "obterPedido" (que confere se o pedido é do
// próprio usuário logado), e não com db.collection(...).get().
// ------------------------------------------------------
const $ = (id) => document.getElementById(id);

const els = {
	loading: $("pg-loading"),
	error: $("pg-error"),
	errorDetail: $("pg-error-detail"),
	retry: $("pg-retry"),
	brick: $("paymentBrick_container"),
	processing: $("pg-processing"),
	success: $("pg-success"),
	pix: $("pg-pix"),
	pixQr: $("pg-pix-qr"),
	pixCode: $("pg-pix-code"),
	pixCopyBtn: $("pg-pix-copy-btn"),
	rejected: $("pg-rejected"),
	rejectedDetail: $("pg-rejected-detail"),
	rejectedRetry: $("pg-rejected-retry"),
	summaryItem: $("pg-summary-item"),
	summaryTotal: $("pg-summary-total-value"),
	// Novos elementos do InfinitePay
	infinitePayContainer: $("pg-infinitepay-container"),
	btnInfinitePay: $("btn-infinitepay"),
};

function showState(name) {
	["loading", "error", "brick", "processing", "success", "pix", "rejected"].forEach((key) => {
		if (key === "brick") return;
		els[key].hidden = key !== name;
	});
	// Se houver transição para estado final, oculta também o botão alternativo do InfinitePay
	if (["processing", "success", "pix", "rejected", "error"].includes(name)) {
		if (els.infinitePayContainer) els.infinitePayContainer.hidden = true;
	}
}
 
function formatBRL(valor) {
	return Number(valor || 0).toLocaleString("pt-BR", {
		style: "currency",
		currency: "BRL",
	});
}
 
function getPedidoId() {
	const params = new URLSearchParams(window.location.search);
	return params.get("id");
}
 
async function iniciar() {
  const pedidoId = getPedidoId();

  if (!pedidoId) {
    mostrarErro("Link de pagamento inválido. Volte à loja e finalize o pedido novamente.");
    return;
  }

  try {
    // 0. Precisa estar logado
    await new Promise((resolve, reject) => {
      const unsubscribe = auth.onAuthStateChanged((user) => {
        unsubscribe();
        user ? resolve(user) : reject(new Error("not-signed-in"));
      });
    }).catch(() => {
      throw new Error("Você precisa estar logado para pagar este pedido.");
    });

    // 1. Busca os dados do pedido
    const obterPedido = functions.httpsCallable("obterPedido");
    const { data: pedido } = await obterPedido({ pedidoId });

    if (pedido.status === "pago") {
      mostrarSucesso();
      return;
    }

    renderResumo(pedido);

    // Configura o clique no botão do InfinitePay
    if (els.btnInfinitePay) {
      els.btnInfinitePay.onclick = () => {
        showState(null);
        els.processing.hidden = false;
        acionarFallbackInfinitePay(pedidoId, "Redirecionando...");
      };
    }

    // 2. Cria a preferência do Mercado Pago
    const criarPreferencia = functions.httpsCallable("criarPreferencia");
    const { data } = await criarPreferencia({ pedidoId });

    // 3. Inicializa o SDK e renderiza o Payment Brick
    const mp = new MercadoPago(MP_PUBLIC_KEY, { locale: "pt-BR" });
    const bricksBuilder = mp.bricks();

    await bricksBuilder.create("payment", "paymentBrick_container", {
      initialization: {
        amount: Number(pedido.total),
        preferenceId: data.preferenceId,
        payer: {
          email: pedido.email || undefined,
        },
      },
      customization: {
        visual: {
          style: {
            theme: "bootstrap",
          },
        },
        paymentMethods: {
          creditCard: "all",
          bankTransfer: "all",
          mercadoPago: "",
          maxInstallments: 3,
        },
      },
      callbacks: {
        onReady: () => {
          els.loading.hidden = false; // esconde spinner
          els.loading.hidden = true;
          // Exibe a opção manual do InfinitePay quando o Brick terminar de carregar
          if (els.infinitePayContainer) els.infinitePayContainer.hidden = false;
        },
        onError: (error) => {
          console.error("Payment Brick error:", error);
          mostrarErro("Não foi possível carregar as formas de pagamento. Tente novamente.");
        },
        onSubmit: ({ selectedPaymentMethod, formData }) => {
          console.log("Método selecionado:", selectedPaymentMethod);
          console.log("formData gerado:", formData);
          return processarPagamento(pedidoId, formData);
        },
      },
    });
  } catch (err) {
    console.error("Erro ao iniciar pagamento:", err);
    mostrarErro(err?.message || "Erro ao carregar o pagamento. Tente novamente.");
  }
}
 
function renderResumo(pedido) {
	const nomeItens =
		pedido.itens?.map((i) => i.nome).join(", ") || pedido.pacoteNome || "Seu pedido";
 
	els.summaryItem.innerHTML = `
		<p class="pg-summary-item-name">${nomeItens}</p>
		<p class="pg-summary-item-desc">Pedido #${pedido.numeroPedido || ""}</p>
	`;
	els.summaryTotal.textContent = formatBRL(pedido.total);
}
 
async function processarPagamento(pedidoId, formData) {
	showState(null);
	els.processing.hidden = false;
 
	try {
		const processPayment = functions.httpsCallable("process_payment");
		console.log("Enviando formData para process_payment:", formData);
		const { data } = await processPayment({ pedidoId, formData });
 
		els.processing.hidden = true;
 
		if (data.status === "approved") {
			mostrarSucesso();
			return;
		}
 
		if (data.pixQrCodeBase64) {
			mostrarPix(data);
			return;
		}
 
		if (data.status === "pending" || data.status === "in_process") {
			mostrarSucesso(
				"Pagamento em análise. Você receberá um e-mail assim que for confirmado."
			);
			return;
		}

		// Fallback para InfinitePay se o Mercado Pago recusar
		await acionarFallbackInfinitePay(pedidoId, data.statusDetail);
 
	} catch (err) {
		console.error("Erro no Mercado Pago, redirecionando para fallback...", err);
		// Fallback para InfinitePay em caso de exceção/erro do MP
		await acionarFallbackInfinitePay(pedidoId, err?.message);
	}
}

async function acionarFallbackInfinitePay(pedidoId, detalheErro) {
	try {
		const processarInfinitePay = functions.httpsCallable("processarPagamentoInfinitePay");
		const { data } = await processarInfinitePay({ pedidoId });

		if (data?.paymentLink) {
			// Redireciona diretamente para a tela de pagamento do InfinitePay
			window.location.href = data.paymentLink;
		} else {
			mostrarRecusado(detalheErro);
		}
	} catch (err) {
		console.error("Erro no fallback do InfinitePay:", err);
		mostrarRecusado(detalheErro || "Falha ao processar pagamento pelas vias disponíveis.");
	}
}
 
function mostrarErro(mensagem) {
	els.loading.hidden = true;
	els.brick.hidden = true;
	els.error.hidden = false;
	els.errorDetail.textContent = mensagem;
}
 
function mostrarSucesso(mensagemCustom) {
	els.brick.hidden = true;
	showState("success");
	if (mensagemCustom) {
		els.success.querySelector("p:not(.pg-state-title)").textContent = mensagemCustom;
	}
}
 
function mostrarPix(data) {
	els.brick.hidden = true;
	showState("pix");
	els.pixQr.src = `data:image/png;base64,${data.pixQrCodeBase64}`;
	els.pixCode.value = data.pixCopiaECola || "";
}
 
function mostrarRecusado(detalhe) {
	els.brick.hidden = true;
	showState("rejected");
	els.rejectedDetail.textContent =
		detalhe || "Tente novamente com outro cartão ou forma de pagamento.";
}
 
els.retry.addEventListener("click", () => window.location.reload());
els.rejectedRetry.addEventListener("click", () => window.location.reload());
 
els.pixCopyBtn.addEventListener("click", async () => {
	try {
		await navigator.clipboard.writeText(els.pixCode.value);
		els.pixCopyBtn.textContent = "Copiado!";
		setTimeout(() => (els.pixCopyBtn.textContent = "Copiar"), 2000);
	} catch {
		els.pixCode.select();
	}
});
 
document.addEventListener("DOMContentLoaded", iniciar);
