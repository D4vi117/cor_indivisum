# Auditoria de regras do Firestore

## Escopo analisado

- `produtos`: leitura pública na loja; leitura e manutenção pela equipe no painel.
- `usuarios`: perfil privado do próprio usuário; listagem e leitura pela equipe.
- `pedidos`: criado e atualizado exclusivamente por Cloud Functions; leitura pela equipe somente no cliente.
- Coleções operacionais (`rate_limits`, `webhook_logs`, `melhor_envio_config` e estados OAuth): somente Admin SDK.

## Consultas do cliente

- Loja: produtos publicados e ativos.
- Painel admin: listas completas de produtos, pedidos e usuários, sob papel `admin` ou `dev`.
- Perfil: documento `/usuarios/{uid}` do próprio usuário.

## Ameaças verificadas

- Criação direta de pedido, manipulação de preço e alteração de status: bloqueadas.
- Autoelevação de cargo: bloqueada; clientes só podem criar o papel `cliente` e não podem alterar `role`.
- Leitura de perfil de terceiros: bloqueada, exceto para equipe autorizada.
- Leitura pública de produto não publicado: bloqueada.
- Acesso a coleções operacionais: bloqueado.

## Teste adversarial das regras

| Tentativa | Resultado esperado pelas regras |
| --- | --- |
| Anônimo lista produtos não publicados | Negado: a consulta pública precisa provar `status.ativo == true` e `status.publicado == true`. |
| Cliente cria ou altera `/pedidos` | Negado: toda escrita em pedidos é `false`; o Admin SDK das Functions é o único escritor. |
| Cliente lê pedido ou perfil de terceiro | Negado: pedido é acessível apenas à equipe e perfil exige o UID do dono ou equipe. |
| Cliente cria a própria conta como admin/dev | Negado: criação própria exige `role == "cliente"`. |
| Cliente altera o próprio cargo ou adiciona campos de checkout | Negado: atualização própria só pode afetar nome, email e telefone, preservando `role`. |
| Cliente publica ou altera produto | Negado: escrita em produtos exige equipe. |
| Cliente acessa token, log, estado OAuth ou rate limit | Negado pelo padrão final de negação. |
