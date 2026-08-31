# Servidor TitanForge (Dell R210 / Debian 12) — instalação automática, headless

Guarda **todos os dados do TitanForge e do RetroAnvil, incluindo as ROMs**.
Gerência 100% remota — o servidor não tem monitor.

## O que tem aqui

| Arquivo | Pra quê |
|---|---|
| `preseed.cfg` | respostas do instalador Debian (particiona, cria usuário, pacotes, dispara o provisionamento) |
| `provision-debian.sh` | instala tudo (Node, Samba, cloudflared, Webmin, Cockpit, firewall) e cria a árvore de pastas |
| `firstboot.sh` | roda o `provision` 1x no primeiro boot e se desativa |
| `build-iso.py` | injeta os 3 acima na ISO netinst da Debian → ISO que instala sozinha |
| `make-iso.sh` | wrapper: pede a senha, gera o hash, chama o `build-iso.py` |

## 1. Gerar a ISO automática

Precisa de Python + `pip install pycdlib` (já instalado nesta máquina).

```bash
cd build-tools/server-setup
bash make-iso.sh  /caminho/debian-12.15.0-amd64-netinst.iso  debian12-titanforge-auto.iso
# ele pergunta a senha do usuario 'rogerio' (2x), gera o hash e monta a ISO
```

Baixe o netinst da Debian 12 em
<https://cdimage.debian.org/mirror/cdimage/archive/latest-oldstable/amd64/iso-cd/>
(arquivo `debian-12.15.0-amd64-netinst.iso`).

## 2. Bootar no R210 (sem monitor)

**Recomendado — iDRAC6 Virtual Media:**
1. Acesse o iDRAC pelo navegador (IP do iDRAC).
2. *Virtual Media → Connect Virtual Media → Map CD/DVD* → aponte pra `debian12-titanforge-auto.iso`.
3. *Power → Reset*, e na tela de POST mande bootar do *Virtual CD* (F11 boot menu, ou
   configure a ordem de boot no iDRAC → *Next Boot → Virtual CD/DVD*).
4. Pode acompanhar pela *Virtual Console* do iDRAC se quiser — mas não precisa tocar em nada.

**Pendrive (alternativa):** grave a ISO com **Rufus** (modo "Imagem DD" ou "ISO") ou
com **Ventoy** (só copiar a ISO pro pendrive Ventoy). Boot pelo F11.

## 3. Instalação (automática, ~10–20 min)

O instalador roda sozinho: particiona o **1º disco** (swap 1 GB + `/` ext4 no resto),
instala base + SSH, e no primeiro boot dispara o `firstboot.sh` → `provision-debian.sh`.
Log em `/var/log/titanforge-firstboot.log`.

Ao terminar, o servidor está com:
- usuário `rogerio` (sudo), senha a que você digitou no `make-iso.sh`
- SSH ligado, **DHCP** (IP fixo definido depois)
- Node 22, Samba, cloudflared, Webmin (`:10000`), Cockpit (`:9090`), ufw (só LAN)
- árvore `/srv/titanforge/{fixes,denuvo-builds,releases,roms,incoming}` e `/opt/titanforge/*`

## 4. Descobrir o IP e me passar

O servidor pega IP por DHCP. Pra achar:
- tabela de DHCP do seu roteador, ou
- `nmap -sn 192.168.0.0/24` de outra máquina, ou
- iDRAC → *System → Details* mostra o IP da NIC.

Me passa esse IP. Aí eu conecto (`ssh rogerio@<ip>`), fixo o IP na rede
(ou você faz uma reserva de DHCP no roteador — mais limpo), e sigo com os ajustes,
cópia dos dados e serviços.

## 5. Depois (feito por SSH)

- **IP fixo:** `set-static-ip.sh <ip> <gw> <dns>` (incluso) ou reserva no roteador.
- **Segundo disco / storage grande (ROMs):** particionar o 2º disco, `mkfs.ext4`,
  montar em `/srv/titanforge` (ou `/srv/titanforge/roms`), `/etc/fstab`.
  Se os 2 discos forem iguais e quiser espelho: `mdadm` RAID1.
- **Senha do Samba:** `sudo smbpasswd -a rogerio`.
- **Migrar os dados do PC Windows:**
  - `\\<ip>\titanforge` mapeado como unidade → `robocopy I:\TitanForge-Fixes Z:\fixes /E /MT:16 /XO`
  - ROMs (grande): `robocopy <origem-roms> Z:\roms /E /MT:16 /XO` ou `rsync`
- **Serviços Node:** copiar `fixes-server.js`, `license-server/`, `roms-server/` pra
  `/opt/titanforge/*`, `npm ci`, `systemctl enable --now tf-*`.
- **Cloudflare Tunnel:** `cloudflared tunnel login && create titanforge`, editar
  `/etc/cloudflared/config.yml`, `cloudflared service install`.
- **SSH por chave:** assim que der, troque senha por chave e desligue `PasswordAuthentication`.

## Árvore de pastas criada

```
/srv/titanforge/
  fixes/{denuvo,ea-origin,online-fix}   <- espelho de I:\TitanForge-Fixes
  denuvo-builds/                        <- builds antigas p/ downgrade (RE Requiem)
  releases/                            <- instaladores / update feed
  roms/                               <- ROMs do RetroAnvil
  incoming/                           <- área de recebimento via SMB/rsync
/opt/titanforge/{fixes-server,license-server,roms-server}
/var/log/titanforge/
```

## Observações do R210

- **iDRAC6:** ligue e ponha IP fixo. Enterprise (placinha adicional) dá console+virtual
  media completos; Express dá ao menos SOL/energia.
- **2 baias SATA, sem RAID de HW.** Para o volume das ROMs, use discos grandes (o R210 II
  aceita 2x até ~4–8 TB SATA) ou um gabinete externo. Redundância = `mdadm` RAID1.
- **Boot:** R210 original = BIOS; R210 II = BIOS (UEFI opcional). A ISO gerada boota nos dois.
- RAM típica 8–16 GB DDR3 ECC — sobra pro workload (base + Node + Samba usam < 1 GB).
