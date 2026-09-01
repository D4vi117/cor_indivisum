// --- Auth: exibe perfil ou botão de login ---
auth.onAuthStateChanged(user => {
	if (!user) {
		document.getElementById("cliente-avatar").style.display = "none";
		document.getElementById("cliente-nome").textContent = "";
		document.getElementById("cliente-email").textContent = "";

		const btn = document.getElementById("btn-sair");
		btn.onclick = () => { window.location.href = "/login"; };
	} else {
		renderPerfil();
		const btn = document.getElementById("btn-sair");
		btn.innerHTML = "Sair";
		btn.onclick = () => auth.signOut();
	}
});

async function renderPerfil() {
	const user = usuarioAtual();
	if (!user) return;

	const snap = await db.collection("usuarios").doc(user.uid).get();
	const data = snap.data();

	const nome = data?.nome || user.displayName || "Cliente";

	// Usuários que entraram por celular não têm email (nem do Firebase, nem
	// salvo no Firestore) — nesse caso mostramos o telefone como identificador,
	// e por último um texto vazio em vez de quebrar em email.length.
	const identificador = data?.email || user.email || data?.telefone || user.phoneNumber || "";
	const identificadorCurto = identificador.length > 18
		? identificador.slice(0, 15) + "..."
		: identificador;

	document.getElementById("cliente-nome").innerText = nome;
	document.getElementById("cliente-email").innerText = identificadorCurto;
	let avatar = document.querySelector(".avatar")
	avatar.classList.remove("hidden")
	if (user.photoURL) {
		avatar.innerHTML = `
      <img src="${user.photoURL}"
           style="width:34px;height:34px;border-radius:50%;object-fit:cover;">
    `;
	} else {
		avatar.innerHTML = `
    		<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
		<path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
			</svg>
`;
	}
	if (data?.role === "admin") {
		document.getElementById("nav-links-desktop").innerHTML += `
      <a href="/admin" class="nav-link">Admin</a>
    `;
		document.getElementById("nav-links").innerHTML += `
      <a href="/admin" class="nav-link">Admin</a>
    `;
	}
}
// --- Menu mobile ---
document.getElementById("btn-menu").addEventListener("click", () => {
	console.log("listening");
	document.getElementById("nav-links").classList.toggle("active");
});