(function () {

  let recaptchaVerifier  = null;
  let confirmationResult = null;

  function createModal() {
    if (document.getElementById("authModal")) return;

    const modal = document.createElement("div");
    modal.id = "authModal";
    modal.innerHTML = `
      <div class="auth-overlay">
        <div class="auth-box">
          <h2>Entre para acessar sua conta</h2>
          <p style="font-size:.85rem; opacity:.75; margin:-6px 0 16px;">
            Faça login para ver seus pedidos, acompanhar entregas e aproveitar suas recompensas.
          </p>

          <button class="gsi-material-button" id="authGoogleBtn" type="button">
            <div class="gsi-material-button-state"></div>
            <div class="gsi-material-button-content-wrapper">
              <div class="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style="display:block;">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg>
              </div>
              <span class="gsi-material-button-contents">Entrar com Google</span>
            </div>
          </button>

          <div style="text-align:center; font-size:.75rem; opacity:.6; margin:12px 0;">ou</div>

          <button id="authPhoneToggle" type="button"
            style="width:100%; background:#F4F0EC; border:1px solid rgba(107,30,30,.15); border-radius:12px; padding:12px 16px; font-size:.9rem; font-weight:600; color:#6B1E1E; cursor:pointer;">
            Entrar com celular
          </button>

          <div id="authPhonePanel" style="display:none; margin-top:10px;">
            <input type="tel" id="authPhoneNumber" placeholder="+55 11 91234-5678"
              style="width:100%; padding:12px 14px; border-radius:12px; border:1px solid rgba(107,30,30,.2); font-size:.9rem; margin-bottom:8px;" />
            <button id="authSendCodeBtn" type="button"
              style="width:100%; background:#6B1E1E; color:#F4F0EC; border:none; border-radius:12px; padding:12px 14px; font-weight:600; cursor:pointer; margin-bottom:8px;">
              Enviar código
            </button>

            <div id="authCodeRow" style="display:none;">
              <input type="text" id="authPhoneCode" placeholder="Código recebido por SMS"
                style="width:100%; padding:12px 14px; border-radius:12px; border:1px solid rgba(107,30,30,.2); font-size:.9rem; margin-bottom:8px;" />
              <button id="authConfirmCodeBtn" type="button"
                style="width:100%; background:#6B1E1E; color:#F4F0EC; border:none; border-radius:12px; padding:12px 14px; font-weight:600; cursor:pointer;">
                Confirmar código
              </button>
            </div>
          </div>

          <!-- Contêiner exigido pelo Firebase para o reCAPTCHA invisível do login por celular -->
          <div id="authRecaptchaContainer"></div>

          <div id="authError" style="display:none; color:red; font-size:0.85rem; margin-top:8px;"></div>

          <button id="authCancelBtn">Voltar</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById("authGoogleBtn").onclick  = loginWithGoogle;
    document.getElementById("authCancelBtn").onclick   = () => window.location.href = "/";

    document.getElementById("authPhoneToggle").onclick = () => {
      const panel = document.getElementById("authPhonePanel");
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    };

    document.getElementById("authSendCodeBtn").onclick    = sendPhoneCode;
    document.getElementById("authConfirmCodeBtn").onclick = confirmPhoneCode;
  }

  function showModal() {
    createModal();
    document.getElementById("authModal").style.display = "flex";
  }

  function hideModal() {
    const el = document.getElementById("authModal");
    if (el) el.style.display = "none";
  }

  function showError(msg) {
    const el = document.getElementById("authError");
    if (el) { el.textContent = msg; el.style.display = "block"; }
  }

  function clearError() {
    const el = document.getElementById("authError");
    if (el) { el.textContent = ""; el.style.display = "none"; }
  }

  // -------------------------------------------------------------------------
  // Garante que o doc /usuarios/{uid} exista. É chamado dentro do
  // onAuthStateChanged, e o modal só é escondido depois que essa escrita
  // termina — assim nenhuma navegação/ação subsequente do usuário pode
  // interromper a criação do documento do usuário novo.
  // -------------------------------------------------------------------------
  async function ensureUserDoc(user) {
    const userRef = firebase.firestore().collection("usuarios").doc(user.uid);
    const doc     = await userRef.get();

    if (!doc.exists) {
      await userRef.set({
        nome:     user.displayName || "",
        email:    user.email       || "",
        telefone: user.phoneNumber || "",
        role:     "cliente",
        criadoEm: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  async function loginWithGoogle() {
    clearError();
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await firebase.auth().signInWithPopup(provider);
      // ensureUserDoc roda dentro do onAuthStateChanged, abaixo.
    } catch (err) {
      console.error(err);
      showError("Não foi possível realizar o login com Google.");
    }
  }

  function setupRecaptcha() {
    if (recaptchaVerifier) return recaptchaVerifier;
    recaptchaVerifier = new firebase.auth.RecaptchaVerifier("authRecaptchaContainer", {
      size: "invisible"
    });
    return recaptchaVerifier;
  }

  async function sendPhoneCode() {
    clearError();
    const input    = document.getElementById("authPhoneNumber");
    const rawPhone = input.value.trim();

    if (!rawPhone) {
      showError("Informe um número de celular.");
      return;
    }

    const phoneNumber = rawPhone.startsWith("+")
      ? rawPhone
      : `+55${rawPhone.replace(/\D/g, "")}`;

    const btn = document.getElementById("authSendCodeBtn");
    // Desabilita assim que o usuário confirma o envio — antes mesmo da
    // resposta do reCAPTCHA/Firebase — para um clique duplo não disparar dois SMS.
    btn.disabled    = true;
    btn.textContent = "Enviando…";

    try {
      const verifier = setupRecaptcha();
      confirmationResult = await firebase.auth().signInWithPhoneNumber(phoneNumber, verifier);
      document.getElementById("authCodeRow").style.display = "block";
      btn.textContent = "Código enviado";
    } catch (err) {
      console.error(err);
      // Mostra o código do erro do Firebase para facilitar o diagnóstico
      // (remover a parte "[code: ...]" quando o fluxo estiver validado em produção).
      showError(`Não foi possível enviar o código. [${err.code || err.message || "erro desconhecido"}]`);
      if (recaptchaVerifier) {
        recaptchaVerifier.clear();
        recaptchaVerifier = null;
      }
      // Essa tentativa falhou — reabilita para o usuário tentar de novo.
      btn.disabled    = false;
      btn.textContent = "Enviar código";
    }
  }

  async function confirmPhoneCode() {
    clearError();
    const code = document.getElementById("authPhoneCode").value.trim();

    if (!code) {
      showError("Informe o código recebido por SMS.");
      return;
    }

    if (!confirmationResult) {
      showError("Solicite o código novamente.");
      return;
    }

    try {
      await confirmationResult.confirm(code);
      // ensureUserDoc roda dentro do onAuthStateChanged, abaixo.
    } catch (err) {
      console.error(err);
      showError("Código inválido. Tente novamente.");
    }
  }

  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      try {
        await ensureUserDoc(user);
      } catch (err) {
        console.error(err);
      }
      hideModal();
      document.body.classList.add("auth-ready");
      return;
    }
    showModal();
  });

})();