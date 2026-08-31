#!/usr/bin/env python3
"""
build-iso.py — injeta preseed + scripts numa ISO netinst da Debian 12 e gera
uma ISO que instala TUDO sozinha (headless, sem monitor).

  python build-iso.py --in debian-12.15.0-amd64-netinst.iso \
                      --out debian12-titanforge-auto.iso \
                      --pwhash '$6$...'      # hash SHA-512 da senha do usuario 'rogerio'

Precisa: pip install pycdlib
Boot recomendado: montar a ISO pelo Virtual Media do iDRAC6 (boota como CD).
Para pendrive: gravar com Rufus (modo imagem) ou Ventoy.
"""
import argparse, io, os, sys

try:
    import pycdlib
except ImportError:
    sys.exit("faltou: pip install pycdlib")

HERE = os.path.dirname(os.path.abspath(__file__))

APPEND = ("auto=true priority=critical preseed/file=/cdrom/preseed.cfg "
          "language=en country=US locale=en_US.UTF-8 keymap=us net.ifnames=0 --- quiet")

TXT_CFG = f"""\
label auto
\tmenu label ^Automated TitanForge install
\tkernel /install.amd/vmlinuz
\tappend vga=788 initrd=/install.amd/initrd.gz {APPEND}
label install
\tmenu label ^Install
\tkernel /install.amd/vmlinuz
\tappend vga=788 initrd=/install.amd/initrd.gz --- quiet
"""

ISOLINUX_CFG = """\
path\x20
prompt 0
timeout 5
include menu.cfg
default auto
"""

GRUB_CFG = f"""\
set default=0
set timeout=3
set timeout_style=hidden
menuentry "Automated TitanForge install" {{
\tlinux /install.amd/vmlinuz {APPEND}
\tinitrd /install.amd/initrd.gz
}}
menuentry "Debian installer (manual)" {{
\tlinux /install.amd/vmlinuz --- quiet
\tinitrd /install.amd/initrd.gz
}}
"""

# alvo iso_path -> conteudo novo
REPLACE = {
    "/ISOLINUX/TXT.CFG;1":      ("/isolinux/txt.cfg",      TXT_CFG),
    "/ISOLINUX/ISOLINUX.CFG;1": ("/isolinux/isolinux.cfg", ISOLINUX_CFG),
    "/BOOT/GRUB/GRUB.CFG;1":    ("/boot/grub/grub.cfg",    GRUB_CFG),
}


def rr_of(iso, rr_path):
    """confere se um caminho Rock Ridge existe na ISO"""
    try:
        iso.get_record(rr_path=rr_path)
        return True
    except Exception:
        return False


def put_file(iso, iso_path, rr_path, data, has_joliet):
    blob = data.encode() if isinstance(data, str) else data
    joliet = rr_path if has_joliet else None
    # tenta sobrescrever in-place (nao mexe no layout / El Torito)
    try:
        iso.modify_file_in_place(io.BytesIO(blob), len(blob), iso_path,
                                 rr_name=os.path.basename(rr_path), joliet_path=joliet)
        return "in-place"
    except Exception as e:
        # nao coube: remove e re-adiciona
        try:
            iso.rm_file(iso_path, rr_name=os.path.basename(rr_path), joliet_path=joliet)
        except Exception:
            pass
        iso.add_fp(io.BytesIO(blob), len(blob), iso_path,
                   rr_name=os.path.basename(rr_path), joliet_path=joliet)
        return f"re-add ({e.__class__.__name__})"


def add_new(iso, name, data, has_joliet):
    blob = data if isinstance(data, bytes) else data.encode()
    iso_path = "/" + name.upper().replace(".", ".") + ";1"
    # nomes 8.3: PRESEED.CFG / PROVISIO.SH / FIRSTBOO.SH
    base = name.rsplit(".", 1)
    stem = base[0][:8].upper()
    ext = (base[1][:3].upper() if len(base) > 1 else "")
    iso_path = f"/{stem}.{ext};1" if ext else f"/{stem};1"
    joliet = "/" + name if has_joliet else None
    try:
        iso.rm_file(iso_path, rr_name=name, joliet_path=joliet)
    except Exception:
        pass
    iso.add_fp(io.BytesIO(blob), len(blob), iso_path, rr_name=name, joliet_path=joliet)
    return iso_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    ap.add_argument("--pwhash", required=True, help="hash SHA-512 (openssl passwd -6 ...)")
    ap.add_argument("--preseed", default=os.path.join(HERE, "preseed.cfg"))
    ap.add_argument("--provision", default=os.path.join(HERE, "provision-debian.sh"))
    ap.add_argument("--firstboot", default=os.path.join(HERE, "firstboot.sh"))
    a = ap.parse_args()

    if not a.pwhash.startswith("$6$"):
        sys.exit("--pwhash tem que ser um hash SHA-512 crypt ($6$...). Gere com: openssl passwd -6")

    preseed = open(a.preseed, encoding="utf-8").read().replace("__USERPWHASH__", a.pwhash)
    provision = open(a.provision, "rb").read().replace(b"\r\n", b"\n")
    firstboot = open(a.firstboot, "rb").read().replace(b"\r\n", b"\n")

    iso = pycdlib.PyCdlib()
    iso.open(a.src)
    has_joliet = iso.has_joliet()
    has_rr = iso.has_rock_ridge()
    print(f"ISO aberta | Rock Ridge={has_rr} Joliet={has_joliet}")
    if not has_rr:
        sys.exit("ISO sem Rock Ridge — inesperado para netinst Debian.")

    for iso_path, (rr_path, content) in REPLACE.items():
        if not rr_of(iso, rr_path):
            print(f"  aviso: {rr_path} nao existe, pulando")
            continue
        how = put_file(iso, iso_path, rr_path, content, has_joliet)
        print(f"  reescrito {rr_path}  [{how}]")

    for name, blob in [("preseed.cfg", preseed), ("provision-debian.sh", provision),
                       ("firstboot.sh", firstboot)]:
        p = add_new(iso, name, blob, has_joliet)
        print(f"  adicionado /{name}  -> {p}")

    print("gravando...")
    iso.write(a.dst)
    iso.close()

    # sanity: reabre e confere
    chk = pycdlib.PyCdlib()
    chk.open(a.dst)
    ok = rr_of(chk, "/preseed.cfg")
    try:
        chk.get_record(rr_path="/preseed.cfg")
    except Exception:
        ok = False
    boot = chk.eltorito_boot_catalog is not None
    chk.close()
    print(f"\nOK -> {a.dst}  ({os.path.getsize(a.dst):,} bytes)")
    print(f"   /preseed.cfg presente: {ok}   El Torito preservado: {boot}")
    if not (ok and boot):
        sys.exit("ALGO FALHOU na verificacao — nao use essa ISO.")


if __name__ == "__main__":
    main()
