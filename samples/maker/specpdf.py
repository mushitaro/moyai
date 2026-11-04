"""完成図書 第3編 機器仕様一覧表（文字のある PDF）の書き手。

竣工のときのまま：号炉に分けず数量でまとめ、竣工のあとに足した機器は載らない。
ページをまたぐ表は、ページごとに見出しをくり返す。正解の場所は seq（parent・item・total の行の順）。
"""
from __future__ import annotations

from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from .book import Answer
from .util import FAKE, rng_for, wareki_ym, zen_digits

FONT_PATHS = ["C:/Windows/Fonts/NotoSansJP-VF.ttf", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]
_reg = False


def font():
    global _reg
    if not _reg:
        for p in FONT_PATHS:
            try:
                pdfmetrics.registerFont(TTFont("JP", p))
                _reg = True
                break
            except Exception:
                continue
        if not _reg:
            raise RuntimeError("日本語の書体が見つからない（Noto Sans JP を入れる）")
    return "JP"


def spec_rows(W):
    """数量でまとめた機器の行（設備ごと）。竣工のときにあった機器だけ。"""
    out = []
    no = 0
    sysno = 0
    for s in W.rules["systems"]:
        if not s.get("ledger"):
            continue
        sysno += 1
        tpls = [t for t in W.rules["catalog"] if t["sys"] == s["key"] and W.applies(t) and not t.get("noLedger")]
        rows = []
        for t in tpls:
            units = [a for a in W.units_of(t["key"]) if not a.get("added")]
            if not units:
                continue
            no += 1
            n = len(units)
            nm_ = t["name"]
            sc = W.rules.get("specCount", {})
            unit_word = sc.get("default", "台")
            for w_, sfx in sc.get("bySuffix", {}).items():
                if nm_.endswith(tuple(sfx)):
                    unit_word = w_
            for w_, keys in sc.get("byKey", {}).items():
                if t["key"] in keys:
                    unit_word = w_
            sp = t.get("spec") or {}
            code = f"{t['tag']}-{sysno}{len(rows) + 1:02d}" if t.get("tag") else "—"
            rows.append({"no": no, "code": code, "name": t["name"], "qty": f"{n} {unit_word}", "form": sp.get("form") or "—",
                         "main": sp.get("main") or "—", "kw": sp.get("kw"), "maker": W.vendor(sp.get("maker", "plant")).replace("㈱", "").replace("株式会社", "").replace("(株)", ""),
                         "note": W.text("specPerUnit") + " " + str(t.get("n", 1)) + " " + unit_word if t["scope"] == "furnace" and t.get("n", 1) > 1 else "",
                         "units": [a["id"] for a in units]})
        if rows:
            out.append((s, rows))
    return out


def write_spec_pdf(W, doc, outdir, answers, _):
    fname = f"{FAKE}{W.fac['short']}_完成図書_第3編_機器仕様一覧表.pdf"
    ans = Answer(fname, False)
    r = rng_for(W.seed, "spec")
    fn = font()
    path = outdir / fname
    c = canvas.Canvas(str(path), pagesize=landscape(A4), invariant=1)
    c.setTitle(f"{FAKE}{W.fac['name']} 完成図書 第3編 機器仕様一覧表")
    c.setAuthor(f"{FAKE}{W.vendor('plant')}（架空）")
    c.setSubject("架空のデータ")
    pw, ph = landscape(A4)
    com = W.prof["commissioned"]
    # 表紙
    c.setFont(fn, 22)
    c.drawCentredString(pw / 2, ph - 170, f"{W.fac['name']}（架空）")
    c.setFont(fn, 30)
    c.drawCentredString(pw / 2, ph - 240, "完 成 図 書")
    c.setFont(fn, 20)
    c.drawCentredString(pw / 2, ph - 290, "第3編　機器仕様一覧表")
    c.setFont(fn, 14)
    c.drawCentredString(pw / 2, ph - 360, wareki_ym(com, 3))
    c.drawCentredString(pw / 2, ph - 390, W.vendor("plant").replace("㈱", "株式会社"))
    c.setFont(fn, 11)
    c.drawCentredString(pw / 2, 60, f"{FAKE}施設・機器・製作者はすべて架空です。")
    c.showPage()
    data = spec_rows(W)
    cols = [("No.", 32), ("機器番号", 60), ("機器名称", 150), ("数量", 46), ("形式", 132), ("主要仕様", 142), ("電動機(kW)", 56), ("製作者", 86), ("備考", 76)]
    x0 = 30
    lh = 17
    page = [1]
    seq = [0]
    y = [0]

    def header():
        page[0] += 1
        c.setFont(fn, 9)
        c.drawString(x0, ph - 30, f"{W.fac['name']}（架空）　完成図書　第3編 機器仕様一覧表")
        c.drawRightString(pw - x0, ph - 30, f"3-{page[0] - 1}")
        c.drawString(x0, ph - 44, FAKE)
        yy = ph - 70
        x = x0
        c.setFont(fn, 9)
        for name, wdt in cols:
            c.rect(x, yy - 4, wdt, lh, stroke=1, fill=0)
            c.drawCentredString(x + wdt / 2, yy + 1, name)
            x += wdt
        y[0] = yy - lh

    def line(vals, bold=False):
        if y[0] < 50:
            c.showPage()
            header()
        x = x0
        c.setFont(fn, 8.5 if not bold else 9.5)
        for (name, wdt), v in zip(cols, vals):
            c.rect(x, y[0] - 4, wdt, lh, stroke=1, fill=0)
            if v not in (None, ""):
                s = str(v)
                while pdfmetrics.stringWidth(s, fn, 8.5) > wdt - 4 and len(s) > 2:
                    s = s[:-1]
                c.drawString(x + 2, y[0] + 1, s)
            x += wdt
        y[0] -= lh

    header()
    total = 0
    for i, (s, rows) in enumerate(data):
        label = f"{zen_digits(str(i + 1))}．{s['ledger']}"
        if y[0] < 90:
            c.showPage()
            header()
        c.setFont(fn, 10)
        c.drawString(x0 + 2, y[0] + 1, label)
        y[0] -= lh
        ans.rec("parent", {"name": s["ledger"]}, [label], seq=seq[0])
        seq[0] += 1
        for rw in rows:
            kw = rw["kw"] if rw["kw"] is not None else "—"
            vals = [rw["no"], rw["code"], rw["name"], rw["qty"], rw["form"], rw["main"], kw, rw["maker"], rw["note"]]
            line(vals)
            f = {"No.": rw["no"], "機器番号": rw["code"], "機器名称": rw["name"], "数量": rw["qty"], "形式": rw["form"],
                 "主要仕様": rw["main"], "電動機(kW)": kw, "製作者": rw["maker"]}
            if rw["note"]:
                f["備考"] = rw["note"]
            ans.rec("item", f, [str(v) for v in (rw["no"], rw["name"], rw["qty"])], seq=seq[0])
            seq[0] += 1
            qty = int(rw["qty"].split()[0])
            total += qty
            for aid in rw["units"]:
                W.seen_name(aid, fname, rw["name"])
    line(["", "", "機器点数　合計", f"{total} 点", "", "", "", "", ""], bold=True)
    ans.rec("total", {}, ["機器点数", f"{total} 点"], seq=seq[0])
    c.setFont(fn, 8)
    c.drawString(x0, 34, "注）数量は施設全体の数量。電動機の容量は kW。竣工時の内容で、その後の更新・追加は反映していない。")
    c.showPage()
    c.save()
    ans.extra["pages"] = page[0]
    answers[fname] = ans
