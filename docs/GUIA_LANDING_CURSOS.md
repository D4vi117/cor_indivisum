# Páginas personalizadas de cursos

O adaptador compartilhado é `/src/scripts/course-landing.js`. Ele consulta o
cadastro público, usa o preço do Firestore, controla compra e carrinho e
verifica no servidor se a conta tem acesso por resgate ou pedido pago.
Cada curso pode ter HTML e CSS próprios; não copie a lógica de compra.

Depois dos SDKs Firebase compat e `/src/scripts/firebase-init.js`, inclua:

```html
<script src="/src/scripts/course-landing.js?v=2"
        data-course-slug="Slug-do-Curso"></script>
```

Também aceita `data-course-id="ID_DO_DOCUMENTO"`, com prioridade sobre o slug.
Sem configuração, usa o slug da URL `/cursos/Slug-do-Curso/`.
O slug precisa coincidir com o admin, incluindo maiúsculas. O cadastro deve
estar publicado e ter preço maior que zero para disponibilizar a inscrição.

Elementos usados pelo script (os IDs devem ser únicos na página):

```html
<p data-course-ownership role="status" hidden></p>
<a href="#inscricao" data-course-enroll-link>Quero participar</a>
<section id="inscricao">
  <span data-course-price>Consultando preço...</span>
  <button type="button" data-course-purchase="comprar" disabled>Comprar curso</button>
  <!-- Opcional -->
  <button type="button" data-course-purchase="adicionar" disabled>Adicionar ao carrinho</button>
  <p id="course-purchase-status" role="status" aria-live="polite"></p>
  <a id="course-open-lessons" href="#aulas" hidden>Acessar minhas aulas</a>
</section>
<section id="aulas" hidden>
  <h2>Conteúdo do curso</h2>
  <div id="course-lessons"></div>
</section>
```

O contador opcional do carrinho usa `data-course-cart-count`. Pode haver vários
preços, botões e avisos `data-course-ownership`. O adaptador troca os links
`data-course-enroll-link` por acesso às aulas e esconde os botões de compra
quando a conta possui o curso. O HTML/CSS da página deve respeitar `[hidden]`.

Pedidos pendentes ou estornados não concedem acesso. A consulta usa o usuário
autenticado, nunca um UID enviado pelo navegador. Uma suspensão explícita no
registro de acesso prevalece sobre um pedido pago. Ao sair da conta, os textos
privados são retirados do DOM. Vídeos e entrega de arquivos seguem pendentes.

Publicação desta atualização: `firebase deploy --only functions,hosting`.
