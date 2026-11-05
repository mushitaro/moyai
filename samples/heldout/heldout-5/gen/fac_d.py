# -*- coding: utf-8 -*-
"""施設 D：下水道の中継ポンプ場。保全計画表（横持ち、元号を 1 段にした見出し、H31→R元、
3 年度にまたがる結合、行のグループ、番号 1 / 1-1 / 1-1-1）と、修繕・点検履歴（Shift_JIS の CSV）。"""
import csv
import datetime as dt
import io
import os

import openpyxl
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L

from common import (ROOT, TODAY, MAN_DAY_HOURS, answer_file, fy_label, iso, rng, save_xlsx, write_json, write_text)

FAC_ID = "f-yanase"
NAME = "【架空】柳瀬中継ポンプ場"
DIR = os.path.join(ROOT, FAC_ID)
F_PLAN = "【架空】柳瀬中継ポンプ場_保全計画表_H30-R12.xlsx"
F_CSV = "【架空】柳瀬中継ポンプ場_修繕点検履歴_H30-R7.csv"
YEARS = list(range(2018, 2031))
COL0 = 6          # F 列が 2018

EQ = {
    "E01": dict(name="自動除塵機 No.1", code="SC-1", install_year=2001),
    "E02": dict(name="自動除塵機 No.2", code="SC-2", install_year=2001),
    "E03": dict(name="沈砂掻揚機", code="GR-1", install_year=2001),
    "E04": dict(name="主ポンプ No.1", code="MP-1", install_year=2001),
    "E05": dict(name="主ポンプ No.2", code="MP-2", install_year=2001),
    "E06": dict(name="主ポンプ No.3", code="MP-3", install_year=2009),
    "E07": dict(name="主ポンプ用電動機 No.1", code="MM-1", install_year=2001),
    "E08": dict(name="主ポンプ用電動機 No.2", code="MM-2", install_year=2001),
    "E09": dict(name="主ポンプ用電動機 No.3", code="MM-3", install_year=2009),
    "E10": dict(name="吐出弁", code="DV-1", install_year=2001),
    "E11": dict(name="受変電設備", code="SS-1", install_year=2001),
    "E12": dict(name="自家発電設備", code="EG-1", install_year=2001),
    "E13": dict(name="監視制御設備", code="TM-1", install_year=2012),
    "E14": dict(name="脱臭設備", code="DO-1", install_year=2001),
}
VEN = {"pump": "架空ポンプエンジニアリング㈱", "scr": "架空除塵機工業㈱", "elec": "（一財）架空電気保安協会",
       "eg": "架空パワーシステム㈱", "tm": "架空計装㈱", "do": "架空脱臭㈱", "mot": "架空モータサービス㈱"}

# 行：(番号, 名前（全角空白で字下げ）, 段, 機器, 内容, 周期, 費用(千円), 鍵, 属性, 初年, 備考, 業者, 月, 工期日数)
ROWS = [
    ("1", "沈砂池設備", 0, None, None, None, None, None, None, None, "", None, None, None),
    ("1-1", "　自動除塵機", 1, None, None, None, None, None, None, None, "", None, None, None),
    ("1-1-1", "　　No.1", 2, ["E01"], "定期点検", "1年", 300, "scr1", "INSPECT", 2018, "", "scr", 6, 2),
    ("1-1-2", "　　No.2", 2, ["E02"], "〃", "1年", 300, "scr2", "INSPECT", 2018, "", "scr", 6, 2),
    ("1-2", "　沈砂掻揚機", 1, ["E03"], "分解整備", 5, 2400, "grit", "OVERHAUL", 2019, "", "scr", 11, 10),
    ("2", "主ポンプ設備", 0, None, None, None, None, None, None, None, "", None, None, None),
    ("2-1", "　主ポンプ No.1", 1, ["E04"], "分解整備", 5, 6800, "mp1", "OVERHAUL", 2020, "", "pump", 1, 25),
    ("2-1-1", "　　電動機", 2, ["E07"], "絶縁診断", 2, 180, "mm1", "INSPECT", 2018, "", "mot", 10, 1),
    ("2-2", "　主ポンプ No.2", 1, ["E05"], "分解整備", 5, 6800, "mp2", "OVERHAUL", 2022, "", "pump", 1, 25),
    ("2-2-1", "　　電動機", 2, ["E08"], "絶縁診断", 2, 180, "mm2", "INSPECT", 2018, "", "mot", 10, 1),
    ("2-3", "　主ポンプ No.3", 1, ["E06"], "分解整備", 5, 7200, "mp3", "OVERHAUL", 2018, "H21増設", "pump", 1, 25),
    ("2-3-1", "　　電動機", 2, ["E09"], "絶縁診断", 2, 180, "mm3", "INSPECT", 2019, "", "mot", 10, 1),
    ("2-4", "　吐出弁（3台）", 1, ["E10"], "作動点検", 1, 250, "dv", "INSPECT", 2018, "", "pump", 7, 1),
    ("3", "電気設備", 0, None, None, None, None, None, None, None, "", None, None, None),
    ("3-1", "　受変電設備", 1, ["E11"], "年次点検", "1年", 900, "ss", "INSPECT", 2018, "全停電", "elec", 11, 1),
    ("3-2", "　自家発電設備", 1, ["E12"], "点検・負荷運転", 1, 420, "eg", "INSPECT", 2018, "R7から更新を検討中", "eg", 2, 1),
    ("3-3", "　監視制御設備", 1, ["E13"], "定期点検", 1, 650, "tm", "INSPECT", 2018, "", "tm", 9, 2),
    ("3-3-1", "　　更新", 2, ["E13"], "更新工事", None, 98000, "tm_up", "UPGRADE", 2028, "R14に次の更新の予定", "tm", None, None),
    ("4", "脱臭設備", 0, ["E14"], "活性炭取替", 3, 1100, "do", "REPLACE", 2018, "", "do", 8, 3),
]
POSTPONE = {("mp2", 2022): "R4は予算不足のためR5へ"}
NOT_DONE = {("mp3", 2023)}                        # 予定の ○ のまま（実施していない）
OMIT = {("dv", 2021), ("mm1", 2022)}               # 実施したのに ● が無い（履歴にはある）
PARTIAL = {("do", 2024): "活性炭 2槽のうち 1槽のみ取替"}
EXTRA = {("scr2", 2020): ("◇", "R2.9 豪雨のあとの臨時点検", dt.date(2020, 9, 7))}
PLAN_YEARS = {"mp3": [2018, 2023, 2026], "eg": list(range(2018, 2025))}   # 主ポンプ No.3 は R5 にせず R8 に（8 年）、自家発は R7 から予定が無い
THIN = Side(style="thin", color="000000")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def build_world():
    R = rng("D-world")
    works = []
    for row in ROWS:
        no, nm, lv, eqs, content, cyc, cost, key, attr, first, memo, ven, mon, ndays = row
        if key is None:
            continue
        if key == "tm_up":
            works.append(dict(key=key, row=row, plan_fy=2028, fiscal_year=2028, attr=attr, eq=eqs, start=dt.date(2028, 7, 1),
                              end=dt.date(2031, 3, 15), status="planned", vendor=None, plan_years=[2028, 2029, 2030]))
            continue
        c = int(str(cyc).replace("年", ""))
        years = PLAN_YEARS.get(key) or [y for y in YEARS if y >= first and (y - first) % c == 0]
        for fy in years:
            act = fy + 1 if (key, fy) in POSTPONE else fy
            y = act if mon >= 4 else act + 1
            s = dt.date(y, mon, 1) + dt.timedelta(days=R.randint(3, 20))
            while s.weekday() >= 5:
                s += dt.timedelta(days=1)
            e = s + dt.timedelta(days=ndays - 1)
            st = "actual" if e < TODAY else "planned"
            if (key, fy) in NOT_DONE:
                st = "not_done"
            works.append(dict(key=key, row=row, plan_fy=fy, fiscal_year=act, attr=attr, eq=eqs, start=s, end=e, status=st,
                              vendor=VEN[ven]))
    for (key, fy), (sym, note, d) in EXTRA.items():
        row = [r for r in ROWS if r[7] == key][0]
        works.append(dict(key=key + "_x", row=row, plan_fy=fy, fiscal_year=fy, attr="INSPECT", eq=row[3], start=d, end=d,
                          status="actual", vendor=VEN[row[11]], extra=(sym, note)))
    # 修繕（計画表に書かない。履歴にだけある）
    reps = [("r1", ["E05"], dt.date(2019, 8, 20), 2, "グランドパッキン交換", "REPLACE", "pump", 385000),
            ("r2", ["E01"], dt.date(2021, 6, 30), 1, "レーキ チェーン補修", "OVERHAUL", "scr", 242000),
            ("r3", ["E13"], dt.date(2023, 3, 2), 1, "UPS バッテリー交換", "REPLACE", "tm", 198000),
            ("r4", ["E04"], dt.date(2024, 12, 9), 3, "メカニカルシール交換（漏水）", "REPLACE", "pump", 1210000),
            ("r5", ["E12"], dt.date(2025, 6, 17), 1, "始動用蓄電池交換", "REPLACE", "eg", 330000)]
    for key, eqs, d, n, txt, attr, ven, amt in reps:
        works.append(dict(key=key, row=None, plan_fy=None, fiscal_year=d.year if d.month >= 4 else d.year - 1, attr=attr, eq=eqs,
                          start=d, end=d + dt.timedelta(days=n - 1), status="actual", vendor=VEN[ven], repair=txt, amt=amt))
    works.sort(key=lambda w: (w["start"], w["key"]))
    for i, w in enumerate(works, 1):
        w["id"] = f"W{i:04d}"
        w["rows"] = []
    return works


def write_plan(works):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "保全計画"
    ws["A1"] = f"{NAME}　保全計画表（H30～R12）"
    ws["A1"].font = Font(name="ＭＳ Ｐゴシック", size=14, bold=True)
    ws["A2"] = "単位：千円"
    ws["P2"] = "R8.4 改訂"
    gray = PatternFill("solid", fgColor="D9E1F2")
    for col, t in (("A", "番号"), ("B", "設備・機器"), ("C", "点検・整備の内容"), ("D", "周期"), ("E", "費用")):
        ws.merge_cells(f"{col}4:{col}5")
        ws[f"{col}4"] = t
    ws.cell(4, COL0, "平成")
    ws.merge_cells(start_row=4, start_column=COL0 + 1, end_row=4, end_column=COL0 + len(YEARS) - 1)
    ws.cell(4, COL0 + 1, "令　　　　　　和")
    for i, fy in enumerate(YEARS):
        lab = "30" if fy == 2018 else ("元" if fy == 2019 else str(fy - 2018))
        ws.cell(5, COL0 + i, lab)
    last = COL0 + len(YEARS)
    ws.merge_cells(start_row=4, start_column=last, end_row=5, end_column=last)
    ws.cell(4, last, "備考")
    for r in (4, 5):
        for c in range(1, last + 1):
            ws.cell(r, c).fill = gray
            ws.cell(r, c).border = BOX
            ws.cell(r, c).alignment = Alignment(horizontal="center", vertical="center")
    by_key = {}
    for w in works:
        if w["row"] is not None:
            by_key.setdefault(w["row"][7], []).append(w)
    recs = []
    eq_rows = {}
    r = 6
    prev_content = None
    for row in ROWS:
        no, nm, lv, eqs, content, cyc, cost, key, attr, first, memo, ven, mon, ndays = row
        ws.cell(r, 1, no)
        ws.cell(r, 2, nm)
        if content:
            ws.cell(r, 3, content)
        if cyc is not None:
            ws.cell(r, 4, cyc)
        if cost is not None:
            ws.cell(r, 5, cost)
        if memo:
            ws.cell(r, last, memo)
        if lv == 2:
            ws.row_dimensions[r].outlineLevel = 1
        marks = {}
        comments = {}
        if key:
            for w in by_key.get(key, []):
                if w["key"] == "tm_up":
                    c0 = COL0 + YEARS.index(2028)
                    ws.merge_cells(start_row=r, start_column=c0, end_row=r, end_column=c0 + 2)
                    ws.cell(r, c0, "○")
                    for y in (2028, 2029, 2030):
                        marks[str(y)] = "○"
                        w["rows"].append(dict(file=F_PLAN, sheet="保全計画", r=r, year=y))
                    continue
                if "extra" in w:
                    sym, note = w["extra"]
                    c = COL0 + YEARS.index(w["plan_fy"])
                    ws.cell(r, c, sym)
                    ws.cell(r, c).comment = Comment(note, "維持管理課")
                    comments[f"{L(c)}{r}"] = note
                    marks[str(w["plan_fy"])] = sym
                    w["rows"].append(dict(file=F_PLAN, sheet="保全計画", r=r, year=w["plan_fy"]))
                    continue
                fy = w["plan_fy"]
                c = COL0 + YEARS.index(fy)
                if (key, fy) in POSTPONE:
                    ws.cell(r, c, "○→")
                    ws.cell(r, c).comment = Comment(POSTPONE[(key, fy)], "維持管理課")
                    comments[f"{L(c)}{r}"] = POSTPONE[(key, fy)]
                    marks[str(fy)] = "○→"
                    w["rows"].append(dict(file=F_PLAN, sheet="保全計画", r=r, year=fy))
                    a = w["fiscal_year"]
                    ws.cell(r, COL0 + YEARS.index(a), "●")
                    marks[str(a)] = "●"
                    w["rows"].append(dict(file=F_PLAN, sheet="保全計画", r=r, year=a))
                    continue
                if w["status"] == "actual" and (key, fy) not in OMIT:
                    sym = "△" if (key, fy) in PARTIAL else "●"
                    if (key, fy) in PARTIAL:
                        ws.cell(r, c).comment = Comment(PARTIAL[(key, fy)], "維持管理課")
                        comments[f"{L(c)}{r}"] = PARTIAL[(key, fy)]
                        w["partial"] = PARTIAL[(key, fy)]
                else:
                    sym = "○"
                    if w["status"] == "actual":
                        w["omitted"] = True
                ws.cell(r, c, sym)
                marks[str(fy)] = sym
                w["rows"].append(dict(file=F_PLAN, sheet="保全計画", r=r, year=fy))
        for c in range(1, last + 1):
            ws.cell(r, c).border = BOX
            if c >= COL0:
                ws.cell(r, c).alignment = Alignment(horizontal="center")
        f = {"path": None}
        recs.append(dict(sheet="保全計画", r=r, kind="item" if content else "parent", fields=f, _row=row, _marks=marks, _comments=comments))
        if eqs:
            for e in eqs:
                eq_rows.setdefault(e, []).append(dict(file=F_PLAN, sheet="保全計画", r=r))
        r += 1
    # 木の道
    stack = []
    for rec in recs:
        row = rec["_row"]
        no, nm, lv = row[0], row[1].strip().replace("　", ""), row[2]
        stack = stack[:lv] + [nm]
        f = {"path": list(stack)}
        content = row[4]
        if content:
            f["work"] = "定期点検" if content == "〃" else content
            if row[5] is not None:
                f["cycle"] = int(str(row[5]).replace("年", ""))
            f["cost"] = row[6]
            f["unit"] = "千円"
            f["code"] = EQ[row[3][0]]["code"] if False else None
            f.pop("code")
            f["marks"] = dict(sorted(rec["_marks"].items()))
            if row[10]:
                f["memo"] = row[10]
            if rec["_comments"]:
                f["comments"] = rec["_comments"]
            # 自分の作業を持つ親の行（主ポンプ No.x、脱臭設備）
            nxt = [x for x in ROWS if x[0].startswith(row[0] + "-")]
            if nxt:
                rec["kind"] = "parent"
        elif row[10]:
            f["memo"] = row[10]
        rec["fields"] = f
        del rec["_row"], rec["_marks"], rec["_comments"]
    r += 1
    ws.cell(r, 1, "凡例　○：計画　●：実施　△：一部実施　○→：延期")
    ws.cell(r + 1, 1, "※主ポンプの分解整備は 5 年ごと（メーカー推奨）。")
    ws.sheet_properties.outlinePr.summaryBelow = False
    for col, wdt in zip("ABCDE", (8, 22, 18, 6, 9)):
        ws.column_dimensions[col].width = wdt
    for i in range(len(YEARS)):
        ws.column_dimensions[L(COL0 + i)].width = 4.5
    ws.column_dimensions[L(last)].width = 26
    save_xlsx(wb, os.path.join(DIR, "files", F_PLAN), f"{NAME} 保全計画表", NAME + " 維持管理課")
    return recs, eq_rows


GOKI = {"E01": ["No.1", "1号機", "(1)"], "E02": ["No.2", "№2", "2号機", "(2)"], "E04": ["1号", "No.1", "(1)"],
        "E05": ["2号機", "№2", "No.2"], "E06": ["(3)", "3号機", "No.3"], "E07": ["1号"], "E08": ["2号機"], "E09": ["(3)"]}
NAME_CSV = {"E01": "自動除塵機", "E02": "自動除塵機", "E03": "沈砂かき揚げ機", "E04": "主ポンプ", "E05": "主ポンプ", "E06": "主ポンプ",
            "E07": "主ポンプ電動機", "E08": "主ポンプ電動機", "E09": "主ポンプ電動機", "E10": "吐出弁", "E11": "受変電設備",
            "E12": "自家用発電設備", "E13": "監視制御設備", "E14": "脱臭装置"}
KUBUN_CSV = {"scr": "沈砂池", "grit": "沈砂池", "mp": "ポンプ", "mm": "ポンプ", "dv": "ポンプ", "ss": "電気", "eg": "電気", "tm": "電気",
             "do": "脱臭"}
AMT = {"scr1": 286000, "scr2": 286000, "grit": 2310000, "mp1": 6820000, "mp2": 6820000, "mp3": 7150000, "mm1": 176000, "mm2": 176000,
       "mm3": 176000, "dv": 242000, "ss": 880000, "eg": 418000, "tm": 660000, "do": 1078000}


def write_csv(works):
    R = rng("D-csv")
    buf = io.StringIO()
    wr = csv.writer(buf, lineterminator="\r\n")
    wr.writerow([f"{NAME} 修繕・点検履歴（維持管理システム出力 2026/10/01）"])
    head = ["履歴番号", "年度", "施設名", "設備区分", "機器名称", "号機", "作業区分", "着手日", "完了日", "工期(日)", "業者名", "金額(円)", "摘要"]
    wr.writerow(head)
    line = 3
    recs = []
    n = 0
    for w in works:
        if w["status"] != "actual" or w["start"] > dt.date(2026, 3, 31):
            continue
        if w["key"] == "eg" and w["fiscal_year"] == 2023:
            w["skip_csv"] = True      # 履歴の入力漏れ（計画表には ● がある）
            continue
        n += 1
        e = w["eq"][0]
        base = w["key"].split("_")[0]
        goki = R.choice(GOKI[e]) if e in GOKI else ""
        kub = KUBUN_CSV.get(base.rstrip("123"), KUBUN_CSV.get(base, "ポンプ"))
        if w.get("repair"):
            sag = "修繕"
            memo = w["repair"]
            amt = w["amt"]
            kub = {"E05": "ポンプ", "E01": "沈砂池", "E13": "電気", "E04": "ポンプ", "E12": "電気"}[e]
        else:
            sag = {"INSPECT": "点検", "OVERHAUL": "整備", "REPLACE": "取替", "UPGRADE": "更新"}[w["attr"]]
            content = w["row"][4]
            memo = ("定期点検" if content == "〃" else content)
            if "extra" in w:
                memo = "臨時点検（豪雨後）"
            if w.get("partial"):
                memo += "（1槽のみ）"
            amt = AMT.get(w["key"].split("_x")[0], 0)
            if "extra" in w:
                amt = 0
        days = (w["end"] - w["start"]).days + 1
        fy = w["fiscal_year"]
        fyl = "H30" if fy == 2018 else f"R{fy - 2018}"
        hist = f"YN-{fy}-{n:03d}"
        row = [hist, fyl, "柳瀬中継ポンプ場", kub, NAME_CSV[e], goki, sag, w["start"].strftime("%Y/%m/%d"),
               w["end"].strftime("%Y/%m/%d"), days, w["vendor"], amt, memo]
        wr.writerow(row)
        f = {"履歴番号": hist, "年度": fyl, "設備区分": kub, "機器名称": NAME_CSV[e], "作業区分": sag, "start": iso(w["start"]),
             "end": iso(w["end"]), "days": days, "業者名": w["vendor"], "金額": amt, "金額の単位": "円", "摘要": memo}
        if goki:
            f["号機"] = goki
        recs.append(dict(r=line, kind="item", fields=f))
        w["rows"].append(dict(file=F_CSV, r=line))
        line += 1
    with open(os.path.join(DIR, "files", F_CSV), "wb") as fh:
        fh.write(buf.getvalue().encode("cp932"))
    return recs


def build():
    works = build_world()
    plan_recs, eq_rows = write_plan(works)
    csv_recs = write_csv(works)
    answer_file(DIR, F_PLAN, True, plan_recs,
                note="見出しは元号の段（平成／令和）と年の段（30・元・2…）。監視制御設備の更新は R10～R12 の 3 列を結合した 1 つの ○ で、3 年度の印として書いた。〃 は上の行の内容に直した。")
    answer_file(DIR, F_CSV, False, csv_recs, note="1 行目は表題の行、2 行目が見出し。工期は日数だけ（工数は無い）。")
    eq_list = []
    for k, v in EQ.items():
        rows = eq_rows.get(k, [])
        path = None
        for row in ROWS:
            if row[3] and k in row[3]:
                path = path or row
        stack = []
        names = {}
        for row in ROWS:
            lv = row[2]
            stack = stack[:lv] + [row[1].strip().replace("　", "")]
            if row[3] and k in row[3]:
                path = list(stack)
                names.setdefault(F_PLAN, row[1].strip().replace("　", ""))
                break
        names[F_CSV] = NAME_CSV[k]
        eq_list.append(dict(id=k, name=v["name"], names=names, furnace=None, install_year=v["install_year"], code=v["code"],
                            path=path, rows=rows))
    wl, unrec = [], []
    for w in works:
        if w["status"] == "not_done":
            continue
        lab = (EQ[w["eq"][0]]["name"] + " " + (w["repair"] if w.get("repair") else
               ("臨時点検（豪雨後）" if "extra" in w else ("定期点検" if w["row"][4] == "〃" else w["row"][4]))))
        md = None
        ent = dict(id=w["id"], label=lab, attribute=w["attr"], status=w["status"], fiscal_year=w["fiscal_year"], equipment=w["eq"],
                   start=iso(w["start"]), end=iso(w["end"]), man_days=md, days=(w["end"] - w["start"]).days + 1,
                   vendor=w["vendor"] or "（未定）", contract=("単価契約（修繕）" if w.get("repair") else f"{fy_label(w['fiscal_year'])} {lab} 業務"),
                   rows=w["rows"])
        if w.get("omitted"):
            ent["note"] = "保全計画表の実績の書き漏れ（○ のまま）"
        if w.get("skip_csv"):
            ent["note"] = "修繕・点検履歴の入力漏れ（計画表の ● だけ）"
        if w.get("partial"):
            ent["note"] = w["partial"]
        wl.append(ent)
        if not w["rows"]:
            unrec.append(dict(work=w["id"], reason="?"))
    # どこにも無い作業
    nid = f"W{len(works) + 1:04d}"
    wl.append(dict(id=nid, label="吐出弁 No.2 弁棒グランド増締め", attribute="OVERHAUL", status="actual", fiscal_year=2022,
                   equipment=["E10"], start="2022-07-21", end="2022-07-21", man_days=None, days=1, vendor="直営",
                   contract="直営", rows=[]))
    unrec.append(dict(work=nid, reason="直営の軽作業で、履歴のシステムに入れず計画表にも書かない"))
    world = {
        "schema": "moyai.answer.world/0",
        "facility": {"id": FAC_ID, "name": NAME, "industry": "sewer",
                     "profile": {"kind": "汚水中継ポンプ場", "pumps": 3, "capacity_m3_per_min": 42.0, "completed": 2001,
                                 "contract": "包括的民間委託（運転のみ）"}},
        "fiscal_year_start_month": 4, "man_day_hours": MAN_DAY_HOURS, "today": iso(TODAY),
        "equipment": eq_list, "works": wl, "unrecorded": unrec,
        "defects": [
            dict(kind="周期の超え（主ポンプ No.3 の分解整備）", where=f"{F_PLAN} 2-3 主ポンプ No.3：H30 に実施、R5 は ○ のまま未実施、次は R8（8 年）",
                 check="分解整備の周期（5 年）"),
            dict(kind="点検の予定の抜け（自家発電設備）", where=f"{F_PLAN} 3-2 自家発電設備：R7 以降の ○ が無い（備考「R7から更新を検討中」）",
                 check="自家発電設備の点検と負荷運転（毎年）"),
        ],
        "note": "工数（人・日）を書いた資料が無いので、man_days は null。",
    }
    write_json(os.path.join(DIR, "answer", "world.json"), world)
    write_text(os.path.join(DIR, "user.md"), USER_MD)
    return dict(files=[F_PLAN, F_CSV], works=len(wl))


USER_MD = """# 柳瀬中継ポンプ場（架空）の担当者が答えられること

下水道課 維持管理係の担当です。汚水を処理場へ送る中継ポンプ場で、主ポンプは 3 台です。

## ファイル
- 保全計画表（H30-R12）：維持管理係が持つ点検と整備の年度の計画と実績です。保全の計画（星取表）です。
- 修繕・点検履歴（H30-R7）：維持管理のシステムから書き出した、実際に行った点検と修繕の一覧です。文字コードは Shift_JIS です。

## 記号と欄
- ○ は計画、● は実施、△ は一部だけ実施、○→ は翌年度へ延期です。◇ は計画外の臨時点検で、セルのメモに理由があります。
- 年度の見出しは、上が元号（平成・令和）、下が年です。「30」は平成30年度、「元」は令和元年度です。年度は 4 月始まりです。
- 費用は千円です（履歴の金額は円です）。周期は年で、「1年」と書いた行も 1 年です。
- 内容の 〃 は上の行と同じ（定期点検）です。
- 主ポンプ No.1～No.3 の行は、ポンプ本体の分解整備の行で、その下の「電動機」はそのポンプの電動機です。
- 監視制御設備の「更新」の ○ は、R10 から R12 の 3 年度にまたがる更新工事です。
- 履歴の工期(日)は着手日から完了日までの日数です。人数や工数は記録していません。

## 号機の書き方
- No.2・№2・2号機・(2) は同じ 2 号機です。主ポンプの 1号・No.1・(1) も同じです。
- 吐出弁は 3 台ありますが、計画表では 1 行にまとめています。

## 知っていること
- 主ポンプ No.3 の分解整備は R5 にできず、R8 に予定しています。
- 自家発電設備は更新を検討中なので、R7 から計画を入れていません。
"""
