# -*- coding: utf-8 -*-
"""施設 4：【架空】天鏡台浄水場（工業用水道）

資料：長期保全計画表（xlsx。横持ち、見出し 3 段で途中に結合、合計が上）・
機器台帳（文字の PDF。罫線の表、ページごとに見出しをくり返す）・
修繕報告書（xlsx。1 件 1 枚の帳票を 1 シートに積む、続紙あり）
"""
import datetime as dt
import os

import openpyxl
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.pagebreak import Break

from common import Facility, TODAY, iso, set_props, save_wb, wareki, wareki_long, rl_canvas, write_text

D = dt.date
FID = "f-tenkyodai"
NAME = "【架空】天鏡台浄水場"
F_PLAN = "【架空】天鏡台浄水場_長期保全計画表_2024-2038.xlsx"
F_LEDGER = "【架空】天鏡台浄水場_機器台帳.pdf"
F_REPAIR = "【架空】天鏡台浄水場_修繕報告書_R7-R8.xlsx"
YEARS = list(range(2024, 2039))

THIN = Side(style="thin", color="000000")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

V_PUMP = "鶯ポンプ製作所㈱"
V_ELEC = "常盤電設㈱"
V_INST = "空色計装㈱"
V_MECH = "山吹機工㈱"
V_CHEM = "萌葱化工機㈱"


def build():
    F = Facility(FID, NAME, "industrial-water", {
        "source": "河川表流水", "treatment": "凝集沈殿＋急速ろ過", "capacity_m3_per_day": 86000,
        "users": "工業用水 18 事業所", "contract": "直営＋単年度委託", "completed": 1998,
    }, 4)
    E = F.eq
    E("J01", "取水ゲート", ["取水設備", "取水ゲート"], None, 1998, "IG-1")
    E("J02", "除塵機（取水口）", ["取水設備", "除塵機"], None, 1998, "IS-1")
    E("J03", "取水ポンプ No.1", ["取水設備", "取水ポンプ", "No.1"], None, 1998, "IP-1")
    E("J04", "取水ポンプ No.2", ["取水設備", "取水ポンプ", "No.2"], None, 1998, "IP-2")
    E("J05", "取水ポンプ No.3", ["取水設備", "取水ポンプ", "No.3"], None, 1998, "IP-3")
    E("J06", "PAC 注入ポンプ No.1", ["薬品注入設備", "PAC 注入ポンプ", "No.1"], None, 2008, "CP-1")
    E("J07", "PAC 注入ポンプ No.2", ["薬品注入設備", "PAC 注入ポンプ", "No.2"], None, 2008, "CP-2")
    E("J08", "次亜注入ポンプ No.1", ["薬品注入設備", "次亜注入ポンプ", "No.1"], None, 1998, "HP-1")
    E("J09", "次亜注入ポンプ No.2", ["薬品注入設備", "次亜注入ポンプ", "No.2"], None, 1998, "HP-2")
    E("J10", "フロック形成池 撹拌機 1系", ["沈殿設備", "フロック形成池 撹拌機", "1系"], 1, 1998, "FM-1")
    E("J11", "フロック形成池 撹拌機 2系", ["沈殿設備", "フロック形成池 撹拌機", "2系"], 2, 1998, "FM-2")
    E("J12", "沈殿池 汚泥かき寄せ機 1系", ["沈殿設備", "汚泥かき寄せ機", "1系"], 1, 1998, "SC-1")
    E("J13", "沈殿池 汚泥かき寄せ機 2系", ["沈殿設備", "汚泥かき寄せ機", "2系"], 2, 1998, "SC-2")
    for i in range(4):
        E(f"J{14 + i}", f"急速ろ過池 表洗装置 No.{i + 1}池", ["ろ過設備", "表洗装置", f"No.{i + 1}池"], None, 1998,
          f"SW-{i + 1}")
    E("J18", "逆洗ポンプ No.1", ["ろ過設備", "逆洗ポンプ", "No.1"], None, 1998, "BW-1")
    E("J19", "逆洗ポンプ No.2", ["ろ過設備", "逆洗ポンプ", "No.2"], None, 1998, "BW-2")
    for i in range(4):
        E(f"J{20 + i}", f"送水ポンプ No.{i + 1}", ["送水設備", "送水ポンプ", f"No.{i + 1}"], None,
          2012 if i == 3 else 1998, f"SP-{i + 1}")
    E("J24", "濃縮槽 汚泥かき寄せ機", ["排水処理設備", "濃縮槽 汚泥かき寄せ機"], None, 1998, "TC-1")
    E("J25", "加圧脱水機", ["排水処理設備", "加圧脱水機"], None, 2005, "DW-1")
    E("J26", "受変電設備", ["電気設備", "受変電設備"], None, 1998)
    E("J27", "自家発電設備", ["電気設備", "自家発電設備"], None, 2016, "EG-1")
    E("J28", "監視制御設備", ["計装設備", "監視制御設備"], None, 2016)
    E("J29", "送水流量計", ["計装設備", "送水流量計"], None, 1998, "FI-201")
    E("J30", "場内全体", ["場内全体"], None, 1998)
    rows = plan_rows()
    make_plan_works(F, rows)
    write_plan(F, rows)
    write_ledger(F)
    write_repair(F)
    write_user(F)
    F.write_answers()
    return F


# ======================================================================
def plan_rows():
    rows = []

    def P(num, lvl, name, **kw):
        rows.append(dict(num=num, lvl=lvl, name=name, kind="parent", **kw))

    def I(num, lvl, name, eids, div, cycle, cost, years_sym, code=None, qty=None, memo=None, attr=None, cyc_text=None,
          vendor=V_MECH, **kw):
        rows.append(dict(num=num, lvl=lvl, name=name, kind="item", eids=eids, div=div, cycle=cycle, cost=cost,
                         ys=years_sym, code=code, qty=qty, memo=memo, attr=attr or {"点検": "INSPECT", "修繕": "OVERHAUL", "更新": "REPLACE"}[div],
                         cyc_text=cyc_text, vendor=vendor, **kw))

    def every(c, start, sym="○", last=2038):
        return {y: sym for y in range(start, last + 1, c)}

    P("1", 0, "取水設備")
    I("1-1", 1, "取水ゲート", ["J01"], "修繕", 10, 18000, every(10, 2027), code="IG-1", qty="1門")
    I("1-2", 1, "除塵機", ["J02"], "修繕", 5, 3200, every(5, 2025), code="IS-1", qty="1基")
    I("1-3", 1, "取水ポンプ（No.1～3）", ["J03", "J04", "J05"], "修繕", 6, 9600, every(6, 2026), code="IP-1～3",
      qty="3台", memo="3台を同じ年度に分解整備", vendor=V_PUMP, split=True)
    I("", 1, "〃", ["J03", "J04", "J05"], "更新", 30, 96000, {2033: "◎"}, resolve="取水ポンプ（No.1～3）", vendor=V_PUMP,
      memo="2033年度に3台更新の予定（第2期）")
    P("2", 0, "薬品注入設備")
    I("2-1", 1, "PAC 注入ポンプ", ["J06", "J07"], "修繕", 3, 1200, every(3, 2024), code="CP-1・2", qty="2台",
      vendor=V_CHEM)
    I("2-2", 1, "次亜注入ポンプ", ["J08", "J09"], "更新", 15, 3600, {2028: "◎"}, code="HP-1・2", qty="2台",
      vendor=V_CHEM, memo="平成10年3月設置")
    P("3", 0, "沈殿設備")
    I("3-1", 1, "フロック形成池 撹拌機", ["J10", "J11"], "点検", 1, 450, every(1, 2024), qty="2基", cyc_text="毎年")
    P("3-2", 1, "汚泥かき寄せ機")
    I("3-2-1", 2, "1系", ["J12"], "修繕", 4, 5400, every(4, 2025), code="SC-1")
    I("3-2-2", 2, "2系", ["J13"], "修繕", 4, 5400, every(4, 2026), code="SC-2")
    P("4", 0, "ろ過設備")
    I("4-1", 1, "急速ろ過池 表洗装置（No.1～4池）", ["J14", "J15", "J16", "J17"], "修繕", 5, 2800, every(5, 2024),
      code="SW-1～4", qty="4基", split=True)
    I("4-2", 1, "逆洗ポンプ", ["J18", "J19"], "修繕", 6, 2600, every(6, 2027), code="BW-1・2", qty="2台", vendor=V_PUMP)
    P("5", 0, "送水設備")
    P("5-1", 1, "送水ポンプ", qty="4台")
    I("5-1-1", 2, "No.1", ["J20"], "修繕", 5, 4200, every(5, 2024), code="SP-1", vendor=V_PUMP)
    I("5-1-2", 2, "No.2", ["J21"], "修繕", 5, 4200, every(5, 2025), code="SP-2", vendor=V_PUMP,
      memo="R7.11 軸受取替（事後）")
    I("5-1-3", 2, "No.3", ["J22"], "修繕", 5, 4200, every(5, 2026), code="SP-3", vendor=V_PUMP)
    I("5-1-4", 2, "No.4", ["J23"], "修繕", 5, 4200, every(5, 2027), code="SP-4", vendor=V_PUMP, memo="H24 増設")
    I("5-1-5", 2, "No.1～3", ["J20", "J21", "J22"], "更新", 30, 132000, {2030: "◎", 2031: "◎"}, vendor=V_PUMP,
      memo="2030～2031年度で順に更新（No.4 は対象外）", spread=True)
    P("6", 0, "排水処理設備")
    I("6-1", 1, "濃縮槽 汚泥かき寄せ機", ["J24"], "修繕", 5, 2400, every(5, 2026), code="TC-1")
    I("6-2", 1, "加圧脱水機", ["J25"], "修繕", 3, 6800, every(3, 2024), code="DW-1", memo="ろ布取替を含む")
    P("7", 0, "電気設備")
    I("7-1", 1, "受変電設備", ["J26"], "点検", 1, 1300, every(1, 2024), cyc_text="毎年", vendor=V_ELEC,
      memo="年次点検（全停電）")
    I("", 1, "〃", ["J26"], "更新", 25, 210000, {2035: "◎", 2036: "◎"}, resolve="受変電設備", vendor=V_ELEC,
      memo="2か年で更新", spread=True)
    I("7-2", 1, "自家発電設備", ["J27"], "点検", 1, 600, every(1, 2024), code="EG-1", cyc_text="毎年", vendor=V_ELEC,
      memo="H28 更新")
    P("8", 0, "計装設備")
    I("8-1", 1, "監視制御設備", ["J28"], "更新", 15, 85000, {2031: "◎"}, vendor=V_INST, memo="H28 更新。R13に次の更新の予定")
    I("8-2", 1, "送水流量計", ["J29"], "点検", 1, 350, every(1, 2024), code="FI-201", cyc_text="毎年", vendor=V_INST)
    return rows


def make_plan_works(F, rows):
    R = F.rng
    for row in rows:
        if row["kind"] != "item":
            continue
        row["years"] = {}
        row["marks"] = {}
        for y, sym in sorted(row["ys"].items()):
            if row.get("split"):
                groups = [[e] for e in row["eids"]]
            elif row.get("spread"):
                ys = sorted(row["ys"])
                n = len(ys)
                k = ys.index(y)
                if len(row["eids"]) < n:
                    # 1 台を何か年かで更新する 1 つの工事：最初の年度に作り、次の年度は同じ作業を指す
                    if k == 0:
                        s = D(ys[0], 10, 1)
                        e = D(ys[-1] + 1, 2, 28)
                        w = F.work(f"{row.get('resolve') or row['name']} 更新（{n}か年）", row["attr"], "planned", ys[0],
                                   row["eids"], start=s, end=e, days=(e - s).days + 1, vendor=row["vendor"])
                        row["_one"] = w
                    row["years"][y] = [row["_one"]]
                    row["marks"][y] = sym
                    continue
                per = (len(row["eids"]) + n - 1) // n
                groups = [row["eids"][k * per:(k + 1) * per]]
            else:
                groups = [row["eids"]]
            ws = []
            for g in groups:
                m = R.choice([10, 11, 12, 1, 2]) if row["div"] != "点検" else R.choice([6, 7, 9, 10])
                yy = y if m >= 4 else y + 1
                s = D(yy, m, R.randint(3, 20))
                dur = {"点検": 1, "修繕": R.randint(2, 6), "更新": R.randint(20, 60)}[row["div"]]
                e = s + dt.timedelta(days=dur - 1)
                st = "actual" if e < TODAY else "planned"
                nm = F.equipment[g[0]]["name"] if len(g) == 1 else row.get("resolve") or row["name"]
                lab = f"{nm} {row['div']}" + (f"（{row['memo']}）" if row["div"] == "点検" and row.get("memo") else "")
                w = F.work(lab, row["attr"], st, y, g, start=s, end=e, days=dur, vendor=row["vendor"])
                ws.append(w)
            row["years"][y] = ws
            if all(w["status"] == "actual" for w in ws):
                row["marks"][y] = "●"
            elif any(w["status"] == "actual" for w in ws):
                row["marks"][y] = "△"
            else:
                row["marks"][y] = sym
    # 汚さ：2026 年度の実施済みを 1 つ ○ のまま（最後の年度の未反映）
    for row in rows:
        if row["kind"] == "item" and row["name"] == "送水流量計" and row["marks"].get(2026) == "●":
            row["marks"][2026] = "○"
            row["notup"] = True
    # 凡例に無い記号（□：前倒しの候補）
    for row in rows:
        if row["kind"] == "item" and row["name"] == "濃縮槽 汚泥かき寄せ機":
            row["marks"][2030] = "□"
            row["cmt"] = (2030, "□：2031 年度の分を前倒しする候補（予算しだい）。実際の計画は 2031 年度の ○")
            # 2030 の □ は 2031 の計画（○）の作業を前倒しする候補。同じ作業を指す
            ws = row["years"][2031]
            row["years"][2030] = ws
            for w in ws:
                w["note"] = "計画表では 2030 の列に □（前倒しの候補）"


def write_plan(F, rows):
    wb = openpyxl.Workbook()
    set_props(wb, "【架空】天鏡台浄水場 長期保全計画表")
    ws = wb.active
    ws.title = "長期保全計画"
    SH = ws.title
    recs = F.file(F_PLAN, True)
    f9 = Font(name="游ゴシック", size=9)
    ws["A1"] = "【架空】天鏡台浄水場（工業用水道）　長期保全計画表　2024～2038年度"
    ws["A1"].font = Font(name="游ゴシック", size=14, bold=True)
    ws["A2"] = "【架空のデータ】　工務課　2026年9月 改定　　概算費用：千円（税込）"
    ws["A2"].font = f9
    YC = {y: 8 + i for i, y in enumerate(YEARS)}  # H..V
    WC = 8 + len(YEARS)  # W
    for c, t in [(1, "番号"), (2, "設備・機器"), (3, "機器番号"), (4, "数量"), (5, "区分"), (6, "周期"),
                 (7, "概算費用\n（千円/回）")]:
        ws.cell(4, c, t)
        ws.merge_cells(start_row=4, start_column=c, end_row=6, end_column=c)
    ws.cell(4, YC[2024], "計　画　年　度")
    ws.merge_cells(start_row=4, start_column=YC[2024], end_row=4, end_column=YC[2038])
    for k, (a, b) in enumerate([(2024, 2028), (2029, 2033), (2034, 2038)], 1):
        ws.cell(5, YC[a], f"第{k}期（{a}～{b}）")
        ws.merge_cells(start_row=5, start_column=YC[a], end_row=5, end_column=YC[b])
    for y in YEARS:
        ws.cell(6, YC[y], y)
    ws.cell(4, WC, "備　考")
    ws.merge_cells(start_row=4, start_column=WC, end_row=6, end_column=WC)
    for r in (4, 5, 6):
        for c in range(1, WC + 1):
            cl = ws.cell(r, c)
            cl.border = BOX
            cl.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cl.font = Font(name="游ゴシック", size=9, bold=True)
            cl.fill = PatternFill("solid", fgColor="E2EFDA")
    TOT = 7
    ws.cell(TOT, 2, "合　計（千円）")
    recs.append({"sheet": SH, "r": TOT, "kind": "total", "fields": {}})
    sums = {y: 0 for y in YEARS}
    r = 8
    stack = {}
    for row in rows:
        lvl = row["lvl"]
        real = row["name"] if row["name"] != "〃" else row["resolve"]
        stack = {k: v for k, v in stack.items() if k < lvl}
        stack[lvl] = real
        path = [stack[k] for k in sorted(stack)]
        ws.cell(r, 1, row["num"] or None)
        c = ws.cell(r, 2, row["name"])
        c.alignment = Alignment(horizontal="left", indent=lvl * 2)
        fields = {"path": path}
        if row["kind"] == "parent":
            if row.get("qty"):
                ws.cell(r, 4, row["qty"])
                fields["qty"] = row["qty"]
            if lvl == 0:
                for cc in range(1, WC + 1):
                    ws.cell(r, cc).fill = PatternFill("solid", fgColor="FFF2CC")
            recs.append({"sheet": SH, "r": r, "kind": "parent", "fields": fields})
        else:
            if row["code"]:
                ws.cell(r, 3, row["code"])
                fields["code"] = row["code"]
            if row["qty"]:
                ws.cell(r, 4, row["qty"])
                fields["qty"] = row["qty"]
            ws.cell(r, 5, row["div"])
            fields["work"] = row["div"]
            ct = row["cyc_text"] or f"{row['cycle']}年"
            ws.cell(r, 6, ct)
            fields["cycle"] = row["cycle"]
            fields["cycleText"] = ct
            ws.cell(r, 7, row["cost"]).number_format = "#,##0"
            fields["cost"] = row["cost"]
            fields["unit"] = "千円"
            marks = {}
            for y in sorted(row["marks"]):
                sym = row["marks"][y]
                ws.cell(r, YC[y], sym)
                marks[str(y)] = sym
                if sym != "□":
                    sums[y] += row["cost"] // (len(row["ys"]) if row.get("spread") else 1)
                for w in row["years"].get(y, []):
                    F.link(w, F_PLAN, sheet=SH, r=r, year=y)
            fields["marks"] = marks
            if row["memo"]:
                ws.cell(r, WC, row["memo"])
                fields["memo"] = row["memo"]
            if row.get("cmt"):
                y, txt = row["cmt"]
                ref = f"{openpyxl.utils.get_column_letter(YC[y])}{r}"
                ws[ref].comment = Comment(txt, "工務課")
                fields["comments"] = {ref: txt}
            recs.append({"sheet": SH, "r": r, "kind": "item", "fields": fields})
            if row["name"] != "〃":
                F.eq_row(row["eids"], F_PLAN, {"sheet": SH, "r": r}, row["name"])
        for cc in range(1, WC + 1):
            ws.cell(r, cc).border = BOX
            if ws.cell(r, cc).font.b is not True:
                ws.cell(r, cc).font = f9
            if cc >= YC[2024] and cc < WC:
                ws.cell(r, cc).alignment = Alignment(horizontal="center")
        if lvl >= 2:
            ws.row_dimensions[r].outline_level = 1
        r += 1
    last = r - 1
    for y in YEARS:
        ws.cell(TOT, YC[y], sums[y]).number_format = "#,##0"
    for cc in range(1, WC + 1):
        ws.cell(TOT, cc).border = BOX
        ws.cell(TOT, cc).font = Font(name="游ゴシック", size=9, bold=True)
        ws.cell(TOT, cc).fill = PatternFill("solid", fgColor="FCE4D6")
    ws.cell(last + 2, 2, "凡例　○：点検・修繕の計画　◎：更新の計画　●：実施済　△：一部実施")
    ws.cell(last + 3, 2, "注）合計は印のある年度の概算費用の和。2 か年にまたがる更新は年度で等分した。")
    for k, v in {"A": 7, "B": 34, "C": 10, "D": 6, "E": 6, "F": 6, "G": 11}.items():
        ws.column_dimensions[k].width = v
    for y in YEARS:
        ws.column_dimensions[openpyxl.utils.get_column_letter(YC[y])].width = 7.5
    ws.column_dimensions[openpyxl.utils.get_column_letter(WC)].width = 36
    ws.freeze_panes = "H7"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.outlinePr.summaryBelow = False
    F.defects.append({"kind": "点検の周期の超え", "where": f"{F_PLAN} の『汚泥かき寄せ機 1系・2系』は 4 年周期だが、第3期の 2037・2038 の後の計画が表の外",
                      "check": "（確かめ用。欠けではない）"})
    F.defects.append({"kind": "更新の時期の超え", "where": f"{F_PLAN} の『次亜注入ポンプ』は平成10年3月の設置で、周期 15 年の更新が 2028 年度（30 年目）まで無い",
                      "check": "更新の周期の超え（標準の耐用年数との比べ）"})
    save_wb(wb, F.path_of(F_PLAN))


# ======================================================================
LEDGER = [
    # (番号, 名称, 機器番号, 数量, 仕様, 製造者, 設置年月, 備考, eids, kind)
    ("1", "取水設備", "", "", "", "", "", "", [], "parent"),
    ("1.1", "取水ゲート", "IG-1", "1門", "鋼製ローラゲート 幅3.0m×高2.5m 電動", "山吹機工", "平成10年3月", "", ["J01"], "item"),
    ("1.2", "除塵機", "IS-1", "1基", "前面降下背面掻揚式 水路幅3.0m 1.5kW", "山吹機工", "平成10年3月", "", ["J02"], "item"),
    ("1.3", "取水ポンプ", "IP-1～3", "3台", "立軸斜流ポンプ φ500mm×28m³/min×18m×132kW", "鶯ポンプ製作所", "平成10年3月",
     "うち 1 台予備", ["J03", "J04", "J05"], "item"),
    ("1.4", "取水ポンプ用電動機", "IP-1M～3M", "3台", "かご形三相誘導電動機 132kW 6P 3.3kV", "常盤電機", "平成10年3月", "",
     [], "item"),
    ("1.5", "取水流量計", "FI-101", "1台", "電磁流量計 φ900mm", "空色計装", "平成10年3月", "", [], "item"),
    ("2", "薬品注入設備", "", "", "", "", "", "", [], "parent"),
    ("2.1", "PAC 貯留槽", "CT-1・2", "2基", "FRP製 30m³", "萌葱化工機", "平成10年3月", "", [], "item"),
    ("2.2", "PAC 注入ポンプ", "CP-1・2", "2台", "ダイヤフラム式 0.1～1.2L/min 0.2kW", "萌葱化工機", "平成20年3月", "平成20年 更新",
     ["J06", "J07"], "item"),
    ("2.3", "次亜塩素酸ナトリウム貯留槽", "HT-1", "1基", "FRP製 10m³", "萌葱化工機", "平成10年3月", "", [], "item"),
    ("2.4", "次亜注入ポンプ", "HP-1・2", "2台", "ダイヤフラム式 0.05～0.6L/min 0.1kW", "萌葱化工機", "平成10年3月", "",
     ["J08", "J09"], "item"),
    ("3", "沈殿設備", "", "", "", "", "", "", [], "parent"),
    ("3.1", "フロック形成池 撹拌機", "FM-1・2", "2基", "横軸パドル式 3段 2.2kW×3", "山吹機工", "平成10年3月", "1系・2系",
     ["J10", "J11"], "item"),
    ("3.2", "沈殿池 汚泥かき寄せ機", "SC-1・2", "2基", "チェーンフライト式 池幅8.0m×長さ60m 0.75kW", "山吹機工",
     "平成10年3月", "1系・2系", ["J12", "J13"], "item"),
    ("3.3", "排泥弁", "SV-1～8", "8台", "電動偏心構造弁 φ200mm", "山吹機工", "平成10年3月", "", [], "item"),
    ("4", "ろ過設備", "", "", "", "", "", "", [], "parent"),
    ("4.1", "急速ろ過池 表洗装置", "SW-1～4", "4基", "固定式表面洗浄 ノズル式", "山吹機工", "平成10年3月", "No.1～4池",
     ["J14", "J15", "J16", "J17"], "item"),
    ("4.2", "ろ過池 流量調節弁", "FV-1～4", "4台", "電動バタフライ弁 φ400mm", "山吹機工", "平成10年3月", "", [], "item"),
    ("4.3", "逆洗ポンプ", "BW-1・2", "2台", "横軸両吸込渦巻ポンプ φ350mm×18m³/min×12m×55kW", "鶯ポンプ製作所",
     "平成10年3月", "", ["J18", "J19"], "item"),
    ("4.4", "逆洗用空気ブロワ", "AB-1", "1台", "ルーツブロワ 12m³/min 30kW", "鶯ポンプ製作所", "平成10年3月", "", [], "item"),
    ("5", "送水設備", "", "", "", "", "", "", [], "parent"),
    ("5.1", "配水池", "", "2池", "RC造 有効容量 各9,000m³", "―", "平成10年3月", "", [], "item"),
    ("5.2", "送水ポンプ", "SP-1～4", "4台", "横軸両吸込渦巻ポンプ φ450mm×20m³/min×45m×200kW", "鶯ポンプ製作所",
     "平成10年3月", "No.4 は平成24年3月 増設", ["J20", "J21", "J22", "J23"], "item"),
    ("5.3", "送水ポンプ用電動機", "SP-1M～4M", "4台", "かご形三相誘導電動機 200kW 4P 3.3kV", "常盤電機", "平成10年3月",
     "No.4 は平成24年3月", [], "item"),
    ("5.4", "送水流量計", "FI-201", "1台", "電磁流量計 φ800mm", "空色計装", "平成10年3月", "", ["J29"], "item"),
    ("5.5", "送水圧力計", "PI-201", "1台", "ダイヤフラム式 0～1.0MPa", "空色計装", "平成10年3月", "", [], "item"),
    ("6", "排水処理設備", "", "", "", "", "", "", [], "parent"),
    ("6.1", "排水池", "", "1池", "RC造 有効容量 600m³", "―", "平成10年3月", "", [], "item"),
    ("6.2", "濃縮槽 汚泥かき寄せ機", "TC-1", "1基", "中心駆動懸垂式 φ12m 0.4kW", "山吹機工", "平成10年3月", "", ["J24"], "item"),
    ("6.3", "加圧脱水機", "DW-1", "1台", "フィルタープレス ろ室 80室", "萌葱化工機", "平成17年3月", "平成17年 新設", ["J25"], "item"),
    ("6.4", "脱水ケーキ搬出コンベヤ", "CV-1", "1台", "ベルトコンベヤ 幅600mm 2.2kW", "山吹機工", "平成17年3月", "", [], "item"),
    ("7", "電気設備", "", "", "", "", "", "", [], "parent"),
    ("7.1", "受変電設備", "", "1式", "6.6kV 受電 1回線 変圧器 1,500kVA×2", "常盤電設", "平成10年3月", "", ["J26"], "item"),
    ("7.2", "高圧配電盤", "", "1式", "3.3kV 閉鎖配電盤 12面", "常盤電設", "平成10年3月", "", [], "item"),
    ("7.3", "自家発電設備", "EG-1", "1台", "ディーゼル 500kVA 6.6kV", "常盤電設", "平成28年3月", "平成28年 更新", ["J27"], "item"),
    ("7.4", "無停電電源装置", "UPS-1", "1台", "10kVA 10分", "常盤電設", "平成28年3月", "", [], "item"),
    ("8", "計装設備", "", "", "", "", "", "", [], "parent"),
    ("8.1", "監視制御設備", "", "1式", "分散形制御装置 監視卓 2台", "空色計装", "平成28年3月", "平成28年 更新", ["J28"], "item"),
    ("8.2", "濁度計", "TB-1～3", "3台", "散乱光式 0～50度", "空色計装", "平成10年3月", "原水・沈殿・ろ過", [], "item"),
    ("8.3", "残留塩素計", "CL-1", "1台", "ポーラログラフ式", "空色計装", "平成10年3月", "", [], "item"),
    ("8.4", "水位計", "LI-1～6", "6台", "投込式・超音波式", "空色計装", "平成10年3月", "", [], "item"),
]


def year_of(text):
    t = text.replace("平成", "H").replace("令和", "R").replace("年", ".").replace("月", "")
    e = t[0]
    y = int(t[1:].split(".")[0])
    return (1988 if e == "H" else 2018) + y


def write_ledger(F):
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    path = F.path_of(F_LEDGER)
    c = rl_canvas(path, "【架空】天鏡台浄水場 機器台帳（完成図書 第2編 機器仕様 抜粋）")
    from reportlab.lib.pagesizes import A4 as _A4
    c.setPageSize(landscape(_A4))
    W, H = landscape(_A4)
    recs = F.file(F_LEDGER, False)
    cols = [("番号", 12), ("設備・機器名称", 52), ("機器番号", 26), ("数量", 14), ("主な仕様", 92), ("製造者", 26),
            ("設置年月", 24), ("備考", 27)]
    x0 = 12 * mm
    xs = [x0]
    for _, wmm in cols:
        xs.append(xs[-1] + wmm * mm)
    RH = 8.6 * mm
    page = [1]

    def head(first):
        c.setFont("JP", 8)
        c.drawString(x0, H - 10 * mm, "【架空】天鏡台浄水場　完成図書　第2編　機器仕様（抜粋）")
        c.drawRightString(W - 12 * mm, H - 10 * mm, "架空のデータ")
        if first:
            c.setFont("JP", 14)
            c.drawCentredString(W / 2, H - 20 * mm, "【架空】天鏡台浄水場　機器台帳")
            c.setFont("JP", 8)
            c.drawCentredString(W / 2, H - 26 * mm, "（竣工 平成10年3月。以後の更新・増設は設置年月と備考に記す。数量は場内の全数）")
            top = H - 32 * mm
        else:
            c.setFont("JP", 8)
            c.drawString(x0, H - 17 * mm, "（前頁より続く）")
            top = H - 20 * mm
        yb = top - RH
        c.setFillGray(0.86)
        c.rect(xs[0], yb, xs[-1] - xs[0], RH, fill=1, stroke=0)
        c.setFillGray(0)
        c.setFont("JP", 8.5)
        for i, (t, _) in enumerate(cols):
            c.drawCentredString((xs[i] + xs[i + 1]) / 2, yb + 3 * mm, t)
        grid(yb, top)
        return yb

    def grid(yb, yt, skip=()):
        c.setLineWidth(0.5)
        c.line(xs[0], yb, xs[-1], yb)
        c.line(xs[0], yt, xs[-1], yt)
        for i, x in enumerate(xs):
            if i not in skip:
                c.line(x, yb, x, yt)

    def foot():
        c.setFont("JP", 7)
        c.drawCentredString(W / 2, 7 * mm, f"2-{page[0]}")

    yy = head(True)
    seq = 0
    parent_name = None
    for (num, name, code, qty, spec, maker, inst, memo, eids, kind) in LEDGER:
        if yy - RH < 14 * mm:
            foot()
            c.showPage()
            page[0] += 1
            yy = head(False)
        yb = yy - RH
        if kind == "parent":
            c.setFont("JP", 8.5)
            c.drawString(xs[0] + 1.5 * mm, yb + 3 * mm, f"{num}.")
            c.drawString(xs[1] + 1.5 * mm, yb + 3 * mm, name)
            c.setFillGray(0.95)
            grid(yb, yy, skip=(2, 3, 4, 5, 6, 7))
            c.setFillGray(0)
            parent_name = name
            recs.append({"seq": seq, "kind": "parent", "fields": {"path": [name]}})
        else:
            c.setFont("JP", 7.5)
            vals = [num, name, code, qty, spec, maker, inst, memo]
            for i, v in enumerate(vals):
                if not v:
                    continue
                if i == 3:
                    c.drawRightString(xs[i + 1] - 1.5 * mm, yb + 3 * mm, v)
                else:
                    c.drawString(xs[i] + 1.2 * mm, yb + 3 * mm, v)
            grid(yb, yy)
            f = {"path": [parent_name, name], "qty": qty, "specs": [spec], "maker": maker,
                 "install_year": year_of(inst), "install": inst}
            if code:
                f["code"] = code
            if memo:
                f["memo"] = memo
                f["specs"] = [spec, memo]
            recs.append({"seq": seq, "kind": "item", "fields": f})
            if eids:
                F.eq_row(eids, F_LEDGER, {"seq": seq}, name)
        seq += 1
        yy = yb
    c.setFont("JP", 7.5)
    c.drawString(x0, yy - 5 * mm, "注）機器番号の「～」「・」はまとめて書いたもの。製造者は架空の会社。")
    foot()
    c.showPage()
    c.save()
    F._ledger_pages = page[0]


# ======================================================================
REPORTS = [
    # (報告No, 発生, 完了, 機器名, 機器番号, eids, 状況, 処置, 明細[(日, 内容, 業者, 人数, 時刻0, 時刻1)], 費用, attr)
    ("修-R7-01", D(2025, 5, 14), D(2025, 5, 16), "PAC 注入ポンプ No.2", "CP-2", ["J07"],
     "吐出量が設定の 6 割まで低下。\nダイヤフラムに亀裂。", "ダイヤフラム・逆止弁を取替。注入量を校正。",
     [(D(2025, 5, 14), "状況確認・分解", "萌葱化工機㈱", 2, "13:00", "17:00"),
      (D(2025, 5, 16), "部品取替・注入量校正", "萌葱化工機㈱", 2, "9:00", "15:00")], 286000, "REPLACE"),
    ("修-R7-02", D(2025, 7, 2), D(2025, 7, 2), "沈殿池 汚泥かき寄せ機 2系", "SC-2", ["J13"],
     "過負荷でトリップ。\nフライトに流木が噛み込み。", "流木を除去し、シャーピンを交換。",
     [(D(2025, 7, 2), "排水・流木除去・シャーピン交換", "山吹機工㈱", 4, "8:30", "17:30")], 198000, "OVERHAUL"),
    ("修-R7-03", D(2025, 8, 19), D(2025, 8, 19), "監視制御設備", "", ["J28"],
     "落雷の後、監視卓 1 台の画面が固まる。", "経過観察。再起動で復旧。部品は未交換。",
     [], 0, "INSPECT"),
    ("修-R7-04", D(2025, 11, 4), D(2025, 11, 14), "送水ポンプ No.2", "SP-2", ["J21"],
     "軸受の温度が 75℃ まで上昇。\n振動も増加。", "反負荷側の軸受を取替。芯出し調整。",
     [(D(2025, 11, 4), "振動測定・停止・切離し", "鶯ポンプ製作所㈱", 2, "9:00", "16:00"),
      (D(2025, 11, 5), "分解・軸受の抜取り", "鶯ポンプ製作所㈱", 3, "8:30", "17:00"),
      (D(2025, 11, 6), "軸・スリーブの寸法計測", "鶯ポンプ製作所㈱", 2, "8:30", "17:00"),
      (D(2025, 11, 12), "軸受（部品入荷）取付", "鶯ポンプ製作所㈱", 3, "8:30", "17:00"),
      (D(2025, 11, 13), "組立・芯出し", "鶯ポンプ製作所㈱", 3, "8:30", "17:00"),
      (D(2025, 11, 14), "試運転・振動測定", "鶯ポンプ製作所㈱", 2, "9:00", "15:00"),
      (D(2025, 11, 14), "保温・塗装の補修", "山吹機工㈱", 1, "13:00", "16:00")], 1_452_000, "REPLACE"),
    ("修-R7-05", D(2026, 1, 21), D(2026, 1, 22), "急速ろ過池 表洗装置 No.3池", "SW-3", ["J16"],
     "ノズル 2 本の詰まりで洗浄むら。", "ノズルを清掃し、1 本を取替。",
     [(D(2026, 1, 21), "ろ過池 排水・ノズル点検", "山吹機工㈱", 3, "9:00", "16:30"),
      (D(2026, 1, 22), "ノズル清掃・取替・通水", "山吹機工㈱", 3, "8:30", "15:00")], 352000, "OVERHAUL"),
    ("修-R8-01", D(2026, 4, 9), D(2026, 4, 9), "取水口 除塵機", "IS-1", ["J02"],
     "レーキのチェーンが外れる。", "チェーンを掛け直し、張りを調整。",
     [(D(2026, 4, 9), "チェーン掛け直し・張り調整", "山吹機工㈱", 2, "10:00", "14:30")], 88000, "OVERHAUL"),
    ("修-R8-02", D(2026, 6, 30), D(2026, 7, 3), "逆洗ポンプ No.1", "BW-1", ["J18"],
     "グランド部からの漏水が増加。", "グランドパッキンを取替。スリーブに摩耗あり、次回の修繕で取替。",
     [(D(2026, 6, 30), "漏水量の確認", "（職員）", 1, "9:00", "10:00"),
      (D(2026, 7, 3), "グランドパッキン取替", "鶯ポンプ製作所㈱", 2, "9:00", "15:00")], 121000, "REPLACE"),
    ("修-R8-03", D(2026, 9, 8), D(2026, 9, 9), "次亜注入ポンプ No.1", "HP-1", ["J08"],
     "エア噛みで注入が止まる。\n吸込配管の継手から空気を吸う。", "継手を取替、エア抜き。",
     [(D(2026, 9, 8), "応急のエア抜き", "（職員）", 1, "16:00", "17:00"),
      (D(2026, 9, 9), "吸込継手の取替", "萌葱化工機㈱", 2, "9:00", "12:00")], 64000, "REPLACE"),
]


def write_repair(F):
    from openpyxl.utils import get_column_letter
    wb = openpyxl.Workbook()
    set_props(wb, "【架空】天鏡台浄水場 修繕報告書 令和7～8年度")
    ws = wb.active
    ws.title = "修繕報告書"
    SH = ws.title
    recs = F.file(F_REPAIR, False)
    fm = Font(name="ＭＳ 明朝", size=10)
    fb = Font(name="ＭＳ 明朝", size=10, bold=True)
    NL = 5  # 1 枚の明細の行の数
    r = 1
    for (no, d0, d1, eqn, code, eids, status, action, lines, cost, attr) in REPORTS:
        chunks = [lines[i:i + NL] for i in range(0, max(1, len(lines)), NL)] or [[]]
        if not lines:
            chunks = [[]]
        md_total = 0.0
        w = F.work(f"{eqn} 修繕（{no}）", attr, "actual" if d1 < TODAY else "planned", d0.year if d0.month >= 4 else d0.year - 1,
                   eids, start=d0, end=d1, days=(d1 - d0).days + 1,
                   vendor=next((l[2] for l in lines if "職員" not in l[2]), "（職員）"), contract=no)
        for pi, chunk in enumerate(chunks):
            cont = pi > 0
            top = r
            ws.cell(r, 1, "【架空】天鏡台浄水場　修繕報告書" + ("（続き）" if cont else ""))
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
            ws.cell(r, 1).font = Font(name="ＭＳ 明朝", size=14, bold=True)
            ws.cell(r, 1).alignment = Alignment(horizontal="center")
            r += 1
            ws.cell(r, 1, "報告No.")
            ws.cell(r, 2, no)
            ws.cell(r, 5, "報告日")
            ws.cell(r, 6, wareki(d1 + dt.timedelta(days=1)))
            ws.cell(r, 8, "架空のデータ")
            label_r = r
            r += 1
            sheet_f = {"report_no": no, "report_date": iso(d1 + dt.timedelta(days=1))}
            if cont:
                ws.cell(r, 1, "前ページから続く")
                ws.cell(r, 1).font = Font(name="ＭＳ 明朝", size=9, italic=True)
                r += 1
            else:
                ws.cell(r, 1, "発生日")
                ws.cell(r, 2, wareki(d0))
                ws.cell(r, 5, "完了日")
                ws.cell(r, 6, wareki(d1))
                r += 1
                ws.cell(r, 1, "設備名")
                ws.cell(r, 2, eqn)
                ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=4)
                ws.cell(r, 5, "機器番号")
                ws.cell(r, 6, code or None)
                r += 1
                ws.cell(r, 1, "故障の状況")
                ws.cell(r, 2, status)
                ws.merge_cells(start_row=r, start_column=2, end_row=r + 1, end_column=8)
                ws.cell(r, 2).alignment = Alignment(wrap_text=True, vertical="top")
                r += 2
                ws.cell(r, 1, "処置の内容")
                ws.cell(r, 2, action)
                ws.merge_cells(start_row=r, start_column=2, end_row=r + 1, end_column=8)
                ws.cell(r, 2).alignment = Alignment(wrap_text=True, vertical="top")
                r += 2
                sheet_f.update(occur_date=iso(d0), done_date=iso(d1), equipment=eqn, status=status, action=action)
                if code:
                    sheet_f["code"] = code
            r += 1
            hdr = ["No.", "作業日", "作業内容", "業者", "人数", "時間", "工数（人工）", "備考"]
            for i, t in enumerate(hdr, 1):
                cl = ws.cell(r, i, t)
                cl.font = fb
                cl.border = BOX
                cl.alignment = Alignment(horizontal="center")
                cl.fill = PatternFill("solid", fgColor="EDEDED")
            r += 1
            for k in range(NL):
                n = pi * NL + k + 1
                ws.cell(r, 1, n)
                for cc in range(1, 9):
                    ws.cell(r, cc).border = BOX
                if k < len(chunk):
                    (dd, txt, ven, p, t0, t1) = chunk[k]
                    h0, m0 = map(int, t0.split(":"))
                    h1, m1 = map(int, t1.split(":"))
                    hours = (h1 * 60 + m1 - h0 * 60 - m0) / 60
                    if hours > 5:
                        hours -= 1
                    md = round(p * hours / 8, 2)
                    mdt = f"{md:.2f}".rstrip("0").rstrip(".")
                    ws.cell(r, 2, wareki(dd))
                    ws.cell(r, 3, txt)
                    ws.cell(r, 4, ven)
                    ws.cell(r, 5, p)
                    ws.cell(r, 6, f"{t0}～{t1}")
                    ws.cell(r, 7, mdt)
                    f = dict(sheet_f)
                    f.update(line=n, date=iso(dd), work=txt, vendor=ven, persons=p, time=f"{t0}～{t1}",
                             manDays=md, manDaysText=mdt)
                    recs.append({"sheet": SH, "r": r, "kind": "item", "fields": f})
                    F.link(w, F_REPAIR, sheet=SH, r=r)
                    md_total += md
                r += 1
            if not lines:
                recs.append({"sheet": SH, "r": label_r, "kind": "item", "fields": dict(sheet_f)})
                F.link(w, F_REPAIR, sheet=SH, r=label_r)
            last_chunk = pi == len(chunks) - 1
            if last_chunk:
                ws.cell(r, 1, "修繕費（円・税込）")
                ws.cell(r, 3, cost if cost else "―")
                if cost:
                    ws.cell(r, 3).number_format = "#,##0"
                r += 1
                if cost:
                    for rec in recs:
                        if rec["fields"].get("report_no") == no:
                            rec["fields"]["cost"] = cost
            ws.cell(r, 5, "担当")
            ws.cell(r, 6, "係長")
            ws.cell(r, 7, "課長")
            r += 1
            for rr in range(top + 1, r):
                for cc in range(1, 9):
                    if ws.cell(rr, cc).font != fb:
                        ws.cell(rr, cc).font = fm
            r += 2
            ws.row_breaks.append(Break(id=r - 1))
        w["man_days"] = round(md_total, 4)
        F.eq_name(eids, F_REPAIR, eqn)
    for k, v in {"A": 14, "B": 11, "C": 30, "D": 18, "E": 8, "F": 13, "G": 11, "H": 14}.items():
        ws.column_dimensions[k].width = v
    save_wb(wb, F.path_of(F_REPAIR))


def write_user(F):
    t = f"""# {F.name} の担当者が答えられること

（工務課の担当者の言葉で。聞かれたら答える）

## ファイル
- `{F_PLAN}`：2024 年度から 2038 年度までの長期保全計画表。2026 年 9 月に見直した版。
- `{F_LEDGER}`：完成図書の機器仕様の抜粋（機器台帳）。竣工のときのものに、更新・増設を書き足した。
- `{F_REPAIR}`：令和7年度と令和8年度（今日まで）の修繕報告書。1 件で 1 枚。1 枚に入りきらない明細は「（続き）」の紙に書く。

## 計画表
- 年度は 4 月はじまりの西暦。2024〜2028 が第1期、2029〜2033 が第2期、2034〜2038 が第3期。
- ○ は点検・修繕の計画、◎ は更新の計画、● は実施済み、△ は一部実施。□ は凡例に無いが、次の年度の分を前倒しするかもしれない候補（メモに書いた）。
- 2026 年度の送水流量計の点検はもう済んでいるが、まだ ● に直していない。
- 一番上の「合計」はその年度に印のある行の概算費用の和（千円）。2 か年にまたがる更新は年度で半分ずつにした。□ は数えない。
- 概算費用は 1 回あたりの千円、税込。「区分」は点検・修繕・更新。周期は「5年」のように文字で書いた。「毎年」は 1 年。
- 設備・機器の名前は字下げで木にしている（設備 → 機器 → 号機）。番号の列は 1・1-1・1-1-1。
- 「取水ポンプ（No.1～3）」「急速ろ過池 表洗装置（No.1～4池）」の行は、何台かを 1 行にまとめた。修繕は同じ年度に 1 台ずつ順にやる。
- 送水ポンプは号機ごとの行。「No.1～3」の行は更新の計画で、2030 年度に No.1・No.2、2031 年度に No.3 を更新する。No.4 は平成24年に増設したので対象外。
- 受変電設備の更新は 2035・2036 年度の 2 か年の 1 つの工事。
- 「〃」は上の行と同じ機器。
- 備考の「R7.11 軸受取替（事後）」は、送水ポンプ No.2 が壊れて直したことのメモ（計画ではない）。
- 「R13に次の更新の予定」は令和13年度（2031 年度）のこと。

## 機器台帳
- 数量は場内の全数。号機ごとには分けていない。機器番号の「IP-1～3」は IP-1・IP-2・IP-3 のこと。
- 設置年月は和暦で書いた。竣工は平成10年3月。
- 備考に、更新・増設・どの系列か、を書いた。
- 「製造者」は製作した会社（いずれも架空）。

## 修繕報告書
- 1 件の中の明細は 1 行が 1 日の 1 つの作業。工数は人工（1 人 1 日 8 時間を 1 人工）。時間は始めと終わりの時刻で、昼をまたぐものは 1 時間の休憩を引いた。
- 業者の欄の「（職員）」は、うちの職員がやったもの。
- 修-R7-03 は経過観察で、作業の明細は無い。
- 修-R7-04 は明細が 7 行あり、6 行目と 7 行目は「（続き）」の紙に書いた。
- 日付は和暦（R7.5.14 など）。
"""
    write_text(os.path.join(F.dir, "user.md"), t)
