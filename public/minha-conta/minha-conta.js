(function () {

  let linkRecaptchaVerifier  = null;
  let linkConfirmationResult = null;

  // ---------------------------------------------------------------------  
  // Sincroniza /usuarios/{uid} com os dados atuais do Auth.
  // Usa os MESMOS campos que auth-guard.js já grava (nome, email, telefone,
  // role, criadoEm) e faz merge:true — então "role" só é definido na
  // criação do documento e nunca é sobrescrito por este código depois,
  // permitindo que você defina o cargo manualmente no Firestore.
  // ---------------------------------------------------------------------
  async function syncUserDoc(user) {
    const userRef = firebase.firestore().collection("usuarios").doc(user.uid);
    const snap    = await userRef.get();

    const dados = {
      nome:     user.displayName || (snap.exists ? snap.data().nome : "") || "",
      email:    user.email       || "",
      telefone: user.phoneNumber || ""
    };

    if (!snap.exists) {
      dados.role     = "cliente";
      dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
    }

    await userRef.set(dados, { merge: true });
    const atualizado = await userRef.get();
    return atualizado.data();
  }

  function temProvedor(user, providerId) {
    return user.providerData.some((p) => p.providerId === providerId);
  }

  function showLinkError(msg) {
    const el = document.getElementById("contaLinkErro");
    if (el) { el.textContent = msg; el.style.display = "block"; }
  }

  function clearLinkError() {
    const el = document.getElementById("contaLinkErro");
    if (el) { el.textContent = ""; el.style.display = "none"; }
  }

  function renderPerfil(user, dadosFirestore) {
    const nomeInput = document.getElementById("contaNomeInput");
    if (nomeInput && document.activeElement !== nomeInput) {
      nomeInput.value = (dadosFirestore && dadosFirestore.nome) || user.displayName || "";
    }

    const googleLinked = temProvedor(user, "google.com");
    const phoneLinked  = temProvedor(user, "phone");

    const gStatus = document.querySelector("#provedorGoogle .provedor-status");
    gStatus.textContent   = googleLinked ? "Vinculado" : "Não vinculado";
    gStatus.dataset.status = googleLinked ? "on" : "off";
    document.getElementById("contaVincularGoogleBtn").style.display = googleLinked ? "none" : "inline-block";

    const pStatus = document.querySelector("#provedorTelefone .provedor-status");
    pStatus.textContent   = phoneLinked ? `Vinculado (${user.phoneNumber})` : "Não vinculado";
    pStatus.dataset.status = phoneLinked ? "on" : "off";
    document.getElementById("contaVincularTelefoneAcao").style.display = phoneLinked ? "none" : "block";
    if (phoneLinked) {
      document.getElementById("contaTelefonePainel").style.display = "none";
    }

    renderEnderecosSalvos(dadosFirestore?.enderecos);
  }

  function textoEndereco(endereco) {
    const rua = endereco?.rua || "Endereço";
    const numero = endereco?.numero ? `, ${endereco.numero}` : "";
    return `${rua}${numero}`;
  }

  function renderEnderecosSalvos(enderecos) {
    const lista = document.getElementById("enderecosSalvosLista");
    if (!lista) return;

    const itens = Array.isArray(enderecos) ? enderecos.slice(0, 3) : [];
    lista.innerHTML = "";

    if (itens.length === 0) {
      const vazio = document.createElement("div");
      vazio.className = "enderecos-vazio";
      vazio.textContent = "Você ainda não possui endereços salvos. Salve um durante o checkout.";
      lista.appendChild(vazio);
      return;
    }

    itens.forEach((endereco, indice) => {
      const card = document.createElement("article");
      card.className = "endereco-salvo-card";

      const titulo = document.createElement("h3");
      titulo.className = "endereco-salvo-titulo";
      titulo.textContent = `Endereço ${indice + 1}`;

      const principal = document.createElement("p");
      principal.className = "endereco-salvo-linha";
      principal.textContent = textoEndereco(endereco);

      const local = document.createElement("p");
      local.className = "endereco-salvo-linha";
      local.textContent = [endereco?.bairro, endereco?.cidade, endereco?.estado]
        .filter(Boolean)
        .join(" · ");

      const cep = document.createElement("p");
      cep.className = "endereco-salvo-linha endereco-salvo-complemento";
      cep.textContent = endereco?.cep ? `CEP ${endereco.cep}` : "CEP não informado";

      card.append(titulo, principal);
      if (endereco?.complemento) {
        const complemento = document.createElement("p");
        complemento.className = "endereco-salvo-linha endereco-salvo-complemento";
        complemento.textContent = endereco.complemento;
        card.appendChild(complemento);
      }
      if (local.textContent) card.appendChild(local);
      card.appendChild(cep);

      const usar = document.createElement("a");
      usar.className = "endereco-salvo-acao";
      usar.href = `/loja/checkout?endereco=${indice}`;
      usar.textContent = "Usar neste pedido";
      card.appendChild(usar);
      lista.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------
  // Vincular Google a uma conta que já está logada (ex.: via celular)
  // ---------------------------------------------------------------------
  async function vincularGoogle() {
    clearLinkError();
    const user = firebase.auth().currentUser;
    if (!user) return;

    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await user.linkWithPopup(provider);
      const atual = firebase.auth().currentUser;
      const dados = await syncUserDoc(atual);
      renderPerfil(atual, dados);
    } catch (err) {
      console.error(err);
      if (err.code === "auth/credential-already-in-use") {
        showLinkError("Essa conta Google já está vinculada a outro usuário.");
      } else {
        showLinkError("Não foi possível vincular sua conta Google.");
      }
    }
  }

  function setupLinkRecaptcha() {
    if (linkRecaptchaVerifier) return linkRecaptchaVerifier;
    linkRecaptchaVerifier = new firebase.auth.RecaptchaVerifier("contaLinkRecaptcha", {
      size: "invisible"
    });
    return linkRecaptchaVerifier;
  }

  // ---------------------------------------------------------------------
  // Vincular celular a uma conta que já está logada (ex.: via Google)
  // ---------------------------------------------------------------------
  async function enviarCodigoVinculo() {
    clearLinkError();
    const input    = document.getElementById("contaTelefoneNumero");
    const rawPhone = input.value.trim();

    if (!rawPhone) {
      showLinkError("Informe um número de celular.");
      return;
    }

    const phoneNumber = rawPhone.startsWith("+")
      ? rawPhone
      : `+55${rawPhone.replace(/\D/g, "")}`;

    const btn = document.getElementById("contaEnviarCodigoVinculoBtn");
    btn.disabled    = true;
    btn.textContent = "Enviando…";

    try {
      const verifier = setupLinkRecaptcha();
      const user     = firebase.auth().currentUser;
      linkConfirmationResult = await user.linkWithPhoneNumber(phoneNumber, verifier);
      document.getElementById("contaCodigoVinculoRow").style.display = "block";
      btn.textContent = "Código enviado";
    } catch (err) {
      console.error(err);
      if (err.code === "auth/credential-already-in-use") {
        showLinkError("Esse número já está vinculado a outra conta.");
      } else {
        showLinkError(`Não foi possível enviar o código. [${err.code || err.message || "erro desconhecido"}]`);
      }
      if (linkRecaptchaVerifier) {
        linkRecaptchaVerifier.clear();
        linkRecaptchaVerifier = null;
      }
      btn.disabled    = false;
      btn.textContent = "Enviar código";
    }
  }

  async function confirmarCodigoVinculo() {
    clearLinkError();
    const code = document.getElementById("contaCodigoVinculo").value.trim();

    if (!code) {
      showLinkError("Informe o código recebido por SMS.");
      return;
    }
    if (!linkConfirmationResult) {
      showLinkError("Solicite o código novamente.");
      return;
    }

    try {
      await linkConfirmationResult.confirm(code);
      const user  = firebase.auth().currentUser;
      const dados = await syncUserDoc(user);
      renderPerfil(user, dados);
    } catch (err) {
      console.error(err);
      showLinkError("Código inválido. Tente novamente.");
    }
  }

  // ---------------------------------------------------------------------
  // Editar nome (Auth + Firestore)
  // ---------------------------------------------------------------------
  async function salvarNome() {
    const user = firebase.auth().currentUser;
    if (!user) return;

    const novoNome = document.getElementById("contaNomeInput").value.trim();
    const btn = document.getElementById("contaSalvarNomeBtn");
    btn.disabled = true;

    try {
      await user.updateProfile({ displayName: novoNome });
      const atual = firebase.auth().currentUser;
      const dados = await syncUserDoc(atual);
      renderPerfil(atual, dados);
    } catch (err) {
      console.error(err);
      showLinkError("Não foi possível salvar seu nome agora.");
    } finally {
      btn.disabled = false;
    }
  }

  async function sair() {
    await firebase.auth().signOut();
    window.location.href = "/";
  }

  // ---------------------------------------------------------------------
  // Controle das abas
  // ---------------------------------------------------------------------
  function ativarAba(nomeAba) {
    document.querySelectorAll(".conta-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === nomeAba);
    });
    document.querySelectorAll(".conta-painel").forEach((painel) => {
      painel.hidden = painel.id !== `painel-${nomeAba}`;
    });
  }

  function iniciarAbas() {
    document.querySelectorAll(".conta-tab").forEach((btn) => {
      btn.addEventListener("click", () => ativarAba(btn.dataset.tab));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    iniciarAbas();

    document.getElementById("contaVincularGoogleBtn").onclick = vincularGoogle;

    document.getElementById("contaVincularTelefoneBtn").onclick = () => {
      document.getElementById("contaTelefonePainel").style.display = "flex";
    };

    document.getElementById("contaEnviarCodigoVinculoBtn").onclick    = enviarCodigoVinculo;
    document.getElementById("contaConfirmarCodigoVinculoBtn").onclick = confirmarCodigoVinculo;
    document.getElementById("contaSalvarNomeBtn").onclick = salvarNome;
    document.getElementById("contaSairBtn").onclick        = sair;
  });

  // auth-guard.js já exibe o modal de login quando não há usuário e o
  // esconde quando há. Aqui só cuidamos de popular/atualizar a página
  // de conta assim que o usuário estiver autenticado.
  //
  // Exceção: na checagem INICIAL (a página acabou de carregar), se não
  // houver usuário, redirecionamos para /login em vez de deixar o modal
  // aparecer — cobre o caso de alguém acessar /minha-conta diretamente
  // pela URL sem estar logado. Se a sessão cair DEPOIS (usuário já
  // estava usando a página), preferimos o modal em vez de um redirect
  // que jogaria fora o que a pessoa estava fazendo na tela.
  let primeiraChecagemAuth = true;

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      if (primeiraChecagemAuth) {
        window.location.href = "/login?redirect=/minha-conta";
      }
      primeiraChecagemAuth = false;
      return;
    }

    primeiraChecagemAuth = false;
    try {
      const dados = await syncUserDoc(user);
      renderPerfil(user, dados);
      carregarPedidos();
    } catch (err) {
      console.error(err);
    }
  });

  // ---------------------------------------------------------------------
  // ABA PEDIDOS
  // Busca via Cloud Function "listarPedidos" — as regras do Firestore só
  // deixam admin/dev lerem /pedidos diretamente, então um cliente comum
  // NUNCA pode fazer db.collection("pedidos").where(...) direto (dá
  // permission-denied). A function contorna isso com segurança, validando
  // que só devolve os pedidos do próprio usuário logado.
  // ---------------------------------------------------------------------
  const rotulosStatusPedido = {
    "Pendente": "Pendente",
    "pago": "Pago",
    "aguardando_pagamento": "Aguardando pagamento",
    "preparando": "Preparando",
    "saiu": "Saiu para entrega",
    "entregue": "Entregue",
    "recusado": "Recusado",
    "cancelado": "Cancelado",
    "reembolsado": "Reembolsado",
  };

  function formatarStatusPedido(status) {
    return rotulosStatusPedido[status] || status || "Pedido recebido";
  }

  function formatarBRL(valor) {
    return Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  async function carregarPedidos() {
    const lista = document.getElementById("pedidosLista");
    if (!lista) return;

    lista.innerHTML = `<div class="pedidos-vazio">Carregando pedidos…</div>`;

    try {
      const listarPedidos = functions.httpsCallable("listarPedidos");
      const { data } = await listarPedidos();
      renderPedidos(data.pedidos || []);
    } catch (err) {
      console.error("Erro ao carregar pedidos:", err);
      lista.innerHTML = `<div class="pedidos-vazio">Não foi possível carregar seus pedidos agora.</div>`;
    }
  }

  function renderPedidos(pedidos) {
    const lista = document.getElementById("pedidosLista");
    if (!lista) return;

    if (pedidos.length === 0) {
      lista.innerHTML = `<div class="pedidos-vazio">Nenhum pedido ainda.</div>`;
      return;
    }

    lista.innerHTML = "";

    pedidos.forEach((p) => {
      const data = p.criadoEm ? new Date(p.criadoEm) : null;
      const dataFormatada = data
        ? `${data.toLocaleDateString("pt-BR")} às ${data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
        : "";

      const nomeItens = (p.itens || []).map((i) => i.nome).join(", ") || "Pedido";

      const item = document.createElement("div");
      item.className = "pedido-card";
      item.innerHTML = `
        <div class="pedido-topo">
          <strong>#${p.numeroPedido || p.id.slice(0, 8)}</strong>
          <span class="pedido-status" data-status="${p.status || ""}">${formatarStatusPedido(p.status)}</span>
        </div>
        <p class="pedido-itens">${nomeItens}</p>
        <div class="pedido-info">
          <span>${dataFormatada}</span>
          <strong>${formatarBRL(p.total)}</strong>
        </div>
        <a href="/loja/pedido-confirmado/?id=${p.id}" class="pedido-link">Ver pedido</a>
      `;

      lista.appendChild(item);
    });
  }

})();
