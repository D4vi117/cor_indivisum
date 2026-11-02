let produtoId = null;
let galeriaImagens = [];
let opcoesVariacaoEditor = [];
let variacoesEditor = [];

function serializarAtributos(atributos) {
  return JSON.stringify(Object.entries(atributos || {}).sort(([nomeA], [nomeB]) => nomeA.localeCompare(nomeB, "pt-BR")));
}

function idVariacao(assinatura) {
  let hash = 2166136261;
  for (let i = 0; i < assinatura.length; i++) {
    hash ^= assinatura.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `var_${(hash >>> 0).toString(36)}`;
}

function combinacoesVariacao(opcoes) {
  return opcoes.reduce((combinacoes, opcao) => {
    const novas = [];
    for (const combinacao of combinacoes) {
      for (const valor of opcao.valores) {
        novas.push({ ...combinacao, [opcao.nome]: valor });
        if (novas.length > 100) return novas;
      }
    }
    return novas;
  }, [{}]);
}

function coletarOpcoesVariacaoDaTela() {
  return Array.from(document.querySelectorAll(".atributo-variacao-linha")).map((row) => ({
    nome: row.querySelector("[data-atributo-nome]").value.trim(),
    valores: [...new Set(row.querySelector("[data-atributo-valores]").value.split(",").map((v) => v.trim()).filter(Boolean))],
  }));
}

function renderizarTabelaVariacoes() {
  const tbody = document.getElementById("variacoes-tabela-corpo");
  const resumo = document.getElementById("variacoes-resumo");
  if (!tbody) return;

  if (!opcoesVariacaoEditor.length) {
    variacoesEditor = [];
    tbody.innerHTML = '<tr><td colspan="4" class="editor-help">Adicione atributos para montar as combinações.</td></tr>';
    if (resumo) resumo.textContent = "Sem atributos, será usado o preço e estoque principais.";
    return;
  }

  const opcoesValidas = opcoesVariacaoEditor.filter((opcao) => opcao.nome && opcao.valores.length);
  if (opcoesValidas.length !== opcoesVariacaoEditor.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="editor-help">Preencha o nome e a lista de valores de cada atributo para gerar as combinações.</td></tr>';
    if (resumo) resumo.textContent = "Complete todos os atributos.";
    return;
  }
  const nomesNormalizados = opcoesValidas.map((opcao) => opcao.nome.toLocaleLowerCase("pt-BR"));
  if (new Set(nomesNormalizados).size !== nomesNormalizados.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="editor-help">Cada atributo precisa ter um nome diferente.</td></tr>';
    if (resumo) resumo.textContent = "Há nomes de atributos repetidos.";
    return;
  }

  const combinacoes = combinacoesVariacao(opcoesValidas);
  const existentes = new Map(variacoesEditor.map((variacao) => [serializarAtributos(variacao.atributos), variacao]));
  variacoesEditor = combinacoes.map((atributos) => {
    const assinatura = serializarAtributos(atributos);
    return existentes.get(assinatura) || { id: idVariacao(assinatura), atributos, sku: "", preco: null, estoque: 0 };
  });

  if (resumo) {
    const formula = opcoesValidas.map((opcao) => `${opcao.nome} (${opcao.valores.length})`).join(" × ");
    resumo.textContent = combinacoes.length > 100
      ? `${formula}: mais de 100 combinações. Reduza as opções.`
      : `${formula} = ${combinacoes.length} combinação(ões)`;
  }
  tbody.replaceChildren(...variacoesEditor.slice(0, 100).map((variacao) => {
    const row = document.createElement("tr");
    const descricao = document.createElement("th");
    descricao.scope = "row";
    descricao.textContent = Object.entries(variacao.atributos).map(([nome, valor]) => `${nome}: ${valor}`).join(" · ");

    const skuCell = document.createElement("td");
    const sku = document.createElement("input");
    sku.type = "text";
    sku.maxLength = 80;
    sku.value = variacao.sku || "";
    sku.setAttribute("aria-label", `SKU da variação ${descricao.textContent}`);
    sku.addEventListener("input", () => { variacao.sku = sku.value.trim(); });
    skuCell.appendChild(sku);

    const priceCell = document.createElement("td");
    const price = document.createElement("input");
    price.type = "number";
    price.min = "0.01";
    price.step = "0.01";
    price.placeholder = "Preço principal";
    price.value = variacao.preco ?? "";
    price.setAttribute("aria-label", `Preço da variação ${descricao.textContent}`);
    price.addEventListener("input", () => { variacao.preco = price.value === "" ? null : Number(price.value); });
    priceCell.appendChild(price);

    const stockCell = document.createElement("td");
    const stock = document.createElement("input");
    stock.type = "number";
    stock.min = "0";
    stock.step = "1";
    stock.value = variacao.estoque ?? 0;
    stock.setAttribute("aria-label", `Estoque da variação ${descricao.textContent}`);
    stock.addEventListener("input", () => { variacao.estoque = Math.max(0, Math.floor(Number(stock.value) || 0)); });
    stockCell.appendChild(stock);
    row.append(descricao, skuCell, priceCell, stockCell);
    return row;
  }));
}

function renderizarOpcoesVariacao() {
  const container = document.getElementById("atributos-variacao");
  if (!container) return;
  container.replaceChildren(...opcoesVariacaoEditor.map((opcao, index) => {
    const row = document.createElement("div");
    row.className = "atributo-variacao-linha";
    const title = document.createElement("strong");
    title.className = "atributo-variacao-titulo";
    title.textContent = `Atributo ${index + 1}`;
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Nome do atributo";
    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 40;
    name.placeholder = "Ex.: Tamanho";
    name.value = opcao.nome;
    name.dataset.atributoNome = "";
    name.addEventListener("input", () => {
      opcoesVariacaoEditor = coletarOpcoesVariacaoDaTela();
      renderizarTabelaVariacoes();
    });
    nameLabel.appendChild(name);

    const valuesLabel = document.createElement("label");
    valuesLabel.textContent = "Opções deste atributo (separadas por vírgula)";
    const values = document.createElement("input");
    values.type = "text";
    values.maxLength = 500;
    values.placeholder = "Ex.: P, M, G";
    values.value = opcao.valores.join(", ");
    values.dataset.atributoValores = "";
    values.addEventListener("input", () => {
      opcoesVariacaoEditor = coletarOpcoesVariacaoDaTela();
      renderizarTabelaVariacoes();
    });
    valuesLabel.appendChild(values);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-secundario btn-remover-atributo";
    remove.textContent = "Remover";
    remove.addEventListener("click", () => {
      opcoesVariacaoEditor = coletarOpcoesVariacaoDaTela();
      opcoesVariacaoEditor.splice(index, 1);
      renderizarOpcoesVariacao();
      renderizarTabelaVariacoes();
    });
    row.append(title, nameLabel, valuesLabel, remove);
    return row;
  }));
}

function atualizarCamposTipoProduto() {
  const ehLivro = document.getElementById("field-tipo")?.value === "livro";
  const secao = document.getElementById("secao-dados-livro");
  if (secao) secao.hidden = !ehLivro;
}

function formatarData(ts) {
  if (!ts) return "-";
  const data = ts.toDate ? ts.toDate() : new Date(ts);
  return data.toLocaleString("pt-BR");
}

function obterIdUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function initWYSIWYG() {
  const toolbar = document.querySelector(".wysiwyg-toolbar");
  if (!toolbar) return;
  toolbar.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmd = btn.dataset.cmd;
      const param = btn.dataset.param || null;
      document.execCommand(cmd, false, param);
    });
  });
}

function atualizarSeoPreview() {
  const nome = document.getElementById("field-nome")?.value || "";
  const slug = document.getElementById("field-slug")?.value || "";
  const seoTitulo = document.getElementById("field-seoTitulo")?.value || "";
  const seoDescricao = document.getElementById("field-seoDescricao")?.value || "";

  const elTitle = document.getElementById("seo-preview-title");
  const elUrl = document.getElementById("seo-preview-url");
  const elDesc = document.getElementById("seo-preview-desc");

  if (elTitle) elTitle.textContent = seoTitulo || nome || "Título Exemplo no Google";
  if (elUrl) elUrl.textContent = `https://corindivisum.com.br/loja/p/${slug || "slug-produto"}`;
  if (elDesc) elDesc.textContent = seoDescricao || "Descrição de exibição nos resultados de pesquisa do Google.";
}

function gerarHeadHTML() {
  const nome = document.getElementById("field-nome")?.value.trim() || "";
  const slug = document.getElementById("field-slug")?.value.trim() || "";
  const seoTitulo = document.getElementById("field-seoTitulo")?.value.trim() || "";
  const seoDescricao = document.getElementById("field-seoDescricao")?.value.trim() || "";
  const seoKeywords = document.getElementById("field-seoKeywords")?.value.trim() || "";
  const preco = Number(document.getElementById("field-preco")?.value) || 0;
  
  const previewContainer = document.getElementById("preview-principal-container");
  const fotoPrincipal = (previewContainer && previewContainer.hidden)
    ? ""
    : (document.getElementById("preview-foto-principal")?.src || "");

  const urlPublica = `${window.location.origin}/loja/p/${slug || "nome-do-produto"}`;
  const tituloFinal = seoTitulo || nome || "Produto · Cor Indivisum";
  const descFinal = seoDescricao || "Confira todos os detalhes do nosso produto.";

  const code = `<!-- SEO Básicas -->
<title>${tituloFinal}</title>
<meta name="description" content="${descFinal}">
${seoKeywords ? `<meta name="keywords" content="${seoKeywords}">\n` : ""}<link rel="canonical" href="${urlPublica}">

<!-- Open Graph / WhatsApp / Facebook -->
<meta property="og:type" content="product">
<meta property="og:title" content="${tituloFinal}">
<meta property="og:description" content="${descFinal}">
<meta property="og:url" content="${urlPublica}">
${fotoPrincipal ? `<meta property="og:image" content="${fotoPrincipal}">` : `<!-- <meta property="og:image" content="URL_DA_IMAGEM"> -->`}
<meta property="product:price:amount" content="${preco.toFixed(2)}">
<meta property="product:price:currency" content="BRL">

<!-- Twitter Cards -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${tituloFinal}">
<meta name="twitter:description" content="${descFinal}">`;

  const headCodeEl = document.getElementById("field-headCode");
  if (headCodeEl) headCodeEl.value = code;
}

function atualizarSidebar(dados = {}) {
  const preco = Number(document.getElementById("field-preco")?.value) || 0;
  const ativo = document.getElementById("field-ativo")?.checked || false;
  const publicado = document.getElementById("field-publicado")?.checked || false;
  const fotoPrincipal = document.getElementById("preview-foto-principal")?.src || "";

  const sbPreco = document.getElementById("sidebar-preco");
  if (sbPreco) sbPreco.textContent = `R$ ${preco.toFixed(2).replace('.', ',')}`;
  
  let statusStr = "Inativo";
  let statusChave = "off";
  if (ativo && publicado) { statusStr = "Ativo & Publicado"; statusChave = "ok"; }
  else if (ativo || publicado) { statusStr = ativo ? "Ativo (Rascunho)" : "Publicado (Inativo)"; statusChave = "partial"; }
  
  const sbStatus = document.getElementById("sidebar-status");
  if (sbStatus) {
    sbStatus.textContent = statusStr;
    sbStatus.dataset.status = statusChave;
  }

  const previewContainer = document.getElementById("preview-principal-container");
  const sbImg = document.getElementById("sidebar-preview-img");
  if (sbImg && fotoPrincipal && (!previewContainer || !previewContainer.hidden)) {
    const caminho = fotoPrincipal.includes('/p/')
      ? fotoPrincipal.substring(fotoPrincipal.indexOf('/p/'))
      : fotoPrincipal;

    sbImg.src = `/loja${caminho}`;
  }

  const meta = dados.meta || {};
  const sbCriado = document.getElementById("sidebar-criadoEm");
  const sbEditado = document.getElementById("sidebar-editadoEm");

  if (sbCriado && meta.criadoEm) sbCriado.textContent = formatarData(meta.criadoEm);
  if (sbEditado && meta.editadoEm) sbEditado.textContent = formatarData(meta.editadoEm);

  const slug = document.getElementById("field-slug")?.value || "";
  const urlPublica = `${window.location.origin}/loja/p/${slug}`;
  const btnVerPublico = document.getElementById("btn-ver-publico");
  if (btnVerPublico) btnVerPublico.href = urlPublica;
}

function renderizarGaleria() {
  const container = document.getElementById("galeria-container");
  if (!container) return; // Proteção contra elemento nulo

  container.innerHTML = "";

  galeriaImagens.forEach((url, idx) => {
    const item = document.createElement("div");
    item.className = "galeria-item";
    item.innerHTML = `
      <img src="${url}" alt="Foto ${idx + 1}">
      <div class="galeria-item-actions">
        <button type="button" class="btn-definir-principal" title="Tornar Foto Principal">&#9733;</button>
        <button type="button" class="btn-remover-galeria" title="Remover">&times;</button>
      </div>
    `;

    item.querySelector(".btn-definir-principal").onclick = () => {
      const previewImg = document.getElementById("preview-foto-principal");
      const previewContainer = document.getElementById("preview-principal-container");
      if (previewImg) previewImg.src = url;
      if (previewContainer) previewContainer.hidden = false;
      atualizarSidebar();
      gerarHeadHTML();
    };

    item.querySelector(".btn-remover-galeria").onclick = () => {
      galeriaImagens.splice(idx, 1);
      renderizarGaleria();
    };

    container.appendChild(item);
  });
}

function definirValorSeExiste(id, valor) {
  const el = document.getElementById(id);
  if (el) el.value = valor !== undefined && valor !== null ? valor : "";
}

function definirCheckedSeExiste(id, valor) {
  const el = document.getElementById(id);
  if (el) el.checked = Boolean(valor);
}

async function carregarProduto() {
  produtoId = obterIdUrl();
  if (!produtoId) {
    alert("Produto não especificado.");
    window.location.href = "/admin";
    return;
  }

  try {
    const doc = await db.collection("produtos").doc(produtoId).get();
    if (!doc.exists) {
      alert("Produto não encontrado.");
      window.location.href = "/admin";
      return;
    }

    const data = doc.data() || {};

    const precos = data.precos || {};
    const estoque = data.estoque || {};
    const dimensoes = data.dimensoesEmbalagem || {};
    const status = data.status || {};
    const conteudo = data.conteudo || {};
    const fichaTecnica = data.fichaTecnica || {};
    const seo = data.seo || {};
    const midias = data.midias || {};

    // Preenchimento seguro dos campos
    definirValorSeExiste("field-nome", data.nome);
    definirValorSeExiste("field-tipo", data.tipo);
    definirValorSeExiste("field-slug", data.slug);
    definirValorSeExiste("field-categoria", data.categoria);
    definirValorSeExiste("field-isbn", fichaTecnica.isbn);
    definirValorSeExiste("field-autor", fichaTecnica.autor);
    definirValorSeExiste("field-editora", fichaTecnica.editora);
    definirValorSeExiste("field-numero-paginas", fichaTecnica.numeroPaginas);
    opcoesVariacaoEditor = Array.isArray(data.opcoesVariacao) ? data.opcoesVariacao.map((opcao) => ({
      nome: typeof opcao?.nome === "string" ? opcao.nome : "",
      valores: Array.isArray(opcao?.valores) ? opcao.valores.filter((valor) => typeof valor === "string") : [],
    })) : [];
    variacoesEditor = Array.isArray(data.variacoes) ? data.variacoes.map((variacao) => ({
      id: typeof variacao?.id === "string" ? variacao.id : "",
      atributos: variacao?.atributos && typeof variacao.atributos === "object" ? variacao.atributos : {},
      sku: typeof variacao?.sku === "string" ? variacao.sku : "",
      preco: variacao?.preco == null || variacao.preco === "" ? null : Number(variacao.preco),
      estoque: Math.max(0, Math.floor(Number(variacao?.estoque) || 0)),
    })) : [];
    atualizarCamposTipoProduto();
    renderizarOpcoesVariacao();
    renderizarTabelaVariacoes();

    definirValorSeExiste("field-preco", precos.de !== undefined ? precos.de : 0);
    definirValorSeExiste("field-precoPromocional", precos.emOferta ? (precos.por || 0) : 0);
    definirValorSeExiste("field-estoque", estoque.quantidade !== undefined ? estoque.quantidade : 0);

    definirValorSeExiste("field-peso", dimensoes.pesoKg !== undefined ? dimensoes.pesoKg : 0);
    definirValorSeExiste("field-altura", dimensoes.alturaCm !== undefined ? dimensoes.alturaCm : 0);
    definirValorSeExiste("field-largura", dimensoes.larguraCm !== undefined ? dimensoes.larguraCm : 0);
    definirValorSeExiste("field-comprimento", dimensoes.comprimentoCm !== undefined ? dimensoes.comprimentoCm : 0);

    definirCheckedSeExiste("field-ativo", status.ativo);
    definirCheckedSeExiste("field-publicado", status.publicado);
    definirCheckedSeExiste("field-destaque", status.destaque);
    definirCheckedSeExiste("field-pre-venda", status.preVenda);
    definirCheckedSeExiste("field-pre-venda-ignorar-estoque", status.preVendaIgnoraEstoque);
    atualizarControleIgnorarEstoque();

    definirValorSeExiste("field-descricaoCurta", conteudo.descricaoCurta);
    
    const editorHtml = document.getElementById("editor-html-content");
    if (editorHtml) editorHtml.innerHTML = conteudo.descricaoHTML || "";
    
    definirValorSeExiste("field-infoAdicionais", conteudo.infoAdicionais);

    definirValorSeExiste("field-seoTitulo", seo.titulo);
    definirValorSeExiste("field-seoDescricao", seo.descricao);
    definirValorSeExiste("field-seoKeywords", seo.keywords);

    const previewImg = document.getElementById("preview-foto-principal");
    const previewContainer = document.getElementById("preview-principal-container");

    if (midias.fotoPrincipal) {
      if (previewImg) previewImg.src = midias.fotoPrincipal;
      if (previewContainer) previewContainer.hidden = false;
    } else {
      if (previewImg) previewImg.src = "";
      if (previewContainer) previewContainer.hidden = true;
    }

    galeriaImagens = Array.isArray(midias.galeria) ? midias.galeria : [];
    renderizarGaleria();

    atualizarSeoPreview();
    gerarHeadHTML();
    atualizarSidebar(data);

  } catch (err) {
    console.error("Erro ao carregar produto:", err);
    alert("Erro ao carregar dados do produto.");
  }
}

function obterObjetoProduto() {
  const previewContainer = document.getElementById("preview-principal-container");
  const previewImg = document.getElementById("preview-foto-principal");
  
  let fotoPrincipalSrc = "";
  if (previewContainer && !previewContainer.hidden && previewImg) {
    // Pega o caminho relativo customizado ou o atributo src formatado
    fotoPrincipalSrc = previewImg.dataset.caminhoRelativo || previewImg.getAttribute("src") || "";
  }

  const precoBase = Number(document.getElementById("field-preco")?.value) || 0;
  const precoPromo = Number(document.getElementById("field-precoPromocional")?.value) || 0;
  const qtdEstoque = Number(document.getElementById("field-estoque")?.value) || 0;

  return {
    nome: (document.getElementById("field-nome")?.value || "").trim(),
    tipo: document.getElementById("field-tipo")?.value || "",
    slug: (document.getElementById("field-slug")?.value || "").trim(),
    categoria: (document.getElementById("field-categoria")?.value || "").trim(),
    fichaTecnica: {
      isbn: (document.getElementById("field-isbn")?.value || "").trim(),
      autor: (document.getElementById("field-autor")?.value || "").trim(),
      editora: (document.getElementById("field-editora")?.value || "").trim(),
      numeroPaginas: document.getElementById("field-numero-paginas")?.value
        ? Number(document.getElementById("field-numero-paginas").value) : null,
    },
    opcoesVariacao: opcoesVariacaoEditor,
    variacoes: variacoesEditor,
    meta: {
      editadoEm: firebase.firestore.FieldValue.serverTimestamp()
    },
    precos: {
      de: precoBase,
      por: precoPromo > 0 ? precoPromo : precoBase,
      emOferta: precoPromo > 0 && precoPromo < precoBase
    },
    estoque: {
      quantidade: qtdEstoque,
      disponivel: qtdEstoque > 0
    },
    dimensoesEmbalagem: {
      pesoKg: Number(document.getElementById("field-peso")?.value) || 0,
      alturaCm: Number(document.getElementById("field-altura")?.value) || 0,
      larguraCm: Number(document.getElementById("field-largura")?.value) || 0,
      comprimentoCm: Number(document.getElementById("field-comprimento")?.value) || 0
    },
    status: {
      ativo: document.getElementById("field-ativo")?.checked || false,
      publicado: document.getElementById("field-publicado")?.checked || false,
      destaque: document.getElementById("field-destaque")?.checked || false,
      preVenda: document.getElementById("field-pre-venda")?.checked || false,
      preVendaIgnoraEstoque: document.getElementById("field-pre-venda")?.checked === true &&
        document.getElementById("field-pre-venda-ignorar-estoque")?.checked === true
    },
    midias: {
      fotoPrincipal: fotoPrincipalSrc,
      galeria: galeriaImagens
    },
    conteudo: {
      descricaoCurta: (document.getElementById("field-descricaoCurta")?.value || "").trim(),
      descricaoHTML: document.getElementById("editor-html-content")?.innerHTML || "",
      infoAdicionais: (document.getElementById("field-infoAdicionais")?.value || "").trim()
    },
    seo: {
      titulo: (document.getElementById("field-seoTitulo")?.value || "").trim(),
      descricao: (document.getElementById("field-seoDescricao")?.value || "").trim(),
      keywords: (document.getElementById("field-seoKeywords")?.value || "").trim()
    }
  };
}

async function salvarProduto(redirecionarParaVisualizar = false) {
  try {
    const tipo = document.getElementById("field-tipo")?.value || "";
    if (!tipo) {
      alert("Selecione o tipo do produto antes de salvar. Produtos antigos não recebem um tipo automaticamente.");
      document.getElementById("field-tipo")?.focus();
      return;
    }
    opcoesVariacaoEditor = coletarOpcoesVariacaoDaTela();
    const nomesOpcoes = opcoesVariacaoEditor.map((opcao) => opcao.nome.toLocaleLowerCase("pt-BR"));
    if (opcoesVariacaoEditor.length > 5 || nomesOpcoes.some((nome) => !nome) || new Set(nomesOpcoes).size !== nomesOpcoes.length || opcoesVariacaoEditor.some((opcao) => !opcao.valores.length)) {
      alert("Confira as opções: use nomes únicos e informe ao menos um valor para cada uma. O máximo é 5 opções.");
      return;
    }
    const totalVariacoes = opcoesVariacaoEditor.length ? combinacoesVariacao(opcoesVariacaoEditor).length : 0;
    if (totalVariacoes > 100) {
      alert("As opções geram mais de 100 combinações. Reduza os valores antes de salvar.");
      return;
    }
    const paginas = document.getElementById("field-numero-paginas")?.value;
    if (tipo === "livro" && paginas && (!Number.isInteger(Number(paginas)) || Number(paginas) < 0 || Number(paginas) > 100000)) {
      alert("Informe um número inteiro válido para as páginas.");
      return;
    }
    if (tipo === "livro") {
      const isbn = (document.getElementById("field-isbn")?.value || "").replace(/[\s-]/g, "");
      if (isbn && !/^(?:\d{9}[\dXx]|\d{13})$/.test(isbn)) {
        alert("O ISBN deve ter 10 ou 13 caracteres numéricos (o ISBN-10 também pode terminar em X).");
        document.getElementById("field-isbn")?.focus();
        return;
      }
    }
    if (variacoesEditor.some((variacao) => !Number.isInteger(variacao.estoque) || variacao.estoque < 0 ||
      (variacao.preco !== null && (!Number.isFinite(variacao.preco) || variacao.preco <= 0)))) {
      alert("Confira o preço e o estoque de cada variação.");
      return;
    }
    renderizarTabelaVariacoes();
    const dados = obterObjetoProduto();
    await db.collection("produtos").doc(produtoId).update(dados);
    
    if (redirecionarParaVisualizar) {
      const slug = document.getElementById("field-slug")?.value || "";
      window.open(`/loja/p/${slug}`, '_blank');
    } else {
      alert("Produto salvo com sucesso!");
    }
  } catch (err) {
    console.error("Erro ao salvar produto:", err);
    alert("Erro ao salvar o produto.");
  }
}

async function excluirProduto() {
  if (!confirm("Tem certeza que deseja excluir permanentemente este produto?")) return;
  try {
    await db.collection("produtos").doc(produtoId).delete();
    window.location.href = "/admin";
  } catch (err) {
    console.error("Erro ao excluir produto:", err);
    alert("Erro ao excluir produto.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("field-tipo")?.addEventListener("change", atualizarCamposTipoProduto);
  document.getElementById("btn-adicionar-atributo")?.addEventListener("click", () => {
    if (opcoesVariacaoEditor.length >= 5) {
      alert("O máximo é 5 opções por produto.");
      return;
    }
    opcoesVariacaoEditor = coletarOpcoesVariacaoDaTela();
    opcoesVariacaoEditor.push({ nome: "", valores: [] });
    renderizarOpcoesVariacao();
    renderizarTabelaVariacoes();
    document.querySelector(".atributo-variacao-linha:last-child [data-atributo-nome]")?.focus();
  });
  document.getElementById("btn-gerar-variacoes")?.addEventListener("click", () => {
    opcoesVariacaoEditor = coletarOpcoesVariacaoDaTela();
    renderizarTabelaVariacoes();
    document.getElementById("variacoes-tabela-wrap")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  document.getElementById("field-pre-venda")?.addEventListener("change", atualizarControleIgnorarEstoque);
  initWYSIWYG();

  ["field-nome", "field-slug", "field-seoTitulo", "field-seoDescricao", "field-seoKeywords", "field-preco"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        atualizarSeoPreview();
        gerarHeadHTML();
      });
    }
  });

  ["field-nome", "field-slug", "field-preco", "field-ativo", "field-publicado"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => atualizarSidebar());
      el.addEventListener("change", () => atualizarSidebar());
    }
  });

// 3. Imagem Principal
  const uploadFotoPrincipal = document.getElementById("upload-foto-principal");
  if (uploadFotoPrincipal) {
    uploadFotoPrincipal.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        const slug = document.getElementById("field-slug")?.value.trim() || "slug";
        // Adicionada a / no início para resolver a partir da raiz da aplicação
        const caminho = `p/${slug}/images/${file.name}`;
        
        const previewEl = document.getElementById("preview-foto-principal");
        if (previewEl) {
          previewEl.src = caminho;
          previewEl.dataset.caminhoRelativo = caminho; // guarda o caminho limpo
        }
        
        const container = document.getElementById("preview-principal-container");
        if (container) container.hidden = false;
        
        atualizarSidebar();
        gerarHeadHTML();
      }
    });
  }

  const btnRemoverPrincipal = document.getElementById("btn-remover-principal");
  if (btnRemoverPrincipal) {
    btnRemoverPrincipal.addEventListener("click", () => {
      const previewEl = document.getElementById("preview-foto-principal");
      if (previewEl) previewEl.src = "";
      
      const container = document.getElementById("preview-principal-container");
      if (container) container.hidden = true;
      
      if (uploadFotoPrincipal) uploadFotoPrincipal.value = "";
      
      atualizarSidebar();
      gerarHeadHTML();
    });
  }

  const uploadGaleria = document.getElementById("upload-galeria");
  if (uploadGaleria) {
    uploadGaleria.addEventListener("change", (e) => {
      const files = Array.from(e.target.files);
      const slug = document.getElementById("field-slug")?.value.trim() || "slug";

      files.forEach((file) => {
        const caminho = `${slug}/images/${file.name}`;
        galeriaImagens.push(caminho);
      });
      renderizarGaleria();
    });
  }

  const btnSalvar = document.getElementById("btn-salvar");
  if (btnSalvar) btnSalvar.onclick = () => salvarProduto(false);

  const btnSalvarVis = document.getElementById("btn-salvar-visualizar");
  if (btnSalvarVis) btnSalvarVis.onclick = () => salvarProduto(true);

  const btnExcluir = document.getElementById("btn-excluir");
  if (btnExcluir) btnExcluir.onclick = excluirProduto;

  const btnCancelar = document.getElementById("btn-cancelar");
  if (btnCancelar) btnCancelar.onclick = () => window.location.href = "/admin";

  const btnCopiarUrl = document.getElementById("btn-copiar-url");
  if (btnCopiarUrl) {
    btnCopiarUrl.onclick = () => {
      const slug = document.getElementById("field-slug")?.value || "";
      const url = `${window.location.origin}/loja/p/${slug}`;
      navigator.clipboard.writeText(url).then(() => {
        alert("URL copiada para a área de transferência!");
      });
    };
  }

  const btnCopiarHead = document.getElementById("btn-copiar-head");
  if (btnCopiarHead) {
    btnCopiarHead.onclick = () => {
      const headCode = document.getElementById("field-headCode");
      if (headCode) {
        headCode.select();
        navigator.clipboard.writeText(headCode.value).then(() => {
          alert("Tags do <head> copiadas para a área de transferência!");
        });
      }
    };
  }

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "/";
      return;
    }

    const snap = await db.collection("usuarios").doc(user.uid).get();
    const dados = snap.data();

    if (!dados || dados.role !== "admin") {
      alert("Acesso negado.");
      window.location.href = "/";
      return;
    }

    carregarProduto();
  });
});

function atualizarControleIgnorarEstoque() {
  const preVenda = document.getElementById("field-pre-venda");
  const ignorarEstoque = document.getElementById("field-pre-venda-ignorar-estoque");
  if (!preVenda || !ignorarEstoque) return;
  ignorarEstoque.disabled = !preVenda.checked;
  if (!preVenda.checked) ignorarEstoque.checked = false;
}
