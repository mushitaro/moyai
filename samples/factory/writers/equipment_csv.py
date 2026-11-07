"""業務の仕組みから書き出した設備機器の一覧（CSV）を書く。
1 行目は題と抽出の条件（題・出力日時・対象）、2 行目が列の見出し、3 行目から機器。発注明細の一覧（orders_csv.py）とは
文字コード（Shift_JIS）・表の形（機器の表）・列の並びが違う（題の行の読み方を、性質の違う 2 つのファイルで確かめる材料）。"""
import csv
import io
from pathlib import Path

from writers.names import tag_text


def write_equipment_list(world: dict, cfg: dict, out_dir: Path) -> dict:
    """cfg は world/exports-*.json の equipment_list。out_dir の下に cfg["file"] を書き、正解を返す。"""
    lines = [
        [cfg["title"], f"出力日時：{cfg['extracted_at']}", f"対象：{cfg['scope']}"],
        list(cfg["columns"]),
    ]
    rows = []
    for e in sorted(world["equipment"], key=lambda x: x["id"]):
        furnace = e["furnace_label"] if e["furnace"] is not None else "共通"
        lines.append([tag_text(e, world["rules"]) or "", e["base_name"], e["system"], furnace, str(e["install_year"]), " ".join(e["spec"])])
        rows.append({"line": len(lines), "equipment_id": e["id"]})
    buf = io.StringIO(newline="")
    csv.writer(buf, lineterminator="\r\n").writerows(lines)
    path = out_dir / cfg["file"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(buf.getvalue().encode(cfg["encoding"]))
    return {
        "schema": "moyai.factory.truth.equipment-list/0",
        "file": cfg["file"],
        "encoding": cfg["encoding"],
        "newline": "CRLF",
        "title_line": 1,
        "header_line": 2,
        "first_data_line": 3,
        "columns": list(cfg["columns"]),
        "note": "1 行目は題と抽出の条件（見出しではない）。2 行目が列の見出し",
        "rows": rows,
    }
