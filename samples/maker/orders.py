"""発注台帳の書き手。年度ごとのシート。古い年度は和暦の文字の日付、新しい年度は日付のセル。

単価契約・変更契約（〃 の行）・緊急の随意契約・継続費（3 年度にまたがる 1 件）を書き、区分ごとの小計と合計を数の値で置く。
"""
from __future__ import annotations

import datetime as dt

from .book import Answer, Book, ev
from .util import FAKE, era_fy, rng_for, wareki_dot, wareki_full


def write_orders(W, doc, outdir, answers, _):
    y0, y1 = doc["years"]
    fname = f"{FAKE}{W.fac['short']}_発注台帳_{era_fy(y0)}-{era_fy(y1)}.xlsx"
    bk = Book(f"{FAKE}{W.fac['name']} 発注台帳", f"{FAKE}{W.fac['owner']} {doc.get('author', '施設管理課 管理係')}")
    ans = Answer(fname, False)
    r = rng_for(W.seed, "orders")
    text_until = doc.get("textDatesUntil", 2018)
    one_cell_period = doc.get("oneCellPeriod", False)
    for fy in range(y0, y1 + 1):
        S = bk.sheet(doc.get("sheetFmt", "{era}年度").replace("{era}", era_fy(fy)))
        cs = [c for c in W.contracts if c["fy"] == fy]
        cont = []
        if W.upgrade and fy in W.upgrade["years"][1:]:
            cont = [W.cidx[W.upgrade["contract"]]]
        _sheet(W, S, ans, fname, fy, cs, cont, fy <= text_until, one_cell_period, r, doc)
    bk.save(outdir / fname)
    answers[fname] = ans


def _date(day, textual, r):
    if day is None:
        return None
    if textual:
        return wareki_dot(day) if r.random() < 0.8 else wareki_full(day)
    return day


def _sheet(W, S, ans, fname, fy, cs, cont, textual, one_cell, r, doc):
    S.put(1, 1, f"{era_fy(fy)}年度　発注台帳（{W.fac['name']}）", bold=True, size=13)
    S.put(2, 1, f"{FAKE}件名・業者・金額はすべて架空です。金額は税込。")
    heads = ["番号", "契約番号", "件名", "種別", "契約方式", "契約の相手方", "予定価格（円）", "契約金額（円）", "契約日"]
    if one_cell:
        heads += ["工期・履行期間"]
    else:
        heads += ["工期（自）", "工期（至）"]
    heads += ["完了日", "検査日", "支払額（円）", "所管", "摘要"]
    hr = 4
    for i, h in enumerate(heads):
        S.put(hr, i + 1, h, bold=True, box=True, align="center", wrap=True)
    col = {h: i + 1 for i, h in enumerate(heads)}
    row = hr + 1
    kinds_total = {"工事": 0, "委託": 0, "物品": 0}
    order = sorted(cs, key=lambda c: (c["start"], c["seq"]))
    no = 0
    era = era_fy(fy, "abn")
    for c in order:
        no += 1
        cno = f"{era}-{no:03d}"
        c["orderNo"] = cno
        title = c["title"]
        if r.random() < 0.25 and not c.get("annual") and not c.get("purchase"):
            title = title.replace(W.fac["name"], W.fac["short"])
        if c.get("annual") and r.random() < 0.4:
            title += f"（{era_fy(fy)}年度）"
        est = int(c["amount"] * r.uniform(1.02, 1.12)) // 1000 * 1000
        amt = c["amount"]
        start, end = c["start"], c["end"]
        if c.get("upgrade"):
            ys = c["upgrade"]
            share = _shares(amt, len(ys))
            amt_row = amt
        done = end if end <= W.today else None
        insp = (end + dt.timedelta(days=r.randint(2, 12))) if done else None
        paid = None
        if insp and insp <= W.today:
            paid = c.get("change", amt)
            if c.get("unitPrice"):
                paid = int(amt * r.uniform(0.82, 0.98)) // 1000 * 1000
        method = c["method"]
        memo = []
        if c.get("unitPrice"):
            memo.append("単価契約（予定総額）")
        if c.get("emergency"):
            memo.append("緊急対応")
        if c.get("bundle"):
            memo.append("定期補修一式（内訳は設計書による）")
        if c.get("upgrade"):
            memo.append(f"継続費（{era_fy(ys[0])}～{era_fy(ys[-1])}）年割額 {era_fy(ys[0])}：{share[0]:,}円")
        if c.get("purchase") and not c.get("unitPrice"):
            memo.append("納品日を完了日に記入")
        vals = {
            "番号": no, "契約番号": cno, "件名": title, "種別": c["kind"], "契約方式": method,
            "契約の相手方": c["vendor"], "予定価格（円）": est, "契約金額（円）": amt,
            "契約日": _date(start - dt.timedelta(days=r.randint(3, 25)) if not c.get("annual") else start, textual, r),
            "完了日": _date(done, textual, r), "検査日": _date(insp if insp and insp <= W.today else None, textual, r),
            "支払額（円）": paid, "所管": r.choice(["施設係", "保全係", "管理係"]), "摘要": "　".join(memo) or None,
        }
        if one_cell:
            if c.get("annual") or c.get("unitPrice"):
                vals["工期・履行期間"] = f"{era_fy(fy, 'abn')}.4～{era_fy(fy + 1, 'abn')}.3"
            else:
                vals["工期・履行期間"] = f"{wareki_dot(start)}～{wareki_dot(end)}"
        else:
            vals["工期（自）"] = _date(start, textual, r)
            vals["工期（至）"] = _date(end, textual, r)
        if c.get("purchase") and not c.get("unitPrice"):
            vals.pop("工期（自）", None)
            vals.pop("工期（至）", None)
        _row(S, ans, row, col, vals)
        _link(W, c, fname, S.title, row)
        kinds_total[c["kind"]] = kinds_total.get(c["kind"], 0) + amt
        row += 1
        if c.get("change"):
            chg = {"契約番号": cno + "-変1", "件名": "　〃　（第1回変更）", "契約金額（円）": c["change"],
                   "契約日": _date(end - dt.timedelta(days=r.randint(5, 20)), textual, r),
                   "摘要": f"変更契約（{'工期延長 ' + str((c['changeEnd'] - end).days) + '日・' if c['changeEnd'] != end else ''}増額 {c['change'] - amt:,}円）"}
            if not one_cell and c["changeEnd"] != end:
                chg["工期（至）"] = _date(c["changeEnd"], textual, r)
            _row(S, ans, row, col, chg)
            kinds_total[c["kind"]] += c["change"] - amt
            row += 1
    for c in cont:
        ys = c["upgrade"]
        share = _shares(c["amount"], len(ys))
        k = ys.index(fy)
        vals = {"契約番号": c.get("orderNo", "") + "（継続）", "件名": c["title"] + "（継続費）", "種別": c["kind"],
                "契約方式": "（" + era_fy(ys[0]) + "年度契約）", "契約の相手方": c["vendor"], "契約金額（円）": share[k],
                "摘要": f"年割額 {era_fy(fy)}：{share[k]:,}円（総額 {c['amount']:,}円）"}
        _row(S, ans, row, col, vals)
        _link(W, c, fname, S.title, row, years=[fy])
        row += 1
    # 小計と合計（数の値）
    row += 0
    for kname in ("工事", "委託", "物品"):
        S.put(row, col["件名"], f"小計（{kname}）", bold=True)
        S.put(row, col["契約金額（円）"], kinds_total.get(kname, 0), bold=True, fmt="#,##0")
        ans.rec("subtotal", {}, [ev(f"{_c(col['件名'])}{row}", f"小計（{kname}）")], sheet=S.title, r=row)
        row += 1
    S.put(row, col["件名"], "合計", bold=True)
    S.put(row, col["契約金額（円）"], sum(kinds_total.values()), bold=True, fmt="#,##0")
    ans.rec("total", {}, [ev(f"{_c(col['件名'])}{row}", "合計")], sheet=S.title, r=row)
    widths = {"番号": 5, "契約番号": 10, "件名": 46, "種別": 6, "契約方式": 14, "契約の相手方": 24, "摘要": 36}
    for h, i in col.items():
        S.width(i, widths.get(h, 12))
    S.ws.freeze_panes = S.ws.cell(row=hr + 1, column=4)


def _c(i):
    from openpyxl.utils import get_column_letter

    return get_column_letter(i)


def _row(S, ans, row, col, vals):
    evc = []
    f = {}
    for h, v in vals.items():
        if v is None or v == "":
            continue
        fmt = "#,##0" if isinstance(v, int) and "円" in h else None
        a = S.put(row, col[h], v, fmt=fmt, box=True, wrap=(h == "件名"))
        evc.append(ev(a, v))
        f[h] = v
    ans.rec("item", f, evc, sheet=S.title, r=row)


def _link(W, c, fname, sheet, row, years=None):
    how = "bundle" if c.get("bundle") else ("annual" if c.get("annual") else ("upgrade" if c.get("upgrade") else "contract"))
    for wid in c["works"]:
        w = W.widx[wid]
        if years and w["fy"] not in years:
            continue
        W.link(wid, fname, sheet=sheet, r=row, how=how, contract=c["id"])


def _shares(total, n):
    a = [int(total * x) // 1000 * 1000 for x in ([0.05, 0.45, 0.5] if n == 3 else [1 / n] * n)]
    a[-1] = total - sum(a[:-1])
    return a
