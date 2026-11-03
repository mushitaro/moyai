"""見ていない様式の原本の事実（物差し ①）：MOYAI とは別の読み手で、組の資料を読み直す。

- xlsx：openpyxl で、値・表示形式・結合・隠した行と列・シートの表示の状態。日付と時刻の値は、Excel の通し番号に直す
  （MOYAI の読み手は、日付のセルの値を通し番号で持つため）。
- CSV：Python の csv で、書き手が正解（truth.json の files）に書いた文字コードと区切りで読み、記録の始まりの物理の行の番号と欄。
- PDF と写真は作らない（PDF は、xlsx から書き出したものなら、その xlsx と比べる）。

使い方：python -I -X utf8 scripts/heldout/facts.py <組のフォルダ>
出すもの：<組のフォルダ>/measured/facts/<資料の名前>.facts.json
"""

import csv
import datetime as dt
import io
import json
import sys
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter


def serial(v, epoch1904: bool):
    base = dt.datetime(1904, 1, 1) if epoch1904 else dt.datetime(1899, 12, 30)
    if isinstance(v, dt.datetime):
        d = v - base
        return d.days + d.seconds / 86400 + d.microseconds / 86400e6
    if isinstance(v, dt.date):
        return (dt.datetime(v.year, v.month, v.day) - base).days
    if isinstance(v, dt.time):
        return (v.hour * 3600 + v.minute * 60 + v.second + v.microsecond / 1e6) / 86400
    if isinstance(v, dt.timedelta):
        return v.total_seconds() / 86400
    return v


def xlsx_facts(path: Path, name: str) -> dict:
    wb = load_workbook(path)
    e1904 = bool(getattr(wb, "epoch", None) == dt.datetime(1904, 1, 1)) or bool(getattr(wb.properties, "date1904", False))
    sheets = []
    for ws in wb.worksheets:
        cells = []
        for row in ws.iter_rows():
            for c in row:
                if c.value is None:
                    continue
                cells.append({"coord": c.coordinate, "value": serial(c.value, e1904), "data_type": c.data_type, "number_format": c.number_format})
        hidden_rows = sorted(r for r, d in ws.row_dimensions.items() if d.hidden)
        hidden_cols = sorted(
            get_column_letter(i) for d in ws.column_dimensions.values() if d.hidden for i in range(d.min or 1, (d.max or d.min or 1) + 1)
        )
        sheets.append({
            "title": ws.title,
            "state": ws.sheet_state,
            "cells": cells,
            "merged": sorted(str(m) for m in ws.merged_cells.ranges),
            "hidden_rows": hidden_rows,
            "hidden_cols": hidden_cols,
        })
    import openpyxl

    return {"schema": "moyai.factory.facts/0", "file": name, "reader": f"openpyxl {openpyxl.__version__}", "creator": wb.properties.creator, "sheets": sheets}


def csv_facts(path: Path, name: str, encoding: str, delimiter: str) -> dict:
    text = path.read_bytes().decode(encoding)
    if text.startswith("﻿"):
        text = text[1:]
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, quotechar='"')
    records = []
    end = 0
    for fields in reader:
        records.append({"line": end + 1, "fields": fields})
        end = reader.line_num
    return {"schema": "moyai.factory.facts.csv/0", "file": name, "reader": f"python {sys.version.split()[0]} csv", "encoding": encoding, "delimiter": delimiter, "records": records}


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    root = Path(sys.argv[1])
    truth = json.loads((root / "truth.json").read_text(encoding="utf-8"))
    out = root / "measured" / "facts"
    out.mkdir(parents=True, exist_ok=True)
    for f in truth["files"]:
        src = root / "files" / f["file"]
        if f["format"] == "xlsx":
            d = xlsx_facts(src, f["file"])
        elif f["format"] == "csv":
            d = csv_facts(src, f["file"], f.get("encoding") or "utf-8", f.get("delimiter") or ",")
        else:
            continue
        p = out / (f["file"].replace("/", "__") + ".facts.json")
        p.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
        print(f"{f['file']}：事実を書いた（{p.name}）")


if __name__ == "__main__":
    main()
