# -*- coding: utf-8 -*-
"""組 heldout-4 の自分での確かめ（指示書 §6 ＋ ANSWER.md の形）

    python -I -X utf8 gen/check.py

確かめること：
  1. どのファイルにも正解があり、どの正解にもファイルがある。ANSWER.md の形（欄・場所の書き方・値の型）
  2. 正解の行の場所がファイルの中身と合う（xlsx のセル、CSV の物理の行、PDF の文字の順、写真の seq）
  3. 世界の正解（world.json）の作業と機器の行が、ファイルの正解の記録を指している
  4. どのファイルにも【架空】がある（名前と中身と文書のプロパティ）
  5. forbidden-words.txt の語が、組のどこにも無い（ファイルの名前・中身・xlsx の XML・PDF の文字）
  6. 組の中に §2.2 の性質がそろっている。ごみ焼却で Excel・CSV・PDF・写真がそろう
  7. 写真の大きさ（長い辺 1,568〜2,000px、JPEG 100KB 前後）
"""
import csv
import datetime as dt
import glob
import io
import json
import os
import re
import sys
import zipfile

import openpyxl
import pypdfium2 as pdfium
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = r"C:\tmp\moyai-heldout-4-ref"
FAC = ["f-ashihara", "f-oboroya", "f-kirinose", "f-tenkyodai"]
SYMS = {"○", "●", "◎", "△", "○→", "◇", "□", "▲"}

errors = []
notes = []


def err(msg):
    errors.append(msg)


def ok(cond, msg):
    if not cond:
        err(msg)
    return cond


# ---------------------------------------------------------------- 値のくらべ
def wareki_to_date(s):
    m = re.fullmatch(r"([HR])(元|\d+)\.(\d+)\.(\d+)", s.strip())
    if not m:
        return None
    y = 1 if m.group(2) == "元" else int(m.group(2))
    y += 1988 if m.group(1) == "H" else 2018
    return dt.date(y, int(m.group(3)), int(m.group(4)))


def cell_texts(v):
    """セルの値を、くらべる形の候補の集まりにする"""
    out = set()
    if v is None:
        return out
    if isinstance(v, dt.datetime):
        out.add(v.date().isoformat())
        return out
    if isinstance(v, dt.date):
        out.add(v.isoformat())
        return out
    if isinstance(v, (int, float)):
        out.add(repr(float(v)))
        return out
    s = str(v)
    out.add(s)
    out.add(s.strip().strip("　"))
    d = wareki_to_date(s)
    if d:
        out.add(d.isoformat())
    for part in re.split(r"～", s):
        d = wareki_to_date(part)
        if d:
            out.add(d.isoformat())
    n = s.replace(",", "")
    if re.fullmatch(r"-?\d+(\.\d+)?", n):
        out.add(repr(float(n)))
    return out


def val_keys(v):
    if isinstance(v, bool):
        return {str(v)}
    if isinstance(v, (int, float)):
        return {repr(float(v))}
    s = str(v)
    return {s}


def found_in(v, texts_list):
    """値 v が、どれかのセルの候補に入っている（文字はセルの中の部分でもよい）"""
    keys = val_keys(v)
    for t in texts_list:
        if keys & t:
            return True
    if isinstance(v, str) and len(v) >= 1:
        for t in texts_list:
            for x in t:
                if v in x:
                    return True
        # 和暦の文字の日付を西暦に直したもの
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            for t in texts_list:
                for x in t:
                    for m in re.finditer(r"[HR](?:元|\d+)\.\d+\.\d+", x):
                        d = wareki_to_date(m.group(0))
                        if d and d.isoformat() == v:
                            return True
    return False


# ---------------------------------------------------------------- 読み込み
def load_answers(fac):
    d = os.path.join(ROOT, fac)
    ans = {}
    for p in glob.glob(os.path.join(d, "answer", "files", "*.json")):
        with open(p, encoding="utf-8") as f:
            ans[os.path.basename(p)[:-5]] = json.load(f)
    with open(os.path.join(d, "answer", "world.json"), encoding="utf-8") as f:
        world = json.load(f)
    return ans, world


def scalar(v):
    return isinstance(v, (str, int, float)) and not isinstance(v, bool)


ALLOWED_NESTED = {"path", "marks", "comments", "specs"}


def check_shape(fac, stem, a, files_dir):
    ok(a.get("schema") == "moyai.answer.file/0", f"{fac}/{stem}: schema")
    fn = a.get("file")
    ok(isinstance(fn, str) and fn.startswith("【架空】"), f"{fac}/{stem}: file の名前が【架空】で始まらない")
    ok(os.path.splitext(fn)[0].replace("/", "__") == stem, f"{fac}/{stem}: stem とファイルの名前が合わない")
    ok(os.path.isfile(os.path.join(files_dir, fn)), f"{fac}/{stem}: ファイルが無い {fn}")
    ok(isinstance(a.get("plan"), bool), f"{fac}/{stem}: plan が真偽でない")
    ext = os.path.splitext(fn)[1].lower()
    recs = a.get("records")
    ok(isinstance(recs, list) and recs, f"{fac}/{stem}: records が空")
    for i, r in enumerate(recs):
        where = f"{fac}/{stem} records[{i}]"
        ok(r.get("kind") in ("item", "parent", "subtotal", "total"), f"{where}: kind")
        if ext == ".xlsx":
            ok(isinstance(r.get("sheet"), str) and isinstance(r.get("r"), int) and r["r"] >= 1, f"{where}: sheet と r")
            ok("seq" not in r, f"{where}: xlsx に seq")
        elif ext == ".csv":
            ok(isinstance(r.get("r"), int) and "sheet" not in r and "seq" not in r, f"{where}: csv の r")
        elif ext == ".pdf":
            ok(isinstance(r.get("seq"), int) and "r" not in r, f"{where}: pdf の seq")
        elif ext in (".jpg", ".jpeg", ".png"):
            ok(isinstance(r.get("seq"), int) and r.get("image") == fn, f"{where}: 写真の seq と image")
        f = r.get("fields")
        ok(isinstance(f, dict), f"{where}: fields")
        if r.get("kind") in ("subtotal", "total"):
            ok(f == {}, f"{where}: 小計・合計の fields は空")
        for k, v in f.items():
            if k in ALLOWED_NESTED:
                if k in ("path", "specs"):
                    ok(isinstance(v, list) and all(isinstance(x, str) for x in v), f"{where}: {k} は文字の並び")
                elif k == "marks":
                    ok(isinstance(v, dict) and all(re.fullmatch(r"\d{4}", y) for y in v), f"{where}: marks の年度")
                    for y, s in v.items():
                        ok(isinstance(s, str) or (isinstance(s, list) and all(isinstance(x, str) for x in s)),
                           f"{where}: marks の値")
                elif k == "comments":
                    ok(isinstance(v, dict) and all(re.fullmatch(r"[A-Z]+\d+", x) for x in v), f"{where}: comments の番地")
            else:
                ok(scalar(v), f"{where}: {k} が入れ子")
            if k in ("date", "start", "end") and isinstance(v, str):
                ok(re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) is not None, f"{where}: {k} が YYYY-MM-DD でない")
        if "manDays" in f:
            ok("manDaysText" in f, f"{where}: manDays に manDaysText が無い")
        if a["plan"] and r.get("kind") == "item":
            ok("path" in f and "marks" in f, f"{where}: 星取表の行に path・marks が無い")
    # 場所の重なり
    locs = [(r.get("sheet"), r.get("r"), r.get("seq")) for r in recs]
    ok(len(locs) == len(set(locs)), f"{fac}/{stem}: 同じ場所の記録が 2 つある")
    if ext == ".pdf" or ext in (".jpg", ".jpeg"):
        seqs = [r["seq"] for r in recs]
        ok(seqs == list(range(len(seqs))), f"{fac}/{stem}: seq が 0 からの連番でない")


# ---------------------------------------------------------------- xlsx
def merged_value_map(ws):
    m = {}
    for rg in ws.merged_cells.ranges:
        v = ws.cell(rg.min_row, rg.min_col).value
        for rr in range(rg.min_row, rg.max_row + 1):
            for cc in range(rg.min_col, rg.max_col + 1):
                m[(rr, cc)] = v
    return m


def row_cells(ws, r, mm):
    out = []
    for c in range(1, ws.max_column + 1):
        v = mm.get((r, c), ws.cell(r, c).value)
        if v is not None:
            out.append((c, v))
    return out


def year_columns(ws):
    """見出しの中の、年度の数（令和の年の数か西暦）が 10 以上ならぶ行から、列 → 年度"""
    for r in range(1, 12):
        cols = {}
        for c in range(1, ws.max_column + 1):
            v = ws.cell(r, c).value
            if v == "元":
                cols[c] = 2019
            elif isinstance(v, int) and 1 <= v <= 30:
                cols[c] = 2018 + v
            elif isinstance(v, int) and 2000 <= v <= 2060:
                cols[c] = v
        if len(cols) >= 10:
            return cols
    return {}


def check_xlsx(fac, a, path):
    wb = openpyxl.load_workbook(path)
    ok("【架空】" in (wb.properties.creator or ""), f"{fac}/{a['file']}: 文書のプロパティの作成者に【架空】が無い")
    first = wb.worksheets[0]
    ok("【架空】" in str(first["A1"].value or ""), f"{fac}/{a['file']}: 表題のセル A1 に【架空】が無い")
    mms = {ws.title: merged_value_map(ws) for ws in wb.worksheets}
    for i, r in enumerate(a["records"]):
        where = f"{fac}/{a['file']} {r['sheet']}!{r['r']}"
        if not ok(r["sheet"] in wb.sheetnames, f"{where}: シートが無い"):
            continue
        ws = wb[r["sheet"]]
        mm = mms[ws.title]
        cells = row_cells(ws, r["r"], mm)
        if not ok(cells, f"{where}: 行が空"):
            continue
        texts = [cell_texts(v) for _, v in cells]
        if r["kind"] in ("subtotal", "total"):
            ok(any("計" in str(v) for _, v in cells), f"{where}: 小計・合計の行に「計」が無い")
            continue
        # その枚・その表の上の行（帳票の項目）
        near = []  # 帳票の枚の項目は、同じ枚（明細の上と下。続紙の修繕費は次の枚）にある
        for rr in range(max(1, r["r"] - 25), r["r"] + 31):
            near += [cell_texts(v) for _, v in row_cells(ws, rr, mm)]
        f = r["fields"]
        for k, v in f.items():
            if k == "path":
                last = v[-1]
                ok(found_in(last, texts) or any("〃" in str(x) for _, x in cells) or found_in(last.replace(" ", ""), texts),
                   f"{where}: path の最後『{last}』が行に無い")
                continue
            if k == "marks":
                if a["plan"]:
                    ycol = year_columns(ws)
                    got = {}
                    for c, y in ycol.items():
                        v0 = mm.get((r["r"], c), ws.cell(r["r"], c).value)
                        if v0 is not None:
                            got[str(y)] = str(v0)
                    want = {y: (s if isinstance(s, str) else "".join(s)) for y, s in v.items()}
                    ok(got == want, f"{where}: 年度ごとの印が合わない 行={got} 正解={want}")
                continue
            if k == "comments":
                for ref, txt in v.items():
                    cm = ws[ref].comment
                    ok(cm is not None and cm.text == txt, f"{where}: メモ {ref} が合わない")
                continue
            if k in ("specs",):
                for x in v:
                    ok(found_in(x, texts), f"{where}: specs『{x}』が行に無い")
                continue
            if k in ("cycle",) and isinstance(v, (int, float)):
                ok(found_in(v, texts) or found_in(f"{v}年", texts) or (v == 1 and found_in("毎年", texts)),
                   f"{where}: cycle {v} が行に無い")
                continue
            if k in ("line", "no") and isinstance(v, int):
                ok(found_in(v, texts) or found_in(v, near), f"{where}: {k}={v} が無い")
                continue
            if k == "manDays":
                continue  # manDaysText で確かめる
            if k in ("work",) and a["plan"] and not found_in(v, texts):
                ok(any("〃" in str(x) for _, x in cells), f"{where}: work『{v}』が行に無い")
                continue
            if k in ("inflow_m3", "outflow_m3", "rain_mm", "date", "weather", "writer", "report_no", "report_date",
                     "occur_date", "done_date", "equipment", "code", "status", "action", "cost", "inspector"):
                ok(found_in(v, texts) or found_in(v, near),
                   f"{where}: {k}={v!r} がその枚に無い")
                continue
            if k in ("unit",):
                continue  # 単位は見出しや注記に書いてある
            if k.endswith("_status"):
                ok(found_in(v, texts), f"{where}: {k} が行に無い")
                continue
            ok(found_in(v, texts), f"{where}: {k}={v!r} が行に無い")
    # 星取表：最初の記録から最後の記録までの空でない行は、どれも記録がある
    if a["plan"]:
        by_sheet = {}
        for r in a["records"]:
            by_sheet.setdefault(r["sheet"], set()).add(r["r"])
        for sh, rs in by_sheet.items():
            ws = wb[sh]
            for rr in range(min(rs), max(rs) + 1):
                if rr not in rs and row_cells(ws, rr, {}):
                    err(f"{fac}/{a['file']} {sh}!{rr}: データの行らしいのに記録が無い")
    return wb


# ---------------------------------------------------------------- csv
def check_csv(fac, a, path):
    raw = open(path, "rb").read()
    try:
        raw.decode("utf-8")
        err(f"{fac}/{a['file']}: UTF-8 で読めてしまう（Shift_JIS でない）")
    except UnicodeDecodeError:
        pass
    text = raw.decode("cp932")
    lines = text.split("\n")
    ok("【架空】" in lines[0], f"{fac}/{a['file']}: 1 行目に【架空】が無い")
    # 物理の行と記録の始まり
    rd = csv.reader(io.StringIO(text, newline=""))
    starts = {}
    line = 1
    for rec in rd:
        starts[line] = rec
        line += 1 + sum(x.count("\n") for x in rec)
    data_starts = [ln for ln, rec in starts.items() if rec and not rec[0].startswith("#") and rec[0] != "日付"]
    rs = {r["r"] for r in a["records"]}
    ok(set(data_starts) == rs, f"{fac}/{a['file']}: データの行と記録の行が合わない（差 {sorted(set(data_starts) ^ rs)[:5]}）")
    for r in a["records"]:
        rec = starts.get(r["r"])
        if not ok(rec is not None, f"{fac}/{a['file']} r={r['r']}: 記録の始まりの行でない"):
            continue
        texts = [cell_texts(x) for x in rec]
        for k, v in r["fields"].items():
            if k == "manDays":
                continue
            if k == "date":
                ok(rec[0].replace("/", "-") == v, f"{fac}/{a['file']} r={r['r']}: date")
                continue
            ok(found_in(v, texts), f"{fac}/{a['file']} r={r['r']}: {k}={v!r} が行に無い")
    return len(a["records"])


# ---------------------------------------------------------------- pdf
def pdf_pages(path):
    d = pdfium.PdfDocument(path)
    pages = [d[i].get_textpage().get_text_range() for i in range(len(d))]
    meta = d.get_metadata_dict()
    d.close()
    return pages, meta


def check_pdf(fac, a, path, header_word):
    pages, meta = pdf_pages(path)
    ok("【架空】" in pages[0], f"{fac}/{a['file']}: 1 ページ目に【架空】が無い")
    ok("【架空】" in (meta.get("Author", "") + meta.get("Title", "")), f"{fac}/{a['file']}: 文書の情報に【架空】が無い")
    ok(len(pages) >= 2, f"{fac}/{a['file']}: ページが 1 つだけ")
    for i, p in enumerate(pages):
        ok(header_word in p, f"{fac}/{a['file']}: {i + 1} ページ目に見出し『{header_word}』が無い")
    ok(any(("前ページから続く" in p) or ("前頁より続く" in p) for p in pages[1:]), f"{fac}/{a['file']}: 続きの印が無い")
    # 記録の順に、文字が文書の中で順に出てくる
    full = "\n".join(pages)
    flat = full.replace("\r", "").replace("\n", " ")
    pos = 0
    for r in a["records"]:
        f = r["fields"]
        if r["kind"] == "parent":
            key = f.get("name") or f["path"][-1]
        elif r["kind"] == "subtotal":
            key = "小"
        elif r["kind"] == "total":
            key = "合"
        else:
            key = f.get("equipment") or f.get("part") or f["path"][-1]
        j = flat.find(key, pos)
        if not ok(j >= 0, f"{fac}/{a['file']} seq={r['seq']}: 『{key}』が順に見つからない"):
            continue
        # その行のほかの値（同じ行の文字は近くにある）
        seg = flat[j:j + 260]
        for k, v in f.items():
            if k in ("path", "manDays", "install_year", "no", "work_no", "days") or isinstance(v, list):
                continue
            if k in ("start", "end"):
                dd = dt.date.fromisoformat(v)
                ok(re.search(rf"(?<![\d/]){dd.month}/{dd.day}(?![\d])", seg[:120]) is not None,
                   f"{fac}/{a['file']} seq={r['seq']}: {k}={v} が無い")
                continue
            if isinstance(v, (int, float)):
                sv = f"{v:,}" if isinstance(v, int) else str(v)
                ok(sv in seg or str(v) in seg, f"{fac}/{a['file']} seq={r['seq']}: {k}={v} が無い")
                continue
            ok(v in seg or v in flat, f"{fac}/{a['file']} seq={r['seq']}: {k}『{v}』が無い")
        pos = j + 1
    return len(pages)


# ---------------------------------------------------------------- photo
def check_photo(fac, a, path):
    im = Image.open(path)
    w, h = im.size
    size = os.path.getsize(path)
    ok(im.format == "JPEG", f"{fac}/{a['file']}: JPEG でない")
    ok(1568 <= max(w, h) <= 2000, f"{fac}/{a['file']}: 長い辺 {max(w, h)}px が 1,568〜2,000 でない")
    ok(60_000 <= size <= 160_000, f"{fac}/{a['file']}: {size} バイトが 100KB 前後でない")
    src = os.path.join(ROOT, "gen", "src", "f2_日常点検表_印字.pdf")
    pages, _ = pdf_pages(src)
    ok("【架空】" in pages[0], f"{fac}/{a['file']}: 紙（もとの頁）に【架空】が無い")
    for r in a["records"]:
        ok(r["fields"].get("equipment", "") in pages[0], f"{fac}/{a['file']} seq={r['seq']}: 設備の名前が紙に無い")
    unread = sum(1 for r in a["records"] for v in r["fields"].values() if v == "読めない")
    ok(unread >= 1, f"{fac}/{a['file']}: 読めないセルの記録が無い")
    return (w, h, size, unread)


# ---------------------------------------------------------------- 世界
def check_world(fac, world, ans):
    ok(world.get("schema") == "moyai.answer.world/0", f"{fac}: world の schema")
    fa = world.get("facility", {})
    ok(fa.get("id") == fac and fa.get("name", "").startswith("【架空】"), f"{fac}: facility の id・name")
    ok(fa.get("industry") in ("waste-incineration", "night-soil", "sewer", "water", "industrial-water", "building"),
       f"{fac}: industry")
    ok(isinstance(fa.get("profile"), dict) and fa["profile"], f"{fac}: profile")
    ok(world.get("fiscal_year_start_month") == 4 and world.get("man_day_hours") == 8, f"{fac}: 年度・人日")
    ok(re.fullmatch(r"\d{4}-\d{2}-\d{2}", world.get("today", "")) is not None, f"{fac}: today")
    by_file = {a["file"]: a for a in ans.values()}
    locs = {}
    for a in ans.values():
        for r in a["records"]:
            locs[(a["file"], r.get("sheet"), r.get("r"), r.get("seq"))] = r
    eq_ids = set()
    for e in world["equipment"]:
        for k in ("id", "name", "names", "furnace", "install_year", "code", "path", "rows"):
            ok(k in e, f"{fac} 機器 {e.get('id')}: {k} が無い")
        eq_ids.add(e["id"])
        for fn in e["names"]:
            ok(fn in by_file, f"{fac} 機器 {e['id']}: names のファイル {fn} が無い")
        for rw in e["rows"]:
            key = (rw["file"], rw.get("sheet"), rw.get("r"), rw.get("seq"))
            ok(key in locs, f"{fac} 機器 {e['id']}: 行 {key} が正解の記録に無い")
    ok(len(eq_ids) == len(world["equipment"]), f"{fac}: 機器の id が重なる")
    wids = set()
    n_rows = 0
    for w in world["works"]:
        ok(w["attribute"] in ("INSPECT", "OVERHAUL", "REPLACE", "UPGRADE"), f"{fac} {w['id']}: attribute")
        ok(w["status"] in ("actual", "planned"), f"{fac} {w['id']}: status")
        ok(isinstance(w["fiscal_year"], int), f"{fac} {w['id']}: fiscal_year")
        ok(w["equipment"] and all(e in eq_ids for e in w["equipment"]), f"{fac} {w['id']}: 機器が無い")
        if "start" in w and "end" in w:
            ok(w["start"] <= w["end"], f"{fac} {w['id']}: start > end")
            if w["status"] == "actual":
                ok(w["end"] < world["today"], f"{fac} {w['id']}: 実施なのに今日より後")
        if fa.get("industry") != "waste-incineration":
            ok("precision" not in w, f"{fac} {w['id']}: ごみ焼却でないのに precision")
        wids.add(w["id"])
        for rw in w["rows"]:
            key = (rw["file"], rw.get("sheet"), rw.get("r"), rw.get("seq"))
            rec = locs.get(key)
            if not ok(rec is not None, f"{fac} {w['id']}: 行 {key} が正解の記録に無い"):
                continue
            n_rows += 1
            if by_file[rw["file"]]["plan"]:
                y = rw.get("year")
                ok(isinstance(y, int) and str(y) in rec["fields"].get("marks", {}),
                   f"{fac} {w['id']}: 星取表の行 {key} の年度 {y} に印が無い")
    un = {u["work"] for u in world["unrecorded"]}
    for u in world["unrecorded"]:
        ok(u["work"] in wids and u.get("reason"), f"{fac}: unrecorded {u['work']}")
    for w in world["works"]:
        if w["id"] in un:
            ok(not w["rows"], f"{fac} {w['id']}: unrecorded なのに行がある")
        else:
            ok(bool(w["rows"]), f"{fac} {w['id']}: どの資料の行も無いのに unrecorded に無い")
    for d in world["defects"]:
        ok(all(k in d for k in ("kind", "where", "check")), f"{fac}: defects の欄")
    # 星取表の印は、どれかの作業が指している
    for a in ans.values():
        if not a["plan"]:
            continue
        pointed = {(rw.get("sheet"), rw.get("r"), rw.get("year")) for w in world["works"] for rw in w["rows"]
                   if rw["file"] == a["file"]}
        for r in a["records"]:
            for y in r["fields"].get("marks", {}):
                ok((r["sheet"], r["r"], int(y)) in pointed, f"{fac} {a['file']} {r['sheet']}!{r['r']} {y}: 印を指す作業が無い")
    return len(world["equipment"]), len(world["works"]), n_rows, len(un)


# ---------------------------------------------------------------- 禁止の語
def forbidden_words():
    ws = []
    with open(os.path.join(REF, "forbidden-words.txt"), encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if ln and not ln.startswith("#"):
                ws.append(ln.lower())
    return ws


def all_texts():
    """組の中のすべてのファイルの文字（xlsx はセル・メモ・プロパティ、pdf は文字、csv は cp932）"""
    out = []
    for p in glob.glob(os.path.join(ROOT, "**", "*"), recursive=True):
        if os.path.isdir(p) or os.sep + "measured" + os.sep in p or "__pycache__" in p:
            continue
        rel = os.path.relpath(p, ROOT)
        out.append((rel, rel))  # ファイルの名前
        ext = os.path.splitext(p)[1].lower()
        try:
            if ext in (".py", ".md", ".json", ".txt"):
                out.append((rel, open(p, encoding="utf-8").read()))
            elif ext == ".csv":
                out.append((rel, open(p, "rb").read().decode("cp932")))
            elif ext == ".xlsx":
                z = zipfile.ZipFile(p)
                for n in z.namelist():
                    if n.endswith(".xml") or n.endswith(".rels"):
                        out.append((rel + ":" + n, z.read(n).decode("utf-8", "replace")))
            elif ext == ".pdf":
                pages, meta = pdf_pages(p)
                out.append((rel, "\n".join(pages) + json.dumps(meta, ensure_ascii=False)))
        except Exception as e:  # noqa
            err(f"{rel}: 読めない {e}")
    return out


# ---------------------------------------------------------------- 性質
def check_properties(info):
    P = {}
    f1 = info["f-ashihara"]
    f2 = info["f-oboroya"]
    f3 = info["f-kirinose"]
    f4 = info["f-tenkyodai"]
    # 横持ち：年度の列が 10 以上の行がある星取表
    def year_header(wb, rows):
        ws = wb.worksheets[0]
        best = 0
        for r in rows:
            vals = [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]
            n = sum(1 for v in vals if (isinstance(v, int) and (1 <= v <= 12 or 2000 <= v <= 2040)) or v == "元")
            best = max(best, n)
        return best
    P["横持ち（年度が列）"] = year_header(f1["plan_wb"], [7]) >= 10 and year_header(f4["plan_wb"], [6]) >= 10
    P["縦持ち（1 行 = 1 件）"] = f1["csv_n"] >= 50
    # 見出し 3 段で途中に結合
    def mid_merge(wb, r_mid):
        ws = wb.worksheets[0]
        return any(rg.min_row == r_mid and rg.max_row == r_mid and rg.max_col - rg.min_col >= 2 for rg in ws.merged_cells.ranges)
    P["見出しが 3 段で途中に結合"] = mid_merge(f1["plan_wb"], 6) and mid_merge(f4["plan_wb"], 5)
    # 帳票：1 日 1 枚（写真）・1 件 1 枚（修繕報告書）／1 日 1 シート（日報）
    rep = f4["repair_wb"].worksheets[0]
    n_forms = sum(1 for r in range(1, rep.max_row + 1) if rep.cell(r, 1).value == "報告No.")
    daily = f3["daily_wb"]
    n_daysheets = sum(1 for n in daily.sheetnames if re.fullmatch(r"\d+月\d+日", n))
    P["帳票（1 日 1 枚・1 件 1 枚）と 1 日 1 シートの帳票"] = n_forms >= 5 and f2["photo"] is not None and n_daysheets >= 15
    # 続紙
    cont_sheet = any("(続)" in n and daily[n]["A3"].value == "前葉から続く" for n in daily.sheetnames)
    cont_form = any("（続き）" in str(rep.cell(r, 1).value or "") for r in range(1, rep.max_row + 1))
    P["続紙（続き・前ページから続く）"] = cont_sheet and cont_form and f1["pdf_pages"] >= 2
    # 1 シートに複数の表・途中で変わる見出し
    led = f2["ledger_wb"].worksheets[0]
    heads = [tuple(led.cell(r, c).value for c in range(1, 13)) for r in range(1, led.max_row + 1) if led.cell(r, 1).value == "No."]
    pump = f3["pump_wb"].worksheets[0]
    pheads = [r for r in range(1, pump.max_row + 1) if pump.cell(r, 1).value == "点検日"]
    P["1 シートに複数の表、途中で変わる見出し"] = len(heads) >= 4 and len(set(heads)) >= 2 and len(pheads) == 2
    # 合計が上・年度の合計が自分の年度の行の上
    def total_first(ans):
        recs = [r for r in ans["records"]]
        return recs[0]["kind"] == "total"
    sub_above = True
    for r in range(1, led.max_row + 1):
        v = led.cell(r, 1).value
        if isinstance(v, str) and v.endswith("計") and "年度" in v:
            sub_above &= led.cell(r + 1, 1).value == "No." and isinstance(led.cell(r + 2, 1).value, int)
    P["合計が上の表、自分の年度の行の上の年度の合計"] = total_first(f1["plan_ans"]) and total_first(f4["plan_ans"]) and \
        total_first(f2["ledger_ans"]) and sub_above
    # 年度の途中で列が増える
    if len(pheads) == 2:
        w0 = sum(1 for c in range(1, 40) if pump.cell(pheads[0], c).value is not None)
        w1 = sum(1 for c in range(1, 40) if pump.cell(pheads[1], c).value is not None)
        P["年度の途中で列が増える表"] = w1 > w0
    else:
        P["年度の途中で列が増える表"] = False
    P["文字の PDF の罫線の表（ページごとに見出しをくり返す）"] = f1["pdf_pages"] >= 2 and f4["pdf_pages"] >= 2
    P["Shift_JIS の CSV"] = f1["csv_n"] > 0
    P["写真（紙の帳票を撮ったもの）"] = f2["photo"] is not None
    for k, v in P.items():
        ok(v, f"§2.2 の性質が無い：{k}")
    return P


def main():
    info = {}
    totals = {}
    exts_by_ind = {}
    for fac in FAC:
        d = os.path.join(ROOT, fac)
        files_dir = os.path.join(d, "files")
        ok(os.path.isfile(os.path.join(d, "user.md")), f"{fac}: user.md が無い")
        ans, world = load_answers(fac)
        files = sorted(os.listdir(files_dir))
        stems = {os.path.splitext(f)[0] for f in files}
        ok(stems == set(ans), f"{fac}: ファイルと正解が 1 対 1 でない {stems ^ set(ans)}")
        for f in files:
            ok(f.startswith("【架空】"), f"{fac}: ファイルの名前が【架空】で始まらない {f}")
            exts_by_ind.setdefault(world["facility"]["industry"], []).append(os.path.splitext(f)[1].lower())
        inf = {"photo": None}
        for stem, a in ans.items():
            check_shape(fac, stem, a, files_dir)
            p = os.path.join(files_dir, a["file"])
            ext = os.path.splitext(p)[1].lower()
            if ext == ".xlsx":
                wb = check_xlsx(fac, a, p)
                if a["plan"]:
                    inf["plan_wb"], inf["plan_ans"] = wb, a
                elif "日報" in a["file"]:
                    inf["daily_wb"] = wb
                elif "ポンプ" in a["file"]:
                    inf["pump_wb"] = wb
                elif "修繕" in a["file"]:
                    inf["repair_wb"] = wb
                elif "発注" in a["file"]:
                    inf["ledger_wb"], inf["ledger_ans"] = wb, a
            elif ext == ".csv":
                inf["csv_n"] = check_csv(fac, a, p)
            elif ext == ".pdf":
                inf["pdf_pages"] = check_pdf(fac, a, p, "作業内容" if fac == "f-ashihara" else "設備・機器名称")
            elif ext == ".jpg":
                inf["photo"] = check_photo(fac, a, p)
        totals[fac] = check_world(fac, world, ans) + (len(files), sum(len(a["records"]) for a in ans.values()))
        info[fac] = inf
    # 組の形
    ok(3 <= len(FAC) <= 4, "施設の数が 3〜4 でない")
    nfiles = sum(t[4] for t in totals.values())
    ok(9 <= nfiles <= 10, f"ファイルの数 {nfiles} が 9〜10 でない")
    w = exts_by_ind.get("waste-incineration", [])
    ok({".xlsx", ".csv", ".pdf", ".jpg"} <= set(w), f"ごみ焼却で Excel・CSV・PDF・写真がそろわない {sorted(set(w))}")
    ok(len(w) * 2 == nfiles, f"ごみ焼却のファイルが組の半分でない（{len(w)}/{nfiles}）")
    for k in ("README.md", "WRITER.md"):
        ok(os.path.isfile(os.path.join(ROOT, k)), f"{k} が無い")
    P = check_properties(info)
    # 禁止の語
    fw = forbidden_words()
    for rel, t in all_texts():
        low = t.lower()
        for word in fw:
            if word in low:
                err(f"禁止の語『{word}』が {rel} にある")
    # 報告
    print("== 組 heldout-4 の確かめ ==")
    for fac, (ne, nw, nr, nu, nf, nrec) in totals.items():
        print(f"{fac}: ファイル {nf} 記録 {nrec} 機器 {ne} 作業 {nw} 作業の行の結び {nr} どの資料にも無い作業 {nu}")
    print(f"ファイルの数 {nfiles}")
    for k, v in P.items():
        print(f"  §2.2 {'OK ' if v else 'NG '} {k}")
    ph = info["f-oboroya"]["photo"]
    if ph:
        print(f"  写真 {ph[0]}×{ph[1]}px {ph[2]:,} バイト 読めないセル {ph[3]}")
    if errors:
        print(f"NG：{len(errors)} 件")
        for e in errors[:80]:
            print("  - " + e)
        sys.exit(1)
    print("OK：すべて通った")


if __name__ == "__main__":
    main()
