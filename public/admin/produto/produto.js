let produtoId = null;
let galeriaImagens = [];

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
    const seo = data.seo || {};
    const midias = data.midias || {};

    // Preenchimento seguro dos campos
    definirValorSeExiste("field-nome", data.nome);
    definirValorSeExiste("field-slug", data.slug);
    definirValorSeExiste("field-categoria", data.categoria);

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
    slug: (document.getElementById("field-slug")?.value || "").trim(),
    categoria: (document.getElementById("field-categoria")?.value || "").trim(),
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
      destaque: document.getElementById("field-destaque")?.checked || false
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
