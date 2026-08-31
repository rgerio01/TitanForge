#!/usr/bin/env bash
# firstboot.sh — roda 1x no primeiro boot (systemd oneshot tf-firstboot.service),
# dispara o provisionamento completo e depois se desativa.
set -uo pipefail
exec >>/var/log/titanforge-firstboot.log 2>&1
echo "=================================================================="
echo "tf-firstboot  $(date -Is)"
echo "=================================================================="

# espera a rede de fato responder (DNS + rota)
for i in $(seq 1 60); do
  if getent hosts deb.debian.org >/dev/null 2>&1; then echo "rede OK (tentativa $i)"; break; fi
  echo "aguardando rede... ($i)"; sleep 5
done

export NONINTERACTIVE=1 DEBIAN_FRONTEND=noninteractive
if [ -x /root/provision-debian.sh ]; then
  echo ">>> rodando /root/provision-debian.sh"
  bash /root/provision-debian.sh
  rc=$?
  echo ">>> provision-debian.sh saiu com codigo $rc"
else
  echo "!! /root/provision-debian.sh nao encontrado"
  rc=1
fi

date -Is > /root/.tf-provisioned
echo "$rc" >> /root/.tf-provisioned

# nao roda de novo
systemctl disable tf-firstboot.service || true
echo ">>> tf-firstboot concluido. IP atual:"
ip -4 addr show scope global | awk '/inet /{print "   "$2}'
echo ">>> pronto para SSH:  ssh rogerio@<ip>"
exit 0
