#!/usr/bin/env python3
"""[FICTIONAL] Check that the answers of set en-1 match the file contents.

Reads the files themselves (not the generator tables) and compares with answer/*.json.
Run: python3 -I gen/check.py [set folder]
"""
import csv, datetime as dt, glob, json, os, re, sys

import openpyxl

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), ".."))
errors = []
ALLOWED_KINDS = ("item", "parent", "subtotal", "total")


def err(msg):
    errors.append(msg)


def fy_of(s):
    d = dt.date.fromisoformat(s)
    return d.year if d.month >= 4 else d.year - 1


def uk(s):
    return dt.datetime.strptime(s, "%d/%m/%Y").date().isoformat()


def read_csv_physical(path):
    """Return {physical start row: [fields]} for every record, counting physical lines."""
    with open(path, encoding="utf-8", newline="") as fh:
        text = fh.read()
    out = {}
    lines = [ln[:-1] if ln.endswith("\r") else ln for ln in text.split("\n")]
    if lines and lines[-1] == "":
        lines.pop()
    i = 0
    while i < len(lines):
        start = i + 1
        buf = lines[i]
        while buf.count('"') % 2 == 1:
            i += 1
            buf += "\n" + lines[i]
        rec = next(csv.reader([buf])) if buf else []
        out[start] = rec
        i += 1
    return out


def check_set():
    facs = [d for d in glob.glob(os.path.join(ROOT, "f-*")) if os.path.isdir(d)]
    if not facs:
        err("no facility folder")
    for fdir in facs:
        for need in ("user.md", "answer/world.json"):
            if not os.path.exists(os.path.join(fdir, need)):
                err(f"missing {need}")
        files = sorted(os.listdir(os.path.join(fdir, "files")))
        for fn in files:
            if not fn.startswith("【架空】"):
                err(f"file name not 【架空】: {fn}")
            stem = os.path.splitext(fn)[0]
            ap = os.path.join(fdir, "answer", "files", stem + ".json")
            if not os.path.exists(ap):
                err(f"no answer for {fn}")
                continue
            ans = json.load(open(ap, encoding="utf-8"))
            if ans.get("schema") != "moyai.answer.file/0" or ans.get("file") != fn:
                err(f"bad answer header {ap}")
            if fn.endswith(".xlsx"):
                check_xlsx(os.path.join(fdir, "files", fn), ans)
            elif fn.endswith(".csv"):
                check_csv(os.path.join(fdir, "files", fn), ans)
        check_world(fdir, files)


def xlsx_layout(ws):
    """Find year columns from header rows: (year, sub) -> col."""
    cols = {}
    band = {}
    for rng in ws.merged_cells.ranges:
        v = ws.cell(rng.min_row, rng.min_col).value
        for c in range(rng.min_col, rng.max_col + 1):
            band[(rng.min_row, c)] = v
    hdr_row = None
    for r in range(1, 10):
        if ws.cell(r, 1).value == "Ref":
            hdr_row = r
    for c in range(1, ws.max_column + 1):
        v = ws.cell(hdr_row, c).value
        if isinstance(v, str) and re.fullmatch(r"\d{4}/\d{2}", v):
            cols[(int(v[:4]), None)] = c
        elif v in ("Plan", "Actual"):
            b = band.get((hdr_row - 1, c))
            y = int(re.match(r"(\d{4})/", b).group(1))
            cols[(y, v.lower())] = c
    named = {ws.cell(hdr_row, c).value: c for c in range(1, ws.max_column + 1)}
    return hdr_row, cols, named


def row_marks(ws, r, cols):
    out = {}
    for (y, sub), c in sorted(cols.items(), key=lambda kv: kv[1]):
        v = ws.cell(r, c).value
        if v not in (None, ""):
            out.setdefault(str(y), []).append(v)
    return {k: (v if len(v) > 1 else v[0]) for k, v in out.items()}


def check_xlsx(path, ans):
    wb = openpyxl.load_workbook(path)
    ws = wb["10yr Plan"]
    if "[FICTIONAL]" not in str(ws["A1"].value):
        err("xlsx title lacks [FICTIONAL]")
    hdr_row, cols, named = xlsx_layout(ws)
    covered = set()
    for rec in ans["records"]:
        sh = wb[rec["sheet"]]
        r = rec["r"]
        f = rec["fields"]
        covered.add((rec["sheet"], r))
        vals = [sh.cell(r, c).value for c in range(1, sh.max_column + 1)]
        if all(v in (None, "") for v in vals):
            err(f"xlsx {rec['sheet']}!{r} is empty but has a record")
            continue
        if rec["kind"] not in ALLOWED_KINDS:
            err(f"xlsx r{r} bad kind {rec['kind']}")
        k = f.get("row_type")
        if k in ("title", "note") and "text" in f and rec["sheet"] == "10yr Plan":
            if sh.cell(r, 1).value != f["text"]:
                err(f"xlsx r{r} text mismatch")
        if k == "legend" and sh.cell(r, 2).value != f["text"]:
            err(f"xlsx r{r} legend mismatch")
        if k == "group":
            if sh.cell(r, 2).value != f["path"][-1] or str(sh.cell(r, 1).value) != f["code"]:
                err(f"xlsx r{r} group mismatch")
        if k in ("item", "task", "plant-wide"):
            name_cell = sh.cell(r, named["System / Equipment"]).value
            if k == "task":
                if name_cell not in (None, ""):
                    err(f"xlsx r{r} task row should have blank name")
                # parent = nearest item row above
                rr = r - 1
                while sh.cell(rr, named["System / Equipment"]).value in (None, "") :
                    rr -= 1
                if sh.cell(rr, named["System / Equipment"]).value != f["path"][-1]:
                    err(f"xlsx r{r} task parent mismatch")
            elif name_cell != f["path"][-1]:
                err(f"xlsx r{r} name mismatch {name_cell!r} vs {f['path'][-1]!r}")
            # group = nearest group row above
            rr = r - 1
            while not (isinstance(sh.cell(rr, 1).value, str) and re.fullmatch(r"\d+", sh.cell(rr, 1).value)):
                rr -= 1
            if sh.cell(rr, 2).value != f["path"][0]:
                err(f"xlsx r{r} group path mismatch")
            if k == "item":
                if sh.cell(r, named["Tag No."]).value != f["code"]:
                    err(f"xlsx r{r} code mismatch")
                if sh.cell(r, named["Year installed"]).value != f["install_year"]:
                    err(f"xlsx r{r} install_year mismatch")
            if sh.cell(r, named["Maintenance task"]).value != f["task"]:
                err(f"xlsx r{r} task mismatch")
            if row_marks(sh, r, cols) != f["marks"]:
                err(f"xlsx r{r} marks {row_marks(sh, r, cols)} vs {f['marks']}")
            rem = sh.cell(r, named["Remarks"]).value
            if (rem or None) != (f.get("specs") or [None])[0]:
                err(f"xlsx r{r} specs mismatch")
    for r in range(hdr_row + 1, ws.max_row + 1):
        if ws.cell(r, 1).value not in (None, "") and ("10yr Plan", r) not in covered:
            err(f"xlsx row {r} (has Ref) but no record")
    for rec in ans["records"]:
        want = "parent" if rec["fields"].get("row_type") == "group" else "item"
        if rec["kind"] != want:
            err(f"xlsx r{rec['r']} kind {rec['kind']} expected {want}")


def check_csv(path, ans):
    recs = read_csv_physical(path)
    if "[FICTIONAL]" not in recs[1][0]:
        err("csv first line lacks [FICTIONAL]")
    hdr = recs[4]
    covered = set()
    for rec in ans["records"]:
        r = rec["r"]
        covered.add(r)
        if r not in recs or not recs[r]:
            err(f"csv r{r} is not a record start")
            continue
        row = recs[r]
        f = rec["fields"]
        if rec["kind"] not in ALLOWED_KINDS:
            err(f"csv r{r} bad kind {rec['kind']}")
        if f.get("row_type") in ("title", "note", "footer") and row[0] != f["text"]:
            err(f"csv r{r} text mismatch")
        if f.get("row_type") == "header" and row != f["columns"]:
            err("csv header mismatch")
        if f.get("row_type") == "work":
            if rec["kind"] != "item":
                err(f"csv r{r} work row must be item")
            d = dict(zip(hdr, row))
            s, e = uk(d["Date Start"]), uk(d["Date Finish"])
            if ("date" in f and (f["date"] != s or s != e)) or ("start" in f and (f["start"], f["end"]) != (s, e)):
                err(f"csv r{r} date mismatch")
            for k, col in (("wo", "WO No."), ("equipment", "Asset"), ("description", "Work Description"),
                           ("contractor", "Contractor"), ("line", "Line")):
                if f[k] != d[col]:
                    err(f"csv r{r} {k} mismatch")
            text = d["Man-hours"] or d["Comments"]
            if f["manDaysText"] != text:
                err(f"csv r{r} manDaysText mismatch {text!r}")
            if re.fullmatch(r"\d+(\.\d+)?", text):
                calc = float(text) / 8
            else:
                m = re.match(r"(\d+) men x (\d+) days", text)
                calc = int(m.group(1)) * int(m.group(2)) if m else float(re.search(r"(\d+(\.\d+)?) man-days", text).group(1))
            if abs(calc - f["manDays"]) > 1e-9:
                err(f"csv r{r} manDays {calc} vs {f['manDays']}")
    for r, row in recs.items():
        if row and re.fullmatch(r"WO-\d{2}-\d{4}", row[0]) and r not in covered:
            err(f"csv r{r} work row but no record")


def check_world(fdir, files):
    w = json.load(open(os.path.join(fdir, "answer", "world.json"), encoding="utf-8"))
    if w["today"] != "2026-10-01" or w["fiscal_year_start_month"] != 4:
        err("world today/fy")
    if not w["facility"]["name"].startswith("【架空】"):
        err("facility name")
    xl = [f for f in files if f.endswith(".xlsx")][0]
    cv = [f for f in files if f.endswith(".csv")][0]
    wb = openpyxl.load_workbook(os.path.join(fdir, "files", xl))
    ws = wb["10yr Plan"]
    hdr_row, cols, named = xlsx_layout(ws)
    recs = read_csv_physical(os.path.join(fdir, "files", cv))
    hdr = recs[4]
    eq_ids = {e["id"] for e in w["equipment"]}
    for e in w["equipment"]:
        if not all(isinstance(v, str) for v in e["names"].values()):
            err(f"{e['id']} names must be one string per file")
        for fn, vs in e.get("name_variants", {}).items():
            if not isinstance(vs, list) or e["names"].get(fn) in vs:
                err(f"{e['id']} bad name_variants")
    for e in w["equipment"]:
        for rr in e["rows"]:
            if ws.cell(rr["r"], named["System / Equipment"]).value != e["names"][xl]:
                err(f"{e['id']} row name mismatch")
            if ws.cell(rr["r"], named["Tag No."]).value != e["code"]:
                err(f"{e['id']} code mismatch")
        lineval = ws.cell(e["rows"][0]["r"], named["Line"]).value
        if (lineval if isinstance(lineval, int) else None) != e["furnace"]:
            err(f"{e['id']} furnace mismatch")
    # every chart mark and every csv work row is covered exactly once
    marks_seen = {}
    csv_seen = {}
    for wk in w["works"]:
        if not set(wk["equipment"]) <= eq_ids:
            err(f"{wk['id']} unknown equipment")
        csv_rows = []
        for rr in wk["rows"]:
            if rr["file"] == xl:
                m = row_marks(ws, rr["r"], cols).get(str(rr["year"]))
                if m is None:
                    err(f"{wk['id']} no mark at r{rr['r']} {rr['year']}")
                    continue
                if isinstance(m, list):
                    if rr.get("symbol") not in m:
                        err(f"{wk['id']} symbol missing/mismatch")
                    marks_seen[(rr["r"], rr["year"], rr["symbol"])] = marks_seen.get((rr["r"], rr["year"], rr["symbol"]), 0) + 1
                else:
                    marks_seen[(rr["r"], rr["year"], m)] = marks_seen.get((rr["r"], rr["year"], m), 0) + 1
                    if wk["status"] == "planned" and m != "P":
                        err(f"{wk['id']} planned but mark {m}")
                # equipment of the row
                rrow = rr["r"]
                while ws.cell(rrow, named["System / Equipment"]).value in (None, ""):
                    rrow -= 1
                nm = ws.cell(rrow, named["System / Equipment"]).value
                ids = [e["id"] for e in w["equipment"] if e["names"][xl] == nm]
                if ids and ids != wk["equipment"]:
                    err(f"{wk['id']} equipment vs chart row")
                if not ids and len(wk["equipment"]) != len(eq_ids):
                    err(f"{wk['id']} plant-wide work must cover all equipment")
            elif rr["file"] == cv:
                d = dict(zip(hdr, recs[rr["r"]]))
                csv_rows.append(d)
                csv_seen[rr["r"]] = csv_seen.get(rr["r"], 0) + 1
                nm = d["Asset"]
                for eid in wk["equipment"]:
                    eq = [e for e in w["equipment"] if e["id"] == eid][0]
                    ens = [eq["names"].get(cv)] + eq.get("name_variants", {}).get(cv, [])
                    if len(wk["equipment"]) == 1 and nm not in ens:
                        err(f"{wk['id']} csv asset {nm!r} not in names")
            else:
                err(f"{wk['id']} unknown file")
        if csv_rows:
            s = min(uk(d["Date Start"]) for d in csv_rows)
            e = max(uk(d["Date Finish"]) for d in csv_rows)
            if (wk["start"], wk["end"]) != (s, e):
                err(f"{wk['id']} start/end mismatch")
            if wk["days"] != (dt.date.fromisoformat(e) - dt.date.fromisoformat(s)).days + 1:
                err(f"{wk['id']} days mismatch")
            if wk["fiscal_year"] != fy_of(s):
                err(f"{wk['id']} fiscal year mismatch")
            if wk["status"] != "actual":
                err(f"{wk['id']} logged but not actual")
            if wk["vendor"] != csv_rows[0]["Contractor"]:
                err(f"{wk['id']} vendor mismatch")
            if wk["start"] > w["today"]:
                err(f"{wk['id']} actual in the future")
        elif wk["status"] == "actual":
            xs = [rr for rr in wk["rows"] if rr["file"] == xl]
            if not all(rr["year"] == wk["fiscal_year"] for rr in xs):
                err(f"{wk['id']} chart-only fy mismatch")
    for r in range(hdr_row + 1, ws.max_row + 1):
        for k, v in row_marks(ws, r, cols).items():
            for s in (v if isinstance(v, list) else [v]):
                if marks_seen.get((r, int(k), s)) != 1:
                    err(f"chart mark r{r} {k} {s} covered {marks_seen.get((r, int(k), s))} times")
    ans_csv = json.load(open(os.path.join(fdir, "answer", "files", os.path.splitext(cv)[0] + ".json"), encoding="utf-8"))
    for rec in ans_csv["records"]:
        if rec["fields"].get("row_type") == "work" and csv_seen.get(rec["r"]) != 1:
            err(f"csv work row {rec['r']} covered {csv_seen.get(rec['r'])} times")
    # man-days of works = sum of csv record manDays
    md = {rec["r"]: rec["fields"]["manDays"] for rec in ans_csv["records"] if rec["fields"].get("row_type") == "work"}
    for wk in w["works"]:
        rs = [rr["r"] for rr in wk["rows"] if rr["file"] == cv]
        if rs and abs(sum(md[r] for r in rs) - wk["man_days"]) > 1e-9:
            err(f"{wk['id']} man_days mismatch")


check_set()
if errors:
    print("FAIL")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print("OK")
