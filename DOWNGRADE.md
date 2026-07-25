# Guia de Rollback / Downgrade — Umbra Launcher

O electron-updater **só atualiza pra cima**: se o usuário tem v2.5.10 e o GitHub publicar v2.5.7, o launcher ignora. Pra "voltar" os usuários, você publica uma versão MAIOR com o conteúdo antigo.

Dois caminhos: **Forward Fix** (recomendado) ou **Rollback Real** (último recurso).

---

## ✅ Forward Fix (recomendado)

Você tá em v2.5.10, descobriu um bug, e em 5min consegue corrigir. Nesse caso NÃO precisa de downgrade — só lança v2.5.11 com o fix. Auto-update de 3min entrega o conserto rápido pra todo mundo.

```bash
# 1. Faz o fix
# 2. Bump version
npm version patch --no-git-tag-version
# Edita src/renderer/pages/Launcher.tsx footer manualmente: >v2.5.11</p>

# 3. Build + release
npm run build:production
node release-update.mjs

# 4. Commit
git add package.json src/renderer/pages/Launcher.tsx <arquivos-do-fix>
git commit -m "v2.5.11 — fix <descrição>"
git push origin main
```

---

## ⏪ Rollback Real (quando o fix é complexo / arriscado)

Você tá em v2.5.10 e quer voltar TODO MUNDO pro código de v2.5.7. Estratégia: **rebuilda o código antigo com número de versão maior**.

### Passo 1 — confirmar a tag estável

```bash
git tag -l "v2.5.*" --sort=-v:refname
```

### Passo 2 — criar branch a partir da tag estável

```bash
git checkout -b rollback-to-v2.5.7 v2.5.7
```

### Passo 3 — bump pra versão MAIOR que a atual em produção

Atual em produção é `v2.5.10`. Vamos publicar `v2.5.11` com código de `v2.5.7`:

```bash
# Edita manualmente:
# - package.json: "version": "2.5.11"
# - src/renderer/pages/Launcher.tsx: >v2.5.11</p>
```

### Passo 4 — build + release

```bash
npm run clean
npm run build:production

# Edita release-update.mjs:
# const VERSION = '2.5.11';
# RELEASE_BODY = 'rollback de emergência para o estado de v2.5.7'

node release-update.mjs
```

### Passo 5 — voltar pra main e mergear o rollback

```bash
# A branch de rollback contém código antigo + número novo.
# Você precisa decidir: trazer esse código pra main ou manter main como tá?
# Recomendado: trazer pra main pra evitar drift.

git checkout main
git merge rollback-to-v2.5.7 --no-ff -m "Rollback v2.5.10 → v2.5.7 (publicado como v2.5.11)"
git push origin main
git push origin v2.5.7
```

### Passo 6 — post em `atualizacoes` (Supabase)

```sql
INSERT INTO atualizacoes (nome, content) VALUES (
  'v2.5.11 — Rollback de emergência',
  'Revertemos o launcher pro estado da v2.5.7 por causa de um problema crítico em v2.5.10. Investigação em andamento.'
);
```

---

## 🚨 Situação extrema: launcher quebrado e não consegue atualizar

Se a v2.5.10 quebrou tão feio que o auto-update não roda (ex: licenças não validam, app crasha no boot, etc), o auto-update **não vai entregar a v2.5.11** porque o app travou antes de chegar lá.

Nesse caso, o usuário precisa **reinstalar manualmente**:

1. Avisa via Discord/Instagram/email com link direto:
   - **Setup**: `https://github.com/dev-guime/VORTEX-LAUNCHER-2.0/releases/download/v2.5.11/Umbra-Launcher-Setup-2.5.11.exe`
   - **Portátil**: `https://github.com/dev-guime/VORTEX-LAUNCHER-2.0/releases/download/v2.5.11/Umbra-Launcher-2.5.11-portable.exe`

2. Usuário roda o instalador — ele sobrescreve a v2.5.10 quebrada.

3. Os dados (licença salva no localStorage) permanecem.

---

## 🔍 Saber em qual versão cada usuário está

Não temos telemetria. Pra saber, peça pro usuário olhar o footer da sidebar do launcher (`v2.5.X`).

---

## ❌ O que NÃO fazer

- **Não delete a release** no GitHub. As tags ficam "queimadas" no electron-updater (ele faz cache do `latest.yml` e fica tentando baixar uma release inexistente). Se precisar tirar uma versão do ar, **publique uma nova maior com o conteúdo certo** em vez de deletar.

- **Não reuse número de versão.** Cada release precisa ter um número único e crescente. Se publicou v2.5.11 e quer reverter o conteúdo, lance v2.5.12.

- **Não force-push em `main`** depois de publicar uma release que os usuários já receberam — você bagunça o histórico mas eles continuam com a versão errada.

- **Não publique manualmente no GitHub** sem `latest.yml`. O electron-updater precisa do `latest.yml` (gerado pelo `electron-builder`) pra detectar a release. Sempre use `node release-update.mjs` que faz upload dos 4 assets corretos.

---

## 🧪 Testar localmente antes de empurrar pra todo mundo

```bash
# Roda a versão atual sem publicar
npm run package:win
# Saída: release/Umbra Launcher Setup X.Y.Z.exe
# Instala você mesmo e testa antes de fazer node release-update.mjs
```
