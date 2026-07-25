# CLAUDE.md

Guia técnico do **Umbra Launcher** para Claude Code (claude.ai/code) e devs que vão tocar o projeto.

## Visão geral

Umbra Launcher é um app desktop **Electron + TypeScript + React** focado em gestão de jogos Steam, com:

- Sistema próprio de licença (case-insensitive, vinculada a HWID)
- Pagamentos PIX e cartão de crédito (até 12x) via **EFI Bank** com antifraude
- Anti-chargeback automático (banimento total da licença)
- Sistema de indicação ("Indique e Ganhe") com resgate de R$ 50 a cada 4 amigos
- Fórum interno da comunidade
- Tutoriais em vídeo
- Loja interna de produtos premium (Bypass, Multiplayer, Contas Oficiais, +18, Adicionar Jogos)
- Integração com bypasses extraíveis (.zip / .rar / .7z / .torrent)
- Multiplayer com mesmo sistema de extração
- Remoção de Denuvo (entrega manual via humano com pedido + PIX)
- Hot-reload de licença via Supabase Realtime (sem precisar relogar)

## Comandos

```bash
npm install
npm run dev                # main + preload + renderer + electron, todos em watch
npm run build              # build full (main + preload + renderer)
npm run build:production   # clean + build + package (gera instalador NSIS + portable)
npm run package:win        # apenas empacota Windows x64
```

Saída: `release/`. Cleanup: `npm run clean`.

## Arquitetura Electron (3 processos)

### Main (`src/main/`)

Entry: [src/main/index.ts](src/main/index.ts). Roda Node.js completo.

- **`index.ts`** — orquestração geral, registro de IPC handlers, monitor de DLL anti-burla, polling de chargeback, watch de licença em realtime, autoUpdater.
- **`efi.ts`** — cliente EFI Bank (PIX + cartão + tokenização + parcelamento + status). Usa cert `.p12` via `https.Agent` (mTLS). Token OAuth com cache.
- **`steam.ts`** — detecção da Steam (registro Windows + paths comuns), abertura/fechamento.
- **`hwid.ts`** — Hardware ID via `node-machine-id`.
- **`cache.ts`** — manager de cache de arquivos baixados.
- **`download.ts`** — Google Drive download.
- **`bypassExtractor.ts`** — baixa + extrai bypasses (.zip via adm-zip, .rar/.7z via 7z.exe, .torrent abre no cliente padrão).
- **`discordWebhook.ts`** — notificações Discord (compras + chargeback + resgates).

### Preload (`src/preload/index.ts`)

Bridge segura via `contextBridge.exposeInMainWorld('electron', api)`. Toda comunicação renderer ↔ main passa por aqui. **`contextIsolation: true`** e **`nodeIntegration: false`**.

### Renderer (`src/renderer/`)

React app puro. Não tem acesso a Node — tudo via `window.electron.*`.

```
renderer/
├── App.tsx                    # router login/launcher
├── pages/
│   ├── Login.tsx              # tela de login + abre SignupModal
│   ├── Launcher.tsx           # navbar lateral + roteamento de páginas
│   ├── DenuvoRemoval.tsx      # grid jogos, modal termos 10s, QR PIX
│   ├── Settings.tsx           # dados pessoais (editáveis), licença, hwid, ip, permissões
│   ├── ReferralPage.tsx       # código amigo, progresso, resgate R$50, histórico
│   ├── ForumPage.tsx          # lista, criar, ver post, comentar, votar (com regras)
│   └── TutoriaisPage.tsx      # accordion + embed YouTube
├── components/
│   ├── PaymentModal.tsx       # PIX + Cartão (até 12x) — UNIVERSAL para todos os produtos
│   ├── SignupModal.tsx        # cadastro novo (login) com PIX + Cartão
│   ├── BypassInstallModal.tsx # extrator de bypass / multiplayer
│   ├── CompleteProfileModal.tsx # abre se faltar nome/email/telefone
│   ├── ForumRulesModal.tsx    # countdown 10s + rotação de regras
│   ├── ForumUsernameModal.tsx # validação live de username único
│   ├── HomeEffects.tsx        # partículas / cursor glow
│   └── Icons.tsx              # ícones SVG inline
├── services/
│   ├── supabase.ts            # cliente Supabase (anon key) + tipo License
│   ├── license.ts             # validação via IPC (NÃO usa Supabase direto)
│   ├── heartbeat.ts           # checa licença a cada 5min
│   ├── denuvo.ts              # listar jogos denuvo
│   ├── bypass.ts, multiplayer.ts, store.ts, premiumAccounts.ts, etc.
│   ├── ryuuGames.ts           # base de games.json (cache em memória + thumbnails Steam)
│   └── checkouts.ts, social.ts, config.ts
├── utils/
│   ├── phone.ts               # máscara (DD) 9 XXXX-XXXX
│   ├── card.ts                # detecção de bandeira, máscaras CPF/CEP/cartão, validação CPF
│   └── efiTokenize.ts         # carrega SDK JS da EFI dinamicamente, tokeniza cartão
└── types/
    └── electron.d.ts          # tipagem do window.electron.*
```

### IPC handlers principais (no `index.ts`)

| Handler | Descrição |
|---|---|
| `license-validate`, `license-check-status`, `license-get-info` | Validação via main (server-side, sem CORS) |
| `license-watch`, `license-unwatch` | Realtime + polling 15s |
| `pix-create-order`, `pix-check-status`, `pix-list-my-orders` | PIX universal |
| `card-installments`, `card-create-order`, `card-check-status` | Cartão de crédito + parcelamento |
| `signup-create-pix`, `signup-create-card`, `signup-check-status` | Cadastro novo (login) |
| `denuvo-*` | Compat / listagem de jogos Denuvo |
| `coupon-validate` | Validação de cupom (sem debitar) |
| `referral-get-info`, `referral-list`, `referral-validate-code` | Indicação |
| `redemption-info`, `redemption-request` | Resgate R$50 |
| `forum-*` | CRUD do fórum |
| `bypass-pick-folder`, `bypass-extract`, `onBypassProgress` | Extrator de bypass |
| `tutorials-list` | Lista de tutoriais |
| `lookup-cep` | Proxy ViaCEP (sem CORS) |
| `profile-update` | Edição de email/telefone (nome só se vazio) |
| `products-list` | Preços dinâmicos de premium |
| `get-public-ip` | ipify proxy |
| `get-hwid`, `enable/disable-hid-dll`, `ensure-hid-dll-active` | DLL anti-burla |
| `download-manifestor-lua`, `download-dlc-manifest`, `update-game-files` | Steam files |
| `restart-and-update`, `check-for-updates-manually`, `get-app-version` | electron-updater |

## Regras de negócio críticas

### Pagamentos — NUNCA confie no cliente

**O preço SEMPRE vem do servidor.** O cliente só envia `productType` + `productRef` + `couponCode`. O backend (`createPixOrderInternal` em [index.ts](src/main/index.ts)) busca o preço real em `products` ou `denuvo_games`, aplica cupom atomicamente (RPC `redeem_coupon`), e cria a cobrança.

### Cupom 100% off → libera grátis sem cobrar EFI

Se desconto cobre 100% do preço, é criada uma `pix_orders` direto com `status='paid'` e a permissão é liberada via `grant_license_permission()`. Não chama EFI.

### Hot-reload de licença

Quando você muda algo em `keyvortex` (ex: vira `bypass='enable'`), o Supabase Realtime notifica o launcher do usuário em tempo real. **Sem necessidade de relogar.** Fallback de polling de 15s caso WebSocket caia. Ver `license-watch` em [index.ts](src/main/index.ts).

### Anti-chargeback automático (POLÍTICA RIGOROSA)

Polling a cada 30 minutos (`pollChargebacks`) consulta o status de **todas as cobranças por cartão** dos últimos 200 dias. Se status muda para `contested`, `unpaid`, `canceled` ou `refunded`, a função SQL `revoke_license_on_chargeback`:

1. Marca o pedido como `charged_back`
2. **Suspende a licença inteira** (`status='suspended'`)
3. **Zera todas as permissões** (`bypass`, `premiumaccounts`, `multiplayer`, `nsfw`, `add_games` → `disable`)
4. Audita em `chargeback_events`
5. Manda webhook Discord com `@here` (vermelho alarmante)
6. Notifica launcher via IPC `chargeback-detected` → toast vermelho aparece na hora

**Não importa o produto contestado** (Denuvo, Bypass, Licença Vitalícia, etc.) — chargeback = ban total. Reversão é manual via DB.

### Sistema de licença

- Geração: `NOME-DDDD-XYZ` (ex: `MATHEUS-7816-K2P`). Função SQL `create_license_from_signup` normaliza acentos, pega últimos 4 dígitos do telefone, adiciona 3 chars random.
- Default ao criar via signup: `add_games='enable'` + `status='active'` + `license_type=2` (vitalícia).
- Heartbeat 5min: se ficar inativa, desabilita DLL e força logout.

### Sistema de indicação

- Cada licença tem `friend_code` único (8 chars). Backfill já rodou para todos os usuários existentes.
- A cada 4 indicações disponíveis, o usuário pode resgatar R$ 50 via PIX (informa chave PIX + tipo).
- Função `request_referral_redemption` é atômica (`FOR UPDATE`) e marca exatamente 4 indicações com `redeemed_in_redemption=ID`. Cada indicação é usada **uma única vez**.
- Webhook Discord específico (URL diferente das compras) avisa o admin.

### Fórum

- 4 tabelas (`forum_users`, `forum_posts`, `forum_comments`, `forum_votes`).
- Username único, 3-30 chars, regex `[A-Za-z0-9_.-]`. Validação live no front (debounce 350ms).
- Modal de regras: countdown circular 10s, rotação de destaque entre 4 regras a cada 2.5s.
- Rate-limit por SQL: 5 posts/hora, 20 comentários/hora.
- Categorias hardcoded: `ideas`, `packs`, `questions`, `discussion`.
- RPC `forum_vote` é toggle (clicar 2x remove o voto; clicar no oposto inverte).

### Bypass / Multiplayer (extração)

`BypassInstallModal` reusado para os dois. Fluxo:
1. Usuário escolhe pasta destino via `dialog.showOpenDialog`
2. Backend baixa o arquivo para `os.tmpdir()/umbra-bypass`
3. Detecta formato: URL → content-type → magic bytes
4. Extrai: `.zip` (adm-zip), `.rar`/`.7z` (7z.exe externo), `.torrent` (abre no cliente padrão)
5. Limpa o tmp

### DLL anti-burla

- `dist/assets/xinput1_4.dll`.
- Hash MD5 monitorado a cada 30s.
- Desabilitada **sincronamente** em todos os hooks de quit (`before-quit`, `will-quit`, `SIGINT`, `SIGTERM`, `window-all-closed`).
- Cleanup ao iniciar (`startupDllCleanup`) — desabilita qualquer instância pendurada.

## Banco de dados (Supabase)

Schema atual:

```
keyvortex          -- licenças (key, status, license_type, hwid, nome, email, numero,
                      add_games, bypass, premiumaccounts, multiplayer, nsfw,
                      friend_code, referred_by, referral_count, referral_balance, expires_at)
                      -- CPF NÃO é armazenado aqui; é coletado apenas no checkout (EFI exige)

products           -- preços dinâmicos (type, name, price, permission_field, duration_days, active)
                      types: bypass, premiumaccounts, multiplayer, nsfw, add_games, licenca_vitalicia

coupons            -- cupons (code, discount_type, discount_value, max_uses, uses,
                      valid_until, applies_to TEXT[], active, scope)

pix_orders         -- todos os pedidos (PIX e Cartão).
                      campos card_*: payment_method, card_brand, card_installments,
                      card_charge_id, card_total_amount

chargeback_events  -- auditoria de chargebacks revogados

denuvo_games       -- jogos disponíveis para remoção de Denuvo (com preço próprio)
denuvo_orders      -- legado, sincroniza para pix_orders

referrals          -- 1 linha por amigo indicado (redeemed_in_redemption marca consumo)
referral_redemptions -- pedidos de resgate (R$50 cada, 4 indicações consumidas)

forum_users, forum_posts, forum_comments, forum_votes
tutorials          -- tutoriais em vídeo (name, video_url, description, category, display_order)

bypass             -- catálogo de bypasses (game_id, link, status: free/premium)
multiplayer_content -- catálogo de fixes multiplayer
premiumaccounts    -- contas oficiais
store              -- itens de loja
checkouts          -- legado (links Kirvano, ainda disponível mas não usado)
atualizacoes       -- changelog
config             -- configurações dinâmicas
launcher_update_config -- comando dinâmico de atualização da Steam
social             -- links sociais (WhatsApp, Discord, Instagram)
```

### RPCs essenciais

- `validate_coupon(code, product_type)` — valida cupom sem debitar
- `redeem_coupon(code, product_type)` — debita uso atomicamente
- `grant_license_permission(license, field, days)` — whitelist anti-injection
- `create_license_from_signup(nome, email, numero, referred_by, license_type)` — gera key amigável
- `register_referral(referred_key, referrer_friend_code)` — registra indicação
- `available_referrals_count(friend_code)` — conta indicações disponíveis
- `request_referral_redemption(license_key, pix_key, pix_key_type)` — solicita R$50, atômica
- `revoke_license_on_chargeback(order_id, status, reason)` — suspende licença inteira
- `forum_*` — todas as ações do fórum (validação por licença + rate-limit interno)
- `sanitize_name_for_key(nome)` — normaliza nome para key (sem acentos, max 12 chars)

### RLS

Habilitado em todas as tabelas com dados sensíveis. Funções com lógica privilegiada usam `SECURITY DEFINER` + whitelist explícita de colunas para evitar SQL injection.

### Realtime

Ativo em `keyvortex` (hot-reload de licença) e `pix_orders`.

## Build & empacotamento

### Webpack (3 configs)

- `webpack.main.config.js` — target `electron-main`, externaliza `electron`, `regedit`, `electron-updater`. **DefinePlugin** injeta credenciais do `.env.efi` no bundle.
- `webpack.preload.config.js` — target `electron-preload`.
- `webpack.renderer.config.js` — target `web`. **DefinePlugin** injeta `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `EFI_PAYEE_CODE` (todas públicas por design).

### electron-builder

- Targets Win: `nsis` (instalador) + `portable`.
- `extraResources`: `.env.efi` e `certificado.p12` (necessários em produção).
- Asar habilitado, mas `assets/**/*` em `asarUnpack` (DLL precisa ser arquivo real).
- Auto-update via electron-updater + GitHub Releases (`dev-guime/VORTEX-LAUNCHER-2.0`).

## Variáveis de ambiente

```
.env / .env.local / .env.production    # Supabase URL, anon key, service key (server only)
.env.efi                                # CLIENT_ID, CHAVE_SECRET, CHAVE_PIX, CERT_PATH, EFI_PAYEE_CODE
certificado.p12                         # certificado mTLS da EFI
```

**Todos os arquivos sensíveis estão no `.gitignore`.** Nunca comite.

### `EFI_PAYEE_CODE`

Necessário para a tokenização do cartão (SDK JS da EFI). É exposto no bundle do renderer **por design** — a EFI sabe que esse código fica no JS do navegador. Pega no painel da EFI: Conta digital → Configurações → Integrações → "Identificador da conta".

## Segurança

- **Cartão**: tokenização client-side (SDK JS da EFI). Número/CVV/validade nunca passam pelo nosso main process. Apenas `payment_token` opaco.
- **Antifraude EFI**: ativo no painel da EFI, automático em todas as cobranças de cartão.
- **Service key Supabase**: apenas no main process. Nunca exposto ao renderer.
- **Anon key Supabase**: público (RLS protege).
- **Cert .p12**: empacotado em `extraResources`, não acessível pelo renderer.
- **Preços**: server-side only.
- **Chargeback**: revogação 100% automática, sem reversão.

## Convenções

### Adicionar novo IPC handler

1. `ipcMain.handle('canal', async (_, payload) => {...})` em [src/main/index.ts](src/main/index.ts)
2. Expor em [src/preload/index.ts](src/preload/index.ts) no objeto `api`
3. Tipagem em [src/renderer/types/electron.d.ts](src/renderer/types/electron.d.ts)
4. Chamar via `window.electron.metodo()`

**Sempre rebuild o main process e reinicie o app** (mudanças no main não recarregam com hot reload).

### Adicionar novo produto premium

1. `INSERT INTO products (type, name, price, permission_field, duration_days)` no Supabase
2. Garantir que `permission_field` está na whitelist da função `grant_license_permission` (`bypass`, `premiumaccounts`, `multiplayer`, `nsfw`, `add_games`)
3. Adicionar entrada no mapa `PREMIUM_TYPE_MAP` em [Launcher.tsx](src/renderer/pages/Launcher.tsx) (descrição visual)
4. UI já reusa o `PaymentModal` automaticamente

### Adicionar novo cupom

```sql
INSERT INTO coupons (code, discount_type, discount_value, applies_to, max_uses, valid_until)
VALUES ('PROMO50', 'percent', 50, ARRAY['bypass','multiplayer'], 100, '2026-12-31 23:59:59-03');
```

`applies_to NULL` = todos os produtos.

## Estado da DLL Steam

Estrutura de arquivos quando jogo está instalado:

- `Steam/xinput1_4.dll` (DLL principal — protegida)
- `Steam/config/stplug-in/<appid>.lua` (configuração)
- `Steam/config/depotcache/<id>.manifest` (manifests)

Nunca mencione esses caminhos na UI do launcher para o usuário final (regra de UX: detalhes técnicos ficam no código, não na tela).

## Gotchas conhecidos

- Mudanças no **main process** exigem reiniciar o app inteiro. `npm run dev` não recarrega o main.
- O **`.env.efi`** precisa estar no diretório executável em produção (`extraResources` cuida disso).
- `7-Zip` (`7z.exe`) precisa estar instalado pra extrair `.rar` e `.7z`. `.zip` funciona nativo (adm-zip).
- O **Payee Code da EFI** é único por conta. Sem ele, cartão não funciona — só PIX.
- DLL fica em `app.asar.unpacked` em prod (não em `.asar`), porque DLL precisa ser um arquivo real no disco.

## Versão atual

`2.5.0` — vide [package.json](package.json) e badge no sidebar.
