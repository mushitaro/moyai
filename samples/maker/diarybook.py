"""作業日報（Excel の帳票）の書き手。年度ごとのブック、月ごとのシート、1 日 1 枚。

- 1 日 1 枚を印刷の 1 頁にする（用紙 A4、向き、余白、印刷の範囲、改ページ、横 1 頁に合わせる）。明細が入りきらない日は続紙の頁。
- 明細は「号炉・系統・機器・作業」を横に結合した 1 つのセルに、人が打つように平打ちする。書き順と区切りは記入者で揺れる。
- 縦の様式（A4 縦）：和暦の文字の日付、人員（「3名」と数が混ざる）。
- 横の様式（A4 横）：施設の設定の landscapeFrom の年度から。日付はセル、見出しと承認の欄の位置・列の並び・結合が変わり、職種別の人員と人工計の列。
"""
from __future__ import annotations

from openpyxl.utils import get_column_letter
from openpyxl.worksheet.pagebreak import Break, RowBreak

from .book import Answer, Book, addr, ev
from .diary import (TIMES, TRADE_BY_ROLE, TRADES, WEATHER, WRITERS, _alloc, day_lines, labels, op_status,
                    vendor_text, work_text)
from .util import FAKE, daterange, era_fy, fy_range, rng_for, wareki_full, weekday_ja

LAYOUTS = {
    "portrait": {"orient": "portrait", "maxl": 22, "last": 10, "widths": [4.5, 9, 9, 9, 9, 9, 22, 6, 12, 10]},
    "landscape": {"orient": "landscape", "maxl": 12, "last": 17,
                  "widths": [4.5, 8, 8, 8, 8, 8, 8, 22, 5, 5, 5, 5, 5, 5, 6.5, 12, 12]},
}
FLAT = [
    "{fur}{unit} {eq} {work}",
    "{fur}　{eq}{unit}　{work}",
    "{eq}（{fur}{unit}）{work}",
    "{fur}・{eq} {unit}・{work}",
    "{fur}{eq}　{unit}　{work}",
]
NOTES = ["KY 活動実施。", "KY 活動実施。指差呼称の徹底。", "TBM 実施。", "熱中症対策（WBGT 確認）。"]
MEMOS = ["火気使用", "高所作業", "酸欠危険作業", "立会：保全係", "前日から継続"]


def write_diary_books(W, doc, outdir, answers, _):
    for fy in range(doc["years"][0], doc["years"][1] + 1):
        _book(W, doc, fy, outdir, answers)


def _book(W, doc, fy, outdir, answers):
    r = rng_for(W.seed, "diary", fy)
    era = era_fy(fy)
    fname = f"{FAKE}{W.fac['short']}_作業日報_{era}.xlsx"
    bk = Book(f"{FAKE}{W.fac['name']} 作業日報 {era}年度", f"{FAKE}{W.fac['owner']} 保全係")
    ans = Answer(fname, False)
    a, b = fy_range(fy, W.fym)
    b = min(b, W.today)
    days = list(daterange(a, b))
    lines = day_lines(W, days, doc)
    lay = "landscape" if fy >= doc.get("landscapeFrom", 9999) else "portrait"
    L = LAYOUTS[lay]
    maxl = L["maxl"]
    card_fn = _card_portrait if lay == "portrait" else _card_landscape
    cardno = 0
    writer = r.choice(WRITERS)
    for m in [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]:
        yy = fy if m >= W.fym else fy + 1
        mdays = [x for x in days if x.month == m and x.year == yy]
        if not mdays:
            continue
        S = bk.sheet(f"{m}月")
        row = 1
        ends = []
        for day in mdays:
            ls = lines.get(day, [])
            if not ls:
                if not (day.weekday() < 5 and r.random() < 0.04):
                    continue
            elif day.weekday() == 6:
                continue
            ls = _group(W, ls)
            ls.sort(key=lambda x: (W.aidx[x[0]["asset"]]["furnace"] or 9, x[0]["start"], x[0]["id"]))
            cardno += 1
            if r.random() < 0.08:
                writer = r.choice(WRITERS)
            pages = max(1, -(-len(ls) // maxl))
            weather = r.choice(WEATHER)
            for pg in range(pages):
                chunk = ls[pg * maxl:(pg + 1) * maxl]
                row = card_fn(W, S, ans, fname, row, day, f"{era}-{cardno:03d}", pg + 1, pages, weather, writer, chunk, r, doc, maxl)
                ends.append(row - 1)
        _print_setup(S, L, ends)
    bk.save(outdir / fname)
    ans.extra["layout"] = lay
    ans.extra["pages"] = None
    answers[fname] = ans


def _print_setup(S, L, ends):
    ws = S.ws
    for i, wdt in enumerate(L["widths"]):
        S.width(i + 1, wdt)
    ws.page_setup.orientation = L["orient"]
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = ws.page_margins.right = 0.5
    ws.page_margins.top = ws.page_margins.bottom = 0.6
    ws.print_options.horizontalCentered = True
    if ends:
        ws.print_area = f"A1:{get_column_letter(L['last'])}{ends[-1]}"
    rb = RowBreak()
    for e in ends[:-1]:
        rb.append(Break(id=e))
    ws.row_breaks = rb


def _group(W, ls):
    """まとめて整備する機器（星取表で 1 行にまとめる機器）は、同じ日の同じ作業を日報でも 1 行にする。
    戻り値は (先頭の作業, その日の人数の和, まとめた作業の並び)。"""
    out = []
    idx = {}
    for w, persons in ls:
        t = W.cat.get(w["key"], {})
        if t.get("chartRow") == "group" and w["ti"] not in (None, -1, -2):
            k = (w["key"], w["ti"], W.aidx[w["asset"]]["furnace"], w["start"])
            if k in idx:
                e = out[idx[k]]
                out[idx[k]] = (e[0], e[1] + persons, e[2] + [w])
                continue
            idx[k] = len(out)
        out.append((w, persons, [w]))
    return [(w, max(1, round(p / max(1, len(ms) / 3))) if len(ms) > 3 else p, ms) for w, p, ms in out]


def flat_text(W, w, r, doc, writer, grouped=False):
    """号炉・系統・機器・作業を 1 つの文に平打ちする。"""
    fur, unit, eq = labels(W, w, r, doc)
    if grouped:
        unit = ""
    elif fur and unit and fur[-1].isdigit() and unit[0].isdigit():
        unit = " " + unit  # 「#2」と「21号機」をつなげて読み違えないように
    wt = work_text(W, w, r)
    k = (sum(ord(c) for c in writer) + (1 if r.random() < 0.2 else 0)) % len(FLAT)
    txt = FLAT[k].format(fur=fur, unit=unit, eq=eq, work=wt)
    txt = txt.replace("（）", "")
    while "　　" in txt or "  " in txt:
        txt = txt.replace("　　", "　").replace("  ", " ")
    return txt.strip("　 ・"), eq


def _status(W, day):
    return {f: op_status(W, day, f) for f in range(1, W.F + 1)}


def _card_base(card_day, no, pg, pages, weather, writer, st):
    card = {"日付": card_day, "No": no, "頁": f"{pg}/{pages}", "天候": weather, "記入者": writer}
    for f in st:
        card[f"{f}号炉運転"] = st[f]
    return card


def _detail(W, S, ans, fname, rr, i, pg, maxl, chunk, card, card_ev, r, doc, writer, day, cols):
    """明細の 1 行。cols は 作業内容・業者・人員（または人工計）・作業時間・備考・職種の始めの列。"""
    w, persons, members = chunk[i]
    txt, eq = flat_text(W, w, r, doc, writer, grouped=len(members) > 1)
    vend = vendor_text(W, w, r)
    tm = r.choice(TIMES) if persons < 8 else "8:00～17:00"
    f = dict(card)
    f["行"] = i + 1 + (pg - 1) * maxl
    evc = list(card_ev)
    evc.append(ev(S.put(rr, cols["text"], txt, box=True), txt))
    evc.append(ev(S.put(rr, cols["vendor"], vend, box=True), vend))
    f["作業内容"] = txt
    f["施工業者"] = vend
    if cols.get("trades"):
        for k, n in enumerate(_alloc(persons, TRADE_BY_ROLE.get(w["vendorRole"], [0, 1, 0, 0, 0, 1]), r)):
            if n:
                evc.append(ev(S.put(rr, cols["trades"] + k, n, box=True, align="center"), n))
                f[TRADES[k]] = n
        evc.append(ev(S.put(rr, cols["persons"], persons, box=True, align="center"), persons))
        f["人工計"] = persons
        f["manDaysText"] = str(persons)
    else:
        ptxt = f"{persons}名" if r.random() < 0.3 else persons
        evc.append(ev(S.put(rr, cols["persons"], ptxt, box=True, align="center"), ptxt))
        f["人員"] = persons
        f["manDaysText"] = str(ptxt)
    f["manDays"] = persons
    evc.append(ev(S.put(rr, cols["time"], tm, box=True), tm))
    f["作業時間"] = tm
    if r.random() < 0.1:
        memo = r.choice(MEMOS)
        evc.append(ev(S.put(rr, cols["memo"], memo, box=True), memo))
        f["備考"] = memo
    ans.rec("item", f, evc, sheet=S.title, r=rr)
    for m in members:
        W.link(m["id"], fname, sheet=S.title, r=rr, day=day, **({"how": "group"} if len(members) > 1 else {}))
        W.seen_name(m["asset"], fname, eq)


def _card_portrait(W, S, ans, fname, row, day, no, pg, pages, weather, writer, chunk, r, doc, maxl):
    """A4 縦の帳票。"""
    top = row
    S.put(row, 1, "作　業　日　報" if pg == 1 else "作業日報（続紙）", bold=True, size=14, align="center")
    S.merge(row, 1, row, 6)
    for i, lab in enumerate(["所長", "係長", "担当"]):
        S.put(row, 8 + i, lab, box=True, align="center")
        S.put(row + 1, 8 + i, None, box=True)
    S.ws.row_dimensions[row + 1].height = 30
    head = f"{W.fac['name']}　No. {no}"
    S.put(row + 1, 1, head)
    S.merge(row + 1, 1, row + 1, 6)
    S.put(row + 2, 1, FAKE)
    dr = row + 3
    dtxt = wareki_full(day)
    S.put(dr, 1, "日付", box=True)
    S.put(dr, 2, dtxt, box=True)
    S.merge(dr, 2, dr, 4)
    S.put(dr, 5, f"（{weekday_ja(day)}）　天候：{weather}")
    S.merge(dr, 5, dr, 6)
    S.put(dr, 7, "記入者", box=True, align="right")
    S.put(dr, 8, writer, box=True)
    S.put(dr, 9, "頁", box=True, align="right")
    S.put(dr, 10, f"{pg}/{pages}", box=True, align="center")
    st = _status(W, day)
    txt = "運転状況　" + "　".join(f"{f}号炉：{st[f]}" for f in st)
    if W.prof.get("turbine"):
        txt += "　発電：" + ("停止" if all(v != "運転" for v in st.values()) else "運転")
    S.put(dr + 1, 1, txt)
    S.merge(dr + 1, 1, dr + 1, 10)
    card = _card_base(dtxt, no, pg, pages, weather, writer, st)
    card_ev = [ev(addr(dr, 2), dtxt), ev(addr(row + 1, 1), head), ev(addr(dr, 10), f"{pg}/{pages}"), ev(addr(dr, 8), writer)]
    hr = dr + 3
    for col, h in ((1, "No."), (2, "作業内容（号炉・機器・作業）"), (7, "施工業者"), (8, "人員"), (9, "作業時間"), (10, "備考")):
        S.put(hr, col, h, bold=True, box=True, align="center")
    S.merge(hr, 2, hr, 6)
    body = hr + 1
    cols = {"text": 2, "vendor": 7, "persons": 8, "time": 9, "memo": 10}
    for i in range(maxl):
        rr = body + i
        S.ws.row_dimensions[rr].height = 18
        S.put(rr, 1, i + 1 + (pg - 1) * maxl, box=True, align="center")
        S.boxes(rr, 2, rr, 10)
        S.merge(rr, 2, rr, 6)
        if i < len(chunk):
            _detail(W, S, ans, fname, rr, i, pg, maxl, chunk, card, card_ev, r, doc, writer, day, cols)
    if not chunk:
        ans.rec("item", dict(card), card_ev, sheet=S.title, r=top)
    sp = body + maxl
    S.put(sp, 1, "安全・特記事項", box=True)
    S.merge(sp, 1, sp, 2)
    S.put(sp, 3, "（続紙に記載）" if pages > 1 and pg == 1 else r.choice(NOTES))
    S.merge(sp, 3, sp + 1, 10)
    S.boxes(sp, 1, sp + 1, 10)
    return sp + 3


def _card_landscape(W, S, ans, fname, row, day, no, pg, pages, weather, writer, chunk, r, doc, maxl):
    """A4 横の帳票。日付と番号は左上、題は真ん中、承認の欄は右上。"""
    top = row
    S.put(row, 1, "日付", box=True)
    S.put(row, 2, day, box=True)
    S.merge(row, 2, row, 3)
    S.put(row, 4, f"（{weekday_ja(day)}）", box=True)
    S.put(row, 5, "天候", box=True)
    S.put(row, 6, weather, box=True)
    S.put(row, 8, f"{W.fac['name']}　作業日報" + ("（続紙）" if pg > 1 else ""), bold=True, size=14, align="center")
    S.merge(row, 8, row, 13)
    for c1, c2, lab in [(14, 15, "所長"), (16, 16, "係長"), (17, 17, "担当")]:
        S.put(row, c1, lab, box=True, align="center")
        S.put(row + 1, c1, None, box=True)
        if c2 > c1:
            S.merge(row, c1, row, c2)
            S.merge(row + 1, c1, row + 1, c2)
    S.ws.row_dimensions[row + 1].height = 28
    S.put(row + 1, 1, f"No. {no}")
    S.merge(row + 1, 1, row + 1, 3)
    S.put(row + 1, 4, "記入者", box=True)
    S.put(row + 1, 5, writer, box=True)
    S.merge(row + 1, 5, row + 1, 6)
    pgt = f"{FAKE}　頁 {pg}/{pages}"
    S.put(row + 1, 8, pgt)
    st = _status(W, day)
    S.put(row + 2, 1, "運転", box=True)
    c = 2
    for f in st:
        S.put(row + 2, c, f"{f}号炉", box=True)
        S.put(row + 2, c + 1, st[f], box=True)
        c += 2
    if W.prof.get("turbine"):
        S.put(row + 2, c, "発電", box=True)
        S.put(row + 2, c + 1, "停止" if all(v != "運転" for v in st.values()) else "運転", box=True)
    card = _card_base(day, no, pg, pages, weather, writer, st)
    card_ev = [ev(addr(row, 2), day), ev(addr(row + 1, 1), f"No. {no}"), ev(addr(row + 1, 8), pgt), ev(addr(row + 1, 5), writer)]
    hr = row + 4
    for col, h in [(1, "No."), (2, "号炉・系統・機器・作業内容"), (8, "施工業者"), (9, "職種別人員（人）"), (15, "人工計"), (16, "作業時間"), (17, "備考")]:
        S.put(hr, col, h, bold=True, box=True, align="center", wrap=True)
    S.merge(hr, 2, hr + 1, 7)
    S.merge(hr, 9, hr, 14)
    for col in (1, 8, 15, 16, 17):
        S.merge(hr, col, hr + 1, col)
    for i, t in enumerate(TRADES):
        S.put(hr + 1, 9 + i, t, box=True, align="center", size=8)
    body = hr + 2
    cols = {"text": 2, "vendor": 8, "trades": 9, "persons": 15, "time": 16, "memo": 17}
    for i in range(maxl):
        rr = body + i
        S.ws.row_dimensions[rr].height = 18
        S.put(rr, 1, i + 1 + (pg - 1) * maxl, box=True, align="center")
        S.boxes(rr, 2, rr, 17)
        S.merge(rr, 2, rr, 7)
        if i < len(chunk):
            _detail(W, S, ans, fname, rr, i, pg, maxl, chunk, card, card_ev, r, doc, writer, day, cols)
    if not chunk:
        ans.rec("item", dict(card), card_ev, sheet=S.title, r=top)
    sp = body + maxl
    S.put(sp, 1, "安全・特記事項", box=True)
    S.merge(sp, 1, sp, 3)
    S.put(sp, 4, "（続紙に記載）" if pages > 1 and pg == 1 else r.choice(NOTES))
    S.merge(sp, 4, sp, 17)
    S.boxes(sp, 1, sp, 17)
    return sp + 2
