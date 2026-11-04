# -*- coding: utf-8 -*-
"""施設 1：【架空】葦原クリーンプラザ（ごみ焼却）

資料：設備整備計画表（星取表, xlsx）・作業日報の書き出し（Shift_JIS の CSV）・
1 号炉 定期整備工事報告書（文字の PDF）
"""
import csv
import datetime as dt
import io
import os

import openpyxl
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from common import (Facility, TODAY, fy_of, iso, set_props, save_wb, wareki,
                    rl_canvas, write_text, WEEK, daterange)

D = dt.date
FID = "f-ashihara"
NAME = "【架空】葦原クリーンプラザ"
F_PLAN = "【架空】葦原CP_設備整備計画表_R1-R12.xlsx"
F_CSV = "【架空】葦原CP_作業日報データ_R7年度.csv"
F_PDF = "【架空】葦原CP_1号炉定期整備工事報告書_R7.pdf"
YEARS = list(range(2019, 2031))

V_OP = "葦原環境サービス㈱"
V_FURN = "蒼炉エンジニアリング㈱"
V_BOIL = "翠ボイラ技研㈱"
V_ELEC = "縹電設㈱"
V_DCS = "萌黄計装㈱"
V_CRANE = "鴇色クレーン整備㈱"
V_MEAS = "群青分析センター㈱"
V_TURB = "白群タービン㈱"
V_SCALE = "利休はかり商会"
V_ASH = "藤鼠機械㈱"
V_PREC = "鈍色環境技術研究所㈱"


def build():
    F = Facility(FID, NAME, "waste-incineration", {
        "furnace": "stoker", "capacity_t_per_day": 170, "lines": 2,
        "turbine": True, "turbine_kw": 1990, "dust": "BF", "ash": "搬出",
        "contract": "単年度", "upgrade": "planned-2028-2030", "completed": 2004,
    }, 1)
    R = F.rng
    E = F.eq
    # ---------------- 機器（1 台ずつ）
    E("E01", "計量機 No.1", ["受入供給設備", "計量機", "No.1"], None, 2004, "W-101")
    E("E02", "計量機 No.2", ["受入供給設備", "計量機", "No.2"], None, 2004, "W-102")
    E("E03", "ごみクレーン No.1", ["受入供給設備", "ごみクレーン", "No.1"], None, 2004, "CR-101")
    E("E04", "ごみクレーン No.2", ["受入供給設備", "ごみクレーン", "No.2"], None, 2004, "CR-102")
    for i, (part, base) in enumerate([("巻上装置", 5), ("走行装置", 7), ("バケット", 9)]):
        E(f"E{base:02d}", f"ごみクレーン No.1 {part}", ["受入供給設備", "ごみクレーン", "No.1", part], None, 2004)
        E(f"E{base + 1:02d}", f"ごみクレーン No.2 {part}", ["受入供給設備", "ごみクレーン", "No.2", part], None, 2004)
    E("E11", "ごみ供給装置 1号炉", ["燃焼設備", "ごみ供給装置", "1号炉"], 1, 2004, "FE-1101")
    E("E12", "ごみ供給装置 2号炉", ["燃焼設備", "ごみ供給装置", "2号炉"], 2, 2004, "FE-2101")
    E("E13", "火格子 1号炉", ["燃焼設備", "火格子", "1号炉"], 1, 2004, "GR-1101")
    E("E14", "火格子 2号炉", ["燃焼設備", "火格子", "2号炉"], 2, 2004, "GR-2101")
    E("E15", "耐火物 1号炉", ["燃焼設備", "耐火物", "1号炉"], 1, 2004)
    E("E16", "耐火物 2号炉", ["燃焼設備", "耐火物", "2号炉"], 2, 2004)
    E("E17", "廃熱ボイラ 1号炉", ["燃焼ガス冷却設備", "廃熱ボイラ", "1号炉"], 1, 2004, "SB-1101")
    E("E18", "廃熱ボイラ 2号炉", ["燃焼ガス冷却設備", "廃熱ボイラ", "2号炉"], 2, 2004, "SB-2101")
    E("E19", "ボイラ給水ポンプ 1号炉 No.1", ["燃焼ガス冷却設備", "ボイラ給水ポンプ", "1号炉", "No.1"], 1, 2004, "BFP-1101")
    E("E20", "ボイラ給水ポンプ 1号炉 No.2", ["燃焼ガス冷却設備", "ボイラ給水ポンプ", "1号炉", "No.2"], 1, 2004, "BFP-1102")
    E("E21", "ボイラ給水ポンプ 2号炉 No.1", ["燃焼ガス冷却設備", "ボイラ給水ポンプ", "2号炉", "No.1"], 2, 2004, "BFP-2101")
    E("E22", "ボイラ給水ポンプ 2号炉 No.2", ["燃焼ガス冷却設備", "ボイラ給水ポンプ", "2号炉", "No.2"], 2, 2004, "BFP-2102")
    E("E42", "ボイラ給水ポンプ 共通予備 No.3", ["燃焼ガス冷却設備", "ボイラ給水ポンプ", "共通", "No.3"], None, 2012, "BFP-0103")
    E("E23", "ろ過式集じん器 1号炉", ["排ガス処理設備", "ろ過式集じん器", "1号炉"], 1, 2004, "BF-1101")
    E("E24", "ろ過式集じん器 2号炉", ["排ガス処理設備", "ろ過式集じん器", "2号炉"], 2, 2004, "BF-2101")
    E("E25", "脱硝反応塔 1号炉", ["排ガス処理設備", "脱硝反応塔", "1号炉"], 1, 2004, "DN-1101")
    E("E26", "脱硝反応塔 2号炉", ["排ガス処理設備", "脱硝反応塔", "2号炉"], 2, 2004, "DN-2101")
    E("E27", "消石灰供給装置", ["排ガス処理設備", "消石灰供給装置"], None, 2004, "CA-001")
    E("E28", "押込送風機 1号炉", ["通風設備", "押込送風機", "1号炉"], 1, 2004, "FDF-1101")
    E("E29", "押込送風機 2号炉", ["通風設備", "押込送風機", "2号炉"], 2, 2004, "FDF-2101")
    E("E30", "誘引通風機 1号炉", ["通風設備", "誘引通風機", "1号炉"], 1, 2004, "IDF-1101")
    E("E31", "誘引通風機 2号炉", ["通風設備", "誘引通風機", "2号炉"], 2, 2004, "IDF-2101")
    E("E32", "蒸気タービン", ["余熱利用設備", "蒸気タービン"], None, 2004, "ST-001")
    E("E33", "発電機", ["余熱利用設備", "発電機"], None, 2004, "G-001")
    E("E34", "灰クレーン", ["灰出し設備", "灰クレーン"], None, 2004, "AC-101")
    E("E35", "飛灰処理装置", ["灰出し設備", "飛灰処理装置"], None, 2010, "FA-101")
    E("E36", "受変電設備", ["電気設備", "受変電設備"], None, 2004)
    E("E37", "非常用発電機", ["電気設備", "非常用発電機"], None, 2004, "EG-001")
    E("E38", "DCS", ["計装設備", "DCS"], None, 2016)
    E("E39", "焼却炉 1号炉", ["燃焼設備", "焼却炉", "1号炉"], 1, 2004)
    E("E40", "焼却炉 2号炉", ["燃焼設備", "焼却炉", "2号炉"], 2, 2004)
    E("E43", "灰押出装置 1号炉", ["灰出し設備", "灰押出装置", "1号炉"], 1, 2004)
    E("E44", "灰押出装置 2号炉", ["灰出し設備", "灰押出装置", "2号炉"], 2, 2004)
    E("E41", "施設全体", ["施設全体"], None, 2004)

    FURN_EQ = {k: [e for e in F.eq_order if F.equipment[e]["furnace"] == k] for k in (1, 2)}

    # ---------------- 年度ごとの整備の窓
    win = {}
    for y in YEARS:
        s1 = D(y, 5, 7) + dt.timedelta(days=R.randint(0, 6))
        e1 = s1 + dt.timedelta(days=25)
        sa = e1 + dt.timedelta(days=1)
        ea = sa + dt.timedelta(days=13)
        s2 = ea + dt.timedelta(days=1)
        e2 = s2 + dt.timedelta(days=25)
        win[y] = {1: (s1, e1), "all": (sa, ea), 2: (s2, e2),
                  "blackout": sa + dt.timedelta(days=6)}

    def ddays(a, b):
        return (b - a).days + 1

    def mk_daily(start, end, persons, hours=8.0, skip_sun=True):
        """作業の日ごとの人数と時間（日報の行のもと）"""
        out = []
        for d in daterange(start, end):
            if skip_sun and d.weekday() == 6 and ddays(start, end) > 2:
                continue
            p = max(1, persons + R.choice([-1, 0, 0, 1]))
            h = R.choice([hours, hours, hours, 4.0, 12.0]) if hours >= 8.0 else hours
            out.append((d, p, h))
        return out

    def place(kind, y, off, dur, persons, hours=8.0):
        if kind in (1, 2, "all"):
            s0, e0 = win[y][kind]
            s = s0 + dt.timedelta(days=off)
            e = min(e0, s + dt.timedelta(days=dur - 1))
        elif kind == "blackout":
            s = e = win[y]["blackout"]
        elif kind == "after_blackout":
            s = win[y]["blackout"] + dt.timedelta(days=1)
            e = s + dt.timedelta(days=dur - 1)
        else:  # (月, 日)
            m, dd = kind
            yy = y if m >= 4 else y + 1
            s = D(yy, m, dd)
            e = s + dt.timedelta(days=dur - 1)
        daily = mk_daily(s, e, persons, hours)
        md = round(sum(p * h for _, p, h in daily) / 8, 4)
        return s, e, daily, md

    # ---------------- 星取表の行の仕様
    # lvl: 1=設備(B) 2=機器(C) 3=号炉・部位(D) 4=D の全角字下げ
    # groups: [(eids, 窓, off, dur, persons)]
    rows = []

    def P(num, lvl, name, **kw):
        rows.append(dict(num=num, lvl=lvl, name=name, kind="parent", **kw))

    def I(num, lvl, name, work, cycle, phase, cost, groups, attr="INSPECT", vendor=V_FURN, **kw):
        rows.append(dict(num=num, lvl=lvl, name=name, kind="item", work=work, cycle=cycle,
                         phase=phase, cost=cost, groups=groups, attr=attr, vendor=vendor, **kw))

    P("1", 1, "受入供給設備")
    I("1-1", 2, "計量機", "定期点検", 1, 2019, 450, [(["E01", "E02"], (11, 10), 0, 1, 2)],
      vendor=V_SCALE, code="W-101・102")
    I("", 2, "〃", "定期検査（計量法）", 2, 2020, 380, [(["E01", "E02"], (11, 11), 0, 1, 2)],
      vendor=V_SCALE, resolve="計量機", legal=True)
    I("1-2", 2, "ごみクレーン", "年次自主検査", 1, 2019, 1600,
      [(["E03"], (2, 3), 0, 2, 3), (["E04"], (2, 5), 0, 2, 3)], vendor=V_CRANE,
      code="CR-101/102", own_parent=True)
    I("", 2, "〃", "性能検査（クレーン則）", 2, 2019, 1400, [(["E03", "E04"], (2, 12), 0, 1, 3)],
      vendor=V_CRANE, resolve="ごみクレーン", legal=True)
    I("1-2-1", 3, "巻上装置", "ワイヤロープ取替", 2, 2020, 900,
      [(["E05"], "all", 1, 2, 3), (["E06"], "all", 3, 2, 3)], attr="REPLACE", vendor=V_CRANE)
    I("1-2-2", 3, "走行装置", "車輪・減速機点検", 3, 2019, 700,
      [(["E07"], "all", 5, 2, 2), (["E08"], "all", 7, 2, 2)], attr="INSPECT", vendor=V_CRANE)
    I("1-2-3", 3, "バケット", "爪・油圧シリンダ整備", 2, 2019, 1200,
      [(["E09"], "all", 1, 3, 3), (["E10"], "all", 4, 3, 3)], attr="OVERHAUL", vendor=V_CRANE)
    P("2", 1, "燃焼設備")
    P("2-1", 2, "ごみ供給装置")
    I("2-1-1", 3, "1号炉", "給じん装置整備", 1, 2019, 2200, [(["E11"], 1, 6, 4, 4)], attr="OVERHAUL", code="FE-1101")
    I("2-1-2", 3, "2号炉", "〃", 1, 2019, 2200, [(["E12"], 2, 6, 4, 4)], attr="OVERHAUL", code="FE-2101",
      work_resolve="給じん装置整備")
    P("2-2", 2, "火格子")
    I("2-2-1", 3, "１号炉", "火格子取替（一部）", 3, 2019, 8000, [(["E13"], 1, 7, 6, 5)], attr="REPLACE", code="GR-1101")
    I("2-2-2", 3, "#2", "火格子取替（一部）", 3, 2020, 8000, [(["E14"], 2, 7, 6, 5)], attr="REPLACE", code="GR-2101")
    I("2-3", 2, "耐火物", "部分補修", 1, 2019, 6000,
      [(["E15"], 1, 9, 7, 5), (["E16"], 2, 9, 7, 5)], attr="OVERHAUL", sub="1・2号炉")
    P("3", 1, "燃焼ガス冷却設備")
    P("3-1", 2, "廃熱ボイラ")
    I("3-1-1", 3, "1号炉 (SB-1101)", "性能検査受検整備（ボイラー則）", 1, 2019, 3500,
      [(["E17"], 1, 10, 7, 5)], attr="INSPECT", vendor=V_BOIL, legal=True, code_in_name="SB-1101")
    I("3-1-2", 3, "2号炉 (SB-2101)", "性能検査受検整備（ボイラー則）", 1, 2019, 3500,
      [(["E18"], 2, 10, 7, 5)], attr="INSPECT", vendor=V_BOIL, legal=True, code_in_name="SB-2101")
    P("3-2", 2, "ボイラ給水ポンプ")
    P("", 3, "1号炉")
    I("", 4, "No.1", "分解整備", 4, 2021, 1800, [(["E19"], 1, 8, 3, 3)], attr="OVERHAUL", vendor=V_BOIL, code="BFP-1101")
    I("", 4, "No.2", "分解整備", 4, 2022, 1800, [(["E20"], 1, 8, 3, 3)], attr="OVERHAUL", vendor=V_BOIL, code="BFP-1102")
    P("", 3, "2号炉")
    I("", 4, "No.1", "分解整備", 4, 2019, 1800, [(["E21"], 2, 8, 3, 3)], attr="OVERHAUL", vendor=V_BOIL, code="BFP-2101")
    I("", 4, "No.2", "分解整備", 4, 2020, 1800, [(["E22"], 2, 8, 3, 3)], attr="OVERHAUL", vendor=V_BOIL, code="BFP-2102")
    I("", 3, "共通 No.3", "分解整備", 4, 2023, 1800, [(["E42"], "all", 2, 3, 3)], attr="OVERHAUL", vendor=V_BOIL,
      code="BFP-0103", memo="H24 新設（共通予備機）", start_year=2012)
    P("4", 1, "排ガス処理設備")
    P("4-1", 2, "ろ過式集じん器（バグフィルタ）")
    I("4-1-1", 3, "1号炉", "ろ布取替", 5, 2020, 15000, [(["E23"], 1, 12, 5, 6)], attr="REPLACE", code="BF-1101")
    I("4-1-2", 3, "2号炉", "ろ布取替", 5, 2020, 15000, [(["E24"], 2, 12, 5, 6)], attr="REPLACE", code="BF-2101")
    I("4-2", 2, "脱硝反応塔", "触媒取替（1層）", 4, 2023, 12000,
      [(["E25"], 1, 15, 3, 4), (["E26"], 2, 15, 3, 4)], attr="REPLACE", sub="1・2号炉")
    I("4-3", 2, "消石灰供給装置", "定期点検", 2, 2019, 600, [(["E27"], "all", 2, 2, 2)], code="CA-001",
      memo="両炉へ分岐（共通）")
    P("5", 1, "通風設備")
    I("5-1", 2, "押込送風機", "点検", 2, 2019, 800,
      [(["E28"], 1, 6, 2, 2), (["E29"], 2, 6, 2, 2)], sub="1・2号炉")
    P("5-2", 2, "誘引通風機")
    I("5-2-1", 3, "1号炉", "軸受・インペラ点検", 2, 2019, 1500, [(["E30"], 1, 8, 3, 3)], code="IDF-1101",
      cmt_name="日報では IDF、工事報告書では誘引送風機と書く")
    I("5-2-2", 3, "2号炉", "軸受・インペラ点検", 2, 2020, 1500, [(["E31"], 2, 8, 3, 3)], code="IDF-2101")
    P("6", 1, "余熱利用設備")
    I("6-1", 2, "蒸気タービン", "年次点検", 1, 2019, 2500, [(["E32"], "all", 1, 5, 4)], vendor=V_TURB, code="ST-001",
      own_parent=False)
    I("", 2, "〃", "定期事業者検査（開放）", 4, 2022, 22000, [(["E32"], "all", 1, 12, 6)], vendor=V_TURB,
      resolve="蒸気タービン", legal=True, attr="OVERHAUL")
    I("6-2", 2, "発電機", "精密点検", 4, 2022, 4000, [(["E33"], "all", 3, 6, 3)], vendor=V_TURB, code="G-001")
    P("7", 1, "灰出し設備")
    I("7-1", 2, "灰クレーン", "年次自主検査", 1, 2019, 900, [(["E34"], (2, 18), 0, 2, 3)], vendor=V_CRANE, code="AC-101", legal=True)
    I("7-2", 2, "飛灰処理装置", "混練機整備", 2, 2020, 1300, [(["E35"], "all", 4, 3, 3)], vendor=V_ASH, code="FA-101",
      attr="OVERHAUL", memo="H22 新設")
    P("8", 1, "電気設備")
    I("8-1", 2, "受変電設備", "年次点検（全停電）", 1, 2019, 1100, [(["E36"], "blackout", 0, 1, 6)], vendor=V_ELEC, legal=True)
    I("8-2", 2, "非常用発電機", "点検・負荷運転", 1, 2019, 500, [(["E37"], "blackout", 0, 1, 2)], vendor=V_ELEC,
      code="EG-001", legal=True)
    P("9", 1, "計装設備")
    I("9-1", 2, "DCS", "定期点検", 1, 2019, 2800, [(["E38"], "after_blackout", 0, 2, 3)], vendor=V_DCS,
      memo="H28 更新。R13に次の更新の予定")
    P("10", 1, "炉全体・施設全体")
    I("10-1", 2, "1号炉", "定期整備工事", 1, 2019, None, [(FURN_EQ[1], 1, 0, 26, 0)], attr="OVERHAUL",
      memo="工事一式（内訳は各機器の行）", umbrella=1)
    I("10-2", 2, "2号炉", "定期整備工事", 1, 2019, None, [(FURN_EQ[2], 2, 0, 26, 0)], attr="OVERHAUL",
      memo="工事一式（内訳は各機器の行）", umbrella=2)
    I("10-3", 2, "共通", "全休炉整備（両炉停止）", 1, 2019, None, [(["E41"], "all", 0, 14, 0)], attr="OVERHAUL",
      umbrella="all")
    I("10-4", 2, "施設全体", "精密機能検査", 3, 2019, 4200, [(["E41"], (10, 20), 0, 3, 3)], vendor=V_PREC,
      precision=True)
    I("10-5", 2, "〃", "排ガス測定（年4回）", 1, 2019, 2400,
      [(["E41"], (5, 20), 0, 1, 2), (["E41"], (8, 19), 0, 1, 2), (["E41"], (11, 18), 0, 1, 2),
       (["E41"], (2, 17), 0, 1, 2)], vendor=V_MEAS, resolve="施設全体", legal=True)
    I("10-6", 2, "〃", "基幹的設備改良工事", None, None, 4500000, [], attr="UPGRADE", resolve="施設全体",
      memo="※合計に含まない（交付金事業・3か年）", upgrade=True)

    # ---------------- 作業を作る
    VENDOR_OF_WIN = {1: V_FURN, 2: V_FURN, "all": V_FURN}
    for row in rows:
        if row["kind"] != "item":
            continue
        row["years"] = {}
        if row.get("upgrade"):
            w = F.work("基幹的設備改良工事（3か年）", "UPGRADE", "planned", 2028, ["E41"] + FURN_EQ[1] + FURN_EQ[2],
                       start=D(2028, 7, 1), end=D(2031, 3, 15), days=ddays(D(2028, 7, 1), D(2031, 3, 15)),
                       vendor=None, precision=False)
            row["years"] = {2028: [w], 2029: [w], 2030: [w]}
            continue
        for y in YEARS:
            if (y - row["phase"]) % row["cycle"] != 0:
                continue
            if row.get("start_year") and y < row["start_year"]:
                continue
            ws = []
            for (eids, kind, off, dur, persons) in row["groups"]:
                if row.get("umbrella"):
                    s, e = win[y][row["umbrella"]]
                    daily, md = [], None
                else:
                    s, e, daily, md = place(kind, y, off, dur, persons)
                st = "actual" if e < TODAY else "planned"
                name = row["name"] if row["name"] != "〃" else row["resolve"]
                wk = row.get("work_resolve") or row["work"]
                eqn = " / ".join(F.equipment[x]["name"] for x in eids) if len(eids) <= 2 else name
                w = F.work(f"{eqn} {wk}", row["attr"], st, y, eids, start=s, end=e,
                           man_days=md, days=ddays(s, e), vendor=row["vendor"],
                           contract=None, precision=bool(row.get("precision")))
                w["_daily"] = daily
                w["_wtxt"] = wk
                ws.append(w)
            row["years"][y] = ws

    # 計画の欠け：受変電の年次点検の R10（2028）の計画が抜けている（作業も無い）
    rr = [r_ for r_ in rows if r_["kind"] == "item" and r_["name"] == "受変電設備"][0]
    for w in rr["years"].pop(2028):
        F.works.remove(w)

    # ---------------- 星取表の印（汚さを入れる）
    # 既定：actual → ●、planned → ○
    omit, notup, shift, delay = [], [], [], []
    cells = []  # (row, y)
    for row in rows:
        if row["kind"] != "item" or row.get("upgrade"):
            continue
        row["marks"] = {}
        for y, ws in row["years"].items():
            if all(w["status"] == "actual" for w in ws):
                row["marks"][y] = "●"
            elif all(w["status"] == "planned" for w in ws):
                row["marks"][y] = "○"
            else:
                row["marks"][y] = "●"
            cells.append((row, y))
    row_by_num = {}
    for row in rows:
        if row["kind"] == "item":
            row_by_num[(row["num"], row["name"], row["work"])] = row

    def find(name, work):
        for row in rows:
            if row["kind"] == "item" and row["name"] == name and row["work"] == work:
                return row
        raise KeyError((name, work))

    # 延期（○→ を書き、次の年度に ● ）：作業の年度と日付を 1 年ずらす
    for (name, work, y, why, cellref) in [
        ("１号炉", "火格子取替（一部）", 2022, "延期：R4 は耐火物の補修を優先（予算）。R5 に実施", None),
        ("No.1", "分解整備", 2021, "延期：部品の納期遅れのため R4 に実施", "E19"),
    ]:
        row = find(name, work) if name != "No.1" else [r for r in rows if r["kind"] == "item" and r.get("code") == "BFP-1101"][0]
        ws = row["years"].pop(y)
        for w in ws:
            w["fiscal_year"] = y + 1
            ny = y + 1
            k = row["groups"][0][1]
            s, e, daily, md = place(k, ny, row["groups"][0][2], row["groups"][0][3], row["groups"][0][4])
            w.update(start=iso(s), end=iso(e), man_days=md, days=ddays(s, e))
            w["_daily"] = daily
            w["delayed_from"] = y
        row["years"][y + 1] = ws
        row["marks"].pop(y)
        row["marks"][y] = "○→"
        row["marks"][y + 1] = "●"
        row.setdefault("delays", {})[y] = (ws, why)

    # 一部実施（△）
    row = find("2号炉", "ろ布取替")
    row["marks"][2020] = "△"
    for w in row["years"][2020]:
        w["label"] += "（半数のみ）"
        w["partial"] = True
    row.setdefault("cmts", {})[2020] = "ろ布の半数（3室分）のみ取替。残りは R7 に"
    # 計画外の臨時実施（凡例に無い ◇）
    row = find("2号炉", "軸受・インペラ点検")
    s, e, daily, md = place(2, 2023, 8, 3, 3)
    w = F.work("誘引通風機 2号炉 軸受点検（臨時）", "INSPECT", "actual", 2023, ["E31"], start=s, end=e,
               man_days=md, days=ddays(s, e), vendor=V_FURN, precision=False)
    w["_daily"] = daily
    w["_wtxt"] = "軸受点検（臨時）"
    row["years"][2023] = [w]
    row["marks"][2023] = "◇"
    row.setdefault("cmts", {})[2023] = "計画外の臨時実施（軸受の異音のため）"

    # 実績の書き漏れ（● を空欄に）・年度の書き間違い（隣の年度の列に ●）・最後の年度の未反映（● のまま ○）
    past = [(row, y) for (row, y) in cells if y <= 2025 and row["marks"].get(y) == "●"
            and not row.get("umbrella")]
    R.shuffle(past)
    n_omit = max(3, round(len(past) * 0.03))
    n_shift = max(2, round(len(past) * 0.02))
    omitted, shifted = [], []
    for (row, y) in past:
        if len(omitted) < n_omit and y <= 2024:
            row["marks"].pop(y)
            omitted.append((row, y))
            continue
        if len(shifted) < n_shift and y <= 2024:
            ny = y + 1 if R.random() < 0.5 else y - 1
            if ny in YEARS and ny not in row["marks"] and ny not in row["years"]:
                row["marks"].pop(y)
                row["marks"][ny] = "●"
                row.setdefault("shifted", {})[ny] = y
                shifted.append((row, y, ny))
    for (row, y) in cells:
        if y == 2026 and row["marks"].get(2026) == "●" and R.random() < 0.5:
            row["marks"][2026] = "○"
            row.setdefault("notup", []).append(2026)

    def rid(r):
        nm = r.get("resolve") or r["name"]
        if r["lvl"] == 4 or (not r["num"] and r.get("code")):
            nm = f"{nm}（{r['code']}）"
        return f"{r['num']} {nm}".strip()
    def wk(r):
        return r.get("work_resolve") or r["work"]
    F._f1_dirt = dict(omitted=[(rid(r), wk(r), y) for r, y in omitted],
                      shifted=[(rid(r), wk(r), y, ny) for r, y, ny in shifted],
                      notup=[(rid(r), wk(r)) for r in rows if r.get("notup")])

    # ---------------- 日報だけにある作業（R7 年度）：月例点検・付帯作業・補修
    extra = []
    y = 2025
    for k, eq_f in ((1, "E39"), (2, "E40")):
        s0, e0 = win[y][k]
        seq = [("立下げ", 0, 1, 3, "付帯"), ("炉内冷却", 1, 2, 2, "付帯"),
               ("ダイオキシン類 作業前測定・養生", 3, 1, 4, "付帯"), ("付着物除去（クリンカ・灰）", 4, 2, 6, "付帯"),
               ("足場組立", 5, 2, 5, "付帯"), ("足場解体", 20, 2, 5, "付帯"),
               ("養生撤去・作業後測定", 22, 1, 4, "付帯"), ("空打ち試運転", 23, 2, 3, "付帯"),
               ("立上げ", 25, 1, 3, "付帯")]
        for (lab, off, dur, per, cat) in seq:
            s, e, daily, md = place(k, y, off, dur, per)
            w = F.work(f"{k}号炉 {lab}", "INSPECT" if "測定" in lab else "OVERHAUL", "actual", y, [eq_f],
                       start=s, end=e, man_days=md, days=ddays(s, e), vendor=V_FURN if "測定" not in lab else V_MEAS,
                       precision=False)
            w["_daily"] = daily
            w["_cat"] = cat
            w["_furnace"] = k
            w["_wtxt"] = lab
            extra.append(w)
        s, e, daily, md = place(k, y, 7, 3, 3)
        w = F.work(f"灰押出装置 {k}号炉 点検整備", "OVERHAUL", "actual", y, [f"E{42 + k}"], start=s, end=e,
                   man_days=md, days=ddays(s, e), vendor=V_FURN, precision=False)
        w["_daily"] = daily
        w["_furnace"] = k
        w["_wtxt"] = "点検整備"
        extra.append(w)
    # 月例点検（日報だけ）
    for m in [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]:
        yy = 2025 if m >= 4 else 2026
        d0 = D(yy, m, 1)
        while d0.weekday() != 2:  # 第 1 水曜
            d0 += dt.timedelta(days=1)
        for (lab, eids, per, h, ven) in [("受変電設備 月次点検", ["E36"], 1, 3.0, V_ELEC),
                                          ("非常用発電機 月次点検・無負荷運転", ["E37"], 1, 2.0, V_ELEC)]:
            if lab.startswith("受変電") and d0 == win[2025]["blackout"]:
                continue
            w = F.work(lab, "INSPECT", "actual", 2025, eids, start=d0, end=d0, man_days=round(per * h / 8, 4),
                       days=1, vendor=ven, precision=False)
            w["_daily"] = [(d0, per, h)]
            w["_cat"] = "点検"
            w["_wtxt"] = lab.split(" ", 1)[1]
            extra.append(w)
    # 事後の補修（日報だけ。星取表にはほとんど書かない）
    repairs = [
        ("ごみクレーン No.2 バケット 油圧ホース破損 取替", ["E10"], D(2025, 4, 22), 1, 2, 6.0, V_CRANE, "補修"),
        ("2号炉 誘引通風機 軸受温度上昇 グリス補給・点検", ["E31"], D(2025, 8, 5), 1, 2, 4.0, V_OP, "補修"),
        ("計量機 No.1 表示器 不調 調整", ["E01"], D(2025, 9, 9), 1, 1, 3.0, V_SCALE, "補修"),
        ("1号炉 ごみ供給装置 プッシャ 油漏れ 補修", ["E11"], D(2025, 10, 14), 2, 3, 8.0, V_FURN, "補修"),
        ("飛灰処理装置 混練機 キレート配管 閉塞 清掃", ["E35"], D(2025, 11, 26), 1, 2, 5.0, V_OP, "補修"),
        ("ボイラ給水ポンプ 1号炉 No.2 メカニカルシール 取替", ["E20"], D(2025, 12, 16), 2, 3, 8.0, V_BOIL, "補修"),
        ("2号炉 火格子 落じん 清掃・可動部点検", ["E14"], D(2026, 1, 20), 1, 3, 7.5, V_OP, "補修"),
        ("ごみクレーン No.1 走行装置 異音 点検", ["E07"], D(2026, 2, 24), 1, 2, 4.0, V_CRANE, "補修"),
        ("消石灰供給装置 ロータリーバルブ 詰まり 除去", ["E27"], D(2026, 3, 10), 1, 2, 3.5, V_OP, "補修"),
    ]
    for (lab, eids, d0, dur, per, h, ven, cat) in repairs:
        daily = [(d0 + dt.timedelta(days=i), per, h) for i in range(dur)]
        w = F.work(lab, "OVERHAUL" if "取替" not in lab else "REPLACE", "actual", 2025, eids, start=d0,
                   end=d0 + dt.timedelta(days=dur - 1), man_days=round(sum(p * hh for _, p, hh in daily) / 8, 4),
                   days=dur, vendor=ven, precision=False)
        w["_daily"] = daily
        w["_cat"] = cat
        w["_wtxt"] = lab
        extra.append(w)
    # どの資料にも無い作業
    w = F.work("ごみ投入扉 3番 リミットスイッチ 調整（職員）", "OVERHAUL", "actual", 2025, ["E41"],
               start=D(2025, 7, 30), end=D(2025, 7, 30), man_days=0.25, days=1, vendor="職員", precision=False)
    F.unrecorded.append({"work": w["id"], "reason": "職員が直したが、日報の書き出しに載せなかった（委託先の日報だけを書き出すため）"})

    # ---------------- 書き出す
    write_plan(F, rows, win)
    write_csv(F, rows, extra, win)
    write_pdf(F, rows, extra, win)

    # 書き漏れの作業のうち、どの資料にも無いもの
    for w in F.works:
        if not w["rows"] and w["status"] == "actual" and not any(u["work"] == w["id"] for u in F.unrecorded):
            F.unrecorded.append({"work": w["id"], "reason": "星取表の実績の書き漏れで、その年度の日報の書き出しも無い"})
    for w in F.works:
        if not w["rows"] and w["status"] == "planned":
            raise SystemExit(f"予定の作業に行が無い {w}")

    F.defects.append({"kind": "費用の小計の食い違い",
                      "where": f"{F_PLAN} 整備計画表 の『電気・計装設備　小計』の行の R9（2027）の列（明細の和より 500 千円多い）",
                      "check": "費用の小計と明細の和の食い違い"})
    F.defects.append({"kind": "法令の点検の抜け",
                      "where": f"{F_PLAN} 整備計画表 の『受変電設備 年次点検（全停電）』の行の R10（2028）に計画の印が無い",
                      "check": "法令の点検の抜け（電気事業法の保安規程による年次点検）"})
    for (rn, wk, y) in F._f1_dirt["omitted"]:
        F.defects.append({"kind": "実績の書き漏れ（見かけの抜け）", "where": f"{F_PLAN} 整備計画表 の『{rn} {wk}』の {y} 年度の印が空",
                          "check": "周期の超え・法令の点検の抜け（見かけ。実際には実施済み）"})
    for w in F.works:
        for k in [k for k in w if k.startswith("_")]:
            del w[k]
    write_user(F)
    F.write_answers()
    return F


def hours_text(h):
    m = {4.0: "8:30-12:30", 8.0: "8:30-17:30", 12.0: "8:00-21:00", 7.5: "8:30-17:00"}
    if h in m:
        return m[h]
    end = 9 * 60 + int(h * 60)
    return f"9:00-{end // 60}:{end % 60:02d}"


# ======================================================================
THIN = Side(style="thin", color="000000")
HAIR = Side(style="hair", color="808080")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def write_plan(F, rows, win):
    wb = openpyxl.Workbook()
    set_props(wb, "【架空】葦原クリーンプラザ 設備整備計画表")
    ws = wb.active
    ws.title = "整備計画表"
    SH = ws.title
    recs = F.file(F_PLAN, True)
    f9 = Font(name="ＭＳ ゴシック", size=9)
    ws["A1"] = "【架空】葦原クリーンプラザ　設備整備計画表（機械・電気・計装）"
    ws["A1"].font = Font(name="ＭＳ ゴシック", size=14, bold=True)
    ws["A2"] = "【架空のデータ】　施設管理課　R8.9 更新　　費用：千円（税抜）"
    ws["A2"].font = f9
    YC = {y: 9 + i for i, y in enumerate(YEARS)}  # I..T
    UC = 9 + len(YEARS)  # U
    # 見出し 3 段（r5〜r7）
    hdr = [(1, "No."), (2, "設備・機器名称"), (5, "機器番号"), (6, "点検・整備内容"), (7, "周期\n（年）"),
           (8, "概算費用\n（千円/回）")]
    for c, t in hdr:
        ws.cell(5, c, t)
    ws.merge_cells("A5:A7")
    ws.merge_cells("B5:D7")
    for col in "EFGH":
        ws.merge_cells(f"{col}5:{col}7")
    ws.cell(5, YC[2019], "実　施　年　度")
    ws.merge_cells(start_row=5, start_column=YC[2019], end_row=5, end_column=YC[2030])
    ws.cell(6, YC[2019], "令　　　和")
    ws.merge_cells(start_row=6, start_column=YC[2019], end_row=6, end_column=YC[2030])
    for y in YEARS:
        ws.cell(7, YC[y], "元" if y == 2019 else y - 2018)
    ws.cell(5, UC, "備　考")
    ws.merge_cells(start_row=5, start_column=UC, end_row=7, end_column=UC)
    for r in range(5, 8):
        for c in range(1, UC + 1):
            cl = ws.cell(r, c)
            cl.border = BOX
            cl.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cl.font = Font(name="ＭＳ ゴシック", size=9, bold=True)
            cl.fill = PatternFill("solid", fgColor="D9E1F2")
    # 合計の行（表の上）
    TOTAL_R = 8
    ws.cell(TOTAL_R, 2, "概算費用 合計（千円）")
    ws.merge_cells(start_row=TOTAL_R, start_column=2, end_row=TOTAL_R, end_column=8)
    recs.append({"sheet": SH, "r": TOTAL_R, "kind": "total", "fields": {}})
    r = 9
    names_stack = {}
    last = {2: None, 3: None}
    subtotal_groups = {"機械": ["1", "2", "3", "4", "5", "6", "7"], "電気": ["8", "9"]}
    current_top = None
    sums = {"機械": {y: 0 for y in YEARS}, "電気": {y: 0 for y in YEARS}, "全体": {y: 0 for y in YEARS}}

    def put_subtotal(label, key, bump=None):
        nonlocal r
        ws.cell(r, 2, label)
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=8)
        for y in YEARS:
            v = sums[key][y]
            if bump and y == bump[0]:
                v += bump[1]
            if v:
                ws.cell(r, YC[y], v).number_format = "#,##0"
        for c in range(1, UC + 1):
            ws.cell(r, c).fill = PatternFill("solid", fgColor="F2F2F2")
            ws.cell(r, c).border = BOX
        recs.append({"sheet": SH, "r": r, "kind": "subtotal", "fields": {}})
        r += 1

    for row in rows:
        top = row["num"].split("-")[0] if row["num"] else None
        if row["lvl"] == 1 and current_top in ("7",) and top == "8":
            put_subtotal("機械設備　小計", "機械")
        if row["lvl"] == 1 and current_top in ("9",) and top == "10":
            put_subtotal("電気・計装設備　小計", "電気", bump=(2027, 500))
        if row["lvl"] == 1:
            current_top = top
        lvl = row["lvl"]
        col = {1: 2, 2: 3, 3: 4, 4: 4}[lvl]
        shown = row["name"] if lvl != 4 else "　" + row["name"]
        if row.get("sub"):
            pass
        ws.cell(r, 1, row["num"] or None)
        ws.cell(r, col, shown)
        # 道
        real = row["name"] if row["name"] != "〃" else row["resolve"]
        if lvl == 1:
            names_stack = {1: real}
        elif lvl == 2:
            names_stack = {1: names_stack[1], 2: real}
        elif lvl == 3:
            names_stack = {1: names_stack[1], 2: names_stack[2], 3: real}
        else:
            names_stack = {1: names_stack[1], 2: names_stack[2], 3: names_stack[3], 4: real}
        path = [names_stack[k] for k in sorted(names_stack)]
        if row.get("sub"):
            ws.cell(r, 4, row["sub"])
            path = path + [row["sub"]]
        fields = {"path": path}
        eids_row = sorted({e for ws_ in row.get("years", {}).values() for w in ws_ for e in w["equipment"]}) \
            if row["kind"] == "item" else []
        if row["kind"] == "item":
            code = row.get("code")
            if code:
                ws.cell(r, 5, code)
                fields["code"] = code
            elif row.get("code_in_name"):
                fields["code"] = row["code_in_name"]
            ws.cell(r, 6, row["work"])
            fields["work"] = row.get("work_resolve") or row["work"]
            if row["cycle"]:
                ws.cell(r, 7, row["cycle"])
                fields["cycle"] = row["cycle"]
            if row["cost"]:
                ws.cell(r, 8, row["cost"]).number_format = "#,##0"
                fields["cost"] = row["cost"]
                fields["unit"] = "千円"
            marks = {}
            if row.get("upgrade"):
                ws.cell(r, YC[2028], "○")
                ws.merge_cells(start_row=r, start_column=YC[2028], end_row=r, end_column=YC[2030])
                marks = {"2028": "○", "2029": "○", "2030": "○"}
                for y in (2028, 2029, 2030):
                    F.link(row["years"][y][0], F_PLAN, sheet=SH, r=r, year=y)
            else:
                for y in sorted(row["marks"]):
                    sym = row["marks"][y]
                    ws.cell(r, YC[y], sym)
                    marks[str(y)] = sym
                    if sym != "○→" and row["cost"]:
                        key = "機械" if current_top in subtotal_groups["機械"] else ("電気" if current_top in subtotal_groups["電気"] else None)
                        if key:
                            sums[key][y] += row["cost"]
                        sums["全体"][y] += row["cost"]
                    # 作業との結び
                    if y in row["years"]:
                        for w in row["years"][y]:
                            F.link(w, F_PLAN, sheet=SH, r=r, year=y)
                    elif y in row.get("shifted", {}):
                        for w in row["years"][row["shifted"][y]]:
                            F.link(w, F_PLAN, sheet=SH, r=r, year=y)
                    elif sym == "○→":
                        for w in row["delays"][y][0]:
                            F.link(w, F_PLAN, sheet=SH, r=r, year=y)
            fields["marks"] = marks
            memo = row.get("memo")
            if memo:
                ws.cell(r, UC, memo)
                fields["memo"] = memo
            cm = {}
            for y, txt in row.get("cmts", {}).items():
                ref = f"{openpyxl.utils.get_column_letter(YC[y])}{r}"
                ws[ref].comment = Comment(txt, "施設管理課")
                cm[ref] = txt
            for y, (ws_, why) in row.get("delays", {}).items():
                ref = f"{openpyxl.utils.get_column_letter(YC[y])}{r}"
                ws[ref].comment = Comment(why, "施設管理課")
                cm[ref] = why
            if row.get("cmt_name"):
                ref = f"{openpyxl.utils.get_column_letter(col)}{r}"
                ws[ref].comment = Comment(row["cmt_name"], "施設管理課")
                cm[ref] = row["cmt_name"]
            if cm:
                fields["comments"] = cm
            kind = "parent" if row.get("own_parent") else "item"
            recs.append({"sheet": SH, "r": r, "kind": kind, "fields": fields})
            # 機器の行
            if not row.get("umbrella") and not row.get("upgrade") and real not in ("施設全体",):
                F.eq_row(eids_row, F_PLAN, {"sheet": SH, "r": r}, shown.strip() if row["name"] != "〃" else row["resolve"])
            else:
                F.eq_name(eids_row[:0], F_PLAN, real)
        else:
            recs.append({"sheet": SH, "r": r, "kind": "parent", "fields": fields})
        # 書式
        for c in range(1, UC + 1):
            cl = ws.cell(r, c)
            cl.border = BOX
            cl.font = f9
            if c >= YC[2019] and c < UC:
                cl.alignment = Alignment(horizontal="center")
        if row["kind"] == "parent" and lvl == 1:
            for c in range(1, UC + 1):
                ws.cell(r, c).fill = PatternFill("solid", fgColor="FFF2CC")
        if lvl >= 3:
            ws.row_dimensions[r].outline_level = 1
        r += 1
    last_r = r - 1
    # 合計の値（表の上の行）
    for y in YEARS:
        ws.cell(TOTAL_R, YC[y], sums["全体"][y]).number_format = "#,##0"
    for c in range(1, UC + 1):
        ws.cell(TOTAL_R, c).border = BOX
        ws.cell(TOTAL_R, c).font = Font(name="ＭＳ ゴシック", size=9, bold=True)
        ws.cell(TOTAL_R, c).fill = PatternFill("solid", fgColor="FCE4D6")
    # 凡例（表の下）
    ws.cell(last_r + 2, 2, "凡例　○：計画　●：実施済　△：一部実施　○→：翌年度へ延期")
    ws.cell(last_r + 3, 2, "注）合計は ○・●・△ の年度の概算費用の和。基幹的設備改良工事は合計に含まない。")
    ws.cell(last_r + 2, 2).font = f9
    ws.cell(last_r + 3, 2).font = f9
    widths = {"A": 6, "B": 14, "C": 16, "D": 16, "E": 12, "F": 26, "G": 6, "H": 10}
    for k, v in widths.items():
        ws.column_dimensions[k].width = v
    for y in YEARS:
        ws.column_dimensions[openpyxl.utils.get_column_letter(YC[y])].width = 7
    ws.column_dimensions[openpyxl.utils.get_column_letter(UC)].width = 30
    ws.freeze_panes = "I8"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_title_rows = "5:7"
    ws.sheet_properties.outlinePr.summaryBelow = False
    save_wb(wb, F.path_of(F_PLAN))


# ======================================================================
CSV_NAMES = {
    # 機器 -> 日報での呼び名（揺れ）
    "E11": ["ごみ供給装置", "給じん装置"], "E12": ["ごみ供給装置", "給じん装置"],
    "E13": ["火格子"], "E14": ["火格子"], "E15": ["耐火物"], "E16": ["耐火物"],
    "E17": ["ﾎﾞｲﾗ", "廃熱ボイラ"], "E18": ["ﾎﾞｲﾗ", "廃熱ボイラ"],
    "E19": ["BFP No.1", "ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ №1"], "E20": ["BFP No.2", "ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ №2"],
    "E21": ["BFP No.1", "ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ №1"], "E22": ["BFP No.2", "ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ №2"],
    "E42": ["BFP No.3（共通予備）"],
    "E23": ["バグフィルタ", "BF"], "E24": ["バグフィルタ", "BF"],
    "E25": ["脱硝触媒"], "E26": ["脱硝触媒"], "E27": ["消石灰供給装置"],
    "E28": ["FDF"], "E29": ["FDF"], "E30": ["IDF"], "E31": ["IDF"],
    "E32": ["蒸気タービン", "ST"], "E33": ["発電機"], "E34": ["灰クレーン"], "E35": ["飛灰処理装置"],
    "E36": ["受変電設備"], "E37": ["非常用発電機"], "E38": ["DCS"],
    "E39": ["焼却炉"], "E40": ["焼却炉"], "E43": ["灰押出装置"], "E44": ["灰押出装置"],
    "E01": ["計量機"], "E02": ["計量機"], "E03": ["ごみクレーン1号"], "E04": ["ごみクレーン2号"],
    "E05": ["ごみクレーン1号 巻上"], "E06": ["ごみクレーン2号 巻上"], "E07": ["ごみクレーン1号 走行"],
    "E08": ["ごみクレーン2号 走行"], "E09": ["ごみクレーン1号 バケット"], "E10": ["ごみクレーン2号 バケット"],
    "E41": ["施設全体"],
}
SYS = {"受入供給設備": "受入供給", "燃焼設備": "燃焼", "燃焼ガス冷却設備": "ボイラ", "排ガス処理設備": "排ガス",
       "通風設備": "通風", "余熱利用設備": "発電", "灰出し設備": "灰出し", "電気設備": "電気", "計装設備": "計装",
       "施設全体": "共通"}


def write_csv(F, rows, extra, win):
    R = F.rng
    # R7 年度の作業（星取表の作業のうち R7 のもの＋日報だけの作業）
    ws_ = []
    for row in rows:
        if row["kind"] != "item" or row.get("upgrade") or row.get("umbrella"):
            continue
        for w in row.get("years", {}).get(2025, []):
            ws_.append(w)
    for row in rows:  # 延期で R7 に来た作業は years[2025] に入っている。重複を除く
        pass
    ws_ += extra
    seen = set()
    lines = []  # (date, order, cols, work)
    for w in ws_:
        if w["id"] in seen:
            continue
        seen.add(w["id"])
        if w["status"] != "actual":
            continue
        e0 = w["equipment"][0]
        q = F.equipment[e0]
        fur = q["furnace"]
        for i, (d, p, h) in enumerate(w["_daily"]):
            lines.append((d, w, p, h, i))
    lines.sort(key=lambda t: (t[0], t[1]["id"]))
    out = io.StringIO()
    wr = csv.writer(out, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    phys = []
    phys.append(["#【架空】葦原クリーンプラザ 作業日報データ（運転管理委託 書き出し） 令和7年度"])
    phys.append(["#出力 2026/04/08 09:12 　架空のデータ"])
    phys.append(["日付", "曜", "号炉", "系統", "機器名称", "区分", "作業内容", "施工業者", "人数", "作業時間",
                 "延べ時間", "備考"])
    recs = F.file(F_CSV, False)
    line_no = 4
    # 食い違い：工事報告書と 1 日ずれる作業（日報の最終日は正しい）
    for (d, w, p, h, i) in lines:
        e0 = w["equipment"][0]
        q = F.equipment[e0]
        fur = q["furnace"]
        if fur is None:
            fu = "共通" if e0 not in ("E41",) else "―"
        else:
            fu = R.choice([f"{fur}炉", f"#{fur}", f"{fur}炉"])
        sysn = SYS.get(q["path"][0], "共通")
        nm = R.choice(CSV_NAMES.get(e0, [q["name"]]))
        if len(w["equipment"]) > 2:
            nm = "焼却炉"
        cat = w.get("_cat") or {"INSPECT": "点検", "OVERHAUL": "整備", "REPLACE": "取替", "UPGRADE": "改良"}[w["attribute"]]
        work_txt = w["_wtxt"]
        n_days = len(w["_daily"])
        if n_days > 1:
            work_txt = f"{work_txt}（{i + 1}/{n_days}日目）"
        hh = hours_text(h)
        tot = p * h
        memo = ""
        if w.get("_cat") == "補修" and i == 0:
            memo = "運転中に発見。\n応急処置のうえ当日復旧" if R.random() < 0.5 else "巡回点検で発見"
        if w.get("delayed_from") and i == 0:
            memo = "前年度から延期の分"
        vendor = w.get("vendor") or ""
        cols = [d.strftime("%Y/%m/%d"), WEEK[d.weekday()], fu, sysn, nm, cat, work_txt, vendor, str(p), hh,
                f"{tot:.1f}", memo]
        phys.append(cols)
        md = round(tot / 8, 4)
        rec = {"r": line_no, "kind": "item", "fields": {
            "date": iso(d), "furnace": fu, "system": sysn, "equipment": nm, "category": cat,
            "work": work_txt, "vendor": vendor, "persons": p, "hours": hh,
            "manDays": md, "manDaysText": f"{tot:.1f}"}}
        if memo:
            rec["fields"]["memo"] = memo
        recs.append(rec)
        F.link(w, F_CSV, r=line_no)
        F.eq_name(w["equipment"], F_CSV, nm)
        line_no += 1 + memo.count("\n")
    for c in phys:
        wr.writerow(c)
    data = out.getvalue().encode("cp932")
    p = F.path_of(F_CSV)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(data)


# ======================================================================
PDF_NAMES = {"E30": "誘引送風機", "E23": "ろ過式集じん器", "E19": "ボイラ給水ポンプ No.1", "E20": "ボイラ給水ポンプ No.2",
             "E28": "押込送風機", "E25": "脱硝反応塔（触媒）", "E17": "廃熱ボイラ", "E11": "ごみ供給装置",
             "E13": "火格子", "E15": "耐火物", "E43": "灰押出装置", "E39": "焼却炉"}
PDF_GROUP = {"燃焼設備": "燃焼設備", "燃焼ガス冷却設備": "燃焼ガス冷却設備", "排ガス処理設備": "排ガス処理設備",
             "通風設備": "通風設備", "灰出し設備": "灰出し設備"}


def write_pdf(F, rows, extra, win):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    y = 2025
    s1, e1 = win[y][1]
    items = []
    for row in rows:
        if row["kind"] != "item" or row.get("umbrella") or row.get("upgrade"):
            continue
        for w in row.get("years", {}).get(y, []):
            q = F.equipment[w["equipment"][0]]
            if q["furnace"] == 1 and w["status"] == "actual":
                items.append(w)
    for w in extra:
        if w.get("_furnace") == 1:
            items.append(w)
    order = {"焼却炉": 0, "ごみ供給装置": 1, "火格子": 2, "耐火物": 3, "灰押出装置": 4, "廃熱ボイラ": 5,
             "ボイラ給水ポンプ": 6, "ろ過式集じん器": 7, "脱硝反応塔": 8, "押込送風機": 9, "誘引通風機": 10}
    pre = [w for w in items if w["equipment"][0] == "E39" and w["start"] < iso(s1 + dt.timedelta(days=10))]
    post = [w for w in items if w["equipment"][0] == "E39" and w not in pre]
    mid = [w for w in items if w["equipment"][0] != "E39"]
    groups = {}
    for w in mid:
        q = F.equipment[w["equipment"][0]]
        groups.setdefault(q["path"][0], []).append(w)
    gorder = ["燃焼設備", "灰出し設備", "燃焼ガス冷却設備", "排ガス処理設備", "通風設備"]
    table = []  # (kind, cols, work)
    table.append(("parent", ["", "【付帯作業（停止・準備）】", "", "", "", "", "", "", ""], None))
    for w in sorted(pre, key=lambda w: w["start"]):
        table.append(("item", w, None))
    for g in gorder:
        if g not in groups:
            continue
        table.append(("parent", ["", f"【{g}】", "", "", "", "", "", "", ""], None))
        for w in sorted(groups[g], key=lambda w: (order.get(F.equipment[w["equipment"][0]]["path"][1], 99), w["start"])):
            table.append(("item", w, None))
        table.append(("subtotal", g, None))
    table.append(("parent", ["", "【付帯作業（復旧・立上げ）】", "", "", "", "", "", "", ""], None))
    for w in sorted(post, key=lambda w: w["start"]):
        table.append(("item", w, None))
    table.append(("total", None, None))

    path = F.path_of(F_PDF)
    c = rl_canvas(path, "【架空】葦原クリーンプラザ 1号炉定期整備工事 完了報告書（令和7年度）")
    W, H = A4
    cols = [("No.", 9), ("機器", 34), ("作業内容", 52), ("着手", 18), ("完了", 18), ("日数", 10), ("延べ人工", 14), ("備考", 25)]
    x0 = 12 * mm
    xs = [x0]
    for _, wmm in cols:
        xs.append(xs[-1] + wmm * mm)
    RH = 7.2 * mm
    recs = F.file(F_PDF, False)
    seq = 0
    page = 1
    n = 0
    shift_done = False

    def header(top_y, cont):
        c.setFont("JP", 8)
        if cont:
            c.drawString(x0, top_y + 2 * mm, "（前ページから続く）")
        yy = top_y - RH
        c.setFillGray(0.85)
        c.rect(xs[0], yy, xs[-1] - xs[0], RH, fill=1, stroke=0)
        c.setFillGray(0)
        for i, (t, _) in enumerate(cols):
            c.drawCentredString((xs[i] + xs[i + 1]) / 2, yy + 2.3 * mm, t)
        hline(yy, top_y)
        return yy

    def hline(yb, yt, skip=()):
        c.setLineWidth(0.5)
        c.line(xs[0], yb, xs[-1], yb)
        c.line(xs[0], yt, xs[-1], yt)
        for i, x in enumerate(xs):
            if i in skip:
                continue
            c.line(x, yb, x, yt)

    def footer():
        c.setFont("JP", 7)
        c.drawCentredString(W / 2, 8 * mm, f"- {page} -")
        c.drawRightString(W - 12 * mm, 8 * mm, "【架空】架空のデータ")

    # 1 ページ目の題
    c.setFont("JP", 15)
    c.drawCentredString(W / 2, H - 22 * mm, "【架空】1号炉 定期整備工事 完了報告書")
    c.setFont("JP", 9)
    c.drawCentredString(W / 2, H - 29 * mm, "葦原クリーンプラザ（架空の施設）　令和7年度")
    c.drawString(x0, H - 40 * mm, f"工事件名：令和7年度 葦原クリーンプラザ 1号炉定期整備工事")
    c.drawString(x0, H - 46 * mm, f"工　　期：{wareki(s1)} ～ {wareki(e1)}")
    c.drawString(x0, H - 52 * mm, f"請 負 者：{V_FURN}（架空）")
    c.drawString(x0, H - 58 * mm, "下表の延べ人工は、元請と協力会社の作業員の延べ人数（1 人 1 日 = 1 人工）。")
    c.setFont("JP", 10)
    c.drawString(x0, H - 68 * mm, "１．作業実績一覧")
    top = H - 72 * mm
    yy = header(top, False)
    gsum = 0.0
    tsum = 0.0
    no = 0
    for kind, obj, _ in table:
        if yy - RH < 18 * mm:
            footer()
            c.showPage()
            page += 1
            c.setFont("JP", 8)
            c.drawString(x0, H - 12 * mm, "【架空】1号炉 定期整備工事 完了報告書（令和7年度）")
            yy = header(H - 22 * mm, True)
        yb = yy - RH
        c.setFont("JP", 7.5)
        if kind == "parent":
            c.drawString(xs[1] + 1.5 * mm, yb + 2.3 * mm, obj[1])
            hline(yb, yy, skip=(2, 3, 4, 5, 6, 7))
            recs.append({"seq": seq, "kind": "parent", "fields": {"name": obj[1].strip("【】")}})
        elif kind == "item":
            w = obj
            no += 1
            e0 = w["equipment"][0]
            nm = PDF_NAMES.get(e0, F.equipment[e0]["name"].replace(" 1号炉", ""))
            work_txt = w["_wtxt"].replace("1号炉 ", "")
            s = dt.date.fromisoformat(w["start"])
            e = dt.date.fromisoformat(w["end"])
            e_shown = e
            note = ""
            if e0 == "E15" and not shift_done:
                # 食い違い：報告書は完了を 1 日早く書く（日報の最終日が正しい）
                e_shown = e - dt.timedelta(days=1)
                shift_done = True
                F._pdf_shift = (w["id"], iso(e_shown), iso(e))
            if w.get("delayed_from"):
                note = "前年度から延期"
            if w.get("vendor") and w["vendor"] not in (V_FURN,):
                note = (note + " " if note else "") + w["vendor"].replace("㈱", "")
            mdv = w["man_days"]
            mdt = f"{mdv:.1f}"
            days = (e_shown - s).days + 1
            vals = [str(no), nm, work_txt, f"{s.month}/{s.day}", f"{e_shown.month}/{e_shown.day}", str(days), mdt, note]
            for i, v in enumerate(vals):
                if i in (0, 5, 6):
                    c.drawRightString(xs[i + 1] - 1.5 * mm, yb + 2.3 * mm, v)
                else:
                    c.drawString(xs[i] + 1.2 * mm, yb + 2.3 * mm, v)
            hline(yb, yy)
            fields = {"no": no, "equipment": nm, "work": work_txt, "start": iso(s), "end": iso(e_shown),
                      "days": days, "manDays": mdv, "manDaysText": mdt}
            if note:
                fields["memo"] = note
            recs.append({"seq": seq, "kind": "item", "fields": fields})
            F.link(w, F_PDF, seq=seq)
            F.eq_name(w["equipment"], F_PDF, nm)
            gsum += mdv
            tsum += mdv
        elif kind == "subtotal":
            c.drawString(xs[1] + 1.5 * mm, yb + 2.3 * mm, f"小　計（{obj}）")
            c.drawRightString(xs[7] - 1.5 * mm, yb + 2.3 * mm, f"{gsum:.1f}")
            hline(yb, yy, skip=(2, 3, 4, 5))
            recs.append({"seq": seq, "kind": "subtotal", "fields": {}})
            gsum = 0.0
        elif kind == "total":
            c.setFont("JP", 8)
            c.drawString(xs[1] + 1.5 * mm, yb + 2.3 * mm, "合　計")
            c.drawRightString(xs[7] - 1.5 * mm, yb + 2.3 * mm, f"{tsum:.1f}")
            hline(yb, yy, skip=(2, 3, 4, 5))
            recs.append({"seq": seq, "kind": "total", "fields": {}})
        seq += 1
        yy = yb
    c.setFont("JP", 8)
    c.drawString(x0, yy - 6 * mm, "注）日数は着手日から完了日までの暦日数。小計・合計は延べ人工の和。")
    # ２．主要部品の取替実績（同じ頁の 2 つ目の表。見出しが変わる）
    parts = []
    byeq = {w["equipment"][0]: w for w in items}
    for (e0, part, qty, unit, where) in [("E13", "可動火格子", 48, "枚", "乾燥段・燃焼段"),
                                         ("E15", "耐火れんが（SK-34 相当）", 2.4, "t", "燃焼室側壁"),
                                         ("E23", "ろ布", 1260, "本", "全 6 室"),
                                         ("E19", "メカニカルシール", 1, "組", "ボイラ給水ポンプ No.1"),
                                         ("E30", "軸受", 2, "個", "誘引送風機 両側")]:
        if e0 in byeq:
            parts.append((byeq[e0], part, qty, unit, where))
    cols2 = [("No.", 9), ("部品名", 50), ("数量", 18), ("単位", 14), ("取替箇所", 50), ("関連の作業 No.", 39)]
    xs2 = [x0]
    for _, wmm in cols2:
        xs2.append(xs2[-1] + wmm * mm)
    yy -= 16 * mm
    if yy - RH * (len(parts) + 2) < 18 * mm:
        footer()
        c.showPage()
        page += 1
        yy = H - 22 * mm
    c.setFont("JP", 10)
    c.drawString(x0, yy, "２．主要部品の取替実績")
    yy -= 4 * mm

    def line2(yb, yt):
        c.setLineWidth(0.5)
        c.line(xs2[0], yb, xs2[-1], yb)
        c.line(xs2[0], yt, xs2[-1], yt)
        for x in xs2:
            c.line(x, yb, x, yt)
    c.setFont("JP", 7.5)
    yb = yy - RH
    c.setFillGray(0.85)
    c.rect(xs2[0], yb, xs2[-1] - xs2[0], RH, fill=1, stroke=0)
    c.setFillGray(0)
    for i, (t, _) in enumerate(cols2):
        c.drawCentredString((xs2[i] + xs2[i + 1]) / 2, yb + 2.3 * mm, t)
    line2(yb, yy)
    yy = yb
    item_no = {}
    for rr in recs:
        if rr["kind"] == "item":
            item_no[rr["fields"]["equipment"]] = rr["fields"]["no"]
    for i, (w, part, qty, unit, where) in enumerate(parts, 1):
        yb = yy - RH
        nm = PDF_NAMES.get(w["equipment"][0], F.equipment[w["equipment"][0]]["name"])
        ref = item_no.get(nm)
        vals = [str(i), part, f"{qty:,}" if isinstance(qty, int) else str(qty), unit, where, f"No.{ref}"]
        for j, v in enumerate(vals):
            if j in (0, 2):
                c.drawRightString(xs2[j + 1] - 1.5 * mm, yb + 2.3 * mm, v)
            else:
                c.drawString(xs2[j] + 1.2 * mm, yb + 2.3 * mm, v)
        line2(yb, yy)
        recs.append({"seq": seq, "kind": "item", "fields": {"no": i, "part": part, "qty": qty, "unit": unit,
                                                           "where": where, "work_no": f"No.{ref}"}})
        F.link(w, F_PDF, seq=seq)
        seq += 1
        yy = yb
    footer()
    c.showPage()
    c.save()
    F._pdf_pages = page


def write_user(F):
    t = f"""# {F.name} の担当者が答えられること

（施設管理課の担当者の言葉で。聞かれたら答える）

## ファイル
- `{F_PLAN}`：うちの設備整備計画表。令和元年度から令和12年度まで。機械と電気・計装を 1 枚にまとめている。毎年 9 月ごろに更新する。
- `{F_CSV}`：運転管理の委託先（{V_OP}）のシステムから書き出した、令和7年度の作業日報のデータ。1 行が 1 日の 1 件の作業。何日もかかる作業は日ごとに行が分かれる。
- `{F_PDF}`：令和7年度の 1 号炉の定期整備工事の完了報告書（請負者が出したもの）。

## 計画表の記号
- ○ は計画、● は実施済み、△ は一部だけ実施、「○→」は次の年度へ延ばしたもの。
- ◇ は凡例に無いが、計画に無かったのに臨時でやったもの（メモに理由がある）。
- 最後の年度（令和8年度）は、夏の整備の結果をまだ全部は ● に直していない。○ のままでも済んでいるものがある。
- 年度の列は「令和」の下に年の数だけを書いている。「元」は令和元年度（2019 年 4 月から）。
- 上の「概算費用 合計」の行は、その年度に印のある行の概算費用の和（千円）。延期の「○→」の年度は数えない。基幹的設備改良工事は合計に入れていない。
- 小計の行は機械設備と電気・計装設備の 2 つだけ。炉全体・施設全体の行は小計に入れていない。
- 概算費用は 1 回あたり、千円、税抜。
- 周期は年。

## 行と列
- 番号の列は 1・1-1・1-1-1 の形。設備・機器・号炉や部位の 3 列で木にしている。ボイラ給水ポンプだけは号炉の下に全角の空白で字下げして No. を書いている。
- 「〃」は上の行と同じ機器（または同じ作業）。
- 「1・2号炉」と書いた行は、両炉を 1 行にまとめたもの。実際には炉ごとに、それぞれの炉の整備の期間にやる。
- ごみクレーンの行は、クレーン 2 基（1 号・2 号）をまとめた行で、その行自身の作業（年次自主検査）がある。下に巻上装置・走行装置・バケットの行がある。
- 計量機も 2 台を 1 行にしている。
- 「1号炉 定期整備工事」「2号炉 定期整備工事」「全休炉整備」の行は工事一式の行で、中身は各機器の行に書いてある。
- 号炉の書き方が行によって「1号炉」「１号炉」「#2」と揃っていないが、同じ意味。
- 機器番号の列が空の行もある。廃熱ボイラは名前の括弧の中に機器番号を書いている。

## 「共通」の意味
- 「共通 No.3」のボイラ給水ポンプは、両炉のどちらにも回せる予備機（平成24年に足した）。
- 消石灰供給装置は 1 台で、両炉へ分岐して送っている。
- 計量機・クレーン・受変電・非常用発電機・DCS・蒸気タービンは施設全体に 1 つの設備。
- 「施設全体」と書いた行（精密機能検査・排ガス測定・基幹改良）は施設そのものが対象。

## 日報のデータ
- 1 行目と 2 行目の「#」で始まる行は書き出しの題と日時。3 行目が見出し。
- 「号炉」の列は「1炉」「#1」のように書き方が混ざる。「共通」は施設全体の設備。「―」は施設全体の作業。
- 「延べ時間」は人数 × 作業時間（休憩を除く）の時間。1 人 1 日は 8 時間で数える。
- 機器の名前は委託先の書き方で、半角カナや略称（BFP・IDF・FDF・BF・ST）がある。BFP はボイラ給水ポンプ、IDF は誘引通風機、FDF は押込送風機、BF はバグフィルタ（ろ過式集じん器）、ST は蒸気タービン。
- 何日もかかる作業は「（2/5日目）」のように日数を書いている。
- 補修（壊れたものを直したもの）は日報にしか書かない。計画表には書かない。
- 備考の中で改行しているものがある。

## 工事報告書
- 延べ人工は 1 人 1 日を 1 人工として数えた延べ人数。
- 日数は着手から完了までの暦日数。
- 「誘引送風機」は計画表の「誘引通風機」と同じもの。
- 号炉は書いていないが、全部 1 号炉。
- 付帯作業（立下げ・足場など）は焼却炉そのものの作業。
"""
    write_text(os.path.join(F.dir, "user.md"), t)
