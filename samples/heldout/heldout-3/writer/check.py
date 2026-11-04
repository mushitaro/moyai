# -*- coding: utf-8 -*-
"""truth.json と資料が食い違っていないかを確かめる。

走らせ方: python -I -X utf8 writer/check.py
通れば最後に「OK」と出て 0 で終わる。食い違いがあれば一覧を出して 1 で終わる。
"""
import csv
import io
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, FILES, load_world, d, norm, split_cell, col_index, short_h

import openpyxl
import pypdfium2 as pdfium

ERR = []


def err(msg):
    ERR.append(msg)


W = load_world()
EQ = {e["id"]: e for e in W["equipment"]}
WK = {w["id"]: w for w in W["works"]}
T = json.loads((ROOT / "truth.json").read_text(encoding="utf-8"))

# ---------------------------------------------------------------- 1. 形
TOP = ["schema", "set", "world", "files", "assets", "marks", "events"]
FILE_KEYS = {"file", "format", "kind", "encoding", "delimiter", "note", "source_xlsx", "hidden_data", "photo_of"}
ASSET_KEYS = {"file", "at", "kind", "level", "parent", "equipment_id", "path", "name_text", "name", "tag",
              "install_year", "spec_texts", "measure"}
MARK_KEYS = {"file", "at", "fiscal_year", "status", "equipment_id", "work_ids", "symbol"}
EVENT_KEYS = {"file", "at", "status", "fiscal_year", "equipment_ids", "work_ids", "start", "end", "man_days",
              "days", "bundle"}

if list(T.keys()) != TOP:
    err(f"truth の頭のキーが違う: {list(T.keys())}")
if T.get("schema") != "moyai.heldout.truth/0" or T.get("set") != "heldout-3" or T.get("world") != "world.json":
    err("schema / set / world の値が違う")


def check_at(at, where):
    if not isinstance(at, dict):
        err(f"{where}: at が dict でない")
        return
    keys = set(at)
    if "cell" in keys:
        if not keys <= {"cell", "sheet"} or not re.fullmatch(r"[A-Z]+[0-9]+", at["cell"]):
            err(f"{where}: cell の形が違う {at}")
    elif "row" in keys:
        if not keys <= {"row", "sheet"} or not isinstance(at["row"], int) or at["row"] < 1:
            err(f"{where}: row の形が違う {at}")
    elif "texts" in keys:
        if keys != {"texts"} or not (2 <= len(at["texts"]) <= 4) or not all(isinstance(t, str) and t for t in at["texts"]):
            err(f"{where}: texts の形が違う {at}")
    else:
        err(f"{where}: at の書き方が分からない {at}")


file_meta = {}
for i, fm in enumerate(T["files"]):
    w = f"files[{i}]"
    if not set(fm) <= FILE_KEYS:
        err(f"{w}: 知らないキー {set(fm) - FILE_KEYS}")
    for k in ("file", "format", "kind", "note"):
        if k not in fm:
            err(f"{w}: {k} が無い")
    if fm.get("format") not in ("xlsx", "csv", "pdf", "jpg"):
        err(f"{w}: format が違う")
    if fm.get("kind") not in ("ledger", "star", "daily", "report", "photo"):
        err(f"{w}: kind が違う")
    if fm.get("format") == "csv":
        if "encoding" not in fm or fm.get("delimiter") not in (",", "\t"):
            err(f"{w}: csv の encoding / delimiter")
    else:
        if "encoding" in fm or "delimiter" in fm:
            err(f"{w}: csv でないのに encoding / delimiter")
    if "hidden_data" in fm and fm["hidden_data"] not in ("include", "exclude"):
        err(f"{w}: hidden_data の値")
    if fm.get("kind") == "photo" and "photo_of" not in fm:
        err(f"{w}: photo_of が無い")
    if not (FILES / fm["file"]).exists():
        err(f"{w}: ファイルが無い {fm['file']}")
    if "source_xlsx" in fm and not (FILES / fm["source_xlsx"]).exists():
        err(f"{w}: source_xlsx が無い")
    if fm["file"] in file_meta:
        err(f"{w}: 同じファイルが 2 回")
    file_meta[fm["file"]] = fm
kinds = Counter(fm["kind"] for fm in T["files"])
for k in ("ledger", "star", "daily", "report", "photo"):
    if kinds[k] < 1:
        err(f"種類 {k} の資料が無い")
listed_sources = {fm.get("source_xlsx") for fm in T["files"]}
for fm in T["files"]:
    if fm["file"] in listed_sources:
        err(f"source_xlsx が files に載っている: {fm['file']}")

for i, a in enumerate(T["assets"]):
    w = f"assets[{i}]"
    if not set(a) <= ASSET_KEYS:
        err(f"{w}: 知らないキー {set(a) - ASSET_KEYS}")
    check_at(a["at"], w)
    if a["kind"] not in ("group", "equipment", "part"):
        err(f"{w}: kind")
for i, m in enumerate(T["marks"]):
    w = f"marks[{i}]"
    if set(m) != MARK_KEYS:
        err(f"{w}: キーが違う {set(m) ^ MARK_KEYS}")
    check_at(m["at"], w)
for i, e in enumerate(T["events"]):
    w = f"events[{i}]"
    if set(e) != EVENT_KEYS:
        err(f"{w}: キーが違う {set(e) ^ EVENT_KEYS}")
    check_at(e["at"], w)

# ---------------------------------------------------------------- 2. ID
for i, a in enumerate(T["assets"]):
    if a["kind"] == "group":
        if a.get("equipment_id") is not None:
            err(f"assets[{i}]: group に equipment_id")
        if not any(e["path"][:len(a["path"])] == a["path"] for e in W["equipment"]):
            err(f"assets[{i}]: path が世界に無い {a['path']}")
    else:
        if a.get("equipment_id") not in EQ:
            err(f"assets[{i}]: equipment_id が世界に無い")
        if "path" in a:
            err(f"assets[{i}]: group でないのに path")
for i, m in enumerate(T["marks"]):
    if m["equipment_id"] not in EQ or not all(x in WK for x in m["work_ids"]):
        err(f"marks[{i}]: ID が世界に無い")
for i, e in enumerate(T["events"]):
    if not all(x in EQ for x in e["equipment_ids"]) or not all(x in WK for x in e["work_ids"]):
        err(f"events[{i}]: ID が世界に無い")

# ---------------------------------------------------------------- 資料を読む道具
_xlsx = {}
_csv = {}


def xlsx(path):
    if path not in _xlsx:
        _xlsx[path] = openpyxl.load_workbook(FILES / path)
    return _xlsx[path]


def sheet_of(path, name):
    wb = xlsx(path)
    return wb[name] if name else wb.worksheets[0]


def csv_rows(path):
    """物理の行番号 → セルの並び。"""
    if path not in _csv:
        fm = file_meta[path]
        text = (FILES / path).read_bytes().decode(fm["encoding"])
        if fm["encoding"] in ("utf-16",):
            pass
        text = text.lstrip("﻿")
        rd = csv.reader(io.StringIO(text, newline=""), delimiter=fm["delimiter"])
        rows = {}
        start = 1
        for rec in rd:
            rows[start] = rec
            start = rd.line_num + 1
        _csv[path] = rows
    return _csv[path]


def cell_text(path, at):
    fm = file_meta[path]
    c, r = split_cell(at["cell"])
    if fm["format"] == "xlsx":
        v = sheet_of(path, at.get("sheet")).cell(r, c).value
        return None if v is None else str(v)
    if fm["format"] == "csv":
        row = csv_rows(path).get(r)
        if row is None or c > len(row):
            return None
        return row[c - 1]
    return None


def row_values(path, at):
    fm = file_meta[path]
    if fm["format"] == "xlsx":
        ws = sheet_of(path, at.get("sheet"))
        return ["" if v is None else str(v) for v in next(ws.iter_rows(min_row=at["row"], max_row=at["row"], values_only=True))]
    return csv_rows(path).get(at["row"], [])


_pdf_text = {}


def pdf_text(path):
    if path not in _pdf_text:
        doc = pdfium.PdfDocument(str(FILES / path))
        _pdf_text[path] = norm("".join(p.get_textpage().get_text_range() for p in doc))
    return _pdf_text[path]


def xlsx_rows_matching(src, texts):
    wb = openpyxl.load_workbook(FILES / src)
    hits = []
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            cells = [norm(c.value) for c in row if c.value is not None]
            ok = True
            for t in texts:
                nt = norm(t)
                if not (nt in cells or any(nt in c for c in cells)):
                    ok = False
                    break
            if ok:
                hits.append((ws.title, row[0].row, ["" if c.value is None else str(c.value) for c in row]))
    return hits


# ---------------------------------------------------------------- 3〜5. 場所
asset_cells = defaultdict(set)
for i, a in enumerate(T["assets"]):
    at = a["at"]
    fm = file_meta.get(a["file"])
    if fm is None:
        err(f"assets[{i}]: files に無いファイル")
        continue
    if fm["kind"] not in ("ledger", "star"):
        err(f"assets[{i}]: 台帳・星取表でない")
    v = cell_text(a["file"], at)
    if v != a["name_text"]:
        err(f"assets[{i}]: {at} の文字が name_text と違う: {v!r} != {a['name_text']!r}")
    asset_cells[a["file"]].add((at.get("sheet"), at["cell"]))
for i, a in enumerate(T["assets"]):
    p = a["parent"]
    if p is not None and (p.get("sheet"), p["cell"]) not in asset_cells[a["file"]]:
        err(f"assets[{i}]: parent のセルが assets に無い {p}")
    if p is None and a["level"] not in (None, 1):
        err(f"assets[{i}]: 根なのに level {a['level']}")

for i, m in enumerate(T["marks"]):
    v = cell_text(m["file"], m["at"])
    if v != m["symbol"]:
        err(f"marks[{i}]: {m['at']} の文字が symbol と違う: {v!r}")

for i, e in enumerate(T["events"]):
    at = e["at"]
    fm = file_meta[e["file"]]
    if "row" in at:
        vals = row_values(e["file"], at)
        if not any(str(x).strip() for x in vals):
            err(f"events[{i}]: 行 {at['row']} が空")
    elif "texts" in at:
        if fm["format"] == "pdf":
            txt = pdf_text(e["file"])
            for t in at["texts"]:
                if norm(t) not in txt:
                    err(f"events[{i}]: pdf の文字に {t!r} が無い")
            if "source_xlsx" in fm:
                hits = xlsx_rows_matching(fm["source_xlsx"], at["texts"])
                if len(hits) != 1:
                    err(f"events[{i}]: 元の xlsx で {at['texts']} に当たる行が {len(hits)} 行")
    elif "cell" in at:
        if not cell_text(e["file"], at):
            err(f"events[{i}]: セルが空")

# ---------------------------------------------------------------- 6. 値（世界と、資料に書いた値）
# 6a. 資産：設置年・仕様・名前
for i, a in enumerate(T["assets"]):
    if a["kind"] == "group":
        continue
    eq = EQ[a["equipment_id"]]
    if a["install_year"] is not None and a["install_year"] != eq["install_year"]:
        err(f"assets[{i}]: install_year が世界と違う")
    fm = file_meta[a["file"]]
    if fm["kind"] == "ledger":
        c, r = split_cell(a["at"]["cell"])
        ws = sheet_of(a["file"], a["at"]["sheet"])
        rowvals = ["" if v is None else str(v) for v in next(ws.iter_rows(min_row=r, max_row=r, values_only=True))]
        if a["kind"] == "equipment":
            if rowvals[6] != short_h(eq["install_year"]):
                err(f"assets[{i}]: 台帳の設置年 {rowvals[6]} が世界と違う")
            if rowvals[0] != "機" or rowvals[1] != eq["furnace_label"]:
                err(f"assets[{i}]: 区分か号炉が違う")
            if a["spec_texts"] != eq["spec"]:
                err(f"assets[{i}]: 仕様が世界と違う")
        else:
            if rowvals[0] != "部":
                err(f"assets[{i}]: 部位の行でない")
            part = [p for p in eq["parts"] if p["name"] == a["name"]]
            if len(part) != 1:
                err(f"assets[{i}]: 部位が世界に無い")
            else:
                exp = list(part[0]["spec"]) + ([part[0]["remark"]] if "remark" in part[0] else [])
                if a["spec_texts"] != exp:
                    err(f"assets[{i}]: 部位の仕様が世界と違う")
        for s in a["spec_texts"]:
            if s not in rowvals:
                err(f"assets[{i}]: spec_texts {s!r} がその行のセルに無い")
    if a["tag"] is not None and not a["tag"].endswith(eq["tag"]):
        err(f"assets[{i}]: tag が世界の記号と合わない")
    if norm(a["name"]) != norm(eq["base_name"]) and a["kind"] == "equipment":
        err(f"assets[{i}]: name が世界の base_name と違う")

# 台帳：すべての機器・部位・まとまり
for fm in T["files"]:
    if fm["kind"] == "ledger":
        al = [a for a in T["assets"] if a["file"] == fm["file"]]
        eqs = Counter(a["equipment_id"] for a in al if a["kind"] == "equipment")
        if set(eqs) != set(EQ) or any(v != 1 for v in eqs.values()):
            err(f"{fm['file']}: 台帳の機器がそろっていない")
        parts = Counter((a["equipment_id"], a["name"]) for a in al if a["kind"] == "part")
        exp = Counter((e["id"], p["name"]) for e in W["equipment"] for p in e["parts"])
        if parts != exp:
            err(f"{fm['file']}: 台帳の部位がそろっていない")
        groups = {tuple(a["path"]) for a in al if a["kind"] == "group"}
        if groups != {tuple(e["path"]) for e in W["equipment"]}:
            err(f"{fm['file']}: 台帳のまとまりがそろっていない")
    if fm["kind"] == "star":
        al = [a for a in T["assets"] if a["file"] == fm["file"] and a["kind"] == "equipment"]
        if Counter(a["equipment_id"] for a in al) != Counter({k: 1 for k in EQ}):
            err(f"{fm['file']}: 星取表の機器の行がそろっていない")
        for a in T["assets"]:
            if a["file"] == fm["file"] and a["kind"] == "group" and a.get("measure") is not False:
                err(f"{fm['file']}: 星取表のまとまりに measure:false が無い")

# 6b. 印：年度の見出し・記号の意味・作業
SYM = {"▲": "actual", "△": "planned"}
mark_work = Counter()
for i, m in enumerate(T["marks"]):
    c, r = split_cell(m["at"]["cell"])
    ws = sheet_of(m["file"], m["at"]["sheet"])
    head = ws.cell(4, c).value
    if head != m["fiscal_year"]:
        err(f"marks[{i}]: 列の年度 {head} != {m['fiscal_year']}")
    if SYM.get(m["symbol"]) != m["status"]:
        err(f"marks[{i}]: 記号と status が合わない")
    for wid in m["work_ids"]:
        w = WK[wid]
        mark_work[wid] += 1
        if w["equipment_id"] != m["equipment_id"] or w["fiscal_year"] != m["fiscal_year"] or w["status"] != m["status"]:
            err(f"marks[{i}]: {wid} と食い違う")
    # 行の機器：同じ行か、上の行で最後に書いた機器名
    rr = r
    while rr > 4 and ws.cell(rr, 3).value is None:
        rr -= 1
    owner = [a for a in T["assets"] if a["file"] == m["file"] and a["kind"] == "equipment"
             and a["at"] == {"cell": f"C{rr}", "sheet": m["at"]["sheet"]}]
    if len(owner) != 1 or owner[0]["equipment_id"] != m["equipment_id"]:
        err(f"marks[{i}]: 行の機器が違う")
for wid in WK:
    if mark_work[wid] != 1:
        err(f"星取表で {wid} の印が {mark_work[wid]} 個")


# 6c. 出来事：世界との食い違い
def wareki_parse(s):
    m = re.fullmatch(r"(平成|令和)(元|\d+)年(\d+)月(\d+)日", s)
    y = 1 if m.group(2) == "元" else int(m.group(2))
    base = 1988 if m.group(1) == "平成" else 2018
    return date(base + y, int(m.group(3)), int(m.group(4)))


split_md = defaultdict(lambda: defaultdict(float))
split_days = defaultdict(lambda: defaultdict(list))
for i, e in enumerate(T["events"]):
    ws_ = [WK[x] for x in e["work_ids"]]
    if not ws_:
        err(f"events[{i}]: work_ids が空")
        continue
    if sorted(e["equipment_ids"]) != sorted({w["equipment_id"] for w in ws_}):
        err(f"events[{i}]: equipment_ids と work_ids の機器が合わない")
    for w in ws_:
        if w["fiscal_year"] != e["fiscal_year"] or w["status"] != e["status"]:
            err(f"events[{i}]: 年度か status が {w['id']} と違う")
    if e["bundle"] != (len(e["equipment_ids"]) > 1):
        err(f"events[{i}]: bundle の値")
    split = len(ws_) == 1 and e["start"] == e["end"] and ws_[0]["duration_days"] > 1
    if split:
        w = ws_[0]
        if not (w["start"] <= e["start"] <= w["end"]):
            err(f"events[{i}]: 日が工期の外")
        if e["man_days"] is not None:
            split_md[e["file"]][w["id"]] += e["man_days"]
            if e["man_days"] * w["duration_days"] != w["man_days"]:
                err(f"events[{i}]: 1 日の工数が世界と合わない")
        split_days[e["file"]][w["id"]].append(e["start"])
        if e["days"] is not None:
            err(f"events[{i}]: 1 日の行に days")
    else:
        for w in ws_:
            if w["start"] != e["start"] or w["end"] != e["end"]:
                err(f"events[{i}]: 工期が {w['id']} と違う")
            if e["days"] is not None and w["duration_days"] != e["days"]:
                err(f"events[{i}]: 日数が {w['id']} と違う")
        if e["man_days"] is not None and e["man_days"] != sum(w["man_days"] for w in ws_):
            err(f"events[{i}]: 工数が世界と違う")
    # 資料に書いた値
    fm = file_meta[e["file"]]
    if fm["format"] == "csv":
        row = row_values(e["file"], e["at"])
        if fm["encoding"] == "utf-8-sig":  # 日報：作業日・人員・延作業時間
            if row[0] != date.fromisoformat(e["start"]).strftime("%Y%m%d"):
                err(f"events[{i}]: 作業日 {row[0]} が違う")
            if float(row[7]) / W["man_day_hours"] != e["man_days"] or int(row[6]) != e["man_days"]:
                err(f"events[{i}]: 延作業時間が違う")
            if row[2][-3:] != EQ[e["equipment_ids"][0]]["tag"]:
                err(f"events[{i}]: 機器番号が違う")
        else:  # 工事実績集計：着工・竣工・工期・延べ人工
            if wareki_parse(row[3]).isoformat() != e["start"] or wareki_parse(row[4]).isoformat() != e["end"]:
                err(f"events[{i}]: 着工日・竣工日が違う {row[3]} {row[4]}")
            if int(row[5]) != e["days"] or int(row[6]) != e["man_days"]:
                err(f"events[{i}]: 工期か延べ人工が違う")
    elif fm["format"] == "pdf":
        hits = xlsx_rows_matching(fm["source_xlsx"], e["at"]["texts"])
        if len(hits) == 1:
            vals = hits[0][2]
            if "延時間(h)" in json.dumps(xlsx_rows_matching(fm["source_xlsx"], ["延時間(h)"]), ensure_ascii=False):
                # 報告書 1：自・至は月/日、年は見出しの令和6年＝2024
                st = date(2024, *map(int, vals[4].split("/")))
                en = date(2024, *map(int, vals[5].split("/")))
                if st.isoformat() != e["start"] or en.isoformat() != e["end"]:
                    err(f"events[{i}]: 自・至が違う")
                if int(vals[6]) != e["days"] or int(vals[8]) / W["man_day_hours"] != e["man_days"]:
                    err(f"events[{i}]: 日数か延時間が違う")
                if [vals[2]] != ["2号" + EQ[x]["base_name"] for x in e["equipment_ids"]]:
                    err(f"events[{i}]: 機器名称が違う {vals[2]}")
            else:
                m = re.fullmatch(r"(\d{4})/(\d+)/(\d+)～(\d+)/(\d+)", vals[3])
                st = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                en = date(int(m.group(1)), int(m.group(4)), int(m.group(5)))
                if st.isoformat() != e["start"] or en.isoformat() != e["end"]:
                    err(f"events[{i}]: 工期が違う")
                if int(vals[4]) != e["days"] or int(vals[5]) != e["man_days"]:
                    err(f"events[{i}]: 日数か人工が違う")
                if vals[2].split("・") != [EQ[x]["base_name"] for x in e["equipment_ids"]]:
                    err(f"events[{i}]: 対象機器が違う {vals[2]}")

for fpath, per in split_days.items():
    for wid, days in per.items():
        w = WK[wid]
        if len(days) != len(set(days)) or len(days) != w["duration_days"]:
            err(f"{fpath}: {wid} の日ごとの行が工期の日数とそろわない")
        if split_md[fpath][wid] != w["man_days"]:
            err(f"{fpath}: {wid} の日ごとの工数の合計が世界と違う")

# 同じ資料で、同じ作業が 2 つの行に重ならない（日ごとの行は除く）
for fm in T["files"]:
    if fm["kind"] not in ("daily", "report"):
        continue
    seen = Counter()
    for e in T["events"]:
        if e["file"] == fm["file"] and not (e["start"] == e["end"] and len(e["work_ids"]) == 1 and WK[e["work_ids"][0]]["duration_days"] > 1):
            for wid in e["work_ids"]:
                seen[wid] += 1
    dup = [k for k, v in seen.items() if v > 1]
    if dup:
        err(f"{fm['file']}: 同じ作業が 2 行に {dup}")
    # 行の場所が重ならない
    locs = Counter(json.dumps(e["at"], ensure_ascii=False, sort_keys=True) for e in T["events"] if e["file"] == fm["file"])
    if any(v > 1 for v in locs.values()):
        err(f"{fm['file']}: 同じ場所の出来事が 2 つ")

# ---------------------------------------------------------------- 【架空】
for fm in T["files"]:
    p = FILES / fm["file"]
    if fm["format"] == "xlsx":
        wb = xlsx(fm["file"])
        if "【架空】" not in (wb.properties.creator or ""):
            err(f"{fm['file']}: 作成者に【架空】が無い")
        if "【架空】" not in str(wb.worksheets[0]["A1"].value):
            err(f"{fm['file']}: 題のセルに【架空】が無い")
    elif fm["format"] == "csv":
        if "【架空】" not in "".join(csv_rows(fm["file"])[1]):
            err(f"{fm['file']}: 1 行目に【架空】が無い")
    elif fm["format"] == "pdf":
        if norm("【架空】") not in pdf_text(fm["file"]):
            err(f"{fm['file']}: 【架空】の文字が無い")
    elif fm["format"] == "jpg":
        from PIL import Image
        Image.open(p).verify()
        src = fm["photo_of"]["file"]
        if src not in file_meta:
            err(f"{fm['file']}: photo_of の資料が files に無い")
for fm in T["files"]:
    if "source_xlsx" in fm:
        wb = openpyxl.load_workbook(FILES / fm["source_xlsx"])
        if "【架空】" not in (wb.properties.creator or "") or "【架空】" not in str(wb.worksheets[0]["A1"].value):
            err(f"{fm['source_xlsx']}: 【架空】が無い")

# ---------------------------------------------------------------- 結果
print(f"files {len(T['files'])} / assets {len(T['assets'])} / marks {len(T['marks'])} / events {len(T['events'])}")
if ERR:
    print(f"NG: {len(ERR)} 件")
    for x in ERR[:200]:
        print(" -", x)
    sys.exit(1)
print("OK")
