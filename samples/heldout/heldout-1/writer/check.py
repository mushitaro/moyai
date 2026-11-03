# -*- coding: utf-8 -*-
"""truth.json と files/ の資料が食い違っていないかを確かめる。

  python -I -X utf8 writer/check.py

CONTRACT.md「確かめ」の 1〜6 と、資料の値を読み直して world.json と比べる確かめ（日付・工数・日数・設置年・年度・予定と実績）、
星取表と機器台帳の網羅を見る。食い違いがあれば一覧を出して 1 で終わる。
"""
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import unicodedata

import openpyxl
import pypdfium2 as pdfium

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = os.path.join(ROOT, "files")
errors = []
notes = []


def err(*a):
    errors.append(" ".join(str(x) for x in a))


world = json.load(open(os.path.join(ROOT, "world.json"), encoding="utf-8"))
truth = json.load(open(os.path.join(ROOT, "truth.json"), encoding="utf-8"))
EQ = {e["id"]: e for e in world["equipment"]}
WK = {w["id"]: w for w in world["works"]}
MDH = world["man_day_hours"]


def norm(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(s)))


# ------------------------------------------------------------------ 1. 形
TOP = {"schema", "set", "world", "files", "assets", "marks", "events"}
K_FILE = {"file", "format", "kind", "encoding", "delimiter", "note", "source_xlsx", "hidden_data", "photo_of"}
K_ASSET = {"file", "at", "kind", "level", "parent", "equipment_id", "path", "name_text", "name", "tag",
           "install_year", "spec_texts", "measure"}
K_MARK = {"file", "at", "fiscal_year", "status", "equipment_id", "work_ids", "symbol"}
K_EVENT = {"file", "at", "status", "fiscal_year", "equipment_ids", "work_ids", "start", "end", "man_days", "days",
           "bundle"}
FORMATS = {"xlsx", "csv", "pdf", "jpg"}
KINDS = {"ledger": "xlsx", "star": "xlsx", "daily": "csv", "report": "pdf", "photo": "jpg"}

if set(truth) != TOP:
    err("truth の頂のキー", sorted(set(truth) ^ TOP))
if truth.get("schema") != "moyai.heldout.truth/0":
    err("schema", truth.get("schema"))
if truth.get("world") != "world.json":
    err("world", truth.get("world"))


def check_at(at, where):
    if not isinstance(at, dict):
        err(where, "at が辞書でない")
        return
    ks = set(at)
    if ks <= {"cell", "sheet"} and "cell" in ks:
        if not re.fullmatch(r"[A-Z]{1,3}[1-9]\d*", at["cell"]):
            err(where, "cell の形", at)
    elif ks <= {"row", "sheet"} and "row" in ks:
        if not (isinstance(at["row"], int) and at["row"] >= 1):
            err(where, "row の形", at)
    elif ks == {"texts"}:
        if not (isinstance(at["texts"], list) and 2 <= len(at["texts"]) <= 4 and all(isinstance(t, str) and t for t in at["texts"])):
            err(where, "texts は 2〜4 個の文字", at)
    else:
        err(where, "at の形", at)


FMAP = {}
for i, f in enumerate(truth["files"]):
    w = f"files[{i}]"
    if set(f) - K_FILE:
        err(w, "知らないキー", set(f) - K_FILE)
    for k in ("file", "format", "kind", "note"):
        if k not in f:
            err(w, "無いキー", k)
    if f.get("format") not in FORMATS or KINDS.get(f.get("kind")) != f.get("format"):
        err(w, "format と kind", f.get("format"), f.get("kind"))
    if not os.path.isfile(os.path.join(FILES, f["file"])):
        err(w, "ファイルが無い", f["file"])
    if f["format"] == "csv":
        if f.get("delimiter") not in (",", "\t") or not f.get("encoding"):
            err(w, "csv の encoding・delimiter")
    elif "encoding" in f or "delimiter" in f:
        err(w, "csv でないのに encoding・delimiter")
    if "source_xlsx" in f:
        if f["format"] != "pdf" or not os.path.isfile(os.path.join(FILES, f["source_xlsx"])):
            err(w, "source_xlsx", f.get("source_xlsx"))
    if "hidden_data" in f and f["hidden_data"] not in ("include", "exclude"):
        err(w, "hidden_data", f["hidden_data"])
    if f["format"] == "jpg":
        po = f.get("photo_of")
        if not (isinstance(po, dict) and set(po) == {"file", "page"} and os.path.isfile(os.path.join(FILES, po["file"]))):
            err(w, "photo_of", po)
    elif "photo_of" in f:
        err(w, "写真でないのに photo_of")
    FMAP[f["file"]] = f
listed_sources = {f.get("source_xlsx") for f in truth["files"]}
if listed_sources & set(FMAP):
    err("source_xlsx を files に載せている")
for kind in KINDS:
    if not any(f["kind"] == kind for f in truth["files"]):
        err("資料が無い種類", kind)
# 置いたファイルはすべて files か source_xlsx に載っている
for dp, _, fns in os.walk(FILES):
    for fn in fns:
        r = os.path.relpath(os.path.join(dp, fn), FILES).replace(os.sep, "/")
        if r not in FMAP and r not in listed_sources:
            err("truth に載っていないファイル", r)

for i, a in enumerate(truth["assets"]):
    w = f"assets[{i}]"
    if set(a) - K_ASSET:
        err(w, "知らないキー", set(a) - K_ASSET)
    check_at(a.get("at"), w)
    if a["kind"] not in ("group", "equipment", "part"):
        err(w, "kind", a["kind"])
    if a["parent"] is not None:
        check_at(a["parent"], w + ".parent")
    if a["kind"] == "group":
        if a["equipment_id"] is not None or "path" not in a:
            err(w, "group の equipment_id・path")
    else:
        if "path" in a:
            err(w, "group でないのに path")
for i, m in enumerate(truth["marks"]):
    if set(m) - K_MARK or set(m) != K_MARK:
        err(f"marks[{i}]", "キー", set(m) ^ K_MARK)
    check_at(m.get("at"), f"marks[{i}]")
    if m["status"] not in ("planned", "actual"):
        err(f"marks[{i}]", "status", m["status"])
for i, e in enumerate(truth["events"]):
    if set(e) != K_EVENT:
        err(f"events[{i}]", "キー", set(e) ^ K_EVENT)
    check_at(e.get("at"), f"events[{i}]")
    if e["status"] not in ("planned", "actual"):
        err(f"events[{i}]", "status", e["status"])

# ------------------------------------------------------------------ 2. ID
all_paths = {tuple(e["path"][:k]) for e in world["equipment"] for k in range(1, len(e["path"]) + 1)}
for i, a in enumerate(truth["assets"]):
    if a["kind"] == "group":
        if tuple(a["path"]) not in all_paths:
            err(f"assets[{i}]", "path が世界に無い", a["path"])
    else:
        if a["equipment_id"] not in EQ:
            err(f"assets[{i}]", "equipment_id", a["equipment_id"])
        elif a["kind"] == "part" and a["name"] not in [p["name"] for p in EQ[a["equipment_id"]]["parts"]]:
            err(f"assets[{i}]", "部位が世界に無い", a["name"])
for i, m in enumerate(truth["marks"]):
    for wid in m["work_ids"]:
        w = WK.get(wid)
        if not w:
            err(f"marks[{i}]", "work_id", wid)
            continue
        if w["equipment_id"] != m["equipment_id"] or w["fiscal_year"] != m["fiscal_year"] or w["status"] != m["status"]:
            err(f"marks[{i}]", "作業と機器・年度・予定実績が合わない", wid)
for i, e in enumerate(truth["events"]):
    ws_ = [WK.get(x) for x in e["work_ids"]]
    if None in ws_:
        err(f"events[{i}]", "work_id", e["work_ids"])
        continue
    if sorted({w["equipment_id"] for w in ws_}) != sorted(e["equipment_ids"]):
        err(f"events[{i}]", "equipment_ids と作業の機器", e["equipment_ids"])
    if any(w["fiscal_year"] != e["fiscal_year"] or w["status"] != e["status"] for w in ws_):
        err(f"events[{i}]", "年度・予定実績", e["work_ids"])
    if e["bundle"] != (len(e["equipment_ids"]) > 1):
        err(f"events[{i}]", "bundle と機器の数")


# ------------------------------------------------------------------ 読み手（xlsx・csv・pdf）
class XL:
    def __init__(self, path):
        self.wb = openpyxl.load_workbook(path)  # 値（式は使っていない）

    def sheet(self, name):
        return self.wb[name] if name else self.wb.worksheets[0]

    def value(self, sheet, cell):
        ws = self.sheet(sheet)
        for rng in ws.merged_cells.ranges:
            if cell in rng and rng.coord.split(":")[0] != cell:
                return ("__MERGED_INNER__", rng.coord)
        return ws[cell].value

    def row_values(self, sheet, row):
        ws = self.sheet(sheet)
        return [c.value for c in ws[row]]


class CSVF:
    def __init__(self, path, encoding, delimiter):
        raw = open(path, "rb").read()
        text = raw.decode(encoding)
        self.records = {}  # 物理の行 -> 記録
        rd = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
        start = 1
        for rec in rd:
            self.records[start] = rec
            start = rd.line_num + 1
        self.nlines = rd.line_num

    def value(self, cell):
        m = re.fullmatch(r"([A-Z]+)(\d+)", cell)
        col = openpyxl.utils.column_index_from_string(m.group(1)) - 1
        rec = self.records.get(int(m.group(2)))
        if rec is None:
            return ("__NOT_RECORD_START__",)
        return rec[col] if col < len(rec) else None


_cache = {}


def doc(fileinfo):
    f = fileinfo["file"]
    if f not in _cache:
        p = os.path.join(FILES, f)
        if fileinfo["format"] == "xlsx":
            _cache[f] = XL(p)
        elif fileinfo["format"] == "csv":
            _cache[f] = CSVF(p, fileinfo["encoding"], fileinfo["delimiter"])
        elif fileinfo["format"] == "pdf":
            pdf = pdfium.PdfDocument(p)
            _cache[f] = [norm(pg.get_textpage().get_text_range()) for pg in pdf]
    return _cache[f]


def cell_value(fileinfo, at):
    d = doc(fileinfo)
    if fileinfo["format"] == "xlsx":
        return d.value(at.get("sheet"), at["cell"])
    if at.get("sheet") is not None:
        err(fileinfo["file"], "csv に sheet", at)
    return d.value(at["cell"])


def row_values(fileinfo, at):
    d = doc(fileinfo)
    if fileinfo["format"] == "xlsx":
        return d.row_values(at.get("sheet"), at["row"])
    rec = d.records.get(at["row"])
    return rec


# ------------------------------------------------------------------ 3・4. セルと行
for i, a in enumerate(truth["assets"]):
    fi = FMAP.get(a["file"])
    if not fi or fi["kind"] not in ("ledger", "star"):
        err(f"assets[{i}]", "台帳か星取表の資料でない", a["file"])
        continue
    if "cell" in a["at"]:
        v = cell_value(fi, a["at"])
        if v != a["name_text"]:
            err(f"assets[{i}]", "セルの文字が name_text と違う", a["at"], repr(v), repr(a["name_text"]))
    if a["parent"] is not None and "cell" in a["parent"]:
        v = cell_value(fi, a["parent"])
        if v in (None, "") or isinstance(v, tuple):
            err(f"assets[{i}]", "parent のセルが空か結合の内側", a["parent"])
for i, m in enumerate(truth["marks"]):
    fi = FMAP.get(m["file"])
    if not fi or fi["kind"] != "star":
        err(f"marks[{i}]", "星取表の資料でない")
        continue
    v = cell_value(fi, m["at"])
    if v != m["symbol"]:
        err(f"marks[{i}]", "セルの文字が symbol と違う", m["at"], repr(v), repr(m["symbol"]))
for i, e in enumerate(truth["events"]):
    fi = FMAP.get(e["file"])
    if not fi or fi["kind"] not in ("daily", "report"):
        err(f"events[{i}]", "作業の記録か報告書でない")
        continue
    if "row" in e["at"]:
        vals = row_values(fi, e["at"])
        if not vals or not any(str(x).strip() for x in vals if x is not None):
            err(f"events[{i}]", "行に中身が無い", e["at"])

# ------------------------------------------------------------------ 5. texts（pdf と元の xlsx）
for i, e in enumerate(truth["events"]):
    if "texts" not in e["at"]:
        continue
    fi = FMAP[e["file"]]
    pages = doc(fi) if fi["format"] == "pdf" else None
    texts = [norm(t) for t in e["at"]["texts"]]
    if pages is not None:
        for t in texts:
            if not any(t in pg for pg in pages):
                err(f"events[{i}]", "pdf の文字に無い", t)
    if fi.get("source_xlsx"):
        wb = openpyxl.load_workbook(os.path.join(FILES, fi["source_xlsx"]))
        cells = [[norm(c.value) if c.value is not None else "" for c in row] for ws in wb.worksheets for row in ws.iter_rows()]
        allc = {c for row in cells for c in row}

        def hit(row, t):
            return t in row if t in allc else any(t in c for c in row)

        n = sum(1 for row in cells if all(hit(row, t) for t in texts))
        if n != 1:
            err(f"events[{i}]", "元の xlsx で当たる行の数", n, texts)

# ------------------------------------------------------------------ 6. 値（truth と world）
for i, a in enumerate(truth["assets"]):
    if "install_year" in a and a.get("equipment_id") and a["install_year"] != EQ[a["equipment_id"]]["install_year"]:
        err(f"assets[{i}]", "設置年", a["install_year"])
per_day = {}
for i, e in enumerate(truth["events"]):
    ws_ = [WK[x] for x in e["work_ids"] if x in WK]
    if not ws_:
        continue
    whole = all(w["start"] == e["start"] and w["end"] == e["end"] for w in ws_)
    if whole:
        if e["man_days"] is not None and e["man_days"] != sum(w["man_days"] for w in ws_):
            err(f"events[{i}]", "工数", e["man_days"])
        if e["days"] is not None and any(w["duration_days"] != e["days"] for w in ws_):
            err(f"events[{i}]", "日数", e["days"])
    else:
        if e["start"] != e["end"] or not all(w["start"] <= e["start"] <= w["end"] for w in ws_):
            err(f"events[{i}]", "日の記録が作業の工期の外", e["start"], e["end"])
        if e["man_days"] is not None and e["man_days"] != sum(w["crew"] for w in ws_):
            err(f"events[{i}]", "日の工数が人員と違う", e["man_days"])
        if e["days"] is not None:
            err(f"events[{i}]", "日の記録に日数")
        for w in ws_:
            per_day.setdefault((e["file"], w["id"]), []).append(e)
for (f, wid), evs in per_day.items():
    w = WK[wid]
    n_days = (dt.date.fromisoformat(w["end"]) - dt.date.fromisoformat(w["start"])).days + 1
    if len({x["start"] for x in evs}) != n_days or len(evs) != n_days:
        err(f, wid, "日の記録が工期のすべての日を覆っていない", len(evs), n_days)
    if sum(x["man_days"] for x in evs) != w["man_days"]:
        err(f, wid, "日の工数の合計", sum(x["man_days"] for x in evs), w["man_days"])


# ------------------------------------------------------------------ 6'. 資料の値を読み直して比べる
def parse_ymd_slash(s):
    y, m, d = map(int, s.split("/"))
    return dt.date(y, m, d).isoformat()


def parse_r(s):
    m = re.fullmatch(r"([RH])(\d+)\.(\d+)\.(\d+)", s)
    y = int(m.group(2)) + (2018 if m.group(1) == "R" else 1988)
    return dt.date(y, int(m.group(3)), int(m.group(4))).isoformat()


def wareki_to_year(s):
    m = re.fullmatch(r"(平成|令和)(\d+|元)年", s)
    n = 1 if m.group(2) == "元" else int(m.group(2))
    return n + (1988 if m.group(1) == "平成" else 2018)


for fi in truth["files"]:
    evs = [e for e in truth["events"] if e["file"] == fi["file"]]
    if fi["kind"] == "daily":
        d = doc(fi)
        starts = sorted(d.records)
        head = None
        for r in starts:
            if "日付" in d.records[r] or "着手日" in d.records[r]:
                head, head_row = d.records[r], r
                break
        hcol = next(i for i, x in enumerate(head) if "工数" in x or "時間" in x)
        starts = [r for r in starts if r > head_row]
        if "着手日" in head:  # 作業ごと
            cs, ce, cd = head.index("着手日"), head.index("完了日"), head.index("日数")
            prev = (None, None)
            for r in starts:
                rec = d.records[r]
                if len(rec) <= ce or not re.fullmatch(r"\d{4}/\d+/\d+|〃", rec[cs] or "-"):
                    continue
                s = prev[0] if rec[cs] == "〃" else parse_ymd_slash(rec[cs])
                en = prev[1] if rec[ce] == "〃" else parse_ymd_slash(rec[ce])
                prev = (s, en)
                ev = [e for e in evs if e["at"].get("row") == r]
                if len(ev) != 1:
                    err(fi["file"], r, "作業の行に正解が 1 つでない", len(ev))
                    continue
                ev = ev[0]
                hours = float(rec[hcol].replace(",", ""))
                if (s, en) != (ev["start"], ev["end"]) or hours != ev["man_days"] * MDH or int(rec[cd]) != ev["days"]:
                    err(fi["file"], r, "資料の値と正解が違う", s, en, hours, rec[cd])
        else:  # 日ごと（日付は「月/日(曜)」、空欄は上と同じ日。年は年度から）
            fy = 2026 if "令和8年度" in "".join(sum(d.records.values(), [])) else None
            cur = None
            for r in starts:
                rec = d.records[r]
                if rec and re.fullmatch(r"\d+/\d+\(.\)", rec[0]):
                    mo, da = map(int, re.match(r"(\d+)/(\d+)", rec[0]).groups())
                    cur = dt.date(fy if mo >= 4 else fy + 1, mo, da)
                    wd = "月火水木金土日"[cur.weekday()]
                    if rec[0][-2] != wd:
                        err(fi["file"], r, "曜日", rec[0])
                ev = [e for e in evs if e["at"].get("row") == r]
                is_work = len(rec) > 3 and rec[3] not in ("", "日計")
                if is_work != bool(ev):
                    err(fi["file"], r, "作業の行と正解の有無が合わない")
                    continue
                if ev:
                    ev = ev[0]
                    if ev["start"] != cur.isoformat() or float(rec[hcol]) != ev["man_days"] * MDH:
                        err(fi["file"], r, "資料の値と正解が違う", cur, rec[hcol])
        # 正解の行が資料の作業の行を外していないか（行の番号が記録の始まりか）
        for e in evs:
            if e["at"]["row"] not in d.records:
                err(fi["file"], "正解の行が記録の始まりでない", e["at"]["row"])
    if fi["kind"] == "report":
        wb = openpyxl.load_workbook(os.path.join(FILES, fi["source_xlsx"]))
        ws = wb.worksheets[0]
        for e in evs:
            texts = [norm(t) for t in e["at"]["texts"]]
            rows = [row for row in ws.iter_rows(values_only=True)
                    if all(any(c is not None and t in norm(c) for c in row) for t in texts)]
            if len(rows) != 1:
                continue
            row = rows[0]
            s, en, days, md = parse_r(row[5]), parse_r(row[6]), row[7], row[8]
            if (s, en, days, md) != (e["start"], e["end"], e["days"], e["man_days"]):
                err(fi["file"], texts, "資料の値と正解が違う", s, en, days, md)
        n_rows = sum(1 for row in ws.iter_rows(values_only=True) if isinstance(row[0], int))
        if n_rows != len(evs):
            err(fi["file"], "作業の行の数と events の数", n_rows, len(evs))
    if fi["kind"] == "ledger":
        x = doc(fi)
        for a in [a for a in truth["assets"] if a["file"] == fi["file"] and a["kind"] == "equipment"]:
            ws = x.sheet(a["at"]["sheet"])
            r = int(re.sub(r"[A-Z]+", "", a["at"]["cell"]))
            hdr = {str(c.value).strip(): c.column for row in ws.iter_rows(min_row=1, max_row=6) for c in row if c.value}
            col = hdr.get("設置年") or hdr.get("設置")
            v = ws.cell(r, col).value
            rr = r
            while v == "〃":
                rr -= 1
                v = ws.cell(rr, col).value
            y = wareki_to_year(v) if re.match(r"(平成|令和)", str(v)) else int(str(v).rstrip("年"))
            if y != a["install_year"] or y != EQ[a["equipment_id"]]["install_year"]:
                err(fi["file"], a["at"], "設置年", v)
            # 番号の列にある文字が tag
            tcol = hdr.get("機器番号") or hdr.get("記号")
            if ws.cell(r, tcol).value != a["tag"]:
                err(fi["file"], a["at"], "tag", ws.cell(r, tcol).value)
        # すべての機器と部位
        got_eq = {a["equipment_id"] for a in truth["assets"] if a["file"] == fi["file"] and a["kind"] == "equipment"}
        if got_eq != set(EQ):
            err(fi["file"], "台帳に無い機器", set(EQ) - got_eq)
        got_pt = sorted((a["equipment_id"], a["name"]) for a in truth["assets"] if a["file"] == fi["file"] and a["kind"] == "part")
        want_pt = sorted((e["id"], p["name"]) for e in world["equipment"] for p in e["parts"])
        if got_pt != want_pt:
            err(fi["file"], "台帳の部位", got_pt, want_pt)
    if fi["kind"] == "star":
        x = doc(fi)
        marks = [m for m in truth["marks"] if m["file"] == fi["file"]]
        legend = {"○": "planned", "●": "actual", "◇": "planned", "◆": "actual"}
        for m in marks:
            ws = x.sheet(m["at"]["sheet"])
            c = ws[m["at"]["cell"]]
            fy = ws.cell(6, c.column).value
            label = ws.cell(c.row, 4).value
            st = {"予定": "planned", "実績": "actual"}[label]
            if fy != m["fiscal_year"] or st != m["status"]:
                err(fi["file"], m["at"], "列の年度・行の予定実績と正解", fy, label)
            if m["symbol"] in legend and legend[m["symbol"]] != m["status"]:
                err(fi["file"], m["at"], "凡例と status")
            if m["symbol"] not in legend:
                notes.append(f"{fi['file']} {m['at']['cell']}: 凡例に無い記号「{m['symbol']}」→ {m['status']}")
            # 行の機器
            top = c.row if label == "予定" else c.row - 1
            a = [a for a in truth["assets"] if a["file"] == fi["file"] and a["kind"] == "equipment"
                 and a["at"]["cell"] == f"B{top}"]
            if len(a) != 1 or a[0]["equipment_id"] != m["equipment_id"]:
                err(fi["file"], m["at"], "行の機器と正解")
        # 印のあるセルがすべて正解にある
        ws = x.sheet(marks[0]["at"]["sheet"])
        marked = {m["at"]["cell"] for m in marks}
        last_eq_row = max(int(a["at"]["cell"][1:]) for a in truth["assets"] if a["file"] == fi["file"] and a["kind"] == "equipment") + 1
        for row in ws.iter_rows(min_row=7, max_row=last_eq_row, min_col=5, max_col=14):
            for c in row:
                if c.value not in (None, "") and c.coordinate not in marked:
                    err(fi["file"], c.coordinate, "正解に無い印", c.value)
        # 世界のすべての作業が、ちょうど 1 つの印に入っている
        cnt = {}
        for m in marks:
            for wid in m["work_ids"]:
                cnt[wid] = cnt.get(wid, 0) + 1
        miss = [w["id"] for w in world["works"] if cnt.get(w["id"]) != 1]
        if miss:
            err(fi["file"], "印に 1 回だけ入っていない作業", miss)
        got_eq = {a["equipment_id"] for a in truth["assets"] if a["file"] == fi["file"] and a["kind"] == "equipment"}
        if got_eq != set(EQ):
            err(fi["file"], "星取表に無い機器", set(EQ) - got_eq)
        for a in truth["assets"]:
            if a["file"] == fi["file"] and a["kind"] == "group" and a.get("measure") is not False:
                err(fi["file"], a["at"], "星取表のまとまりに measure: false が無い")

# ------------------------------------------------------------------ 【架空】
for fi in truth["files"]:
    p = os.path.join(FILES, fi["file"])
    if fi["format"] == "xlsx" or fi.get("source_xlsx"):
        for xp in [p] if fi["format"] == "xlsx" else [os.path.join(FILES, fi["source_xlsx"])]:
            wb = openpyxl.load_workbook(xp)
            if "【架空】" not in (wb.properties.creator or ""):
                err(xp, "作成者に【架空】が無い")
            for ws in wb.worksheets:
                if "【架空】" not in str(ws["A1"].value):
                    err(xp, ws.title, "題のセルに【架空】が無い")
    if fi["format"] == "csv":
        first = doc(fi).records[1]
        if "【架空】" not in "".join(first):
            err(fi["file"], "1 行目の題に【架空】が無い")
    if fi["format"] == "pdf":
        if "【架空】" not in doc(fi)[0]:
            err(fi["file"], "pdf の題に【架空】が無い")
    if fi["format"] == "jpg":
        po = fi["photo_of"]
        if "【架空】" not in doc(FMAP[po["file"]])[po["page"] - 1]:
            err(fi["file"], "撮った紙の題に【架空】が無い")

# ------------------------------------------------------------------ 結果
print(f"files {len(truth['files'])} / assets {len(truth['assets'])} / marks {len(truth['marks'])} / events {len(truth['events'])}")
for n in notes:
    print("注:", n)
if errors:
    print(f"NG {len(errors)} 件")
    for e in errors[:200]:
        print(" -", e)
    sys.exit(1)
print("OK")
