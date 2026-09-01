# Guia básico: landing pages, GitHub Desktop e publicação

Este guia é para publicar uma nova landing page de produto sem perder o histórico das alterações.

## Regra principal

Faça sempre nesta ordem:

1. Crie ou altere os arquivos da landing page.
2. Registre as alterações no GitHub Desktop.
3. Teste em uma prévia do Firebase.
4. Publique no site oficial somente depois da conferência.

Não edite os arquivos diretamente no Firebase Console. O GitHub é o histórico e a cópia de segurança do site.

## Preparação inicial (uma única vez)

Você precisa ter:

- GitHub Desktop instalado e conectado à conta que tem acesso ao repositório;
- Node.js LTS instalado;
- acesso ao projeto Firebase `cor-indivisum`.

Abra o Terminal na pasta principal do projeto e faça login no Firebase:

```powershell
firebase login
```

Uma janela do navegador será aberta para confirmar o acesso. Não compartilhe senhas, tokens ou valores da área de Secrets.

## Criar uma landing page de produto

1. No Explorador de Arquivos, abra `public/loja/p/`.
2. Crie uma pasta com o endereço do produto, usando apenas letras minúsculas, números e hífens. Exemplo: `nome-do-livro`.
3. Dentro dela, crie pelo menos o arquivo `index.html`.
4. Se a página tiver estilo próprio, crie também um arquivo CSS na mesma pasta, por exemplo `nome-do-livro.css`.

Estrutura esperada:

```text
public/
  loja/
    p/
      nome-do-livro/
        index.html
        nome-do-livro.css
        images/
```

A página ficará disponível em:

```text
https://corindivisum.com.br/loja/p/nome-do-livro/
```

Para usar uma landing existente como ponto de partida, copie a pasta `public/loja/p/Maria-a-flauta-de-Deus/`, renomeie os arquivos e atualize as referências ao CSS e às imagens no HTML.

Antes de publicar, confira:

- título da página e imagens;
- botão de compra apontando para o ID correto do produto cadastrado;
- links, telefone/e-mail e texto de revisão;
- imagens dentro da pasta da landing ou usando caminhos iniciados por `/`;
- nenhuma chave, senha ou token adicionado aos arquivos.

## Registrar no GitHub Desktop

1. Abra o GitHub Desktop e selecione o repositório **cor_indivisum**.
2. Clique em **Fetch origin** para baixar alterações que possam ter sido feitas por outra pessoa.
3. Em **Current branch**, crie uma nova branch, por exemplo `landing/nome-do-livro`.
4. Copie ou edite os arquivos da landing page.
5. Volte ao GitHub Desktop e confira a lista de arquivos modificados.
6. Revise o diff e confirme que só há arquivos da landing e imagens esperadas.
7. Escreva um resumo claro, por exemplo: `Adiciona landing do Nome do Livro`.
8. Clique em **Commit to landing/nome-do-livro** e depois em **Push origin**.

Evite usar **Discard changes** se houver dúvida: essa ação apaga alterações locais que ainda não foram registradas.

## Testar no computador com Emulator

Antes de enviar uma prévia para a internet, abra o Terminal na pasta principal do projeto e execute:

```powershell
firebase emulators:start --only hosting
```

Abra `http://localhost:5000/loja/p/nome-do-livro/` no navegador. Confira layout, imagens, links e o botão de compra. Para encerrar o Emulator, volte ao Terminal e pressione `Ctrl + C`.

Esse teste local verifica os arquivos e rotas do site. O pagamento e os serviços externos continuam exigindo a prévia do Firebase ou o site oficial para uma verificação completa.

## Testar antes de publicar

No Terminal, na pasta principal do projeto, execute:

```powershell
firebase hosting:channel:deploy landing-nome-do-livro --expires 7d
```

O comando mostrará uma URL temporária. Abra essa URL, confira a landing no computador e no celular e teste o botão de compra.

O canal de prévia expira após sete dias. Ele não altera o site oficial.

## Publicar no site oficial

Depois de aprovar a prévia, execute:

```powershell
firebase deploy --only hosting
```

Esse comando publica apenas os arquivos do site. Ele não altera Cloud Functions, Firestore, Secrets ou pagamentos.

Abra então:

```text
https://corindivisum.com.br/loja/p/nome-do-livro/
```

e confira a página uma última vez.

## Se algo der errado

1. Não tente corrigir diretamente no site publicado.
2. Corrija os arquivos locais.
3. Faça um novo commit no GitHub Desktop.
4. Gere outra prévia e, quando estiver correta, publique novamente.

Se for necessário desfazer uma publicação, reverta o commit correspondente no GitHub Desktop e execute novamente o comando de deploy apenas do Hosting.
