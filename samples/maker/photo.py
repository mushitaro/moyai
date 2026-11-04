"""日常点検表を撮った写真の書き手。

同じ正解の世界から点検表の頁（PDF）を作り、画像にして、手書きのチェック・丸・数・署名を足し、
傾き・影・ぼけ・明るさのむら・紙の折れを足す。影やぼけで読めなくしたセルは、正解に「読めない」と書く。
PDF は途中のもので、写真だけを files/ に置く。
"""
from __future__ import annotations

import datetime as dt
import io
import math

import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from .book import Answer
from .specpdf import font
from .util import FAKE, rng_for, wareki_full

HAND_FONTS = ["C:/Windows/Fonts/NotoSerifJP-VF.ttf", "C:/Windows/Fonts/YuGothL.ttc", "C:/Windows/Fonts/meiryo.ttc"]
SCALE = 2.6  # PDF の点 → 画素


def _hand_font(size):
    for p in HAND_FONTS:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _items(W, doc):
    out = []
    for spec in doc["items"]:
        key, item, std, kind = spec[:4]
        only = spec[4] if len(spec) > 4 else None
        if key not in W.cat or not W.applies(W.cat[key]):
            continue
        for u in W.units_of(key):
            if only and u["id"] not in only:
                continue
            lab = W.cat[key]["chart"][0]
            if u["furnace"] and W.F > 1:
                lab = f"{u['furnace']}号炉 " + lab
            if u["unit"]:
                lab += f" No.{u['unit']}"
            out.append({"asset": u["id"], "label": lab, "item": item, "std": std, "kind": kind})
    return out[: doc.get("maxRows", 16)]


def _paper(W, doc, week, items, who):
    """点検表の頁（PDF のバイト列）と、セルの矩形（PDF の点、左下が原点）。"""
    fn = font()
    buf = io.BytesIO()
    pw, ph = A4
    c = canvas.Canvas(buf, pagesize=A4, invariant=1)
    c.setFont(fn, 15)
    c.drawString(40, ph - 52, f"{W.fac['name']}（架空）　{doc.get('title', '日常点検表')}")
    c.setFont(fn, 9)
    c.drawString(40, ph - 68, f"{FAKE}施設・機器・人名はすべて架空です。　判定：良はチェック、否は ×（測定値は数値を記入）")
    c.drawString(40, ph - 84, f"週：{wareki_full(week)} ～ {wareki_full(week + dt.timedelta(days=5))}")
    days = [week + dt.timedelta(days=i) for i in range(6)]
    cols = [("機器", 128), ("点検項目", 78), ("基準", 76)] + [(f"{x.month}/{x.day}", 38) for x in days]
    x0, y0 = 40, ph - 110
    rh = 22
    cells = {}
    x = x0
    c.setFont(fn, 8.5)
    for name, wdt in cols:
        c.rect(x, y0 - rh, wdt, rh)
        c.drawCentredString(x + wdt / 2, y0 - rh + 7, name)
        x += wdt
    for i, it in enumerate(items):
        y = y0 - rh * (i + 2)
        x = x0
        for j, (name, wdt) in enumerate(cols):
            c.rect(x, y, wdt, rh)
            if j == 0:
                c.drawString(x + 3, y + 7, it["label"])
            elif j == 1:
                c.drawString(x + 3, y + 7, it["item"])
            elif j == 2:
                c.drawString(x + 3, y + 7, it["std"])
            else:
                cells[(i, j - 3)] = (x, y, wdt, rh)
            x += wdt
    # 点検者の欄
    y = y0 - rh * (len(items) + 2)
    x = x0
    c.rect(x, y, 128 + 78 + 76, rh)
    c.drawString(x + 3, y + 7, "点検者（印）")
    x += 128 + 78 + 76
    for k in range(6):
        c.rect(x, y, 38, rh)
        cells[("who", k)] = (x, y, 38, rh)
        x += 38
    c.drawString(40, y - 24, "異常時は所見を裏面に記入し、保全係へ連絡すること。")
    c.showPage()
    c.save()
    return buf.getvalue(), cells, days, ph


def write_photos(W, doc, outdir, answers, _):
    items = _items(W, doc)
    for n, week in enumerate(doc["weeks"]):
        week = dt.date.fromisoformat(week)
        r = rng_for(W.seed, "photo", n)
        who = [r.choice(["高瀬", "沖野", "葉山", "柚木"]) for _ in range(6)]
        pdf, cells, days, ph = _paper(W, doc, week, items, who)
        page = pdfium.PdfDocument(pdf)[0]
        img = page.render(scale=SCALE).to_pil().convert("RGB")
        H = img.height
        dr = ImageDraw.Draw(img)
        hf = _hand_font(int(13 * SCALE))
        values = {}

        def box(cell):
            x, y, w, h = cell
            return (x * SCALE, H - (y + h) * SCALE, (x + w) * SCALE, H - y * SCALE)

        ink = (35, 45, 110)
        for (i, k), cell in cells.items():
            if i == "who":
                continue
            it = items[i]
            if days[k] > W.today:
                continue
            x1, y1, x2, y2 = box(cell)
            cx, cy = (x1 + x2) / 2 + r.uniform(-6, 6), (y1 + y2) / 2 + r.uniform(-4, 4)
            if it["kind"] == "check":
                bad = r.random() < 0.03
                if bad:
                    dr.line([(cx - 12, cy - 12), (cx + 12, cy + 12)], fill=ink, width=4)
                    dr.line([(cx - 12, cy + 12), (cx + 12, cy - 12)], fill=ink, width=4)
                    values[(i, k)] = "×"
                else:
                    pts = [(cx - 14, cy), (cx - 4, cy + 11), (cx + 16, cy - 15)]
                    pts = [(px + r.uniform(-2, 2), py + r.uniform(-2, 2)) for px, py in pts]
                    dr.line(pts, fill=ink, width=4, joint="curve")
                    values[(i, k)] = "✓"
            else:
                lo, hi = it["kind"]
                v = round(r.uniform(lo, hi), 1 if hi < 20 else 0)
                txt = f"{v:g}"
                tb = dr.textbbox((0, 0), txt, font=hf)
                tx = (x1 + x2 - (tb[2] - tb[0])) / 2 + r.uniform(-4, 4)
                ty = (y1 + y2 - (tb[3] - tb[1])) / 2 - tb[1] + r.uniform(-3, 3)
                dr.text((tx, ty), txt, fill=ink, font=hf)
                values[(i, k)] = v
        for k in range(6):
            if days[k] > W.today:
                continue
            x1, y1, x2, y2 = box(cells[("who", k)])
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            rad = 22
            dr.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=(190, 40, 40), width=3)
            sf = _hand_font(int(8 * SCALE))
            dr.text((cx - rad + 6, cy - 12), who[k][:2], fill=(190, 40, 40), font=sf)
            values[("who", k)] = who[k]
        # 読めなくする所（影とぼけ）：いちばん下の 2 行の右の 2 日
        hide = set()
        if doc.get("unreadable", True):
            ri = len(items) - 1 - r.randint(0, 2)
            ks = [4, 5] if r.random() < 0.5 else [3, 4]
            xs = [box(cells[(ri, k)]) for k in ks]
            bx1 = min(b[0] for b in xs) - 8
            by1 = min(b[1] for b in xs) - 8
            bx2 = max(b[2] for b in xs) + 8
            by2 = max(b[3] for b in xs) + 8
            # 濡れた染みとぼけで読めなくする（縁はなだらか）
            box_ = (int(bx1), int(by1), int(bx2), int(by2))
            reg = img.crop(box_).filter(ImageFilter.GaussianBlur(10))
            reg = Image.blend(reg, Image.new("RGB", reg.size, (120, 110, 95)), 0.55)
            mk = Image.new("L", reg.size, 0)
            ImageDraw.Draw(mk).ellipse([0, 0, reg.size[0], reg.size[1]], fill=255)
            mk = mk.filter(ImageFilter.GaussianBlur(6))
            img.paste(reg, box_[:2], mk)
            for k in ks:
                if (ri, k) in values:
                    hide.add((ri, k))
        img = _distort(img, r)
        stem = f"{FAKE}{W.fac['short']}_{doc.get('stem', '日常点検表')}_{week.strftime('%Y%m%d')}"
        fname = stem + ".jpg"
        _save_jpeg(img, outdir / fname)
        ans = Answer(fname, False)
        seq = 0
        for i, it in enumerate(items):
            f = {"週": week, "機器": it["label"], "点検項目": it["item"], "基準": it["std"]}
            for k, day in enumerate(days):
                if (i, k) in values:
                    f[day.isoformat()] = "読めない" if (i, k) in hide else values[(i, k)]
            ans.rec("item", f, [it["label"], it["item"]], seq=seq, image=fname)
            seq += 1
            W.seen_name(it["asset"], fname, it["label"])
        f = {"週": week, "機器": "点検者（印）"}
        for k, day in enumerate(days):
            if ("who", k) in values:
                f[day.isoformat()] = values[("who", k)]
        ans.rec("item", f, ["点検者（印）"], seq=seq, image=fname)
        ans.extra["unreadable"] = [{"row": i, "day": days[k].isoformat()} for i, k in sorted(hide)]
        ans.extra["size"] = list(Image.open(outdir / fname).size)
        answers[fname] = ans


def _distort(img, r):
    w, h = img.size
    # 明るさのむら：片側からなだらかに暗くなる
    g = Image.new("L", (2, 2))
    g.putdata([r.randint(175, 255) for _ in range(4)])
    g = g.resize((w, h), Image.BILINEAR)
    dark = Image.new("RGB", (w, h), (60, 55, 50))
    img = Image.composite(img, dark, g)
    # 撮る人の影（ぼかした塊）
    m = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(m)
    cx, cy = w * r.uniform(0.6, 1.0), h * r.uniform(0.65, 1.0)
    md.ellipse([cx - w * 0.45, cy - h * 0.3, cx + w * 0.45, cy + h * 0.3], fill=110)
    m = m.filter(ImageFilter.GaussianBlur(w * 0.06))
    img = Image.composite(dark, img, m)
    # 紙の折れ（横に 1 本）
    d = ImageDraw.Draw(img)
    fy = int(h * r.uniform(0.42, 0.58))
    dy = r.randint(-15, 15)
    d.line([(0, fy), (w, fy + dy)], fill=(150, 145, 140), width=3)
    d.line([(0, fy + 4), (w, fy + 4 + dy)], fill=(240, 236, 230), width=2)
    # 紙の色
    img = Image.blend(img, Image.new("RGB", (w, h), (238, 230, 214)), 0.10)
    # 傾き（3〜8 度）と机の色
    deg = r.uniform(3, 8) * (1 if r.random() < 0.5 else -1)
    img = img.rotate(deg, resample=Image.BICUBIC, expand=True, fillcolor=(70, 60, 52))
    img = img.filter(ImageFilter.GaussianBlur(r.uniform(0.8, 1.3)))
    img = ImageEnhance.Contrast(img).enhance(r.uniform(0.85, 0.95))
    return img


def _save_jpeg(img, path):
    w, h = img.size
    target = 1800
    s = target / max(w, h)
    img = img.resize((int(w * s), int(h * s)), Image.LANCZOS)
    q = 80
    for _ in range(12):
        b = io.BytesIO()
        img.save(b, "JPEG", quality=q, optimize=True)
        if b.tell() <= 125_000 or q <= 30:
            break
        q -= 6
    path.write_bytes(b.getvalue())
