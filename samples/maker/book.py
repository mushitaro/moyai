"""Excel を書く道具と、ファイルごとの正解（answer/files/<stem>.json）と証拠（gen/evidence/<stem>.json）。

証拠は、正解の値が書いてあるセルの番地と値の組。check.py が開き直して照らす。
"""
from __future__ import annotations

import datetime as dt

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from .util import FAKE, norm

THIN = Side(style="thin", color="808080")
HAIR = Side(style="hair", color="A0A0A0")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
FONT = "ＭＳ Ｐゴシック"


def addr(r, c):
    return f"{get_column_letter(c)}{r}"


class Answer:
    """1 ファイルの正解と証拠。"""

    def __init__(self, file: str, plan: bool):
        self.file = file
        self.plan = plan
        self.records = []
        self.evidence = []
        self.extra = {}

    def rec(self, kind, fields=None, ev=None, **loc):
        rec = {**loc, "kind": kind, "fields": fields or {}}
        self.records.append(rec)
        self.evidence.append({**loc, "cells": ev or []})
        return rec

    def _order(self):
        sheets = {}
        for rec in self.records:
            sheets.setdefault(rec.get("sheet") or rec.get("image") or "", len(sheets))
        idx = list(range(len(self.records)))
        idx.sort(key=lambda i: (sheets[self.records[i].get("sheet") or self.records[i].get("image") or ""],
                                self.records[i].get("r", self.records[i].get("seq", 0))))
        return idx

    def dump(self):
        return {"file": self.file, "plan": self.plan, "records": [self.records[i] for i in self._order()]}

    def dump_evidence(self):
        return {"file": self.file, "evidence": [self.evidence[i] for i in self._order()], **self.extra}


class Book:
    def __init__(self, title: str, creator: str):
        self.wb = Workbook()
        self.wb.remove(self.wb.active)
        self.wb.properties.creator = creator
        self.wb.properties.lastModifiedBy = creator
        self.wb.properties.title = title
        # 作った日時を固定する（同じ命令で同じバイト列に近づける）
        self.wb.properties.created = dt.datetime(2025, 12, 12, 9, 0, 0)
        self.wb.properties.modified = dt.datetime(2025, 12, 12, 9, 0, 0)

    def sheet(self, name):
        return Sheet(self.wb.create_sheet(name))

    def save(self, path):
        """保存する。zip の中の時刻と作った日時を固定し、同じ命令で同じバイト列にする。"""
        import io
        import re
        import zipfile

        path.parent.mkdir(parents=True, exist_ok=True)
        buf = io.BytesIO()
        self.wb.save(buf)
        src = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for info in src.infolist():
                data = src.read(info.filename)
                if info.filename == "docProps/core.xml":
                    data = re.sub(rb"(<dcterms:(created|modified)[^>]*>)[^<]*", rb"\g<1>2025-12-12T09:00:00Z", data)
                zi = zipfile.ZipInfo(info.filename, date_time=(2025, 12, 12, 9, 0, 0))
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = 0o600 << 16
                z.writestr(zi, data)
        path.write_bytes(out.getvalue())


class Sheet:
    def __init__(self, ws):
        self.ws = ws
        self.title = ws.title

    def put(self, r, c, v, bold=False, size=10, fill=None, align=None, wrap=False, indent=0, box=False, fmt=None, color=None):
        cell = self.ws.cell(row=r, column=c, value=v)
        cell.font = Font(name=FONT, size=size, bold=bold, color=color)
        if fill:
            cell.fill = PatternFill("solid", fgColor=fill)
        if align or wrap or indent:
            cell.alignment = Alignment(horizontal=align, vertical="center", wrap_text=wrap, indent=indent)
        if box:
            cell.border = BOX
        if fmt:
            cell.number_format = fmt
        elif isinstance(v, (dt.date, dt.datetime)):
            cell.number_format = "yyyy/m/d"
        return addr(r, c)

    def memo(self, r, c, text, author="保全係"):
        cm = Comment(text, author)
        cm.width = 220
        cm.height = 60
        self.ws.cell(row=r, column=c).comment = cm
        return addr(r, c)

    def merge(self, r1, c1, r2, c2):
        self.ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)

    def width(self, c, w):
        self.ws.column_dimensions[get_column_letter(c)].width = w

    def hide_col(self, c):
        self.ws.column_dimensions[get_column_letter(c)].hidden = True

    def group_row(self, r, level):
        if level > 0:
            self.ws.row_dimensions[r].outlineLevel = min(level, 7)

    def boxes(self, r1, c1, r2, c2):
        for r in range(r1, r2 + 1):
            for c in range(c1, c2 + 1):
                self.ws.cell(row=r, column=c).border = BOX


def ev(a, v):
    return [a, v if not isinstance(v, (dt.date, dt.datetime)) else v.strftime("%Y-%m-%d")]


def same(cell_value, expected) -> bool:
    return norm(cell_value) == norm(expected)


__all__ = ["Answer", "Book", "Sheet", "ev", "addr", "same", "FAKE"]
