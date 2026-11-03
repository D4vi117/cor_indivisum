# Códigos de acesso

Em Admin → Resgates, selecione o curso, escolha a validade (1 a 365 dias) e gere
um código. Copie os 20 dígitos na hora: o banco guarda apenas SHA-256 e os
últimos quatro dígitos. O histórico mostra os últimos 100 códigos e permite
revogar códigos disponíveis. Código usado não pode ser reutilizado.

Em Minha Conta → Resgatar código, o usuário autenticado informa o código. O
servidor valida formato, validade, status e item. A concessão e o consumo do
código acontecem na mesma transação. Dez tentativas por usuário a cada quinze
minutos, inclusive inválidas, limitam abuso. Usuários anônimos são recusados.

Os acessos são registrados em `acessos_digitais/{uid}/itens/{sha256(tipo:id)}`,
com tipo, itemId, nome, status ativo e origem resgate. Os códigos ficam em
`codigos_resgate/{sha256(codigo)}`. Ambas as coleções continuam bloqueadas
para leitura/escrita direta pelas regras padrão. Somente callables com
verificação de equipe ou de proprietário têm acesso pelo Admin SDK.

O mesmo usuário não consome outro código se já tem acesso ativo ao item.
O código continua disponível para outra pessoa nesse caso.

Os textos dos módulos/aulas podem ser abertos no painel após resgate, por
`obterConteudoResgatado`, que verifica o acesso antes de retornar o conteúdo
privado. Referências de vídeo não são reproduzidas nesta etapa e materiais
são texto, sem upload ou entrega de arquivos implementados. Despublicar o
curso da vitrine não revoga acessos já concedidos.

Produtos físicos não são elegíveis. O serviço está preparado para produtos
com `modalidade: digital`; o cadastro e a entrega de livros digitais seguem
para a etapa futura já planejada. Não crie essa marcação para itens físicos.

Resgate concede acesso, não simula pagamento, não cria pedido nem frete.
As matrículas de compras pagas ainda serão conectadas ao mesmo modelo de
acesso na etapa de área de alunos.

Teste: `node --test functions/redemptions.test.js` (banco simulado, incluindo
concorrência, expiração, autorização, limites e uso único).

Publicar: `firebase deploy --only functions,hosting`.
