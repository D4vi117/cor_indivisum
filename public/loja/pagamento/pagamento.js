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
	// Fluxo de pagamento InfinitePay
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

    // Esta loja usa InfinitePay para concluir o pagamento.
    if (els.btnInfinitePay) {
      els.btnInfinitePay.onclick = () => {
        showState(null);
        els.processing.hidden = false;
        acionarFallbackInfinitePay(pedidoId);
      };
    }

    els.loading.hidden = true;
    els.brick.hidden = true;
    els.infinitePayContainer.hidden = false;
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
 
async function acionarFallbackInfinitePay(pedidoId) {
	try {
		const processarInfinitePay = functions.httpsCallable("processarPagamentoInfinitePay");
		const { data } = await processarInfinitePay({ pedidoId });

		if (data?.paymentLink) {
			const paymentUrl = new URL(data.paymentLink);
			if (paymentUrl.protocol !== "https:") throw new Error("O link de pagamento recebido é inválido.");
			window.location.assign(paymentUrl.href);
		} else {
			mostrarRecusado("Não recebemos um link válido da InfinitePay. Tente novamente.");
		}
	} catch (err) {
		console.error("Erro no fallback do InfinitePay:", err);
		mostrarRecusado("Não foi possível gerar o link da InfinitePay. Tente novamente em instantes.");
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
