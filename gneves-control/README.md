# GNEVES Control — versão de homologação

O painel foi criado em `gneves-control/` para preservar a versão atual de `homologacao/` e o redirecionamento existente da raiz.

## Módulos

- **PontoGeo App:** mantém a interface e as chamadas existentes (`georede-access-login`, `georede-access-v2` e `pontogeo-release-admin`). Não foram alteradas regras nem dados no Supabase. Os nomes internos das funções permanecem legados de propósito.
- **PontoGeo Office:** navegação e estrutura visual adicionadas. Publicação de instaladores, licenças e dispositivos ainda dependem de APIs próprias e não estão operacionais.
- **SINGER / SIGER:** navegação e estrutura visual adicionadas. Gestão de usuários, versões e serviços ainda depende de integração de backend.
- Áreas de outros sistemas só são apresentadas ao Master; a política efetiva deve ser validada no servidor quando implementada.

## Identidade e domínio

Interface renomeada como **GNEVES Control**. A marca original recuperada da Biblioteca do ChatGPT foi incluída em `assets/gneves.webp` como miniatura otimizada com transparência (arquivo original preservado fora do repositório). Existe também uma representação vetorial opcional em `assets/gneves.svg`. Endereço final planejado: `painel.gnevesmt.com.br`; DNS e hosting **não** foram alterados.

## Segurança e implantação

1. Validar interface (login, Master, administrador de cliente, troca de abas, PontoGeo App, fluxo de APK) com dados sintéticos e depois com conta de homologação.
2. Conferir allowlist CORS (`GEOREDE_ADMIN_ALLOWED_ORIGINS`) para o novo domínio antes de qualquer publicação externa. Evitar ambiente de testes apontando a dados de produção.
3. Para os outros sistemas, criar API própria, tabelas e RLS separadas, controladas pelo backend.
4. Não transferir chaves service_role nem segredos para o navegador.
5. Publicar a nova versão somente após homologação; manter versão antiga como rollback.

**Estado atual:** nova interface e navegação preparadas no branch de desenvolvimento, sem implantação no domínio, sem alteração do backend e sem capacidade de publicação para Office/SIGER. CI executa testes de interface e publicações com dados sintéticos via pull request; nenhum teste de backend real foi executado.
