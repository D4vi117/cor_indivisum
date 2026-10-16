/* ==========================================================================
   CHECKOUT UTILS - SUPORTE A PÁGINAS DE PRODUTO ÚNICO E LISTAGENS
   ========================================================================== */
function extrairDadosPreco(p) {
  let precoOriginal = 0;
  let precoPromocional = 0;
  let emOfertaFlag = false;

  // 1. Tenta extrair da estrutura nova
  if (p.precos && typeof p.precos === "object") {
    precoOriginal = Number(p.precos.de) || 0;
    precoPromocional = Number(p.precos.por) || 0;
    emOfertaFlag = p.precos.emOferta === true || p.precos.emOferta === "true";
  } else {
    // 2. Fallback para estrutura antiga
    precoOriginal = Number(p.preco) || 0;
    precoPromocional = Number(p.precoPromocional) || 0;
    emOfertaFlag = precoPromocional > 0 && precoPromocional < precoOriginal;
  }

  // Define se realmente tem desconto válido a ser exibido
  const temDesconto = emOfertaFlag && precoPromocional > 0 && precoPromocional < precoOriginal;
  const precoFinal = temDesconto ? precoPromocional : (precoOriginal > 0 ? precoOriginal : precoPromocional);

  return {
    precoOriginal,
    precoPromocional,
    precoFinal,
    temDesconto
  };
}
function salvarCarrinho(carrinho) {
  localStorage.setItem("carrinho_cor_indivisum", JSON.stringify(carrinho));
}

// Helper para buscar o produto de forma inteligente (da memória ou do Firestore)
async function obterProdutoPorId(produtoId) {
  // 1. Se a variável global 'todosProdutos' existir e tiver o produto, usa ela
  if (typeof todosProdutos !== "undefined" && Array.isArray(todosProdutos) && todosProdutos.length > 0) {
    const produto = todosProdutos.find(p => p.id === produtoId);
    if (produto) return produto;
  }

  // 2. Se não estiver na lista global (ex: página de produto único), busca direto no Firestore
  if (typeof db !== "undefined") {
    try {
      const docRef = await db.collection("produtos").doc(produtoId).get();
      if (docRef.exists) {
        return { id: docRef.id, ...docRef.data() };
      }
    } catch (err) {
      console.error("Erro ao buscar produto específico:", err);
    }
  }

  return null;
}

async function comprarDireto(produtoId) {
  const produto = await obterProdutoPorId(produtoId);
  if (!produto) {
    window.alert("Produto: " + produtoId + " não encontrado. Por favor, tente novamente.");
    return;
  };

  const ignoraEstoque = produto.status?.preVenda === true &&
    produto.status?.preVendaIgnoraEstoque === true;
  if (!ignoraEstoque && (Number(produto.estoque?.quantidade) || 0) < 1) {
    window.alert("Este produto está esgotado no momento.");
    return;
  }

  const { precoFinal } = extrairDadosPreco(produto);
  const foto = produto.midias?.fotoPrincipal || produto.fotoPrincipal || "";

  const itemUnico = [{
    id: produto.id,
    nome: produto.nome,
    preco: precoFinal,
    foto: foto,
    slug: produto.slug || "",
    qtd: 1
  }];

  salvarCarrinho(itemUnico);
  window.location.href = "/loja/checkout";
}

// Adiciona ao carrinho acumulativo. Em páginas sem drawer, confirma com alert.
async function adicionarAoCarrinho(produtoId) {
  const produto = await obterProdutoPorId(produtoId);
  if (!produto) {
    window.alert("Não foi possível encontrar este produto. Tente novamente.");
    return;
  }

  let carrinho = obterCarrinho();
  const index = carrinho.findIndex(item => item.id === produtoId);
  const estoque = Number(produto.estoque?.quantidade) || 0;
  const quantidadeAtual = index > -1 ? Number(carrinho[index].qtd) || 0 : 0;
  const ignoraEstoque = produto.status?.preVenda === true &&
    produto.status?.preVendaIgnoraEstoque === true;
  if (!ignoraEstoque && estoque <= quantidadeAtual) {
    window.alert(estoque > 0 ? `Há apenas ${estoque} unidade(s) disponíveis.` : "Este produto está esgotado no momento.");
    return;
  }

  const { precoFinal } = extrairDadosPreco(produto);
  const foto = produto.midias?.fotoPrincipal || produto.fotoPrincipal || "";

  if (index > -1) {
    carrinho[index].qtd += 1;
  } else {
    carrinho.push({
      id: produto.id,
      nome: produto.nome,
      preco: precoFinal,
      foto: foto,
      slug: produto.slug || "",
      qtd: 1
    });
  }

  salvarCarrinho(carrinho);

  if (typeof abrirModalCarrinho === "function" && document.getElementById("carrinho-modal")) {
    abrirModalCarrinho();
    return;
  }

  window.alert(`${produto.nome} foi adicionado ao carrinho.`);
}
