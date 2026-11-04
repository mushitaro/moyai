"""作業日報の書き手。

- write_diary_books：年度ごとのブック、月ごとのシート、1 日 1 枚の帳票（12 行を超えると続紙）。年で様式が変わる。
- write_diary_csv：委託先の業務の仕組みからの書き出し（1 行 1 件、Shift_JIS か UTF-8）。
- write_inspect_csv：点検の記録の書き出し（機器ごとの判定と測った値）。
"""
from __future__ import annotations

import csv
import datetime as dt
import io
from collections import defaultdict

from .book import Answer, Book, addr, ev
from .util import FAKE, daterange, era_fy, fill, fy_range, hankaku_kana, paren_half, rng_for, wareki_full, weekday_ja

TRADES = ["鳶工", "機械工", "溶接工", "電工", "保温工", "作業員"]
TRADE_BY_ROLE = {
    "plant": [1, 4, 2, 0, 0, 3], "boiler": [0, 3, 3, 0, 1, 1], "pump": [0, 3, 0, 1, 0, 0], "fan": [0, 3, 0, 1, 0, 0],
    "crane": [0, 2, 0, 2, 0, 1], "env": [0, 3, 1, 0, 0, 3], "catalyst": [1, 2, 0, 0, 0, 3], "refractory": [0, 1, 0, 0, 0, 6],
    "turbine": [0, 4, 0, 1, 0, 1], "electric": [0, 0, 0, 4, 0, 1], "elecsafety": [0, 0, 0, 3, 0, 0], "system": [0, 0, 0, 3, 0, 0],
    "instrument": [0, 0, 0, 2, 0, 1], "analysis": [0, 0, 0, 0, 0, 2], "consult": [0, 0, 0, 0, 0, 2], "scale": [0, 1, 0, 1, 0, 0],
    "diesel": [0, 2, 0, 1, 0, 0], "building": [0, 1, 0, 1, 0, 1], "water": [0, 2, 0, 0, 0, 1], "machine": [0, 2, 1, 0, 0, 1],
    "scaffold": [5, 0, 0, 0, 0, 2], "om": [0, 2, 0, 1, 0, 2], "misc": [0, 1, 0, 1, 0, 0],
}
WRITERS = ["高瀬", "三ツ木", "沖野", "葉山", "柚木", "千早"]
WEATHER = ["晴", "晴", "曇", "晴", "雨", "曇", "晴時々曇", "雪"]
TIMES = ["8:30～17:00", "8:30～17:00", "8:00～17:00", "9:00～16:30", "8:30-17:00", "13:00～17:00"]


def _split(total, n):
    base = [total // n] * n
    for i in range(total % n):
        base[i] += 1
    return base


def day_lines(W, days, doc):
    """日ごとに、その日に作業した行（作業・その日の人数）。日曜は休み。"""
    by = defaultdict(list)
    for w in W.works:
        if not w["done"]:
            continue
        if w.get("rollup"):
            continue
        s, e = w["start"], w["end"]
        if e < days[0] or s > days[-1]:
            continue
        wd = [x for x in daterange(s, e) if x.weekday() != 6]
        if not wd:
            wd = [s]
        md = max(1, int(w.get("manDays") or 1))
        per = _split(md, len(wd)) if md >= len(wd) else [1] * len(wd)
        for x, p in zip(wd, per):
            if days[0] <= x <= days[-1]:
                by[x].append((w, p))
    return by


def labels(W, w, r, doc):
    nm = W.rules["naming"]
    a = W.aidx[w["asset"]]
    t = W.cat.get(w["key"])
    fstyle = r.choice(doc.get("furnaceStyle", range(len(nm["furnace"]["diary"]))))
    if a.get("pseudo"):
        if a["furnace"]:
            fur = fill(nm["furnace"]["diary"][fstyle], a["furnace"])
            eq = ""
        else:
            fur = r.choice(nm["common"]["diary"])
            eq = "全炉"
        return fur, "", eq
    f = a["furnace"]
    fur = fill(nm["furnace"]["diary"][fstyle], f) if f and W.F > 1 else (r.choice(nm["common"]["diary"]) if r.random() < 0.6 else "")
    unit = ""
    if a["unit"]:
        unit = fill(r.choice(nm["unit"]["diary"]), a["unit"])
    if a["part"]:
        unit = (unit + " " if unit else "") + a["part"]
    names = t["diary"] if t else [a["name"]]
    eq = r.choice(names)
    if r.random() < doc.get("kana", 0.12):
        eq = hankaku_kana(eq)
    return fur, unit, eq


def work_text(W, w, r):
    txt = w["task"]
    if w["status"] == "breakdown" and r.random() < 0.5:
        txt += "（緊急）" if w.get("emergency") else "（臨時）"
    elif r.random() < 0.18:
        txt += r.choice(["　点検・補修", "（部品交換）", " 調整", "　清掃・点検"])
    if r.random() < 0.15:
        txt = paren_half(txt)
    return txt


def vendor_text(W, w, r):
    if w["vendorRole"] == "om":
        return r.choice(["常駐（運転管理）", "運転管理委託", W.vendor("om")])
    v = w["vendor"]
    if r.random() < 0.2:
        v = v.replace("㈱", "(株)")
    return v


def op_status(W, day, f):
    for fy in (day.year, day.year - 1):
        win = W.windows.get(fy)
        if not win or f not in win["furnaces"]:
            continue
        fw = win["furnaces"][f]
        if day == fw["start"]:
            return "立下げ"
        if day == fw["end"]:
            return "立上げ"
        if fw["start"] < day < fw["end"]:
            return "停止"
    return "運転"


def write_diary_books(W, doc, outdir, answers, _):
    for fy in range(doc["years"][0], doc["years"][1] + 1):
        _diary_book(W, doc, fy, outdir, answers)


def _diary_book(W, doc, fy, outdir, answers):
    r = rng_for(W.seed, "diary", fy)
    era = era_fy(fy)
    fname = f"{FAKE}{W.fac['short']}_作業日報_{era}.xlsx"
    bk = Book(f"{FAKE}{W.fac['name']} 作業日報 {era}年度", f"{FAKE}{W.fac['owner']} 保全係")
    ans = Answer(fname, False)
    a, b = fy_range(fy, W.fym)
    b = min(b, W.today)
    days = list(daterange(a, b))
    lines = day_lines(W, days, doc)
    fmt_b = fy >= doc.get("formatChange", 9999)
    maxl = 12
    cardno = 0
    writer = r.choice(WRITERS)
    for m in [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]:
        yy = fy if m >= W.fym else fy + 1
        mdays = [x for x in days if x.month == m and x.year == yy]
        if not mdays:
            continue
        S = bk.sheet(f"{m}月")
        row = 1
        for day in mdays:
            ls = lines.get(day, [])
            if not ls:
                if day.weekday() < 5 and r.random() < 0.04:
                    ls = []
                else:
                    continue
            elif day.weekday() == 6:
                continue
            ls.sort(key=lambda x: (W.aidx[x[0]["asset"]]["furnace"] or 9, x[0]["start"], x[0]["id"]))
            cardno += 1
            if r.random() < 0.08:
                writer = r.choice(WRITERS)
            pages = max(1, -(-len(ls) // maxl))
            weather = r.choice(WEATHER)
            for pg in range(pages):
                chunk = ls[pg * maxl:(pg + 1) * maxl]
                row = _card(W, S, ans, fname, row, day, f"{era}-{cardno:03d}", pg + 1, pages, weather, writer, chunk,
                            fmt_b, r, doc, maxl)
        for c, wdt in zip(range(1, 16), [5, 8, 10, 22, 34, 20, 6, 6, 6, 6, 6, 6, 13, 7, 14] if fmt_b else
                          [5, 8, 22, 8, 34, 8, 8, 20, 8, 7, 8, 13, 10, 8, 8]):
            S.width(c, wdt)
    bk.save(outdir / fname)
    answers[fname] = ans


def _card(W, S, ans, fname, row, day, no, pg, pages, weather, writer, chunk, fmt_b, r, doc, maxl):
    top = row
    title = "作業日報" if pg == 1 else "作業日報（続紙）"
    S.put(row, 1, W.fac["name"], bold=True)
    S.put(row, 4, title, bold=True, size=13)
    S.put(row, 10, "所長", box=True, align="center")
    S.put(row, 12, "係長", box=True, align="center")
    S.put(row, 14, "担当", box=True, align="center")
    S.merge(row, 10, row, 11)
    S.merge(row, 12, row, 13)
    S.put(row + 1, 1, f"No. {no}")
    S.put(row + 2, 1, f"{FAKE}")
    dr = row + 3
    S.put(dr, 1, "日付", box=True)
    if fmt_b:
        S.put(dr, 2, day, box=True)
        S.merge(dr, 2, dr, 3)
        date_ev = (addr(dr, 2), day)
    else:
        dtxt = wareki_full(day)
        S.put(dr, 2, dtxt, box=True)
        S.merge(dr, 2, dr, 3)
        date_ev = (addr(dr, 2), dtxt)
    wtxt = f"（{weekday_ja(day)}）　天候：{weather}"
    S.put(dr, 5, wtxt)
    S.put(dr, 6, "記入者", box=True)
    S.put(dr, 7, writer, box=True)
    S.put(dr, 11, "頁", box=True)
    S.put(dr, 13, f"{pg}/{pages}", box=True)
    st = {f: op_status(W, day, f) for f in range(1, W.F + 1)}
    S.put(dr + 1, 1, "運転", box=True)
    c = 2
    for f in range(1, W.F + 1):
        S.put(dr + 1, c, f"{f}号炉", box=True)
        S.put(dr + 1, c + 1, st[f], box=True)
        c += 2
    if W.prof.get("turbine"):
        S.put(dr + 1, c, "発電", box=True)
        S.put(dr + 1, c + 1, "停止" if all(v != "運転" for v in st.values()) else "運転", box=True)
    card = {"日付": day, "No": no, "頁": f"{pg}/{pages}", "天候": weather, "記入者": writer}
    for f in range(1, W.F + 1):
        card[f"{f}号炉運転"] = st[f]
    card_ev = [list(ev(*date_ev)), ev(addr(row + 1, 1), f"No. {no}"), ev(addr(dr, 13), f"{pg}/{pages}"), ev(addr(dr, 7), writer)]
    hr = dr + 3
    if fmt_b:
        heads = [(1, "No."), (2, "号炉"), (3, "系統・No."), (4, "設備・機器"), (5, "作業内容"), (6, "施工業者"),
                 (7, "職種別人員（人）"), (13, "作業時間"), (14, "人工計"), (15, "備考")]
        for col, h in heads:
            S.put(hr, col, h, bold=True, box=True, align="center")
        S.merge(hr, 7, hr, 12)
        for i, t in enumerate(TRADES):
            S.put(hr + 1, 7 + i, t, box=True, align="center", size=8)
        for col in (1, 2, 3, 4, 5, 6, 13, 14, 15):
            S.merge(hr, col, hr + 1, col)
        body = hr + 2
    else:
        heads = [(1, "No."), (2, "号炉"), (3, "設備・機器"), (5, "作業内容"), (8, "施工業者"), (10, "人員"),
                 (11, "延べ時間"), (12, "作業時間"), (13, "備考")]
        for col, h in heads:
            S.put(hr, col, h, bold=True, box=True, align="center")
        S.merge(hr, 3, hr, 4)
        S.merge(hr, 5, hr, 7)
        S.merge(hr, 8, hr, 9)
        S.merge(hr, 13, hr, 15)
        body = hr + 1
    for i in range(maxl):
        rr = body + i
        S.put(rr, 1, i + 1 + (pg - 1) * maxl, box=True, align="center")
        if i >= len(chunk):
            continue
        w, persons = chunk[i]
        fur, unit, eq = labels(W, w, r, doc)
        wt = work_text(W, w, r)
        vend = vendor_text(W, w, r)
        tm = r.choice(TIMES) if persons < 8 else "8:00～17:00"
        memo = ""
        if r.random() < 0.1:
            memo = r.choice(["火気使用", "高所作業", "酸欠危険作業", "立会：保全係", "前日から継続"])
        crammed = r.random() < doc.get("crammed", 0.14)
        f = dict(card)
        f["行"] = i + 1 + (pg - 1) * maxl
        evc = list(card_ev)
        if crammed:
            txt = f"{fur}{unit} {eq} {wt}".strip().replace("  ", " ")
            evc.append(ev(S.put(rr, 5, txt, box=True), txt))
            f["作業内容"] = txt
        else:
            if fur:
                evc.append(ev(S.put(rr, 2, fur, box=True), fur))
                f["号炉"] = fur
            if fmt_b:
                if unit:
                    evc.append(ev(S.put(rr, 3, unit, box=True), unit))
                    f["系統・No."] = unit
                evc.append(ev(S.put(rr, 4, eq, box=True), eq))
                f["設備・機器"] = eq
            else:
                e2 = (eq + (" " + unit if unit else "")).strip()
                evc.append(ev(S.put(rr, 3, e2, box=True), e2))
                f["設備・機器"] = e2
            evc.append(ev(S.put(rr, 5, wt, box=True), wt))
            f["作業内容"] = wt
        evc.append(ev(S.put(rr, 6 if fmt_b else 8, vend, box=True), vend))
        f["施工業者"] = vend
        if fmt_b:
            mix = TRADE_BY_ROLE.get(w["vendorRole"], [0, 1, 0, 0, 0, 1])
            alloc = _alloc(persons, mix, r)
            for k, n in enumerate(alloc):
                if n:
                    evc.append(ev(S.put(rr, 7 + k, n, box=True, align="center"), n))
                    f[TRADES[k]] = n
            evc.append(ev(S.put(rr, 13, tm, box=True), tm))
            evc.append(ev(S.put(rr, 14, persons, box=True, align="center"), persons))
            f["作業時間"] = tm
            f["人工計"] = persons
            f["manDays"] = persons
            f["manDaysText"] = str(persons)
            if memo:
                evc.append(ev(S.put(rr, 15, memo, box=True), memo))
                f["備考"] = memo
        else:
            hours = persons * 8
            evc.append(ev(S.put(rr, 10, persons, box=True, align="center"), persons))
            htxt = f"{hours}h"
            evc.append(ev(S.put(rr, 11, htxt, box=True, align="center"), htxt))
            evc.append(ev(S.put(rr, 12, tm, box=True), tm))
            f["人員"] = persons
            f["延べ時間"] = htxt
            f["作業時間"] = tm
            f["manDays"] = persons
            f["manDaysText"] = f"{persons}人・{htxt}"
            if memo:
                evc.append(ev(S.put(rr, 13, memo, box=True), memo))
                f["備考"] = memo
        ans.rec("item", f, evc, sheet=S.title, r=rr)
        W.link(w["id"], fname, sheet=S.title, r=rr, day=day)
        W.seen_name(w["asset"], fname, eq)
    if not chunk:
        ans.rec("item", dict(card), card_ev, sheet=S.title, r=top)
    sp = body + maxl
    S.put(sp, 1, "安全・特記事項", box=True)
    note = "（続紙に記載）" if pages > 1 and pg == 1 else r.choice(["KY 活動実施。", "KY 活動実施。指差呼称の徹底。", "TBM 実施。", "熱中症対策（WBGT 確認）。"])
    S.put(sp, 3, note)
    S.merge(sp, 3, sp, 15)
    return sp + 3


def _alloc(n, mix, r):
    tot = sum(mix) or 1
    out = [int(n * m / tot) for m in mix]
    rest = n - sum(out)
    order = sorted(range(len(mix)), key=lambda i: -mix[i])
    k = 0
    while rest > 0:
        out[order[k % len(order)]] += 1
        rest -= 1
        k += 1
    return out


# ---------------------------------------------------------------- CSV の書き出し
CP932_MAP = {"—": "―", "–": "－", "〜": "～", "✓": "レ"}


def safe(v, enc):
    """書き出す文字コードに無い文字を、その文字コードの近い文字に置く（書き出しの仕組みがすること）。"""
    if not isinstance(v, str) or enc.lower() not in ("cp932", "shift_jis", "sjis"):
        return v
    out = []
    for ch in v:
        ch = CP932_MAP.get(ch, ch)
        try:
            ch.encode("cp932")
        except UnicodeEncodeError:
            ch = "?"
        out.append(ch)
    return "".join(out)


def _rec(ans, f, rr, enc, row):
    rr[:] = [safe(x, enc) for x in rr]
    f = {k: safe(v, enc) for k, v in f.items()}
    ans.rec("item", f, [[f"{row}:{k}", v] for k, v in enumerate(rr) if v != ""], r=row)

def write_diary_csv(W, doc, outdir, answers, _):
    """委託先の業務の仕組みからの書き出し。1 行 1 件。年度ごとに 1 ファイル。まとめ工事の行を含む。"""
    enc = doc.get("encoding", "cp932")
    for fy in range(doc["years"][0], doc["years"][1] + 1):
        r = rng_for(W.seed, "dcsv", fy)
        era = era_fy(fy)
        fname = f"{FAKE}{W.fac['short']}_作業実績_{fy}.csv"
        ans = Answer(fname, False)
        a, b = fy_range(fy, W.fym)
        b = min(b, W.today)
        days = list(daterange(a, b))
        lines = day_lines(W, days, doc)
        rows = []
        rows.append([f"# {FAKE}{W.fac['name']} 作業実績データ（{era}年度）　委託先の業務システムから出力。施設・業者・人名はすべて架空"])
        head = ["作業日", "号炉", "設備名", "作業区分", "作業内容", "施工業者", "人数", "作業時間(h)", "備考"]
        rows.append(head)
        bundles_done = set()
        for day in days:
            for w, persons in sorted(lines.get(day, []), key=lambda x: x[0]["id"]):
                fur, unit, eq = labels(W, w, r, doc)
                # まとめ工事の行（工事の初日に 1 行）
                cid = w.get("contract")
                c = W.cidx.get(cid) if cid else None
                if c and c.get("bundle") and cid not in bundles_done:
                    bundles_done.add(cid)
                    tot = sum(W.widx[x]["manDays"] for x in c["works"] if W.widx[x]["done"])
                    rr = [day.strftime("%Y/%m/%d"), f"{c['bundle']}号炉" if c["bundle"] != "all" else "共通", c["title"].replace(W.fac["name"], ""),
                          "工事", "一式（内訳は各行）", c["vendor"], "", "", f"延べ{tot}人工"]
                    rows.append(rr)
                    _rec(ans, {"作業日": day, "号炉": rr[1], "設備名": rr[2], "作業区分": "工事", "作業内容": rr[4],
                               "施工業者": rr[5], "manDaysText": rr[8], "manDays": tot}, rr, enc, len(rows))
                    for x in c["works"]:
                        W.link(x, fname, r=len(rows), how="bundle")
                kind = {"breakdown": "修繕", "routine": "日常点検"}.get(w["status"], "定期点検" if w["attr"] == "INSPECT" else "整備")
                wt = work_text(W, w, r)
                hours = persons * r.choice([7.5, 8, 8])
                eqtxt = (eq + (" " + unit if unit else "")).strip()
                vend = vendor_text(W, w, r)
                memo = "緊急" if w.get("emergency") else ""
                hstr = f"{hours:g}"
                rr = [day.strftime("%Y/%m/%d") if r.random() > 0.05 else day.strftime("%Y-%m-%d"), fur, eqtxt, kind, wt,
                      vend, str(persons), hstr, memo]
                rows.append(rr)
                f = {"作業日": day, "号炉": fur, "設備名": eqtxt, "作業区分": kind, "作業内容": wt, "施工業者": vend,
                     "人数": persons, "作業時間(h)": hours, "manDays": persons, "manDaysText": f"{persons}人・{hstr}h"}
                if not fur:
                    f.pop("号炉")
                if memo:
                    f["備考"] = memo
                _rec(ans, f, rr, enc, len(rows))
                W.link(w["id"], fname, r=len(rows), day=day)
                W.seen_name(w["asset"], fname, eqtxt)
        buf = io.StringIO()
        wr = csv.writer(buf, lineterminator="\r\n" if enc == "cp932" else "\n")
        for rr in rows:
            wr.writerow(rr)
        (outdir / fname).write_bytes(buf.getvalue().encode(enc, errors="replace"))
        ans.extra["encoding"] = enc
        answers[fname] = ans


def write_inspect_csv(W, doc, outdir, answers, _):
    """点検の記録（週 1 回の巡視の結果）。機器ごとの判定（良・否）と測った値。"""
    enc = doc.get("encoding", "cp932")
    r = rng_for(W.seed, "icsv")
    fname = f"{FAKE}{W.fac['short']}_{doc.get('stem', '点検記録')}.csv"
    ans = Answer(fname, False)
    items = doc["items"]
    rows = [[f"# {FAKE}{W.fac['name']} 定期巡視点検の記録（施設・機器・人名はすべて架空）"],
            ["点検日", "機器番号", "機器名", "点検項目", "判定", "測定値", "単位", "点検者", "所見"]]
    a = dt.date(doc["years"][0], 4, 1)
    b = min(fy_range(doc["years"][1], W.fym)[1], W.today)
    day = a
    while day <= b:
        if day.weekday() == 2:
            who = r.choice(WRITERS)
            for key, item, unit, lo, hi in items:
                for u in W.units_of(key):
                    val = round(r.uniform(lo, hi), 1) if unit else ""
                    bad = r.random() < 0.015
                    judge = "否" if bad else ("良" if r.random() > 0.03 else "○")
                    note = r.choice(["異音あり", "漏れ（微）", "振動やや大"]) if bad else ""
                    rr = [day.strftime("%Y/%m/%d"), u["tag"] or "", W.cat[key]["chart"][0] + (f" No.{u['unit']}" if u["unit"] else ""),
                          item, judge, str(val) if val != "" else "", unit, who, note]
                    rows.append(rr)
                    f = {"点検日": day, "機器番号": rr[1], "機器名": rr[2], "点検項目": item, "判定": judge, "点検者": who}
                    if val != "":
                        f["測定値"] = val
                        f["単位"] = unit
                    if note:
                        f["所見"] = note
                    if not rr[1]:
                        f.pop("機器番号")
                    _rec(ans, f, rr, enc, len(rows))
                    W.seen_name(u["id"], fname, rr[2])
        day += dt.timedelta(days=1)
    buf = io.StringIO()
    wr = csv.writer(buf, lineterminator="\r\n")
    for rr in rows:
        wr.writerow(rr)
    (outdir / fname).write_bytes(buf.getvalue().encode(enc, errors="replace"))
    ans.extra["encoding"] = enc
    answers[fname] = ans
