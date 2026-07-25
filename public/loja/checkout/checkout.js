// URL correta do projeto corindivisum (us-central1)
const CHECKOUT_URL = "https://checkout-phpb3wzhpq-uc.a.run.app";

async function comprarPacote(pacoteId, dadosCliente) {
    try {
        const res = await fetch(CHECKOUT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                pacoteId: pacoteId,
                email: dadosCliente.email,
                nome: dadosCliente.nome,
                telefone: dadosCliente.telefone,
                endereco: dadosCliente.endereco
            }),
        });

        const body = await res.json();

        if (!res.ok) {
            throw new Error(body.error || "Erro ao processar checkout");
        }

        if (body.paymentLink) {
            // Redireciona o cliente para a InfinitePay
            window.location.href = body.paymentLink;
        } else {
            throw new Error("Link de pagamento não encontrado.");
        }

    } catch (err) {
        console.error("Erro no checkout:", err);
        alert(err.message || "Não foi possível iniciar o checkout.");
    }
}

// Vincula a ação de submit do formulário no HTML
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("checkout-form");

    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const btnSubmit = form.querySelector(".btn-checkout");
            btnSubmit.disabled = true;
            btnSubmit.textContent = "Processando...";

            // Coleta os dados do formulário
            const dadosCliente = {
                nome: document.getElementById("nome")?.value,
                email: document.getElementById("email")?.value,
                telefone: document.getElementById("telefone")?.value,
                endereco: {
                    cep: document.getElementById("cep")?.value,
                    rua: document.getElementById("rua")?.value,
                    numero: document.getElementById("numero")?.value,
                    complemento: document.getElementById("complemento")?.value,
                    bairro: document.getElementById("bairro")?.value,
                    cidade: document.getElementById("cidade")?.value,
                    estado: document.getElementById("estado")?.value
                }
            };

            // ID do livro/pacote cadastrado no seu backend
            const PACOTE_ID = "maria-a-flauta-de-Deus";

            await comprarPacote(PACOTE_ID, dadosCliente);

            btnSubmit.disabled = false;
            btnSubmit.textContent = "Finalizar e Pagar";
        });
    }
});