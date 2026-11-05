"""作り手の自己点検。施設のフォルダごとに次を確かめ、1 つでも外れたら 1 で終わる。

- 資料ごとに正解（answer/files/<stem>.json）と証拠（gen/evidence/<stem>.json）がある
- 正解の行の値が、ファイルの中身と合う（Excel はセルの番地、CSV は行と列、PDF は頁の文字の順）
- どのファイルにも【架空】がある（ファイル名、Excel は題のセルと作成者、PDF は 1 頁目と文書の情報、CSV は 1 行目）
- 前の製品の名前（scripts/check-publish.mjs の FORBIDDEN）と、tests/fixtures/reserved-names.txt の名前に当たらない
- 写真の大きさ（長い辺 1,568〜2,000px、JPEG で 60〜160KB）
- 世界の正解の結び（links）が、ある作業とあるファイルを指す

使い方：python samples/maker/check.py samples/<業種>/<施設> [...]
"""
from __future__ import annotations

import csv
import io
import json
import re
import sys
import zipfile
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    __package__ = "maker"

import openpyxl  # noqa: E402
import pypdfium2 as pdfium  # noqa: E402
from PIL import Image  # noqa: E402

from maker.util import FAKE, ROOT, norm  # noqa: E402



def _product_pattern():
    """前の製品の名前の正規表現は scripts/check-publish.mjs の FORBIDDEN から読む（名前をここに書かない）。"""
    src = (ROOT / "scripts" / "check-publish.mjs").read_text(encoding="utf-8")
    m = re.search(r"export const FORBIDDEN = /(.+)/i;", src)
    if not m:
        raise RuntimeError("scripts/check-publish.mjs に FORBIDDEN が見つからない")
    return re.compile(m.group(1), re.I)


PRODUCT = _product_pattern()


def reserved():
    p = ROOT / "tests" / "fixtures" / "reserved-names.txt"
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line)
    return out


RESERVED = None


def scan_text(label, text, errs):
    global RESERVED
    if RESERVED is None:
        RESERVED = [re.compile(r"(?<![A-Za-z0-9_])" + re.escape(x) + r"(?![A-Za-z0-9_])") for x in reserved()]
    if PRODUCT.search(text):
        errs.append(f"{label}: 前の製品の名前が出た")
    for rx in RESERVED:
        if rx.search(text):
            errs.append(f"{label}: reserved-names の名前「{rx.pattern}」が出た")


def check_xlsx(path, ans, evd, errs):
    wb = openpyxl.load_workbook(path)
    if FAKE not in (wb.properties.creator or ""):
        errs.append(f"{path.name}: 作成者に【架空】が無い")
    for ws in wb.worksheets:
        head = " ".join(str(c.value) for row in ws.iter_rows(min_row=1, max_row=3) for c in row if c.value is not None)
        if FAKE not in head and ws.title != "注記":
            errs.append(f"{path.name}: シート「{ws.title}」の題の行に【架空】が無い")
        elif ws.title == "注記" and FAKE not in str(ws["A1"].value):
            errs.append(f"{path.name}: 注記のシートに【架空】が無い")
    bad = 0
    for rec, e in zip(ans["records"], evd["evidence"]):
        ws = wb[rec["sheet"]]
        if e.get("r") != rec.get("r"):
            errs.append(f"{path.name}: 正解と証拠の行がずれた（{rec.get('r')}）")
        for a, v in e["cells"]:
            cv = ws[a].value
            if norm(cv) != norm(v):
                bad += 1
                if bad <= 5:
                    errs.append(f"{path.name}!{rec['sheet']}!{a}: ファイル「{cv}」、正解「{v}」")
        if not any(c.value is not None for c in ws[rec["r"]]):
            errs.append(f"{path.name}!{rec['sheet']}: 正解の行 {rec['r']} が空")
    if bad > 5:
        errs.append(f"{path.name}: ほかに {bad - 5} か所が合わない")
    # 文字の検査（zip の中の XML）
    with zipfile.ZipFile(path) as z:
        text = "\n".join(z.read(n).decode("utf-8", "replace") for n in z.namelist() if n.endswith((".xml", ".rels")))
    scan_text(path.name, text, errs)


def check_csv(path, ans, evd, errs):
    enc = evd.get("encoding", "utf-8")
    raw = path.read_bytes()
    try:
        text = raw.decode(enc)
    except UnicodeDecodeError:
        errs.append(f"{path.name}: {enc} で読めない")
        return
    rows = list(csv.reader(io.StringIO(text)))
    if not rows or FAKE not in rows[0][0]:
        errs.append(f"{path.name}: 1 行目に【架空】が無い")
    bad = 0
    for rec, e in zip(ans["records"], evd["evidence"]):
        for a, v in e["cells"]:
            r, k = (int(x) for x in a.split(":"))
            cv = rows[r - 1][k] if r - 1 < len(rows) and k < len(rows[r - 1]) else None
            if norm(cv) != norm(v):
                bad += 1
                if bad <= 5:
                    errs.append(f"{path.name}:{r}:{k}: ファイル「{cv}」、正解「{v}」")
    scan_text(path.name, text, errs)


def pdf_text(path):
    d = pdfium.PdfDocument(str(path))
    pages = []
    for i in range(len(d)):
        tp = d[i].get_textpage()
        pages.append(tp.get_text_range())
    meta = d.get_metadata_dict()
    return pages, meta


def check_pdf(path, ans, evd, errs):
    pages, meta = pdf_text(path)
    if FAKE not in pages[0]:
        errs.append(f"{path.name}: 1 頁目に【架空】が無い")
    if FAKE not in (meta.get("Title", "") + meta.get("Author", "")):
        errs.append(f"{path.name}: 文書の情報に【架空】が無い")
    full = norm("".join(pages))
    pos = 0
    bad = 0
    for rec, e in zip(ans["records"], evd["evidence"]):
        for s in e["cells"]:
            k = full.find(norm(s), pos)
            if k < 0:
                bad += 1
                if bad <= 5:
                    errs.append(f"{path.name}: seq {rec['seq']} の「{s}」が順に見つからない")
            else:
                pos = k
    scan_text(path.name, "".join(pages), errs)


def check_jpg(path, ans, evd, errs):
    im = Image.open(path)
    long = max(im.size)
    size = path.stat().st_size
    if not (1568 <= long <= 2000):
        errs.append(f"{path.name}: 長い辺 {long}px（1,568〜2,000）")
    if not (60_000 <= size <= 160_000):
        errs.append(f"{path.name}: {size} バイト（60〜160KB）")
    if not ans["records"]:
        errs.append(f"{path.name}: 正解の行が無い")


def check_facility(fac: Path):
    errs = []
    files = sorted((fac / "files").iterdir())
    if not files:
        errs.append("files/ が空")
    stems = set()
    for f in files:
        if not f.name.startswith(FAKE):
            errs.append(f"{f.name}: 名前が【架空】で始まらない")
        stem = f.stem
        stems.add(stem)
        ap = fac / "answer" / "files" / f"{stem}.json"
        ep = fac / "gen" / "evidence" / f"{stem}.json"
        if not ap.exists() or not ep.exists():
            errs.append(f"{f.name}: 正解か証拠が無い")
            continue
        ans = json.loads(ap.read_text(encoding="utf-8"))
        evd = json.loads(ep.read_text(encoding="utf-8"))
        if ans["file"] != f.name:
            errs.append(f"{f.name}: 正解の file が違う")
        if len(ans["records"]) != len(evd["evidence"]):
            errs.append(f"{f.name}: 正解と証拠の数が違う")
        for rec in ans["records"]:
            if rec["kind"] not in ("item", "parent", "subtotal", "total"):
                errs.append(f"{f.name}: kind「{rec['kind']}」")
            if rec["kind"] in ("subtotal", "total") and rec["fields"]:
                errs.append(f"{f.name}: 小計・合計の fields が空でない")
        ext = f.suffix.lower()
        if ext == ".xlsx":
            check_xlsx(f, ans, evd, errs)
        elif ext == ".csv":
            check_csv(f, ans, evd, errs)
        elif ext == ".pdf":
            check_pdf(f, ans, evd, errs)
        elif ext == ".jpg":
            check_jpg(f, ans, evd, errs)
        else:
            errs.append(f"{f.name}: 知らない形式")
    for ap in (fac / "answer" / "files").glob("*.json"):
        if ap.stem not in stems:
            errs.append(f"{ap.name}: 正解だけがあって資料が無い")
    # 世界の正解
    wp = fac / "answer" / "world.json"
    world = json.loads(wp.read_text(encoding="utf-8"))
    wids = {w["id"] for w in world["works"]}
    names = {f.name for f in files}
    for x in world["links"]:
        if x["work"] not in wids:
            errs.append(f"world.json: 結びの作業 {x['work']} が無い")
            break
        if x["file"] not in names:
            errs.append(f"world.json: 結びのファイル {x['file']} が無い")
            break
    if world["facility"].get("fictional") is not True:
        errs.append("world.json: fictional が true でない")
    # 文書の文字
    for p in [fac / "user.md", fac / "README.md", wp] + list((fac / "answer" / "files").glob("*.json")) + list((fac / "gen").rglob("*.json")):
        if p.exists():
            scan_text(str(p.relative_to(fac)), p.read_text(encoding="utf-8"), errs)
        elif p.name in ("user.md", "README.md"):
            errs.append(f"{p.name} が無い")
    return errs, len(files), world["counts"]


def main(args):
    total = 0
    for a in args:
        fac = Path(a).resolve()
        errs, n, counts = check_facility(fac)
        rel = fac.relative_to(ROOT) if fac.is_relative_to(ROOT) else fac
        if errs:
            total += len(errs)
            print(f"✗ {rel}（{n} ファイル）")
            for e in errs[:40]:
                print("   ", e)
            if len(errs) > 40:
                print(f"    ほか {len(errs) - 40} 件")
        else:
            print(f"✓ {rel}（{n} ファイル、機器 {counts['assets']}、作業 {counts['works']}、契約 {counts['contracts']}）")
    return 1 if total else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
