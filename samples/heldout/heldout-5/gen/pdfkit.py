# -*- coding: utf-8 -*-
"""reportlab で罫線の表を描く小さな部品（文字のある PDF）。"""
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from common import FONT_PATH, ensure

FONT = "NotoJP"
_registered = False


def font():
    global _registered
    if not _registered:
        pdfmetrics.registerFont(TTFont(FONT, FONT_PATH))
        _registered = True
    return FONT


def new_canvas(path, title, author, land=False):
    font()
    ensure(path)
    size = landscape(A4) if land else A4
    c = canvas.Canvas(path, pagesize=size, invariant=1)
    c.setTitle(title)
    c.setAuthor(author)
    c.setCreator(author)
    c.setSubject(title)
    return c, size


def text(c, x, y, s, size=9, align="left"):
    c.setFont(FONT, size)
    if align == "left":
        c.drawString(x, y, s)
    elif align == "center":
        c.drawCentredString(x, y, s)
    else:
        c.drawRightString(x, y, s)


def fit(s, width, size):
    """幅に収まるまで文字を小さくする（最小 5pt）。"""
    while size > 5 and pdfmetrics.stringWidth(s, FONT, size) > width - 4:
        size -= 0.5
    return size


def table(c, x, ytop, widths, rows, row_h=16, size=8.5, aligns=None, head_rows=0, shade_head=True):
    """行の並びを罫線の表で描く。rows は文字の並びの並び（None は空）。返り値は表の下の y。"""
    total = sum(widths)
    y = ytop
    for i, row in enumerate(rows):
        if i < head_rows and shade_head:
            c.setFillGray(0.88)
            c.rect(x, y - row_h, total, row_h, stroke=0, fill=1)
            c.setFillGray(0)
        cx = x
        for j, w in enumerate(widths):
            v = row[j] if j < len(row) else None
            if v not in (None, ""):
                s = str(v)
                lines = s.split("\n")
                fs = min(fit(l, w, size) for l in lines)
                al = (aligns[j] if aligns else "left") if i >= head_rows else "center"
                n = len(lines)
                for k, l in enumerate(lines):
                    ty = y - row_h / 2 - fs * 0.35 + (n - 1) * fs * 0.55 - k * fs * 1.1
                    if al == "left":
                        text(c, cx + 3, ty, l, fs)
                    elif al == "right":
                        text(c, cx + w - 3, ty, l, fs, "right")
                    else:
                        text(c, cx + w / 2, ty, l, fs, "center")
            cx += w
        y -= row_h
    # 罫線
    c.setLineWidth(0.6)
    c.rect(x, y, total, ytop - y)
    for i in range(1, len(rows)):
        lw = 1.0 if i == head_rows else 0.4
        c.setLineWidth(lw)
        c.line(x, ytop - i * row_h, x + total, ytop - i * row_h)
    cx = x
    c.setLineWidth(0.4)
    for w in widths[:-1]:
        cx += w
        c.line(cx, ytop, cx, y)
    return y
