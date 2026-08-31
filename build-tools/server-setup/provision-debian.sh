#!/usr/bin/env bash
# ============================================================================
# provision-debian.sh — prepara um servidor Debian 12 (ex: Dell R210) pra
# hospedar o TitanForge: mirror de fixes, servidores Node, transferencia de
# arquivos pela rede (Samba + rsync), Cloudflare Tunnel e Webmin.
#
# Rodar como root numa Debian 12 limpa:  sudo bash provision-debian.sh
# Idempotente: pode rodar de novo sem quebrar nada.
# ============================================================================
set -euo pipefail

SHARE_USER="${SHARE_USER:-rogerio}"        # usuario Samba que o Windows vai usar
LAN_CIDR="${LAN_CIDR:-192.168.0.0/16}"     # sua rede local (ajuste!)
NODE_MAJOR="${NODE_MAJOR:-22}"             # Node LTS
SVC_USER="tfsvc"                           # usuario de servico (sem login)

log(){ printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "rode como root (sudo)"; exit 1; }

# ---------------------------------------------------------------------------
log "1/9  base do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y full-upgrade
apt-get install -y --no-install-recommends \
  ca-certificates curl wget gnupg lsb-release apt-transport-https \
  openssh-server sudo git rsync unzip zip p7zip-full unar \
  htop tmux vim nano less jq \
  ufw fail2ban unattended-upgrades \
  samba samba-common-bin \
  build-essential
dpkg-reconfigure -f noninteractive unattended-upgrades

# ---------------------------------------------------------------------------
log "1b/9  ssh: garante que sobe no boot"
systemctl enable --now ssh 2>/dev/null || systemctl enable --now sshd 2>/dev/null || true

log "2/9  Node.js ${NODE_MAJOR}.x (NodeSource)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node -v

# ---------------------------------------------------------------------------
log "3/9  usuarios e arvore de pastas"
id "$SVC_USER" &>/dev/null || useradd -r -M -d /srv/titanforge -s /usr/sbin/nologin "$SVC_USER"
getent group tfshare &>/dev/null || groupadd tfshare
id "$SHARE_USER" &>/dev/null || useradd -M -s /usr/sbin/nologin -G tfshare "$SHARE_USER"
usermod -aG tfshare "$SHARE_USER"

mkdir -p /srv/titanforge/{fixes/{denuvo,ea-origin,online-fix},denuvo-builds,releases,roms,incoming}
mkdir -p /opt/titanforge/{fixes-server,license-server,roms-server}
mkdir -p /var/log/titanforge
chown -R "$SVC_USER":tfshare /srv/titanforge
chmod -R 2775 /srv/titanforge
chown -R "$SVC_USER":"$SVC_USER" /opt/titanforge /var/log/titanforge

# ---------------------------------------------------------------------------
log "4/9  Samba (compartilhamento p/ o Windows: \\\\<ip>\\titanforge)"
if ! grep -q '^\[titanforge\]' /etc/samba/smb.conf; then
  cat >> /etc/samba/smb.conf <<EOF

[titanforge]
   path = /srv/titanforge
   browseable = yes
   read only = no
   valid users = @tfshare
   force user = $SVC_USER
   force group = tfshare
   create mask = 0664
   directory mask = 2775
   veto files = /.DS_Store/Thumbs.db/desktop.ini/
EOF
fi
systemctl enable --now smbd nmbd
if [ -t 0 ] && [ "${NONINTERACTIVE:-0}" != "1" ]; then
  echo ">> defina a senha Samba do usuario '$SHARE_USER':"
  smbpasswd -a "$SHARE_USER" || true
else
  echo ">> [nao-interativo] senha Samba de '$SHARE_USER' NAO definida — rode depois:  sudo smbpasswd -a $SHARE_USER"
fi

# ---------------------------------------------------------------------------
log "5/9  cloudflared (Cloudflare Tunnel)"
if ! command -v cloudflared >/dev/null; then
  mkdir -p /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
  apt-get update && apt-get install -y cloudflared
fi
echo ">> depois: cloudflared tunnel login  &&  cloudflared tunnel create titanforge"
echo ">> e edite /etc/cloudflared/config.yml apontando pros servicos locais"

# ---------------------------------------------------------------------------
log "6/9  Webmin (repo oficial, painel em https://<ip>:10000)"
if ! dpkg -s webmin &>/dev/null; then
  curl -fsSL https://raw.githubusercontent.com/webmin/webmin/master/setup-repos.sh -o /tmp/webmin-repos.sh
  sh /tmp/webmin-repos.sh -f
  apt-get install -y --install-recommends webmin
fi
# root fica travado -> libera o login do '$SHARE_USER' no Webmin via PAM (senha do sistema)
if [ -f /etc/webmin/miniserv.users ]; then
  grep -q "^$SHARE_USER:" /etc/webmin/miniserv.users || echo "$SHARE_USER:x:0" >> /etc/webmin/miniserv.users
  if [ -f /etc/webmin/webmin.acl ] && ! grep -q "^$SHARE_USER:" /etc/webmin/webmin.acl; then
    sed -n "s/^root:/$SHARE_USER:/p" /etc/webmin/webmin.acl >> /etc/webmin/webmin.acl
  fi
  systemctl restart webmin || true
fi
# opcional: Cockpit (console web moderno da Red Hat, mais leve p/ metricas/logs)
apt-get install -y cockpit || true
systemctl enable --now cockpit.socket || true

# ---------------------------------------------------------------------------
log "7/9  servicos systemd (fixes-server; templates p/ os outros)"
cat > /etc/systemd/system/tf-fixes-server.service <<EOF
[Unit]
Description=TitanForge fixes-server (mirror de fixes na porta 8790)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
Environment=FIXES_DIR=/srv/titanforge/fixes
Environment=PORT=8790
WorkingDirectory=/opt/titanforge/fixes-server
ExecStart=/usr/bin/node /opt/titanforge/fixes-server/fixes-server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/log/titanforge
ReadOnlyPaths=/srv/titanforge/fixes

[Install]
WantedBy=multi-user.target
EOF

for s in license-server roms-server; do
  [ -f "/etc/systemd/system/tf-${s}.service" ] || cat > "/etc/systemd/system/tf-${s}.service" <<EOF
[Unit]
Description=TitanForge ${s}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
WorkingDirectory=/opt/titanforge/${s}
ExecStart=/usr/bin/node /opt/titanforge/${s}/server.js
Restart=on-failure
RestartSec=3
# EnvironmentFile=/opt/titanforge/${s}/.env   # crie e descomente p/ segredos

[Install]
WantedBy=multi-user.target
EOF
done
systemctl daemon-reload
echo ">> depois de copiar o codigo: systemctl enable --now tf-fixes-server"

# ---------------------------------------------------------------------------
log "8/9  firewall (ufw) — tudo restrito a LAN ($LAN_CIDR)"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$LAN_CIDR" to any port 22    proto tcp   comment 'ssh'
ufw allow from "$LAN_CIDR" to any port 10000 proto tcp   comment 'webmin'
ufw allow from "$LAN_CIDR" to any port 9090  proto tcp   comment 'cockpit'
ufw allow from "$LAN_CIDR" to any port 445   proto tcp   comment 'samba'
ufw allow from "$LAN_CIDR" to any port 139   proto tcp   comment 'samba'
ufw allow from "$LAN_CIDR" to any port 8790  proto tcp   comment 'fixes-server LAN'
# cloudflared sai por conexao de saida — nao precisa porta de entrada
ufw --force enable
ufw status verbose

# ---------------------------------------------------------------------------
log "9/9  fail2ban + resumo"
systemctl enable --now fail2ban

IP=$(hostname -I | awk '{print $1}')
cat <<EOF

============================================================
  PRONTO. Servidor em $IP

  Compartilhamento Windows : \\\\$IP\\titanforge   (usuario: $SHARE_USER)
  Webmin                   : https://$IP:10000
  Cockpit                  : https://$IP:9090
  fixes-server (LAN)       : http://$IP:8790/healthz   (apos subir o servico)

  Arvore criada em /srv/titanforge :
    fixes/{denuvo,ea-origin,online-fix}   <- espelho de I:\\TitanForge-Fixes
    denuvo-builds/                        <- builds antigas p/ downgrade
    releases/  roms/  incoming/

  PROXIMOS PASSOS
  1) Copie o codigo dos servicos:
       - fixes-server.js  ->  /opt/titanforge/fixes-server/
       - license-server/  ->  /opt/titanforge/license-server/   (+ npm ci)
       - roms-server/     ->  /opt/titanforge/roms-server/       (+ npm ci)
  2) Migre os arquivos do PC Windows (veja README.md):
       robocopy I:\\TitanForge-Fixes  Z:\\fixes  /E /MT:16 /R:2 /W:2 /XO
  3) systemctl enable --now tf-fixes-server
  4) cloudflared tunnel login && cloudflared tunnel create titanforge
     e /etc/cloudflared/config.yml -> ingress p/ 127.0.0.1:8790 etc.
  5) Ajuste LAN_CIDR no topo deste script se sua rede nao for $LAN_CIDR
============================================================
EOF
