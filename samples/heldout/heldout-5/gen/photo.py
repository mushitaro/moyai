# -*- coding: utf-8 -*-
"""紙の点検表・帳票を「撮った写真」にする。

印刷の部分は reportlab で PDF に描き、pypdfium2 で画像にし、Pillow で
手書きの書き込み（数・チェック・丸・メモ）と、傾き・影・ぼけ・明るさのむら・紙の折れを足す。
"""
import io
import math
import os

import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from common import HAND_FONT_PATH, TMP, ensure, rng
from pdfkit import new_canvas, table, text

PT_W, PT_H = 842, 595          # A4 横
SCALE = 2.4


def _form_pdf(path, title, sub, cols, grid, widths, x0, ytop, row_h, head_h, note_h, stamp_names, fixed_cols):
    c, (W, H) = new_canvas(path, title, title, land=True)
    text(c, x0, H - 40, title, 14)
    text(c, x0, H - 60, sub, 10)
    # 押印の欄
    bx = W - 30 - 60 * len(stamp_names)
    for i, nm in enumerate(stamp_names):
        c.rect(bx + 60 * i, H - 75, 60, 50)
        c.line(bx + 60 * i, H - 40, bx + 60 * (i + 1), H - 40)
        text(c, bx + 60 * i + 30, H - 36, nm, 8, "center")
    head = [cols]
    body = [[r[k] if k < fixed_cols else None for k in range(len(cols))] for r in grid]
    # 見出しは 2 行の高さ
    y = table(c, x0, ytop, widths, head, row_h=head_h, size=9, head_rows=1)
    y = table(c, x0, y, widths, body, row_h=row_h, size=9, aligns=["left"] * len(cols), head_rows=0)
    c.rect(x0, y - 8 - note_h, sum(widths), note_h)
    text(c, x0 + 4, y - 22, "特記事項・処置", 9)
    text(c, x0, 22, "※異常があれば班長に報告し、特記事項に処置を書くこと。　様式 点-12（架空）", 7)
    c.showPage()
    c.save()
    return y


def make_checksheet_photo(out, title, sub, cols, grid, note, hidden, seed, stamp_names, fixed_cols=3,
                          widths=None, fill=None):
    R = rng(seed)
    x0, ytop = 30, PT_H - 90
    if widths is None:
        widths = [120, 72, 82] + [70] * (len(cols) - 3)
    row_h, head_h, note_h = 26, 30, 62
    tmp_pdf = os.path.join(TMP, "photo-src", os.path.basename(out).replace(".jpg", ".pdf"))
    ensure(tmp_pdf)
    ybot = _form_pdf(tmp_pdf, title, sub, cols, grid, widths, x0, ytop, row_h, head_h, note_h, stamp_names, fixed_cols)
    pdf = pdfium.PdfDocument(tmp_pdf)
    img = pdf[0].render(scale=SCALE).to_pil().convert("RGB")
    pdf.close()
    d = ImageDraw.Draw(img)
    hf = ImageFont.truetype(HAND_FONT_PATH, int(11.5 * SCALE))
    hf_small = ImageFont.truetype(HAND_FONT_PATH, int(9.5 * SCALE))
    ink = (28, 40, 110)

    def cell_box(i, j):
        x = x0 + sum(widths[:j])
        yt = PT_H - ytop + head_h + i * row_h
        return (x * SCALE, yt * SCALE, (x + widths[j]) * SCALE, (yt + row_h) * SCALE)

    def check(box):
        x1, y1, x2, y2 = box
        cx, cy = (x1 + x2) / 2 + R.uniform(-8, 8), (y1 + y2) / 2 + R.uniform(-4, 4)
        s = (y2 - y1) * 0.32
        pts = [(cx - s, cy), (cx - s * 0.3, cy + s * 0.8), (cx + s * 1.2, cy - s * 0.9)]
        d.line(pts, fill=ink, width=4, joint="curve")

    def hand(box, s, font=hf):
        x1, y1, x2, y2 = box
        tw = d.textlength(s, font=font)
        x = (x1 + x2) / 2 - tw / 2 + R.uniform(-6, 6)
        y = (y1 + y2) / 2 - font.size * 0.6 + R.uniform(-3, 3)
        # 1 文字ずつ少し揺らす
        for ch in s:
            d.text((x, y + R.uniform(-2, 2)), ch, font=font, fill=ink)
            x += d.textlength(ch, font=font) + R.uniform(-1, 1.5)

    for i, row in enumerate(grid):
        for j in range(fixed_cols, len(cols)):
            v = row[j]
            box = cell_box(i, j)
            if v in (None, ""):
                continue
            if v == "✓":
                check(box)
            else:
                hand(box, v)
                if fill and (i, j) in fill:
                    x1, y1, x2, y2 = box
                    d.ellipse((x1 + 8, y1 + 4, x2 - 8, y2 - 4), outline=(170, 20, 20), width=3)
    # 特記事項の書き込み
    ny = (PT_H - ybot + 8 + 18) * SCALE
    nx = (x0 + 90) * SCALE
    for k, part in enumerate(note.split("\n")):
        hand((nx, ny + k * 34, nx + d.textlength(part, font=hf_small) + 20, ny + k * 34 + 30), part, hf_small)
    # 押印（丸の判）
    bx = PT_W - 30 - 60 * len(stamp_names)
    for k, nm in enumerate(stamp_names):
        cx = (bx + 60 * k + 30) * SCALE
        cy = 57.5 * SCALE
        r = 17 * SCALE * 0.9
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(190, 30, 30), width=4)
        sfont = ImageFont.truetype(HAND_FONT_PATH, int(8 * SCALE))
        sname = ["杉", "岡"][k % 2]
        tw = d.textlength(sname, font=sfont)
        d.text((cx - tw / 2, cy - sfont.size * 0.6), sname, font=sfont, fill=(190, 30, 30))

    # 読めなくするセル：指の影とぼけ
    for (i, j) in hidden:
        x1, y1, x2, y2 = cell_box(i, j)
        pad = 10
        reg = (int(x1 - pad), int(y1 - pad), int(x2 + pad), int(y2 + pad))
        crop = img.crop(reg).filter(ImageFilter.GaussianBlur(9))
        img.paste(crop, reg[:2])
        sh = Image.new("L", img.size, 0)
        sd = ImageDraw.Draw(sh)
        sd.ellipse((x1 - 30, y1 - 18, x2 + 30, y2 + 18), fill=175)
        sh = sh.filter(ImageFilter.GaussianBlur(14))
        dark = Image.new("RGB", img.size, (35, 32, 30))
        img = Image.composite(dark, img, sh)
        d = ImageDraw.Draw(img)

    # 紙の折れ（縦に 1 本）
    W0, H0 = img.size
    fx = int(W0 * R.uniform(0.55, 0.65))
    fold = Image.new("L", img.size, 0)
    fd = ImageDraw.Draw(fold)
    fd.line([(fx, 0), (fx + 12, H0)], fill=90, width=6)
    fold = fold.filter(ImageFilter.GaussianBlur(5))
    img = Image.composite(Image.new("RGB", img.size, (120, 120, 120)), img, fold)

    # 傾けて机の上に置く
    ang = R.choice([-1, 1]) * R.uniform(3.5, 6.0)
    desk = (92, 84, 74)
    big = Image.new("RGB", (int(W0 * 1.12), int(H0 * 1.16)), desk)
    big.paste(img, (int(W0 * 0.06), int(H0 * 0.08)))
    big = big.rotate(ang, resample=Image.BICUBIC, expand=False, fillcolor=desk)
    # 明るさのむら（左上が明るく、右下が暗い）と影
    small = Image.new("L", (32, 32), 0)
    spx = small.load()
    for yy in range(32):
        for xx in range(32):
            spx[xx, yy] = int(70 * ((xx / 31) * 0.6 + (yy / 31) * 0.7))
    grad = small.resize(big.size, Image.BILINEAR)
    big = Image.composite(Image.new("RGB", big.size, (20, 18, 16)), big, grad)
    # 全体のぼけ
    big = big.filter(ImageFilter.GaussianBlur(1.1))
    # 縮めて大きさを合わせる（長い辺 1,900px）
    sc = 1900 / max(big.size)
    big = big.resize((int(big.size[0] * sc), int(big.size[1] * sc)), Image.LANCZOS)
    # 100KB 前後になる品質を探す
    best = None
    for q in range(80, 20, -4):
        buf = io.BytesIO()
        big.save(buf, "JPEG", quality=q, optimize=True)
        n = buf.tell()
        best = (q, buf.getvalue())
        if n <= 140_000:
            break
    ensure(out)
    with open(out, "wb") as f:
        f.write(best[1])
    return dict(size=big.size, bytes=len(best[1]), quality=best[0], angle=round(ang, 2))
