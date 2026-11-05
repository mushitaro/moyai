# -*- coding: utf-8 -*-
"""組 heldout-5 の自分での確かめ（指示書 §6 ＋ 正解の形の補い）。

    python -I -X utf8 -B gen/check.py

確かめること：
  1. 組のフォルダの形（施設 3〜4、ファイル 9〜10、README.md・WRITER.md・gen/、施設ごとの files/・user.md・answer/）
  2. どのファイルにも【架空】（名前・中身・文書のプロパティ）
  3. 禁止語が、組のどのファイルにも無い（資料・正解・コード・README）
  4. 正解の形（schema・欄・kind・場所の書き方）
  5. 正解の行の場所がファイルの中身と合う（行がある・値が行に書いてある・印が合う・CSV の記録の始まりの行）
  6. 世界の正解の rows が、ファイルごとの正解の記録を指す
  7. §2.2 の性質が組の中にそろっている
  8. 写真の大きさ（1,568〜2,000px、JPEG で 100KB 前後）
通らないものの数を最後に出し、1 つでもあれば終わりの値を 1 にする。
"""
import base64
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import unicodedata
import zipfile

import openpyxl
import pypdfium2 as pdfium
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF_WORDS = r"C:\tmp\moyai-heldout-5-ref\forbidden-words.txt"
# 禁止語はこのファイルにも書けないので、base64 で持つ（作る側の一覧があれば、それも読む）
BUILTIN = ["bXhzdGFnZQ==", "bXggc3RhZ2U=", "aG9zaHV0YXJv", "bWF4aW1v"]
FAILS = []
NOTES = []


def fail(msg):
    FAILS.append(msg)


def norm(s):
    s = unicodedata.normalize("NFKC", str(s))
    return re.sub(r"\s+", "", s).replace(",", "")


def forbidden_words():
    ws = {base64.b64decode(b).decode("utf-8").lower() for b in BUILTIN}
    if os.path.exists(REF_WORDS):
        with open(REF_WORDS, encoding="utf-8") as f:
            for ln in f:
                ln = ln.strip()
                if ln and not ln.startswith("#"):
                    ws.add(ln.lower())
    else:
        NOTES.append("作る側の禁止語の一覧が見つからないので、組に入れた一覧だけで確かめた")
    return ws


# ------------------------------------------------------------------ ファイルの中身を文字にする
def xlsx_text(path):
    out = []
    wb = openpyxl.load_workbook(path)
    for ws in wb:
        out.append(ws.title)
        for row in ws.iter_rows():
            for c in row:
                if c.value is not None:
                    out.append(str(c.value))
                if c.comment:
                    out.append(c.comment.text)
    p = wb.properties
    out += [str(p.creator), str(p.title), str(p.lastModifiedBy)]
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if n.endswith(".xml") or n.endswith(".rels") or n.endswith(".vml"):
                out.append(z.read(n).decode("utf-8", "replace"))
    return "\n".join(out)


def pdf_pages(path):
    pdf = pdfium.PdfDocument(path)
    pages = [pdf[i].get_textpage().get_text_range() for i in range(len(pdf))]
    meta = pdf.get_metadata_dict()
    pdf.close()
    return pages, meta


def file_text(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".xlsx":
        return xlsx_text(path)
    if ext == ".pdf":
        pages, meta = pdf_pages(path)
        return "\n".join(pages) + "\n" + json.dumps(meta, ensure_ascii=False)
    if ext == ".csv":
        raw = open(path, "rb").read()
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError:
            return raw.decode("cp932")
    if ext in (".jpg", ".jpeg", ".png", ".pyc"):
        return open(path, "rb").read().decode("latin-1")
    return open(path, encoding="utf-8").read()


# ------------------------------------------------------------------ 1. 形
def facilities():
    out = []
    for n in sorted(os.listdir(ROOT)):
        p = os.path.join(ROOT, n)
        if os.path.isdir(p) and n not in ("gen", "measured") and not n.startswith("."):
            out.append(n)
    return out


def data_files(fac):
    base = os.path.join(ROOT, fac, "files")
    out = []
    for dp, dn, fn in os.walk(base):
        for f in fn:
            out.append(os.path.relpath(os.path.join(dp, f), base).replace("\\", "/"))
    return sorted(out)


def check_layout():
    for f in ("README.md", "WRITER.md"):
        if not os.path.exists(os.path.join(ROOT, f)):
            fail(f"組に {f} が無い")
    if not os.path.isdir(os.path.join(ROOT, "gen")):
        fail("組に gen/ が無い")
    facs = facilities()
    if not 3 <= len(facs) <= 4:
        fail(f"施設の数が {len(facs)}（3〜4 のはず）")
    total = 0
    for fac in facs:
        for need in ("files", "user.md", os.path.join("answer", "world.json"), os.path.join("answer", "files")):
            if not os.path.exists(os.path.join(ROOT, fac, need)):
                fail(f"{fac}: {need} が無い")
        files = data_files(fac)
        total += len(files)
        stems = {os.path.splitext(f)[0].replace("/", "__") for f in files}
        ans = {os.path.splitext(a)[0] for a in os.listdir(os.path.join(ROOT, fac, "answer", "files"))}
        for s in stems - ans:
            fail(f"{fac}: {s} の正解が無い")
        for s in ans - stems:
            fail(f"{fac}: 正解 {s} のファイルが無い")
    if not 9 <= total <= 10:
        fail(f"ファイルの数が {total}（9〜10 のはず）")
    return facs, total


# ------------------------------------------------------------------ 2・3. 【架空】と禁止語
def check_fiction_and_words(facs):
    words = forbidden_words()
    for fac in facs:
        for rel in data_files(fac):
            path = os.path.join(ROOT, fac, "files", rel)
            name = os.path.basename(rel)
            if not name.startswith("【架空】"):
                fail(f"{rel}: 名前が【架空】で始まらない")
            ext = os.path.splitext(rel)[1].lower()
            if ext == ".xlsx":
                wb = openpyxl.load_workbook(path)
                if "【架空】" not in str(wb.properties.creator):
                    fail(f"{rel}: 文書のプロパティ（作成者）に【架空】が無い")
                first = wb.worksheets[0]
                if not any("【架空】" in str(c.value) for row in first.iter_rows(max_row=3) for c in row if c.value):
                    fail(f"{rel}: 表題のセルに【架空】が無い")
                for ws in wb.worksheets:
                    if not any("【架空】" in str(c.value) for row in ws.iter_rows(max_row=3) for c in row if c.value):
                        fail(f"{rel}: シート {ws.title} の上に【架空】が無い")
            elif ext == ".pdf":
                pages, meta = pdf_pages(path)
                if "【架空】" not in pages[0]:
                    fail(f"{rel}: 1 ページ目に【架空】が無い")
                if "【架空】" not in (meta.get("Title", "") + meta.get("Author", "")):
                    fail(f"{rel}: 文書の情報に【架空】が無い")
            elif ext == ".csv":
                first = file_text(path).splitlines()[0]
                if "【架空】" not in first:
                    fail(f"{rel}: 1 行目に【架空】が無い")
            elif ext in (".jpg", ".jpeg"):
                NOTES.append(f"{rel}: 紙の上の【架空】は文字として読めないので、目で確かめた（WRITER.md）")
    # 禁止語：組のフォルダのすべてのファイル（measured/ を除く）
    for dp, dn, fn in os.walk(ROOT):
        if "measured" in dp.replace("\\", "/").split("/"):
            continue
        for f in fn:
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, ROOT)
            if f == "PROMPT.md":
                continue      # 頼みの文（作り手が書いたものではない）
            try:
                t = file_text(p).lower()
            except Exception as e:  # noqa
                fail(f"{rel}: 読めない（{e}）")
                continue
            for w in words:
                if w in t or w in rel.lower():
                    fail(f"{rel}: 禁止語が入っている")


# ------------------------------------------------------------------ 4〜6. 正解
DERIVED = {"date", "start", "end", "manDays", "manDaysText", "days", "fiscal_year", "金額の単位", "年額の単位", "曜日",
           "path", "marks", "comments", "cycle", "cost", "unit", "memo", "install_year", "specs", "No", "頁", "点検者の欄",
           "工程の開始", "工程の終了"}
SYMS = {"○", "●", "△", "○→", "※", "◇", "◎"}


def cell_str(v):
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def date_forms(d):
    if d >= dt.date(2019, 5, 1):
        a, n = "R", d.year - 2018
        name = "令和"
    else:
        a, n = "H", d.year - 1988
        name = "平成"
    return {norm(x) for x in (d.isoformat(), f"{d.year}/{d.month:02d}/{d.day:02d}", f"{d.year}/{d.month}/{d.day}",
                              f"{a}{n}.{d.month}.{d.day}", f"{name}{n}年{d.month}月{d.day}日", f"{d.month}月{d.day}日")}


def row_cells(ws, r):
    return [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]


def merged_width(ws, r, c):
    for m in ws.merged_cells.ranges:
        if m.min_row == r and m.min_col == c:
            return m.max_col - m.min_col + 1
    return 1


def check_xlsx(fac, rel, ans):
    path = os.path.join(ROOT, fac, "files", rel)
    wb = openpyxl.load_workbook(path)
    plan = ans["plan"]
    seen = set()
    for rec in ans["records"]:
        sh, r = rec.get("sheet"), rec.get("r")
        if sh not in wb.sheetnames or not isinstance(r, int):
            fail(f"{rel}: 場所が不正 {sh} {r}")
            continue
        if (sh, r) in seen:
            fail(f"{rel}: 同じ行が 2 回 {sh}!{r}")
        seen.add((sh, r))
        ws = wb[sh]
        cells = row_cells(ws, r)
        texts = [norm(cell_str(v)) for v in cells if v is not None]
        joined = "|".join(texts)
        if not texts:
            fail(f"{rel}: {sh}!{r} は空の行")
            continue
        f = rec["fields"]
        if rec["kind"] in ("subtotal", "total"):
            if f:
                fail(f"{rel}: {sh}!{r} 小計・合計の fields は空のはず")
            if not any(isinstance(v, (int, float)) for v in cells):
                fail(f"{rel}: {sh}!{r} 小計・合計の行に数が無い")
            continue
        if "path" in f:
            last = norm(f["path"][-1])
            if last not in joined:
                # 上と同じ値の空欄：上の行のどこかに書いてある
                up = "|".join(norm(cell_str(ws.cell(rr, c).value)) for rr in range(max(1, r - 3), r)
                              for c in range(1, 6) if ws.cell(rr, c).value is not None)
                if last not in up:
                    fail(f"{rel}: {sh}!{r} 道の最後「{f['path'][-1]}」が行に無い")
        if plan and "marks" in f:
            want = []
            for y, m in f["marks"].items():
                want += m if isinstance(m, list) else [m]
            got = []
            for c, v in enumerate(cells, 1):
                if v is not None and str(v) in SYMS:
                    got += [str(v)] * merged_width(ws, r, c)
            if sorted(want) != sorted(got):
                fail(f"{rel}: {sh}!{r} 印が合わない 正解 {sorted(want)} 行 {sorted(got)}")
        if plan and "work" in f:
            w = norm(f["work"])
            if w not in joined and "〃" not in joined:
                fail(f"{rel}: {sh}!{r} 作業「{f['work']}」が行に無い")
        if plan and "comments" in f:
            for addr, txt in f["comments"].items():
                cm = ws[addr].comment
                if cm is None or cm.text != txt:
                    fail(f"{rel}: {sh}!{addr} のメモが合わない")
        if not plan:
            # 帳票（1 枚が小さいシート）は、枚の項目がシートのどこかにある
            top = ws.max_row if ws.max_row <= 30 else 4
            head = "|".join(norm(cell_str(ws.cell(rr, c).value)) for rr in range(1, top + 1) for c in range(1, ws.max_column + 1)
                            if ws.cell(rr, c).value is not None)
            for k, v in f.items():
                if k in DERIVED or v in (None, ""):
                    continue
                s = norm(cell_str(v))
                if s in joined or s in head:
                    continue
                if isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
                    if any(x in joined for x in date_forms(dt.date.fromisoformat(v))):
                        continue
                if "〃" in joined:
                    continue
                fail(f"{rel}: {sh}!{r} 「{k}」の値「{v}」が行にも枚の上にも無い")
        # 日付の値は行のどこかの日付・和暦と合う
        for k in ("date", "start"):
            if k in f and not plan and "発注日" not in f and "契約期間" not in f:
                d = dt.date.fromisoformat(f[k])
                forms = date_forms(d)
                if not any(x in joined or x in head for x in forms) and "〃" not in joined:
                    fail(f"{rel}: {sh}!{r} 日付 {f[k]} が行にも枚の上にも無い")
    # 見落とした行（データのありそうな行で、正解に無いもの）
    for sh in {rec["sheet"] for rec in ans["records"]}:
        ws = wb[sh]
        rs = [rec["r"] for rec in ans["records"] if rec["sheet"] == sh]
        for r in range(min(rs), max(rs) + 1):
            if (sh, r) in seen:
                continue
            vals = [v for v in row_cells(ws, r) if v not in (None, "")]
            if len(vals) >= 3 and not any(str(v) in ("No.", "点検日", "予定", "実績", "社員") for v in vals):
                fail(f"{rel}: {sh}!{r} にデータがありそうなのに正解に無い")


def check_csv(fac, rel, ans):
    path = os.path.join(ROOT, fac, "files", rel)
    raw = open(path, "rb").read()
    txt = raw.decode("cp932")
    starts = {}
    rd = csv.reader(io.StringIO(txt, newline=""))
    prev_end = 0
    for row in rd:
        start = prev_end + 1
        prev_end = rd.line_num
        starts[start] = row
    data_starts = sorted(starts)[2:]
    got = sorted(rec["r"] for rec in ans["records"])
    if got != data_starts:
        fail(f"{rel}: 正解の行 {len(got)} 件と、記録の始まりの行 {len(data_starts)} 件が合わない")
    for rec in ans["records"]:
        row = starts.get(rec["r"])
        if row is None:
            fail(f"{rel}: r={rec['r']} は記録の始まりではない")
            continue
        joined = "|".join(norm(x) for x in row)
        for k, v in rec["fields"].items():
            if k in DERIVED or v in (None, ""):
                continue
            if norm(cell_str(v)) not in joined:
                fail(f"{rel}: r={rec['r']} 「{k}」の値「{v}」が記録に無い")
        for k in ("date", "start"):
            if k in rec["fields"]:
                d = dt.date.fromisoformat(rec["fields"][k])
                if d.strftime("%Y/%m/%d") not in joined:
                    fail(f"{rel}: r={rec['r']} 日付 {d} が記録に無い")


def check_pdf(fac, rel, ans):
    path = os.path.join(ROOT, fac, "files", rel)
    pages, meta = pdf_pages(path)
    doc = norm("\n".join(pages))
    pos = 0
    seqs = [rec["seq"] for rec in ans["records"]]
    if seqs != list(range(len(seqs))):
        fail(f"{rel}: seq が 0 からの続き番号でない")
    for rec in ans["records"]:
        f = rec["fields"]
        key = None
        for k in ("作業項目", "工程"):
            if k in f:
                key = f[k]
        if key is None and "path" in f:
            key = f["path"][-1]
        if key is None:
            fail(f"{rel}: seq={rec['seq']} 照らす値が無い")
            continue
        i = doc.find(norm(key), pos)
        if i < 0:
            fail(f"{rel}: seq={rec['seq']} 「{key}」が順に見つからない")
            continue
        pos = i + 1
        for k in ("code", "数量", "結果・所見", "設置年月"):
            if k in f and norm(f[k]) not in doc:
                fail(f"{rel}: seq={rec['seq']} 「{k}」の値「{f[k]}」が無い")


def check_photo(fac, rel, ans):
    path = os.path.join(ROOT, fac, "files", rel)
    im = Image.open(path)
    w, h = im.size
    if not 1568 <= max(w, h) <= 2000:
        fail(f"{rel}: 長い辺が {max(w, h)}px（1,568〜2,000）")
    n = os.path.getsize(path)
    if not 60_000 <= n <= 160_000:
        fail(f"{rel}: {n} バイト（100KB 前後のはず）")
    seqs = [rec["seq"] for rec in ans["records"]]
    if seqs != list(range(len(seqs))):
        fail(f"{rel}: seq が 0 からの続き番号でない")
    for rec in ans["records"]:
        if rec.get("image") != os.path.basename(rel):
            fail(f"{rel}: seq={rec['seq']} の image が合わない")
    if not any("読めない" in json.dumps(rec["fields"], ensure_ascii=False) for rec in ans["records"]):
        fail(f"{rel}: 読めないセルの記録が無い")


VALUE_OK = (str, int, float, bool, type(None))


def check_answers(facs):
    all_recs = {}
    for fac in facs:
        for rel in data_files(fac):
            stem = os.path.splitext(rel)[0].replace("/", "__")
            ap = os.path.join(ROOT, fac, "answer", "files", stem + ".json")
            if not os.path.exists(ap):
                continue
            ans = json.load(open(ap, encoding="utf-8"))
            if ans.get("schema") != "moyai.answer.file/0":
                fail(f"{stem}: schema が違う")
            if ans.get("file") != rel:
                fail(f"{stem}: file が {ans.get('file')}")
            if not isinstance(ans.get("plan"), bool):
                fail(f"{stem}: plan が真偽でない")
            for rec in ans["records"]:
                if rec.get("kind") not in ("item", "parent", "subtotal", "total"):
                    fail(f"{stem}: kind が不正 {rec.get('kind')}")
                for k, v in rec.get("fields", {}).items():
                    if k in ("path", "specs"):
                        if not all(isinstance(x, str) for x in v):
                            fail(f"{stem}: {k} は文字の並び")
                    elif k in ("marks", "comments"):
                        for y, m in v.items():
                            if not (isinstance(m, str) or (isinstance(m, list) and all(isinstance(x, str) for x in m))):
                                fail(f"{stem}: {k} の値が不正")
                            if k == "marks" and not re.fullmatch(r"\d{4}", y):
                                fail(f"{stem}: marks の年度が 4 桁でない {y}")
                    elif not isinstance(v, VALUE_OK):
                        fail(f"{stem}: 値が入れ子 {k}")
                    if k in ("date", "start", "end") and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(v)):
                        fail(f"{stem}: {k} が YYYY-MM-DD でない")
                if ans["plan"] and rec["kind"] == "item":
                    for need in ("path", "work"):
                        if need not in rec["fields"]:
                            fail(f"{stem}: 星取表の行 r={rec.get('r')} に {need} が無い")
            ext = os.path.splitext(rel)[1].lower()
            if ext == ".xlsx":
                check_xlsx(fac, rel, ans)
                key = lambda rc: (rc["sheet"], rc["r"])  # noqa
            elif ext == ".csv":
                check_csv(fac, rel, ans)
                key = lambda rc: (None, rc["r"])  # noqa
            elif ext == ".pdf":
                check_pdf(fac, rel, ans)
                key = lambda rc: (None, rc["seq"])  # noqa
            else:
                check_photo(fac, rel, ans)
                key = lambda rc: (None, rc["seq"])  # noqa
            all_recs[(fac, rel)] = {key(rc): rc for rc in ans["records"]}
        # 世界
        wp = os.path.join(ROOT, fac, "answer", "world.json")
        world = json.load(open(wp, encoding="utf-8"))
        if world.get("schema") != "moyai.answer.world/0":
            fail(f"{fac}: world の schema が違う")
        for k in ("facility", "fiscal_year_start_month", "man_day_hours", "today", "equipment", "works", "unrecorded", "defects"):
            if k not in world:
                fail(f"{fac}: world に {k} が無い")
        fa = world["facility"]
        if not fa.get("name", "").startswith("【架空】") or fa.get("id") != fac or "profile" not in fa:
            fail(f"{fac}: facility の欄が不正")
        eq_ids = {e["id"] for e in world["equipment"]}
        files = set(data_files(fac))

        def ref_ok(where, ref):
            if ref["file"] not in files:
                fail(f"{fac}: {where} のファイル {ref['file']} が無い")
                return None
            recs = all_recs.get((fac, ref["file"]), {})
            k = (ref.get("sheet"), ref["r"]) if "r" in ref else (None, ref.get("seq"))
            rec = recs.get(k)
            if rec is None:
                fail(f"{fac}: {where} の行 {ref} が正解の記録に無い")
            return rec

        for e in world["equipment"]:
            for ref in e.get("rows", []):
                ref_ok(f"機器 {e['id']}", ref)
        wids = set()
        for w in world["works"]:
            wids.add(w["id"])
            for k in ("id", "label", "attribute", "status", "fiscal_year", "equipment", "start", "end", "rows"):
                if k not in w:
                    fail(f"{fac}: 作業 {w.get('id')} に {k} が無い")
            if w["attribute"] not in ("INSPECT", "OVERHAUL", "REPLACE", "UPGRADE"):
                fail(f"{fac}: 作業 {w['id']} の属性が不正")
            if w["status"] not in ("actual", "planned"):
                fail(f"{fac}: 作業 {w['id']} の status が不正")
            for e in w["equipment"]:
                if e not in eq_ids:
                    fail(f"{fac}: 作業 {w['id']} の機器 {e} が無い")
            for ref in w["rows"]:
                rec = ref_ok(f"作業 {w['id']}", ref)
                if rec is not None and "year" in ref:
                    m = rec["fields"].get("marks", {}).get(str(ref["year"]))
                    if m is None:
                        fail(f"{fac}: 作業 {w['id']} の {ref} の年度に印が無い")
                    elif "symbol" in ref:
                        ms = m if isinstance(m, list) else [m]
                        if ref["symbol"] not in ms:
                            fail(f"{fac}: 作業 {w['id']} の {ref} の印 {ref['symbol']} が {ms} に無い")
            if not w["rows"] and not any(u["work"] == w["id"] for u in world["unrecorded"]):
                fail(f"{fac}: 作業 {w['id']} はどの行にも無いのに unrecorded に無い")
        for u in world["unrecorded"]:
            if u["work"] not in wids:
                fail(f"{fac}: unrecorded の {u['work']} が works に無い")
            if not u.get("reason") or u["reason"] == "?":
                fail(f"{fac}: unrecorded の {u['work']} に理由が無い")
        # 星取表の印のある行は、どれかの作業が指している
        for (f2, rel), recs in all_recs.items():
            if f2 != fac:
                continue
            refd = {(r.get("sheet"), r.get("r"), r.get("year")) for w in world["works"] for r in w["rows"] if r["file"] == rel}
            for (sh, r), rc in recs.items():
                for y in rc["fields"].get("marks", {}):
                    if (sh, r, int(y)) not in refd:
                        NOTES.append(f"{fac}: {rel} {sh}!{r} の {y} 年度の印を指す作業が無い（延期のまま実施しなかった印）")
    return all_recs


# ------------------------------------------------------------------ 7. §2.2 の性質
def check_properties(facs, all_recs):
    have = {}
    inds = {}
    formats = {}
    for fac in facs:
        world = json.load(open(os.path.join(ROOT, fac, "answer", "world.json"), encoding="utf-8"))
        ind = world["facility"]["industry"]
        inds[fac] = ind
        for rel in data_files(fac):
            ext = os.path.splitext(rel)[1].lower()
            formats.setdefault(ind, set()).add(ext)
            path = os.path.join(ROOT, fac, "files", rel)
            ans = json.load(open(os.path.join(ROOT, fac, "answer", "files", os.path.splitext(rel)[0] + ".json"), encoding="utf-8"))
            recs = ans["records"]
            if ans["plan"] and sum(1 for r in recs if len(r["fields"].get("marks", {})) >= 5) >= 3:
                have.setdefault("横持ち（年度が列）", rel)
            if not ans["plan"] and len(recs) >= 20 and ext in (".csv", ".xlsx"):
                have.setdefault("縦持ち（1 行 = 1 件）", rel)
            if ext == ".csv":
                raw = open(path, "rb").read()
                try:
                    raw.decode("utf-8")
                except UnicodeDecodeError:
                    raw.decode("cp932")
                    have.setdefault("Shift_JIS の CSV", rel)
            if ext in (".jpg", ".jpeg"):
                have.setdefault("写真", rel)
            if ext == ".pdf":
                pages, _ = pdf_pages(path)
                if len(pages) >= 2:
                    heads = [norm(p.splitlines()[0]) if p else "" for p in pages]
                    common = set(norm(x) for x in pages[0].splitlines()[:30])
                    rep = [x for x in common if x and all(x in norm(p) for p in pages) and len(x) >= 2]
                    if any("No." in x or "番号" in x or "名称" in x for x in rep):
                        have.setdefault("文字の PDF の罫線の表（ページごとに見出し）", rel)
                if any("報告書No." in norm(p) for p in pages):
                    have.setdefault("帳票（1 件 1 枚）", rel)
                if any("前ページから続く" in p or "（続き）" in p for p in pages):
                    have.setdefault("続紙", rel)
            if ext == ".xlsx":
                wb = openpyxl.load_workbook(path)
                for ws in wb:
                    # 3 段の見出しで途中に結合
                    for top in range(1, 10):
                        rows_with_merge = {m.min_row for m in ws.merged_cells.ranges if m.min_row == m.max_row and m.max_col > m.min_col}
                        if top in rows_with_merge and top + 1 in rows_with_merge and any(
                                str(ws.cell(top + 2, c).value) in ("予定", "実績") for c in range(1, ws.max_column + 1)):
                            have.setdefault("見出し 3 段・途中に結合", rel)
                    if "(続)" in ws.title:
                        have.setdefault("続紙", rel)
                    # 1 日 1 シートの帳票
                if len(wb.sheetnames) >= 5 and all(any(str(c.value) == "日付" for row in ws.iter_rows(max_row=3) for c in row) for ws in wb):
                    have.setdefault("1 日 1 シートの帳票", rel)
                for ws in wb:
                    heads = [r for r in range(1, ws.max_row + 1) if str(ws.cell(r, 1).value) in ("No.", "点検日")]
                    sigs = [tuple(str(ws.cell(r, c).value) for c in range(1, ws.max_column + 1) if ws.cell(r, c).value is not None) for r in heads]
                    if len(heads) >= 2 and len(set(sigs)) >= 2:
                        if any(len(set(a) ^ set(b)) == 1 and len(b) == len(a) + 1 for a in sigs for b in sigs):
                            have.setdefault("年度の途中で列が増える表", rel)
                        if any(len(set(a) & set(b)) <= 2 for a in sigs for b in sigs if a != b):
                            have.setdefault("1 シートに複数の表・途中で変わる見出し", rel)
                # 合計が上・年度の計がその年度の行の上
                tot = [r for r in recs if r["kind"] == "total"]
                subs = [r for r in recs if r["kind"] == "subtotal"]
                items = [r for r in recs if r["kind"] == "item"]
                if tot and subs and items and tot[0]["r"] < min(r["r"] for r in items) and subs[0]["r"] < min(r["r"] for r in items):
                    have.setdefault("合計が上・年度の計が自分の年度の行の上", rel)
    need = ["横持ち（年度が列）", "縦持ち（1 行 = 1 件）", "見出し 3 段・途中に結合", "帳票（1 件 1 枚）", "1 日 1 シートの帳票", "続紙",
            "1 シートに複数の表・途中で変わる見出し", "合計が上・年度の計が自分の年度の行の上", "年度の途中で列が増える表",
            "文字の PDF の罫線の表（ページごとに見出し）", "Shift_JIS の CSV", "写真"]
    for n in need:
        if n not in have:
            fail(f"§2.2 の性質「{n}」が組の中に見つからない")
    waste = [f for f, i in inds.items() if i == "waste-incineration"]
    if not (len(waste) * 2 >= len(facs) and len(waste) < len(facs)):
        fail(f"ごみ焼却の施設が {len(waste)}／{len(facs)}（半分のはず。残りはほかの設備）")
    for ext in (".xlsx", ".csv", ".pdf", ".jpg"):
        if ext not in formats.get("waste-incineration", set()):
            fail(f"ごみ焼却に {ext} の様式が無い")
    return have


def main():
    facs, total = check_layout()
    check_fiction_and_words(facs)
    all_recs = check_answers(facs)
    have = check_properties(facs, all_recs)
    print(f"施設 {len(facs)}・ファイル {total}")
    for k, v in have.items():
        print(f"  性質：{k} … {v}")
    for n in sorted(set(NOTES)):
        print("  注：" + n)
    if FAILS:
        print(f"通らない：{len(FAILS)} 件")
        for f in FAILS:
            print("  × " + f)
        sys.exit(1)
    print("通った：0 件の不一致")


if __name__ == "__main__":
    main()
