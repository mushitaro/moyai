"""書いた xlsx を openpyxl で読み直し、原本の事実（物差し ①の材料）を取る。"""
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter


def read_facts(path: Path, file_name: str) -> dict:
    wb = load_workbook(path)
    sheets = []
    for ws in wb.worksheets:
        cells = []
        for row in ws.iter_rows():
            for c in row:
                if c.value is None:
                    continue
                cells.append({"coord": c.coordinate, "value": c.value, "data_type": c.data_type,
                              "number_format": c.number_format})
        hidden_rows = sorted(r for r, d in ws.row_dimensions.items() if d.hidden)
        hidden_cols = sorted(
            get_column_letter(i)
            for d in ws.column_dimensions.values() if d.hidden
            for i in range(d.min or 1, (d.max or d.min or 1) + 1))
        sheets.append({
            "title": ws.title,
            "state": ws.sheet_state,
            "cells": cells,
            "merged": sorted(str(m) for m in ws.merged_cells.ranges),
            "hidden_rows": hidden_rows,
            "hidden_cols": hidden_cols,
        })
    return {"schema": "moyai.factory.facts/0", "file": file_name, "reader": "openpyxl 3.1.5",
            "creator": wb.properties.creator, "sheets": sheets}
