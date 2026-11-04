"""ほかの施設の設定（gen/facility.json）を書き出す。デモの施設（しらかば野）の設定は手で書いたもので、ここでは作らない。

施設ごとに星取表の様式（配置・見出し・凡例・費用の単位）と資料の組を変える。使い方：python samples/maker/facilities.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def chart(stem, y0, y1, **kw):
    d = {"type": "chart", "stem": stem, "title": "整備計画表", "yearsFrom": y0, "yearsTo": y1}
    d.update(kw)
    return d


F = []
F.append(("waste-incineration", "nagarebashi", {
    "id": "WI-02", "name": "ながれ橋清掃工場", "short": "ながれ橋", "owner": "架空東郷広域環境組合", "seed": 52002,
    "years": [2017, 2025], "planTo": 2029,
    "profile": {"furnace": "STOKER", "furnaces": 2, "perFurnace": 60, "turbine": True, "dust": "BF", "ash": "OUT", "contract": "SINGLE", "commissioned": 1998},
    "costScale": 0.8, "tagStyle": "dash", "vendorStyle": "株式会社", "vendorPick": 1,
    "overrides": {"FAC_PRECISE|精密機能検査": {"years": [2017, 2021, 2024, 2027]}},
    "gapsNote": [{"kind": "interval_max", "check": "interval_max", "level": "recommendation", "what": "精密機能検査", "note": "H29（2017）の次が R3（2021）。4 年空いた"}],
    "docs": [chart("整備計画_H29-R11", 2017, 2029, layout="indent", header="pa", legend="pa", costUnit="円", hideYears=1, sheetName="整備計画",
                   furnaceStyle=[0, 3], unitStyle=[1, 2], nameVariant=1, sysVariant=1, sysPrefix="box", subtotals=["COMB", "COOL", "FLUE"],
                   totalsTop=True, legendTop=False, footNotes=["・予定欄の ○ は当初計画。実績欄は {last} 年度の途中まで。", "・金額は円（税抜）。"]),
             {"type": "orders", "years": [2017, 2025], "textDatesUntil": 2018, "oneCellPeriod": True, "sheetFmt": "{era}", "author": "業務課"}]}))
F.append(("waste-incineration", "sakurazaka", {
    "id": "WI-03", "name": "さくら坂環境センター", "short": "さくら坂", "owner": "架空市", "seed": 53003,
    "years": [2016, 2025], "planTo": 2030,
    "profile": {"furnace": "STOKER", "furnaces": 2, "perFurnace": 75, "turbine": True, "dust": "BF", "ash": "OUT", "contract": "SINGLE", "commissioned": 2005},
    "costScale": 0.9, "tagStyle": "num", "vendorStyle": "(株)", "vendorPick": 2,
    "overrides": {"CRANE|年次自主検査": {"skipDone": [2020], "target": "CRANE-1"}},
    "gapsNote": [{"kind": "legal_missed", "check": "interval_max", "level": "app", "what": "ごみクレーン No.1 年次自主検査", "note": "R2（2020）に計画したが行っていない（星取表は ○ のまま）"}],
    "docs": [chart("長期整備計画_H28-R12", 2016, 2030, layout="numbered", header="eraStack", legend="simple", costUnit="千円", codeCol=True,
                   sheetName="長期整備計画", furnaceStyle=[2, 1], unitStyle=[0, 1], nameVariant=2, sysVariant=2, sysPrefix="none", groups=True,
                   subtotals=["RECV", "COMB", "COOL", "FLUE", "DRAFT"], mismatchSubtotal="COOL", mismatchBy=8000),
             {"type": "ledger", "stem": "機器台帳", "codeInName": 0.6, "nameVariant": 1},
             {"type": "diary_csv", "years": [2021, 2025], "encoding": "cp932", "kana": 0.3, "furnaceStyle": [0, 1, 2]}]}))
F.append(("waste-incineration", "hinatano", {
    "id": "WI-04", "name": "ひなた野クリーンプラザ", "short": "ひなた野CP", "owner": "架空北部広域行政組合", "seed": 54004,
    "years": [2016, 2025], "planTo": 2031,
    "profile": {"furnace": "STOKER", "furnaces": 2, "perFurnace": 95, "turbine": True, "dust": "EP", "ash": "OUT", "contract": "SINGLE", "commissioned": 1996, "upgrade": [2017]},
    "costScale": 1.1, "tagStyle": "dash", "vendorStyle": "㈱", "vendorPick": 1,
    "exclude": ["CAMERA"],
    "gapsNote": [{"kind": "coverage", "check": "coverage", "what": "ごみクレーン（WI.RECV.CRANE）", "note": "星取表に行が無い（発注台帳にだけ年次点検の委託と工事がある）"}],
    "docs": [chart("保全計画表_2016-2031", 2016, 2031, layout="merged", header="fy4", legend="pd", costUnit="千円", ditto=0.5, secondTable=True,
                   sheetName="保全計画", furnaceStyle=[0, 4], unitStyle=[3, 4], nameVariant=1, chartExclude=["CRANE", "CRANE_CTRL"],
                   colLabels={"names": ["大分類", "機器", "号炉", "部位", "部位"]}, subtotals=[], totalLabel="合計（千円）"),
             {"type": "orders", "years": [2016, 2025], "textDatesUntil": 2019, "author": "総務課 契約係"}]}))
F.append(("waste-incineration", "momijidai", {
    "id": "WI-05", "name": "もみじ台清掃センター", "short": "もみじ台SC", "owner": "架空町", "seed": 55005,
    "years": [2019, 2025], "planTo": 2032,
    "profile": {"furnace": "STOKER", "furnaces": 2, "perFurnace": 65, "turbine": True, "dust": "BF", "ash": "OUT", "contract": "SINGLE", "commissioned": 2010},
    "costScale": 0.85, "tagStyle": "num", "vendorStyle": "㈱", "vendorPick": 0,
    "overrides": {"FAC_PRECISE|精密機能検査": {"years": [2019, 2022, 2025, 2028, 2031]}},
    "docs": [chart("星取表_R元-R14", 2019, 2032, layout="cols", header="eraNL", legend="simple", costUnit="千円",
                   furnaceStyle=[0, 2], unitStyle=[1], nameVariant=0, sheetMech="機械", sheetElec="電気計装",
                   elecSheet={"layout": "indent", "header": "eraNL", "sysPrefix": "box", "subtotals": [], "parentSummary": []},
                   parentSummary=["COMB"], subtotals=["COMB", "COOL"]),
             {"type": "ledger", "stem": "機器台帳_号炉別", "perFurnace": True, "codeInName": 0.3, "nameVariant": 2}]}))
F.append(("waste-incineration", "umikaze", {
    "id": "WI-06", "name": "うみかぜエコプラント", "short": "うみかぜEP", "owner": "架空県南広域環境組合", "seed": 56006,
    "years": [2019, 2025], "planTo": 2034,
    "profile": {"furnace": "STOKER", "furnaces": 3, "perFurnace": 100, "turbine": True, "dust": "BF", "ash": "OUT", "contract": "OM", "commissioned": 2012},
    "costScale": 1.3, "tagStyle": "num", "vendorStyle": "株式会社", "vendorPick": 1,
    "docs": [chart("長期修繕計画_R1-R16", 2019, 2034, layout="indent", header="era2", legend="pd", costUnit="千円", sheetName="長期修繕計画（運営事業者）",
                   furnaceStyle=[0], unitStyle=[0], nameVariant=1, sysPrefix="paren", bullets=False, subtotals=["COMB", "COOL", "FLUE", "ELEC"], author="運営事業者 保全課"),
             {"type": "diary_csv", "years": [2021, 2025], "encoding": "utf-8", "kana": 0.1, "furnaceStyle": [0, 4]}]}))
F.append(("waste-incineration", "kaedehara", {
    "id": "WI-07", "name": "かえで原清掃工場", "short": "かえで原", "owner": "架空市", "seed": 57007,
    "years": [2020, 2025], "planTo": 2030,
    "profile": {"furnace": "FLUID", "furnaces": 2, "perFurnace": 40, "turbine": False, "dust": "BF", "ash": "OUT", "contract": "SINGLE", "commissioned": 2000},
    "costScale": 0.6, "tagStyle": "dash", "vendorStyle": "(株)", "vendorPick": 2,
    "overrides": {"FAC_PRECISE|精密機能検査": {"years": [2020, 2024, 2027, 2030]}},
    "gapsNote": [{"kind": "interval_max", "check": "interval_max", "level": "recommendation", "what": "精密機能検査", "note": "R2（2020）の次が R6（2024）。4 年空いた"}],
    "docs": [chart("整備計画_R2-R12", 2020, 2030, layout="numbered", header="pa", legend="pa", costUnit="千円", codeCol=True, sheetName="整備計画",
                   furnaceStyle=[1, 2], unitStyle=[0], nameVariant=0, sysPrefix="none"),
             {"type": "ledger", "stem": "機器台帳", "codeInName": 0.5, "nameVariant": 0}]}))
F.append(("waste-incineration", "tsubasadai", {
    "id": "WI-08", "name": "つばさ台環境エネルギーセンター", "short": "つばさ台EC", "owner": "架空西部広域環境組合", "seed": 58008,
    "years": [2017, 2025], "planTo": 2032,
    "profile": {"furnace": "SHAFT", "furnaces": 2, "perFurnace": 80, "turbine": True, "dust": "BF", "ash": "OUT", "contract": "SINGLE", "commissioned": 2007},
    "costScale": 1.2, "tagStyle": "num", "vendorStyle": "㈱", "vendorPick": 0,
    "docs": [chart("点検整備計画_2017-2032", 2017, 2032, layout="cols", header="fy4", legend="pd", costUnit="千円", codeCol=True, hideYears=2,
                   sheetName="点検整備計画", furnaceStyle=[0, 1], unitStyle=[0, 2], nameVariant=2, groups=True, parentSummary=["COMB"], subtotals=["COMB", "FLUE"]),
             {"type": "orders", "years": [2017, 2025], "textDatesUntil": 2018},
             {"type": "ledger", "stem": "機器台帳", "codeInName": 0.2, "nameVariant": 1}]}))
F.append(("waste-incineration", "kodamadani", {
    "id": "WI-09", "name": "こだま谷焼却場", "short": "こだま谷", "owner": "架空村", "seed": 59009,
    "years": [2021, 2025], "planTo": 2028,
    "profile": {"furnace": "FIXED", "furnaces": 1, "perFurnace": 30, "turbine": False, "dust": "BF", "ash": "OUT", "contract": "SINGLE", "commissioned": 1999},
    "costScale": 0.4, "tagStyle": "dash", "vendorStyle": "㈱", "vendorPick": 1,
    "exclude": ["SHRED", "CRANE_CTRL", "PFDOOR", "DEODOR", "HVPANEL", "INV", "UPS", "PANELS", "MOTORS", "INSTR", "VENT", "HOIST", "ELV",
                "DCS", "ITV", "HGM", "NH3P", "WELLP", "CTOWER", "SCR", "REUSEP", "ASHWP", "PITP", "FIREP"],
    "docs": [chart("点検計画_R3-R10", 2021, 2028, layout="indent", header="eraNL", legend="simple", costUnit="千円", sheetName="点検計画",
                   furnaceStyle=[0], unitStyle=[0], nameVariant=0, sysPrefix="box"),
             {"type": "orders", "years": [2021, 2025], "textDatesUntil": 0, "oneCellPeriod": True, "sheetFmt": "{era}年度"}]}))
F.append(("waste-incineration", "hoshinooka", {
    "id": "WI-10", "name": "ほしの丘リサイクルセンター", "short": "ほしの丘RC", "owner": "架空中央広域環境組合", "seed": 60010,
    "years": [2019, 2025], "planTo": 2031,
    "profile": {"furnace": "ROTARY", "furnaces": 2, "perFurnace": 70, "turbine": True, "dust": "BF", "ash": "MELT", "contract": "OM", "commissioned": 2004},
    "costScale": 1.0, "tagStyle": "num", "vendorStyle": "株式会社", "vendorPick": 0,
    "docs": [chart("保全計画_R1-R13", 2019, 2031, layout="merged", header="eraStack", legend="pa", costUnit="千円", ditto=0.4, sheetName="保全計画",
                   furnaceStyle=[2, 3], unitStyle=[2], nameVariant=1, colLabels={"names": ["設備", "機器", "系列", "部位", "部位"]}, author="運営事業者"),
             {"type": "diary_csv", "years": [2022, 2025], "encoding": "cp932", "kana": 0.25, "furnaceStyle": [3, 1]}]}))
# 動画のデモの施設 C：星取表を持たない（作業日報だけ。段 2 で発注台帳を足す）。似た施設の群（ストーカ・100〜199t/日・タービン・搬出・単年度）に入れる
F.append(("waste-incineration", "hotarugawa", {
    "id": "WI-11", "name": "ほたる川クリーンセンター", "short": "ほたる川CC", "owner": "架空西郷環境衛生組合", "seed": 63013,
    "years": [2016, 2025], "planTo": 2030,
    "profile": {"furnace": "STOKER", "furnaces": 2, "perFurnace": 70, "turbine": True, "dust": "BF", "ash": "OUT", "contract": "SINGLE", "commissioned": 2003},
    "costScale": 0.9, "tagStyle": "dash", "vendorStyle": "(株)", "vendorPick": 2,
    "docs": [{"type": "diary", "years": [2021, 2025], "furnaceStyle": [1, 3, 5], "kana": 0.2, "landscapeFrom": 2021}]}))
F.append(("night-soil", "suzukaze", {
    "id": "NS-01", "name": "すずかぜ衛生センター", "short": "すずかぜ衛生C", "owner": "架空衛生施設組合", "seed": 61011,
    "years": [2017, 2025], "planTo": 2030,
    "profile": {"method": "STD", "methodName": "標準脱窒素処理方式", "capacity_kl_per_day": 100, "furnaces": 1, "commissioned": 1997},
    "costScale": 1.0, "tagStyle": "dash", "vendorStyle": "㈱", "vendorPick": 0,
    "overrides": {"FAC_PRECISE|精密機能検査": {"years": [2017, 2020, 2024, 2027, 2030]}},
    "gapsNote": [{"kind": "interval_max", "check": "interval_max", "level": "recommendation", "what": "精密機能検査", "note": "R2（2020）の次が R6（2024）。4 年空いた"}],
    "docs": [chart("整備計画_H29-R12", 2017, 2030, layout="cols", header="era2", legend="pd", costUnit="千円", codeCol=True, topLabel="施設全体",
                   nameVariant=0, furnaceStyle=[0], unitStyle=[0, 1], sheetName="整備計画", subtotals=["RECV", "MAIN"]),
             {"type": "ledger", "stem": "機器台帳", "codeInName": 0.4, "nameVariant": 1},
             {"type": "inspect_csv", "stem": "定期巡視点検", "years": [2023, 2025], "encoding": "cp932",
              "items": [["AERBL", "吐出圧力", "kPa", 48, 56], ["AERBL", "振動", "mm/s", 1.2, 3.4], ["GASBL", "吐出圧力", "kPa", 30, 38],
                        ["FEEDP", "運転電流", "A", 3.1, 4.2], ["RECIRCP", "運転電流", "A", 9.0, 11.5], ["DEWAT", "振動", "mm/s", 1.8, 4.0],
                        ["LOFAN", "振動", "mm/s", 1.0, 2.8]]}]}))
F.append(("night-soil", "yuhihama", {
    "id": "NS-02", "name": "ゆうひ浜し尿処理場", "short": "ゆうひ浜", "owner": "架空町", "seed": 62012,
    "years": [2020, 2025], "planTo": 2029,
    "profile": {"method": "MBR", "methodName": "膜分離高負荷脱窒素処理方式", "capacity_kl_per_day": 60, "furnaces": 1, "commissioned": 2008},
    "costScale": 0.8, "tagStyle": "num", "vendorStyle": "(株)", "vendorPick": 1,
    "docs": [chart("点検整備計画_R2-R11", 2020, 2029, layout="indent", header="pa", legend="pa", costUnit="円", topLabel="施設全体", sysPrefix="box",
                   furnaceStyle=[0], unitStyle=[1, 3], nameVariant=1, sheetName="点検整備計画"),
             {"type": "ledger", "stem": "設備台帳", "codeInName": 0.7, "nameVariant": 2}]}))

ORDER = ["id", "pack", "name", "short", "owner", "seed", "today", "years", "planTo", "profile", "costScale", "tagStyle", "vendorStyle",
         "vendorPick", "exclude", "overrides", "gapsNote", "docs"]

if __name__ == "__main__":
    for pack, key, d in F:
        d["pack"] = pack
        d.setdefault("today", "2025-12-12")
        d.setdefault("overrides", {})
        p = ROOT / pack / key / "gen" / "facility.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        out = {k: d[k] for k in ORDER if k in d}
        p.write_bytes((json.dumps(out, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    print(f"{len(F)} 施設の設定を書いた")
