#!/usr/bin/env bash
# set-static-ip.sh — fixa o IP do servidor (Debian, ifupdown).
#   sudo bash set-static-ip.sh <ip/cidr> <gateway> [dns1] [dns2] [iface]
# ex: sudo bash set-static-ip.sh 192.168.1.50/24 192.168.1.1 192.168.1.1 1.1.1.1
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "rode com sudo"; exit 1; }

IPCIDR="${1:?ip/cidr, ex 192.168.1.50/24}"
GW="${2:?gateway, ex 192.168.1.1}"
DNS1="${3:-1.1.1.1}"
DNS2="${4:-8.8.8.8}"
IFACE="${5:-$(ip -o -4 route show to default | awk '{print $5; exit}')}"

echo "iface=$IFACE  ip=$IPCIDR  gw=$GW  dns=$DNS1 $DNS2"
cp /etc/network/interfaces "/etc/network/interfaces.bak.$(date +%s)"

cat > /etc/network/interfaces <<EOF
source /etc/network/interfaces.d/*

auto lo
iface lo inet loopback

auto $IFACE
iface $IFACE inet static
    address $IPCIDR
    gateway $GW
    dns-nameservers $DNS1 $DNS2
EOF

# resolvconf/systemd-resolved podem ignorar dns-nameservers; grava direto tambem
if [ ! -L /etc/resolv.conf ]; then
  printf 'nameserver %s\nnameserver %s\n' "$DNS1" "$DNS2" > /etc/resolv.conf
fi

echo "aplicando (a conexao SSH pode cair — reconecte no IP novo)..."
systemctl restart networking || { ifdown "$IFACE" || true; ifup "$IFACE"; }
sleep 2
ip -4 addr show "$IFACE" | awk '/inet /{print "  agora: "$2}'
echo "pronto. teste:  ping -c1 $GW  &&  getent hosts deb.debian.org"
