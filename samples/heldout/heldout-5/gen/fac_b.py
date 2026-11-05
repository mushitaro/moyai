# -*- coding: utf-8 -*-
"""施設 B：ごみ焼却（流動床 2 炉）。作業日報（1 日 1 シートの帳票、続紙あり）と、
修繕・点検費の実績集計（合計が上、年度の計がその年度の行の上、1 シートに 2 つの表）。"""
import datetime as dt
import os

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from common import (ROOT, TODAY, MAN_DAY_HOURS, answer_file, iso, rng, save_xlsx, wa_long, wa_short,
                    write_json, write_text, youbi)

FAC_ID = "f-ashihara"
NAME = "【架空】葦原環境センター"
DIR = os.path.join(ROOT, FAC_ID)
F_DAY = "【架空】葦原環境センター_作業日報_R8.9月.xlsx"
F_COST = "【架空】葦原環境センター_修繕点検費実績_R6-R8.xlsx"

EQ = {
    "E01": dict(name="流動床焼却炉 1号", furnace=1, code="FB-1"),
    "E02": dict(name="流動床焼却炉 2号", furnace=2, code="FB-2"),
    "E03": dict(name="押込送風機 1号", furnace=1, code="FDF-1"),
    "E04": dict(name="押込送風機 2号", furnace=2, code="FDF-2"),
    "E05": dict(name="誘引送風機 1号", furnace=1, code="IDF-1"),
    "E06": dict(name="誘引送風機 2号", furnace=2, code="IDF-2"),
    "E07": dict(name="バグフィルタ 1号", furnace=1, code="BF-1"),
    "E08": dict(name="バグフィルタ 2号", furnace=2, code="BF-2"),
    "E09": dict(name="砂循環装置 1号", furnace=1, code="SC-1"),
    "E10": dict(name="砂循環装置 2号", furnace=2, code="SC-2"),
    "E11": dict(name="灰固化装置", furnace=None, code="AS-1"),
    "E12": dict(name="ごみクレーン", furnace=None, code="CR-1"),
    "E13": dict(name="計量機", furnace=None, code="WB-1"),
    "E14": dict(name="受変電設備", furnace=None, code="SS-1"),
    "E15": dict(name="空気圧縮機 No.1", furnace=None, code="AC-1"),
    "E16": dict(name="空気圧縮機 No.2", furnace=None, code="AC-2"),
    "E17": dict(name="排水処理設備", furnace=None, code="WW-1"),
}
for e in EQ.values():
    e["install_year"] = 2003
EQ["E16"]["install_year"] = 2019
F1 = ["E01", "E03", "E05", "E07", "E09"]

VEN = {"om": "架空葦原オペレーション㈱", "furn": "架空流動炉エンジ㈱", "fan": "架空ファンテック㈱", "bf": "架空集塵機工業㈱",
       "elec": "（一財）架空電気保安協会", "crane": "架空クレーン保守㈱", "scale": "架空はかり㈱", "comp": "架空コンプレッサ㈱",
       "pump": "架空ポンプサービス㈱", "ash": "架空固化設備㈱"}

# ------------------------------------------------------------------ 9 月前半の作業（1 日 1 シートの日報）
# (日, 区分, 号炉の書き方, 設備・機器の書き方, 作業内容, 施工, 社員の人工, 協力の人工, 時間, 備考, 作業の鍵)
D = lambda d: dt.date(2026, 9, d)
DAY_LINES = {
    1: [("補修", "2号炉", "砂循環装置（ベルコン）", "ベルトコンベヤ 蛇行調整", VEN["om"], 1.0, 0, "9:00～16:00", "", "rep_sc2")],
    2: [("点検", "共通", "空気圧縮機 No.2", "吸込フィルタ交換・ドレン確認", VEN["comp"], 0, 1.0, "9:00～12:00", "", "ac2_filter"),
        ("点検", "共通", "ごみクレーン", "月例点検（ワイヤ・ブレーキ）", VEN["crane"], 0, 2.0, "9:00～17:00", "", "crane_m9")],
    3: [("点検", "共通", "受変電設備", "月次点検", VEN["elec"], 0, 0.5, "10:00～12:00", "", "ss_m9"),
        ("整備", "共通", "灰固化装置", "混練機 清掃・羽根点検", VEN["om"], 2.0, 0, "8:30～17:00", "", "ash_clean")],
    4: [("点検", "1号炉", "1号炉 全般", "立下げ前点検・資材搬入", VEN["furn"], 0, 3.0, "8:30～17:00", "定期整備の準備", "p1"),
        ("点検", "共通", "計量機", "日常点検 異常なし", VEN["om"], 0.25, 0, "8:30～10:30", "", "scale_d")],
    5: [],
    6: [],
    7: [("整備", "1号炉", "1号炉 全般", "立下げ開始（6:00 燃焼停止）", VEN["om"], 3.0, 0, "6:00～17:00", "", "p1"),
        ("整備", "1号炉", "1号炉 全般", "仮設足場 資材搬入", VEN["furn"], 0, 4.0, "8:30～17:00", "", "p1")],
    8: [("整備", "1号炉", "1号炉 全般", "炉内冷却・ダイオキシン類測定（作業前）", "架空分析センター㈱", 0, 2.0, "9:00～15:00", "測定結果は後日", "p1"),
        ("整備", "1号炉", "1号炉 全般", "養生・作業区画設定", VEN["furn"], 0, 4.0, "8:30～17:00", "", "p1"),
        ("整備", "1号", "FDF", "押込送風機 分解", VEN["fan"], 0, 3.0, "8:30～17:00", "", "fdf1"),
        ("整備", "1号", "〃", "羽根車 点検・清掃", VEN["fan"], 0, 2.0, "8:30～17:00", "", "fdf1"),
        ("点検", "1号炉", "砂循環装置", "不燃物抜出し装置 点検", VEN["om"], 2.0, 0, "8:30～17:00", "", "sc1"),
        ("点検", "1号炉", "砂循環装置", "砂分級機 スクリーン点検", VEN["om"], 1.0, 0, "13:00～17:00", "", "sc1"),
        ("整備", "1号炉", "バグフィルタ", "ろ布 目視点検（全室）", VEN["bf"], 0, 3.0, "8:30～17:00", "", "bf1"),
        ("整備", "1号炉", "〃", "パルス弁 作動確認", VEN["bf"], 0, 1.0, "13:00～17:00", "", "bf1"),
        ("点検", "共通", "空気圧縮機 No.1", "定期点検（運転時間 12,000h）", VEN["comp"], 0, 1.0, "9:00～15:00", "", "ac1_pm"),
        ("整備", "1号炉", "1号炉 全般", "炉内 付着物除去", VEN["furn"], 0, 5.0, "8:30～17:00", "", "p1"),
        ("補修", "2号炉", "誘引送風機", "軸受温度上昇 → 給油", VEN["om"], 0.5, 0, "14:00～16:00", "温度 58℃→49℃", "rep_idf2")],
    9: [("整備", "1号炉", "1号炉 全般", "足場組立", VEN["furn"], 0, 6.0, "8:30～17:00", "", "p1"),
        ("整備", "1号", "FDF", "軸受交換・組立", VEN["fan"], 0, 3.0, "8:30～17:00", "", "fdf1"),
        ("整備", "1号炉", "バグフィルタ", "ろ布 部分取替（2室 144本）", VEN["bf"], 0, 4.0, "8:30～17:00", "", "bf1")],
    10: [("整備", "1号炉", "流動床炉", "散気管 点検・補修", VEN["furn"], 0, 5.0, "8:30～17:00", "", "fb1"),
         ("整備", "1号", "FDF", "試運転・振動測定", VEN["fan"], 0, 1.0, "9:00～12:00", "1.2mm/s", "fdf1"),
         ("補修", "共通", "排水処理設備", "放流ポンプ 異音 → 軸受交換", VEN["pump"], 0, 2.0, "9:00～17:00", "", "rep_ww")],
    11: [("整備", "1号炉", "流動床炉", "炉内耐火物 点検", VEN["furn"], 0, 4.0, "8:30～17:00", "", "fb1"),
         ("整備", "1号炉", "バグフィルタ", "ろ布 取替（続き）", VEN["bf"], 0, 4.0, "8:30～17:00", "", "bf1")],
    12: [("整備", "1号炉", "流動床炉", "耐火物 部分補修（0.8㎡）", VEN["furn"], 0, 3.0, "8:30～17:00", "", "fb1")],
    13: [],
    14: [("整備", "1号", "IDF", "誘引送風機 分解", VEN["fan"], 0, 3.0, "8:30～17:00", "", "idf1"),
         ("整備", "1号炉", "流動床炉", "耐火物 乾燥", VEN["furn"], 0, 2.0, "8:30～17:00", "", "fb1")],
    15: [("整備", "1号", "IDF", "羽根車 肉盛補修", VEN["fan"], 0, 3.0, "8:30～17:00", "", "idf1"),
         ("点検", "共通", "ごみクレーン", "バケット 爪点検", VEN["crane"], 0, 1.0, "13:00～17:00", "", "crane_bkt")],
}
WEATHER = {1: "晴", 2: "曇", 3: "雨", 4: "曇", 5: "晴", 6: "晴", 7: "曇時々雨", 8: "晴", 9: "晴", 10: "曇", 11: "雨", 12: "晴",
           13: "晴", 14: "曇", 15: "晴"}
WRITER = {d: ("中村" if d % 2 else "小川") for d in range(1, 16)}

WORK_DEF = {
    # 鍵: (ラベル, 属性, 機器, 業者, 開始, 終了)
    "p1": ("1号炉 定期整備工事（一式）", "OVERHAUL", F1, VEN["furn"], D(4), D(18)),
    "fdf1": ("押込送風機 1号 分解整備", "OVERHAUL", ["E03"], VEN["fan"], D(8), D(10)),
    "sc1": ("砂循環装置 1号 点検", "INSPECT", ["E09"], VEN["om"], D(8), D(8)),
    "bf1": ("バグフィルタ 1号 ろ布点検・部分取替", "REPLACE", ["E07"], VEN["bf"], D(8), D(11)),
    "fb1": ("流動床焼却炉 1号 散気管・耐火物 補修", "OVERHAUL", ["E01"], VEN["furn"], D(10), D(14)),
    "idf1": ("誘引送風機 1号 分解整備", "OVERHAUL", ["E05"], VEN["fan"], D(14), D(17)),
    "ac1_pm": ("空気圧縮機 No.1 定期点検", "INSPECT", ["E15"], VEN["comp"], D(8), D(8)),
    "ac2_filter": ("空気圧縮機 No.2 吸込フィルタ交換", "REPLACE", ["E16"], VEN["comp"], D(2), D(2)),
    "crane_m9": ("ごみクレーン 月例点検（9月）", "INSPECT", ["E12"], VEN["crane"], D(2), D(2)),
    "crane_bkt": ("ごみクレーン バケット爪点検", "INSPECT", ["E12"], VEN["crane"], D(15), D(15)),
    "ss_m9": ("受変電設備 月次点検（9月）", "INSPECT", ["E14"], VEN["elec"], D(3), D(3)),
    "ash_clean": ("灰固化装置 混練機 清掃・点検", "INSPECT", ["E11"], VEN["om"], D(3), D(3)),
    "scale_d": ("計量機 日常点検（9/4）", "INSPECT", ["E13"], VEN["om"], D(4), D(4)),
    "rep_sc2": ("砂循環装置 2号 ベルトコンベヤ 蛇行調整", "OVERHAUL", ["E10"], VEN["om"], D(1), D(1)),
    "rep_idf2": ("誘引送風機 2号 給油（軸受温度上昇）", "OVERHAUL", ["E06"], VEN["om"], D(8), D(8)),
    "rep_ww": ("排水処理設備 放流ポンプ 軸受交換", "REPLACE", ["E17"], VEN["pump"], D(10), D(10)),
}
# 世界の工数（日報の窓の外の日も含めた作業の全体）
EXTRA_MD = {"p1": 38.0, "idf1": 6.0}   # 9/16〜9/18 の分（日報は 9/15 まで）

ALIAS_DAY = {"E01": "流動床炉", "E03": "FDF", "E05": "IDF", "E06": "誘引送風機", "E07": "バグフィルタ", "E09": "砂循環装置",
             "E10": "砂循環装置（ベルコン）", "E11": "灰固化装置", "E12": "ごみクレーン", "E13": "計量機", "E14": "受変電設備",
             "E15": "空気圧縮機 No.1", "E16": "空気圧縮機 No.2", "E17": "排水処理設備"}

THIN = Side(style="thin", color="000000")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
GRAY = PatternFill("solid", fgColor="E7E6E6")
F9 = Font(name="ＭＳ 明朝", size=10)
PER_SHEET = 8


def hours(span):
    a, b = span.split("～")
    ah, am = map(int, a.split(":"))
    bh, bm = map(int, b.split(":"))
    h = (bh * 60 + bm - ah * 60 - am) / 60
    if ah < 12 < bh:
        h -= 1
    return h


def _sheet(wb, title, d, page, pages, cont):
    ws = wb.create_sheet(title)
    ws["A1"] = NAME
    ws["A1"].font = Font(name="ＭＳ 明朝", size=10)
    ws.merge_cells("D1:G1")
    ws["D1"] = "作　業　日　報" + ("（続紙）" if cont else "")
    ws["D1"].font = Font(name="ＭＳ 明朝", size=16, bold=True)
    ws["D1"].alignment = Alignment(horizontal="center")
    for col, t in zip("IJK", ("所長", "副所長", "担当")):
        ws[f"{col}1"] = t
        ws[f"{col}1"].border = BOX
        ws[f"{col}1"].alignment = Alignment(horizontal="center")
    ws["A2"] = "日付"
    ws.merge_cells("B2:D2")
    ws["B2"] = f"{wa_long(d)}（{youbi(d)}）"
    ws["E2"] = "天候"
    ws["F2"] = WEATHER[d.day]
    ws["G2"] = "記入者"
    ws["H2"] = WRITER[d.day]
    ws["A3"] = "炉の状況"
    ws.merge_cells("B3:F3")
    if d >= D(7):
        ws["B3"] = "1号炉 休止（定期整備）／2号炉 運転"
    else:
        ws["B3"] = "1号炉 運転／2号炉 運転"
    ws["G3"] = "頁"
    ws["H3"] = f"{page}/{pages}"
    if cont:
        ws["A4"] = "前ページから続く"
    # 見出し 2 段
    heads = [("A", "No."), ("B", "区分"), ("C", "号炉"), ("D", "設備・機器"), ("E", "作業内容・結果"), ("F", "施工")]
    for col, t in heads:
        ws.merge_cells(f"{col}5:{col}6")
        ws[f"{col}5"] = t
    ws.merge_cells("G5:H5")
    ws["G5"] = "人工"
    ws["G6"] = "社員"
    ws["H6"] = "協力会社"
    ws.merge_cells("I5:I6")
    ws["I5"] = "作業時間"
    ws.merge_cells("J5:K6")
    ws["J5"] = "備考"
    for r in range(5, 7):
        for c in range(1, 12):
            ws.cell(r, c).border = BOX
            ws.cell(r, c).fill = GRAY
            ws.cell(r, c).alignment = Alignment(horizontal="center", vertical="center")
    for i in range(PER_SHEET):
        r = 7 + i
        ws.cell(r, 1, (page - 1) * PER_SHEET + i + 1)
        ws.merge_cells(f"J{r}:K{r}")
        for c in range(1, 12):
            ws.cell(r, c).border = BOX
            ws.cell(r, c).font = F9
    ws["A16"] = "引継ぎ・特記"
    ws.merge_cells("B16:K17")
    for col, w in zip("ABCDEFGHIJK", (5, 6, 7, 16, 30, 20, 6, 8, 12, 8, 8)):
        ws.column_dimensions[col].width = w
    ws.page_setup.orientation = "landscape"
    return ws


def write_daily(works):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    recs = []
    for day in range(1, 16):
        d = D(day)
        lines = DAY_LINES[day]
        pages = max(1, -(-len(lines) // PER_SHEET))
        for pg in range(1, pages + 1):
            title = f"{d.month}.{d.day}" if pg == 1 else f"{d.month}.{d.day}(続)"
            ws = _sheet(wb, title, d, pg, pages, pg > 1)
            sheet_f = {"date": iso(d), "曜日": youbi(d), "天候": WEATHER[day], "記入者": WRITER[day],
                       "炉の状況": ws["B3"].value, "頁": f"{pg}/{pages}"}
            chunk = lines[(pg - 1) * PER_SHEET: pg * PER_SHEET]
            prev_vendor = None
            prev_eq = None
            for i, ln in enumerate(chunk):
                kub, fur, eqn, txt, ven, a, b, span, memo, key = ln
                r = 7 + i
                ws.cell(r, 2, kub)
                ws.cell(r, 3, fur)
                ws.cell(r, 4, eqn)
                ws.cell(r, 5, txt)
                ws.cell(r, 6, "〃" if ven == prev_vendor else ven)
                if a:
                    ws.cell(r, 7, a)
                if b:
                    ws.cell(r, 8, b)
                ws.cell(r, 9, span)
                if memo:
                    ws.cell(r, 10, memo)
                real_eq = prev_eq if eqn == "〃" else eqn
                f = dict(sheet_f)
                mdtxt = " ".join(x for x in (f"社員{a:g}" if a else "", f"協力{b:g}" if b else "") if x) + "（人工）"
                f.update({"No": (pg - 1) * PER_SHEET + i + 1, "区分": kub, "号炉": fur, "設備・機器": real_eq,
                          "作業内容": txt, "施工": ven, "manDays": round(a + b, 3), "manDaysText": mdtxt, "作業時間": span})
                if memo:
                    f["備考"] = memo
                recs.append(dict(sheet=title, r=r, kind="item", fields=f))
                if key:
                    works[key]["rows"].append(dict(file=F_DAY, sheet=title, r=r))
                    works[key]["md_rows"] += a + b
                prev_vendor = ven
                prev_eq = real_eq
            if not lines:
                ws["B16"] = "作業なし（日曜・運転監視のみ）" if d.weekday() == 6 else "作業なし"
                f = dict(sheet_f)
                f["引継ぎ・特記"] = ws["B16"].value
                recs.append(dict(sheet=title, r=2, kind="item", fields=f))
            else:
                ws["B16"] = "KY 実施。1号炉 定期整備中は作業区画の立入に注意。" if d >= D(7) else "KY 実施。"
    save_xlsx(wb, os.path.join(DIR, "files", F_DAY), f"{NAME} 作業日報 R8.9", NAME + " 運転管理")
    return recs


# ------------------------------------------------------------------ 修繕・点検費の実績（合計が上、年度の計が上）
# (年度, 件名, 対象設備（書き方）, 号炉, 区分, 発注日, 完了日, 施工業者, 金額（千円）, 備考, 作業の鍵, 機器)
COST_ROWS = [
    (2024, "1号炉 定期整備工事", "焼却炉・付帯設備 一式", "1号炉", "整備", dt.date(2024, 7, 25), dt.date(2024, 9, 20), VEN["furn"], 38500, "", "p1_24", F1),
    (2024, "2号炉 定期整備工事", "焼却炉・付帯設備 一式", "2号炉", "整備", dt.date(2024, 9, 10), dt.date(2024, 11, 15), VEN["furn"], 37200, "", "p2_24",
     ["E02", "E04", "E06", "E08", "E10"]),
    (2024, "誘引送風機 2号 軸受交換", "誘引送風機", "2号炉", "修繕", dt.date(2024, 6, 12), dt.date(2024, 6, 14), VEN["fan"], 1430, "緊急対応", "r24_1", ["E06"]),
    (2024, "灰固化装置 混練機 羽根取替", "灰固化装置", "共通", "修繕", dt.date(2024, 12, 3), dt.date(2025, 1, 24), VEN["ash"], 4180, "", "r24_2", ["E11"]),
    (2024, "ごみクレーン ワイヤロープ取替", "ごみクレーン", "共通", "整備", dt.date(2024, 10, 1), dt.date(2024, 11, 8), VEN["crane"], 2860, "", "r24_3", ["E12"]),
    (2024, "計量機 定期検査（計量法）", "計量機", "共通", "点検", dt.date(2024, 10, 15), dt.date(2024, 11, 20), VEN["scale"], 715, "", "r24_4", ["E13"]),
    (2025, "1号炉 定期整備工事", "焼却炉・付帯設備 一式", "1号炉", "整備", dt.date(2025, 7, 28), dt.date(2025, 9, 19), VEN["furn"], 39800, "", "p1_25", F1),
    (2025, "2号炉 定期整備工事", "焼却炉・付帯設備 一式", "2号炉", "整備", dt.date(2025, 9, 8), dt.date(2025, 11, 14), VEN["furn"], 41200, "変更契約あり（+1,650千円）", "p2_25",
     ["E02", "E04", "E06", "E08", "E10"]),
    (2025, "バグフィルタ 2号 ろ布全数取替", "バグフィルタ", "2号炉", "整備", dt.date(2025, 9, 8), dt.date(2025, 11, 14), VEN["bf"], 16500, "2号炉定期整備と同時", "r25_1", ["E08"]),
    (2025, "空気圧縮機 No.1 オーバーホール", "空気圧縮機", "共通", "整備", dt.date(2025, 5, 20), dt.date(2025, 6, 27), VEN["comp"], 2090, "", "r25_2", ["E15"]),
    (2025, "砂循環装置 2号 バケットエレベータ チェーン取替", "砂循環装置", "2号炉", "修繕", dt.date(2026, 1, 13), dt.date(2026, 2, 20), VEN["om"], 3740, "緊急対応", "r25_3", ["E10"]),
    (2025, "排水処理設備 薬注ポンプ取替", "排水処理設備", "共通", "修繕", dt.date(2026, 2, 2), dt.date(2026, 3, 13), VEN["pump"], 968, "", "r25_4", ["E17"]),
    (2026, "1号炉 定期整備工事", "焼却炉・付帯設備 一式", "1号炉", "整備", dt.date(2026, 8, 3), dt.date(2026, 9, 18), VEN["furn"], 40150, "", "p1", F1),
    (2026, "砂循環装置 2号 ベルトコンベヤ 蛇行調整", "砂循環装置", "2号炉", "修繕", dt.date(2026, 9, 1), dt.date(2026, 9, 1), VEN["om"], 0, "運転委託の範囲内（0円）", "rep_sc2", ["E10"]),
    (2026, "排水処理設備 放流ポンプ 軸受交換", "排水処理設備", "共通", "修繕", dt.date(2026, 9, 10), dt.date(2026, 9, 10), VEN["pump"], 352, "緊急対応", "rep_ww", ["E17"]),
    (2026, "空気圧縮機 No.2 吸込フィルタ交換", "空気圧縮機", "共通", "点検", dt.date(2026, 8, 26), dt.date(2026, 9, 2), VEN["comp"], 88, "単価契約", "ac2_filter", ["E16"]),
]
# 年度の計：R7 は 1 件（薬注ポンプ）を足す前の値のまま（費用の小計の食い違い）
STALE_SUB = {2025: 968}
# 年間委託（2 つ目の表。見出しが変わる。金額は円）
ANNUAL = [
    (2024, "受変電設備 保安管理業務", "受変電設備", "R6.4～R7.3", VEN["elec"], 1980000, "毎月", "ss_24", ["E14"], dt.date(2024, 11, 17)),
    (2024, "ごみクレーン 保守点検業務", "ごみクレーン", "R6.4～R7.3", VEN["crane"], 2640000, "四半期", "cr_24", ["E12"], dt.date(2024, 4, 9)),
    (2025, "受変電設備 保安管理業務", "受変電設備", "R7.4～R8.3", VEN["elec"], 1980000, "毎月", "ss_25", ["E14"], dt.date(2025, 11, 16)),
    (2025, "ごみクレーン 保守点検業務", "ごみクレーン", "R7.4～R8.3", VEN["crane"], 2706000, "四半期", "cr_25", ["E12"], dt.date(2025, 4, 8)),
    (2026, "受変電設備 保安管理業務", "受変電設備", "R8.4～R9.3", VEN["elec"], 2046000, "毎月", "ss_26", ["E14"], dt.date(2026, 11, 15)),
    (2026, "ごみクレーン 保守点検業務", "ごみクレーン", "R8.4～R9.3", VEN["crane"], 2706000, "四半期", "cr_26", ["E12"], dt.date(2026, 4, 7)),
]


def write_cost(works, ext):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "実績"
    ws["A1"] = f"{NAME}　修繕・点検費 実績集計（R6～R8）"
    ws["A1"].font = Font(name="ＭＳ ゴシック", size=13, bold=True)
    ws["A2"] = "単位：千円（税込）　※R8 は 9 月末まで"
    head = ["No.", "件名", "対象設備", "号炉", "区分", "発注日", "完了日", "施工業者", "金額", "備考"]
    for c, t in enumerate(head, 1):
        ws.cell(4, c, t).fill = GRAY
        ws.cell(4, c).border = BOX
    recs = []
    r = 5
    total = sum(x[8] for x in COST_ROWS)
    ws.cell(r, 2, "合計（R6～R8）")
    ws.cell(r, 9, total)
    ws.cell(r, 2).font = Font(bold=True)
    ws.cell(r, 9).font = Font(bold=True)
    recs.append(dict(sheet="実績", r=r, kind="total", fields={}))
    r += 1
    no = 0
    for fy in (2024, 2025, 2026):
        rows = [x for x in COST_ROWS if x[0] == fy]
        sub = sum(x[8] for x in rows) - STALE_SUB.get(fy, 0)
        lab = {2024: "令和6年度 計", 2025: "令和7年度 計", 2026: "令和8年度 計（9月末）"}[fy]
        ws.cell(r, 2, lab)
        ws.cell(r, 9, sub)
        for c in range(1, 11):
            ws.cell(r, c).fill = PatternFill("solid", fgColor="FFF2CC")
        recs.append(dict(sheet="実績", r=r, kind="subtotal", fields={}))
        r += 1
        for x in rows:
            no += 1
            _, name, tgt, fur, kub, od, cd, ven, amt, memo, key, eqs = x
            ws.cell(r, 1, no)
            ws.cell(r, 2, name)
            ws.cell(r, 3, tgt)
            ws.cell(r, 4, fur)
            ws.cell(r, 5, kub)
            if fy == 2024:
                ws.cell(r, 6, wa_short(od))   # 古い年度は和暦の文字
                ws.cell(r, 7, wa_short(cd))
            else:
                ws.cell(r, 6, od)
                ws.cell(r, 7, cd)
                ws.cell(r, 6).number_format = "yyyy/m/d"
                ws.cell(r, 7).number_format = "yyyy/m/d"
            ws.cell(r, 8, ven)
            ws.cell(r, 9, amt)
            ws.cell(r, 9).number_format = "#,##0"
            if memo:
                ws.cell(r, 10, memo)
            f = {"No": no, "fiscal_year": fy, "件名": name, "対象設備": tgt, "号炉": fur, "区分": kub, "発注日": iso(od),
                 "start": iso(od), "end": iso(cd), "完了日": iso(cd), "施工業者": ven, "金額": amt, "金額の単位": "千円"}
            if memo:
                f["備考"] = memo
            recs.append(dict(sheet="実績", r=r, kind="item", fields=f))
            ext.setdefault(key, dict(label=name, eq=eqs, ven=ven, od=od, cd=cd, fy=fy, amt=amt, kub=kub))
            ext[key].setdefault("rows", []).append(dict(file=F_COST, sheet="実績", r=r))
            r += 1
    # 2 つ目の表（見出しが変わる）
    r += 2
    ws.cell(r, 1, "■ 年間委託（点検・保守）　※金額は円")
    r += 1
    head2 = ["No.", "契約名", "対象", "契約期間", "受託者", "年額（円）", "点検の頻度", "備考"]
    for c, t in enumerate(head2, 1):
        ws.cell(r, c, t).fill = GRAY
        ws.cell(r, c).border = BOX
    r += 1
    for i, x in enumerate(ANNUAL, 1):
        fy, name, tgt, per, ven, amt, freq, key, eqs, d_ann = x
        for c, v in enumerate([i, name, tgt, per, ven, amt, freq], 1):
            ws.cell(r, c, v)
        ws.cell(r, 6).number_format = "#,##0"
        s, e = dt.date(fy, 4, 1), dt.date(fy + 1, 3, 31)
        f = {"No": i, "契約名": name, "対象": tgt, "契約期間": per, "start": iso(s), "end": iso(e), "受託者": ven,
             "年額": amt, "年額の単位": "円", "点検の頻度": freq}
        recs.append(dict(sheet="実績", r=r, kind="item", fields=f))
        ext.setdefault(key, dict(label=name, eq=eqs, ven=ven, od=s, cd=e, fy=fy, amt=amt, kub="点検", annual=d_ann))
        ext[key].setdefault("rows", []).append(dict(file=F_COST, sheet="実績", r=r))
        r += 1
    for col, w in zip("ABCDEFGHIJ", (5, 34, 22, 8, 8, 12, 12, 22, 12, 26)):
        ws.column_dimensions[col].width = w
    save_xlsx(wb, os.path.join(DIR, "files", F_COST), f"{NAME} 修繕・点検費 実績集計", NAME + " 施設管理係")
    return recs


def build():
    works = {k: dict(key=k, label=v[0], attr=v[1], eq=v[2], vendor=v[3], start=v[4], end=v[5], rows=[], md_rows=0.0)
             for k, v in WORK_DEF.items()}
    day_recs = write_daily(works)
    ext = {}
    cost_recs = write_cost(works, ext)
    answer_file(DIR, F_DAY, False, day_recs, note="1 日 1 シートの帳票。9.8 は続紙のシート「9.8(続)」がある。作業の無い日はラベルの行（2 行目）を 1 件にした。施工の〃は上の行の業者に直した。")
    answer_file(DIR, F_COST, False, cost_recs, note="合計の行が表の一番上、年度の計がその年度の行の上。2 つ目の表（年間委託）は見出しと金額の単位（円）が違う。R6 の日付は和暦の文字。")
    # 年間委託の契約の行は、その契約で行った月例の点検も書いている
    for k, ak in (("ss_m9", "ss_26"), ("crane_m9", "cr_26"), ("crane_bkt", "cr_26")):
        works[k]["rows"] += ext[ak]["rows"]
    # 世界の作業
    out = []
    attr_of = {"整備": "OVERHAUL", "修繕": "OVERHAUL", "点検": "INSPECT"}
    for k, w in works.items():
        x = ext.pop(k, None)
        rows = w["rows"] + (x["rows"] if x else [])
        md = round(w["md_rows"] + EXTRA_MD.get(k, 0.0), 3)
        out.append(dict(key=k, label=w["label"], attribute=w["attr"], status="actual", fiscal_year=2026, equipment=w["eq"],
                        start=w["start"], end=w["end"], man_days=md, vendor=w["vendor"],
                        contract="R8 1号炉定期整備工事" if k in ("p1", "fdf1", "bf1", "fb1", "idf1", "sc1") else
                        ("運転管理業務委託（長期包括）" if w["vendor"] == VEN["om"] else
                         ("受変電設備 保安管理業務（R8）" if k == "ss_m9" else ("ごみクレーン 保守点検業務（R8）" if k.startswith("crane") else "単価契約・随意契約"))),
                        rows=rows))
    for k, x in ext.items():
        if "annual" in x:
            d0 = x["annual"]
            st = "actual" if d0 < TODAY else "planned"
            lab = ("受変電設備 年次点検（全停電）" if "受変電" in x["label"] else "ごみクレーン 年次点検") + f"（{x['fy'] - 2018 and 'R' + str(x['fy'] - 2018)}）"
            out.append(dict(key=k, label=lab, attribute="INSPECT", status=st, fiscal_year=x["fy"], equipment=x["eq"],
                            start=d0, end=d0, man_days=2.0 if "受変電" in x["label"] else 3.0, vendor=x["ven"],
                            contract=x["label"] + f"（R{x['fy'] - 2018}）", rows=x["rows"],
                            note="年間委託の契約の行。月次・四半期の点検もこの契約に入るが、世界には年次の点検だけを作業として置いた"))
            continue
        attr = "REPLACE" if ("取替" in x["label"] or "交換" in x["label"]) else attr_of[x["kub"]]
        R = rng("B-md:" + k)
        days = (x["cd"] - x["od"]).days + 1
        md_ = float(R.randint(2, 6) * (3 if "定期整備" in x["label"] else 1))
        out.append(dict(key=k, label=x["label"] + f"（R{x['fy'] - 2018}）", attribute=attr, status="actual", fiscal_year=x["fy"],
                        equipment=x["eq"], start=x["od"], end=x["cd"], man_days=md_, vendor=x["ven"],
                        contract=f"R{x['fy'] - 2018} {x['label']}", rows=x["rows"],
                        note="開始と終了は発注日と完了日（工事の実際の期間は資料に無い）"))
    # 日報にも集計にも無い作業
    unrec_def = [("u1", "計量機 日常点検の範囲の調整（R8.8）", "OVERHAUL", ["E13"], dt.date(2026, 8, 19), VEN["om"],
                  "運転委託の範囲の軽作業で、日報の期間（9月前半）より前、集計にも載らない（0円）")]
    for k, lab, attr, eqs, d0, ven, why in unrec_def:
        out.append(dict(key=k, label=lab, attribute=attr, status="actual", fiscal_year=2026, equipment=eqs, start=d0, end=d0,
                        man_days=0.5, vendor=ven, contract="運転管理業務委託（長期包括）", rows=[], why=why))
    out.sort(key=lambda w: (w["start"], w["key"]))
    wl, unrec = [], []
    for i, w in enumerate(out, 1):
        wid = f"W{i:04d}"
        ent = dict(id=wid, label=w["label"], attribute=w["attribute"], status=w["status"], fiscal_year=w["fiscal_year"],
                   equipment=w["equipment"], start=iso(w["start"]), end=iso(w["end"]), man_days=w["man_days"],
                   days=(w["end"] - w["start"]).days + 1, vendor=w["vendor"], contract=w["contract"], precision=False, rows=w["rows"])
        if w.get("note"):
            ent["note"] = w["note"]
        wl.append(ent)
        if not w["rows"]:
            unrec.append(dict(work=wid, reason=w.get("why", "?")))
    eq_list = [dict(id=k, name=v["name"], names={F_DAY: ALIAS_DAY[k]} if k in ALIAS_DAY else {}, furnace=v["furnace"],
                    install_year=v["install_year"], code=v["code"], path=[v["name"]], rows=[]) for k, v in EQ.items()]
    defects = [dict(kind="費用の小計の食い違い", where=f"{F_COST} 実績 「令和7年度 計」の行：明細の合計より 968 千円少ない（薬注ポンプ取替の行を足す前の値）",
                    check="小計と明細の合計の一致")]
    world = {
        "schema": "moyai.answer.world/0",
        "facility": {"id": FAC_ID, "name": NAME, "industry": "waste-incineration",
                     "profile": {"furnace": "流動床式（全連続）", "lines": 2, "capacity_t_per_day": 90, "capacity_note": "45t/24h × 2炉",
                                 "turbine": False, "dust": "BF", "ash": "セメント固化", "contract": "O&M（長期包括）", "upgrade": False,
                                 "completed": 2003}},
        "fiscal_year_start_month": 4, "man_day_hours": MAN_DAY_HOURS, "today": iso(TODAY),
        "equipment": eq_list, "works": wl, "unrecorded": unrec, "defects": defects,
        "note": "機器の木を書いた資料が無い施設。機器の rows は空。",
    }
    write_json(os.path.join(DIR, "answer", "world.json"), world)
    write_text(os.path.join(DIR, "user.md"), USER_MD)
    return dict(files=[F_DAY, F_COST], works=len(wl))


USER_MD = """# 葦原環境センター（架空）の担当者が答えられること

施設管理係の担当です。運転と維持管理は長期包括で委託しています（O&M）。

## ファイル
- 作業日報（R8.9月）：委託先が毎日 1 枚付ける作業日報です。1 日 1 シートで、シートの名前が日付（9.1 は 9 月 1 日）です。明細が 8 行に収まらない日は「(続)」のシートが続紙です。9 月前半の分だけ渡しました。
- 修繕・点検費 実績（R6-R8）：施設管理係が年度ごとにまとめている修繕と点検の費用です。保全の計画（星取表）ではありません。

## 欄と記号
- 日報の人工は人・日です（1 人工 = 8 時間）。「社員」は委託先の社員、「協力会社」はその下の業者です。
- 施工や設備の欄の 〃 は上の行と同じです。
- 日報の作業の無い日は、引継ぎの欄に「作業なし」と書きます。
- 実績集計の一番上の行が 3 年度の合計、「令和○年度 計」がその下に並ぶ年度の小計です。金額は千円（税込）です。
- R6 の発注日と完了日は和暦の文字で入れていました（R7 からは日付で入れています）。
- 下の「年間委託」の表は、年間の点検・保守の契約です。金額は円で、年額です。契約期間の「R6.4～R7.3」は令和6年度のことです。
- 発注日と完了日は契約の日付で、作業をした日そのものではありません。

## 号炉と呼び名
- 1号炉・1号は同じです。FDF は押込送風機、IDF は誘引送風機です。流動床炉は焼却炉の本体です。
- 「共通」は両炉で使う設備です（灰固化装置、ごみクレーン、計量機、空気圧縮機、排水処理設備、受変電設備）。
- 空気圧縮機は 2 台（No.1、No.2）。No.2 は令和元年に入れ替えました。

## 知っていること
- 令和7年度の計は、薬注ポンプの取替（2月発注）を足す前の数のままかもしれません。
"""
