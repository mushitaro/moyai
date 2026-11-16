#!/usr/bin/env python3
"""[FICTIONAL] Generator for test set en-1 (one fictional waste incineration plant).

Run:  python3 -I gen/generate.py   (from the set folder, or pass the set folder as argv[1])
All names are invented. Fixed seed and fixed "today".
"""
import csv, datetime as dt, io, json, os, random, sys

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

SEED = 20261001
TODAY = "2026-10-01"
random.seed(SEED)

ANSWERS_ONLY = "--answers-only" in sys.argv  # rewrite answer/ only, leave files/ untouched
_args = [a for a in sys.argv[1:] if not a.startswith("--")]
ROOT = os.path.abspath(_args[0] if _args else os.path.join(os.path.dirname(__file__), ".."))

# answer kinds allowed by the measuring tool; layout-only rows (title, header, legend, notes, footer) get no record
KINDMAP = {"group": "parent", "item": "item", "task": "item", "plant-wide": "item", "work": "item"}


def to_answer(recs):
    out = []
    for rec in recs:
        k = KINDMAP.get(rec["kind"])
        if k is None:
            continue
        f = dict(rec["fields"])
        f["row_type"] = rec["kind"]
        out.append(dict({kk: vv for kk, vv in rec.items() if kk not in ("kind", "fields")}, kind=k, fields=f))
    return out
FID = "f-hollinmere"
FAC_NAME_FILE = "Hollinmere Energy Recovery Facility"
FAC_NAME = "【架空】" + FAC_NAME_FILE
XLSX = "【架空】Hollinmere ERF - 10yr Maintenance Plan.xlsx"
CSVF = "【架空】Hollinmere ERF - Work Order History.csv"
SHEET = "10yr Plan"
SHEET2 = "Revision log"

YEARS = list(range(2019, 2031))  # FY start years
CUR = 2026


def fy_label(y):
    return f"{y}/{str(y + 1)[2:]}"


def fy_of(datestr):
    d = dt.date.fromisoformat(datestr)
    return d.year if d.month >= 4 else d.year - 1


# ---------------------------------------------------------------- chart rows
# kind: group | item | task (continuation row of the equipment above)
# marks: {year: "X"/"P"} ; for CUR year: {"plan": "P", "actual": "X"}
CHART = [
    ("group", "1", "WASTE RECEPTION & FEEDING"),
    ("item", dict(ref="1.1", eq="E01", name="Refuse crane No.1", tag="CR-01", line="Common", inst=2003,
                  task="Hoist rope renewal & grab overhaul", interval=3,
                  marks={2019: "X", 2022: "X", 2025: "X"}, remarks="8 m³ hydraulic grab, 12 t SWL")),
    ("item", dict(ref="1.2", eq="E02", name="Refuse crane No.2", tag="CR-02", line="Common", inst=2003,
                  task="Hoist rope renewal & grab overhaul", interval=3,
                  marks={2020: "X", 2023: "X", CUR: {"plan": "P"}}, remarks="8 m³ hydraulic grab, 12 t SWL")),
    ("group", "2", "COMBUSTION"),
    ("item", dict(ref="2.1", eq="E03", name="Stoker grate - Line 1", tag="GR-101", line="1", inst=2003,
                  task="Grate bar replacement (partial)", interval=3,
                  marks={2019: "X", 2022: "X", 2025: "X", 2028: "P"}, remarks="Reciprocating grate, 5 zones")),
    ("task", dict(ref="2.1a", eq="E03", task="Hydraulic drive unit overhaul", interval=6,
                  marks={2020: "X", CUR: {"plan": "P", "actual": "X"}}, remarks="")),
    ("item", dict(ref="2.2", eq="E04", name="Stoker grate - Line 2", tag="GR-201", line="2", inst=2003,
                  task="Grate bar replacement (partial)", interval=3,
                  marks={2020: "X", 2023: "X", CUR: {"plan": "P"}, 2029: "P"}, remarks="Reciprocating grate, 5 zones")),
    ("group", "3", "BOILER & POWER GENERATION"),
    ("item", dict(ref="3.1", eq="E05", name="Boiler - Line 1", tag="BL-101", line="1", inst=2003,
                  task="Superheater tube bank replacement", interval=None,
                  marks={2021: "X"}, remarks="Next renewal subject to UT thickness survey")),
    ("item", dict(ref="3.2", eq="E06", name="Boiler - Line 2", tag="BL-201", line="2", inst=2003,
                  task="Superheater tube bank replacement", interval=7,
                  marks={2022: "X", 2029: "P"}, remarks="")),
    ("item", dict(ref="3.3", eq="E07", name="Boiler feed water pump A", tag="BFP-A", line="Common", inst=2003,
                  task="Pump overhaul", interval=4,
                  marks={2019: "X", 2023: "X", 2027: "P"}, remarks="Multistage centrifugal, 75 kW")),
    ("item", dict(ref="3.4", eq="E08", name="Boiler feed water pump B", tag="BFP-B", line="Common", inst=2003,
                  task="Pump overhaul", interval=4,
                  marks={2020: "X", 2024: "X", 2028: "P"}, remarks="Multistage centrifugal, 75 kW")),
    ("item", dict(ref="3.5", eq="E09", name="Steam turbine generator", tag="TG-01", line="Common", inst=2003,
                  task="Major overhaul (casing open)", interval=6,
                  marks={2020: "X", CUR: {"plan": "P"}}, remarks="Condensing turbine, 7.5 MWe")),
    ("group", "4", "FLUE GAS TREATMENT"),
    ("item", dict(ref="4.1", eq="E10", name="Bag filter - Line 1", tag="BF-101", line="1", inst=2003,
                  task="Filter bag & cage replacement (full set)", interval=5,
                  marks={2020: "X", 2025: "X", 2030: "P"}, remarks="PTFE membrane bags")),
    ("item", dict(ref="4.2", eq="E11", name="Bag filter - Line 2", tag="BF-201", line="2", inst=2003,
                  task="Filter bag & cage replacement (full set)", interval=5,
                  marks={2021: "X"}, remarks="PTFE membrane bags")),
    ("item", dict(ref="4.3", eq="E12", name="Induced draft fan - Line 1", tag="IDF-101", line="1", inst=2003,
                  task="Impeller & bearing overhaul", interval=4,
                  marks={2019: "X", 2023: "X", 2027: "P"}, remarks="VSD driven, 400 kW")),
    ("item", dict(ref="4.4", eq="E13", name="Induced draft fan - Line 2", tag="IDF-201", line="2", inst=2003,
                  task="Impeller & bearing overhaul", interval=4,
                  marks={2020: "X", 2024: "P", 2028: "P"}, remarks="VSD driven, 400 kW")),
    ("group", "5", "WHOLE PLANT"),
    ("plant", dict(ref="5.1", name="Whole plant (both lines)", tag="", line="All", inst=None,
                   task="Detailed functional inspection by accredited body (3-yearly)", interval=3,
                   marks={2020: "X", 2023: "X", CUR: {"plan": "P"}}, remarks="Statutory; report kept in QA file")),
]

LEGEND = [
    "LEGEND",
    "X = work completed (actual)",
    "P = work planned",
    "2026/27 is the current year: left column = Plan, right column = Actual (updated after each outage).",
    "Financial year runs 1 April - 31 March (e.g. 2019/20 = 1 Apr 2019 to 31 Mar 2020).",
    "Only major / capital maintenance is shown. Routine PPM and annual statutory boiler inspections are not shown.",
]

REVLOG = [
    ("Rev.", "Date", "Description"),
    ("5", "14/04/2025", "Roll-forward to 2025/26; 2024/25 actuals entered"),
    ("6", "07/04/2026", "Roll-forward to 2026/27; 2025/26 actuals entered"),
    ("7", "01/06/2026", "Spring outage actuals (Line 1 hydraulics) entered"),
]

# ---------------------------------------------------------------- equipment
EQUIP_FURNACE = {"E01": None, "E02": None, "E03": 1, "E04": 2, "E05": 1, "E06": 2, "E07": None, "E08": None,
                 "E09": None, "E10": 1, "E11": 2, "E12": 1, "E13": 2}

# ---------------------------------------------------------------- work log (CSV)
# (key, wo, start, finish, asset, line, desc, contractor, crew, manhours, status, comments, manDays, manDaysText)
LOG = [
    ("crane1-2022", "WO-22-0412", "2022-06-06", "2022-06-09", "Refuse Crane 1", "Common",
     "Replace hoist ropes (both drums) and overhaul grab hydraulic unit", "Marrowby Lifting Ltd", "4", "128", "Closed", "", 16, "128"),
    ("grate1-2022", "WO-22-0977", "2022-10-03", "2022-10-21", "Stoker Grate L1", "1",
     "Replace worn grate bars - rows 3-7 (approx 40%)", "Brackwell Thermal Services Ltd", "6", "720", "Closed", "Autumn outage L1", 90, "720"),
    ("boiler2-2022", "WO-22-1030", "2022-11-07", "2022-11-18", "Boiler 2 - Superheater", "2",
     "SH2 tube bank replacement - phase 1 (cut out, new tube supply)", "Brackwell Thermal Services Ltd", "8", "768", "Closed", "", 96, "768"),
    ("boiler2-2022", "WO-22-1031", "2022-11-21", "2022-12-02", "Boiler 2 - Superheater", "2",
     "SH2 tube bank replacement - phase 2 (welding, NDT, hydrotest)", "Brackwell Thermal Services Ltd", "8", "832", "Closed", "", 104, "832"),
    ("crane2-2023", "WO-23-0388", "2023-05-15", "2023-05-17", "Refuse Crane #2", "Common",
     "Hoist rope renewal, grab cylinder seals replaced", "Marrowby Lifting Ltd", "3", "3 men x 3 days", "Closed", "", 9, "3 men x 3 days"),
    ("bfpa-2023", "WO-23-0455", "2023-06-12", "2023-06-16", "BFW Pump A", "Common",
     "Full strip-down overhaul, new mechanical seal & bearings", "Kestrow Pump Engineering", "3", "120", "Closed", "", 15, "120"),
    ("grate2-2023", "WO-23-0861", "2023-10-02", "2023-10-20", "Grate Line 2", "2",
     "Grate bar replacement approx 35%", "Brackwell Thermal Services Ltd", "6", "684", "Closed", "Autumn outage L2", 85.5, "684"),
    ("idf1-2023", "WO-23-0874", "2023-10-09", "2023-10-13", "ID Fan No.1", "1",
     "Impeller rebalanced, both bearings replaced, coupling re-aligned", "Corvane Fans & Blowers", "4", "160", "Closed", "", 20, "160"),
    ("pfi-2023", "WO-23-0902", "2023-10-23", "2023-10-27", "Plant (all)", "All",
     "3-yearly detailed functional inspection by accredited body", "Ardleigh Inspection Services", "3", "120", "Closed", "Report ref. HV-PFI-2023", 15, "120"),
    ("idf1-bd-2024", "WO-23-1544", "2024-01-22", "2024-01-22", "ID Fan 1", "1",
     "High vibration trip - replace DE bearing (breakdown)", "In-house (Maint. Team B)", "3", "24", "Closed", "Line 1 off 14 h", 3, "24"),
    ("crane1-bd-2024", "WO-24-0610", "2024-08-14", "2024-08-15", "Crane 1", "Common",
     "Broken wire strand found on hoist rope - emergency rope change\n(rope taken from site spares)", "In-house (Maint. Team B)", "4", "", "Closed", "approx. 6 man-days", 6, "approx. 6 man-days"),
    ("bfpb-2024", "WO-25-0031", "2025-04-08", "2025-04-17", "BFP B", "Common",
     "Overhaul - rotating element exchanged with refurbished spare", "Kestrow Pump Engineering", "3", "176", "Closed", "", 22, "176"),
    ("crane1-2025", "WO-25-0402", "2025-05-19", "2025-05-22", "Crane No1", "Common",
     "Hoist rope renewal & grab overhaul", "Marrowby Lifting Ltd", "4", "128", "Closed", "", 16, "128"),
    ("grate1-2025", "WO-25-0915", "2025-10-06", "2025-10-24", "Stoker Grate L1", "1",
     "Grate bars replaced rows 1-6", "Brackwell Thermal Services Ltd", "6", "744", "Closed", "Autumn outage L1", 93, "744"),
    ("bf1-2025", "WO-25-0921", "2025-10-06", "2025-10-17", "Bag House 1", "1",
     "Full set of filter bags & cages replaced (1,344 bags)", "Tensfield Filtration", "10", "960", "Closed", "", 120, "960"),
    ("grate1hyd-2026", "WO-26-0377", "2026-05-11", "2026-05-22", "Stoker Line 1 - hydraulics", "1",
     "Hydraulic power unit overhaul, 4 drive cylinders resealed", "Brackwell Thermal Services Ltd", "4", "384", "Closed", "Spring outage L1", 48, "384"),
]
LOG_EQ = {"Refuse Crane 1": "E01", "Crane 1": "E01", "Crane No1": "E01", "Refuse Crane #2": "E02",
          "Stoker Grate L1": "E03", "Stoker Line 1 - hydraulics": "E03", "Grate Line 2": "E04",
          "Boiler 2 - Superheater": "E06", "BFW Pump A": "E07", "BFP B": "E08", "Bag House 1": "E10",
          "ID Fan No.1": "E12", "ID Fan 1": "E12", "Plant (all)": "ALL"}

# map chart (row ref, year) -> log key, for actual works also in the log
CHART_TO_LOG = {("1.1", 2022): "crane1-2022", ("1.1", 2025): "crane1-2025", ("1.2", 2023): "crane2-2023",
                ("2.1", 2022): "grate1-2022", ("2.1", 2025): "grate1-2025", ("2.1a", 2026): "grate1hyd-2026",
                ("2.2", 2023): "grate2-2023", ("3.2", 2022): "boiler2-2022", ("3.3", 2023): "bfpa-2023",
                ("3.4", 2024): "bfpb-2024", ("4.1", 2025): "bf1-2025", ("4.3", 2023): "idf1-2023",
                ("5.1", 2023): "pfi-2023"}

ATTR = {"Hoist rope renewal & grab overhaul": "OVERHAUL", "Grate bar replacement (partial)": "REPLACE",
        "Hydraulic drive unit overhaul": "OVERHAUL", "Superheater tube bank replacement": "REPLACE",
        "Pump overhaul": "OVERHAUL", "Major overhaul (casing open)": "OVERHAUL",
        "Filter bag & cage replacement (full set)": "REPLACE", "Impeller & bearing overhaul": "OVERHAUL",
        "Detailed functional inspection by accredited body (3-yearly)": "INSPECTION"}


def main():
    fdir = os.path.join(ROOT, FID, "files")
    adir = os.path.join(ROOT, FID, "answer", "files")
    os.makedirs(fdir, exist_ok=True)
    os.makedirs(adir, exist_ok=True)

    # ------------------------------------------------ xlsx
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = SHEET
    thin = Side(style="thin", color="808080")
    box = Border(left=thin, right=thin, top=thin, bottom=thin)
    bold = Font(bold=True)
    grey = PatternFill("solid", fgColor="D9D9D9")
    blue = PatternFill("solid", fgColor="DDEBF7")
    cur_fill = PatternFill("solid", fgColor="FFF2CC")

    # columns: A Ref, B System/Equipment, C Tag, D Line, E Year installed, F Task, G Interval,
    #          H..N 2019/20..2025/26, O 2026/27 Plan, P 2026/27 Actual, Q..T 2027/28..2030/31, U Remarks
    year_cols = {}
    c = 8
    for y in YEARS:
        if y == CUR:
            year_cols[(y, "plan")] = c
            year_cols[(y, "actual")] = c + 1
            c += 2
        else:
            year_cols[(y, None)] = c
            c += 1
    REM = c  # 21 = U

    recs = []
    ws["A1"] = f"[FICTIONAL] {FAC_NAME_FILE} - 10-Year Planned Maintenance Schedule (Star Chart)"
    ws["A1"].font = Font(bold=True, size=14)
    recs.append(dict(sheet=SHEET, r=1, kind="title", fields=dict(text=ws["A1"].value)))
    ws["A2"] = "2 x 150 t/day moving-grate lines, steam turbine generator | Rev. 7 | Status as at 01/10/2026"
    recs.append(dict(sheet=SHEET, r=2, kind="note", fields=dict(text=ws["A2"].value)))

    # row 4 band headings
    ws.cell(4, year_cols[(2019, None)], "ACTUAL")
    ws.merge_cells(start_row=4, start_column=year_cols[(2019, None)], end_row=4, end_column=year_cols[(2025, None)])
    ws.cell(4, year_cols[(CUR, "plan")], "2026/27 (current year)")
    ws.merge_cells(start_row=4, start_column=year_cols[(CUR, "plan")], end_row=4, end_column=year_cols[(CUR, "actual")])
    ws.cell(4, year_cols[(2027, None)], "PLAN")
    ws.merge_cells(start_row=4, start_column=year_cols[(2027, None)], end_row=4, end_column=year_cols[(2030, None)])
    for cc in range(8, REM):
        ws.cell(4, cc).font = bold
        ws.cell(4, cc).alignment = Alignment(horizontal="center")
        ws.cell(4, cc).fill = grey
    recs.append(dict(sheet=SHEET, r=4, kind="header", fields=dict(bands=["ACTUAL", "2026/27 (current year)", "PLAN"])))

    hdr = ["Ref", "System / Equipment", "Tag No.", "Line", "Year installed", "Maintenance task", "Interval (yrs)"]
    for i, h in enumerate(hdr, 1):
        ws.cell(5, i, h)
    for (y, sub), cc in year_cols.items():
        ws.cell(5, cc, "Plan" if sub == "plan" else "Actual" if sub == "actual" else fy_label(y))
    ws.cell(5, REM, "Remarks")
    for cc in range(1, REM + 1):
        ws.cell(5, cc).font = bold
        ws.cell(5, cc).fill = grey
        ws.cell(5, cc).border = box
        ws.cell(5, cc).alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    recs.append(dict(sheet=SHEET, r=5, kind="header", fields=dict(columns=[ws.cell(5, cc).value for cc in range(1, REM + 1)])))

    eq_rows = {}     # eq -> row
    eq_path = {}
    chart_marks = []  # (ref, row, year, symbol, rowdef)
    r = 6
    group = None
    last_item = None
    for ent in CHART:
        kind, d = ent[0], ent[1]
        if kind == "group":
            ws.cell(r, 1, d)
            r_val = ent[2]
            ws.cell(r, 2, r_val)
            group = r_val
            for cc in range(1, REM + 1):
                ws.cell(r, cc).fill = blue
                ws.cell(r, cc).font = bold
                ws.cell(r, cc).border = box
            recs.append(dict(sheet=SHEET, r=r, kind="group", fields=dict(path=[group], code=d)))
            r += 1
            continue
        ws.cell(r, 1, d["ref"])
        if kind in ("item", "plant"):
            ws.cell(r, 2, d["name"])
            ws.cell(r, 3, d["tag"] or None)
            ws.cell(r, 4, d["line"] if d["line"] in ("Common", "All") else int(d["line"]))
            ws.cell(r, 5, d["inst"])
            last_item = d
        ws.cell(r, 6, d["task"])
        ws.cell(r, 7, d["interval"])
        marks = {}
        for y, m in d["marks"].items():
            if isinstance(m, dict):
                syms = []
                for sub in ("plan", "actual"):
                    if sub in m:
                        ws.cell(r, year_cols[(y, sub)], m[sub])
                        syms.append(m[sub])
                marks[str(y)] = syms if len(syms) > 1 else syms[0]
                for s in syms:
                    chart_marks.append((d["ref"], r, y, s, kind, d, len(syms) > 1))
            else:
                ws.cell(r, year_cols[(y, None)], m)
                marks[str(y)] = m
                chart_marks.append((d["ref"], r, y, m, kind, d, False))
        if d["remarks"]:
            ws.cell(r, REM, d["remarks"])
        for cc in range(1, REM + 1):
            ws.cell(r, cc).border = box
            if cc >= 8 and cc < REM:
                ws.cell(r, cc).alignment = Alignment(horizontal="center")
        f = {}
        if kind == "item":
            f["path"] = [group, d["name"]]
            f["code"] = d["tag"]
            f["install_year"] = d["inst"]
            f["line"] = ws.cell(r, 4).value
            eq_rows[d["eq"]] = r
            eq_path[d["eq"]] = [group, d["name"]]
        elif kind == "task":
            f["path"] = [group, last_item["name"]]
        else:
            f["path"] = [group, d["name"]]
            f["line"] = "All"
        f["task"] = d["task"]
        if d["interval"] is not None:
            f["interval_years"] = d["interval"]
        f["marks"] = marks
        if d["remarks"]:
            f["specs"] = [d["remarks"]]
        recs.append(dict(sheet=SHEET, r=r, kind={"item": "item", "task": "task", "plant": "plant-wide"}[kind], fields=f))
        r += 1

    r += 1
    legend_start = r
    for i, t in enumerate(LEGEND):
        ws.cell(r, 2, t)
        if i == 0:
            ws.cell(r, 2).font = bold
        recs.append(dict(sheet=SHEET, r=r, kind="legend", fields=dict(text=t)))
        r += 1

    widths = {"A": 6, "B": 30, "C": 10, "D": 8, "E": 10, "F": 44, "G": 9}
    for k, v in widths.items():
        ws.column_dimensions[k].width = v
    for cc in range(8, REM):
        ws.column_dimensions[openpyxl.utils.get_column_letter(cc)].width = 8
    for (y, sub), cc in year_cols.items():
        if y == CUR:
            for rr in range(5, legend_start - 1):
                if ws.cell(rr, cc).fill.fgColor.rgb in (None, "00000000"):
                    ws.cell(rr, cc).fill = cur_fill
    ws.column_dimensions[openpyxl.utils.get_column_letter(REM)].width = 40
    ws.freeze_panes = "H6"

    ws2 = wb.create_sheet(SHEET2)
    recs2 = []
    for i, row in enumerate(REVLOG, 1):
        for j, v in enumerate(row, 1):
            ws2.cell(i, j, v)
        recs2.append(dict(sheet=SHEET2, r=i, kind="header" if i == 1 else "note",
                          fields=dict(rev=row[0], date=row[1], text=row[2])))
    ws2.column_dimensions["C"].width = 60

    fixed = dt.datetime(2026, 10, 1, 9, 0, 0)
    wb.properties.created = fixed
    wb.properties.modified = fixed
    wb.properties.creator = "Maintenance Planning"
    wb.properties.title = "[FICTIONAL] 10-Year Planned Maintenance Schedule"
    if not ANSWERS_ONLY:
        wb.save(os.path.join(fdir, XLSX))

    # ------------------------------------------------ csv
    out = io.StringIO(newline="")
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(["[FICTIONAL] Hollinmere ERF - CMMS export: closed work orders, major works only (records from 01/04/2022)"])
    w.writerow(["Exported 01/10/2026 by Maintenance Planning"])
    w.writerow([])
    header = ["WO No.", "Date Start", "Date Finish", "Asset", "Line", "Work Description", "Contractor",
              "Crew Size", "Man-hours", "Status", "Comments"]
    w.writerow(header)
    csv_recs = [dict(r=1, kind="title", fields=dict(text="[FICTIONAL] Hollinmere ERF - CMMS export: closed work orders, major works only (records from 01/04/2022)")),
                dict(r=2, kind="note", fields=dict(text="Exported 01/10/2026 by Maintenance Planning")),
                dict(r=4, kind="header", fields=dict(columns=header))]
    phys = 5
    log_rows = {}  # key -> [rows]
    log_data = {}
    for (key, wo, s, e, asset, line, desc, con, crew, mh, st, com, md, mdt) in LOG:
        uk = lambda x: dt.date.fromisoformat(x).strftime("%d/%m/%Y")
        w.writerow([wo, uk(s), uk(e), asset, line, desc, con, crew, mh, st, com])
        f = dict(wo=wo, equipment=asset, line=line, description=desc, contractor=con, crew=int(crew))
        if s == e:
            f["date"] = s
        else:
            f["start"], f["end"] = s, e
        f["manDays"] = md
        f["manDaysText"] = mdt
        if com:
            f["comments"] = com
        csv_recs.append(dict(r=phys, kind="work", fields=f))
        log_rows.setdefault(key, []).append(phys)
        log_data.setdefault(key, []).append(dict(start=s, end=e, md=md, con=con, asset=asset, desc=desc))
        phys += 1 + desc.count("\n")
    w.writerow([f"{len(LOG)} record(s)"])
    csv_recs.append(dict(r=phys, kind="footer", fields=dict(text=f"{len(LOG)} record(s)")))
    if not ANSWERS_ONLY:
        with open(os.path.join(fdir, CSVF), "w", encoding="utf-8", newline="") as fh:
            fh.write(out.getvalue())

    # ------------------------------------------------ answer files
    def stem(n):
        return os.path.splitext(n)[0]

    with open(os.path.join(adir, stem(XLSX) + ".json"), "w", encoding="utf-8") as fh:
        json.dump(dict(schema="moyai.answer.file/0", file=XLSX, plan=True, records=to_answer(recs + recs2)), fh, ensure_ascii=False, indent=1)
    with open(os.path.join(adir, stem(CSVF) + ".json"), "w", encoding="utf-8") as fh:
        json.dump(dict(schema="moyai.answer.file/0", file=CSVF, plan=True, records=to_answer(csv_recs)), fh, ensure_ascii=False, indent=1)

    # ------------------------------------------------ world
    all_eq = sorted(EQUIP_FURNACE)
    equipment = []
    for ent in CHART:
        kind, d = ent[0], ent[1]
        if kind != "item":
            continue
        e = d["eq"]
        names = {XLSX: d["name"]}
        used = [row[4] for row in LOG if LOG_EQ[row[4]] == e]
        variants = {}
        if used:
            main_name = max(dict.fromkeys(used), key=used.count)  # most frequent, first seen on ties
            names[CSVF] = main_name
            others = [a for a in dict.fromkeys(used) if a != main_name]
            if others:
                variants[CSVF] = others
        eqd = dict(id=e, name=d["name"], names=names, furnace=EQUIP_FURNACE[e], install_year=d["inst"],
                   code=d["tag"], path=eq_path[e], rows=[dict(file=XLSX, sheet=SHEET, r=eq_rows[e])])
        if variants:
            eqd["name_variants"] = variants
        equipment.append(eqd)

    works = []
    seen = {}
    used_log = set()
    n = 0
    for ref, row, y, sym, kind, d, multi in chart_marks:
        key = (ref, y)
        rowref = dict(file=XLSX, sheet=SHEET, r=row, year=y)
        if multi:
            rowref["symbol"] = sym
        if key in seen:
            seen[key]["rows"].append(rowref)
            if sym == "X":
                seen[key]["status"] = "actual"
            continue
        n += 1
        eqs = all_eq if kind == "plant" else [d["eq"]]
        status = "actual" if sym == "X" else "planned"
        wk = dict(id=f"W{n:04d}", label=d["task"], attribute=ATTR[d["task"]], status=status, fiscal_year=y,
                  equipment=eqs, start=None, end=None, man_days=None, days=None, vendor=None, contract=None,
                  precision=(kind == "plant"), rows=[rowref])
        lk = CHART_TO_LOG.get(key)
        if lk:
            used_log.add(lk)
            ld = log_data[lk]
            s = min(x["start"] for x in ld)
            e = max(x["end"] for x in ld)
            wk.update(start=s, end=e, man_days=sum(x["md"] for x in ld),
                      days=(dt.date.fromisoformat(e) - dt.date.fromisoformat(s)).days + 1,
                      vendor=ld[0]["con"], fiscal_year=fy_of(s), status="actual")
            wk["rows"] += [dict(file=CSVF, r=rr) for rr in log_rows[lk]]
        seen[key] = wk
        works.append(wk)
    # log-only works (breakdowns)
    for lk in log_rows:
        if lk in used_log:
            continue
        ld = log_data[lk]
        n += 1
        s, e = ld[0]["start"], ld[0]["end"]
        works.append(dict(id=f"W{n:04d}", label=ld[0]["desc"], attribute="REPAIR", status="actual", fiscal_year=fy_of(s),
                          equipment=[LOG_EQ[ld[0]["asset"]]], start=s, end=e, man_days=ld[0]["md"],
                          days=(dt.date.fromisoformat(e) - dt.date.fromisoformat(s)).days + 1,
                          vendor=ld[0]["con"], contract=None, precision=False,
                          rows=[dict(file=CSVF, r=rr) for rr in log_rows[lk]]))
    for wk in works:
        if wk["start"] == wk["end"] and wk["start"]:
            wk["date"] = wk["start"]

    world = dict(
        schema="moyai.answer.world/0",
        facility=dict(id=FID, name=FAC_NAME, industry="waste-incineration",
                      profile=dict(furnace="stoker", capacity_t_per_day=300, lines=2, turbine=True,
                                   dust="bag filter", ash="landfill (bottom ash to off-site recycler)", contract="DBO")),
        fiscal_year_start_month=4,
        man_day_hours=8,
        today=TODAY,
        equipment=equipment,
        works=works,
        unrecorded=[],
        defects=[
            dict(kind="overdue-planned", where=f"{XLSX} / {SHEET} / row {eq_rows['E13']} (Induced draft fan - Line 2), 2024/25 = P",
                 check="A planned mark in a past year was never turned into X and there is no work order; the overhaul is overdue and not re-planned in 2025/26 or 2026/27."),
            dict(kind="missing-next", where=f"{XLSX} / {SHEET} / row {eq_rows['E11']} (Bag filter - Line 2)",
                 check="Interval 5 yrs, last X in 2021/22, but no P anywhere up to 2030/31 (next due 2026/27)."),
            dict(kind="missing-next", where=f"{XLSX} / {SHEET} / row {eq_rows['E01']} (Refuse crane No.1)",
                 check="Interval 3 yrs, last X in 2025/26, but no P in 2028/29 (sister crane No.2 is planned)."),
        ],
    )
    with open(os.path.join(ROOT, FID, "answer", "world.json"), "w", encoding="utf-8") as fh:
        json.dump(world, fh, ensure_ascii=False, indent=1)
    print("works:", len(works), "equipment:", len(equipment), "csv rows:", phys)


if __name__ == "__main__":
    main()
