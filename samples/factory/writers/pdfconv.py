"""xlsx を LibreOffice の headless で PDF にする。呼ぶたびに別の設定のフォルダを使う（並べて動かせる）。
LibreOffice が無ければ None を返す（作れなかったことは呼び出し側が数える）。"""
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

# 物語の今日（2026-10-01 00:00:00 UTC）。PDF の作成時刻をこれに固定する
EPOCH = "1790812800"
FIXED_PDF_DATE = b"D:20261001000000Z'"

_CANDIDATES = (
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
)


def find_soffice() -> str | None:
    for name in ("soffice", "libreoffice"):
        p = shutil.which(name)
        if p:
            return p
    for p in _CANDIDATES:
        if Path(p).exists():
            return p
    return None


def normalize_pdf(data: bytes) -> bytes:
    """作成日時・更新日時と /ID を固定する（同じ長さで置くので xref の位置は動かない）。
    /ID と /DocChecksum は、両方を 0 にした本文の MD5 から決める。"""
    def fix(m):
        old = m.group(2)
        return m.group(1) + FIXED_PDF_DATE[: len(old)].ljust(len(old), b"0")
    data = re.sub(rb"(/(?:CreationDate|ModDate) ?\()([^)]*)(?=\))", fix, data)
    id_re = re.compile(rb"(/ID ?\[ ?<)([0-9A-Fa-f]{32})(>\s*<)([0-9A-Fa-f]{32})(>)")
    ck_re = re.compile(rb"(/DocChecksum ?/)([0-9A-Fa-f]{32})")
    blank = id_re.sub(lambda m: m.group(1) + b"0" * 32 + m.group(3) + b"0" * 32 + m.group(5), data)
    blank = ck_re.sub(lambda m: m.group(1) + b"0" * 32, blank)
    digest = hashlib.md5(blank).hexdigest().upper().encode()
    data = id_re.sub(lambda m: m.group(1) + digest + m.group(3) + digest + m.group(5), data)
    return ck_re.sub(lambda m: m.group(1) + digest, data)


def xlsx_to_pdf(xlsx: Path, pdf: Path, soffice: str | None = None, timeout: int = 180) -> bool:
    """作れたら True。LibreOffice が無い・失敗したら False。"""
    soffice = soffice or find_soffice()
    if soffice is None:
        return False
    with tempfile.TemporaryDirectory(prefix="moyai-lo-") as prof, tempfile.TemporaryDirectory(prefix="moyai-out-") as outd:
        cmd = [soffice, "--headless", "--norestore", "--nolockcheck",
               f"-env:UserInstallation={Path(prof).resolve().as_uri()}",
               "--convert-to", "pdf:calc_pdf_Export", "--outdir", outd, str(xlsx)]
        env = dict(os.environ, SOURCE_DATE_EPOCH=EPOCH)
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=timeout, env=env)
        except (subprocess.TimeoutExpired, OSError):
            return False
        made = Path(outd) / (xlsx.stem + ".pdf")
        if r.returncode != 0 or not made.exists():
            return False
        pdf.parent.mkdir(parents=True, exist_ok=True)
        pdf.write_bytes(normalize_pdf(made.read_bytes()))
    return True
