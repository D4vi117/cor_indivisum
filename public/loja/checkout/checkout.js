/* ==========================================================================
   CHECKOUT SCRIPT
   ========================================================================== */

let carrinhoAtual = [];
let freteSelecionado = null; // { id, nome, transportadora, valor, prazo }
let consultaCepAtual = 0;
let consultaFreteAtual = 0;
let controladorCep = null;
let controladorFrete = null;


// Endpoint da function melhorEnvioCalcularFrete (mesmo padrão de URL usado
// no MELHOR_ENVIO_REDIRECT_URI do index.js). Ajuste se a região/projeto mudar.
const FRETE_ENDPOINT =
  "https://corindivisum.com.br/api/melhor-envio/calcular-frete";

// 1. Obter carrinho do LocalStorage
function obterCarrinho() {
  return JSON.parse(localStorage.getItem("carrinho_cor_indivisum")) || [];
}

// 2. Renderizar Resumo do Pedido na Lateral
function renderizarResumoPedido() {
  carrinhoAtual = obterCarrinho();

  const containerItens = document.querySelector(".cart-items");
  const subtotalEl = document.querySelectorAll(".summary-line span")[1];
  const freteEl = document.querySelectorAll(".summary-line span")[3];
  const totalEl = document.querySelector(".summary-total strong");

  if (!containerItens) return;

  // Se carrinho estiver vazio, redireciona para a loja
  if (carrinhoAtual.length === 0) {
    alert("Seu carrinho está vazio!");
    window.location.href = "/loja";
    return;
  }

  containerItens.innerHTML = "";
  let subtotal = 0;

  carrinhoAtual.forEach((item) => {
    const totalItem = item.preco * item.qtd;
    subtotal += totalItem;

    const divItem = document.createElement("div");
    divItem.className = "cart-item";
    divItem.innerHTML = `
      <div class="item-details">
        <h4>${item.nome}</h4>
        <span class="item-qty">Qtd: ${item.qtd}</span>
      </div>
      <div class="item-price">R$ ${totalItem.toFixed(2).replace('.', ',')}</div>
    `;
    containerItens.appendChild(divItem);
  });

  const valorFrete = freteSelecionado ? freteSelecionado.valor : 0;
  const totalFinal = subtotal + valorFrete;

  if (subtotalEl) subtotalEl.textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;

  if (freteEl) {
    freteEl.textContent = freteSelecionado
      ? `R$ ${valorFrete.toFixed(2).replace('.', ',')}`
      : "Selecione abaixo";
  }

  if (totalEl) totalEl.textContent = `R$ ${totalFinal.toFixed(2).replace('.', ',')}`;
}

// 3. Autopreenchimento de Endereço via CEP (ViaCEP API)
async function buscarCEP(cep) {
  const cepLimpo = cep.replace(/\D/g, "");
  const consultaAtual = ++consultaCepAtual;
  controladorCep?.abort();
  controladorFrete?.abort();
  controladorCep = new AbortController();
  controladorFrete = null;
  consultaFreteAtual++;
  freteSelecionado = null;
  atualizarEstadoBotaoCheckout();

  if (cepLimpo.length !== 8) {
    limparOpcoesFrete("Informe um CEP válido para calcular o frete.");
    return;
  }

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, {
      signal: controladorCep.signal,
    });
    const data = await res.json();

    if (consultaAtual !== consultaCepAtual) return;

    if (!data.erro) {
      document.getElementById("rua").value = data.logradouro || "";
      document.getElementById("bairro").value = data.bairro || "";
      document.getElementById("cidade").value = data.localidade || "";
      document.getElementById("estado").value = data.uf || "";
      document.getElementById("numero").focus();

      // CEP válido: já dispara o cálculo de frete
      calcularFrete(cepLimpo);
    } else {
      limparOpcoesFrete("CEP não encontrado. Confira e tente novamente.");
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error("Erro ao buscar CEP:", err);
    limparOpcoesFrete("Erro ao consultar o CEP.");
  } finally {
    if (consultaAtual === consultaCepAtual) controladorCep = null;
  }
}

// 3.1 Monta a lista de produtos no formato esperado pela function de frete
function montarProdutosParaFrete(carrinho) {
  return carrinho.map((item) => ({
    id: item.id,
    quantidade: item.qtd,
  }));
}

// 3.2 Chama a function melhorEnvioCalcularFrete e renderiza as opções
async function calcularFrete(cepDestino) {
  const container = document.getElementById("frete-opcoes");
  if (!container) return;

  const consultaAtual = ++consultaFreteAtual;
  controladorFrete?.abort();
  controladorFrete = new AbortController();

  carrinhoAtual = obterCarrinho();
  if (carrinhoAtual.length === 0) return;

  freteSelecionado = null;
  atualizarEstadoBotaoCheckout();

  container.classList.add("visible");
  container.innerHTML = `<p class="frete-status">Calculando opções de frete...</p>`;

  try {
    const produtos = montarProdutosParaFrete(carrinhoAtual);

    const res = await fetch(FRETE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controladorFrete.signal,
      body: JSON.stringify({
        cepDestino,
        produtos,
      }),
    });

    const data = await res.json();

    if (consultaAtual !== consultaFreteAtual) return;

    if (!res.ok || !Array.isArray(data.opcoes)) {
      limparOpcoesFrete("Não foi possível calcular o frete agora. Tente novamente.");
      return;
    }

    // Cada opção pode vir com "error" quando aquela transportadora falhou
    const opcoesValidas = data.opcoes.filter((o) => !o.error && o.price);

    if (opcoesValidas.length === 0) {
      limparOpcoesFrete("Nenhuma opção de frete disponível para este CEP.");
      return;
    }

    renderOpcoesFrete(opcoesValidas);
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error("Erro ao calcular frete:", err);
    limparOpcoesFrete("Erro ao calcular o frete. Tente novamente.");
  } finally {
    if (consultaAtual === consultaFreteAtual) controladorFrete = null;
  }
}

function limparOpcoesFrete(mensagem) {
  const container = document.getElementById("frete-opcoes");
  if (container) {
    container.classList.add("visible");
    container.innerHTML = `<p class="frete-status frete-erro">${mensagem}</p>`;
  }
  freteSelecionado = null;
  renderizarResumoPedido();
  atualizarEstadoBotaoCheckout();
}

// 3.3 Renderiza as opções de frete como itens selecionáveis
// 3.3 Renderiza as opções de frete como itens selecionáveis
function renderOpcoesFrete(opcoes) {
  const container = document.getElementById("frete-opcoes");

  // Traduz nomes internos do Melhor Envio para algo amigável
  function nomeAmigavel(op) {
    const transportadora = op.company?.name || "Transportadora";
    const nome = (op.name || "").toUpperCase();

    // Jadlog
    if (nome.includes(".PACKAGE")) {
      return "Jadlog Package";
    }

    if (nome.includes(".COM")) {
      return "Jadlog Com";
    }

    // Correios
    if (nome.includes("PAC")) return "PAC";
    if (nome.includes("SEDEX")) return "SEDEX";

    // Fallback: usa o nome da transportadora
    return `${transportadora} Entrega`;
  }

  container.innerHTML = `
    <p class="frete-titulo">Escolha o frete</p>
    ${opcoes
      .map((op, idx) => {
        const nomeServico = nomeAmigavel(op);
        const nomeTransportadora = op.company?.name || "";

        const prazo =
          op.delivery_time ??
          op.custom_delivery_time ??
          op.delivery_range?.max ??
          "-";

        const preco = Number(op.price).toFixed(2).replace(".", ",");

        return `
          <label class="frete-option" for="frete-${idx}" data-idx="${idx}">
            <input type="radio" id="frete-${idx}" name="frete" value="${idx}" ${idx === 0 ? "checked" : ""}>
            <span class="radio-custom"></span>

            <div class="frete-info">
              <strong>${nomeServico}</strong>
              <span>${nomeTransportadora ? nomeTransportadora + " · " : ""}até ${prazo} dia(s) útil(eis)</span>
            </div>

            <div class="frete-price">R$ ${preco}</div>
          </label>
        `;
      })
      .join("")}
  `;

  // Seleciona a primeira opção automaticamente
  selecionarFrete(opcoes, 0);

  container.querySelectorAll('input[name="frete"]').forEach((input) => {
    input.addEventListener("change", (e) => {
      selecionarFrete(opcoes, Number(e.target.value));
    });
  });
}

function selecionarFrete(opcoes, idx) {
  const op = opcoes[idx];
  if (!op) return;

  freteSelecionado = {
    id: op.id,
    nome: op.name,
    transportadora: op.company?.name || null,
    valor: Number(op.price),
    prazo: op.delivery_time ?? op.custom_delivery_time ?? op.delivery_range?.max ?? null,
  };

  // Destaca visualmente o label selecionado
  const container = document.getElementById("frete-opcoes");
  if (container) {
    container.querySelectorAll(".frete-option").forEach((label) => {
      label.classList.toggle("selected", Number(label.dataset.idx) === idx);
    });
  }

  renderizarResumoPedido();
  atualizarEstadoBotaoCheckout();
}

function atualizarEstadoBotaoCheckout() {
  const btn = document.querySelector(".btn-checkout");
  if (!btn) return;
  btn.disabled = !freteSelecionado;
}

// 4. Submissão do Form e Criação do Pedido
async function processarPedido(e) {
  e.preventDefault();

  if (!freteSelecionado) {
    alert("Selecione uma opção de frete antes de continuar.");
    return;
  }

  // Precisa estar logado: o backend (obterPedido) exige request.auth.uid
  // para liberar a visualização do pedido na página de pagamento, então
  // sem isso o cliente nunca consegue ver o próprio pedido depois.
  const user = firebase.auth().currentUser;
  if (!user) {
    alert("Você precisa estar logado para finalizar o pedido.");
    window.location.href = "/login?redirect=/loja/checkout";
    return;
  }

  const btnCheckout = document.querySelector(".btn-checkout");
  btnCheckout.disabled = true;
  btnCheckout.textContent = "Processando Pedido...";

  const nome = document.getElementById("nome").value.trim();
  const email = document.getElementById("email").value.trim();
  const telefone = document.getElementById("telefone").value.trim();
  const documento = document.getElementById("documento").value.trim().replace(/\D/g, "");

  if (!documento || (documento.length !== 11 && documento.length !== 14)) {
    alert("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.");
    btnCheckout.disabled = false;
    btnCheckout.textContent = "Finalizar e Pagar";
    return;
  }

  const endereco = {
    cep: document.getElementById("cep").value.trim(),
    estado: document.getElementById("estado").value.trim(),
    rua: document.getElementById("rua").value.trim(),
    numero: document.getElementById("numero").value.trim(),
    complemento: document.getElementById("complemento").value.trim(),
    bairro: document.getElementById("bairro").value.trim(),
    cidade: document.getElementById("cidade").value.trim()
  };

  try {
    const salvarEndereco = document.getElementById("salvar-endereco-checkbox")?.checked;
    const criarPedido = functions.httpsCallable("criarPedido");
    const { data } = await criarPedido({
      cliente: { nome, email, telefone, documento },
      endereco,
      itens: carrinhoAtual.map((item) => ({ id: item.id, qtd: item.qtd })),
      freteId: freteSelecionado.id,
      salvarEndereco: Boolean(salvarEndereco),
    });

    // Limpa o carrinho
    localStorage.removeItem("carrinho_cor_indivisum");

    // Redireciona para a página de pagamento
    window.location.href = `/loja/pagamento?id=${data.pedidoId}`;

  } catch (err) {
    console.error("Erro ao salvar pedido:", err);
    alert("Ocorreu um erro ao processar seu pedido. Tente novamente.");
    btnCheckout.disabled = false;
    btnCheckout.textContent = "Finalizar e Pagar";
  }
}

// 6. Endereços salvos — carrega, popula o seletor e preenche o form
let enderecosSalvos = []; // até 3 objetos de endereço

function preencherCamposEndereco(endereco) {
  const campos = ["cep", "estado", "rua", "numero", "complemento", "bairro", "cidade"];
  campos.forEach((campo) => {
    const input = document.getElementById(campo);
    if (input) input.value = endereco[campo] || "";
  });

  if (endereco.cep) {
    buscarCEP(endereco.cep);
  }
}

function limparCamposEndereco() {
  ["cep", "estado", "rua", "numero", "complemento", "bairro", "cidade"].forEach((campo) => {
    const input = document.getElementById(campo);
    if (input) input.value = "";
  });
}

function rotuloEndereco(endereco, idx) {
  if (endereco.rua) return `${endereco.rua}, ${endereco.numero || "s/n"}`;
  return `Endereço ${idx + 1}`;
}

function popularSeletorEnderecos() {
  const wrap = document.getElementById("enderecos-salvos-checkout");
  const select = document.getElementById("endereco-salvo-select");
  if (!wrap || !select) return;

  if (enderecosSalvos.length === 0) {
    wrap.style.display = "none";
    return;
  }

  select.innerHTML = `<option value="novo">Novo endereço</option>`;
  enderecosSalvos.forEach((end, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = rotuloEndereco(end, idx);
    select.appendChild(opt);
  });

  wrap.style.display = "block";

  select.onchange = () => {
    if (select.value === "novo") {
      limparCamposEndereco();
    } else {
      preencherCamposEndereco(enderecosSalvos[Number(select.value)]);
    }
  };

  // Um atalho vindo de "Minha conta" pode indicar qual endereço usar.
  const indiceSolicitado = Number(new URLSearchParams(window.location.search).get("endereco"));
  const indice = Number.isInteger(indiceSolicitado) && indiceSolicitado >= 0 && indiceSolicitado < enderecosSalvos.length
    ? indiceSolicitado
    : 0;
  select.value = String(indice);
  preencherCamposEndereco(enderecosSalvos[indice]);
}

// Preenche o formulário com dados já salvos do usuário (nome, email,
// telefone, documento e endereços). Nome/email/telefone só preenchem se
// o campo já não estiver preenchido — não sobrescreve o que a pessoa
// já digitou.
async function preencherDadosSalvos(user) {
  try {
    const snap = await db.collection("usuarios").doc(user.uid).get();
    if (!snap.exists) return;

    const dados = snap.data();

    const nomeInput = document.getElementById("nome");
    if (nomeInput && !nomeInput.value && dados.nome) nomeInput.value = dados.nome;

    const emailInput = document.getElementById("email");
    if (emailInput && !emailInput.value && (dados.email || user.email)) {
      emailInput.value = dados.email || user.email;
    }

    const telefoneInput = document.getElementById("telefone");
    if (telefoneInput && !telefoneInput.value && dados.telefone) telefoneInput.value = dados.telefone;

    const documentoInput = document.getElementById("documento");
    if (documentoInput && !documentoInput.value && dados.documento) documentoInput.value = dados.documento;

    enderecosSalvos = Array.isArray(dados.enderecos) ? dados.enderecos : [];
    popularSeletorEnderecos();
  } catch (err) {
    console.error("Erro ao preencher dados salvos:", err);
  }
}

// 7. Máscaras Simples de Entrada
function aplicarMascaras() {
  const inputCep = document.getElementById("cep");
  if (inputCep) {
    inputCep.addEventListener("blur", (e) => buscarCEP(e.target.value));
  }
}

// Inicialização
document.addEventListener("DOMContentLoaded", () => {
  renderizarResumoPedido();
  aplicarMascaras();
  atualizarEstadoBotaoCheckout();

  const form = document.getElementById("checkout-form");
  if (form) {
    form.addEventListener("submit", processarPedido);
  }

  firebase.auth().onAuthStateChanged((user) => {
    if (user) preencherDadosSalvos(user);
  });
});
