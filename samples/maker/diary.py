"""作業日報の書き手の共通の部品と、CSV の書き出し（Excel の帳票は diarybook.py）。

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
            eq = W.text("allUnits")
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
        uh = W.text("csvUnitHead")
        head = ["作業日", uh, "設備名", "作業区分", "作業内容", "施工業者", "人数", "作業時間(h)", "備考"]
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
                    rr = [day.strftime("%Y/%m/%d"), W.unit(c["bundle"]) if c["bundle"] != "all" else "共通", c["title"].replace(W.fac["name"], ""),
                          "工事", "一式（内訳は各行）", c["vendor"], "", "", f"延べ{tot}人工"]
                    rows.append(rr)
                    _rec(ans, {"作業日": day, uh: rr[1], "設備名": rr[2], "作業区分": "工事", "作業内容": rr[4],
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
                f = {"作業日": day, uh: fur, "設備名": eqtxt, "作業区分": kind, "作業内容": wt, "施工業者": vend,
                     "人数": persons, "作業時間(h)": hours, "manDays": persons, "manDaysText": f"{persons}人・{hstr}h"}
                if not fur:
                    f.pop(uh)
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
