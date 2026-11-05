"""定期整備の工程表（年度ごとのシート、週のガント）の書き手。

行は炉ごとの定期整備の窓（段と機器の作業）と全休炉の作業。週のセルはその週に作業した日数（日曜を除く）。
工数の書き方は揺らす（延べ人工の数、「◯人工」の文字、日数だけ、期間だけ）。
"""
from __future__ import annotations

import datetime as dt

from .book import Answer, Book, ev
from .util import FAKE, daterange, era_fy, fill, fy_range, rng_for

TD = dt.timedelta
FILLS = {"F": "BDD7EE", "A": "F8CBAD", "S": "D9D9D9"}


def write_gantt(W, doc, outdir, answers, _):
    y0, y1 = doc["years"]
    fname = f"{FAKE}{W.fac['short']}_工程表_{era_fy(y0)}-{era_fy(y1)}.xlsx"
    bk = Book(f"{FAKE}{W.fac['name']} 定期整備工程表", f"{FAKE}{W.fac['owner']} 保全係")
    ans = Answer(fname, False)
    for fy in range(y0, y1 + 1):
        if fy not in W.windows:
            continue
        _sheet(W, bk.sheet(era_fy(fy)), fy, ans, fname, doc)
    bk.save(outdir / fname)
    answers[fname] = ans


def _weeks(fy, fym):
    a, b = fy_range(fy, fym)
    mon = a - TD(days=a.weekday())
    out = []
    while mon <= b:
        out.append(mon)
        mon += TD(days=7)
    return out


def _sheet(W, S, fy, ans, fname, doc):
    r = rng_for(W.seed, "gantt", fy)
    win = W.windows[fy]
    weeks = _weeks(fy, W.fym)
    S.put(1, 1, f"{W.fac['name']}（架空）　定期整備工程表（{era_fy(fy)}年度・週単位）", bold=True, size=13)
    S.put(2, 1, f"{FAKE}週のセルはその週に作業した日数（日曜を除く）。業者・工数はすべて架空。")
    hr = 4
    heads = ["区分", "作業・機器", "業者", "着手", "完了", "延べ人工"]
    for i, h in enumerate(heads):
        S.put(hr, i + 1, h, bold=True, box=True, align="center")
        S.merge(hr, i + 1, hr + 1, i + 1)
    c0 = len(heads) + 1
    wcol = {}
    prev_m = None
    for i, wk in enumerate(weeks):
        col = c0 + i
        wcol[wk] = col
        S.put(hr + 1, col, f"{wk.month}/{wk.day}", box=True, align="center", size=8)
        m = (wk + TD(days=3)).month
        if m != prev_m:
            S.put(hr, col, f"{m}月", bold=True, box=True)
            prev_m = m
        S.width(col, 4.2)
    row = hr + 2
    nm = W.rules["naming"]
    sections = []
    for f, fw in sorted(win["furnaces"].items()):
        sections.append((W.text("ganttUnit").replace("{unit}", W.unit(f)), "F", f, fw["start"], fw["end"]))
        if f == 1 and W.F >= 2:
            sections.append((W.text("ganttAll"), "A", None, win["all"]["start"], win["all"]["end"]))
    if W.F == 1:
        sections.append((W.text("ganttAllSingle"), "A", None, win["all"]["start"], win["all"]["end"]))
    for title, kind, f, s, e in sections:
        ws_ = []
        if kind == "F":
            steps = [w for w in W.works if w["fy"] == fy and str(w["ti"]).startswith("STEP:") and W.aidx[w["asset"]]["furnace"] == f]
            eq = [w for w in W.works if w["fy"] == fy and w["at"] == "F" and not w.get("rollup") and not str(w["ti"]).startswith("STEP:")
                  and W.aidx[w["asset"]]["furnace"] == f and w["status"] not in ("postponed", "not_done")]
            ws_ = sorted(steps, key=lambda w: w["start"])[:5] + sorted(eq, key=lambda w: (w["start"], w["id"])) + sorted(steps, key=lambda w: w["start"])[5:]
        else:
            ws_ = sorted([w for w in W.works if w["fy"] == fy and w["at"] in ("A", "B", "D") and not w.get("rollup")
                          and w["status"] not in ("postponed", "not_done")], key=lambda w: (w["start"], w["id"]))
        agg = [w for w in W.works if w["fy"] == fy and w.get("rollup") and
               ((kind == "F" and w["asset"] == f"F-{f}") or (kind == "A" and w["asset"] == "ALL"))]
        tot = agg[0]["manDays"] if agg else sum(w["manDays"] for w in ws_)
        evc = [ev(S.put(row, 1, title, bold=True, fill=FILLS["S"]), title)]
        evc.append(ev(S.put(row, 4, s, fill=FILLS["S"]), s))
        evc.append(ev(S.put(row, 5, e, fill=FILLS["S"]), e))
        evc.append(ev(S.put(row, 6, tot, fill=FILLS["S"], fmt="#,##0"), tot))
        for wk, col in wcol.items():
            n = sum(1 for x in daterange(max(s, wk), min(e, wk + TD(days=6))) if x.weekday() != 6)
            if n:
                S.put(row, col, n, fill=FILLS["S"], align="center")
        ans.rec("parent", {"区分": title.replace("■ ", ""), "着手": s, "完了": e, "延べ人工": tot, "manDays": tot,
                           "manDaysText": str(tot)}, evc, sheet=S.title, r=row)
        for w in agg:
            W.link(w["id"], fname, sheet=S.title, r=row, how="rollup")
        row += 1
        for w in ws_:
            a = W.aidx[w["asset"]]
            t = W.cat.get(w["key"])
            if str(w["ti"]).startswith("STEP:"):
                label = w["task"]
                kubun = "段"
            else:
                base = t["chart"][0] if t else a["name"]
                if a["part"]:
                    base += f"（{a['part']}）"
                if a["unit"]:
                    base += " " + fill(r.choice(nm["unit"]["chart"][:3]), a["unit"])
                label = f"{base}　{w['task']}"
                kubun = W.sys[t["sys"]]["chart"][0] if t else ""
            style = r.random()
            md_text = None
            md_val = w["manDays"]
            vend = w["vendor"]
            evc = []
            f_ = {"区分": kubun, "作業・機器": label, "業者": vend}
            evc.append(ev(S.put(row, 1, kubun), kubun))
            evc.append(ev(S.put(row, 2, label), label))
            evc.append(ev(S.put(row, 3, vend), vend))
            if style < 0.08:
                # 期間だけ（日付の列は空、週のセルだけ）
                pass
            else:
                evc.append(ev(S.put(row, 4, w["start"]), w["start"]))
                evc.append(ev(S.put(row, 5, w["end"]), w["end"]))
                f_["着手"] = w["start"]
                f_["完了"] = w["end"]
            if style < 0.08:
                f_["manDaysText"] = "（期間のみ）"
            elif style < 0.16:
                d = (w["end"] - w["start"]).days + 1
                txt = f"{d}日間"
                evc.append(ev(S.put(row, 6, txt, align="right"), txt))
                f_["延べ人工"] = txt
                f_["manDaysText"] = txt
            elif style < 0.3:
                md_text = f"{md_val}人工"
                evc.append(ev(S.put(row, 6, md_text, align="right"), md_text))
                f_["延べ人工"] = md_text
                f_["manDays"] = md_val
                f_["manDaysText"] = md_text
            else:
                evc.append(ev(S.put(row, 6, md_val, fmt="#,##0"), md_val))
                f_["延べ人工"] = md_val
                f_["manDays"] = md_val
                f_["manDaysText"] = str(md_val)
            fill_c = FILLS["S"] if kubun == "段" else (FILLS["F"] if kind == "F" else FILLS["A"])
            for wk, col in wcol.items():
                n = sum(1 for x in daterange(max(w["start"], wk), min(w["end"], wk + TD(days=6))) if x.weekday() != 6)
                if n:
                    a_ = S.put(row, col, n, fill=fill_c, align="center")
                    evc.append(ev(a_, n))
                    f_[f"週_{wk.isoformat()}"] = n
            ans.rec("item", f_, evc, sheet=S.title, r=row)
            W.link(w["id"], fname, sheet=S.title, r=row)
            if not str(w["ti"]).startswith("STEP:"):
                W.seen_name(w["asset"], fname, label.split("　")[0])
            S.group_row(row, 1)
            row += 1
        row += 1
    S.width(1, 16)
    S.width(2, 40)
    S.width(3, 22)
    S.width(4, 10)
    S.width(5, 10)
    S.width(6, 9)
    S.ws.freeze_panes = S.ws.cell(row=hr + 2, column=c0)
