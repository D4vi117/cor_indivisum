function comprarDireto(produtoId) {
  const produto = todosProdutos.find(p => p.id === produtoId);
  if (!produto) return;

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

// Adiciona ao carrinho acumulativo e abre o Modal Drawer
function adicionarAoCarrinho(produtoId) {
  const produto = todosProdutos.find(p => p.id === produtoId);
  if (!produto) return;

  let carrinho = obterCarrinho();
  const index = carrinho.findIndex(item => item.id === produtoId);

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
  abrirModalCarrinho();
}