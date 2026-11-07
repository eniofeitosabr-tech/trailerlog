# Publicação por artefato

O site deve ser publicado exclusivamente a partir dos 36 caminhos de
`scripts/pages-files.txt`. `scripts/build-pages.cjs` valida referências HTML/CSS,
o SDK carregado dinamicamente, SRI, identidades/segredos embutidos e igualdade
byte a byte, e copia apenas esses caminhos para `_site/`. Não copia a raiz,
testes, SQL, documentos internos, ferramentas de manutenção ou evidências.

## Pré-requisito antes de qualquer push desta release

Em **Settings → Pages → Build and deployment → Source**, selecionar
**GitHub Actions**. Confirmar que não continua **Deploy from a branch → main /
(root)**. Adicionar um workflow não muda essa configuração administrativa.
Enquanto a origem antiga estiver ativa, um push poderá publicar a raiz, mesmo
sem executar o workflow novo. A configuração remota precisa ser confirmada
manualmente antes de push; a preparação local não comprova seu estado.

Não reescrever o histórico. O UUID real anteriormente presente em um teste foi
substituído por uma fixture no estado preparado, mas versões históricas podem
continuar no repositório público. Dados privados não devem ser commitados em
nenhuma pasta, mesmo quando fora do artefato Pages. `.gitignore` não protege
arquivos já rastreados; revisar sempre `git diff --cached`.

## Verificações locais

```text
node tests/pages-artifact.test.cjs
node tests/daily-sync-status.test.cjs
node scripts/build-pages.cjs
```

O builder recusa sobrescrever diretório não vazio e nunca o apaga. Para repetir
a validação sem remover um artefato existente, usar a API `build({ output })`
com um diretório novo. `_site/` é ignorado e não deve ser commitado.

## Publicação futura, somente após autorização

1. Confirmar a origem **GitHub Actions**, revisar staging e criar o commit aprovado.
2. Fazer push somente após autorização separada.
3. Em Actions, escolher **Publish reviewed Pages artifact → Run workflow** na
   branch main. O workflow é exclusivamente manual: não tem trigger de push.
4. O job build roda os testes da fronteira pública e do status, constrói os 36
   arquivos e envia apenas `_site/`. O job deploy publica esse artefato, usando
   o ambiente github-pages; nunca a raiz do repositório.
5. Conferir o resultado do deployment, autenticação, pagamentos, tarifas,
   paradas, histórico e sincronização em conta de teste, em duas sessões e F5.

Não reaplicar migrations, limpar filas, restaurar backups ou alterar dados no
Supabase como parte desta publicação. Não usar roteiros antigos de `release/`
para substituir os arquivos atuais. Reversão do frontend requer um novo commit
revisado e uma nova execução manual do workflow, sem reescrever histórico.

Referências oficiais da configuração:
[workflows personalizados de Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
e [setup-node](https://github.com/actions/setup-node).
