# Cursos: primeira etapa

O painel permite criar produtos no fluxo existente ou cadastrar cursos em
`/admin/curso/`. A aba Cursos lista os rascunhos e oferece edição.

## Dados

- `cursos/{id}`: tipo fixo `curso`, nome, slug, professor, resumo, descrição,
  capa HTTPS, preço, status `rascunho` e timestamps. Somente admin/dev têm acesso
  nesta etapa. Nenhum curso é inserido em `produtos`, evitando vendas acidentais
  pelo checkout físico atual. O campo `tipo` existente em produtos é categoria
  (livro, vestuário etc.), não modalidade de entrega, e foi preservado.
- `cursos_conteudos/{id}`: lista ordenada de módulos e aulas, apenas admin/dev.
  IDs estáveis permitem reordenar sem perder a identidade das aulas.
- Cada aula guarda título, texto simples, provedor de vídeo, referência de vídeo
  e referências de materiais em texto simples. Não há HTML executável,
  reprodução, upload nem criação de links públicos nesta etapa.
- As duas gravações são atômicas. Uma edição concorrente impede sobrescrita
  silenciosa. O formulário avisa ao sair com alterações não salvas.

## Verificações de acesso consideradas

- Anônimo e cliente: leitura/escrita negadas nas duas novas coleções.
- Admin/dev: consulta da lista sem filtros e leitura de documentos permitidas.
- Criar/editar metadados: campos obrigatórios, allowlist, tamanho, preço,
  formato do slug, capa HTTPS e timestamps validados.
- Alterar tipo/status ou adicionar permissões de comprador: negado.
- Conteúdo sem curso correspondente ao fim da transação: negado.
- Conteúdo privado não herda permissões do documento comercial.
- Exclusão: bloqueada nesta etapa, evitando remoção acidental de conteúdo.

As regras limitam a lista a 30 módulos. A validação profunda das aulas no
servidor será necessária ao introduzir API de publicação/importação; atualmente
somente equipe pode gravar e a interface limita 100 aulas por módulo e 700 KB
de estrutura. Não existe ainda nenhuma permissão de aluno.

## Validação manual

1. Abrir admin como admin ou dev; criar um curso com nome, slug e preço.
2. Adicionar dois módulos, duas aulas, referências de vídeo e materiais.
3. Reordenar aulas/módulos, salvar, recarregar e conferir persistência.
4. Editar o mesmo curso em duas abas; salvar uma e confirmar que a outra
   recusa a sobrescrita.
5. Conferir que o rascunho aparece na aba Cursos e não aparece na loja.
6. Como cliente ou anônimo, verificar que as duas coleções não são acessíveis.

## Venda de cursos

O status `publicado` disponibiliza os dados comerciais em `/cursos/` e a página
`/cursos/Slug-do-Curso`. O conteúdo de aulas permanece privado e restrito à equipe.
O botão Comprar acrescenta um item identificado como `curso:{id}` ao carrinho
existente e encaminha ao checkout. A quantidade de cada curso é uma inscrição.

O backend resolve esse identificador em `cursos`, verifica publicação e preço
positivo e guarda `tipoItem: curso` e `cursoId` no pedido. O preço do navegador
não é confiado. Só itens físicos são cotados e incluídos na etiqueta. Cursos
sozinhos dispensam endereço e não chamam o Melhor Envio. O pedido segue para
o fluxo existente de Mercado Pago/InfinitePay, com confirmação de pagamento
existente e vínculo entre comprador e itens comprados preservado.

As primeiras descrições deste documento registram a etapa inicial de rascunhos;
o status publicado e a leitura pública dos metadados foram habilitados nesta
etapa de venda. Cursos publicados continuam separados dos produtos físicos.

Verificações locais: `node --test scripts/test_cursos_checkout.cjs`,
`python scripts/test_cursos_compra.py` e `python scripts/test_cursos_admin.py`.
Os testes usam Firebase simulado e não cobram cartões nem criam pedidos reais.

Publicação: `firebase deploy --only functions,firestore:rules,hosting`.
Depois, faça uma compra controlada para validar as credenciais e webhooks reais.

## Próximas etapas

Matrículas geradas por pagamento confirmado e área restrita dos alunos.
O provedor de vídeo poderá ser escolhido sem alterar IDs de cursos/aulas.
Produtos digitais para download continuam planejados para etapa posterior.
