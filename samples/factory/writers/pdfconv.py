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


_OBJ_RE = re.compile(rb"(\d+) 0 obj\n(.*?)endobj\n\n?", re.S)
_REF_RE = re.compile(rb"(\d+) 0 R")


def renumber_objects(data: bytes) -> bytes:
    """オブジェクト番号を、trailer の /Root・/Info からたどった順に振り直し、xref を書き直す。
    LibreOffice は字体の埋め込みを集合の順で書くので、同じ入力でも実行ごとに番号と並びが入れ替わる。
    形が想定と違えば（オブジェクトが無い・数が合わない）そのまま返す。"""
    xpos = data.rfind(b"\nxref\n")
    tpos = data.rfind(b"trailer\n")
    spos = data.rfind(b"startxref\n")
    if min(xpos, tpos, spos) < 0:
        return data
    objs: dict[int, bytes] = {}
    first = None
    for m in _OBJ_RE.finditer(data, 0, xpos + 1):
        if first is None:
            first = m.start()
        objs[int(m.group(1))] = m.group(2)
    trailer = data[tpos + len(b"trailer\n"):spos]
    size = re.search(rb"/Size (\d+)", trailer)
    if not objs or size is None or int(size.group(1)) != len(objs) + 1:
        return data

    def split(body: bytes) -> tuple[bytes, bytes]:
        i = body.find(b"stream\n")
        return (body, b"") if i < 0 else (body[:i], body[i:])

    order: list[int] = []
    seen: set[int] = set()
    stack = [int(n) for n in reversed(_REF_RE.findall(trailer))]
    while stack:
        n = stack.pop()
        if n in seen or n not in objs:
            continue
        seen.add(n)
        order.append(n)
        stack.extend(int(r) for r in reversed(_REF_RE.findall(split(objs[n])[0])))
    if len(order) != len(objs):
        return data
    new = {old: i + 1 for i, old in enumerate(order)}

    def sub_refs(b: bytes) -> bytes:
        return _REF_RE.sub(lambda m: b"%d 0 R" % new[int(m.group(1))], b)

    out = bytearray(data[:first])
    offsets = []
    for old in order:
        head, stream = split(objs[old])
        offsets.append(len(out))
        out += b"%d 0 obj\n" % new[old] + sub_refs(head) + stream + b"endobj\n\n"
    xref_at = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(order) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n" + sub_refs(trailer) + b"startxref\n%d\n%%%%EOF\n" % xref_at
    return bytes(out)


def normalize_pdf(data: bytes) -> bytes:
    """作成日時・更新日時と /ID を固定し、オブジェクト番号を決まった順に振り直す。
    /ID と /DocChecksum は、両方を 0 にした本文の MD5 から決める。"""
    data = renumber_objects(data)
    # XMP の日時（タイムゾーン付き）も固定する。同じ長さなので /Length は変わらない
    data = re.sub(rb"(?<=>)\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d(?=<)", b"2026-10-01T00:00:00+00:00", data)

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
