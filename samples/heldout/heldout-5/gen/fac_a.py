# -*- coding: utf-8 -*-
"""施設 A：ごみ焼却（ストーカ 2 炉）。整備計画表（Excel）・作業日報データ（Shift_JIS の CSV）・
定期整備の作業報告書（文字の PDF の帳票）・日常点検表（写真）。"""
import csv
import datetime as dt
import io
import os

import openpyxl
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L

from common import (ROOT, TODAY, MAN_DAY_HOURS, answer_file, era, fy_label, iso, md, rng,
                    save_xlsx, wa_long, wa_short, workdays, write_json, write_text, youbi)

FAC_ID = "f-kirinodai"
NAME = "【架空】霧野台清掃工場"
DIR = os.path.join(ROOT, FAC_ID)
F_PLAN = "【架空】霧野台清掃工場_整備計画表_R2-R11.xlsx"
F_CSV = "【架空】霧野台清掃工場_作業日報データ_R7-R8.csv"
F_PDF = "【架空】霧野台清掃工場_R7_1号炉定期整備工事_作業報告書.pdf"
F_JPG = "【架空】霧野台清掃工場_日常点検表_R8.9.21-27.jpg"
YEARS = list(range(2020, 2030))
CSV_FROM, CSV_TO = dt.date(2025, 4, 1), dt.date(2026, 9, 30)

# ------------------------------------------------------------------ 機器（1 台ずつ）
EQ = {
    "E01": dict(name="計量機", furnace=None, install_year=2004, code="WB-01"),
    "E02": dict(name="ごみクレーン No.1", furnace=None, install_year=2004, code="CR-01"),
    "E03": dict(name="ごみクレーン No.2", furnace=None, install_year=2004, code="CR-02"),
    "E04": dict(name="火格子（1号炉）", furnace=1, install_year=2004, code="G-110"),
    "E05": dict(name="火格子（2号炉）", furnace=2, install_year=2004, code="G-210"),
    "E06": dict(name="押込送風機（1号炉）", furnace=1, install_year=2004, code="F-111"),
    "E07": dict(name="押込送風機（2号炉）", furnace=2, install_year=2004, code="F-211"),
    "E08": dict(name="廃熱ボイラ（1号炉）", furnace=1, install_year=2004, code="B-120"),
    "E09": dict(name="廃熱ボイラ（2号炉）", furnace=2, install_year=2004, code="B-220"),
    "E10": dict(name="ボイラ給水ポンプ No.1", furnace=None, install_year=2004, code="P-131"),
    "E11": dict(name="ボイラ給水ポンプ No.2", furnace=None, install_year=2004, code="P-132"),
    "E12": dict(name="ボイラ給水ポンプ No.3", furnace=None, install_year=2012, code="P-133"),
    "E13": dict(name="ろ過式集じん器（1号炉）", furnace=1, install_year=2004, code="BF-140"),
    "E14": dict(name="ろ過式集じん器（2号炉）", furnace=2, install_year=2004, code="BF-240"),
    "E15": dict(name="誘引通風機（1号炉）", furnace=1, install_year=2004, code="F-150"),
    "E16": dict(name="誘引通風機（2号炉）", furnace=2, install_year=2004, code="F-250"),
    "E17": dict(name="蒸気タービン", furnace=None, install_year=2004, code="T-160"),
    "E18": dict(name="発電機", furnace=None, install_year=2004, code="G-161"),
    "E19": dict(name="施設全体", furnace=None, install_year=2004, code=None),
    "E20": dict(name="高圧受変電設備", furnace=None, install_year=2004, code="SS-01"),
    "E21": dict(name="非常用発電機", furnace=None, install_year=2004, code="EG-01"),
    "E22": dict(name="分散制御システム（DCS）", furnace=None, install_year=2004, code="DCS-01"),
    "E23": dict(name="排ガス分析計", furnace=None, install_year=2016, code="AN-01"),
    "E24": dict(name="直流電源装置", furnace=None, install_year=2004, code="DC-01"),
}
F1_EQ = ["E04", "E06", "E08", "E13", "E15"]
F2_EQ = ["E05", "E07", "E09", "E14", "E16"]
Z_EQ = ["E10", "E11", "E12", "E17", "E18", "E20", "E22", "E24"]

V = {
    "main": "架空プラント整備㈱", "dxn": "架空環境分析センター㈱", "grate": "架空炉材工業㈱",
    "boiler": "架空ボイラ保全㈱", "bf": "架空フィルタ工業㈱", "fan": "架空送風機サービス㈱",
    "pump": "架空ポンプ工業㈱", "tb": "架空タービンサービス㈱", "elec": "（一財）架空電気保安協会",
    "dcs": "架空システム㈱", "crane": "架空クレーン㈱", "scale": "架空計量器㈱",
    "prec": "架空環境技術センター㈱", "eg": "架空発電機サービス㈱", "an": "架空計測㈱",
    "op": "架空霧野台運転管理㈱",
}

# ------------------------------------------------------------------ 整備計画表の行（表示と作業）
# kind: parent / item / pwork（自分の作業を持つ親の行）
# cols: A 設備, B 機器, C 号炉・部位（全角空白で字下げ）, D 機器番号, E 整備内容, F 周期, G 費用(千円), memo
# work: (key, attribute, first, cycle, sched, vendor)
MECH = [
    dict(kind="parent", A="１．受入供給設備", path=["受入供給設備"]),
    dict(kind="item", B="計量機", D="WB-01", E="定期点検", F=1, G=380, eq=["E01"], path=["受入供給設備", "計量機"],
         work=("scale_pm", "INSPECT", 2020, 1, ("month", 10, 14, 1), "scale")),
    dict(kind="item", B=None, D=None, E="定期検査（計量法）", F=2, G=650, eq=["E01"], path=["受入供給設備", "計量機"],
         work=("scale_insp", "INSPECT", 2020, 2, ("month", 11, 18, 1), "scale")),
    dict(kind="pwork", B="ごみクレーン", E="性能検査（クレーン則）", F=2, G=1200, eq=["E02", "E03"], path=["受入供給設備", "ごみクレーン"],
         work=("crane_perf", "INSPECT", 2020, 2, ("month", 12, 8, 1), "crane")),
    dict(kind="pwork", C="No.1", D="CR-01", E="年次自主検査", F="1年", G=450, eq=["E02"], path=["受入供給設備", "ごみクレーン", "No.1"],
         work=("crane1_ann", "INSPECT", 2020, 1, ("month", 9, 8, 2), "crane")),
    dict(kind="item", C="　巻上装置", E="ワイヤロープ取替", F=2, G=900, eq=["E02"], path=["受入供給設備", "ごみクレーン", "No.1", "巻上装置"],
         work=("crane1_wire", "REPLACE", 2021, 2, ("month", 2, 9, 2), "crane")),
    dict(kind="item", C="　バケット", E="油圧シリンダ整備", F=3, G=1500, eq=["E02"], path=["受入供給設備", "ごみクレーン", "No.1", "バケット"],
         work=("crane1_bkt", "OVERHAUL", 2022, 3, ("month", 2, 16, 3), "crane")),
    dict(kind="pwork", C="No.2", D="CR-02", E="年次自主検査", F="1年", G=450, eq=["E03"], path=["受入供給設備", "ごみクレーン", "No.2"],
         work=("crane2_ann", "INSPECT", 2020, 1, ("month", 10, 6, 2), "crane")),
    dict(kind="item", C="　巻上装置", E="ワイヤロープ取替", F=2, G=900, eq=["E03"], path=["受入供給設備", "ごみクレーン", "No.2", "巻上装置"],
         work=("crane2_wire", "REPLACE", 2020, 2, ("month", 2, 2, 2), "crane")),
    dict(kind="item", C="　バケット", E="油圧シリンダ整備", F=3, G=1500, eq=["E03"], path=["受入供給設備", "ごみクレーン", "No.2", "バケット"],
         work=("crane2_bkt", "OVERHAUL", 2020, 3, ("month", 2, 16, 3), "crane")),
    dict(kind="parent", A="２．燃焼設備", path=["燃焼設備"]),
    dict(kind="parent", B="火格子", path=["燃焼設備", "火格子"]),
    dict(kind="item", C="1号炉", D="G-110", E="点検・部分取替", F=1, G=5200, eq=["E04"], path=["燃焼設備", "火格子", "1号炉"],
         work=("grate1", "OVERHAUL", 2020, 1, ("P1", 3, 6), "grate")),
    dict(kind="item", C="2号炉", D="G-210", E="点検・部分取替", F=1, G=5200, eq=["E05"], path=["燃焼設備", "火格子", "2号炉"],
         work=("grate2", "OVERHAUL", 2020, 1, ("P2", 3, 6), "grate")),
    dict(kind="parent", B="押込送風機", path=["燃焼設備", "押込送風機"]),
    dict(kind="item", C="1号炉", D="F-111", E="分解点検", F=3, G=1800, eq=["E06"], path=["燃焼設備", "押込送風機", "1号炉"],
         work=("fdf1", "OVERHAUL", 2020, 3, ("P1", 4, 4), "fan")),
    dict(kind="item", C="#2", D="F-211", E="分解点検", F=3, G=1800, eq=["E07"], path=["燃焼設備", "押込送風機", "#2"],
         work=("fdf2", "OVERHAUL", 2020, 3, ("P2", 4, 4), "fan")),
    dict(kind="parent", A="３．燃焼ガス冷却設備", path=["燃焼ガス冷却設備"]),
    dict(kind="parent", B="廃熱ボイラ", path=["燃焼ガス冷却設備", "廃熱ボイラ"]),
    dict(kind="item", C="1号炉", D="B-120", E="性能検査受検整備", F=1, G=8600, memo="ボイラー及び圧力容器安全規則", eq=["E08"],
         path=["燃焼ガス冷却設備", "廃熱ボイラ", "1号炉"], work=("boiler1", "INSPECT", 2020, 1, ("P1", 7, 7), "boiler")),
    dict(kind="item", C="2号炉", D="B-220", E="性能検査受検整備", F=1, G=8600, memo="ボイラー及び圧力容器安全規則", eq=["E09"],
         path=["燃焼ガス冷却設備", "廃熱ボイラ", "2号炉"], work=("boiler2", "INSPECT", 2020, 1, ("P2", 7, 7), "boiler")),
    dict(kind="parent", B="ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ", memo="1・2号炉共用（2台運転、1台予備）", path=["燃焼ガス冷却設備", "ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ"]),
    dict(kind="item", C="No.1", D="P-131", E="分解整備", F=4, G=700, eq=["E10"], path=["燃焼ガス冷却設備", "ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ", "No.1"],
         work=("bfp1", "OVERHAUL", 2021, 4, ("Z", 0, 4), "pump")),
    dict(kind="item", C="№2", D="P-132", E="〃", Eval="分解整備", F=4, G=700, eq=["E11"], path=["燃焼ガス冷却設備", "ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ", "№2"],
         work=("bfp2", "OVERHAUL", 2022, 4, ("Z", 0, 4), "pump")),
    dict(kind="item", C="No.3", D="P-133", E="〃", Eval="分解整備", F=4, G=700, memo="H24増設", eq=["E12"],
         path=["燃焼ガス冷却設備", "ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ", "No.3"], work=("bfp3", "OVERHAUL", 2023, 4, ("Z", 0, 4), "pump")),
    dict(kind="parent", A="４．排ガス処理設備", path=["排ガス処理設備"]),
    dict(kind="parent", B="ろ過式集じん器", path=["排ガス処理設備", "ろ過式集じん器"]),
    dict(kind="item", C="1号炉", D="BF-140", E="ろ布取替", F=5, G=14000, eq=["E13"], path=["排ガス処理設備", "ろ過式集じん器", "1号炉"],
         work=("bf1", "REPLACE", 2021, 5, ("P1", 10, 6), "bf")),
    dict(kind="item", C="2号炉", D="BF-240", E="ろ布取替", F=5, G=14000, eq=["E14"], path=["排ガス処理設備", "ろ過式集じん器", "2号炉"],
         work=("bf2", "REPLACE", 2023, 5, ("P2", 10, 6), "bf")),
    dict(kind="parent", B="誘引通風機", path=["排ガス処理設備", "誘引通風機"]),
    dict(kind="item", C="1号炉", D="F-150", E="分解整備", F=3, G=2400, eq=["E15"], path=["排ガス処理設備", "誘引通風機", "1号炉"],
         work=("idf1", "OVERHAUL", 2022, 3, ("P1", 14, 5), "fan")),
    dict(kind="item", C="2号炉", D="F-250", E="分解整備", F=3, G=2400, eq=["E16"], path=["排ガス処理設備", "誘引通風機", "2号炉"],
         work=("idf2", "OVERHAUL", 2020, 3, ("P2", 14, 5), "fan")),
    dict(kind="parent", A="５．余熱利用設備", path=["余熱利用設備"]),
    dict(kind="item", B="蒸気タービン", D="T-160", E="定期点検", F=1, G=3000, eq=["E17"], path=["余熱利用設備", "蒸気タービン"],
         work=("tb_pm", "INSPECT", 2020, 1, ("Z", 0, 5), "tb")),
    dict(kind="item", B=None, D=None, E="定期事業者検査（開放）", F=4, G=26000, memo="電気事業法", eq=["E17"], path=["余熱利用設備", "蒸気タービン"],
         work=("tb_open", "OVERHAUL", 2022, 4, ("Z", 0, 9), "tb")),
    dict(kind="item", B="発電機", D="G-161", E="分解点検", F=4, G=4200, eq=["E18"], path=["余熱利用設備", "発電機"],
         work=("gen", "OVERHAUL", 2022, 4, ("Z", 1, 6), "tb")),
    dict(kind="parent", A="６．共通", path=["共通"]),
    dict(kind="parent", B="定期整備工事", path=["共通", "定期整備工事"]),
    dict(kind="item", C="1号炉", E="定期整備工事（一式）", F=1, G=48000, memo="※内訳は各機器の行", eq=F1_EQ,
         path=["共通", "定期整備工事", "1号炉"], work=("p1all", "OVERHAUL", 2020, 1, ("P1all",), "main")),
    dict(kind="item", C="2号炉", E="定期整備工事（一式）", F=1, G=48000, memo="※内訳は各機器の行", eq=F2_EQ,
         path=["共通", "定期整備工事", "2号炉"], work=("p2all", "OVERHAUL", 2020, 1, ("P2all",), "main")),
    dict(kind="item", C="全炉", E="全休炉整備", F=1, G=12000, eq=Z_EQ, path=["共通", "定期整備工事", "全炉"],
         work=("zall", "OVERHAUL", 2020, 1, ("Zall",), "main")),
    dict(kind="item", B="施設全体", E="精密機能検査", F=3, G=4500, eq=["E19"], path=["共通", "施設全体"],
         work=("prec", "INSPECT", 2021, 3, ("month", 11, 10, 3), "prec")),
]
ELEC = [
    dict(kind="parent", N="1", B="受変電設備", ind=0, path=["受変電設備"]),
    dict(kind="item", N="1-1", B="高圧受変電設備", ind=1, D="SS-01", E="年次点検（全停電）", F=1, G=1600, eq=["E20"],
         path=["受変電設備", "高圧受変電設備"], work=("ss", "INSPECT", 2020, 1, ("Zmid", 1), "elec")),
    dict(kind="item", N="1-2", B="直流電源装置", ind=1, D="DC-01", E="蓄電池取替", F=7, G=2800, eq=["E24"],
         path=["受変電設備", "直流電源装置"], work=("dc", "REPLACE", 2019, 7, ("Z", 4, 1), "elec")),
    dict(kind="item", N="2", B="非常用発電機", ind=0, D="EG-01", E="点検・負荷運転", F=1, G=520, eq=["E21"],
         path=["非常用発電機"], work=("eg", "INSPECT", 2020, 1, ("month", 2, 20, 1), "eg")),
    dict(kind="parent", N="3", B="計装設備", ind=0, path=["計装設備"]),
    dict(kind="item", N="3-1", B="分散制御システム（DCS）", ind=1, D="DCS-01", E="定期点検", F=1, G=3800, memo="R10に更新の予定", eq=["E22"],
         path=["計装設備", "分散制御システム（DCS）"], work=("dcs", "INSPECT", 2020, 1, ("Zafter", 2), "dcs")),
    dict(kind="item", N="3-2", B="排ガス分析計", ind=1, D="AN-01", E="校正・部品交換", F=1, G=900, eq=["E23"],
         path=["計装設備", "排ガス分析計"], work=("an", "INSPECT", 2020, 1, ("month", 1, 19, 2), "an")),
]

# わざと入れる揺れ（世界の側で決める）
POSTPONE = {("fdf2", 2023): "部品納期遅れのためR6へ延期", ("prec", 2024): "予算の都合でR7へ延期",
            ("prec", 2025): "工事と重なるためR8へ再延期"}
NOT_DONE = {("prec", 2024), ("prec", 2025)}          # 延期して、その年度にはしていない
OMIT_MARK = {("eg", 2025), ("bfp2", 2022), ("crane1_wire", 2023)}   # 実施したのに ● の書き漏れ
WRONG_YEAR = {("scale_insp", 2024): 2023}           # ● を 1 年前の列に書いた
PARTIAL = {("dcs", 2022): "一部（HMI更新のみ実施、残りはR5の点検で）"}
SKIP_PLAN = {("crane_perf", 2026)}                  # 計画の欠け：法定の性能検査の予定が無い
EXTRA_MARK = {("scale_insp", 2021): ("※", "R3.7 落雷のあとの臨時点検（計量法の検査ではない）")}
PLAN_YEARS = {"prec": [2021, 2024, 2025, 2026, 2029]}
# 最後の年度（R8）は一部だけ反映：2 号炉の整備（7 月）以降の ● はまだ書いていない
def unmarked_2026(work):
    if work["fiscal_year"] != 2026:
        return False
    k = work["row"]["work"][4][0]
    return k in ("P2", "P2all", "month")


def first_monday(d):
    while d.weekday() != 0:
        d += dt.timedelta(days=1)
    return d


def schedule(fy, R):
    """年度の定期整備の骨組み：1 号炉 → 全休炉 → 2 号炉。"""
    p1s = first_monday(dt.date(fy, 5, 8)) + dt.timedelta(days=7 * R.randint(0, 1))
    p1e = p1s + dt.timedelta(days=25)
    zlen = 12 if (fy - 2022) % 4 == 0 else 9
    zs = p1e + dt.timedelta(days=1)
    ze = zs + dt.timedelta(days=zlen - 1)
    p2s = ze + dt.timedelta(days=1)
    p2e = p2s + dt.timedelta(days=25)
    return dict(P1=(p1s, p1e), Z=(zs, ze), P2=(p2s, p2e))


SPANS_FULL = "8:00～17:00"
CREW = [("機械工", "作業員"), ("鳶工", "作業員"), ("機械工", "溶接工"), ("電工", "作業員")]

PHASES = {
    "grate1": ["火格子 摩耗測定・点検", "火格子 部分取替", "火格子 取替・調整", "火格子 駆動装置点検", "火格子 組立・確認"],
    "boiler1": ["ボイラ 水管肉厚測定", "ボイラ 内部清掃", "ボイラ 安全弁整備", "ボイラ 性能検査受検", "ボイラ 復旧"],
    "idf1": ["誘引通風機 分解", "誘引通風機 羽根車点検・バランス修正", "誘引通風機 軸受交換", "誘引通風機 組立・試運転"],
}


def build_world():
    R = rng("A-world")
    sched = {fy: schedule(fy, R) for fy in YEARS}
    works = []
    for sheet, rows in (("機械設備", MECH), ("電気・計装設備", ELEC)):
        for row in rows:
            if "work" not in row:
                continue
            key, attr, first, cycle, sc, vend = row["work"]
            for fy in YEARS:
                if key in PLAN_YEARS:
                    if fy not in PLAN_YEARS[key]:
                        continue
                elif (fy - first) % cycle != 0 or fy < first:
                    continue
                if (key, fy) in SKIP_PLAN:
                    continue
                act_fy = fy
                if (key, fy) in POSTPONE and (key, fy) not in NOT_DONE:
                    act_fy = fy + 1
                s = sched[act_fy]
                kind = sc[0]
                if kind in ("P1", "P2", "Z"):
                    base = s[kind][0] + dt.timedelta(days=sc[1])
                    days = workdays(base, sc[2])
                elif kind == "P1all" or kind == "P2all" or kind == "Zall":
                    a, b = s[kind[:-3]]
                    days = [a + dt.timedelta(days=i) for i in range((b - a).days + 1)]
                elif kind == "Zmid":
                    a, b = s["Z"]
                    days = [a + dt.timedelta(days=(b - a).days // 2)]
                elif kind == "Zafter":
                    a, b = s["Z"]
                    days = workdays(a + dt.timedelta(days=(b - a).days // 2 + 1), sc[1])
                else:  # month
                    m, d0, n = sc[1], sc[2], sc[3]
                    y = act_fy if m >= 4 else act_fy + 1
                    days = workdays(dt.date(y, m, d0) + dt.timedelta(days=R.randint(0, 3)), n, skip_sat=True)
                w = dict(key=key, attr=attr, row=row, sheet=sheet, plan_fy=fy, fiscal_year=act_fy,
                         equipment=row["eq"], start=days[0], end=days[-1], days_list=days, vendor=V[vend])
                done = w["end"] < TODAY and (key, fy) not in NOT_DONE
                w["status"] = "actual" if done else "planned"
                if (key, fy) in NOT_DONE:
                    w["status"] = "postponed"
                works.append(w)
    # 臨時の点検（※）
    w = dict(key="scale_extra", attr="INSPECT", row=MECH[2], sheet="機械設備", plan_fy=2021, fiscal_year=2021,
             equipment=["E01"], start=dt.date(2021, 7, 26), end=dt.date(2021, 7, 26),
             days_list=[dt.date(2021, 7, 26)], vendor=V["scale"], status="actual", label="計量機 臨時点検（落雷後）")
    works.append(w)
    # 事後の補修（星取表に書かない）
    repairs = [
        ("rep1", "E11", dt.date(2025, 7, 14), 1, "ボイラ給水ポンプ", "メカニカルシール交換（漏れ）", "REPLACE", "pump", 3, SPANS_FULL),
        ("rep2", "E03", dt.date(2025, 8, 26), 2, "ごみクレーン", "走行車輪 補修", "OVERHAUL", "crane", 2, SPANS_FULL),
        ("rep3", "E01", dt.date(2025, 11, 5), 1, "計量機", "ロードセル調整（指示ずれ）", "OVERHAUL", "scale", 1, "13:00～17:00"),
        ("rep4", "E07", dt.date(2026, 1, 21), 1, "押込送風機", "Vベルト交換", "REPLACE", "op", 2, "8:00～12:00"),
        ("rep5", "E15", dt.date(2026, 9, 24), 1, "誘引通風機", "軸受グリス補給（温度上昇）", "OVERHAUL", "op", 1, "13:00～15:00"),
        ("rep6", "E23", dt.date(2026, 3, 10), 1, "排ガス分析計", "サンプリング配管詰まり除去", "OVERHAUL", "an", 2, SPANS_FULL),
    ]
    for key, eq, d0, n, eqn, txt, attr, vend, p, span in repairs:
        ds = workdays(d0, n)
        works.append(dict(key=key, attr=attr, row=None, sheet=None, plan_fy=None, fiscal_year=ds[0].year if ds[0].month >= 4 else ds[0].year - 1,
                          equipment=[eq], start=ds[0], end=ds[-1], days_list=ds, vendor=V[vend], status="actual",
                          label=f"{EQ[eq]['name']} {txt}", repair=(eqn, txt, p, span)))
    # どの資料にも書いていない作業（事後の補修で、日報データの期間より前）
    for key, eq, d0, txt in [("unrec1", "E16", dt.date(2022, 11, 9), "軸受交換（異音）"),
                             ("unrec2", "E10", dt.date(2024, 1, 17), "グランドパッキン交換")]:
        works.append(dict(key=key, attr="REPLACE", row=None, sheet=None, plan_fy=None, fiscal_year=d0.year - (1 if d0.month < 4 else 0),
                          equipment=[eq], start=d0, end=d0, days_list=[d0], vendor=V["op"], status="actual",
                          label=f"{EQ[eq]['name']} {txt}", repair=None, unrecorded=True))
    # 人数と時間を日ごとに決める
    for w in works:
        R2 = rng("A-crew:" + w["key"] + str(w["plan_fy"]))
        crew = R2.choice(CREW)
        w["daily"] = []
        for i, d in enumerate(w["days_list"]):
            if w.get("repair"):
                p, span = w["repair"][2], w["repair"][3]
                w["daily"].append((d, {crew[0]: p}, span))
                continue
            if w["key"] in ("p1all", "p2all", "zall"):
                p = R2.randint(3, 6)
                w["daily"].append((d, {"作業員": p}, SPANS_FULL))
                continue
            a, b = R2.randint(1, 4), R2.randint(0, 3)
            parts = {crew[0]: a}
            if b:
                parts[crew[1]] = b
            w["daily"].append((d, parts, SPANS_FULL))
        w["own_man_days"] = round(sum(md(sum(p.values()), s) for _, p, s in w["daily"]), 3)
        w["man_days"] = w["own_man_days"]
        w["days"] = (w["end"] - w["start"]).days + 1
    # 定期整備工事（一式）の工数は、その期間の機器の作業も含めた全体
    for w in works:
        if w["key"] in ("p1all", "p2all", "zall"):
            k = {"p1all": ("P1",), "p2all": ("P2",), "zall": ("Z", "Zmid", "Zafter")}[w["key"]]
            subs = [x for x in works if x is not w and x["row"] is not None and x["row"]["work"][4][0] in k
                    and x["fiscal_year"] == w["fiscal_year"] and x["status"] == w["status"]]
            w["man_days"] = round(w["own_man_days"] + sum(x["own_man_days"] for x in subs), 3)
    works.sort(key=lambda w: (w["start"], w["key"]))
    for i, w in enumerate(works, 1):
        w["id"] = f"W{i:04d}"
        if "label" not in w:
            nm = "・".join(EQ[e]["name"] for e in w["equipment"]) if len(w["equipment"]) <= 2 else w["row"]["path"][-1]
            ev = w["row"].get("Eval", w["row"]["E"])
            w["label"] = f"{nm} {ev}" if w["key"] not in ("p1all", "p2all", "zall") else f"{w['row']['path'][-1]} {ev}"
        w["rows"] = []
        w["contract"] = None
    return sched, works


# ------------------------------------------------------------------ 整備計画表（Excel）
THIN = Side(style="thin", color="808080")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEAD_FILL = PatternFill("solid", fgColor="DDEBF7")
ACT_FILL = PatternFill("solid", fgColor="F2F2F2")


def year_cols(i):
    """年度の i 番目（0..9）の予定と実績の列番号。H=8 から。"""
    return 8 + 2 * i, 9 + 2 * i


def write_plan(works):
    wb = openpyxl.Workbook()
    ws1 = wb.active
    ws1.title = "機械設備"
    ws2 = wb.create_sheet("電気・計装設備")
    recs = []
    eq_rows = {}
    by_row = {}
    for w in works:
        if w["row"] is not None:
            by_row.setdefault(id(w["row"]), []).append(w)
    font = Font(name="ＭＳ ゴシック", size=9)

    for ws, rows, mech in ((ws1, MECH, True), (ws2, ELEC, False)):
        sub = "機械設備" if mech else "電気・計装設備"
        ws["A1"] = f"{NAME}　設備整備計画表（{sub}）"
        ws["A1"].font = Font(name="ＭＳ ゴシック", size=14, bold=True)
        ws["V2"] = "作成：施設管理課　最終更新 R8.9.30"
        # 3 段の見出し
        if mech:
            ws.merge_cells("A4:C6")
            ws["A4"] = "設備・機器名称"
        else:
            ws.merge_cells("A4:A6")
            ws["A4"] = "番号"
            ws.merge_cells("B4:C6")
            ws["B4"] = "設備・機器名称"
        for col, t in (("D", "機器番号"), ("E", "整備内容"), ("F", "周期\n（年）"), ("G", "概算費用\n（千円/回）")):
            ws.merge_cells(f"{col}4:{col}6")
            ws[f"{col}4"] = t
        ws.merge_cells(start_row=4, start_column=8, end_row=4, end_column=27)
        ws.cell(4, 8, "令　　　　　和")
        for i, fy in enumerate(YEARS):
            p, a = year_cols(i)
            ws.merge_cells(start_row=5, start_column=p, end_row=5, end_column=a)
            ws.cell(5, p, fy - 2018)
            ws.cell(6, p, "予定")
            ws.cell(6, a, "実績")
        ws.merge_cells("AB4:AB6")
        ws["AB4"] = "備考"
        for r in (4, 5, 6):
            for c in range(1, 29):
                cell = ws.cell(r, c)
                cell.fill = HEAD_FILL
                cell.border = BOX
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                cell.font = font
        ws.column_dimensions["A"].width = 18 if mech else 6
        ws.column_dimensions["B"].width = 16 if mech else 24
        ws.column_dimensions["C"].width = 12 if mech else 2
        ws.column_dimensions["D"].width = 9
        ws.column_dimensions["E"].width = 22
        ws.column_dimensions["F"].width = 6
        ws.column_dimensions["G"].width = 10
        for i in range(len(YEARS)):
            p, a = year_cols(i)
            ws.column_dimensions[L(p)].width = 4.5
            ws.column_dimensions[L(a)].width = 4.5
        # 隠した古い年度（R2）
        ws.column_dimensions["H"].hidden = True
        ws.column_dimensions["I"].hidden = True
        ws.column_dimensions["AB"].width = 30
        ws.freeze_panes = "H7"

        r = 7
        for row in rows:
            row["_r"] = r
            row["_sheet"] = ws.title
            if mech:
                for col in ("A", "B", "C"):
                    if row.get(col):
                        ws[f"{col}{r}"] = row[col]
            else:
                ws[f"A{r}"] = row["N"]
                ws[f"B{r}"] = row["B"]
                ws[f"B{r}"].alignment = Alignment(indent=row["ind"] * 2)
            if row.get("D"):
                ws[f"D{r}"] = row["D"]
            if row.get("E"):
                ws[f"E{r}"] = row["E"]
            if row.get("F") is not None:
                ws[f"F{r}"] = row["F"]
            if row.get("G") is not None:
                ws[f"G{r}"] = row["G"]
            if row.get("memo"):
                ws[f"AB{r}"] = row["memo"]
            marks = {}
            comments = {}
            if "work" in row:
                key = row["work"][0]
                for w in by_row.get(id(row), []):
                    fy = w["plan_fy"]
                    if w["key"] == "scale_extra":
                        sym, note = EXTRA_MARK[("scale_insp", 2021)]
                        i = YEARS.index(2021)
                        c = year_cols(i)[1]
                        ws.cell(r, c, sym)
                        comments[f"{L(c)}{r}"] = note
                        ws.cell(r, c).comment = Comment(note, "施設管理課")
                        marks.setdefault("2021", []).append(("act", sym))
                        w["rows"].append(dict(file=F_PLAN, sheet=ws.title, r=r, year=2021, symbol=sym))
                        continue
                    if fy < YEARS[0]:
                        continue
                    i = YEARS.index(fy)
                    pc, ac = year_cols(i)
                    if (key, fy) in POSTPONE:
                        ws.cell(r, pc, "○→")
                        note = POSTPONE[(key, fy)]
                        ws.cell(r, pc).comment = Comment(note, "施設管理課")
                        comments[f"{L(pc)}{r}"] = note
                        marks.setdefault(str(fy), []).append(("plan", "○→"))
                        if (key, fy) in NOT_DONE:
                            # 延期したまま。作業は無い（次の年度に新しく予定を立てた）
                            continue
                        w["rows"].append(dict(file=F_PLAN, sheet=ws.title, r=r, year=fy, symbol="○→"))
                        # 実績は翌年度の列
                        afy = w["fiscal_year"]
                        if afy in YEARS and w["status"] == "actual":
                            ac2 = year_cols(YEARS.index(afy))[1]
                            ws.cell(r, ac2, "●")
                            marks.setdefault(str(afy), []).append(("act", "●"))
                            w["rows"].append(dict(file=F_PLAN, sheet=ws.title, r=r, year=afy, symbol="●"))
                        continue
                    ws.cell(r, pc, "○")
                    marks.setdefault(str(fy), []).append(("plan", "○"))
                    w["rows"].append(dict(file=F_PLAN, sheet=ws.title, r=r, year=fy, symbol="○"))
                    if w["status"] != "actual":
                        continue
                    if (key, fy) in OMIT_MARK or unmarked_2026(w):
                        w["omitted_mark"] = True
                        continue
                    sym = "△" if (key, fy) in PARTIAL else "●"
                    afy = WRONG_YEAR.get((key, fy), fy)
                    ac2 = year_cols(YEARS.index(afy))[1]
                    ws.cell(r, ac2, sym)
                    if (key, fy) in PARTIAL:
                        ws.cell(r, ac2).comment = Comment(PARTIAL[(key, fy)], "施設管理課")
                        comments[f"{L(ac2)}{r}"] = PARTIAL[(key, fy)]
                        w["partial"] = PARTIAL[(key, fy)]
                    marks.setdefault(str(afy), []).append(("act", sym))
                    ent = dict(file=F_PLAN, sheet=ws.title, r=r, year=afy, symbol=sym)
                    if afy != fy:
                        ent["note"] = f"年度の書き間違い（実施は {fy} 年度）"
                    w["rows"].append(ent)
                # 予定の年度が延期で消えたあとの再計画（prec の R8）は通常の ○
            # 書式
            for c in range(1, 29):
                cell = ws.cell(r, c)
                cell.border = BOX
                cell.font = font
                if c >= 8 and c <= 27:
                    cell.alignment = Alignment(horizontal="center")
                    if (c - 8) % 2 == 1:
                        cell.fill = ACT_FILL
            if not mech and c == 2:
                pass
            if not mech:
                ws[f"B{r}"].alignment = Alignment(indent=row["ind"] * 2)
            # 正解の行
            fields = {"path": row["path"]}
            if row["kind"] in ("item", "pwork"):
                fields["work"] = row.get("Eval", row["E"])
                if row.get("D"):
                    fields["code"] = row["D"]
                elif row.get("B") is None and mech and row.get("C") is None and row["kind"] == "item":
                    # 上と同じ値の空欄：機器番号も上の行と同じ
                    prev = [x for x in rows if x.get("_r") == r - 1][0]
                    if prev.get("D"):
                        fields["code"] = prev["D"]
                cyc = row["F"]
                fields["cycle"] = int(str(cyc).replace("年", ""))
                fields["cost"] = row["G"]
                fields["unit"] = "千円"
                mk = {}
                for y, lst in sorted(marks.items()):
                    # 予定の列 → 実績の列の順（左から）
                    syms = [s for k, s in lst if k == "plan"] + [s for k, s in lst if k == "act"]
                    mk[y] = syms[0] if len(syms) == 1 else syms
                fields["marks"] = mk
            if row.get("memo"):
                fields["memo"] = row["memo"]
            if comments:
                fields["comments"] = comments
            recs.append(dict(sheet=ws.title, r=r, kind="parent" if row["kind"] in ("parent", "pwork") else "item", fields=fields))
            for e in row.get("eq", []):
                if row["kind"] != "item" or len(row.get("eq", [])) == 1 or row["work"][0] == "crane_perf":
                    eq_rows.setdefault(e, []).append(dict(file=F_PLAN, sheet=ws.title, r=r))
            r += 1
        # 凡例（表の下）
        r += 1
        ws[f"A{r}"] = "凡例　○：予定　●：実施　△：一部実施　○→：翌年度へ延期"
        if mech:
            ws[f"A{r + 1}"] = "※周期は法令・メーカー推奨による。費用は税抜の概算。"
        ws.print_title_rows = "4:6"
    # 電気の行の機器
    save_xlsx(wb, os.path.join(DIR, "files", F_PLAN), f"{NAME} 設備整備計画表", NAME + " 施設管理課")
    return recs, eq_rows


# ------------------------------------------------------------------ 作業日報データ（Shift_JIS の CSV）
FURN_VAR = {1: ["1号炉", "#1", "1炉", "１号炉", "1号炉"], 2: ["2号炉", "#2", "2炉", "2号炉"], None: ["共通", "", "共通"]}
ALIAS = {
    "E01": ["計量機", "トラックスケール"], "E02": ["ごみクレーン No.1", "ごみｸﾚｰﾝ1号機", "クレーン(1)"],
    "E03": ["ごみクレーン No.2", "ごみｸﾚｰﾝ2号機", "クレーン(2)"], "E04": ["火格子"], "E05": ["火格子"],
    "E06": ["押込送風機", "FDF"], "E07": ["押込送風機", "FDF"], "E08": ["廃熱ボイラ", "ボイラ"], "E09": ["廃熱ボイラ", "ボイラ"],
    "E10": ["ボイラ給水ポンプ No.1", "BFP №1", "ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ(1)"], "E11": ["ボイラ給水ポンプ No.2", "BFP №2", "ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ(2)"],
    "E12": ["ボイラ給水ポンプ No.3", "BFP №3", "ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ(3)"], "E13": ["ろ過式集じん器", "バグフィルタ"],
    "E14": ["ろ過式集じん器", "バグフィルタ"], "E15": ["誘引通風機", "IDF", "誘引送風機"], "E16": ["誘引通風機", "IDF", "誘引送風機"],
    "E17": ["蒸気タービン", "タービン"], "E18": ["発電機"], "E19": ["施設全体"], "E20": ["受変電設備", "高圧受変電"],
    "E21": ["非常用発電機", "非常用発電設備"], "E22": ["DCS", "分散制御システム"], "E23": ["排ガス分析計"], "E24": ["直流電源装置"],
}
KUBUN = {"INSPECT": "点検", "OVERHAUL": "整備", "REPLACE": "整備", "UPGRADE": "工事"}
GENERIC = {
    "p1all": "1号炉定期整備", "p2all": "2号炉定期整備", "zall": "全休炉整備",
}
GEN_TASKS_P = ["立下げ", "炉内冷却", "炉内冷却", "ダイオキシン類作業前測定・養生", "付着物除去", "足場組立"]
GEN_TASKS_P_END = ["足場解体", "養生撤去・作業後測定", "空打ち試運転", "立上げ"]
GEN_TASKS_Z = ["全炉停止・系統隔離", "共通系統 清掃", "共通系統 清掃", "復旧・系統確認"]


def csv_rows(works):
    """日ごとの行を作る。返り値：[(date, 号炉, 設備, 内容, 区分, 業者, 人員, 時間, 備考, work, md, mdtext)]"""
    R = rng("A-csv")
    out = []
    for w in works:
        if w.get("unrecorded"):
            continue
        n = len(w["daily"])
        for i, (d, parts, span) in enumerate(w["daily"]):
            if not (CSV_FROM <= d <= CSV_TO):
                continue
            if w["status"] != "actual":
                continue
            e0 = w["equipment"][0]
            fur = EQ[e0]["furnace"]
            key = w["key"]
            memo = ""
            if key in GENERIC:
                fur = {"p1all": 1, "p2all": 2, "zall": None}[key]
                eqn = GENERIC[key]
                if key == "zall":
                    tasks = GEN_TASKS_Z
                    t = tasks[min(i * len(tasks) // n, len(tasks) - 1)]
                else:
                    if i < len(GEN_TASKS_P):
                        t = GEN_TASKS_P[i]
                    elif i >= n - len(GEN_TASKS_P_END):
                        t = GEN_TASKS_P_END[i - (n - len(GEN_TASKS_P_END))]
                    else:
                        t = "炉内外 監理・清掃"
                kub = "定期整備"
            elif w.get("repair"):
                eqn = R.choice(ALIAS[e0])
                t = w["repair"][1]
                kub = "補修"
            else:
                eqn = R.choice(ALIAS[e0])
                ph = PHASES.get(key)
                ev = w["row"].get("Eval", w["row"]["E"])
                if ph:
                    t = ph[min(i * len(ph) // n, len(ph) - 1)]
                else:
                    t = ev if n == 1 else f"{ev}（{i + 1}/{n}日目）"
                kub = "定期整備" if w["row"]["work"][4][0] in ("P1", "P2", "Z", "Zmid", "Zafter") else KUBUN[w["attr"]]
                if key in ("bf1", "bf2") and i == 0:
                    memo = "ろ布 全数取替\n（1,280本）"
                if key == "dc" and i == 0:
                    memo = "蓄電池 54セル取替"
                if w.get("omitted_mark") and key == "eg":
                    memo = "負荷運転 30分（定格の30%）"
            furl = R.choice(FURN_VAR[fur])
            ptxt = " ".join(f"{k}{v}" for k, v in parts.items()) if R.random() < 0.75 else f"{sum(parts.values())}名"
            out.append([d, furl, eqn, t, kub, w["vendor"], ptxt, span, memo, w, md(sum(parts.values()), span)])
    out.sort(key=lambda x: (x[0], x[9]["id"]))
    return out


def write_csv(works):
    rows = csv_rows(works)
    buf = io.StringIO()
    wr = csv.writer(buf, lineterminator="\r\n")
    buf.write(f"# {NAME}　作業日報データ（{V['op']} 出力）　出力日 2026/10/01\r\n")
    wr.writerow(["日付", "曜日", "号炉", "設備・機器", "作業内容", "区分", "施工業者", "人員", "作業時間", "備考"])
    line = 3
    recs = []
    for d, furl, eqn, t, kub, vend, ptxt, span, memo, w, mdv in rows:
        wr.writerow([d.strftime("%Y/%m/%d"), youbi(d), furl, eqn, t, kub, vend, ptxt, span, memo])
        f = {"date": iso(d), "曜日": youbi(d), "号炉": furl, "設備・機器": eqn, "作業内容": t, "区分": kub,
             "施工業者": vend, "人員": ptxt, "作業時間": span, "manDays": mdv, "manDaysText": f"{ptxt} {span}"}
        if memo:
            f["備考"] = memo
        recs.append(dict(r=line, kind="item", fields=f))
        w["rows"].append(dict(file=F_CSV, r=line))
        line += 1 + memo.count("\n")
    data = buf.getvalue().encode("cp932")
    p = os.path.join(DIR, "files", F_CSV)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(data)
    return recs


# ------------------------------------------------------------------ 作業報告書（PDF の帳票）
def write_pdf(works):
    from pdfkit import new_canvas, table, text
    fy = 2025
    ws_ = {w["key"]: w for w in works if w["fiscal_year"] == fy and w["status"] == "actual"}
    umb = ws_["p1all"]
    subs = [ws_[k] for k in ("grate1", "boiler1", "idf1") if k in ws_]
    contract = "R7-018"
    title_k = f"令和7年度 {NAME} 1号炉定期整備工事"
    for w in [umb] + subs:
        w["contract"] = f"{contract} 1号炉定期整備工事"
    path = os.path.join(DIR, "files", F_PDF)
    c, (W, H) = new_canvas(path, f"{NAME} 1号炉定期整備工事 作業報告書", NAME + " / " + V["main"])
    recs = []
    seq = 0

    def sheet_head(no, cont=False):
        text(c, 40, H - 40, NAME + "　（架空の資料）", 8)
        text(c, W / 2, H - 70, "作 業 報 告 書" + ("（続き）" if cont else ""), 16, "center")
        text(c, W - 40, H - 40, f"報告書 No. {no}", 9, "right")

    def period(w):
        return f"{wa_long(w['start'])} ～ {wa_long(w['end'])}"

    def sheet_fields(no, w, tgt, mdtxt):
        return {"報告書No": no, "工事名": title_k, "契約番号": contract, "対象設備": tgt, "号炉": "1号炉",
                "start": iso(w["start"]), "end": iso(w["end"]), "days": w["days"], "施工業者": w["vendor"],
                "manDays": w["man_days"], "manDaysText": mdtxt}

    # 明細
    R = rng("A-pdf")
    sheets = []
    # 1：総括（工程）
    det = []
    seen = {}
    for d, parts, span in umb["daily"]:
        pass
    p1s, p1e = umb["start"], umb["end"]
    steps = [("立下げ・炉内冷却", 0, 2), ("ダイオキシン類作業前測定・養生", 3, 3), ("付着物除去", 4, 4), ("足場組立", 5, 5),
             ("火格子 点検・部分取替", subs[0]["start"], subs[0]["end"]), ("廃熱ボイラ 性能検査受検整備", subs[1]["start"], subs[1]["end"]),
             ("誘引通風機 分解整備", subs[2]["start"], subs[2]["end"]), ("足場解体", 22, 22), ("養生撤去・作業後測定", 23, 23),
             ("空打ち試運転", 24, 24), ("立上げ", 25, 25)]
    for name, a, b in steps:
        if isinstance(a, int):
            a = p1s + dt.timedelta(days=a)
            b = p1s + dt.timedelta(days=b)
        det.append((name, a, b))
    det.sort(key=lambda x: (x[1], x[2]))
    sheets.append(("1", umb, "1号炉 全般（工程）", det))
    sheets.append(("2", subs[0], "火格子（G-110）", [("火格子 摩耗測定", "60枚", "許容値内 52枚／要取替 8枚"), ("火格子 部分取替", "8枚", "取替完了"),
                                                    ("駆動装置 油圧ユニット点検", "1式", "良"), ("ストローク調整", "1式", "調整済")]))
    boiler_lines = [("水管 肉厚測定（第1パス）", "120点", "最小 4.6mm（基準 4.0）"), ("水管 肉厚測定（第2パス）", "96点", "最小 4.9mm"),
                    ("過熱器管 肉厚測定", "64点", "最小 4.2mm 要監視"), ("ドラム内部 点検", "1式", "スケール付着 軽微"),
                    ("安全弁 分解整備", "2台", "吹出し試験 良"), ("水面計 分解整備", "2台", "良"), ("給水逆止弁 点検", "1台", "弁座 すり合わせ"),
                    ("ブロー弁 点検", "4台", "1台 グランド増締め"), ("スートブロワ 点検", "6台", "No.4 ノズル取替"),
                    ("炉壁管 目視点検", "1式", "異常なし"), ("耐火物 点検", "1式", "一部補修（0.5㎡）"), ("内部清掃", "1式", "完了"),
                    ("水圧試験", "1式", "良"), ("性能検査 受検", "1式", f"合格（{wa_short(subs[1]['end'])}）")]
    sheets.append(("3", subs[1], "廃熱ボイラ（B-120）", boiler_lines))
    sheets.append(("4", subs[2], "誘引通風機（F-150）", [("分解", "1台", "―"), ("羽根車 点検", "1式", "摩耗 軽微"),
                                                      ("動釣合い修正", "1式", "振動 2.1→0.8mm/s"), ("軸受交換", "2個", "取替完了"),
                                                      ("組立・芯出し", "1式", "良"), ("試運転", "1式", "良")]))
    PER_PAGE = 12
    for no, w, tgt, lines in sheets:
        mdtxt = f"延べ {w['man_days']:g} 人工"
        chunks = [lines[i:i + PER_PAGE] for i in range(0, len(lines), PER_PAGE)]
        for k, ch in enumerate(chunks):
            cont = k > 0
            sheet_head(no, cont)
            y = H - 95
            if not cont:
                hdr = [["工 事 名", title_k], ["契約番号", contract], ["対象設備", tgt + "　（1号炉）"],
                       ["作業期間", period(w) + f"　（{w['days']}日間）"], ["作業工数", mdtxt], ["施工業者", w["vendor"]]]
                y = table(c, 40, y, [90, W - 170], hdr, row_h=20, size=9, aligns=["center", "left"], head_rows=0)
                y -= 16
            else:
                text(c, 40, y, "前ページから続く", 9)
                y -= 14
            if no == "1":
                head = [["No.", "工程", "開始日", "終了日", "備考"]]
                body = [[str(i + 1 + k * PER_PAGE), nm, wa_short(a), wa_short(b), ""] for i, (nm, a, b) in enumerate(ch)]
                widths = [32, 230, 80, 80, W - 80 - 422]
            else:
                head = [["No.", "作業項目", "数量", "結果・所見", "備考"]]
                body = [[str(i + 1 + k * PER_PAGE), a, b, cc, ""] for i, (a, b, cc) in enumerate(ch)]
                widths = [32, 190, 60, 180, W - 80 - 462]
            y = table(c, 40, y, widths, head + body, row_h=20, size=9, aligns=["center", "left", "center", "left", "left"], head_rows=1)
            if k < len(chunks) - 1:
                text(c, W - 40, y - 14, "次ページへ続く", 9, "right")
            else:
                text(c, 40, y - 24, "特記事項：", 9)
                text(c, 40, 60, f"施工業者　{w['vendor']}　現場代理人　（印）", 9)
                text(c, W - 40, 60, "監督員　確認印", 9, "right")
            text(c, W / 2, 30, f"- {no}-{k + 1} -", 8, "center")
            c.showPage()
            for i, ln in enumerate(ch):
                f = sheet_fields(no, w, tgt, mdtxt)
                if no == "1":
                    f.update({"No": i + 1 + k * PER_PAGE, "工程": ln[0], "工程の開始": iso(ln[1]), "工程の終了": iso(ln[2])})
                else:
                    f.update({"No": i + 1 + k * PER_PAGE, "作業項目": ln[0], "数量": ln[1], "結果・所見": ln[2]})
                recs.append(dict(seq=seq, kind="item", fields=f))
                tgt_w = w
                if no == "1":
                    # 工程の行のうち、機器の作業の行はその作業も指す
                    for s in subs:
                        if ln[1] == s["start"] and ln[2] == s["end"]:
                            s["rows"].append(dict(file=F_PDF, seq=seq))
                tgt_w["rows"].append(dict(file=F_PDF, seq=seq))
                seq += 1
    c.save()
    return recs


# ------------------------------------------------------------------ 日常点検表（写真）
def write_photo(works):
    from photo import make_checksheet_photo
    days = [dt.date(2026, 9, 21) + dt.timedelta(days=i) for i in range(7)]
    R = rng("A-photo")
    items = [
        ("押込送風機 1号", "振動", "異常なし", "chk"), ("押込送風機 1号", "軸受温度", "60℃以下", "t1"),
        ("押込送風機 2号", "振動", "異常なし", "chk"), ("押込送風機 2号", "軸受温度", "60℃以下", "t2"),
        ("誘引通風機 1号", "振動", "異常なし", "chk"), ("誘引通風機 1号", "軸受温度", "60℃以下", "tidf"),
        ("誘引通風機 2号", "振動", "異常なし", "chk"), ("誘引通風機 2号", "軸受温度", "60℃以下", "t3"),
        ("ボイラ給水ポンプ No.1", "吐出圧力", "6.5～7.5MPa", "p"), ("ボイラ給水ポンプ No.2", "吐出圧力", "6.5～7.5MPa", "p"),
        ("ボイラ給水ポンプ No.3", "運転／予備", "予備", "sb"), ("ボイラ給水ポンプ 共通", "グランド漏れ", "滴下 少量", "chk"),
    ]
    grid = []
    for name, it, std, kind in items:
        vals = []
        for i, d in enumerate(days):
            if kind == "chk":
                v = "✓"
            elif kind == "sb":
                v = "予備" if i != 3 else "運転"
            elif kind == "p":
                v = f"{R.uniform(6.8, 7.3):.1f}"
            elif kind == "tidf":
                v = str([44, 46, 51, 54, 47, 45, 44][i])
            else:
                v = str(R.randint(36, 47))
            vals.append(v)
        grid.append([name, it, std] + vals)
    rep = [w for w in works if w["key"] == "rep5"][0]
    note = "9/24 誘引通風機1号 軸受温度上昇(54℃) → グリス補給 13時 様子見"
    hidden = {(7, 4), (7, 5)}       # 影で読めない（行, 日の列）
    res = make_checksheet_photo(
        out=os.path.join(DIR, "files", F_JPG),
        title=f"{NAME}　日常点検表（送風機・給水ポンプ）",
        sub="令和8年9月21日（月）～9月27日（日）　1・2号炉",
        cols=["機器", "点検項目", "判定基準"] + [f"{d.month}/{d.day}\n（{youbi(d)}）" for d in days],
        grid=grid, note=note, hidden=hidden, seed="A-photo", stamp_names=["班長", "運転員"])
    recs = []
    for i, row in enumerate(grid):
        f = {"機器": row[0], "点検項目": row[1], "判定基準": row[2], "点検者の欄": "班長・運転員"}
        for j, d in enumerate(days):
            v = row[3 + j]
            f[iso(d)] = "読めない" if (i, j + 3) in hidden else v
        recs.append(dict(seq=i, image=F_JPG, kind="item", fields=f))
        if i == 5:
            rep["rows"].append(dict(file=F_JPG, seq=i, image=F_JPG))
    recs.append(dict(seq=len(grid), image=F_JPG, kind="item",
                     fields={"特記事項": note, "date": "2026-09-24", "機器": "誘引通風機 1号"}))
    rep["rows"].append(dict(file=F_JPG, seq=len(grid), image=F_JPG))
    return recs, res


# ------------------------------------------------------------------ まとめ
def build():
    sched, works = build_world()
    plan_recs, eq_rows = write_plan(works)
    csv_recs = write_csv(works)
    pdf_recs = write_pdf(works)
    photo_recs, photo_info = write_photo(works)
    answer_file(DIR, F_PLAN, True, plan_recs, hidden_data="include",
                note="R2（2020）年度の予定・実績の列 H・I は隠してあるが、実績として正しい。〃と上と同じ値の空欄は上の値に直して書いた。")
    answer_file(DIR, F_CSV, False, csv_recs, note="1 行目はコメント、2 行目が見出し。r は物理の行。備考に改行のある記録は 2 行を占める。")
    answer_file(DIR, F_PDF, False, pdf_recs, note="1 件 1 枚の帳票。報告書 No.3 は 2 ページ目が続紙。")
    answer_file(DIR, F_JPG, False, photo_recs, note="写真。影で読めないセルは「読めない」。")

    # 契約（日報・報告書に無いものは世界の値だけ）
    for w in works:
        if w["contract"] is None:
            lab = fy_label(w["fiscal_year"])
            if w["key"] in ("p1all", "grate1", "boiler1", "idf1", "fdf1", "bf1"):
                w["contract"] = f"{lab} 1号炉定期整備工事"
            elif w["key"] in ("p2all", "grate2", "boiler2", "idf2", "fdf2", "bf2"):
                w["contract"] = f"{lab} 2号炉定期整備工事"
            elif w["key"] in ("zall", "bfp1", "bfp2", "bfp3", "tb_pm", "tb_open", "gen"):
                w["contract"] = f"{lab} 全休炉整備工事"
            elif w.get("repair") or w.get("unrecorded"):
                w["contract"] = "運転管理業務委託（単価）" if w["vendor"] == V["op"] else f"{lab} 修繕（随意契約）"
            else:
                w["contract"] = f"{lab} {w['label']} 業務委託"

    eq_list = []
    names_plan = {}
    for rows, sheet in ((MECH, "機械設備"), (ELEC, "電気・計装設備")):
        for row in rows:
            for e in row.get("eq", []):
                if row["kind"] != "item" or len(row["eq"]) == 1:
                    names_plan.setdefault(e, row["path"][-1].strip())
    for eid, e in EQ.items():
        names = {}
        if eid in names_plan:
            names[F_PLAN] = names_plan[eid]
        al = ALIAS.get(eid)
        if al:
            names[F_CSV] = al[0]
        if eid in PDF_NAMES:
            names[F_PDF] = PDF_NAMES[eid]
        if eid in PHOTO_NAMES:
            names[F_JPG] = PHOTO_NAMES[eid]
        ent = dict(id=eid, name=e["name"], names=names, aliases=ALIAS.get(eid, []), furnace=e["furnace"],
                   install_year=e["install_year"], code=e["code"],
                   path=[r["path"] for rows in (MECH, ELEC) for r in rows if eid in r.get("eq", []) and (len(r["eq"]) == 1)][:1][0]
                   if any(eid in r.get("eq", []) and len(r["eq"]) == 1 for rows in (MECH, ELEC) for r in rows) else ["共通", "施設全体"],
                   rows=eq_rows.get(eid, []))
        eq_list.append(ent)
    wl = []
    unrec = []
    for w in works:
        if w["status"] == "postponed":
            continue
        ent = dict(id=w["id"], label=w["label"], attribute=w["attr"], status=w["status"], fiscal_year=w["fiscal_year"],
                   equipment=w["equipment"], start=iso(w["start"]), end=iso(w["end"]), man_days=w["man_days"], days=w["days"],
                   vendor=w["vendor"], contract=w["contract"], precision=(w["key"] == "prec"), rows=w["rows"])
        if w.get("partial"):
            ent["note"] = w["partial"]
        if w.get("omitted_mark"):
            ent["note"] = "整備計画表の実績の書き漏れ（● が無い）"
        wl.append(ent)
        if w.get("unrecorded"):
            unrec.append(dict(work=w["id"], reason="事後の補修で整備計画表に書かず、作業日報データの期間（R7.4～）より前"))
        elif not w["rows"]:
            unrec.append(dict(work=w["id"], reason="?"))
    defects = [
        dict(kind="周期の超え（精密機能検査）", where=f"{F_PLAN} 機械設備 精密機能検査の行：R3 に実施のあと R6・R7 と延期（○→）、R8 の予定まで 5 年",
             check="精密機能検査の周期（3 年に 1 回以上、推奨）"),
        dict(kind="法令の点検の抜け（クレーンの性能検査）", where=f"{F_PLAN} 機械設備 ごみクレーン 性能検査（クレーン則）の行：R8 の予定が無い（R6 の次は R10）",
             check="クレーンの性能検査（2 年）の予定"),
    ]
    world = {
        "schema": "moyai.answer.world/0",
        "facility": {"id": FAC_ID, "name": NAME, "industry": "waste-incineration",
                     "profile": {"furnace": "ストーカ式（全連続）", "lines": 2, "capacity_t_per_day": 170, "capacity_note": "85t/24h × 2炉",
                                 "turbine": True, "dust": "BF", "ash": "搬出", "contract": "単年度", "upgrade": False, "completed": 2004}},
        "fiscal_year_start_month": 4, "man_day_hours": MAN_DAY_HOURS, "today": iso(TODAY),
        "equipment": eq_list, "works": wl, "unrecorded": unrec, "defects": defects,
    }
    write_json(os.path.join(DIR, "answer", "world.json"), world)
    write_text(os.path.join(DIR, "user.md"), USER_MD)
    return dict(files=[F_PLAN, F_CSV, F_PDF, F_JPG], photo=photo_info, works=len(wl))


PDF_NAMES = {"E04": "火格子（G-110）", "E08": "廃熱ボイラ（B-120）", "E15": "誘引通風機（F-150）"}
PHOTO_NAMES = {"E06": "押込送風機 1号", "E07": "押込送風機 2号", "E15": "誘引通風機 1号", "E16": "誘引通風機 2号",
               "E10": "ボイラ給水ポンプ No.1", "E11": "ボイラ給水ポンプ No.2", "E12": "ボイラ給水ポンプ No.3"}

USER_MD = """# 霧野台清掃工場（架空）の担当者が答えられること

施設管理課の保全担当です。聞かれたら次のように答えます。

## ファイル
- 整備計画表（R2-R11）：施設管理課が持っている年度ごとの整備の計画と実績です。機械設備と電気・計装設備でシートを分けています。保全の計画（星取表）です。
- 作業日報データ（R7-R8）：運転管理の委託先が日報のシステムから書き出したものです。1 行が 1 日の 1 つの作業です。文字コードは Shift_JIS です。1 行目は出力のときに付くコメントです。
- R7 1号炉定期整備工事 作業報告書：令和7年度の 1 号炉の定期整備で、業者が出した報告書を 1 冊にしたものです。報告書 1 枚が 1 つの作業で、明細が多いと 2 枚目（続き）になります。No.1 は工事全体の工程です。
- 日常点検表：運転員が紙で付けている週の点検表を、スマホで撮ったものです。

## 記号と欄
- ○ は予定、● は実施、△ は一部だけ実施、○→ は翌年度へ延期です。※ は計画外の臨時の点検で、セルのメモに理由を書いています。
- 年度の列は、上が「令和」、その下が年（2 なら令和2年度）、その下が「予定」と「実績」です。年度は 4 月始まりです。
- R2 年度の列は古いので隠していますが、書いてあることは正しいです。計画に入れてください。
- 周期は年です。「1年」と書いた行も 1 年です。費用は千円で、1 回あたりの概算（税抜）です。
- 〃 や空欄は上の行と同じという意味です（ボイラ給水ポンプの整備内容、蒸気タービンの 2 行目など）。
- 定期整備工事（一式）の行は、1 号炉・2 号炉の定期整備の工事全体です。中身は各機器の行にも書いています。全休炉整備は両炉を止めて共通の設備を整備する期間です。
- 日報の人員は、職種と人数（「機械工3 作業員1」）か合計の人数（「4名」）です。作業時間は昼休み 1 時間を除いて数えます。1 人・日は 8 時間です。
- 報告書の作業工数は延べの人工（人・日）です。

## 号炉と「共通」
- 1 号炉は 1号炉・#1・1炉・１号炉 と書くことがあります。2 号炉も同じです。
- 「共通」は両炉で使う設備です（ボイラ給水ポンプ 3 台は両炉の共用で 2 台運転・1 台予備、蒸気タービンと発電機は 1 台）。「施設全体」は精密機能検査のような施設ごとの検査です。
- ボイラ給水ポンプは BFP、ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ とも書きます。No.2・№2・(2) は同じ 2 号機です。誘引通風機は IDF・誘引送風機、押込送風機は FDF、ろ過式集じん器はバグフィルタと書くことがあります。
- ごみクレーンは 2 基（No.1・No.2）。計画表では巻上装置とバケットを分けて書いています。

## 知っていること（聞かれたら）
- 事後の補修（壊れて直したもの）は計画表に書いていません。日報にだけあります。
- R8 年度の実績は、2 号炉の定期整備（6 月下旬から）より後の分をまだ計画表に入れていません。
"""
