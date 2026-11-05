# -*- coding: utf-8 -*-
"""施設 C：し尿処理。機器台帳（文字の PDF の罫線の表。ページごとに見出しをくり返す）と、
設備点検記録（縦持ち。年度の途中で列が増え、見出しがもう一度出る）。"""
import datetime as dt
import os

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from common import (ROOT, TODAY, MAN_DAY_HOURS, answer_file, iso, rng, save_xlsx, write_json, write_text)

FAC_ID = "f-shiomigawa"
NAME = "【架空】汐見川衛生センター"
DIR = os.path.join(ROOT, FAC_ID)
F_LEDGER = "【架空】汐見川衛生センター_機器台帳.pdf"
F_REC = "【架空】汐見川衛生センター_設備点検記録_R6.xlsx"

# 台帳の行：(設備, 機器名称, 機器番号, 数量, 仕様, 設置年月, 製造者, 備考, [機器 id ...])
GROUPS = [
    ("1", "受入・貯留設備", [
        ("受入口", "R-101", "2基", "電動開閉扉 W1.2m", "平成10年3月", "架空機工㈱", "", ["E01", "E02"]),
        ("沈砂除去装置", "R-102", "1基", "スクリュー式 0.5㎥/h", "平成10年3月", "架空機工㈱", "", ["E03"]),
        ("破砕機", "R-103", "1台", "二軸せん断式 5.5kW", "平成10年3月", "架空機工㈱", "H22 刃物取替", ["E04"]),
        ("ドラムスクリーン", "R-104", "2台", "目幅 1.0mm 1.5kW", "平成10年3月", "架空スクリーン㈱", "", ["E05", "E06"]),
        ("受入貯留槽", "R-105", "1槽", "RC造 有効容量 240㎥", "平成10年3月", "―", "", ["E07"]),
        ("貯留槽撹拌ブロワ", "R-106", "2台", "ルーツ式 7.5kW", "平成10年3月", "架空ブロワ㈱", "1台予備", ["E08", "E09"]),
    ]),
    ("2", "主処理設備（膜分離高負荷生物脱窒）", [
        ("生物反応槽", "M-201", "1槽", "RC造 有効容量 960㎥", "平成10年3月", "―", "", ["E10"]),
        ("曝気ブロワ", "M-202", "3台", "ターボ式 37kW", "平成10年3月", "架空ブロワ㈱", "2台運転 1台予備", ["E11", "E12", "E13"]),
        ("循環ポンプ", "M-203", "2台", "水中ポンプ 11kW", "平成10年3月", "架空ポンプ製作所", "", ["E14", "E15"]),
        ("浸漬膜ユニット", "M-204", "8ﾕﾆｯﾄ", "平膜 公称孔径 0.4μm", "平成27年10月", "架空膜技研㈱", "H27 全数更新", ["E16"]),
    ]),
    ("3", "高度処理設備", [
        ("活性炭吸着塔", "A-301", "2基", "下向流 充填量 6㎥", "平成10年3月", "架空水処理㈱", "", ["E17", "E18"]),
    ]),
    ("4", "汚泥処理設備", [
        ("汚泥脱水機", "S-401", "2台", "スクリュープレス 30kg-DS/h", "平成10年3月", "架空脱水機㈱", "", ["E19", "E20"]),
        ("汚泥乾燥機", "S-402", "1台", "間接加熱式 150kg/h", "平成27年10月", "架空乾燥機㈱", "H27 増設", ["E21"]),
    ]),
    ("5", "脱臭設備", [
        ("脱臭ファン", "D-501", "2台", "ターボファン 22kW", "平成10年3月", "架空送風機㈱", "", ["E22", "E23"]),
        ("生物脱臭塔", "D-502", "1基", "充填塔式 120㎥/min", "平成10年3月", "架空水処理㈱", "", ["E24"]),
    ]),
    ("6", "電気設備", [
        ("受変電設備", "E-601", "1式", "6.6kV 1回線受電 750kVA", "平成10年3月", "架空電機㈱", "", ["E25"]),
        ("非常用発電機", "E-602", "1台", "ディーゼル 200kVA", "平成10年3月", "架空発電機㈱", "", ["E26"]),
        ("中央監視装置", "E-603", "1式", "監視盤・PLC", "令和元年12月", "架空制御㈱", "R元 更新", ["E27"]),
    ]),
]
UNIT_NO = {"E01": "No.1", "E02": "No.2", "E05": "No.1", "E06": "No.2", "E08": "No.1", "E09": "No.2", "E11": "No.1", "E12": "No.2",
           "E13": "No.3", "E14": "No.1", "E15": "No.2", "E17": "No.1", "E18": "No.2", "E19": "No.1", "E20": "No.2", "E22": "No.1",
           "E23": "No.2"}


def year_of(s):
    if s.startswith("平成"):
        return 1988 + int(s[2:s.index("年")])
    if s.startswith("令和元"):
        return 2019
    return 2018 + int(s[2:s.index("年")])


def write_ledger():
    from pdfkit import new_canvas, table, text
    path = os.path.join(DIR, "files", F_LEDGER)
    c, (W, H) = new_canvas(path, f"{NAME} 機器台帳", NAME + " 施設係", land=True)
    head = ["No.", "設備・機器名称", "機器番号", "数量", "主要仕様", "設置年月", "製造者", "備考"]
    widths = [36, 180, 64, 48, 170, 80, 110, 94]
    lines = []
    for gno, gname, items in GROUPS:
        lines.append(("parent", [gno, gname, "", "", "", "", "", ""], gname, None))
        for k, it in enumerate(items, 1):
            nm, code, qty, spec, ym, mk, memo, eqs = it
            lines.append(("item", [f"{gno}-{k}", "　" + nm, code, qty, spec, ym, mk, memo], gname, it))
    PER = 13
    pages = [lines[i:i + PER] for i in range(0, len(lines), PER)]
    recs = []
    eq_rows = {}
    seq = 0
    for p, chunk in enumerate(pages, 1):
        text(c, 40, H - 40, f"{NAME}　機器台帳（完成図書 第2編 機器仕様 抜粋）", 13)
        text(c, W - 40, H - 40, "竣工 平成10年3月", 9, "right")
        rows = [head] + [x[1] for x in chunk]
        y = table(c, 40, H - 60, widths, rows, row_h=30, size=9,
                  aligns=["center", "left", "center", "center", "left", "center", "left", "left"], head_rows=1)
        text(c, W / 2, 28, f"- {p} -", 9, "center")
        if p < len(pages):
            text(c, W - 40, y - 14, "（次頁へ続く）", 8, "right")
        c.showPage()
        for kind, cells, gname, it in chunk:
            if kind == "parent":
                recs.append(dict(seq=seq, kind="parent", fields={"path": [gname], "No": cells[0]}))
            else:
                nm, code, qty, spec, ym, mk, memo, eqs = it
                f = {"path": [gname, nm], "No": cells[0], "code": code, "数量": qty, "install_year": year_of(ym), "設置年月": ym,
                     "製造者": mk, "specs": [spec] + ([memo] if memo else [])}
                recs.append(dict(seq=seq, kind="item", fields=f))
                for e in eqs:
                    eq_rows.setdefault(e, []).append(dict(file=F_LEDGER, seq=seq))
            seq += 1
    c.save()
    return recs, eq_rows


# ------------------------------------------------------------------ 設備点検記録（R6）
INSP = [
    # (機器, 設備の書き方, 機器名の書き方の候補, 点検項目, 単位, 値の範囲, 人数, 時間, 毎月か)
    ("E11", "主処理", ["曝気ブロワNo.1", "曝気ﾌﾞﾛﾜ №1"], "振動・軸受温度", "mm/s", (1.2, 2.6), 1, 0.5),
    ("E12", "主処理", ["曝気ブロワNo.2", "曝気ﾌﾞﾛﾜ №2", "曝気ブロワ(2)"], "振動・軸受温度", "mm/s", (1.2, 2.6), 1, 0.5),
    ("E13", "主処理", ["曝気ブロワNo.3", "曝気ブロワ(3)"], "振動・軸受温度", "mm/s", (1.0, 2.2), 1, 0.5),
    ("E19", "汚泥処理", ["1号脱水機", "汚泥脱水機 1号機"], "スクリーン目詰まり・駆動部", "", None, 2, 1.5),
    ("E20", "汚泥処理", ["2号脱水機", "汚泥脱水機 2号機"], "スクリーン目詰まり・駆動部", "", None, 2, 1.5),
    ("E22", "脱臭", ["脱臭ファン No.1", "脱臭ファン1"], "振動・ベルト張り", "mm/s", (1.5, 3.0), 1, 0.5),
    ("E25", "電気", ["受変電設備"], "月次点検（外観・絶縁監視）", "", None, 1, 1.0),
    ("E26", "電気", ["非常用発電機", "自家発"], "無負荷試運転", "分", (10, 10), 1, 1.0),
]
MISS = {("E25", 2024, 8)}          # 計画の欠け：受変電の 8 月の月次点検が無い
OUTSOURCE_FROM = dt.date(2024, 10, 1)
STAFF = ["山田", "佐藤", "井上", "木村"]
REPAIRS = [  # (日, 機器, 設備, 名前, 項目, 結果, 人数, 時間, 業者)
    (dt.date(2024, 6, 18), "E20", "汚泥処理", "2号脱水機", "スクリーン目詰まり", "不良 → スクリーン洗浄・ブラシ交換", 2, 3.0, None),
    (dt.date(2024, 11, 12), "E12", "主処理", "曝気ﾌﾞﾛﾜ №2", "振動・軸受温度", "振動大 → Vベルト交換", 2, 2.5, "架空ブロワ㈱"),
    (dt.date(2025, 2, 6), "E22", "脱臭", "脱臭ファン No.1", "振動・ベルト張り", "ベルト摩耗 → 交換", 2, 2.0, "架空送風機㈱"),
]


def write_records():
    R = rng("C-rec")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "点検記録"
    ws["A1"] = f"{NAME}　設備点検記録（令和6年度）"
    ws["A1"].font = Font(name="ＭＳ ゴシック", size=13, bold=True)
    gray = PatternFill("solid", fgColor="D9D9D9")
    head1 = ["点検日", "設備", "機器名", "点検項目", "結果", "測定値", "単位", "作業時間", "実施者"]
    head2 = ["点検日", "設備", "機器名", "委託業者", "点検項目", "結果", "測定値", "単位", "作業時間", "実施者"]
    for c, t in enumerate(head1, 1):
        ws.cell(3, c, t).fill = gray
    r = 4
    entries = []
    months = [(2024, m) for m in range(4, 13)] + [(2025, m) for m in range(1, 4)]
    for y, m in months:
        base = dt.date(y, m, 1)
        for it in INSP:
            eid, setsubi, names, item, unit, rngv, ppl, hrs = it
            if (eid, y, m) in MISS:
                continue
            day = base + dt.timedelta(days=R.randint(2, 20))
            while day.weekday() >= 5:
                day += dt.timedelta(days=1)
            if unit and rngv:
                val = rngv[0] if rngv[0] == rngv[1] else round(R.uniform(*rngv), 1)
            else:
                val = None
            entries.append(dict(date=day, eid=eid, setsubi=setsubi, name=R.choice(names), item=item, result="良", val=val,
                                unit=unit, ppl=ppl, hrs=hrs, vendor=None, kind="INSPECT"))
    for d, eid, setsubi, nm, item, res, ppl, hrs, ven in REPAIRS:
        entries.append(dict(date=d, eid=eid, setsubi=setsubi, name=nm, item=item, result=res, val=None, unit="", ppl=ppl, hrs=hrs,
                            vendor=ven, kind="REPLACE" if "交換" in res else "OVERHAUL"))
    entries.sort(key=lambda e: (e["date"], e["eid"]))
    # 10 月から委託：業者の列が増える
    for e in entries:
        if e["date"] >= OUTSOURCE_FROM and e["vendor"] is None and e["eid"] in ("E25", "E26"):
            e["vendor"] = "（一財）架空電気保安協会" if e["eid"] == "E25" else "架空発電機㈱"
        elif e["date"] >= OUTSOURCE_FROM and e["vendor"] is None:
            e["vendor"] = "直営"
    recs = []
    works = []
    prev_date = None
    switched = False
    for e in entries:
        if e["date"] >= OUTSOURCE_FROM and not switched:
            switched = True
            r += 1
            ws.cell(r, 1, "※令和6年10月から点検の一部を委託（委託業者の欄を追加）")
            r += 1
            for c, t in enumerate(head2, 1):
                ws.cell(r, c, t).fill = gray
            r += 1
        who = "・".join(R.sample(STAFF, e["ppl"]))
        hrs_txt = f"{e['hrs']:g}h"
        cells = [e["date"], e["setsubi"], e["name"]]
        if switched:
            cells.append(e["vendor"])
        cells += [e["item"], e["result"], e["val"], e["unit"] or None, hrs_txt, who]
        same_day = prev_date == e["date"]
        for c, v in enumerate(cells, 1):
            if c == 1 and same_day:
                ws.cell(r, 1, "〃")
                continue
            ws.cell(r, c, v)
        ws.cell(r, 1).number_format = "yyyy/m/d"
        md = round(e["ppl"] * e["hrs"] / MAN_DAY_HOURS, 3)
        f = {"date": iso(e["date"]), "設備": e["setsubi"], "機器名": e["name"], "点検項目": e["item"], "結果": e["result"],
             "作業時間": hrs_txt, "実施者": who, "manDays": md, "manDaysText": f"{hrs_txt}（{e['ppl']}名）"}
        if e["val"] is not None:
            f["測定値"] = e["val"]
        if e["unit"]:
            f["単位"] = e["unit"]
        if switched:
            f["委託業者"] = e["vendor"]
        recs.append(dict(sheet="点検記録", r=r, kind="item", fields=f))
        works.append(dict(e=e, r=r, md=md))
        prev_date = e["date"]
        r += 1
    for col, w in zip("ABCDEFGHIJ", (11, 9, 18, 22, 26, 22, 8, 7, 9, 12)):
        ws.column_dimensions[col].width = w
    save_xlsx(wb, os.path.join(DIR, "files", F_REC), f"{NAME} 設備点検記録 R6", NAME + " 施設係")
    return recs, works


def build():
    led_recs, eq_rows = write_ledger()
    rec_recs, wrows = write_records()
    answer_file(DIR, F_LEDGER, False, led_recs, note="ページごとに見出しをくり返す罫線の表。設備の行は parent。数量でまとめた行は、機器 1 台ずつの世界では同じ行を指す。")
    answer_file(DIR, F_REC, False, rec_recs, note="R6.10 から「委託業者」の列が 4 列目に入り、見出しがもう一度出る（後ろの列が 1 つずれる）。点検日の〃は上の行と同じ日に直した。")
    names = {}
    for x in wrows:
        names.setdefault(x["e"]["eid"], x["e"]["name"])
    eq_list = []
    for gno, gname, items in GROUPS:
        for nm, code, qty, spec, ym, mk, memo, eqs in items:
            for e in eqs:
                n = nm + (f" {UNIT_NO[e]}" if e in UNIT_NO else "")
                nn = {F_LEDGER: nm}
                if e in names:
                    nn[F_REC] = names[e]
                eq_list.append(dict(id=e, name=n, names=nn, furnace=None, install_year=year_of(ym), code=code,
                                    path=[gname, nm] + ([UNIT_NO[e]] if e in UNIT_NO else []), rows=eq_rows.get(e, [])))
    wl = []
    ws_sorted = sorted(wrows, key=lambda x: (x["e"]["date"], x["r"]))
    for i, x in enumerate(ws_sorted, 1):
        e = x["e"]
        vend = e["vendor"] if e["vendor"] and e["vendor"] != "直営" else "直営（施設係）"
        lab = [g for g in eq_list if g["id"] == e["eid"]][0]["name"] + " " + (e["item"] if e["kind"] == "INSPECT" else e["result"].split("→")[-1].strip())
        wl.append(dict(id=f"W{i:04d}", label=lab, attribute=e["kind"], status="actual", fiscal_year=2024, equipment=[e["eid"]],
                       start=iso(e["date"]), end=iso(e["date"]), man_days=x["md"], days=1, vendor=vend,
                       contract=("受変電設備 保安管理業務（R6）" if e["eid"] == "E25" else ("非常用発電機 点検業務（R6.10～）" if (e["eid"] == "E26" and e["date"] >= OUTSOURCE_FROM) else
                                 ("修繕（単価契約）" if e["vendor"] not in (None, "直営") else "直営"))),
                       rows=[dict(file=F_REC, sheet="点検記録", r=x["r"])]))
    n = len(wl)
    unrec_w = dict(id=f"W{n + 1:04d}", label="非常用発電機 負荷運転（年次）", attribute="INSPECT", status="actual", fiscal_year=2024,
                   equipment=["E26"], start="2024-12-11", end="2024-12-11", man_days=1.5, days=1, vendor="架空発電機㈱",
                   contract="非常用発電機 点検業務（R6.10～）", rows=[])
    wl.append(unrec_w)
    world = {
        "schema": "moyai.answer.world/0",
        "facility": {"id": FAC_ID, "name": NAME, "industry": "night-soil",
                     "profile": {"process": "膜分離高負荷生物脱窒処理方式", "capacity_kl_per_day": 80, "completed": 1998,
                                 "sludge": "脱水・乾燥", "contract": "直営（R6.10 から一部委託）"}},
        "fiscal_year_start_month": 4, "man_day_hours": MAN_DAY_HOURS, "today": iso(TODAY),
        "equipment": eq_list, "works": wl,
        "unrecorded": [dict(work=unrec_w["id"], reason="委託業者が自社の報告書だけに書き、点検記録に転記していない")],
        "defects": [dict(kind="法令の点検の抜け（受変電設備の月次点検）", where=f"{F_REC} 点検記録：令和6年8月の受変電設備の月次点検の行が無い",
                         check="受変電設備の月次点検（毎月）")],
    }
    write_json(os.path.join(DIR, "answer", "world.json"), world)
    write_text(os.path.join(DIR, "user.md"), USER_MD)
    return dict(files=[F_LEDGER, F_REC], works=len(wl))


USER_MD = """# 汐見川衛生センター（架空）の担当者が答えられること

施設係の担当です。し尿と浄化槽汚泥を処理する施設で、平成10年3月に竣工しました。

## ファイル
- 機器台帳：完成図書の機器仕様の章を抜き出して PDF にしたものです。台数はまとめて書いています（「曝気ブロワ 3台」は 3 台を 1 行に）。保全の計画ではありません。
- 設備点検記録（R6）：令和6年度の月例の点検と、点検で見つけた不具合の処置を 1 行ずつ付けたものです。

## 欄と記号
- 点検日の 〃 は上の行と同じ日です。
- 令和6年10月から、電気と発電機の点検を委託に出しました。そこから「委託業者」の列を足しています（直営は「直営」）。列が 1 つ増えたので、後ろの列は 1 つずつ右にずれています。
- 作業時間は 1 人あたりの時間（h）です。実施者が 2 人なら 2 人がその時間です。1 人・日は 8 時間です。
- 台帳の「設置年月」は和暦です。備考の「H27 全数更新」「H27 増設」は平成27年です。

## 呼び名
- 曝気ブロワは No.1～No.3。曝気ﾌﾞﾛﾜ №2、曝気ブロワ(2) も 2 号機です。
- 1号脱水機 と 汚泥脱水機 1号機 は同じです。
- 自家発 は非常用発電機のことです。
- 号炉はありません（系列も 1 系列）。

## 知っていること
- 8 月の受変電の月次点検は、記録が見当たりません。
- 非常用発電機の年 1 回の負荷運転（12 月）は委託業者がしましたが、こちらの記録には書いていません。
"""
