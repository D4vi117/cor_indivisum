# Landing page — Poemas de Natal

Pasta pronta para instalação em `public/loja/p/Poemas-de-Natal/` no site da loja. Copie todo o conteúdo desta pasta, incluindo `assets`. Os caminhos de CSS, imagens e scripts usam `/loja/p/Poemas-de-Natal/`, inclusive quando a URL é aberta sem barra final.

O ID real do documento Firestore está declarado uma única vez em `storefront-config.js`, conforme informado pelo responsável. Os quatro botões usam as funções compartilhadas `comprarDireto(ID)` e `adicionarAoCarrinho(ID)` de `/src/scripts/checkout-utils.js`. A compra direta substitui o carrinho pelo exemplar; adicionar preserva os itens e usa a confirmação padrão da loja.

O preço é consultado com `obterProdutoPorId` e formatado com `extrairDadosPreco`. Preço anterior só aparece se os utilitários identificarem desconto válido. A página não implementa carrinho ou pagamento próprios.

A inicialização compartilhada requer Firebase App, Firestore, Auth e Functions compat, carregados antes de `/src/scripts/firebase-init.js`. Não é necessário carregar `loja.js` nem adicionar drawer.

A visualização e a compra dependem do ambiente da loja; abrir o HTML por `file://` não testa a integração. Nenhuma publicação está incluída nesta alteração local.

Mantidas as informações editoriais existentes, sem pesquisa ou revisão do cadastro público, conforme solicitado. Formato, paginação e prazo continuam a confirmar. Não foram encontrados arquivos de políticas no repositório local consultado; não foram inventados links ou condições de troca/devolução.
