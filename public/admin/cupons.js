(() => {
  const form = document.getElementById("form-cupom");
  if (!form) return;

  const list = document.getElementById("cupom-lista");
  const search = document.getElementById("cupom-busca");
  const feedback = document.getElementById("cupons-feedback");
  const formFeedback = document.getElementById("cupom-form-feedback");
  const customersPanel = document.getElementById("cupom-clientes-painel");
  const customerSearch = document.getElementById("cupom-cliente-busca");
  const customerResults = document.getElementById("cupom-cliente-resultados");
  const customerList = document.getElementById("cupom-clientes-lista");
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const functionsApi = firebase.app().functions("southamerica-east1");
  const field = (name) => form.querySelector(`[name="${name}"]`);

  let coupons = [];
  let customers = [];
  let editingId = null;
  let selectedId = null;
  let loadingCoupons = null;

  function setMessage(element, message, success = false) {
    element.textContent = message;
    element.classList.toggle("success", success);
  }

  function couponDateIsValid(coupon) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = coupon.validade?.inicio ? new Date(`${coupon.validade.inicio}T00:00:00`) : null;
    const end = coupon.validade?.fim ? new Date(`${coupon.validade.fim}T23:59:59.999`) : null;
    return coupon.status === "ativo" && (!start || today >= start) && (!end || today <= end);
  }

  function couponSummary(coupon) {
    const discount = coupon.tipo === "percentual" ? `${coupon.valor}%` : money.format(coupon.valor);
    const cap = coupon.limiteDesconto ? ` · máximo ${money.format(coupon.limiteDesconto)}` : "";
    const usageLimit = coupon.escopo === "universal" ? coupon.limiteUsos : coupon.limiteEmissoes;
    const limitText = usageLimit ? ` · limite ${usageLimit} ${coupon.escopo === "universal" ? "usos" : "emissões"}` : "";
    const minimum = Number(coupon.pedidoMinimo) > 0 ? ` · pedido mínimo ${money.format(coupon.pedidoMinimo)}` : "";
    return `${discount}${cap}${minimum}${limitText}`;
  }

  function digits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizedText(value) {
    return String(value || "").trim().toLocaleLowerCase("pt-BR");
  }

  function renderCustomerSearchResults(query = customerSearch.value) {
    const textQuery = normalizedText(query);
    const numberQuery = digits(query);
    if (textQuery.length < 2 && numberQuery.length < 2) {
      customerResults.replaceChildren(Object.assign(document.createElement("p"), {
        className: "cupom-vazio",
        textContent: customers.length ? "Busque por CPF/CNPJ, nome, e-mail ou telefone." : "Carregando contas…",
      }));
      return;
    }

    const matches = customers.map((user) => {
      const documentDigits = digits(user.documento);
      const phoneDigits = digits(user.telefone);
      const nameMatch = normalizedText(user.nome).includes(textQuery);
      const emailMatch = normalizedText(user.email).includes(textQuery);
      const phoneMatch = numberQuery.length >= 2 && phoneDigits.includes(numberQuery);
      const documentMatch = numberQuery.length >= 2 && documentDigits.includes(numberQuery);
      const rank = documentDigits === numberQuery ? 0
        : documentDigits.startsWith(numberQuery) && numberQuery.length >= 2 ? 1
          : documentMatch ? 2
            : nameMatch ? 3
              : emailMatch ? 4
                : phoneMatch ? 5 : 99;
      return { user, rank };
    }).filter((entry) => entry.rank < 99)
      .sort((a, b) => a.rank - b.rank || (a.user.nome || "").localeCompare(b.user.nome || "", "pt-BR"))
      .slice(0, 30);

    if (!matches.length) {
      customerResults.replaceChildren(Object.assign(document.createElement("p"), {
        className: "cupom-vazio",
        textContent: "Nenhuma conta encontrada. Confira o documento, nome, e-mail ou telefone.",
      }));
      return;
    }

    customerResults.replaceChildren(...matches.map(({ user }) => {
      const card = document.createElement("article");
      card.className = "cupom-cliente-resultado";
      card.setAttribute("role", "listitem");
      const identity = document.createElement("div");
      identity.className = "cupom-cliente-identidade";
      const documentLine = document.createElement("strong");
      documentLine.textContent = user.documento || "Documento não cadastrado";
      const nameLine = document.createElement("span");
      nameLine.textContent = user.nome || "Conta sem nome";
      const contactLine = document.createElement("small");
      contactLine.textContent = [user.email, user.telefone].filter(Boolean).join(" · ") || user.id;
      const role = document.createElement("small");
      role.className = "cupom-cliente-tipo";
      role.textContent = user.role || "conta";
      identity.append(documentLine, nameLine, contactLine, role);

      const issue = document.createElement("button");
      issue.type = "button";
      issue.className = "btn-secundario cupom-emitir-conta";
      issue.textContent = "Emitir para esta conta";
      issue.addEventListener("click", () => issueCouponFor(user.id, issue));
      card.append(identity, issue);
      return card;
    }));
  }

  async function issueCouponFor(uid, button) {
    if (!selectedId) return;
    button.disabled = true;
    try {
      const call = functionsApi.httpsCallable("emitirCupomAdmin");
      await call({ cupomId: selectedId, uid });
      await Promise.all([loadAssignments(selectedId), refreshCoupons()]);
      setMessage(feedback, "Cupom emitido para a conta selecionada.", true);
    } catch (error) {
      setMessage(feedback, error.message || "Não foi possível emitir o cupom.");
    } finally {
      button.disabled = false;
    }
  }

  function renderCoupons() {
    const query = search.value.trim().toLocaleUpperCase("pt-BR");
    const filtered = coupons.filter((coupon) => `${coupon.codigo} ${coupon.descricao}`.toLocaleUpperCase("pt-BR").includes(query));
    if (!filtered.length) {
      list.replaceChildren(Object.assign(document.createElement("p"), { className: "cupom-vazio", textContent: query ? "Nenhum cupom corresponde à busca." : "Nenhum cupom cadastrado." }));
      return;
    }

    list.replaceChildren(...filtered.map((coupon) => {
      const card = document.createElement("article");
      card.className = `cupom-item${coupon.id === selectedId ? " selecionado" : ""}`;
      const details = document.createElement("div");
      const code = document.createElement("strong");
      code.textContent = coupon.codigo;
      const description = document.createElement("span");
      description.textContent = coupon.descricao || "Sem descrição";
      const terms = document.createElement("small");
      const endDate = coupon.validade?.fim ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${coupon.validade.fim}T00:00:00`)) : "sem data final";
      terms.textContent = `${couponSummary(coupon)} · ${coupon.escopo === "exclusivo" ? "Exclusivo" : "Universal"} · até ${endDate}`;
      details.append(code, description, terms);

      const counters = document.createElement("small");
      counters.className = "cupom-contadores";
      counters.textContent = `Emitidos ${coupon.emitidos || 0} · Reservados ${coupon.reservados || 0} · Usados ${coupon.usados || 0} · Em posse ${coupon.posses || 0}`;
      const state = document.createElement("span");
      state.className = `cupom-status ${couponDateIsValid(coupon) ? "ativo" : "inativo"}`;
      state.textContent = couponDateIsValid(coupon) ? "Ativo" : coupon.status === "inativo" ? "Inativo" : "Fora da validade";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "btn-tabela";
      open.textContent = "Abrir";
      open.addEventListener("click", () => editCoupon(coupon.id));
      card.append(details, counters, state, open);
      return card;
    }));
  }

  function renderCustomerAssignments(assignments) {
    if (!assignments.length) {
      customerList.replaceChildren(Object.assign(document.createElement("p"), { className: "cupom-vazio", textContent: "Nenhum cliente recebeu este cupom." }));
      return;
    }

    customerList.replaceChildren(...assignments.map((assignment) => {
      const row = document.createElement("div");
      row.className = "cupom-cliente-item";
      const identity = document.createElement("div");
      identity.className = "cupom-cliente-item-identidade";
      const label = document.createElement("strong");
      label.textContent = assignment.documento || "Documento não cadastrado";
      const name = document.createElement("small");
      name.textContent = [assignment.nome || assignment.email || assignment.uid, assignment.role || "conta", assignment.status === "usado" ? "usado" : assignment.status === "reservado" ? "reservado" : "disponível"].join(" · ");
      identity.append(label, name);
      row.append(identity);
      if (assignment.status === "disponivel") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn-tabela btn-danger";
        remove.textContent = "Remover";
        remove.addEventListener("click", () => removeAssignment(assignment.uid));
        row.append(remove);
      }
      return row;
    }));
  }

  async function loadAssignments(couponId) {
    customerList.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Carregando clientes…" }));
    const call = functionsApi.httpsCallable("listarClientesCupomAdmin");
    const { data } = await call({ cupomId: couponId });
    renderCustomerAssignments(data.clientes || []);
  }

  async function selectCoupon(couponId) {
    selectedId = couponId;
    const coupon = coupons.find((item) => item.id === couponId);
    const isExclusive = coupon?.escopo === "exclusivo";
    customersPanel.hidden = !isExclusive;
    renderCoupons();
    if (!isExclusive) return;
    try {
      if (!customers.length) {
        const snapshot = await db.collection("usuarios").get();
        customers = snapshot.docs
          .map((doc) => {
            const user = doc.data() || {};
            return {
              id: doc.id,
              nome: typeof user.nome === "string" ? user.nome : "",
              email: typeof user.email === "string" ? user.email : "",
              telefone: typeof user.telefone === "string" ? user.telefone : "",
              documento: typeof user.documento === "string" ? user.documento : "",
              role: typeof user.role === "string" ? user.role : "",
            };
          })
          .sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
        renderCustomerSearchResults("");
      }
      await loadAssignments(couponId);
    } catch (error) {
      console.error("Não foi possível carregar os clientes do cupom:", error);
      customerList.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Não foi possível carregar os clientes deste cupom." }));
    }
  }

  function resetForm() {
    editingId = null;
    selectedId = null;
    form.reset();
    field("escopo").value = "universal";
    field("tipo").value = "percentual";
    field("status").value = "ativo";
    field("pedidoMinimo").value = "0";
    document.getElementById("cupom-form-titulo").textContent = "Novo cupom";
    document.getElementById("btn-cancelar-cupom").hidden = true;
    document.getElementById("btn-excluir-cupom").hidden = true;
    document.getElementById("cupom-limite-desconto-wrap").hidden = false;
    document.getElementById("cupom-limite-emissoes-wrap").hidden = false;
    document.getElementById("cupom-limite-label").textContent = "Limite total de usos";
    customersPanel.hidden = true;
    setMessage(formFeedback, "");
    updateTypeFields();
    renderCoupons();
  }

  function editCoupon(couponId) {
    const coupon = coupons.find((item) => item.id === couponId);
    if (!coupon) return;
    editingId = couponId;
    field("codigo").value = coupon.codigo || "";
    field("descricao").value = coupon.descricao || "";
    field("escopo").value = coupon.escopo || "universal";
    field("tipo").value = coupon.tipo || "percentual";
    field("valor").value = coupon.valor ?? "";
    field("limiteDesconto").value = coupon.limiteDesconto ?? "";
    field("inicio").value = coupon.validade?.inicio || "";
    field("fim").value = coupon.validade?.fim || "";
    field("pedidoMinimo").value = coupon.pedidoMinimo ?? 0;
    field("limite").value = coupon.escopo === "universal" ? coupon.limiteUsos ?? "" : coupon.limiteEmissoes ?? "";
    field("status").value = coupon.status || "ativo";
    document.getElementById("cupom-form-titulo").textContent = `Editar ${coupon.codigo}`;
    document.getElementById("btn-cancelar-cupom").hidden = false;
    document.getElementById("btn-excluir-cupom").hidden = false;
    document.getElementById("cupom-limite-emissoes-wrap").hidden = false;
    document.getElementById("cupom-limite-label").textContent = coupon.escopo === "universal" ? "Limite total de usos" : "Limite de emissões para clientes";
    setMessage(formFeedback, "");
    updateTypeFields();
    selectCoupon(couponId);
  }

  function updateTypeFields() {
    const typeField = field("tipo");
    const valueField = field("valor");
    const capField = field("limiteDesconto");
    const capWrap = document.getElementById("cupom-limite-desconto-wrap");
    if (!typeField || !valueField || !capField || !capWrap) return;
    const isPercent = typeField.value === "percentual";
    capWrap.hidden = !isPercent;
    valueField.max = isPercent ? "100" : "";
    if (!isPercent) capField.value = "";
  }

  async function refreshCoupons() {
    if (loadingCoupons) return loadingCoupons;
    list?.replaceChildren(Object.assign(document.createElement("p"), {
      className: "cupom-vazio",
      textContent: "Carregando cupons…",
    }));
    loadingCoupons = (async () => {
      try {
        const call = functionsApi.httpsCallable("listarCuponsAdmin");
        const { data } = await call();
        coupons = data.cupons || [];
        renderCoupons();
        setMessage(feedback, "");
      } catch (error) {
        console.error("Erro ao carregar cupons:", error);
        setMessage(feedback, "Não foi possível consultar os cupons. Confira a conexão e tente novamente.");
        list.replaceChildren();
      } finally {
        loadingCoupons = null;
      }
    })();
    return loadingCoupons;
  }

  async function removeAssignment(uid) {
    if (!selectedId || !window.confirm("Remover este cupom ainda não usado do cliente?")) return;
    try {
      const call = functionsApi.httpsCallable("removerCupomClienteAdmin");
      await call({ cupomId: selectedId, uid });
      await Promise.all([loadAssignments(selectedId), refreshCoupons()]);
      setMessage(feedback, "Cupom removido do cliente.", true);
    } catch (error) {
      setMessage(feedback, error.message || "Não foi possível remover o cupom do cliente.");
    }
  }

  window.iniciarCuponsAdmin = async () => {
    await refreshCoupons();
  };

  document.getElementById("btn-novo-cupom")?.addEventListener("click", () => {
    resetForm();
    field("codigo")?.focus();
  });
  document.getElementById("btn-cancelar-cupom")?.addEventListener("click", resetForm);
  search?.addEventListener("input", renderCoupons);
  field("tipo")?.addEventListener("change", updateTypeFields);
  field("escopo")?.addEventListener("change", () => {
    const exclusive = field("escopo").value === "exclusivo";
    document.getElementById("cupom-limite-label").textContent = exclusive ? "Limite de emissões para clientes" : "Limite total de usos";
    field("limite").value = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const escopo = field("escopo").value;
    const limite = field("limite").value ? Number(field("limite").value) : null;
    const cupom = {
      codigo: field("codigo").value.trim(),
      descricao: field("descricao").value.trim(),
      escopo: field("escopo").value,
      tipo: field("tipo").value,
      valor: Number(field("valor").value),
      limiteDesconto: field("limiteDesconto").value ? Number(field("limiteDesconto").value) : null,
      validade: { inicio: field("inicio").value || null, fim: field("fim").value || null },
      pedidoMinimo: Number(field("pedidoMinimo").value || 0),
      limiteEmissoes: escopo === "exclusivo" ? limite : null,
      limiteUsos: escopo === "universal" ? limite : null,
      status: field("status").value,
    };
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const call = functionsApi.httpsCallable("salvarCupomAdmin");
      await call({ cupomId: editingId, cupom });
      setMessage(feedback, editingId ? "Cupom atualizado." : "Cupom cadastrado.", true);
      await refreshCoupons();
      resetForm();
    } catch (error) {
      setMessage(formFeedback, error.message || "Não foi possível salvar o cupom.");
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById("btn-excluir-cupom")?.addEventListener("click", async () => {
    if (!editingId) return;
    const coupon = coupons.find((item) => item.id === editingId);
    if (!coupon || !window.confirm(`Excluir o cupom ${coupon.codigo}? Cupons já emitidos precisam ser desativados para preservar o histórico.`)) return;
    try {
      const call = functionsApi.httpsCallable("excluirCupomAdmin");
      await call({ cupomId: editingId });
      setMessage(feedback, "Cupom excluído.", true);
      resetForm();
      await refreshCoupons();
    } catch (error) {
      setMessage(formFeedback, error.message || "Não foi possível excluir este cupom. Se já foi emitido, desative-o.");
    }
  });

  customerSearch?.addEventListener("input", () => renderCustomerSearchResults());

  resetForm();
})();
