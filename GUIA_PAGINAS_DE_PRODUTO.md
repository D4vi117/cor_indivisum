# Guia para páginas de produto

Este documento orienta IAs e pessoas que criam ou atualizam páginas de produto da Cor Indivisum. O objetivo é manter as páginas claras para o cliente e integrar corretamente os botões com o catálogo, carrinho e checkout existentes.

## Lista de modificações

- [x] Permitir “Adicionar ao carrinho” em páginas de produto isoladas e confirmar com um aviso simples, sem exigir que a página apresente o drawer.

## Estrutura e endereço

- Cada produto fica em `public/loja/p/<slug>/` e deve ter `index.html`.
- Use CSS e imagens próprios dentro da pasta do produto quando necessário. Prefira caminhos absolutos do site para arquivos compartilhados (`/src/...`) e caminhos relativos para arquivos da própria página (`images/...`).
- O endereço público segue `/loja/p/<slug>/`. Mantenha o slug consistente com o produto cadastrado quando esse campo for usado por links do catálogo.
- Consulte uma página existente antes de criar outra e reutilize os padrões de identidade visual do projeto. Não copie textos, preços, prazos ou imagens de outro produto sem confirmação.

## Conteúdo da página

Inclua, conforme se aplicar ao produto:

1. Título único e específico do produto, nome visível, imagem principal com texto alternativo útil e descrição objetiva.
2. Benefícios e características verificáveis. Para livros: autor, formato, número de páginas, edição/tradução quando confirmados, conteúdo e para quem a obra é indicada.
3. Preço atual, eventual preço anterior apenas quando real, condições de promoção e aviso de frete/prazo conforme informação confirmada.
4. Chamada de compra visível perto do título/preço e novamente após a descrição, quando a página for longa.
5. Informações de entrega, disponibilidade, troca/devolução e perguntas frequentes apenas quando houver dados confirmados.
6. Links funcionais para a loja e políticas relevantes já existentes. Não invente avaliações, escassez, descontos, prazos ou atributos.

Use HTML semântico: um `h1` para o nome do produto, seções com títulos em ordem, links para navegação e botões para ações. Garanta legibilidade em telas pequenas, foco de teclado, texto alternativo e rótulos acessíveis.

## Integração de compra

As páginas individuais usam as funções globais de `/src/scripts/checkout-utils.js`. Elas localizam o produto cadastrado pelo ID do documento no Firestore; não montam o checkout a partir de preço ou nome escritos no HTML.

No `<head>`, antes de `firebase-init.js`, carregue as bibliotecas compatíveis necessárias:

```html
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
```

No fim do `<body>`, nessa ordem, carregue a inicialização e os utilitários:

```html
<script src="/src/scripts/firebase-init.js"></script>
<script src="/src/scripts/checkout-utils.js"></script>
```

O ID precisa ser o ID real do documento do produto em `produtos` no Firestore, e não o slug, nome, SKU ou URL. Deixe o ID explícito em um único ponto da página para facilitar a conferência.

### Botões

**Comprar agora / Garantir meu exemplar:** chama `comprarDireto(ID)`. Essa função busca os dados atuais do produto, substitui o carrinho por esse único item e navega para `/loja/checkout`.

```html
<button type="button" class="btn btn-gold" onclick="comprarDireto('ID_REAL_DO_PRODUTO')">
  Comprar agora
</button>
```

**Adicionar ao carrinho:** chama `adicionarAoCarrinho(ID)`. A função mantém os itens existentes e aumenta a quantidade se o produto já estiver no carrinho. Na loja, abre o drawer; numa página de produto isolada, mostra um aviso de confirmação.

```html
<button type="button" class="btn btn-secondary" onclick="adicionarAoCarrinho('ID_REAL_DO_PRODUTO')">
  Adicionar ao carrinho
</button>
```

Use o nome de ação que descreve o resultado. Não use `<a href="/loja/checkout">` como botão de compra deste produto: isso abre o checkout sem colocar o produto atual no carrinho. Um link de âncora como `href="#detalhes"` ou `href="#comprar"` pode ser usado para rolar até uma seção.

### O que cada função usa

- Preço e preço promocional vêm do produto cadastrado, por `extrairDadosPreco()` em `checkout-utils.js`.
- A foto vem de `midias.fotoPrincipal` ou do campo legado `fotoPrincipal`.
- O objeto salvo no localStorage `carrinho_cor_indivisum` contém `id`, `nome`, `preco`, `foto`, `slug` e `qtd`.
- O checkout recebe o carrinho salvo. Não crie uma segunda implementação dessas funções dentro da landing e não grave um preço digitado no HTML como fonte de pagamento.
- O script de utilitários já expõe `comprarDireto`, `adicionarAoCarrinho`, `extrairDadosPreco` e `obterProdutoPorId` no escopo global da página.

## Diferenças entre página de produto e catálogo

- `public/loja/loja.js` implementa a listagem e o drawer do catálogo. Não é requisito carregar esse script numa página individual: ele depende do HTML da listagem, como `#produtos-container` e do modal de carrinho.
- `checkout-utils.js` adiciona o item ao armazenamento compartilhado do navegador. Se a página contiver o drawer da loja, a função o abre; sem drawer, confirma a inclusão com `alert`. Assim as páginas personalizadas não precisam copiar o layout do carrinho.
- `comprarDireto(ID)` substitui o carrinho atual por um item. Essa decisão de experiência já está no código atual; mantenha o rótulo “Comprar agora”/“Garantir meu exemplar” e não sugira que preserva itens anteriores.

## Scripts e mudanças

- Mantenha a ordem de carregamento: Firebase App compat → Firestore compat → `firebase-init.js` → `checkout-utils.js`.
- `firebase-init.js` deve ser incluído uma vez e define `db`, `auth` e `functions` usando a configuração compartilhada. Não replique configuração Firebase dentro da página.
- Evite scripts de terceiros para carrinho, pagamento, analytics ou pixels sem uma solicitação e decisão explícitas.
- Scripts de apresentação (por exemplo, animações) são opcionais. Devem falhar sem impedir a leitura nem a compra; respeite movimento reduzido e não bloqueie os botões.
- Não inclua chaves privadas, tokens, credenciais ou segredos. A configuração pública do Firebase já é centralizada no arquivo de inicialização.

## Revisão antes de entregar

- O ID do botão corresponde ao documento do produto correto e publicado.
- Nome, imagens, preço e condições exibidas foram conferidos com a fonte do produto; não há preço conflitante com o Firestore.
- O botão de compra carrega ambos os scripts locais na ordem indicada e usa `comprarDireto(ID)`.
- O botão não navega diretamente ao checkout sem preparar o carrinho.
- Os caminhos de imagens e CSS funcionam a partir da URL hospedada, em HTTPS e em tela estreita.
- Textos, links, foco, rótulos e textos alternativos foram revisados.
- “Adicionar ao carrinho” usa `adicionarAoCarrinho(ID)`; em páginas isoladas, a confirmação é um `alert` e não um drawer.

## Exemplo mínimo da integração

```html
<head>
  <!-- Metadados, título, CSS e Firebase compat -->
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
</head>
<body>
  <main>
    <h1>Nome confirmado do produto</h1>
    <p>Descrição do produto baseada em informações confirmadas.</p>
    <button type="button" onclick="comprarDireto('ID_REAL_DO_PRODUTO')">
      Comprar agora
    </button>
  </main>
  <script src="/src/scripts/firebase-init.js"></script>
  <script src="/src/scripts/checkout-utils.js"></script>
</body>
```

Este exemplo mostra apenas o contrato de compra. A landing completa deve incluir os metadados, estilo, conteúdo, imagens e informações de suporte apropriados ao produto.
