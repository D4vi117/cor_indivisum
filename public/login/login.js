// =========================
// login.js
// =========================

let confirmationResult = null;
let recaptchaVerifier = null;
let newsletterProcessada = false;

// -------------------------

const googleBtn = document.getElementById("authGoogleBtn");

const telefoneInput = document.getElementById("telefoneInput");

const enviarCodigoBtn = document.getElementById("enviarCodigoBtn");

const confirmarCodigoBtn = document.getElementById("confirmarCodigoBtn");

const codigoArea = document.getElementById("codigoArea");

const codigoInput = document.getElementById("codigoInput");

const erro = document.getElementById("loginErro");

const sucesso = document.getElementById("loginSucesso");

const loading = document.getElementById("loginLoading");

// -------------------------

function mostrarErro(msg) {

    erro.style.display = "block";
    erro.textContent = msg;

    sucesso.style.display = "none";

}

function mostrarSucesso(msg) {

    sucesso.style.display = "block";
    sucesso.textContent = msg;

    erro.style.display = "none";

}

function esconderMensagens() {

    erro.style.display = "none";
    sucesso.style.display = "none";

}

function mostrarLoading() {

    loading.style.display = "flex";

}

function esconderLoading() {

    loading.style.display = "none";

}

// -------------------------

async function syncUser(user) {

    const ref = db.collection("usuarios").doc(user.uid);

    const snap = await ref.get();

    const dados = {

        nome: user.displayName || "",
        email: user.email || "",
        telefone: user.phoneNumber || ""

    };

    if (!snap.exists) {

        dados.role = "cliente";
        dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();

    }

    await ref.set(dados, {

        merge: true

    });

    return (await ref.get()).data();

}

// -------------------------

async function redirecionar(role) {

    // Lê ?redirect=... da URL, se existir. Só aceitamos caminhos internos
    // (começam com "/" e não com "//") para evitar que alguém monte um
    // link tipo /login?redirect=https://site-falso.com e use nosso próprio
    // login pra redirecionar a vítima pra fora do site (open redirect).
    const params = new URLSearchParams(window.location.search);
    const redirectParam = params.get("redirect");
    const redirectSeguro =
        redirectParam &&
        redirectParam.startsWith("/") &&
        !redirectParam.startsWith("//")
            ? redirectParam
            : null;

    if (params.get("newsletter") === "1" && !newsletterProcessada) {
        newsletterProcessada = true;
        try {
            const inscreverNewsletter = functions.httpsCallable("inscreverNewsletter");
            await inscreverNewsletter();
        } catch (e) {
            console.error("Não foi possível concluir a inscrição na newsletter:", e);
        }
    }

    if (role == "admin" || role == "dev") {

        window.location.href = redirectSeguro || "/admin/";

        return;

    }

    window.location.href = redirectSeguro || "/minha-conta/";

}

// -------------------------

async function loginGoogle() {

    esconderMensagens();

    mostrarLoading();

    try {

        const provider = new firebase.auth.GoogleAuthProvider();

        const cred = await auth.signInWithPopup(provider);

        const dados = await syncUser(cred.user);

        redirecionar(dados.role);

    }

    catch (e) {

        console.error(e);

        mostrarErro(e.message);

    }

    esconderLoading();

}

// -------------------------

function iniciarRecaptcha() {

    if (recaptchaVerifier)
        return recaptchaVerifier;

    recaptchaVerifier = new firebase.auth.RecaptchaVerifier(
        "recaptcha-container",
        {

            size: "invisible"

        });

    return recaptchaVerifier;

}

// -------------------------

async function enviarCodigo() {

    esconderMensagens();

    let numero = telefoneInput.value.trim();

    if (!numero) {

        mostrarErro("Informe seu celular.");

        return;

    }

    numero = numero.replace(/\D/g, "");

    if (!numero.startsWith("55"))
        numero = "55" + numero;

    numero = "+" + numero;

    mostrarLoading();

    try {

        confirmationResult =
            await auth.signInWithPhoneNumber(

                numero,

                iniciarRecaptcha()

            );

        codigoArea.style.display = "flex";

        mostrarSucesso(
            "Código enviado por SMS."
        );

    }

    catch (e) {

        console.error(e);

        mostrarErro(e.message);

    }

    esconderLoading();

}

// -------------------------

async function confirmarCodigo() {

    esconderMensagens();

    const codigo = codigoInput.value.trim();

    if (!codigo) {

        mostrarErro("Digite o código.");

        return;

    }

    mostrarLoading();

    try {

        const cred =
            await confirmationResult.confirm(codigo);

        const dados =
            await syncUser(cred.user);

        redirecionar(dados.role);

    }

    catch (e) {

        console.error(e);

        mostrarErro("Código inválido.");

    }

    esconderLoading();

}

// -------------------------

googleBtn.onclick = loginGoogle;

enviarCodigoBtn.onclick = enviarCodigo;

confirmarCodigoBtn.onclick = confirmarCodigo;

// -------------------------

auth.onAuthStateChanged(async (user) => {

    if (!user)
        return;

    mostrarLoading();

    try {

        const dados = await syncUser(user);

        redirecionar(dados.role);

    }

    catch (e) {

        console.error(e);

    }

    esconderLoading();

});
