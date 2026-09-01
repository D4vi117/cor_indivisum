// ======================================================
// PEDIDO CONFIRMADO
// ------------------------------------------------------
// Fluxo:
// 1. Pega o ID do pedido da URL (?pedido=... ou ?id=...).
// 2. Espera o Firebase Auth resolver se há usuário logado.
//    - Sem login  -> mostra estadoSemLogin.
// 3. Chama a Cloud Function callable "obterPedido" (região
//    southamerica-east1, mesma do backend). Essa function já
//    garante no servidor que só o dono do pedido (request.auth.uid
//    === pedido.cliente.uid) recebe os dados — aqui no front só
//    tratamos os estados de carregando / sem login / erro / sucesso.
// 4. Renderiza os dados no mesmo estilo visual usado no Minha Conta.
// ======================================================

(function () {
	"use strict";

	const REGIAO_FUNCTIONS = "southamerica-east1";

	// ---------- referências dos estados na tela ----------
	const elCarregando = document.getElementById("estadoCarregando");
	const elSemLogin = document.getElementById("estadoSemLogin");
	const elErro = document.getElementById("estadoErro");
	const elErroMsg = document.getElementById("pcErroMsg");
	const elSucesso = document.getElementById("estadoSucesso");

	function mostrarEstado(el) {
		[elCarregando, elSemLogin, elErro, elSucesso].forEach((secao) => {
			secao.hidden = secao !== el;
		});
	}

	// ---------- pega o ID do pedido na URL ----------
	function getPedidoIdDaUrl() {
		const params = new URLSearchParams(window.location.search);
		return params.get("pedido") || params.get("id") || null;
	}

	// ---------- formata valores em reais ----------
	function formatarMoeda(valor) {
		const numero =
			typeof valor === "number"
				? valor
				: parseFloat(valor);

		if (Number.isNaN(numero)) return "R$ 0,00";

		// Aceita tanto valor em reais (ex: 64.90) quanto em centavos
		// (ex: 6490), já que pedidos antigos podem ter salvo de formas
		// diferentes. Se vier um inteiro "grande demais" pra ser reais,
		// assumimos centavos.
		const emReais = Number.isInteger(numero) && numero > 999 ? numero / 100 : numero;

		return emReais.toLocaleString("pt-BR", {
			style: "currency",
			currency: "BRL",
		});
	}

	const STATUS_LABEL = {
		pago: "Pago",
		entregue: "Entregue",
		aguardando_pagamento: "Aguardando pagamento",
		preparando: "Preparando",
		saiu: "Saiu para entrega",
		recusado: "Recusado",
		cancelado: "Cancelado",
		reembolsado: "Reembolsado",
	};

	function renderizarPedido(pedido) {
		document.getElementById("pcEmail").textContent = pedido.email || "seu e-mail";
		document.getElementById("pcNumeroPedido").textContent = "#" + (pedido.numeroPedido || "—");

		const statusEl = document.getElementById("pcStatus");
		const status = pedido.status || "aguardando_pagamento";
		statusEl.dataset.status = status;
		statusEl.textContent = STATUS_LABEL[status] || status;

		document.getElementById("pcTotal").textContent = formatarMoeda(pedido.total);

		const listaEl = document.getElementById("pcItensLista");
		listaEl.innerHTML = "";

		const itens = Array.isArray(pedido.itens) ? pedido.itens : [];

		if (itens.length === 0 && pedido.pacoteNome) {
			// Pedidos mais antigos podem só ter o nome do pacote, sem lista de itens.
			const linha = document.createElement("div");
			linha.className = "pc-item";
			linha.innerHTML = `<span>${escapeHtml(pedido.pacoteNome)}</span>`;
			listaEl.appendChild(linha);
		} else if (itens.length === 0) {
			const vazio = document.createElement("div");
			vazio.className = "pedidos-vazio";
			vazio.textContent = "Nenhum item encontrado para este pedido.";
			listaEl.appendChild(vazio);
		} else {
			itens.forEach((item) => {
				const nome =
					typeof item === "string"
						? item
						: item?.nome || item?.id || "Item";
				const quantidade = typeof item === "object" && item?.quantidade ? item.quantidade : null;

				const linha = document.createElement("div");
				linha.className = "pc-item";
				linha.innerHTML = `
					<span>${escapeHtml(nome)}</span>
					${quantidade ? `<span>x${escapeHtml(String(quantidade))}</span>` : ""}
				`;
				listaEl.appendChild(linha);
			});
		}

		renderizarRastreio(pedido.rastreio);

		mostrarEstado(elSucesso);
	}

	// ---------- card de rastreio ----------
	// Mapeia o status bruto (vindo do webhook do Melhor Envio) pro mesmo
	// estilo de badge usado no restante do site. "statusLabel" já vem
	// pronto do backend, mas mantemos um fallback aqui pra não depender
	// só dele.
	const RASTREIO_STATUS_BADGE = {
		generated: { texto: "Etiqueta gerada", badge: "preparando" },
		paid: { texto: "Etiqueta paga", badge: "preparando" },
		posted: { texto: "Postado", badge: "saiu" },
		delivered: { texto: "Entregue", badge: "entregue" },
		canceled: { texto: "Cancelado", badge: "cancelado" },
		expired: { texto: "Expirado", badge: "cancelado" },
	};

	function renderizarRastreio(rastreio) {
		const card = document.getElementById("pcRastreioCard");

		if (!rastreio || !rastreio.status) {
			card.hidden = true;
			return;
		}

		const statusEl = document.getElementById("pcRastreioStatus");
		const codigoEl = document.getElementById("pcRastreioCodigo");
		const codigoWrapper = document.getElementById("pcRastreioCodigoWrapper");
		const linkEl = document.getElementById("pcRastreioLink");
		const notaEl = document.getElementById("pcRastreioNota");

		const info = RASTREIO_STATUS_BADGE[rastreio.status] || null;

		statusEl.dataset.status = info?.badge || "";
		statusEl.textContent = rastreio.statusLabel || info?.texto || rastreio.status;

		// Exibe o código de rastreio se ele existir no objeto do pedido/rastreio
		if (rastreio.codigo) {
			codigoEl.textContent = rastreio.codigo;
			codigoWrapper.hidden = false;
		} else {
			codigoWrapper.hidden = true;
		}

		// Define a URL do rastreio detalhado e exibe o link se disponível
		if (rastreio.urlRastreio) {
			linkEl.href = rastreio.urlRastreio;
			linkEl.hidden = false;
			notaEl.hidden = true;
		} else {
			linkEl.hidden = true;
			notaEl.hidden = false;
		}

		card.hidden = false;
	}

	function escapeHtml(str) {
		const div = document.createElement("div");
		div.textContent = str;
		return div.innerHTML;
	}

	function mostrarErro(mensagem) {
		elErroMsg.textContent =
			mensagem || 'Verifique o link ou acesse a aba "Pedidos" na sua conta.';
		mostrarEstado(elErro);
	}

	// ---------- fluxo principal ----------
	async function iniciar() {
		const pedidoId = getPedidoIdDaUrl();

		if (!pedidoId) {
			mostrarErro("Nenhum pedido foi indicado neste link.");
			return;
		}

		// Espera o Firebase Auth informar o estado de login (evita "piscar"
		// a tela de login antes do SDK terminar de checar o token salvo).
		firebase.auth().onAuthStateChanged(async (usuario) => {
			if (!usuario) {
				mostrarEstado(elSemLogin);
				return;
			}

			mostrarEstado(elCarregando);

			try {
				const obterPedido = firebase
					.app()
					.functions(REGIAO_FUNCTIONS)
					.httpsCallable("obterPedido");

				const resposta = await obterPedido({ pedidoId });
				renderizarPedido(resposta.data);
			} catch (erro) {
				console.error("Erro ao carregar pedido:", erro);

				if (erro?.code === "functions/unauthenticated") {
					mostrarEstado(elSemLogin);
					return;
				}

				if (erro?.code === "functions/permission-denied") {
					mostrarErro("Este pedido não pertence à conta com a qual você está logado.");
					return;
				}

				if (erro?.code === "functions/not-found") {
					mostrarErro("Não encontramos nenhum pedido com este número.");
					return;
				}

				mostrarErro("Não foi possível carregar os detalhes do pedido agora. Tente novamente em instantes.");
			}
		});
	}

	iniciar();
})();