# -*- coding: utf-8 -*-
"""truth.json と資料が食い違っていないかを確かめる。

  python -I -X utf8 writer/check.py

通れば最後に「OK」と出して 0 で終わる。食い違いは 1 つずつ書いて 1 で終わる。
"""
import csv
import datetime as dt
import io
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parent.parent
FILES = ROOT / "files"
errors = []


def err(msg):
    errors.append(msg)


def norm(s):
    s = unicodedata.normalize("NFKC", str(s))
    return re.sub(r"\s+", "", s)


T = json.loads((ROOT / "truth.json").read_text(encoding="utf-8"))
W = json.loads((ROOT / T.get("world", "world.json")).read_text(encoding="utf-8"))
EQ = {e["id"]: e for e in W["equipment"]}
WK = {w["id"]: w for w in W["works"]}
HOURS = W["man_day_hours"]

# ------------------------------------------------------------ 1. 形
TOP = {"schema", "set", "world", "files", "assets", "marks", "events"}
FILE_KEYS = {"file", "format", "kind", "encoding", "delimiter", "note", "source_xlsx", "hidden_data", "photo_of"}
ASSET_KEYS = {"file", "at", "kind", "level", "parent", "equipment_id", "path", "name_text", "name", "tag",
              "install_year", "spec_texts", "measure"}
MARK_KEYS = {"file", "at", "fiscal_year", "status", "equipment_id", "work_ids", "symbol"}
EVENT_KEYS = {"file", "at", "status", "fiscal_year", "equipment_ids", "work_ids", "start", "end", "man_days",
              "days", "bundle"}
AT_KEYS = ({"cell", "sheet"}, {"cell"}, {"row", "sheet"}, {"row"}, {"texts"})

if set(T) != TOP:
    err(f"truth の頭のキーが違う: {sorted(set(T) ^ TOP)}")
if T.get("schema") != "moyai.heldout.truth/0":
    err("schema が違う")
if T.get("set") != "heldout-2":
    err("set が違う")


def keys_ok(obj, allowed, required, where):
    extra = set(obj) - allowed
    if extra:
        err(f"{where}: 知らないキー {sorted(extra)}")
    miss = set(required) - set(obj)
    if miss:
        err(f"{where}: 足りないキー {sorted(miss)}")


def at_ok(at, where):
    if not isinstance(at, dict) or set(at) not in AT_KEYS:
        err(f"{where}: at の形が違う {at}")
        return
    if "texts" in at:
        if not (isinstance(at["texts"], list) and 1 <= len(at["texts"]) <= 4 and all(isinstance(t, str) and t for t in at["texts"])):
            err(f"{where}: texts は 1〜4 個の文字")
    if "cell" in at and not re.fullmatch(r"[A-Z]{1,3}[1-9][0-9]*", at["cell"]):
        err(f"{where}: cell の形 {at['cell']}")
    if "row" in at and not (isinstance(at["row"], int) and at["row"] >= 1):
        err(f"{where}: row の形 {at['row']}")


files = {}
for i, f in enumerate(T["files"]):
    where = f"files[{i}]"
    keys_ok(f, FILE_KEYS, {"file", "format", "kind", "note"}, where)
    if f["format"] not in ("xlsx", "csv", "pdf", "jpg"):
        err(f"{where}: format {f['format']}")
    if f["kind"] not in ("ledger", "star", "daily", "report", "photo"):
        err(f"{where}: kind {f['kind']}")
    if f["format"] == "csv":
        if "encoding" not in f or f.get("delimiter") not in (",", "\t"):
            err(f"{where}: csv の encoding / delimiter")
    elif "encoding" in f or "delimiter" in f:
        err(f"{where}: csv でないのに encoding / delimiter")
    if f["kind"] == "photo":
        po = f.get("photo_of")
        if not po or set(po) != {"file", "page"} or not (FILES / po["file"]).exists():
            err(f"{where}: photo_of")
    if "source_xlsx" in f and not (FILES / f["source_xlsx"]).exists():
        err(f"{where}: source_xlsx が無い")
    if not (FILES / f["file"]).exists():
        err(f"{where}: ファイルが無い {f['file']}")
    files[f["file"]] = f

# 資料の種類がそろっているか
kinds = Counter((f["kind"], f["format"]) for f in T["files"])
for k, fm in (("ledger", "xlsx"), ("star", "xlsx"), ("daily", "csv"), ("report", "pdf"), ("photo", "jpg")):
    if kinds[(k, fm)] < 1:
        err(f"{k} の {fm} が無い")

# 【架空】が入っているか
for f in T["files"]:
    p = FILES / f["file"]
    if f["format"] == "xlsx":
        wb = openpyxl.load_workbook(p)
        if "【架空】" not in (wb.properties.creator or ""):
            err(f"{f['file']}: 作成者に【架空】が無い")
        if "【架空】" not in str(wb.worksheets[0]["A1"].value):
            err(f"{f['file']}: 題に【架空】が無い")
    elif f["format"] == "csv":
        first = p.read_bytes().decode(f["encoding"]).splitlines()[0]
        if "【架空】" not in first:
            err(f"{f['file']}: 1 行目に【架空】が無い")
    elif f["format"] == "pdf":
        doc = pdfium.PdfDocument(str(p))
        if "【架空】" not in doc[0].get_textpage().get_text_range():
            err(f"{f['file']}: 題に【架空】が無い")

# ------------------------------------------------------------ 読み出しの道具
_wb_cache = {}


def sheet(file, name):
    if file not in _wb_cache:
        _wb_cache[file] = openpyxl.load_workbook(FILES / file)
    wb = _wb_cache[file]
    return wb[name] if name else wb.worksheets[0]


def xlsx_cell(file, at):
    ws = sheet(file, at.get("sheet"))
    for rng in ws.merged_cells.ranges:
        if at["cell"] in rng and rng.start_cell.coordinate != at["cell"]:
            err(f"{file} {at}: 結合の左上でない")
    v = ws[at["cell"]].value
    return "" if v is None else str(v)


def xlsx_row(file, at):
    ws = sheet(file, at.get("sheet"))
    r = at["row"] if "row" in at else ws[at["cell"]].row
    return ["" if c.value is None else str(c.value) for c in ws[r]]


_csv_cache = {}


def csv_records(file):
    """物理の行の番号 → 記録（セルの並び）。"""
    if file not in _csv_cache:
        f = files[file]
        text = (FILES / file).read_bytes().decode(f["encoding"])
        rd = csv.reader(io.StringIO(text, newline=""), delimiter=f["delimiter"])
        recs = {}
        prev = 0
        for rec in rd:
            recs[prev + 1] = rec
            prev = rd.line_num
        _csv_cache[file] = recs
    return _csv_cache[file]


def col_index(cell):
    m = re.fullmatch(r"([A-Z]+)(\d+)", cell)
    n = 0
    for ch in m.group(1):
        n = n * 26 + ord(ch) - 64
    return n - 1, int(m.group(2))


def csv_cell(file, at):
    ci, r = col_index(at["cell"])
    rec = csv_records(file).get(r)
    if rec is None:
        err(f"{file} 行 {r}: 記録の始まりでない")
        return ""
    return rec[ci] if ci < len(rec) else ""


def cell_text(file, at):
    return xlsx_cell(file, at) if files[file]["format"] == "xlsx" else csv_cell(file, at)


def row_cells(file, at):
    fm = files[file]["format"]
    if fm == "xlsx":
        return xlsx_row(file, at)
    if fm == "csv":
        r = at["row"] if "row" in at else col_index(at["cell"])[1]
        rec = csv_records(file).get(r)
        if rec is None:
            err(f"{file} 行 {r}: 記録の始まりでない")
            return []
        return rec
    raise ValueError(fm)


_pdf_cache = {}


def pdf_text(file):
    if file not in _pdf_cache:
        doc = pdfium.PdfDocument(str(FILES / file))
        _pdf_cache[file] = norm("".join(pg.get_textpage().get_text_range() for pg in doc))
    return _pdf_cache[file]


def texts_rows(file, texts):
    """source_xlsx の行で、texts がそろってある行の一覧（セルの並び）。"""
    src = files[file].get("source_xlsx")
    if not src:
        return None
    ws = openpyxl.load_workbook(FILES / src).worksheets[0]
    hits = []
    for row in ws.iter_rows():
        vals = [norm(c.value) for c in row if c.value is not None]
        if all(any(v == norm(t) for v in vals) or any(norm(t) in v for v in vals) for t in texts):
            hits.append(["" if c.value is None else str(c.value) for c in row])
    return hits


# ------------------------------------------------------------ 2〜6. assets
assets_by_cell = {}
for i, a in enumerate(T["assets"]):
    where = f"assets[{i}]"
    keys_ok(a, ASSET_KEYS, {"file", "at", "kind", "level", "parent", "equipment_id", "name_text", "name", "tag"}, where)
    at_ok(a["at"], where)
    if a["file"] not in files or files[a["file"]]["kind"] not in ("ledger", "star"):
        err(f"{where}: file が台帳か星取表でない")
        continue
    assets_by_cell[(a["file"], a["at"].get("sheet"), a["at"]["cell"])] = a
    if a["kind"] == "group":
        if a["equipment_id"] is not None:
            err(f"{where}: group に equipment_id")
        p = a.get("path")
        if not p or not any(e["path"][:len(p)] == p for e in W["equipment"]):
            err(f"{where}: path が世界に無い {p}")
    elif a["kind"] in ("equipment", "part"):
        if a["equipment_id"] not in EQ:
            err(f"{where}: equipment_id が世界に無い {a['equipment_id']}")
            continue
        if "path" in a:
            err(f"{where}: group でないのに path")
        e = EQ[a["equipment_id"]]
        if a["kind"] == "part" and a["name"] not in [p["name"] for p in e["parts"]]:
            err(f"{where}: 部位 {a['name']} が世界に無い")
        if "install_year" in a and a["install_year"] != e["install_year"]:
            err(f"{where}: 設置年 {a['install_year']} != {e['install_year']}")
    else:
        err(f"{where}: kind {a['kind']}")
    # 3. 名前のセル
    txt = cell_text(a["file"], a["at"])
    if txt != a["name_text"]:
        err(f"{where}: セル {a['at']} は {txt!r}、name_text は {a['name_text']!r}")
    # 仕様の文字が同じ行にあるか
    if a.get("spec_texts"):
        rowv = row_cells(a["file"], a["at"])
        for s in a["spec_texts"]:
            if s not in rowv:
                err(f"{where}: 仕様 {s!r} が行に無い")
    # 設置年が行にあるか（台帳）
    if "install_year" in a:
        rowv = row_cells(a["file"], a["at"])
        if str(a["install_year"]) not in rowv:
            err(f"{where}: 設置年 {a['install_year']} が行に無い")

for i, a in enumerate(T["assets"]):
    if a["parent"] is not None:
        key = (a["file"], a["parent"].get("sheet"), a["parent"]["cell"])
        par = assets_by_cell.get(key)
        if par is None:
            err(f"assets[{i}]: parent {a['parent']} が assets に無い")
        elif a["level"] is not None and par["level"] is not None and par["level"] != a["level"] - 1:
            err(f"assets[{i}]: parent の段が 1 つ上でない")
        elif a["kind"] in ("equipment",) and par["kind"] == "group":
            if EQ[a["equipment_id"]]["path"][:len(par["path"])] != par["path"]:
                err(f"assets[{i}]: 親のまとまりが世界の path と違う")
        elif a["kind"] == "part" and par.get("equipment_id") != a["equipment_id"]:
            err(f"assets[{i}]: 部位の親が同じ機器でない")
    elif a["level"] not in (None, 1):
        err(f"assets[{i}]: 根なのに level {a['level']}")

# 台帳：すべての機器・部位・まとまりがあるか。星取表：すべての機器の行があるか
for f in T["files"]:
    if f["kind"] == "ledger":
        eqs = Counter(a["equipment_id"] for a in T["assets"] if a["file"] == f["file"] and a["kind"] == "equipment")
        parts = Counter((a["equipment_id"], a["name"]) for a in T["assets"] if a["file"] == f["file"] and a["kind"] == "part")
        groups = {tuple(a["path"]) for a in T["assets"] if a["file"] == f["file"] and a["kind"] == "group"}
        for e in W["equipment"]:
            if eqs[e["id"]] != 1:
                err(f"{f['file']}: 機器 {e['id']} が {eqs[e['id']]} 回")
            for p in e["parts"]:
                if parts[(e["id"], p["name"])] != 1:
                    err(f"{f['file']}: 部位 {e['id']} {p['name']} が無い")
            if tuple(e["path"]) not in groups:
                err(f"{f['file']}: まとまり {e['path']} が無い")
    if f["kind"] == "star":
        eqs = Counter(a["equipment_id"] for a in T["assets"] if a["file"] == f["file"] and a["kind"] == "equipment")
        for e in W["equipment"]:
            if eqs[e["id"]] != 1:
                err(f"{f['file']}: 星取表の機器 {e['id']} が {eqs[e['id']]} 回")

# ------------------------------------------------------------ marks
LEGEND = {"点": {"INSPECT"}, "整": {"OVERHAUL"}, "精": {"INSPECT"}, "取": {"REPLACE"}, "更": {"UPGRADE"}}
mark_works = Counter()
star_asset_rows = {}
for a in T["assets"]:
    if files.get(a["file"], {}).get("kind") == "star" and a["kind"] == "equipment":
        star_asset_rows[(a["file"], a["at"].get("sheet"), col_index(a["at"]["cell"])[1])] = a["equipment_id"]
for i, m in enumerate(T["marks"]):
    where = f"marks[{i}]"
    keys_ok(m, MARK_KEYS, MARK_KEYS, where)
    at_ok(m["at"], where)
    if m["equipment_id"] not in EQ:
        err(f"{where}: equipment_id が無い")
    txt = cell_text(m["file"], m["at"])
    if txt != m["symbol"]:
        err(f"{where}: セル {m['at']} は {txt!r}、symbol は {m['symbol']!r}")
    # 行の機器
    rowno = col_index(m["at"]["cell"])[1]
    if star_asset_rows.get((m["file"], m["at"].get("sheet"), rowno)) != m["equipment_id"]:
        err(f"{where}: 行の機器が違う")
    # 凡例の読み：（ ）付き＝予定
    planned = m["symbol"].startswith("（") and m["symbol"].endswith("）")
    if (m["status"] == "planned") != planned:
        err(f"{where}: 記号 {m['symbol']} と status {m['status']}")
    letters = m["symbol"].strip("（）").split("・")
    if len(letters) != len(m["work_ids"]):
        err(f"{where}: 記号の数と作業の数")
    ws_ = []
    for wid in m["work_ids"]:
        w = WK.get(wid)
        if w is None:
            err(f"{where}: work {wid} が無い")
            continue
        ws_.append(w)
        mark_works[wid] += 1
        if w["fiscal_year"] != m["fiscal_year"] or w["status"] != m["status"] or w["equipment_id"] != m["equipment_id"]:
            err(f"{where}: {wid} の年度・状態・機器が違う")
    for L, w in zip(letters, sorted(ws_, key=lambda w: (w["start"], w["id"]))):
        if w["attr"] not in LEGEND.get(L, set()):
            err(f"{where}: 記号 {L} と作業 {w['id']} {w['attr']}")
        if L == "精" and not w["precision"]:
            err(f"{where}: 精 なのに精密機能検査でない")
    # 年度と期の列
    ws = sheet(m["file"], m["at"].get("sheet"))
    ci, _ = col_index(m["at"]["cell"])
    hdr_year = None
    for c in range(ci + 1, 0, -1):
        v = ws.cell(6, c).value
        if v:
            hdr_year = v
            break
    half = ws.cell(7, ci + 1).value
    y = re.search(r"\((\d{4})\)", str(hdr_year))
    if not y or int(y.group(1)) != m["fiscal_year"]:
        err(f"{where}: 列の年度 {hdr_year} != {m['fiscal_year']}")
    for w in ws_:
        mo = int(w["start"][5:7])
        if (half == "上") != (4 <= mo <= 9):
            err(f"{where}: {w['id']} の着手月 {mo} と期 {half}")
for f in T["files"]:
    if f["kind"] == "star":
        for w in W["works"]:
            if mark_works[w["id"]] != 1:
                err(f"{f['file']}: 作業 {w['id']} の印が {mark_works[w['id']]} 個")

# 星取表に、印の無いのに記号のあるセルが無いか
for f in T["files"]:
    if f["kind"] != "star":
        continue
    ws = sheet(f["file"], None)
    marked = {m["at"]["cell"] for m in T["marks"] if m["file"] == f["file"]}
    for (fl, sh, r), eid in star_asset_rows.items():
        if fl != f["file"]:
            continue
        for c in ws[r][4:-1]:
            if c.value not in (None, "") and c.coordinate not in marked:
                err(f"{f['file']}: {c.coordinate} の記号 {c.value} が marks に無い")

# ------------------------------------------------------------ events
def to_date(s):
    return dt.date.fromisoformat(s)


def parse_wareki(s):
    m = re.fullmatch(r"R(\d+)\.(\d+)\.(\d+)", s)
    return dt.date(2018 + int(m.group(1)), int(m.group(2)), int(m.group(3)))


ev_sum = defaultdict(float)
for i, ev in enumerate(T["events"]):
    where = f"events[{i}]"
    keys_ok(ev, EVENT_KEYS, EVENT_KEYS, where)
    at_ok(ev["at"], where)
    f = files.get(ev["file"])
    if f is None or f["kind"] not in ("daily", "report"):
        err(f"{where}: file が作業の記録か報告書でない")
        continue
    ws_ = [WK.get(w) for w in ev["work_ids"]]
    if None in ws_ or not ws_:
        err(f"{where}: work_ids が世界に無い")
        continue
    if sorted(set(w["equipment_id"] for w in ws_)) != sorted(ev["equipment_ids"]):
        err(f"{where}: equipment_ids と作業の機器が違う")
    for e in ev["equipment_ids"]:
        if e not in EQ:
            err(f"{where}: equipment {e} が無い")
    if any(w["fiscal_year"] != ev["fiscal_year"] or w["status"] != ev["status"] for w in ws_):
        err(f"{where}: 年度か状態が違う")
    if ev["bundle"] != (len(ev["equipment_ids"]) > 1):
        err(f"{where}: bundle")
    st, en = to_date(ev["start"]), to_date(ev["end"])
    if st > en or any(st < to_date(w["start"]) or en > to_date(w["end"]) for w in ws_):
        err(f"{where}: 期間が作業の外")
    whole = all(ev["start"] == w["start"] and ev["end"] == w["end"] for w in ws_)
    if ev["days"] is not None:
        if not whole or any(ev["days"] != w["duration_days"] for w in ws_):
            err(f"{where}: days {ev['days']}")
    if whole and ev["man_days"] is not None and ev["man_days"] != sum(w["man_days"] for w in ws_):
        err(f"{where}: man_days {ev['man_days']} != {sum(w['man_days'] for w in ws_)}")
    if ev["man_days"] is not None:
        ev_sum[(ev["file"], tuple(ev["work_ids"]))] += ev["man_days"]

    # 資料の側：その行に書いた値
    at = ev["at"]
    if "texts" in at:
        if f["format"] != "pdf":
            err(f"{where}: texts は pdf だけに使った")
        txt = pdf_text(ev["file"])
        for t in at["texts"]:
            if norm(t) not in txt:
                err(f"{where}: pdf に {t!r} が無い")
        hits = texts_rows(ev["file"], at["texts"])
        if hits is not None:
            if len(hits) != 1:
                err(f"{where}: source_xlsx で {len(hits)} 行に当たる {at['texts']}")
                continue
            rowv = hits[0]
            if str(ev["man_days"]) not in rowv:
                err(f"{where}: 延人員 {ev['man_days']} が行に無い")
            if str(ev["days"]) not in rowv:
                err(f"{where}: 日数 {ev['days']} が行に無い")
            per = [v for v in rowv if "～" in v]
            if per:
                a_, b_ = per[0].split("～")
                if parse_wareki(a_) != st or parse_wareki(b_) != en:
                    err(f"{where}: 実施期間 {per[0]}")
        continue
    rec = row_cells(ev["file"], at)
    if not any(v.strip() for v in rec):
        err(f"{where}: 行が空")
        continue
    hdr = None
    for r, rr in sorted(csv_records(ev["file"]).items()):
        if rr and rr[0] in ("WO番号", "日付"):
            hdr = rr
            break
    rowd = dict(zip(hdr, rec))
    if "着手日" in rowd:
        if rowd["着手日"] != ev["start"].replace("-", "/") or rowd["完了日"] != ev["end"].replace("-", "/"):
            err(f"{where}: 日付が行と違う")
        hm = rowd["実績工数"] if ev["status"] == "actual" else rowd["予定工数"]
        other = rowd["予定工数"] if ev["status"] == "actual" else rowd["実績工数"]
        h, mi = hm.split(":")
        if other or (int(h) + int(mi) / 60) / HOURS != ev["man_days"]:
            err(f"{where}: 工数 {hm} != {ev['man_days']} 人日")
        if int(rowd["工期(日)"]) != ev["days"]:
            err(f"{where}: 工期が行と違う")
        if (rowd["状態"] == "完了") != (ev["status"] == "actual"):
            err(f"{where}: 状態が行と違う")
    elif "日付" in rowd:
        day = parse_wareki(rowd["日付"])
        if day != st or day != en:
            err(f"{where}: 日付 {rowd['日付']}")
        if "月火水木金土日"[day.weekday()] != rowd["曜"]:
            err(f"{where}: 曜 {rowd['曜']}")
        if float(rowd["工数(人工)"]) != ev["man_days"]:
            err(f"{where}: 工数 {rowd['工数(人工)']} != {ev['man_days']}")
    else:
        err(f"{where}: 見出しが分からない")

# 日に分けた作業は、行の工数の和が世界の工数になる
for (file, wids), s in ev_sum.items():
    tot = sum(WK[w]["man_days"] for w in wids)
    if abs(s - tot) > 1e-9:
        err(f"{file} {wids}: 工数の和 {s} != {tot}")

# CSV の、作業の行でない行（題・見出し・計）が events に入っていないか、作業の行が漏れていないか
for f in T["files"]:
    if f["format"] != "csv":
        continue
    rows = {ev["at"]["row"] for ev in T["events"] if ev["file"] == f["file"]}
    for r, rec in csv_records(f["file"]).items():
        is_work = bool(rec) and (re.fullmatch(r"WO-\d{4}-\d{4}", rec[0]) or re.fullmatch(r"R\d+\.\d+\.\d+", rec[0]))
        if bool(is_work) != (r in rows):
            err(f"{f['file']} 行 {r}: 作業の行と events が合わない {rec[:2]}")

# ------------------------------------------------------------ おわり
if errors:
    for e in errors:
        print("NG", e)
    print(f"{len(errors)} 件の食い違い")
    sys.exit(1)
print(f"OK  files={len(T['files'])} assets={len(T['assets'])} marks={len(T['marks'])} events={len(T['events'])}")
