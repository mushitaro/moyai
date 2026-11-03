"""定期整備の工事報告書（帳票）を Excel で書く。号炉ごと・年度ごとに 1 冊。PDF にする元になる。
頁ごとに見出しをくり返し、2 頁目から表題に「（続き）」を付ける。正解（どの行がどの作業か）も返す。"""
import math
import random
from datetime import date, datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.pagebreak import Break

from dirt import DATE_STYLES, EFFORT_STYLES, date_text, effort_text, year_label
from writers.ioutil import rewrite_zip_fixed
from writers.names import ledger_name

CREATOR = "【架空】工場 v1"
HEADER = ["No.", "機器", "作業内容", "工期", "日数", "工数"]
CONT = "（続き）"


def report_groups(world: dict) -> dict:
    """(号炉, 年度) ごとの、報告書に載せる実績の作業。"""
    cfg = world["rules"]["report"]
    eq = {e["id"]: e for e in world["equipment"]}
    groups: dict = {}
    for w in world["works"]:
        if w["pattern"] not in cfg["patterns"] or w["status"] != "actual":
            continue
        groups.setdefault((eq[w["equipment_id"]]["furnace"], w["fiscal_year"]), []).append(w)
    return dict(sorted(groups.items()))


def _rows_for(world: dict, works: list[dict]) -> list[list[dict]]:
    """行にまとめる。bundle_patterns の型は、同じ型の機器を 1 行（一式）にする。"""
    cfg = world["rules"]["report"]
    out, bundles = [], {}
    for w in sorted(works, key=lambda w: (w["start"], w["id"])):
        if w["pattern"] in cfg["bundle_patterns"]:
            if w["pattern"] not in bundles:
                bundles[w["pattern"]] = []
                out.append(bundles[w["pattern"]])
            bundles[w["pattern"]].append(w)
        else:
            out.append([w])
    return out


def write_report(world: dict, furnace: int, fy: int, works: list[dict], xlsx: Path, rel_xlsx: str) -> dict:
    rules = world["rules"]
    cfg = rules["report"]
    eq = {e["id"]: e for e in world["equipment"]}
    hours = world["man_day_hours"]
    rng = random.Random(f"{world['seed']}-report-{furnace}-{fy}")
    contractors = {c["id"]: c["name"] for c in rules["contractors"]}
    per_page = cfg["rows_per_page"]
    rows = _rows_for(world, works)
    n_pages = max(1, math.ceil(len(rows) / per_page))
    fl = eq[works[0]["equipment_id"]]["furnace_label"]
    starts = [date.fromisoformat(w["start"]) for w in works]
    ends = [date.fromisoformat(w["end"]) for w in works]
    s0, e0 = min(starts), max(ends)
    span = (e0 - s0).days + 1
    date_style = rng.choice(DATE_STYLES)
    contr = {w["contractor"] for w in works}
    maker = "、".join(sorted(contractors[c] for c in contr if c)) or "直営"

    wb = Workbook()
    ws = wb.active
    ws.title = "工事報告書"
    fixed = datetime(2026, 10, 1, 0, 0, 0)
    wb.properties.creator = CREATOR
    wb.properties.lastModifiedBy = None
    wb.properties.created = fixed
    wb.properties.modified = fixed
    thin = Side(style="thin")
    box = Border(left=thin, right=thin, top=thin, bottom=thin)
    fill = PatternFill("solid", fgColor="DDEBF7")
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)

    title = f"【架空】{cfg['title']}"
    subject = f"{fl} {year_label(fy, 'long')} 定期整備工事"
    term = f"{date_text(s0, date_style)} 〜 {date_text(e0, date_style)}（{span}日間）"
    facility = world["facility"]["name"].removeprefix("【架空】")

    truth_rows, r, no = [], 0, 0
    page_of_row = {}
    for page in range(1, n_pages + 1):
        top = r + 1
        ws.cell(top, 1, title + (CONT if page > 1 else "")).font = Font(bold=True, size=14)
        ws.merge_cells(start_row=top, start_column=1, end_row=top, end_column=6)
        head = [("施設", f"【架空】{facility}"), ("件名", subject), ("工期", term), ("施工者", maker),
                ("頁", f"{page} / {n_pages}")]
        for k, (lab, val) in enumerate(head, 1):
            ws.cell(top + k, 1, lab).font = Font(bold=True)
            ws.cell(top + k, 2, val)
            ws.merge_cells(start_row=top + k, start_column=2, end_row=top + k, end_column=6)
        hr = top + len(head) + 1
        for c, h in enumerate(HEADER, 1):
            cell = ws.cell(hr, c, h)
            cell.font, cell.fill, cell.alignment, cell.border = Font(bold=True), fill, center, box
        r = hr
        for grp in rows[(page - 1) * per_page: page * per_page]:
            r += 1
            no += 1
            w0 = grp[0]
            label = cfg["report_labels"].get(w0["pattern"], w0["label"])
            names = "・".join(ledger_name(eq[w["equipment_id"]], rules) for w in grp)
            if len(grp) > 1:
                names += "（一式）"
            md = sum(w["man_days"] for w in grp)
            style = rng.choice(EFFORT_STYLES)
            raw = effort_text(md, style, hours)
            ds, de = date.fromisoformat(w0["start"]), date.fromisoformat(w0["end"])
            vals = [no, names, label, f"{date_text(ds, date_style)}〜{date_text(de, date_style)}",
                    w0["duration_days"], raw]
            for c, v in enumerate(vals, 1):
                cell = ws.cell(r, c, v)
                cell.border = box
                cell.alignment = Alignment(wrap_text=True, vertical="center",
                                           horizontal="center" if c in (1, 5, 6) else None)
            truth_rows.append({
                "no": no, "xlsx_row": r, "page": page, "work_ids": [w["id"] for w in grp],
                "equipment_ids": [w["equipment_id"] for w in grp], "bundle": len(grp) > 1,
                "pattern": w0["pattern"], "precision": w0["tag"] == "PRECISION",
                "equipment_text": names, "label_text": label, "effort_text": raw, "effort_style": style,
                "man_days": md, "duration_days": w0["duration_days"],
                "start": w0["start"], "end": w0["end"],
            })
            page_of_row[r] = page
        if page < n_pages:
            ws.row_breaks.append(Break(id=r))
            r += 0
    # 合計：最後の頁。数の値で書く
    r += 1
    total_md = sum(x["man_days"] for x in truth_rows)
    ws.cell(r, 1, "合 計")
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)
    ws.cell(r, 5, span)
    ws.cell(r, 6, total_md)
    ws.cell(r, 6).number_format = '0"人・日"'
    for c in range(1, 7):
        cell = ws.cell(r, c)
        cell.font, cell.border = Font(bold=True), box
        cell.alignment = center
    total_row = r
    r += 2
    ws.cell(r, 1, "以上")

    for col, wd in zip("ABCDEF", (6, 44, 26, 38, 7, 12)):
        ws.column_dimensions[col].width = wd
    ws.page_setup.paperSize = 9
    ws.page_setup.orientation = "landscape"
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_area = f"A1:F{r}"

    xlsx.parent.mkdir(parents=True, exist_ok=True)
    wb.save(xlsx)
    rewrite_zip_fixed(xlsx)
    return {
        "id": f"R-F{furnace}-FY{fy}",
        "file_xlsx": rel_xlsx,
        "file_pdf": rel_xlsx.removesuffix(".xlsx") + ".pdf",
        "furnace": furnace, "fiscal_year": fy,
        "title": title, "title_cell": "A1", "continued_mark": CONT,
        "subject": subject, "term_text": term, "term_days": span,
        "pages": n_pages, "rows_per_page": per_page,
        "rows": truth_rows,
        "total": {"row": total_row, "man_days_cell": f"F{total_row}", "man_days": total_md, "days_cell": f"E{total_row}",
                  "days": span, "meaning": "合計の工数（人・日）は数の値。日数は工期の日数"},
    }


def write_reports(world: dict, outdir: Path, subdir: str = "reports") -> dict:
    reports = []
    for (furnace, fy), works in report_groups(world).items():
        name = f"report-f{furnace}-fy{fy}.xlsx"
        reports.append(write_report(world, furnace, fy, works, outdir / subdir / name, f"{subdir}/{name}"))
    return {"schema": "moyai.factory.truth.reports/0", "dir": subdir, "reports": reports}
