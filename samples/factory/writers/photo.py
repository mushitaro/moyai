"""報告書の PDF の 1 頁を画像にし、紙を撮った写真のように汚す（傾き・影・ぼけ・手書きの丸とチェック）。
PDF が無いときは作らない（呼び出し側が数える）。"""
import io
import math
import random
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, ImageChops, ImageDraw, ImageFilter

LONG_EDGE = 1800
TARGET_BYTES = 100_000
COMMENT = "【架空】日常点検表の写真（工場 v1）"
ARTIST = "【架空】工場 v1"
INKS = ((25, 40, 150), (170, 30, 30))


def _find(page, text: str):
    """頁の中で text が最初に見つかる場所（点 pt の左・下・右・上）。無ければ None。"""
    tp = page.get_textpage()
    s = tp.search(text)
    hit = s.get_next()
    if not hit:
        return None
    idx, cnt = hit
    boxes = [tp.get_charbox(i) for i in range(idx, idx + cnt)]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def _wobble_circle(draw, box, rng, ink, width):
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2 * 1.25 + 6, (y1 - y0) / 2 * 1.5 + 5
    turns = 1.12
    n = 60
    start = rng.uniform(0, math.tau)
    pts = []
    for k in range(n + 1):
        a = start + turns * math.tau * k / n
        grow = 1 + 0.08 * k / n
        pts.append((cx + rx * grow * math.cos(a) + rng.uniform(-1.5, 1.5),
                    cy + ry * grow * math.sin(a) + rng.uniform(-1.5, 1.5)))
    draw.line(pts, fill=ink, width=width, joint="curve")


def _check(draw, x, y, size, rng, ink, width):
    pts = [(x, y + size * 0.1), (x + size * 0.35, y + size * 0.5), (x + size * 1.0, y - size * 0.45)]
    pts = [(px + rng.uniform(-1, 1), py + rng.uniform(-1, 1)) for px, py in pts]
    draw.line(pts, fill=ink, width=width, joint="curve")


def make_photo(pdf: Path, page_no: int, marks: list[dict], seed: str, out: Path) -> dict:
    """marks: [{"kind": "circle"|"check", "text": 頁の中の文字}]。返すのは、実際に付けた印の正解。"""
    rng = random.Random(seed)
    doc = pdfium.PdfDocument(str(pdf))
    try:
        page = doc[page_no - 1]
        pw, ph = page.get_size()
        scale = 2.4
        img = page.render(scale=scale).to_pil().convert("RGB")
        # 紙の外の余白を落とす（字のある所に少し余白を付ける）
        bbox = ImageChops.invert(img.convert("L")).point(lambda v: 255 if v > 24 else 0).getbbox()
        pad = 40
        crop = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(img.width, bbox[2] + pad), min(img.height, bbox[3] + pad))
        draw = ImageDraw.Draw(img)
        done = []
        # 表の左端（No. の見出しの左）
        left = _find(page, "No.")
        for m in marks:
            hit = _find(page, m["text"])
            if hit is None:
                continue
            x0, y0, x1, y1 = (hit[0] * scale, (ph - hit[3]) * scale, hit[2] * scale, (ph - hit[1]) * scale)
            ink = INKS[rng.randrange(len(INKS))]
            if m["kind"] == "circle":
                _wobble_circle(draw, (x0, y0, x1, y1), rng, ink, 4)
            else:
                lx = (left[0] * scale if left else x0) - 40
                _check(draw, lx, (y0 + y1) / 2, (y1 - y0) * 1.1, rng, ink, 4)
            done.append({"kind": m["kind"], "text": m["text"]})
        sheet = img.crop(crop)
    finally:
        doc.close()

    sw = int(LONG_EDGE * 0.88)
    sheet = sheet.resize((sw, max(1, round(sheet.height * sw / sheet.width))), Image.LANCZOS)
    angle = rng.uniform(1.5, 3.5) * rng.choice((-1, 1))
    # 紙に影（左上から斜めの明るさの違い）をかける
    base = Image.linear_gradient("L")
    gv = base.resize(sheet.size)
    gh = base.transpose(Image.ROTATE_90).resize(sheet.size)
    grad = Image.blend(gv, gh, 0.5)
    if rng.random() < 0.5:
        grad = ImageChops.invert(grad)
    shade = ImageChops.multiply(sheet, Image.merge("RGB", (grad.point(lambda v: 160 + v * 95 // 255),) * 3))
    mask = Image.new("L", shade.size, 255)
    rot = shade.rotate(angle, expand=True, resample=Image.BICUBIC, fillcolor=(0, 0, 0))
    rmask = mask.rotate(angle, expand=True, resample=Image.BICUBIC, fillcolor=0)
    W = LONG_EDGE
    H = rot.height + 160
    desk = Image.new("RGB", (W, H), (96, 84, 72))
    dd = ImageDraw.Draw(desk)
    for y in range(0, H, 6):  # 机の木目の縞
        t = rng.randint(-6, 6)
        dd.line([(0, y), (W, y)], fill=(96 + t, 84 + t, 72 + t), width=3)
    ox, oy = (W - rot.width) // 2, (H - rot.height) // 2
    shadow = Image.new("L", (W, H), 0)
    shadow.paste(rmask.point(lambda v: v * 150 // 255), (ox + 14, oy + 18))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    desk = Image.composite(Image.new("RGB", (W, H), (20, 16, 12)), desk, shadow)
    desk.paste(rot, (ox, oy), rmask)
    # ぼけと、細かい粒
    photo = desk.filter(ImageFilter.GaussianBlur(1.1))
    noise = Image.frombytes("L", (W, H), rng.randbytes(W * H))
    photo = Image.blend(photo, Image.merge("RGB", (noise,) * 3), 0.03)

    exif = Image.Exif()
    exif[315] = "fictional (moyai factory v1)"  # Artist は ASCII だけ。日本語は XPAuthor（UTF-16）に入れる
    exif[0x9C9D] = ARTIST.encode("utf-16-le") + b"\x00\x00"
    exif[270] = COMMENT
    best = None
    lo, hi = 30, 95
    while lo <= hi:
        q = (lo + hi) // 2
        buf = io.BytesIO()
        photo.save(buf, "JPEG", quality=q, optimize=True, exif=exif.tobytes(), comment=COMMENT.encode("utf-8"))
        if len(buf.getvalue()) <= TARGET_BYTES:
            best, lo = (q, buf.getvalue()), q + 1
        else:
            hi = q - 1
    if best is None:
        best = (30, buf.getvalue())
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(best[1])
    return {"width": W, "height": H, "bytes": len(best[1]), "quality": best[0], "angle_deg": round(angle, 2),
            "marks": done, "source_pdf_page": page_no}
