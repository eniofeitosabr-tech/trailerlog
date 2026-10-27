# Fase 1 — contas do Trailer Log

## Estado entregue

Telas: login.html, cadastro.html, recuperar-senha.html e nova-senha.html.
Português/English, temas claro/escuro, validação, mensagens e estado de envio.
Os formulários usam Supabase Auth; NÃO enviam registros ao banco nesta fase.

Com supabase-config.js vazio, não há download do SDK nem chamadas ao Supabase.
O aplicativo e seus dados locais continuam funcionando normalmente.

## Configuração pendente (começar em ambiente de testes)

1. Criar projeto Supabase e habilitar autenticação por e-mail/senha com confirmação.
2. Em supabase-config.js preencher somente `url` e `publishableKey`. A estrutura
   aceita projetos hospedados em `https://<projeto>.supabase.co` e chaves novas
   `sb_publishable_...`. NÃO usar senha do banco, service_role ou sb_secret_.
3. Servir os arquivos pela mesma origem HTTPS (localhost no desenvolvimento).
4. Cadastrar Site URL e Redirect URLs exatas para login.html e nova-senha.html,
   incluindo o subdiretório quando houver. Evitar curingas em produção.
5. Configurar SMTP, remetente, confirmação, recuperação e limites de envio.
6. Em banco de TESTES, revisar e aplicar migrations em ordem. Não são executadas
   pelo aplicativo. Rodar supabase/tests/rls.sql somente nesse ambiente.
7. Testar cadastro, confirmação, recuperação (inclusive link expirado), login,
   logout e troca de conta entre abas no Chrome/Android/Safari reais.

O SDK 2.118.0 é carregado do jsDelivr somente após configuração pública válida.
Para publicação, avaliar hospedagem local do bundle verificado e uma CSP adequada.
As senhas passam somente aos métodos do Auth; não são persistidas pelo código
do aplicativo. O SDK gerencia seus tokens na chave separada trailerlog-auth-session.
Não incluir tokens/sessões em backups nem em logs.

## Preservação e isolamento

O modo sem sessão usa exatamente as chaves existentes. Uma conta autenticada usa
`trailerlog:user:<UUID>:<chave>`. Não existe fallback para dados do modo local quando
esse espaço estiver vazio. Cadastro/login não copiam nem associam registros.

A identidade fica fixada durante a vida da página. Alterar a conta em outra aba
bloqueia leituras/gravações e oculta a interface anterior, até uma reabertura
explícita. Uma operação na fila verifica novamente a identidade antes de escrever.
Rascunhos continuam na memória do documento antigo; reabrir os descarta somente
por ação explícita. Logout não apaga registros ou cópias legadas.

Backup, restauração, recuperação e eventos entre abas usam o mesmo espaço da
conta. O modo local original fica intacto e volta a ser acessível sem sessão.
Isso é isolamento lógico, NÃO criptografia dos dados em computador compartilhado.
Na inicialização configurada, a identidade autenticada é verificada pelo Auth.
Se essa verificação falhar por falta de rede, o espaço da conta fica bloqueado;
não há fallback silencioso para o modo local. A política offline de contas será
tratada junto com a sincronização na fase seguinte.

## Banco preparado, não conectado aos registros

Tabelas trucks, journeys, trailer_uses e data_imports têm user_id, identificação
de origem textual (compatível com IDs antigos), RLS e vínculos por proprietário.
Não se armazenam senhas nessas tabelas. legacy_data preservará campos adicionais.
Não há inserções automáticas no cadastro, importação ou sincronização nesta fase.

A fase seguinte deve implementar RPCs transacionais, controle de revisão,
operações idempotentes, tratamento de exclusões, fila offline e importação
confirmada/repetível. NÃO liberar escrita remota de jornadas diretamente antes
dessas regras. Nenhuma funcionalidade de nuvem de registros é anunciada como pronta.

## Testes

`node tests/storage.test.cjs`, `node tests/tabs.test.cjs`,
`node tests/auth.test.cjs`. Usam Map, DOM/SDK simulados e dados fictícios.
SQL preparado para testes, mas não executado sem PostgreSQL/Supabase de testes.
Dados reais, migração e publicação não fazem parte desta entrega.
