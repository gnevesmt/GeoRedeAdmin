# GeoRedeAdmin — homologação de filiais

Candidato isolado. O `index.html` da raiz, que atende a versão atual, não foi alterado.

Antes de usar, preencher `config.js` com URL e **chave publicável** do projeto existente `georede-cloud`, após a implantação aprovada. Nunca inserir `service_role`. A interface exige HTTPS sem credenciais na URL e depende de `georede-access-login` e `georede-access-v2`. Definir a origem HTTPS do painel em `GEOREDE_ADMIN_ALLOWED_ORIGINS` das funções.

Master: clientes, filiais, cotas, Administradores Desktop e atribuições de filiais; licença única, prazo offline e trocas. Administradores: operadores e aparelhos apenas nas filiais recebidas. O servidor valida as permissões independentemente dos botões visíveis.

Validação local: 9 fluxos de navegador passaram com HTTP sintético (login visual, cadastro, edição, limite Master, proteção de escopo e terceira troca, mais o primeiro cliente numa base de cadastros vazia). **Não houve validação de Auth no servidor real.** A interface não está publicada nem aprovada para produção.

Testes reproduzíveis: `npm ci`, instalar Chromium pelo Playwright, `npm test`, a partir desta pasta. A suíte utiliza dados sintéticos e não faz chamadas ao servidor georede-cloud.
