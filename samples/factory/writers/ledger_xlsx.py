"""機器台帳の Excel を書く。段は字下げだけの 1 列で表す。正解（どの行がどの機器か）も返す。"""
from datetime import date, datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

from dirt import date_text, era_year_text
from writers.ioutil import rewrite_zip_fixed
from writers.names import ledger_name

CREATOR = "【架空】工場 v1"
COLUMNS_NUM = ["名称", "番号", "仕様", "設置年", "備考"]
COLUMNS_PLAIN = ["名称", "仕様", "設置年", "備考"]
HEADER_ROW = 4


def _remark(world: dict, e: dict) -> str | None:
    """取替・更新を、その機器の作業から備考に書く。"""
    lines = []
    for w in world["works"]:
        if w["equipment_id"] != e["id"] or w["attr"] not in ("REPLACE", "UPGRADE"):
            continue
        s = date.fromisoformat(w["start"])
        word = w["note_text"] or ("取替" if w["attr"] == "REPLACE" else "更新")
        if w["status"] == "planned":
            lines.append(f"{s.year}年{s.month}月 {word}予定")
        else:
            lines.append(f"{s.year}年{s.month}月 {word}")
    return "\n".join(lines) if lines else None


def _install_text(year: int, style: str):
    if style == "wareki":
        return era_year_text(year)
    return year


def write_ledger(world: dict, path: Path) -> dict:
    rules = world["rules"]
    cfg = rules["ledger"]
    numbering = cfg["numbering"]
    eq = world["equipment"]

    wb = Workbook()
    ws = wb.active
    ws.title = "機器台帳"
    fixed = datetime(2026, 10, 1, 0, 0, 0)
    wb.properties.creator = CREATOR
    wb.properties.lastModifiedBy = None
    wb.properties.created = fixed
    wb.properties.modified = fixed

    ws["A1"] = f"【架空】{world['facility']['name'].removeprefix('【架空】')} 機器台帳"
    ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = f"{date_text(date.fromisoformat(world['today']), 'wareki_kanji')} 時点"

    cols = COLUMNS_NUM if numbering else COLUMNS_PLAIN
    c_name, c_spec = 1, (3 if numbering else 2)
    c_year, c_rem = c_spec + 1, c_spec + 2
    fill = PatternFill("solid", fgColor="DDEBF7")
    for i, h in enumerate(cols, 1):
        c = ws.cell(HEADER_ROW, i, h)
        c.font, c.fill = Font(bold=True), fill
        c.alignment = Alignment(horizontal="center", vertical="center")

    rows = []
    r = HEADER_ROW
    counters: list[int] = []   # 段ごとの通し番号
    prev_path: list[str] = []

    def put(level: int, name: str, kind: str, spec=None, year=None, remark=None, eid=None, key=None):
        nonlocal r
        r += 1
        del counters[level:]
        while len(counters) < level:
            counters.append(0)
        counters[level - 1] += 1
        number = "-".join(str(n) for n in counters[:level])
        ws.cell(r, c_name, name).alignment = Alignment(indent=level - 1, vertical="top")
        if numbering:
            ws.cell(r, 2, number)
        n_lines = 1
        for col, val in ((c_spec, spec), (c_year, year), (c_rem, remark)):
            if val is not None:
                cell = ws.cell(r, col, val)
                cell.alignment = Alignment(wrap_text=True, vertical="top")
                if isinstance(val, str):
                    n_lines = max(n_lines, val.count("\n") + 1)
        if n_lines > 1:
            ws.row_dimensions[r].height = 15 * n_lines
        if kind == "equipment":
            ws.cell(r, c_name).font = Font(bold=False)
        rows.append({"row": r, "level": level, "indent": level - 1, "kind": kind, "name_text": name,
                     "number": number if numbering else None, "equipment_id": eid, "key": key,
                     "spec_text": spec, "install_text": year, "remark_text": remark})

    # 上位の段は、道が変わるところで 1 回だけ書く
    for e in eq:
        for lv, nm in enumerate(e["path"], 1):
            if prev_path[: lv] != e["path"][: lv]:
                put(lv, nm, "group")
        prev_path = e["path"]
        level = len(e["path"]) + 1
        put(level, ledger_name(e, rules), "equipment",
            spec="\n".join(e["spec"] + ([f"{e['furnace_label']}用"] if e["furnace"] else [])) or None,
            year=_install_text(e["install_year"], cfg["install_style"]) if e["install_year"] else None,
            remark=_remark(world, e), eid=e["id"], key=e["code"])
        for p in e["parts"]:
            put(level + 1, p["name"], "part", spec="\n".join(p.get("spec", [])) or None,
                remark=p.get("remark"), eid=e["id"], key=None)

    ws.column_dimensions["A"].width = 38
    if numbering:
        ws.column_dimensions["B"].width = 9
    ws.column_dimensions["C" if numbering else "B"].width = 30
    ws.column_dimensions["D" if numbering else "C"].width = 10
    ws.column_dimensions["E" if numbering else "D"].width = 34
    ws.freeze_panes = ws.cell(HEADER_ROW + 1, 2)

    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    rewrite_zip_fixed(path)

    depth = max(x["level"] for x in rows)
    return {
        "schema": "moyai.factory.truth.ledger/0",
        "file": path.name,
        "sheet": ws.title,
        "title_cell": "A1",
        "header_row": HEADER_ROW,
        "columns": cols,
        "numbering": numbering,
        "depth": depth,
        "first_data_row": HEADER_ROW + 1,
        "last_data_row": r,
        "identity": "equipment_id は world.json の equipment[].id と同じ。code は同じ設備の種類の鍵",
        "rows": rows,
        "equipment_rows": {x["equipment_id"]: x["row"] for x in rows if x["kind"] == "equipment"},
    }
