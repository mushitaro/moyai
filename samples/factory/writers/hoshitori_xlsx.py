"""星取表の Excel を書く。正解（どのセルがどの作業か）も同時に返す。"""
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from dirt import DITTO, apply_ditto, year_label
from writers.ioutil import rewrite_zip_fixed

CREATOR = "【架空】工場 v1"
LEVEL_NAMES = ("設備", "系統", "機器群")
SYM_ACTUAL, SYM_PLANNED, SYM_PRECISION = "●", "○", "◎"
LEGEND = [(SYM_PLANNED, "予定"), (SYM_ACTUAL, "実績"), (SYM_PRECISION, "精密機能検査")]
HEADER_ROWS = (3, 4)


def write_hoshitori(world: dict, path: Path) -> dict:
    rules = world["rules"]
    dirt = rules["dirt"]["sheet"]
    eq = world["equipment"]
    fys = world["fiscal_years"]
    n_levels = len(eq[0]["path"])
    equip_col, furn_col = n_levels + 1, n_levels + 2
    FIRST_COL = n_levels + 3
    today = world["today"]

    wb = Workbook()
    ws = wb.active
    ws.title = "星取表"
    fixed = datetime(2026, 10, 1, 0, 0, 0)
    wb.properties.creator = CREATOR
    wb.properties.lastModifiedBy = None
    wb.properties.created = fixed
    wb.properties.modified = fixed

    bold = Font(bold=True)
    fill = PatternFill("solid", fgColor="DDEBF7")
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)

    ws["A1"] = f"【架空】{world['facility']['name'].removeprefix('【架空】')} 整備計画（星取表）"
    ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = f"{today} 時点。実績と予定の境は今日の日付"

    # 見出し 2 段
    for col, text in enumerate(list(LEVEL_NAMES[:n_levels]) + ["機器", "号炉"], 1):
        ws.cell(HEADER_ROWS[0], col, text)
        ws.merge_cells(start_row=HEADER_ROWS[0], start_column=col, end_row=HEADER_ROWS[1], end_column=col)
    year_cols = []
    for i, fy in enumerate(fys):
        c = FIRST_COL + 2 * i
        label = year_label(fy, dirt["year_label_styles"][str(fy)])
        ws.cell(HEADER_ROWS[0], c, label)
        ws.merge_cells(start_row=HEADER_ROWS[0], start_column=c, end_row=HEADER_ROWS[0], end_column=c + 1)
        ws.cell(HEADER_ROWS[1], c, "実績")
        ws.cell(HEADER_ROWS[1], c + 1, "予定")
        year_cols.append({"fiscal_year": fy, "label": label, "actual_col": get_column_letter(c),
                          "planned_col": get_column_letter(c + 1)})
    for r in HEADER_ROWS:
        for c in range(1, FIRST_COL + 2 * len(fys)):
            cell = ws.cell(r, c)
            cell.font, cell.fill, cell.alignment = bold, fill, center

    # 行：設備、号炉の順は world.equipment の並び。号炉の列は上と同じなら〃
    first = HEADER_ROWS[1] + 1
    rows = []
    sys_start = {}
    for i, e in enumerate(eq):
        sys_start.setdefault(tuple(e["path"]), i)
    ditto_in = apply_ditto([e["furnace_label"] for e in eq], reset_at=set(sys_start.values()))
    for i, e in enumerate(eq):
        r = first + i
        rows.append({"row": r, "equipment_id": e["id"]})
        ws.cell(r, equip_col, e["base_name"])
        ws.cell(r, furn_col, ditto_in[i])
    # 上位の段ごとに縦に結合する（同じ上位の道が続く行）
    merged_ranges = []
    for lv in range(n_levels):
        i = 0
        while i < len(eq):
            j = i
            while j + 1 < len(eq) and eq[j + 1]["path"][: lv + 1] == eq[i]["path"][: lv + 1]:
                j += 1
            r0, r1 = first + i, first + j
            ws.cell(r0, lv + 1, eq[i]["path"][lv])
            ws.cell(r0, lv + 1).alignment = Alignment(vertical="center", wrap_text=True)
            if r1 > r0:
                ws.merge_cells(start_row=r0, start_column=lv + 1, end_row=r1, end_column=lv + 1)
            letter = get_column_letter(lv + 1)
            merged_ranges.append(f"{letter}{r0}:{letter}{r1}" if r1 > r0 else f"{letter}{r0}")
            i = j + 1
    merged_systems = [m for m in merged_ranges if m[0] == "A"]
    last = first + len(eq) - 1
    row_of = {x["equipment_id"]: x["row"] for x in rows}
    col_of = {y["fiscal_year"]: y for y in year_cols}

    # セル：同じセルに複数の作業があれば、精密機能検査の記号を優先する
    cells = {}
    for w in world["works"]:
        y = col_of[w["fiscal_year"]]
        kind = "actual" if w["status"] == "actual" else "planned"
        coord = f"{y['actual_col'] if kind == 'actual' else y['planned_col']}{row_of[w['equipment_id']]}"
        d = cells.setdefault(coord, {"kind": kind, "work_ids": [], "tags": set()})
        d["work_ids"].append(w["id"])
        d["tags"].add(w["tag"])
    unk = dirt["unknown_symbol"]
    unknown = None
    for coord, d in sorted(cells.items()):
        if "PRECISION" in d["tags"]:
            sym = SYM_PRECISION
        else:
            sym = SYM_ACTUAL if d["kind"] == "actual" else SYM_PLANNED
        wk = [w for w in world["works"] if w["id"] in d["work_ids"]]
        if any(w["pattern"] == unk["match"]["pattern"] for w in wk):
            if unknown is not None:
                raise ValueError("凡例に無い記号の場所が 2 つ以上ある")
            unknown = {"cell": coord, "symbol": unk["symbol"], "means": unk["means"],
                       "work_ids": sorted(d["work_ids"])}
            sym = unk["symbol"]
        d["symbol"] = sym
        ws[coord] = sym
        ws[coord].alignment = center
    if unknown is None:
        raise ValueError("凡例に無い記号の行き先が無い")

    # 小計：列ごとの記号のあるセルの数。数の値で書く（数式にしない）
    sub_row = last + 1
    ws.cell(sub_row, 1, "件数（小計）")
    ws.cell(sub_row, 1).font = bold
    subtotal = {}
    for y in year_cols:
        for col in (y["actual_col"], y["planned_col"]):
            n = sum(1 for coord in cells if coord.rstrip("0123456789") == col)
            ws[f"{col}{sub_row}"] = n
            ws[f"{col}{sub_row}"].alignment = center
            subtotal[col] = n

    # 凡例（表の下）
    leg_row = sub_row + 2
    ws.cell(leg_row, 1, "凡例").font = bold
    legend = []
    for k, (sym, text) in enumerate(LEGEND, 1):
        ws.cell(leg_row + k, equip_col, sym)
        ws.cell(leg_row + k, furn_col, text)
        legend.append({"row": leg_row + k, "symbol": sym, "meaning": text})

    for c in range(1, n_levels + 1):
        ws.column_dimensions[get_column_letter(c)].width = 18
    ws.column_dimensions[get_column_letter(equip_col)].width = 26
    ws.column_dimensions[get_column_letter(furn_col)].width = 9
    for c in range(FIRST_COL, FIRST_COL + 2 * len(fys)):
        ws.column_dimensions[get_column_letter(c)].width = 7
    ws.freeze_panes = ws.cell(first, FIRST_COL)

    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    rewrite_zip_fixed(path)

    return {
        "schema": "moyai.factory.truth.hoshitori/0",
        "file": "plan-hoshitori.xlsx",
        "sheet": ws.title,
        "title_cell": "A1",
        "header_rows": list(HEADER_ROWS),
        "first_data_row": first,
        "last_data_row": last,
        "levels": n_levels,
        "depth": n_levels + 1,
        "columns": {"system": "A", "levels": [get_column_letter(c) for c in range(1, n_levels + 1)],
                    "equipment": get_column_letter(equip_col), "furnace": get_column_letter(furn_col),
                    "first_year_col": get_column_letter(FIRST_COL)},
        "merged_ranges": merged_ranges,
        "equipment_names": {e["id"]: e["base_name"] for e in eq},
        "year_columns": year_cols,
        "era_switch": {"from_label": col_of[2019]["label"], "to_label": col_of[2020]["label"],
                       "note": "2019 年度を H31、2020 年度を R2 と書く。令和元年度は 2019 年度に当たる"},
        "rows": rows,
        "merged_system_ranges": merged_systems,
        "ditto_cells": [f"{get_column_letter(furn_col)}{first + i}" for i, v in enumerate(ditto_in) if v == DITTO],
        "cells": {k: {"kind": v["kind"], "symbol": v["symbol"], "work_ids": sorted(v["work_ids"])}
                  for k, v in sorted(cells.items())},
        "legend": legend,
        "legend_title_cell": f"A{leg_row}",
        "unknown_symbol": unknown,
        "subtotal": {"row": sub_row, "meaning": "列ごとの、記号のあるセルの数（数の値）", "values": subtotal},
    }
