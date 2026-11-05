# -*- coding: utf-8 -*-
"""施設 2：【架空】朧谷環境工場（ごみ焼却・流動床）

資料：発注台帳（xlsx。1 シートに年度ごとの表、年度の合計が上、途中で見出しが変わる）・
日常点検表の写真（jpg。紙の帳票 1 日 1 枚を撮ったもの）
"""
import datetime as dt
import math
import os

import openpyxl
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from common import (Facility, TODAY, TMP, ROOT, iso, set_props, save_wb, wareki, wareki_long,
                    rl_canvas, write_text, WEEK)

D = dt.date
FID = "f-oboroya"
NAME = "【架空】朧谷環境工場"
F_LEDGER = "【架空】朧谷環境工場_発注台帳_R3-R8.xlsx"
F_PHOTO = "【架空】朧谷環境工場_日常点検表_R8.9.17.jpg"

V = {
    "furn": "千草炉機工業㈱", "crane": "桑染クレーン㈱", "scale": "砥粉計量器㈱", "elec": "紺青電気保安協同組合",
    "meas": "若竹環境分析㈱", "eg": "黄櫨発電機サービス㈱", "fire": "鉄紺防災設備㈱", "prec": "利久環境技術センター㈱",
    "dcs": "瓶覗システム㈱", "ash": "柿渋プラント㈱",
}


def build():
    F = Facility(FID, NAME, "waste-incineration", {
        "furnace": "fluidized-bed", "capacity_t_per_day": 90, "lines": 2, "turbine": False,
        "dust": "BF", "ash": "セメント固化", "contract": "単年度", "upgrade": "done-2016-2018",
        "completed": 1999,
    }, 2)
    R = F.rng
    E = F.eq
    E("G01", "ごみクレーン 1号", ["受入供給設備", "ごみクレーン", "1号"], None, 1999)
    E("G02", "ごみクレーン 2号", ["受入供給設備", "ごみクレーン", "2号"], None, 1999)
    E("G03", "計量機", ["受入供給設備", "計量機"], None, 1999)
    E("G04", "流動床式焼却炉 1号炉", ["燃焼設備", "流動床式焼却炉", "1号炉"], 1, 1999)
    E("G05", "流動床式焼却炉 2号炉", ["燃焼設備", "流動床式焼却炉", "2号炉"], 2, 1999)
    E("G06", "流動砂循環装置 1号炉", ["燃焼設備", "流動砂循環装置", "1号炉"], 1, 1999)
    E("G07", "流動砂循環装置 2号炉", ["燃焼設備", "流動砂循環装置", "2号炉"], 2, 1999)
    E("G08", "ガス冷却室 1号炉", ["燃焼ガス冷却設備", "ガス冷却室", "1号炉"], 1, 1999)
    E("G09", "ガス冷却室 2号炉", ["燃焼ガス冷却設備", "ガス冷却室", "2号炉"], 2, 1999)
    E("G10", "ろ過式集じん器 1号炉", ["排ガス処理設備", "ろ過式集じん器", "1号炉"], 1, 2017)
    E("G11", "ろ過式集じん器 2号炉", ["排ガス処理設備", "ろ過式集じん器", "2号炉"], 2, 2017)
    E("G12", "誘引送風機 1号炉", ["通風設備", "誘引送風機", "1号炉"], 1, 1999)
    E("G13", "誘引送風機 2号炉", ["通風設備", "誘引送風機", "2号炉"], 2, 1999)
    E("G14", "飛灰固化装置", ["灰出し設備", "飛灰固化装置"], None, 2017)
    E("G15", "受変電設備", ["電気設備", "受変電設備"], None, 1999)
    E("G16", "非常用発電機", ["電気設備", "非常用発電機"], None, 1999)
    E("G17", "中央監視制御装置", ["計装設備", "中央監視制御装置"], None, 2017)
    E("G18", "消防用設備", ["建築設備", "消防用設備"], None, 1999)
    E("G19", "施設全体", ["施設全体"], None, 1999)
    FUR = {1: ["G04", "G06", "G08", "G10", "G12"], 2: ["G05", "G07", "G09", "G11", "G13"]}

    contracts = []  # dict(fy, title, vendor, cdate, start, end, amount_yen, category, method, works, memo, change)
    seqno = {}

    def C(fy, title, vendor, cdate, start, end, amount, category="委託", method="随意契約", memo=None,
          change=None, comment=None):
        seqno[fy] = seqno.get(fy, 0) + 1
        c = dict(fy=fy, title=title, vendor=vendor, cdate=cdate, start=start, end=end,
                 amount=amount, category=category, method=method, memo=memo, change=change,
                 comment=comment, works=[], no=seqno[fy])
        contracts.append(c)
        return c

    def W(c, label, attr, eqs, s, e, **kw):
        st = "actual" if e < TODAY else "planned"
        w = F.work(label, attr, st, c["fy"], eqs, start=s, end=e, days=(e - s).days + 1, vendor=c["vendor"],
                   contract=c["title"], precision=kw.pop("precision", False), **kw)
        c["works"].append(w)
        return w

    def amt(base):
        return int(round(base * (1 + R.uniform(-0.06, 0.08)) / 1000.0)) * 1000

    for fy in range(2021, 2027):
        R_ = wareki(D(fy, 4, 1))
        lab = f"R{fy - 2018}"
        # 年間の委託（4 月 1 日の契約）
        a = D(fy, 4, 1)
        z = D(fy + 1, 3, 31)
        s1 = D(fy, 6, 2) + dt.timedelta(days=R.randint(0, 6))
        e1 = s1 + dt.timedelta(days=24)
        s2 = D(fy, 9, 1) + dt.timedelta(days=R.randint(0, 4))
        e2 = s2 + dt.timedelta(days=24)
        c = C(fy, f"{lab}年度 中央監視制御装置保守点検業務委託", V["dcs"], D(fy, 3, 25) if False else a, a, z,
              amt(5_800_000))
        for k, (ss, ee) in ((1, (s1, e1)), (2, (s2, e2))):
            W(c, f"中央監視制御装置 定期点検（{k}号炉停止時）", "INSPECT", ["G17"], ee - dt.timedelta(days=3),
              ee - dt.timedelta(days=2))
        c = C(fy, f"{lab}年度 排ガス等測定分析業務委託（単価契約）", V["meas"], a, a, z, amt(3_300_000),
              method="単価契約", memo="年4回（ばいじん・NOx・SOx・HCl・DXN は年1回）")
        for m, dd in ((5, 21), (8, 20), (11, 19), (2, 18)):
            yy = fy if m >= 4 else fy + 1
            d = D(yy, m, dd)
            W(c, f"排ガス測定（{m}月）", "INSPECT", ["G19"], d, d)
        c = C(fy, f"{lab}年度 {'１' if fy % 2 else '1'}号炉定期整備工事", V["furn"], s1 - dt.timedelta(days=30), s1, e1,
              amt(36_000_000), category="工事", method="指名競争入札")
        W(c, "1号炉 定期整備工事", "OVERHAUL", FUR[1], s1, e1)
        c2 = C(fy, f"{lab}年度 2号炉定期整備工事", V["furn"], s2 - dt.timedelta(days=30), s2, e2,
               amt(35_000_000), category="工事", method="指名競争入札")
        W(c2, "2号炉 定期整備工事", "OVERHAUL", FUR[2], s2, e2)
        if fy == 2023:
            c2["change"] = (D(2023, 10, 6), c2["amount"] + 1_320_000, "流動砂の追加補充による増額")
        if fy == 2025:
            c2["change"] = (D(2025, 9, 19), c2["amount"] + 2_640_000, "ガス冷却室 噴霧ノズル追加取替")
        d = e1 + dt.timedelta(days=R.randint(20, 40))
        c = C(fy, f"{lab}年度 受変電設備年次点検業務委託", V["elec"], a, d, d, amt(980_000))
        W(c, "受変電設備 年次点検（全停電）", "INSPECT", ["G15"], d, d)
        W(c, "非常用発電機 負荷運転（全停電時）", "INSPECT", ["G16"], d, d)
        d = D(fy, 11, 10) + dt.timedelta(days=R.randint(0, 5))
        c = C(fy, f"{lab}年度 計量機定期点検{'・検定' if fy % 2 == 1 else ''}業務委託", V["scale"], a, d, d,
              amt(520_000 if fy % 2 == 0 else 880_000))
        W(c, "計量機 定期点検", "INSPECT", ["G03"], d, d)
        if fy % 2 == 1:
            W(c, "計量機 定期検査（計量法）", "INSPECT", ["G03"], d, d)
        d = D(fy + 1, 2, 2) + dt.timedelta(days=R.randint(0, 6))
        c = C(fy, f"{lab}年度 ごみクレーン年次点検整備業務委託", V["crane"], a, d, d + dt.timedelta(days=3), amt(2_100_000))
        W(c, "ごみクレーン 1号 年次自主検査", "INSPECT", ["G01"], d, d + dt.timedelta(days=1))
        W(c, "ごみクレーン 2号 年次自主検査", "INSPECT", ["G02"], d + dt.timedelta(days=2), d + dt.timedelta(days=3))
        c = C(fy, f"{lab}年度 消防用設備等点検業務委託", V["fire"], a, a, z, amt(450_000))
        for m in (7, 1):
            yy = fy if m >= 4 else fy + 1
            d = D(yy, m, 14)
            W(c, f"消防用設備等点検（{'機器' if m == 7 else '総合'}）", "INSPECT", ["G18"], d, d)
        d = e1 + dt.timedelta(days=3)
        c = C(fy, f"{lab}年度 非常用発電機点検業務委託", V["eg"], a, d, d, amt(390_000))
        W(c, "非常用発電機 年次点検", "INSPECT", ["G16"], d, d)
        if fy % 2 == 0:
            ss = s2 + dt.timedelta(days=5)
            c = C(fy, f"{lab}年度 飛灰固化装置整備工事", V["ash"], ss - dt.timedelta(days=21), ss,
                  ss + dt.timedelta(days=4), amt(4_400_000), category="工事", method="随意契約")
            W(c, "飛灰固化装置 混練機・セメント供給機 整備", "OVERHAUL", ["G14"], ss, ss + dt.timedelta(days=4))
        if fy in (2021, 2024):
            d = D(fy, 10, 14)
            c = C(fy, f"{lab}年度 精密機能検査業務委託", V["prec"], D(fy, 7, 1), d, d + dt.timedelta(days=2),
                  amt(3_900_000))
            W(c, "精密機能検査", "INSPECT", ["G19"], d, d + dt.timedelta(days=2), precision=True)
    # 緊急の修繕
    c = C(2022, "2号炉 流動砂循環装置 緊急修繕", V["furn"], D(2022, 12, 7), D(2022, 12, 7), D(2022, 12, 9),
          1_826_000, category="修繕", method="随意契約（緊急）",
          comment="夜間に振動篩が停止。見積合せを省き緊急随契（課長決裁 12/7）")
    W(c, "流動砂循環装置 2号炉 振動篩 緊急修繕", "OVERHAUL", ["G07"], D(2022, 12, 7), D(2022, 12, 9))
    c = C(2024, "1号炉 誘引送風機 軸受 緊急取替", V["furn"], D(2024, 8, 26), D(2024, 8, 27), D(2024, 8, 29),
          2_563_000, category="修繕", method="随意契約（緊急）", memo="軸受温度上昇のため停止")
    W(c, "誘引送風機 1号炉 軸受 取替", "REPLACE", ["G12"], D(2024, 8, 27), D(2024, 8, 29))
    c = C(2025, "ごみクレーン 1号 バケット油圧ユニット 緊急修繕", V["crane"], D(2026, 1, 13), D(2026, 1, 14),
          D(2026, 1, 15), 1_408_000, category="修繕", method="随意契約（緊急）")
    W(c, "ごみクレーン 1号 バケット油圧ユニット 修繕", "OVERHAUL", ["G01"], D(2026, 1, 14), D(2026, 1, 15))
    # 今日より後に契約するものは載せない（台帳は今日までの分）
    contracts = [c for c in contracts if c["cdate"] <= TODAY]
    keep = {w["id"] for c in contracts for w in c["works"]}
    F.works = [w for w in F.works if w["id"] in keep]

    write_ledger(F, contracts)
    write_photo(F)
    F.defects.append({"kind": "精密機能検査の周期", "where": f"{F_LEDGER} の R7・R8 の表に精密機能検査の契約が無い（前回 R6。次は R9 の見込み）",
                      "check": "精密機能検査の周期（推奨：3 年に 1 回以上）。この施設では欠けではない（確かめ用）"})
    F.defects.append({"kind": "法令の点検の抜け", "where": f"{F_LEDGER} の全年度でごみクレーンの性能検査（クレーン則）の契約が無い（年次の点検整備だけ）",
                      "check": "法令の点検の抜け（クレーン等安全規則の性能検査）"})
    write_user(F)
    F.write_answers()
    return F


# ======================================================================
THIN = Side(style="thin", color="000000")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def write_ledger(F, contracts):
    wb = openpyxl.Workbook()
    set_props(wb, "【架空】朧谷環境工場 発注台帳")
    ws = wb.active
    ws.title = "発注台帳"
    SH = ws.title
    recs = F.file(F_LEDGER, False)
    f9 = Font(name="ＭＳ Ｐゴシック", size=9)
    fb = Font(name="ＭＳ Ｐゴシック", size=9, bold=True)
    ws["A1"] = "【架空】朧谷環境工場　修繕・委託 発注台帳（令和3年度～）"
    ws["A1"].font = Font(name="ＭＳ Ｐゴシック", size=13, bold=True)
    ws["A2"] = "【架空のデータ】　施設係　　※R5 までは金額を千円、R6 からは円で記入"
    ws["A2"].font = f9
    total = sum(c["change"][1] if c["change"] else c["amount"] for c in contracts)
    ws["A3"] = "総合計（R3～R8・円）"
    ws["E3"] = total
    ws["E3"].number_format = "#,##0"
    ws["A3"].font = fb
    ws["E3"].font = fb
    recs.append({"sheet": SH, "r": 3, "kind": "total", "fields": {}})
    r = 5
    OLD = ["No.", "件　名", "業者名", "契約日", "工　期", "契約金額（千円）", "備　考"]
    NEW = ["No.", "契約番号", "件　名", "区分", "契約方法", "業者名", "契約日", "着手", "完了", "契約金額（円）",
           "変更後金額（円）", "備　考"]
    for fy in range(2021, 2027):
        cs = [c for c in contracts if c["fy"] == fy]
        cs.sort(key=lambda c: (c["cdate"], c["no"]))
        old = fy <= 2023
        lab = "令和" + str(fy - 2018) + "年度"
        # 年度の合計（自分の年度の行の上）
        s = sum((c["change"][1] if c["change"] else c["amount"]) for c in cs)
        ws.cell(r, 1, f"{lab}　計")
        ws.cell(r, 3 if old else 4, f"{len(cs)}件")
        if old:
            ws.cell(r, 6, round(s / 1000)).number_format = "#,##0"
        else:
            ws.cell(r, 10, s).number_format = "#,##0"
        for cc in range(1, (7 if old else 12) + 1):
            ws.cell(r, cc).fill = PatternFill("solid", fgColor="FFF2CC")
            ws.cell(r, cc).font = fb
            ws.cell(r, cc).border = BOX
        recs.append({"sheet": SH, "r": r, "kind": "subtotal", "fields": {}})
        r += 1
        hdr = OLD if old else NEW
        for i, t in enumerate(hdr, 1):
            cl = ws.cell(r, i, t)
            cl.font = fb
            cl.border = BOX
            cl.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cl.fill = PatternFill("solid", fgColor="DDEBF7")
        r += 1
        for i, c in enumerate(cs, 1):
            f = {"no": i, "title": c["title"], "vendor": c["vendor"], "contract_date": iso(c["cdate"]),
                 "start": iso(c["start"]), "end": iso(c["end"])}
            memo = c["memo"]
            if old:
                vals = [i, c["title"], c["vendor"], wareki(c["cdate"]),
                        f"{wareki(c['start'])}～{wareki(c['end'])}" if c["start"] != c["end"] else wareki(c["start"]),
                        round(c["amount"] / 1000)]
                f["amount"] = round(c["amount"] / 1000)
                f["unit"] = "千円"
                if c["change"]:
                    cd, na, why = c["change"]
                    extra = f"変更契約（{wareki(cd)}）{why}　変更後 {round(na / 1000):,}千円"
                    memo = f"{memo}\n{extra}" if memo else extra
                if c["category"] == "修繕":
                    memo = (memo + "\n" if memo else "") + "緊急対応"
                for j, v in enumerate(vals, 1):
                    ws.cell(r, j, v)
                ws.cell(r, 6).number_format = "#,##0"
                if memo:
                    ws.cell(r, 7, memo)
                    ws.cell(r, 7).alignment = Alignment(wrap_text=True, vertical="top")
                    f["memo"] = memo
                ncol = 7
                cref = f"B{r}"
            else:
                no = f"R{fy - 2018}-{'工' if c['category'] == '工事' else ('修' if c['category'] == '修繕' else '委')}-{c['no']:03d}"
                vals = [i, no, c["title"], c["category"], c["method"], c["vendor"]]
                for j, v in enumerate(vals, 1):
                    ws.cell(r, j, v)
                for j, dv, fmt in ((7, c["cdate"], "yyyy/m/d"), (8, c["start"], '[$-ja-JP]ge.m.d'),
                                   (9, c["end"], '[$-ja-JP]ge.m.d')):
                    cl = ws.cell(r, j, dt.datetime(dv.year, dv.month, dv.day))
                    cl.number_format = fmt
                ws.cell(r, 10, c["amount"]).number_format = "#,##0"
                f.update(contract_no=no, category=c["category"], method=c["method"], amount=c["amount"], unit="円")
                if c["change"]:
                    cd, na, why = c["change"]
                    ws.cell(r, 11, na).number_format = "#,##0"
                    f["changed_amount"] = na
                    memo = f"{memo}　" if memo else ""
                    memo += f"{wareki(cd)} 変更（{why}）"
                if memo:
                    ws.cell(r, 12, memo)
                    f["memo"] = memo
                ncol = 12
                cref = f"C{r}"
            if c["comment"]:
                ws[cref].comment = Comment(c["comment"], "施設係")
                f["comments"] = {cref: c["comment"]}
            for cc in range(1, ncol + 1):
                ws.cell(r, cc).border = BOX
                if ws.cell(r, cc).font != fb:
                    ws.cell(r, cc).font = f9
            recs.append({"sheet": SH, "r": r, "kind": "item", "fields": f})
            for w in c["works"]:
                F.link(w, F_LEDGER, sheet=SH, r=r)
                F.eq_name(w["equipment"], F_LEDGER, c["title"])
            r += 1
        r += 1  # 表のあいだの空の行
    for col, wdt in zip("ABCDEFGHIJKL", [5, 13, 40, 9, 16, 22, 11, 10, 10, 14, 14, 36]):
        ws.column_dimensions[col].width = wdt
    # 旧様式の列の幅（B に件名が来る）は見た目だけの差。
    save_wb(wb, F.path_of(F_LEDGER))


# ======================================================================
CHECK_ROWS = [
    # (設備, 点検項目, 基準, 1号炉, 2号炉, 共通, 備考, eqs)
    ("ごみクレーン", "走行・巻上の異音", "異常なし", None, None, "✓", "", ["G01", "G02"]),
    ("ごみクレーン", "油圧ユニット 油量", "規定範囲", None, None, "✓", "", ["G01", "G02"]),
    ("計量機", "ゼロ点（kg）", "±10 以内", None, None, "0", "", ["G03"]),
    ("焼却炉", "炉内温度（℃）", "850 以上", "872", "休", None, "", ["G04"]),
    ("焼却炉", "砂層差圧（kPa）", "4.0～6.0", "5.1", "休", None, "", ["G04"]),
    ("流動砂循環装置", "異音・漏れ", "異常なし", "✓", "休", None, "", ["G06"]),
    ("ガス冷却室", "出口温度（℃）", "200 以下", "176", "休", None, "", ["G08"]),
    ("ろ過式集じん器", "差圧（kPa）", "1.5 以下", "1.2", "休", None, "", ["G10"]),
    ("誘引送風機", "軸受温度（℃）", "70 以下", "48", "休", None, "", ["G12"]),
    ("誘引送風機", "振動・異音", "異常なし", "✓", "休", None, "", ["G12"]),
    ("飛灰固化装置", "セメント供給", "異常なし", None, None, "✓", "スクリュー清掃", ["G14"]),
    ("受変電設備", "受電電圧（kV）", "6.6±0.3", None, None, "6.6", "", ["G15"]),
    ("非常用発電機", "燃料残量", "3/4 以上", None, None, "満", "", ["G16"]),
    ("中央監視制御装置", "警報の有無", "無きこと", None, None, "✓", "2号 警報除外", ["G17"]),
]
# 読めなくするセル（影とぼけ）：(行の添字, 列の名前)
UNREADABLE = [(7, "f1"), (13, "memo")]


def write_photo(F):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    import pypdfium2 as pdfium
    R = F.rng
    day = D(2026, 9, 17)
    # 写真のもとの頁（印字だけ。手書きは画像に足す）は gen/src に残す
    tmp_pdf = os.path.join(ROOT, "gen", "src", "f2_日常点検表_印字.pdf")
    c = rl_canvas(tmp_pdf, "日常点検表")
    W_, H_ = A4
    x0 = 14 * mm
    c.setFont("JP", 14)
    c.drawCentredString(W_ / 2, H_ - 20 * mm, "日 常 点 検 表（炉・共通設備）")
    c.setFont("JP", 8)
    c.drawString(x0, H_ - 12 * mm, "【架空】朧谷環境工場　様式 運-03")
    c.drawRightString(W_ - 14 * mm, H_ - 12 * mm, "架空のデータ")
    c.setFont("JP", 10)
    c.drawString(x0, H_ - 32 * mm, "令和　　年　　月　　日（　）")
    c.drawString(x0 + 80 * mm, H_ - 32 * mm, "天候")
    c.drawString(x0 + 112 * mm, H_ - 32 * mm, "点検者")
    c.line(x0 + 88 * mm, H_ - 33 * mm, x0 + 108 * mm, H_ - 33 * mm)
    c.line(x0 + 124 * mm, H_ - 33 * mm, x0 + 160 * mm, H_ - 33 * mm)
    # 印の欄
    for i, t in enumerate(["係長", "確認"]):
        bx = W_ - 14 * mm - (i + 1) * 18 * mm
        c.rect(bx, H_ - 44 * mm, 18 * mm, 16 * mm)
        c.setFont("JP", 7)
        c.drawCentredString(bx + 9 * mm, H_ - 32 * mm, t)
    cols = [("No.", 9), ("設備", 30), ("点検項目", 36), ("判定基準", 24), ("1号炉", 16), ("2号炉", 16),
            ("共通", 16), ("備考", 35)]
    xs = [x0]
    for _, w in cols:
        xs.append(xs[-1] + w * mm)
    RH = 11 * mm
    top = H_ - 52 * mm
    c.setFont("JP", 9)
    c.setFillGray(0.88)
    c.rect(xs[0], top - RH, xs[-1] - xs[0], RH, fill=1, stroke=0)
    c.setFillGray(0)
    for i, (t, _) in enumerate(cols):
        c.drawCentredString((xs[i] + xs[i + 1]) / 2, top - RH + 4 * mm, t)
    cell_boxes = []
    for k, row in enumerate(CHECK_ROWS):
        yt = top - RH * (k + 1)
        yb = yt - RH
        vals = [str(k + 1), row[0], row[1], row[2]]
        c.setFont("JP", 8.5)
        for i, v in enumerate(vals):
            if i == 0:
                c.drawCentredString((xs[0] + xs[1]) / 2, yb + 4 * mm, v)
            else:
                c.drawString(xs[i] + 1.5 * mm, yb + 4 * mm, v)
        boxes = {}
        for name, ci in (("f1", 4), ("f2", 5), ("common", 6), ("memo", 7)):
            boxes[name] = (xs[ci], yt, xs[ci + 1], yb)
        cell_boxes.append(boxes)
        # 共通の設備は 1・2 号炉の欄に斜線
        if row[5] is not None:
            for ci in (4, 5):
                c.line(xs[ci], yb, xs[ci + 1], yt)
        else:
            c.line(xs[6], yb, xs[7], yt)
    nrows = len(CHECK_ROWS) + 1
    c.setLineWidth(0.6)
    for k in range(nrows + 1):
        yy = top - RH * k
        c.line(xs[0], yy, xs[-1], yy)
    for x in xs:
        c.line(x, top, x, top - RH * nrows)
    yb = top - RH * nrows
    c.setFont("JP", 8)
    c.drawString(x0, yb - 6 * mm, "判定：✓ 異常なし　× 異常あり（備考に記入）　数値は測定値を記入　休：休炉中")
    c.drawString(x0, yb - 11 * mm, "特記事項")
    c.rect(x0, yb - 40 * mm, xs[-1] - xs[0], 26 * mm)
    c.showPage()
    c.save()
    # 頁を画像に
    pdf = pdfium.PdfDocument(tmp_pdf)
    scale = 1500 / (W_)
    page_img = pdf[0].render(scale=scale).to_pil().convert("RGB")
    pdf.close()
    pw, ph = page_img.size
    k = pw / W_  # pt → px

    def topx(x, y):
        return x * k, (H_ - y) * k

    dr = ImageDraw.Draw(page_img)
    hand = ImageFont.truetype(r"C:\Windows\Fonts\UDDigiKyokashoN-R.ttc", int(30 * k / 2.2))
    hand_s = ImageFont.truetype(r"C:\Windows\Fonts\UDDigiKyokashoN-R.ttc", int(22 * k / 2.2))
    ink = (28, 38, 92)

    def write(txt, x, y, font=hand, jitter=True):
        # 1 文字ずつ少し傾けて手書きらしく
        cx = x
        for ch in txt:
            im = Image.new("RGBA", (font.size * 2, font.size * 2), (0, 0, 0, 0))
            d2 = ImageDraw.Draw(im)
            d2.text((font.size // 2, font.size // 3), ch, font=font, fill=ink + (235,))
            im = im.rotate(R.uniform(-9, 9) if jitter else 0, resample=Image.BICUBIC)
            page_img.paste(im, (int(cx - font.size // 2), int(y - font.size // 2 + R.uniform(-2, 2))), im)
            cx += font.getlength(ch) * R.uniform(0.92, 1.05)

    def check(x0_, y0_, x1_, y1_):
        cx = (x0_ + x1_) / 2
        cy = (y0_ + y1_) / 2
        s = (x1_ - x0_) * 0.22
        pts = [(cx - s, cy), (cx - s * 0.3, cy + s * 0.8), (cx + s * 1.1, cy - s * 1.0)]
        pts = [(px + R.uniform(-2, 2), py + R.uniform(-2, 2)) for px, py in pts]
        dr.line(pts, fill=ink, width=max(3, int(k * 1.1)), joint="curve")

    # 日付・天候・点検者（印字の文字の幅から書く位置を決める）
    from reportlab.pdfbase.pdfmetrics import stringWidth
    base = "令和　　年　　月　　日（　）"
    for txt, before in (("8", "令和"), ("9", "令和　　年"), ("17", "令和　　年　　月"), ("木", "令和　　年　　月　　日（")):
        xx = x0 + stringWidth(before, "JP", 10) + 1.2 * mm
        x, y = topx(xx, H_ - 30.5 * mm)
        write(txt, x, y - 4)
    x, y = topx(x0 + 92 * mm, H_ - 30 * mm)
    write("曇", x, y - 4)
    x, y = topx(x0 + 128 * mm, H_ - 30 * mm)
    write("早瀬", x, y - 4)
    # 確認の丸（はんこの代わりの丸）
    bx = W_ - 14 * mm - 2 * 18 * mm
    cx, cy = topx(bx + 9 * mm, H_ - 38 * mm)
    rr = 5 * mm * k
    dr.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=(190, 40, 40), width=3)
    dr.text((cx - rr * 0.6, cy - rr * 0.55), "宮", font=hand_s, fill=(190, 40, 40))
    recs = F.file(F_PHOTO, False)
    for i, row in enumerate(CHECK_ROWS):
        boxes = cell_boxes[i]
        vals = {"f1": row[3], "f2": row[4], "common": row[5], "memo": row[6]}
        for name, v in vals.items():
            if not v:
                continue
            bx0, byt, bx1, byb = boxes[name]
            X0, Y0 = topx(bx0, byt)
            X1, Y1 = topx(bx1, byb)
            if v == "✓":
                check(X0, Y0, X1, Y1)
            else:
                f = hand if name != "memo" else hand_s
                tw = f.getlength(v)
                xx = X0 + 8 if name == "memo" else (X0 + X1) / 2 - tw / 2
                write(v, xx, (Y0 + Y1) / 2 - 2, f)
        # 正解の記録
        fields = {"date": iso(day), "weather": "曇", "inspector": "早瀬", "no": i + 1, "equipment": row[0],
                  "item": row[1], "standard": row[2]}
        for name in ("f1", "f2", "common", "memo"):
            v = vals[name]
            if (i, name) in UNREADABLE:
                fields[name] = "読めない"
            elif v:
                fields[name] = v
        recs.append({"seq": i, "image": F_PHOTO, "kind": "item", "fields": fields})
        # 作業：その日の点検（休炉の 2 号炉は除く）
        w = F.work(f"日常点検 {row[0]} {row[1]}", "INSPECT", "actual", 2026, row[7], start=day, end=day, days=1,
                   vendor="運転班（職員）", precision=False)
        F.link(w, F_PHOTO, seq=i, image=F_PHOTO)
        F.eq_name(row[7], F_PHOTO, row[0])
    # 読めなくする：影とぼけ
    blur_boxes = []
    for (i, name) in UNREADABLE:
        bx0, byt, bx1, byb = cell_boxes[i][name]
        X0, Y0 = topx(bx0, byt)
        X1, Y1 = topx(bx1, byb)
        blur_boxes.append((int(X0) - 6, int(Y0) - 4, int(X1) + 6, int(Y1) + 4))
    for (a, b, cc, d) in blur_boxes:
        reg = page_img.crop((a, b, cc, d)).filter(ImageFilter.GaussianBlur(9))
        page_img.paste(reg, (a, b))
    # 紙の折れ（横に 1 本）
    fold_y = int(ph * 0.47)
    ov = Image.new("L", page_img.size, 0)
    od = ImageDraw.Draw(ov)
    od.line((0, fold_y, pw, fold_y + 6), fill=70, width=3)
    od.line((0, fold_y + 4, pw, fold_y + 10), fill=25, width=8)
    ov = ov.filter(ImageFilter.GaussianBlur(3))
    dark = Image.new("RGB", page_img.size, (120, 120, 110))
    page_img = Image.composite(dark, page_img, ov)
    # 机の上に置き、傾ける
    angle = 4.6
    paper = page_img.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0))
    mask = Image.new("L", page_img.size, 255).rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=0)
    bg = Image.new("RGB", (paper.size[0] + 160, paper.size[1] + 140), (92, 84, 72))
    # 机の木目のむら
    bd = ImageDraw.Draw(bg)
    for yy in range(0, bg.size[1], 9):
        g = 80 + int(14 * math.sin(yy / 37.0)) + R.randint(-4, 4)
        bd.line((0, yy, bg.size[0], yy + R.randint(-3, 3)), fill=(g + 12, g + 4, g - 8), width=9)
    bg.paste(paper, (90, 60), mask)
    # 明るさのむら（左上が明るく、右下が暗い）と、手の影
    gw, gh = bg.size
    grad = Image.new("L", (gw, gh))
    gp = grad.load()
    for yy in range(gh):
        for xx in range(0, gw, 4):
            v = int(255 - 95 * ((xx / gw) * 0.6 + (yy / gh) * 0.4))
            for t in range(4):
                if xx + t < gw:
                    gp[xx + t, yy] = v
    black = Image.new("RGB", bg.size, (0, 0, 0))
    bg = Image.composite(bg, black, grad.point(lambda v: min(255, v + 20)))
    sh = Image.new("L", bg.size, 0)
    sd = ImageDraw.Draw(sh)
    a, b, cc, d = blur_boxes[1]
    sd.ellipse((a + 40, b - 160, gw + 300, gh + 200), fill=150)
    sh = sh.filter(ImageFilter.GaussianBlur(60))
    bg = Image.composite(Image.new("RGB", bg.size, (25, 22, 18)), bg, sh)
    bg = bg.filter(ImageFilter.GaussianBlur(0.8))
    # 大きさ：長い辺 1,800px
    sc = 1800 / max(bg.size)
    bg = bg.resize((int(bg.size[0] * sc), int(bg.size[1] * sc)), Image.LANCZOS)
    out = F.path_of(F_PHOTO)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    # 100KB 前後になる品質を探す（決まった順で）
    import io
    best = None
    for q in (80, 74, 68, 62, 56, 50, 44, 38, 32):
        buf = io.BytesIO()
        bg.save(buf, "JPEG", quality=q, optimize=True)
        best = buf.getvalue()
        if len(best) <= 125_000:
            break
    with open(out, "wb") as f:
        f.write(best)


def write_user(F):
    t = f"""# {F.name} の担当者が答えられること

（施設係の担当者の言葉で。聞かれたら答える）

## ファイル
- `{F_LEDGER}`：うちの修繕・委託の発注台帳。令和3年度から今年度（令和8年度）の今日までに契約した分。1 枚のシートに年度ごとの表を上から並べている。
- `{F_PHOTO}`：令和8年9月17日の日常点検表（紙）をスマホで撮ったもの。運転班が毎日 1 枚書く。

## 発注台帳
- 一番上の「総合計」は全部の年度の契約金額の合計で、円で書いている（変更契約があったものは変更後の金額で数えた）。
- 各年度の表の一番上の行「令和○年度　計」が、その年度の件数と金額の合計。表の下ではなく上に書いている。
- 令和5年度までは古い様式で、金額は千円、日付は「R3.4.1」のような文字で書いた。工期は 1 つのセルに「R3.6.7～R3.7.2」と書いている。
- 令和6年度から様式を変えた。契約番号・区分・契約方法の列を足し、着手と完了を別の列にした。金額は円。日付はセルの日付（着手と完了は和暦で表示）。
- 変更契約は、古い様式では備考に、新しい様式では「変更後金額」の列に書いた。
- 「緊急対応」「随意契約（緊急）」は壊れてすぐ直したもの。
- 単価契約の排ガス測定は年 4 回（5・8・11・2 月）。
- 委託で 1 年間の契約（4/1～3/31）でも、実際の作業はその中の決まった日だけ。
- 1号炉の定期整備工事は毎年 6 月、2号炉は 9 月。台帳の件名の「１号炉」（全角）と「1号炉」は同じ。
- クレーンの年次点検整備は 2 基（1 号・2 号）をまとめた 1 件の委託。
- 受変電の年次点検の日は全停電で、その日に非常用発電機の負荷運転もする。
- 中央監視制御装置の点検は、各炉の整備の終わりのころにやる。

## 日常点検表（写真）
- ✓ は異常なし、数字は測った値、「休」は休炉中（9 月は 2 号炉が定期整備で止まっている）。
- 1号炉・2号炉の欄に斜線がある行は共通の設備で、「共通」の欄に書く。逆に共通の欄に斜線がある行は炉ごとの設備。
- 点検者は早瀬。天候は曇。
- 「共通」は施設に 1 つの設備（クレーン・計量機・飛灰固化・受変電・非常用発電機・中央監視）。
- 影で読めないところがあるかもしれないが、紙はもう手元に無い。
"""
    write_text(os.path.join(F.dir, "user.md"), t)
