# Servidor TitanForge (Dell R210 / Debian 12)

Servidor local pra hospedar o mirror de fixes, os serviços Node e a
transferência de arquivos entre máquinas pela rede.

## 1. Instalar a Debian 12

- Baixe o **netinst** de https://www.debian.org/distrib/ (amd64).
- Grave num USB com Rufus em **modo DD**, ou use o *Virtual Media* do iDRAC6.
- R210 = BIOS legado; R210 II = BIOS (UEFI opcional). Escolha o modo de boot certo.
- No particionamento, se quiser redundância entre os 2 discos: **RAID 1 por
  software (mdadm)** direto no instalador. Senão, disco único + backup do
  `/opt/titanforge` e do banco de licença.
- Instale **só** "SSH server" + "standard system utilities" (sem desktop).
- Depois do 1º boot, entre por SSH e rode o provisionamento.

## 2. Provisionar

```bash
# no servidor, como root
wget https://raw.githubusercontent.com/rgerio01/TitanForge/novo-umbra-main/build-tools/server-setup/provision-debian.sh
# ou copie o arquivo via scp
nano provision-debian.sh      # ajuste LAN_CIDR e SHARE_USER no topo
sudo bash provision-debian.sh
```

Instala: Node 22, Samba, cloudflared, Webmin (+Cockpit opcional), fail2ban,
unattended-upgrades. Cria os usuários e a árvore `/srv/titanforge`. Configura
firewall (tudo restrito à LAN). Cria os serviços systemd.

## 3. Árvore de pastas

```
/srv/titanforge/
  fixes/
    denuvo/          <- espelho de I:\TitanForge-Fixes\denuvo
    ea-origin/
    online-fix/
  denuvo-builds/     <- builds antigas p/ downgrade (RE Requiem etc.)
  releases/          <- instaladores do launcher / update feed
  roms/              <- catálogo RetroAnvil, se migrar pra cá
  incoming/          <- área de recebimento antes de organizar
/opt/titanforge/
  fixes-server/      <- fixes-server.js  (serviço tf-fixes-server)
  license-server/    <- server.js + npm ci
  roms-server/       <- server.js + npm ci
/var/log/titanforge/
```

## 4. Migrar os arquivos do PC Windows (via rede)

### Opção A — Samba + robocopy (mais simples pro Windows)

No Windows, mapeia o compartilhamento (Explorer → "Mapear unidade de rede"):

```
\\<ip-do-servidor>\titanforge      usuário: rogerio   senha: (a do smbpasswd)
```

Depois, no `cmd` ou PowerShell:

```bat
robocopy I:\TitanForge-Fixes            Z:\fixes         /E /MT:16 /R:2 /W:2 /XO /TEE /LOG:%TEMP%\mig-fixes.log
robocopy "E:\TitanForge\Denuvo"         Z:\denuvo-builds /E /MT:8  /R:2 /W:2 /XO
robocopy "E:\TitanForge\TitanForge\release" Z:\releases  /E /MT:8  /R:2 /W:2 /XO
```

`/XO` = só copia o que é mais novo → dá pra re-rodar pra sincronizar depois.
`/MT:16` = 16 threads (satura rede gigabit).

### Opção B — rsync sobre SSH (melhor pra sincronizações incrementais)

Precisa de `rsync` no Windows (via **WSL**, **cwRsync** ou Git-Bash com rsync).

```bash
rsync -avh --progress --partial \
  /mnt/i/TitanForge-Fixes/  rogerio@<ip>:/srv/titanforge/fixes/
```

rsync só transfere as diferenças — ideal pro dia a dia depois da carga inicial.

### Opção C — no próprio servidor

Se algum arquivo estiver acessível por HTTP (ex: o `/files/` do ryuu que não
exige auth), dá pra puxar direto no servidor com `wget`/`curl` sem passar pelo
PC Windows.

## 5. Subir os serviços

```bash
# copie fixes-server.js pro lugar
scp build-tools/denuvo-audit/fixes-server.js  rogerio@<ip>:/tmp/
ssh <ip> 'sudo mv /tmp/fixes-server.js /opt/titanforge/fixes-server/ && sudo chown tfsvc:tfsvc /opt/titanforge/fixes-server/fixes-server.js'
ssh <ip> 'sudo systemctl enable --now tf-fixes-server && curl -s localhost:8790/healthz'
```

license-server / roms-server: copie a pasta, `cd` nela, `sudo -u tfsvc npm ci`,
crie o `.env`, descomente o `EnvironmentFile` no `.service`, e
`systemctl enable --now tf-license-server` / `tf-roms-server`.

## 6. Cloudflare Tunnel (expor pra fora)

```bash
sudo cloudflared tunnel login
sudo cloudflared tunnel create titanforge
sudo nano /etc/cloudflared/config.yml
```

```yaml
tunnel: titanforge
credentials-file: /root/.cloudflared/<uuid>.json
ingress:
  - hostname: fixes.microhelp.net.br
    service: http://127.0.0.1:8790
  - hostname: lic.microhelp.net.br
    service: http://127.0.0.1:3000
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Depois, no launcher, aponte o `MIRROR_BASE` / `fix_href` pro `https://fixes.microhelp.net.br/fixes/...`
em vez do `127.0.0.1:8790` (aí funciona pra clientes remotos também).

## 7. Gerenciamento

- **Webmin** `https://<ip>:10000` — usuários, Samba, cron, systemd, discos,
  pacotes, terminal web, editor de arquivos. É o "tipo Webmin" que você pediu.
- **Cockpit** `https://<ip>:9090` — painel moderno: métricas em tempo real,
  logs (journald), status dos serviços, terminal. Mais leve; complementa o Webmin.
- **iDRAC6** (IP próprio) — camada de hardware: liga/desliga, console mesmo com
  o SO travado, sensores/temperatura. Ponha IP fixo nele.

## Manutenção

- `unattended-upgrades` já aplica patches de segurança sozinho.
- Backup: `/opt/titanforge` (código + .env) e o banco do license-server.
  O `/srv/titanforge/fixes` é re-baixável — não precisa backup, só espaço.
- `journalctl -u tf-fixes-server -f` pra acompanhar um serviço.
