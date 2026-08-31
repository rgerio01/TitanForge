#!/usr/bin/env bash
# make-iso.sh — wrapper interativo do build-iso.py
#   bash make-iso.sh <netinst-in.iso> [saida.iso]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

SRC="${1:?uso: make-iso.sh <debian-12.x-amd64-netinst.iso> [saida.iso]}"
OUT="${2:-debian12-titanforge-auto.iso}"
[ -f "$SRC" ] || { echo "nao achei: $SRC"; exit 1; }

command -v openssl >/dev/null || { echo "precisa do openssl"; exit 1; }
python -c "import pycdlib" 2>/dev/null || { echo "precisa: pip install pycdlib"; exit 1; }

read -rs -p "Senha do usuario 'rogerio' no servidor: " P1; echo
read -rs -p "Confirme a senha: " P2; echo
[ -n "$P1" ] || { echo "senha vazia"; exit 1; }
[ "$P1" = "$P2" ] || { echo "as senhas nao batem"; exit 1; }

HASH="$(printf '%s' "$P1" | openssl passwd -6 -stdin)"
unset P1 P2

python "$HERE/build-iso.py" --in "$SRC" --out "$OUT" --pwhash "$HASH"

echo
echo "sha256 da ISO gerada:"
sha256sum "$OUT" 2>/dev/null || shasum -a 256 "$OUT"
echo
echo "Proximo: monte '$OUT' pelo Virtual Media do iDRAC6 (ou grave com Rufus/Ventoy) e ligue o R210."
