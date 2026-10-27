# Fase 1 — contas do Trailer Log

## Estado entregue

Telas: login.html, cadastro.html, recuperar-senha.html e nova-senha.html.
Português/English, temas claro/escuro, validação, mensagens e estado de envio.
Os formulários usam Supabase Auth; NÃO enviam registros ao banco nesta fase.

O login é obrigatório para Registrar, Histórico e Configurações. Sem configuração,
o acesso é bloqueado; não há mais modo visitante para registros. Os dados antigos
continuam preservados, mas não são automaticamente associados a nenhuma conta.
Login, cadastro, solicitação de recuperação e Sobre permanecem públicos.

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

O SDK 2.118.0 é carregado de `vendor/supabase-js/supabase-2.118.0.js`, com SRI,
somente após configuração pública válida. O pacote foi conferido com o hash
`dist.integrity` do npm oficial; o bundle corresponde byte a byte ao jsDelivr.
Origem, versão, licença MIT e hashes estão em `vendor/supabase-js/provenance.json`.
A regra -text em .gitattributes preserva os bytes do bundle entre Windows e Linux.
Não há fallback para CDN. Atualizações exigem repetir a verificação, atualizar
o bundle, o manifesto e o SRI de auth.js, e executar os testes de segurança.
As quatro páginas de conta usam CSP sem scripts inline, com `form-action 'none'`
e conexões somente ao projeto configurado. Ao trocar de projeto, atualizar também
`connect-src` nessas páginas. Os controles começam desabilitados no HTML e só são
liberados após instalação dos handlers e inicialização da autenticação.
Recuperação: o template de e-mail deve usar `{{ .ConfirmationURL }}` e o destino
exato `https://eniofeitosabr-tech.github.io/trailerlog/nova-senha.html` deve estar
em Redirect URLs. O aplicativo envia esse destino em `redirectTo`; links enviados
pelo painel podem usar a Site URL. Links com `type=recovery` que chegarem a outra
página são encaminhados para nova-senha.html antes de consumir a sessão.
O fluxo usa o retorno implicit padrão do SDK, valida PASSWORD_RECOVERY e getUser,
mantém a sessão de recuperação somente em memória, com chave separada, e a encerra
antes de voltar ao login. Recarregar/fechar a página após consumir o link exige
solicitar outro e-mail. Links customizados com token_hash/PKCE não são aceitos por
este fluxo. Não copiar tokens para logs, tickets ou arquivos de teste.
As páginas principais ainda têm scripts inline legados; a CSP estrita acima está
limitada às páginas de conta. Tokens de sessões normais permanecem no armazenamento
gerenciado pelo SDK e precisam continuar protegidos contra scripts da mesma origem.
As senhas passam somente aos métodos do Auth; não são persistidas pelo código
do aplicativo. O SDK gerencia seus tokens na chave separada trailerlog-auth-session.
Não incluir tokens/sessões em backups nem em logs.

## Preservação e isolamento

Todo acesso aos registros exige sessão não expirada e usuário confirmado por
getUser no Supabase. A conta usa `trailerlog:user:<UUID>:<chave>`; sem Auth ou sem
usuário válido, as funções de leitura, gravação, backup e recuperação falham.
Não existe fallback para chaves globais ou de outra conta. Cadastro/login não
copiam nem associam registros. Backups antigos continuam aceitos por restauração
explícita e confirmada, dentro do espaço da conta autenticada.

A identidade fica fixada durante a vida da página. Alterar a conta em outra aba
bloqueia leituras/gravações e oculta a interface anterior, retornando ao login.
Cada gravação revalida a sessão online e confere novamente o proprietário ao sair
da fila. A sessão também é revalidada ao voltar à página e periodicamente (até 60s).
As verificações preventivas não fazem a interface já validada piscar.
Logout bloqueia imediatamente esta aba e as demais, encerra a sessão local do SDK
e volta ao login. Se falhar, um marcador sem credenciais mantém o bloqueio e a
próxima tentativa conclui o logout antes de permitir qualquer acesso.
Rascunhos não salvos podem ser perdidos ao mudar de conta ou sair; registros já
salvos e cópias legadas nunca são apagados pelo logout.

Backup, restauração, recuperação e eventos entre abas usam o mesmo espaço da
conta. O legado global original fica intacto, sem acesso pelo aplicativo e sem
importação automática; uma migração futura exige decisão explícita de propriedade.
Isso é isolamento lógico, NÃO criptografia dos dados em computador compartilhado.
Na inicialização configurada, a identidade autenticada é verificada pelo Auth.
Se essa verificação falhar por falta de rede, o espaço da conta fica bloqueado;
não há fallback silencioso para o modo local. Não há acesso offline autorizado.
Uma indisponibilidade não sinalizada pelo navegador é detectada na próxima
verificação; até lá uma sessão já validada e não expirada permanece válida no
cliente. Dados no localStorage não são criptografados: esta proteção não impede
leitura por DevTools, extensões ou código malicioso da mesma origem.

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
