# Testes de consistência

Execute `node tests/access.test.cjs` para login obrigatório: visitantes,
configuração ausente, sessão inválida/expirada, indisponibilidade, validação online
antes de gravar, isolamento A/B, legado global intacto, operações em fila e logout
com falha/retry e propagação entre abas. Nenhum serviço real é acessado.

Execute `node tests/security.test.cjs` para validar CSP, formulários desabilitados
sem JavaScript, mensagens noscript, identificação e integridade do SDK local.

Para testes reais no navegador, inicie Chrome/Edge headless com perfil temporário
isolado e `--remote-debugging-port=9229`, sem usar seu perfil pessoal. Execute
`node tests/browser-security.test.cjs` e encerre o navegador ao terminar.
O teste serve o projeto somente em localhost, usa contextos descartáveis e
intercepta toda rede externa. Verifica quatro páginas com JavaScript desabilitado,
POST nativo bloqueado pela CSP, SRI, adulteração do bundle, handlers ausentes,
login com resposta fictícia e larguras 320/1280. Também verifica as três páginas
privadas, sessão válida, legado, isolamento e logout. Nunca usa contas ou senhas reais.
O fluxo anônimo usa também a raiz do localhost: login, foco/revalidação, cadastro
de caminhão pela interface, leitura, logout e novo login com o registro preservado.
Regressões de foco/visibilidade e da primeira assinatura durante revalidação também
são verificadas em `access.test.cjs`; leituras diretas continuam bloqueadas enquanto
a validação estiver pendente.

Execute também `node tests/recovery.test.cjs` para recuperação de senha: destino
explícito, inscrição inicial do evento, validação, isolamento da sessão, links
inválidos/expirados, timeout, logout e retorno ao login. SDK e DOM são simulados;
nenhum e-mail, senha ou pedido é enviado ao Supabase.

Execute `node tests/storage.test.cjs` com Node.js. Os testes usam `Map` e contextos
JavaScript isolados para representar abas. Não abrem o navegador nem acessam seu
localStorage. Incluem as funções dos botões de jornada, histórico e backup.

Execute também `node tests/tabs.test.cjs` para sincronização de interface entre
abas simuladas: jornadas, histórico, formulários parcialmente preenchidos,
Atualizar/Continuar editando, eventos repetidos e retorno de aba suspensa.

`TrailerStorage.subscribe` compara tokens de estado e consulta novamente ao
receber eventos de armazenamento, foco e retorno de visibilidade. Não usa polling.
Rascunhos permanecem intactos; aceitar uma atualização nunca limpa seus campos.
Enquanto houver atualização pendente, ações de gravação de Registrar são bloqueadas.

## Armazenamento

- `storage.js` é o único ponto de gravação. Web Locks serializa as abas da mesma
  origem/conta e `localStorage.setItem` publica um estado em
  `trailerlog:user:<UUID>:trailerLogEstadoV2`, sem fallback de visitante.
- As quatro chaves globais antigas permanecem intactas e não são importadas.
  A leitura não grava nem migra. As fontes legadas que já pertencem ao namespace
  da conta são incorporadas na primeira operação autorizada pelo usuário,
  com identificadores estáveis e campos adicionais preservados.
- Jornadas mantêm seus IDs anteriores. `registroId` identifica cada registro,
  inclusive duplicatas legadas. Novos IDs legados usam SHA-256 compacto mais
  ocorrência; IDs já persistidos não são renomeados. Novos registros usam UUID.
- O estado compacto (versão interna 3) guarda resumos SHA-256 das fontes antigas
  em vez de duplicar seu texto. A versão interna 2 continua legível. A atualização
  ocorre somente em uma gravação solicitada; abrir a página não migra dados.
- Um JSON inválido bloqueia a operação: nunca é convertido silenciosamente em
  lista vazia. Uma falha de gravação mantém integralmente o estado anterior.
- Restauração e limpeza verificam o estado que o usuário confirmou. Exclusões
  conferem ID e conteúdo; não usam um índice antigo para remover outro registro.
- A exportação mantém o formato de backup versão 1, incluindo `registroId` como
  campo adicional. Backups anteriores e JSON legado continuam aceitos.

## Limites

Use a mesma origem (protocolo, host e porta), preferencialmente localhost ou HTTPS,
em navegador com Web Locks e `crypto.randomUUID()`. Sem Web Locks, leituras
continuam disponíveis e gravações são bloqueadas com aviso.

Feche abas que ainda executam o código anterior antes de usar a atualização.
Se alterarem as chaves antigas, o aplicativo bloqueia a leitura/gravação em vez
de escolher silenciosamente uma das cópias. Em Configurações, a seção Recuperação
entre versões permite baixar todas as cópias brutas, inclusive JSON corrompido.
Esse arquivo de diagnóstico não é aceito pela restauração comum.

A recuperação automática exige confirmação e só atualiza metadados quando cada
fonte alterada é semanticamente equivalente à origem conhecida ou aos dados
atuais. Não une listas, não descarta registros, não ressuscita exclusões e não
grava nas chaves antigas. Alterações de conteúdo ambíguas exigem comparação manual.
Falta de espaço, cancelamento e mudanças depois da verificação não alteram o estado.

As cópias legadas preservadas e o estado novo consomem espaço adicional. Falta de
espaço é reportada sem publicar alterações. A exclusão/limpeza atual retira os
registros do estado utilizado pelo aplicativo, preservando a fonte legada.

Os testes não substituem validação em navegadores reais, nem simulam perda física
do disco. Backup externo continua necessário.

As regressões incluem eventos locais/externos, recuperação equivalente/ambígua,
cópias corrompidas, confirmação desatualizada, formato V2, compatibilidade de backup,
vetores SHA-256 UTF-8 e volume fictício de 500 registros. IDs longos já existentes
são preservados por compatibilidade; o limite e o custo síncrono do localStorage
continuam existindo. Teste em dispositivos reais antes da publicação.
