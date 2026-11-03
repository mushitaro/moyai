# -*- coding: utf-8 -*-
"""【架空】みどり台クリーンセンターの保全資料を world.json から書き出す。

走らせ方（作業のフォルダで）:
  python -I -X utf8 writer/build.py

- 乱数の種と「今日」は固定（SEED / TODAY）。
- xlsx は zip の時刻と文書の作成日時を固定し、pdf は作成日時と ID を同じ長さの固定値に置き換える。
- LibreOffice の設定のフォルダは作業のフォルダの外（C:/tmp/moyai-heldout-1-lo）。
"""
import csv
import datetime as dt
import io
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import zipfile

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

SEED = 20261001
TODAY = dt.date(2026, 10, 1)
FIXED_DT = dt.datetime(2026, 10, 1, 9, 0, 0)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = os.path.join(ROOT, "files")
SOFFICE = r"C:\Program Files\LibreOffice\program\soffice.exe"
LO_PROFILE = "file:///C:/tmp/moyai-heldout-1-lo"
LO_OUT = r"C:\tmp\moyai-heldout-1-lo-out"
AUTHOR = "【架空】みどり台市 環境部 施設課"

world = json.load(open(os.path.join(ROOT, "world.json"), encoding="utf-8"))
EQ = {e["id"]: e for e in world["equipment"]}
WORKS = world["works"]
WK = {w["id"]: w for w in WORKS}
MDH = world["man_day_hours"]

truth = {"schema": "moyai.heldout.truth/0", "set": "heldout-1", "world": "world.json",
         "files": [], "assets": [], "marks": [], "events": []}

thin = Side(style="thin", color="000000")
hair = Side(style="hair", color="000000")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)
F_TITLE = Font(name="MS 明朝", size=14, bold=True)
F_BODY = Font(name="MS 明朝", size=10)
F_HEAD = Font(name="MS ゴシック", size=10, bold=True)
# 報告書は書体を 1 つにする（書体が複数だと LibreOffice の埋め込みの順が走るたびに変わり、pdf が同じにならない）
F_RHEAD = Font(name="MS 明朝", size=10, bold=True)
GRAY = PatternFill("solid", fgColor="D9D9D9")


def p(*a):
    print(*a, file=sys.stderr)


# ------------------------------------------------------------------ 共通の小道具
def wareki_year(y):
    if y >= 2019:
        return "令和", y - 2018
    return "平成", y - 1988


def r_date(d):
    """2023-08-31 -> R5.8.31"""
    d = dt.date.fromisoformat(d)
    if d >= dt.date(2019, 5, 1):
        return f"R{d.year - 2018}.{d.month}.{d.day}"
    return f"H{d.year - 1988}.{d.month}.{d.day}"


def fy_short(fy):
    return "R1" if fy == 2019 else f"R{fy - 2018}"


def furnace_of(eid):
    return EQ[eid]["furnace"]


def kanji_furnace(eid):
    f = furnace_of(eid)
    return f"{f}号炉" if f else "共通"


def fix_xlsx(path, wb):
    wb.properties.creator = AUTHOR
    wb.properties.lastModifiedBy = AUTHOR
    wb.properties.created = FIXED_DT
    wb.properties.modified = FIXED_DT
    wb.save(path)
    # zip の時刻をそろえ、core.xml の日時を固定する
    src = zipfile.ZipFile(path)
    items = [(i.filename, src.read(i.filename)) for i in src.infolist()]
    src.close()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in items:
            if name == "docProps/core.xml":
                data = re.sub(rb"(<dcterms:(created|modified)[^>]*>)[^<]*(</dcterms)",
                              rb"\g<1>2026-10-01T00:00:00Z\g<3>", data)
            zi = zipfile.ZipInfo(name, date_time=(2026, 10, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o600 << 16
            z.writestr(zi, data)


def rel(path):
    return os.path.relpath(path, FILES).replace(os.sep, "/")


def setw(ws, widths):
    for col, w in widths.items():
        ws.column_dimensions[col].width = w


def box(ws, rng):
    for row in ws[rng]:
        for c in row:
            c.border = BOX


# ------------------------------------------------------------------ 機器台帳
MECH_SYSTEMS = ["受入供給設備", "燃焼設備", "燃焼ガス冷却設備", "排ガス処理設備", "通風設備", "余熱利用設備", "灰出し設備"]
ELEC_SYSTEMS = ["電気設備", "計装設備"]
OLD_NO = {}  # 隠した列の旧番号


def ledger_tag(e):
    return f"{e['tag']}-{e['furnace']}" if e["furnace"] else e["tag"]


def build_ledger():
    path = os.path.join(FILES, "daicho", "setsubi-daicho_R8.xlsx")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb = Workbook()
    ws = wb.active
    ws.title = "機械設備"
    f = rel(path)

    # --- 1 枚目：機械設備（段を列で表す：設備 B／機器 C／部位 D）
    ws["A1"] = "【架空】みどり台クリーンセンター　機械設備台帳"
    ws.merge_cells("A1:K1")
    ws["A1"].font = F_TITLE
    ws["A2"] = "令和8年10月1日現在"
    ws["H2"] = "※設置年は竣工の年（和暦）。〃は上に同じ。"
    for a in ("A2", "H2"):
        ws[a].font = F_BODY
    heads = [("A4:A5", "No."), ("B4:D4", "名　　称"), ("B5", "設備"), ("C5", "機器"), ("D5", "部位"),
             ("E4:E5", "系列"), ("F4:F5", "機器番号"), ("G4:G5", "設置年"), ("H4:I4", "主要仕様"),
             ("H5", "仕様１"), ("I5", "仕様２"), ("J4:J5", "備考"), ("K4:K5", "旧番号")]
    for rng, text in heads:
        ws[rng.split(":")[0]] = text
        if ":" in rng:
            ws.merge_cells(rng)
    for row in ws["A4:K5"]:
        for c in row:
            c.font = F_HEAD
            c.alignment = CENTER
            c.fill = GRAY
            c.border = BOX
    r = 6
    no = 0
    oldn = 100
    for sysname in MECH_SYSTEMS:
        ws.cell(r, 2, sysname).font = Font(name="MS ゴシック", size=10, bold=True)
        group_cell = f"B{r}"
        truth["assets"].append({"file": f, "at": {"cell": group_cell, "sheet": ws.title}, "kind": "group",
                                "level": 1, "parent": None, "equipment_id": None, "path": [sysname],
                                "name_text": sysname, "name": sysname, "tag": None})
        for c in range(1, 12):
            ws.cell(r, c).border = BOX
        r += 1
        prev_year = None
        for e in [x for x in world["equipment"] if x["system"] == sysname]:
            no += 1
            oldn += 1
            ws.cell(r, 1, no)
            ws.cell(r, 3, e["base_name"])
            ws.cell(r, 5, e["furnace_label"])
            tag = ledger_tag(e)
            ws.cell(r, 6, tag)
            era, n = wareki_year(e["install_year"])
            ytxt = "〃" if prev_year == e["install_year"] else f"{era}{n}年"
            prev_year = e["install_year"]
            ws.cell(r, 7, ytxt)
            specs = []
            for i, s in enumerate(e["spec"][:2]):
                ws.cell(r, 8 + i, s)
                specs.append(s)
            ws.cell(r, 11, f"M-{oldn}")
            eq_cell = f"C{r}"
            truth["assets"].append({"file": f, "at": {"cell": eq_cell, "sheet": ws.title}, "kind": "equipment",
                                    "level": 2, "parent": {"cell": group_cell, "sheet": ws.title},
                                    "equipment_id": e["id"], "name_text": e["base_name"], "name": e["base_name"],
                                    "tag": tag, "install_year": e["install_year"], "spec_texts": specs})
            for c in range(1, 12):
                ws.cell(r, c).border = BOX
                ws.cell(r, c).font = F_BODY
            r += 1
            for part in e["parts"]:
                ws.cell(r, 4, part["name"])
                pspecs = []
                for i, s in enumerate(part["spec"][:2]):
                    ws.cell(r, 8 + i, s)
                    pspecs.append(s)
                if part.get("remark"):
                    m = re.match(r"(\d{4})年(\d+)月\s*(.*)", part["remark"])
                    era, n = wareki_year(int(m.group(1)))
                    rem = f"{era}{n}年{m.group(2)}月 {m.group(3)}"
                    ws.cell(r, 10, rem)
                    pspecs.append(rem)
                    for c in range(3, 11):
                        ws.cell(r, c).font = Font(name="MS 明朝", size=10, strike=True)
                for c in range(1, 12):
                    ws.cell(r, c).border = BOX
                    if not part.get("remark"):
                        ws.cell(r, c).font = F_BODY
                truth["assets"].append({"file": f, "at": {"cell": f"D{r}", "sheet": ws.title}, "kind": "part",
                                        "level": 3, "parent": {"cell": eq_cell, "sheet": ws.title},
                                        "equipment_id": e["id"], "name_text": part["name"], "name": part["name"],
                                        "tag": None, "spec_texts": pspecs})
                r += 1
            if e["parts"]:
                prev_year = None  # 部位の行をはさんだら「〃」を使わない（上が空欄になるため）
    ws.column_dimensions["K"].hidden = True
    setw(ws, {"A": 5, "B": 16, "C": 20, "D": 10, "E": 7, "F": 10, "G": 10, "H": 22, "I": 24, "J": 30, "K": 8})
    ws.freeze_panes = "A6"

    # --- 2 枚目：電気計装設備（別の様式：まとまりは結合した見出し行、仕様は 1 セル、設置年は西暦）
    ws2 = wb.create_sheet("電気計装設備")
    ws2["A1"] = "【架空】みどり台クリーンセンター　電気・計装設備台帳"
    ws2.merge_cells("A1:F1")
    ws2["A1"].font = F_TITLE
    ws2["A2"] = "2026年10月1日現在"
    for i, h in enumerate(["区分", "機器名称", "記号", "設置", "主要仕様", "備考"], start=1):
        c = ws2.cell(4, i, h)
        c.font = F_HEAD
        c.fill = GRAY
        c.alignment = CENTER
        c.border = BOX
    r = 5
    for sysname in ELEC_SYSTEMS:
        txt = f"■ {sysname}"
        ws2.cell(r, 1, txt).font = F_HEAD
        ws2.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
        group_cell = f"A{r}"
        truth["assets"].append({"file": f, "at": {"cell": group_cell, "sheet": ws2.title}, "kind": "group",
                                "level": 1, "parent": None, "equipment_id": None, "path": [sysname],
                                "name_text": txt, "name": sysname, "tag": None})
        r += 1
        for e in [x for x in world["equipment"] if x["system"] == sysname]:
            ws2.cell(r, 2, e["base_name"])
            ws2.cell(r, 3, e["tag"])
            ws2.cell(r, 4, f"{e['install_year']}年")
            spec = "／".join(e["spec"])
            ws2.cell(r, 5, spec)
            specs = [spec]
            if e["id"] == "E25":
                rem = "R8.2 更新（基幹改良）"
                ws2.cell(r, 6, rem)
                specs.append(rem)
            for c in range(1, 7):
                ws2.cell(r, c).border = BOX
                ws2.cell(r, c).font = F_BODY
            truth["assets"].append({"file": f, "at": {"cell": f"B{r}", "sheet": ws2.title}, "kind": "equipment",
                                    "level": 2, "parent": {"cell": group_cell, "sheet": ws2.title},
                                    "equipment_id": e["id"], "name_text": e["base_name"], "name": e["base_name"],
                                    "tag": e["tag"], "install_year": e["install_year"], "spec_texts": specs})
            r += 1
    setw(ws2, {"A": 6, "B": 22, "C": 8, "D": 9, "E": 36, "F": 24})
    fix_xlsx(path, wb)
    truth["files"].append({"file": f, "format": "xlsx", "kind": "ledger", "hidden_data": "exclude",
                           "note": "2 枚のシート。機械設備は設備・機器・部位を B・C・D の列の段で表し、設置年は和暦で「〃」の省略あり。"
                                   "電気計装設備は見出し行を結合したまとまりで、設置年は西暦、仕様は 1 セル。隠した K 列は旧番号で計画には使わない。"})


# ------------------------------------------------------------------ 星取表
HANKAKU = {"ストーカ": "ｽﾄｰｶ", "ボイラ": "ﾎﾞｲﾗ", "ごみクレーン": "ごみｸﾚｰﾝ", "灰クレーン": "灰ｸﾚｰﾝ"}
SYM = {("planned", False): "○", ("actual", False): "●", ("planned", True): "◇", ("actual", True): "◆"}


def build_star():
    path = os.path.join(FILES, "hoshitori", "hozen-keikaku-hyo_R8-R10.xlsx")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    f = rel(path)
    wb = Workbook()
    ws = wb.active
    ws.title = "保全実績・計画"
    years = world["fiscal_years"]
    ycol = {fy: 5 + i for i, fy in enumerate(years)}  # E..N
    last = get_column_letter(5 + len(years))  # O
    ws["A1"] = "【架空】みどり台クリーンセンター　保全実績及び計画表（星取表）"
    ws.merge_cells(f"A1:{last}1")
    ws["A1"].font = F_TITLE
    ws["A2"] = "令和8年10月1日 作成　／　計画期間：令和8年度～令和10年度"
    ws.merge_cells(f"A2:{last}2")
    ws["A2"].font = F_BODY
    # 見出し 3 段
    ws["A4"], ws["B4"], ws["C4"], ws["D4"] = "設備", "機器名称", "機器No.", "区分"
    for c in "ABCD":
        ws.merge_cells(f"{c}4:{c}6")
    ws["E4"] = "実　施　済"
    ws.merge_cells("E4:K4")
    ws["L4"] = "計　画　期　間"
    ws.merge_cells("L4:N4")
    ws[f"{last}4"] = "備考"
    ws.merge_cells(f"{last}4:{last}6")
    for fy in years:
        c = ycol[fy]
        ws.cell(5, c, "H31\nR1" if fy == 2019 else f"R{fy - 2018}")
        ws.cell(6, c, fy)
    for row in ws[f"A4:{last}6"]:
        for c in row:
            c.font = F_HEAD
            c.alignment = CENTER
            c.fill = GRAY
            c.border = BOX
    ws.row_dimensions[5].height = 28

    # 機器の行（予定・実績の 2 段）
    r = 7
    rows = {}
    for sysname in MECH_SYSTEMS + ELEC_SYSTEMS:
        eqs = [x for x in world["equipment"] if x["system"] == sysname]
        g_top = r
        ws.cell(r, 1, sysname)
        for e in eqs:
            nm = HANKAKU.get(e["base_name"], e["base_name"])
            name_text = f"{nm}\n({e['furnace']}号炉)" if e["furnace"] else nm
            tag = f"{e['furnace']}-{e['tag']}" if e["furnace"] else e["tag"]
            ws.cell(r, 2, name_text)
            ws.cell(r, 3, tag)
            ws.cell(r, 4, "予定")
            ws.cell(r + 1, 4, "実績")
            for c in (2, 3, 5 + len(years)):
                ws.merge_cells(start_row=r, start_column=c, end_row=r + 1, end_column=c)
            rows[e["id"]] = (r, r + 1)
            truth["assets"].append({"file": f, "at": {"cell": f"B{r}", "sheet": ws.title}, "kind": "equipment",
                                    "level": 2, "parent": {"cell": f"A{g_top}", "sheet": ws.title},
                                    "equipment_id": e["id"], "name_text": name_text, "name": nm, "tag": tag})
            r += 2
        ws.merge_cells(start_row=g_top, start_column=1, end_row=r - 1, end_column=1)
        truth["assets"].append({"file": f, "at": {"cell": f"A{g_top}", "sheet": ws.title}, "kind": "group",
                                "level": 1, "parent": None, "equipment_id": None, "path": [sysname],
                                "name_text": sysname, "name": sysname, "tag": None, "measure": False})
    last_row = r - 1

    # 印：機器 × 年度 × 予定/実績 で 1 つ
    groups = {}
    for w in WORKS:
        groups.setdefault((w["equipment_id"], w["fiscal_year"], w["status"]), []).append(w)
    notes = {}
    for (eid, fy, st), ws_ in sorted(groups.items()):
        big = {w["attr"] in ("REPLACE", "UPGRADE") for w in ws_}
        assert len(big) == 1, (eid, fy, st)
        sym = SYM[(st, big.pop())]
        status = st
        if eid == "E03" and fy == 2026 and st == "actual":
            sym = "済"  # 凡例に無い書き込み（実施済の意味）
        row = rows[eid][0] if st == "planned" else rows[eid][1]
        col = ycol[fy]
        ws.cell(row, col, sym)
        cell = f"{get_column_letter(col)}{row}"
        truth["marks"].append({"file": f, "at": {"cell": cell, "sheet": ws.title}, "fiscal_year": fy,
                               "status": status, "equipment_id": eid,
                               "work_ids": sorted(w["id"] for w in ws_), "symbol": sym})
        if any(w["precision"] for w in ws_):
            notes.setdefault(eid, []).append((fy, st))
    for eid, lst in notes.items():
        txt = "精密機能検査：" + "・".join(f"{fy_short(fy)}{'予定' if st == 'planned' else '実施'}" for fy, st in lst)
        ws.cell(rows[eid][0], 5 + len(years), txt)
    ws.cell(rows["E19"][0], 5 + len(years), "R3 電動機取替（旧電動機撤去）")
    ws.cell(rows["E18"][0], 5 + len(years), "R8 取替は R9.2 着手予定")
    ws.cell(rows["E25"][0], 5 + len(years), "R7～R8 基幹改良（DCS 更新）")
    for row in ws[f"A7:{last}{last_row}"]:
        for c in row:
            c.border = BOX
            c.font = F_BODY
            c.alignment = CENTER if c.column < 5 + len(years) else LEFT
    for rr in range(7, last_row + 1):
        ws.row_dimensions[rr].height = 15

    # 合計の行（同じシートの 2 つ目の表）
    r = last_row + 1
    ws.cell(r, 1, "年度計（作業件数）")
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)
    for fy in years:
        ws.cell(r, ycol[fy], sum(1 for w in WORKS if w["fiscal_year"] == fy))
    for row in ws[f"A{r}:{last}{r}"]:
        for c in row:
            c.border = BOX
            c.font = F_HEAD
            c.alignment = CENTER
    # 凡例
    r += 2
    ws.cell(r, 1, "【凡例】").font = F_HEAD
    legend = [("○", "予定（点検・整備）"), ("●", "実施済（点検・整備）"), ("◇", "取替・更新の予定"), ("◆", "取替・更新の実施済")]
    for i, (s, m) in enumerate(legend):
        ws.cell(r + 1 + i, 2, s).alignment = CENTER
        ws.cell(r + 1 + i, 3, m)
        ws.merge_cells(start_row=r + 1 + i, start_column=3, end_row=r + 1 + i, end_column=8)
    ws.cell(r + 6, 1, "※ 同じ年度に定期整備と精密機能検査がある機器は、印を 1 つにまとめた（内訳は備考）。年度は 4 月～翌 3 月。")
    setw(ws, {"A": 14, "B": 18, "C": 9, "D": 6, last: 34})
    for fy in years:
        ws.column_dimensions[get_column_letter(ycol[fy])].width = 6
    ws.freeze_panes = "E7"
    fix_xlsx(path, wb)
    truth["files"].append({"file": f, "format": "xlsx", "kind": "star",
                           "note": "機器ごとに予定・実績の 2 段。設備の列は縦に結合し、年度は和暦（H31/R1）と西暦の 2 段の見出し。"
                                   "取替・更新は ◇◆、同年度の精密機能検査は定期整備と同じ印。凡例に無い「済」が 1 つある（実施済）。"})


# ------------------------------------------------------------------ 作業実績一覧（作業ごと、cp932、カンマ）
BUNDLE_LABELS = {"排ガス処理設備の点検": "排ガス処理設備 一式（集じん・HCl/SOx・NOx）",
                 "通風機の分解整備": "通風機 一式（押込送風機・誘引通風機）"}
ADD_EV = []


def ev(file, at, works_, start, end, man_days, days, bundle):
    fys = {w["fiscal_year"] for w in works_}
    sts = {w["status"] for w in works_}
    assert len(fys) == 1 and len(sts) == 1
    truth["events"].append({"file": file, "at": at, "status": sts.pop(), "fiscal_year": fys.pop(),
                            "equipment_ids": sorted({w["equipment_id"] for w in works_}),
                            "work_ids": sorted(w["id"] for w in works_), "start": start, "end": end,
                            "man_days": man_days, "days": days, "bundle": bundle})


def slash_date(d):
    d = dt.date.fromisoformat(d)
    return f"{d.year}/{d.month}/{d.day}"


def build_daily_csv1():
    path = os.path.join(FILES, "nippo", "sagyo-jisseki-ichiran_R4-R7.csv")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    f = rel(path)
    sel = [w for w in WORKS if 2022 <= w["fiscal_year"] <= 2025 and w["status"] == "actual"]
    # まとめる
    recs = []
    used = set()
    for w in sel:
        if w["id"] in used:
            continue
        if w["label"] in BUNDLE_LABELS and EQ[w["equipment_id"]]["furnace"]:
            grp = [x for x in sel if x["label"] == w["label"] and x["start"] == w["start"]
                   and EQ[x["equipment_id"]]["furnace"] == EQ[w["equipment_id"]]["furnace"]]
        else:
            grp = [w]
        for x in grp:
            used.add(x["id"])
        recs.append(grp)
    recs.sort(key=lambda g: (g[0]["start"], g[0]["id"]))
    lines = [["【架空】みどり台クリーンセンター　保守点検作業実績一覧（令和4年度～令和7年度）"],
             ["出力日", "2026/10/01", "受託者", "【架空】みどり保全", "工数は延べ時間（1人日＝8h）"],
             [],
             ["管理No", "年度", "着手日", "完了日", "号炉", "機器名称", "作業内容", "人員", "日数", "延工数(h)", "備考"]]
    phys = 5  # 次の記録の物理の行
    prev = (None, None)
    total_h = 0
    seq = {}
    out_rows = []
    for g in recs:
        w0 = g[0]
        fy = w0["fiscal_year"]
        seq[fy] = seq.get(fy, 0) + 1
        bundle = len(g) > 1
        name = BUNDLE_LABELS[w0["label"]] if bundle else EQ[w0["equipment_id"]]["base_name"]
        crew = sum(x["crew"] for x in g)
        md = sum(x["man_days"] for x in g)
        hours = md * MDH
        total_h += hours
        s = slash_date(w0["start"])
        e = slash_date(w0["end"])
        s_txt = "〃" if (s, e) == prev else s
        e_txt = "〃" if (s, e) == prev else e
        prev = (s, e)
        label = w0["label"].replace("（基幹改良）", "")
        note = ""
        if w0["id"] == "W0134":
            note = "基幹改良工事\n（年度をまたいで令和8年2月27日に完了）"
        row = [f"{fy_short(fy)}-{seq[fy]:03d}", fy_short(fy), s_txt, e_txt, kanji_furnace(w0["equipment_id"]),
               name, label, crew, w0["duration_days"], f"{hours:,}", note]
        out_rows.append(row)
        ev(f, {"row": phys}, g, w0["start"], w0["end"], md, w0["duration_days"], bundle)
        phys += 1 + note.count("\n")
    lines += out_rows
    lines.append(["", "", "", "", "", "", "合計", "", "", f"{total_h:,}", ""])
    buf = io.StringIO()
    wr = csv.writer(buf, lineterminator="\r\n")
    for ln in lines:
        wr.writerow(ln)
    data = buf.getvalue()
    # 囲みの中の改行も CRLF のまま（Excel の書き出しに合わせる）
    with open(path, "wb") as fh:
        fh.write(data.encode("cp932"))
    truth["files"].append({"file": f, "format": "csv", "kind": "daily", "encoding": "cp932", "delimiter": ",",
                           "note": "委託先の作業実績の書き出し。1 行が 1 作業で、排ガス処理設備と通風機は号炉ごとに「一式」にまとめた。"
                                   "日付は西暦の斜線、前の行と同じ工期は「〃」、工数は延べ時間（千の区切り付き）、備考に囲みの中の改行が 1 つ。"})


# ------------------------------------------------------------------ 作業日報（日ごと、UTF-8 BOM、タブ）
WD = "月火水木金土日"
NIPPO_NAME = {"E04": "ストーカ", "E05": "焼却炉本体", "E09": "ボイラ", "E11": "バグフィルタ（集じん装置）",
              "E12": "HCl・SOx除去設備", "E13": "NOx除去設備", "E02": "ごみクレーン", "E22": "灰クレーン",
              "E03": "粗大ごみ切断機", "E07": "焼却炉本体"}


def build_daily_csv2():
    path = os.path.join(FILES, "nippo", "sagyo-nippo_2026-04_08.csv")
    f = rel(path)
    sel = [w for w in WORKS if w["fiscal_year"] == 2026 and w["status"] == "actual"]
    days = {}
    for w in sel:
        d = dt.date.fromisoformat(w["start"])
        while d <= dt.date.fromisoformat(w["end"]):
            days.setdefault(d, []).append(w)
            d += dt.timedelta(days=1)
    lines = [["【架空】みどり台クリーンセンター　作業日報（令和8年4月～8月 抜粋）"],
             ["受託者", "【架空】みどり保全", "年度", "令和8年度（2026年度）"],
             ["日付", "炉", "機器", "作業", "人数", "時間(h)", "備考"]]
    phys = 4
    for d in sorted(days):
        first = True
        tot = 0
        for w in sorted(days[d], key=lambda x: x["equipment_id"]):
            fno = EQ[w["equipment_id"]]["furnace"]
            label = w["label"]
            if w["precision"]:
                label = "精密機能検査（測定・分析）"
            note = ""
            if d == dt.date.fromisoformat(w["start"]):
                note = "着手"
            elif d == dt.date.fromisoformat(w["end"]):
                note = "完了"
            hours = w["crew"] * MDH
            tot += hours
            lines.append([f"{d.month}/{d.day}({WD[d.weekday()]})" if first else "",
                          str(fno) if fno else "－", NIPPO_NAME[w["equipment_id"]], label,
                          str(w["crew"]), f"{hours:.1f}", note])
            ev(f, {"row": phys}, [w], d.isoformat(), d.isoformat(), w["crew"], None, False)
            phys += 1
            first = False
        lines.append(["", "", "", "日計", "", f"{tot:.1f}", ""])
        phys += 1
    buf = io.StringIO()
    wr = csv.writer(buf, delimiter="\t", lineterminator="\n")
    for ln in lines:
        wr.writerow(ln)
    with open(path, "wb") as fh:
        fh.write(buf.getvalue().encode("utf-8-sig"))
    truth["files"].append({"file": f, "format": "csv", "kind": "daily", "encoding": "utf-8-sig", "delimiter": "\t",
                           "note": "日ごとの作業日報（タブ区切り）。日付は「月/日(曜)」で年は題と年度の欄から決まり、同じ日の 2 行目からは日付を空欄にした。"
                                   "1 作業を日ごとの行に分け、時間は人数×8 h、日ごとに「日計」の行がある。"})


# ------------------------------------------------------------------ 工事報告書（xlsx → pdf）
def lo_convert(xlsx):
    os.makedirs(LO_OUT, exist_ok=True)
    cmd = [SOFFICE, f"-env:UserInstallation={LO_PROFILE}", "--headless", "--norestore",
           "--convert-to", "pdf", "--outdir", LO_OUT, xlsx]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
    pdf_tmp = os.path.join(LO_OUT, os.path.splitext(os.path.basename(xlsx))[0] + ".pdf")
    data = open(pdf_tmp, "rb").read()
    os.remove(pdf_tmp)
    # 作成日時と ID を同じ長さの固定値にする（xref の位置を変えない）
    data = re.sub(rb"D:\d{14}", b"D:20261001090000", data)
    data = re.sub(rb"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?", lambda m: (b"2026-10-01T09:00:00" + (b"." + b"0" * (len(m.group(1)) - 1) if m.group(1) else b"")), data)
    data = re.sub(rb"/ID\s*\[\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\]",
                  lambda m: m.group(0).replace(m.group(1), b"0" * len(m.group(1))).replace(m.group(2), b"1" * len(m.group(2))), data)
    data = re.sub(rb"/DocChecksum /([0-9A-Fa-f]+)", lambda m: b"/DocChecksum /" + b"0" * len(m.group(1)), data)
    data = re.sub(rb"(<xmpMM:DocumentID>|<xmpMM:InstanceID>)([^<]*)(<)",
                  lambda m: m.group(1) + b"u" * len(m.group(2)) + m.group(3), data)
    return data


def report_sheet(title, meta, rows, path, notes):
    """rows: list of dict(no, kubun, name, tag, work, start, end, days, md, works, bundle)"""
    f_x = rel(path)
    wb = Workbook()
    ws = wb.active
    ws.title = "報告書"
    ws["A1"] = title
    ws.merge_cells("A1:I1")
    ws["A1"].font = Font(name="MS 明朝", size=15, bold=True)
    ws["A1"].alignment = CENTER
    ws.row_dimensions[1].height = 30
    r = 3
    for k, v in meta:
        ws.cell(r, 1, k).font = F_RHEAD
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
        ws.cell(r, 3, v).font = F_BODY
        ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=9)
        box(ws, f"A{r}:I{r}")
        r += 1
    r += 1
    ws.cell(r, 1, "１．作業実績").font = F_RHEAD
    r += 1
    heads = ["No.", "区分", "機器名称", "機器番号", "作業内容", "着手", "完了", "日数", "工数(人日)"]
    for i, h in enumerate(heads, start=1):
        c = ws.cell(r, i, h)
        c.font = F_RHEAD
        c.fill = GRAY
        c.alignment = CENTER
        c.border = BOX
    head_row = r
    r += 1
    first = r
    for it in rows:
        vals = [it["no"], it["kubun"], it["name"], it["tag"], it["work"], it["start_txt"], it["end_txt"],
                it["days"], it["md"]]
        for i, v in enumerate(vals, start=1):
            c = ws.cell(r, i, v)
            c.font = F_BODY
            c.border = BOX
            c.alignment = LEFT if i in (3, 5) else CENTER
        ws.cell(r, 9).number_format = "0.0"
        it["row"] = r
        r += 1
    ws.cell(r, 5, "合　計").alignment = CENTER
    ws.cell(r, 5).font = F_RHEAD
    ws.cell(r, 9, sum(it["md"] for it in rows)).number_format = "0.0"
    ws.cell(r, 9).font = F_BODY
    box(ws, f"A{r}:I{r}")
    r += 2
    for n in notes:
        ws.cell(r, 1, n).font = F_BODY
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=9)
        r += 1
    setw(ws, {"A": 5, "B": 8, "C": 26, "D": 11, "E": 32, "F": 11, "G": 11, "H": 6, "I": 10})
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_title_rows = f"{head_row}:{head_row}"
    fix_xlsx(path, wb)
    pdf_path = path[:-5] + ".pdf"
    with open(pdf_path, "wb") as fh:
        fh.write(lo_convert(path))
    return rel(pdf_path), f_x


def build_report1():
    path = os.path.join(FILES, "houkoku", "R5-teiki-seibi_sagyo-houkoku.xlsx")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sel = [w for w in WORKS if w["fiscal_year"] == 2023 and w["status"] == "actual"
           and "2023-08-31" <= w["start"] <= "2023-09-30"]
    groups = []
    elec = [w for w in sel if w["label"] == "全休止の電気・計装の点検"]
    for w in sel:
        if w in elec:
            if w is elec[0]:
                groups.append(elec)
            continue
        groups.append([w])
    rows = []
    for i, g in enumerate(groups, start=1):
        w0 = g[0]
        e = EQ[w0["equipment_id"]]
        bundle = len(g) > 1
        rows.append({"no": i, "kubun": kanji_furnace(w0["equipment_id"]) if not bundle else "共通",
                     "name": "電気・計装設備 一式" if bundle else e["base_name"],
                     "tag": "SUB/GEN/DCS" if bundle else ledger_tag(e),
                     "work": w0["label"].replace("全休止の", "全炉休止中の"),
                     "start_txt": r_date(w0["start"]), "end_txt": r_date(w0["end"]),
                     "days": w0["duration_days"], "md": float(sum(x["man_days"] for x in g)),
                     "works": g, "bundle": bundle})
    meta = [("工事名", "令和5年度 みどり台クリーンセンター 1・2号炉及び共通設備 定期整備工事"),
            ("工　期", "令和5年8月31日 ～ 令和5年10月11日"),
            ("受注者", "【架空】みどり保全"),
            ("発注者", "【架空】みどり台市 環境部")]
    notes = ["※ 工数は延べ人日（1人日＝8時間）。日数は暦日（休工日を含む）。",
             "※ 電気・計装設備（受変電配電設備・発電機・DCS）は全炉休止期間中に一括して点検したため一式で記載。"]
    pdf, src = report_sheet("【架空】令和5年度 定期整備工事 作業報告書", meta, rows, path, notes)
    for it in rows:
        texts = [str(it["no"]), it["name"], it["start_txt"]]
        ev(pdf, {"texts": texts}, it["works"], it["works"][0]["start"], it["works"][0]["end"],
           it["md"] if it["md"] != int(it["md"]) else int(it["md"]), it["days"], it["bundle"])
    truth["files"].append({"file": pdf, "format": "pdf", "kind": "report", "source_xlsx": src,
                           "note": "1 回の定期整備工事（令和5年度、1号炉・全炉休止・2号炉）の作業報告。1 行に区分・機器・作業・工期（R5.8.31 の和暦略記）・日数・工数（人日）。"
                                   "電気・計装は 3 機器を一式の 1 行にまとめた。"})
    return pdf


def build_report2():
    path = os.path.join(FILES, "houkoku", "R7-DCS-koshin_kansei-houkoku.xlsx")
    w = WK["W0134"]
    rows = [{"no": 1, "kubun": "計装設備", "name": "DCS（分散形制御システム）", "tag": "DCS", "work": "DCS 更新（基幹改良）",
             "start_txt": r_date(w["start"]), "end_txt": r_date(w["end"]), "days": w["duration_days"],
             "md": float(w["man_days"]), "works": [w], "bundle": False}]
    meta = [("工事名", "令和7年度 みどり台クリーンセンター DCS 更新工事（基幹的設備改良）"),
            ("工　期", "令和7年10月14日 ～ 令和8年2月27日（年度をまたぐ繰越工事）"),
            ("受注者", "【架空】みどり保全"),
            ("発注者", "【架空】みどり台市 環境部")]
    notes = ["※ 工数は延べ人日（1人日＝8時間）。日数は暦日。",
             "※ 監視操作卓・制御盤の据替えを含む。焼却炉は交互運転で処理を継続した。"]
    pdf, src = report_sheet("【架空】令和7年度 DCS 更新工事 完成報告書", meta, rows, path, notes)
    it = rows[0]
    ev(pdf, {"texts": ["DCS（分散形制御システム）", it["start_txt"], it["end_txt"]]}, [w], w["start"], w["end"],
       w["man_days"], w["duration_days"], False)
    truth["files"].append({"file": pdf, "format": "pdf", "kind": "report", "source_xlsx": src,
                           "note": "年度をまたぐ 1 件の更新工事の完成報告。作業は 1 行だけで、工期は和暦の略記、工数は人日の小数 1 桁。"})


# ------------------------------------------------------------------ 写真（報告書 1 頁目を撮った）
def solve(a, b):
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for i in range(n):
        piv = max(range(i, n), key=lambda r: abs(m[r][i]))
        m[i], m[piv] = m[piv], m[i]
        for r in range(n):
            if r != i:
                fct = m[r][i] / m[i][i]
                for c in range(i, n + 1):
                    m[r][c] -= fct * m[i][c]
    return [m[i][n] / m[i][i] for i in range(n)]


def persp_coeffs(dst, src):
    """dst の 4 点（出力画像）を src の 4 点（入力画像）へ写す係数"""
    a, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return solve(a, b)


def build_photo(pdf_rel):
    import pypdfium2 as pdfium
    from PIL import Image, ImageDraw, ImageFilter
    rnd = random.Random(SEED)
    pdf = pdfium.PdfDocument(os.path.join(FILES, pdf_rel))
    page = pdf[0]
    paper = page.render(scale=2.0).to_pil().convert("RGB")
    # 行の位置を文字から拾い、手書きのチェックと赤の丸を描く
    tp = page.get_textpage()
    text = tp.get_text_range()
    ph = page.get_height()
    draw = ImageDraw.Draw(paper)
    W, H = paper.size
    # 文字の箱から「R5.」の日付がある行の y を集め、No. の左の余白に鉛筆のチェックを描く
    ys = []
    for m in re.finditer(r"R5\.\d+\.\d+", text):
        l, b_, r_, t_ = tp.get_charbox(m.start())
        ys.append(round((ph - t_) * 2))
    rows_y = []
    for y in sorted(set(ys)):
        if not rows_y or y - rows_y[-1] > 8:
            rows_y.append(y)
    pen = (40, 40, 60)
    for y in rows_y:
        x0 = 30 + rnd.randint(-4, 4)
        y0 = y + 10 + rnd.randint(-3, 3)
        pts = [(x0, y0), (x0 + 7 + rnd.randint(0, 3), y0 + 9 + rnd.randint(0, 3)),
               (x0 + 22 + rnd.randint(0, 5), y0 - 10 + rnd.randint(-3, 3))]
        draw.line(pts, fill=pen, width=3, joint="curve")
    # 右上に赤の「確認」の丸印（文字は使わず、二重丸と線）
    cx, cy = W - 140, 70
    draw.ellipse([cx - 48, cy - 48, cx + 48, cy + 48], outline=(200, 30, 30), width=5)
    draw.ellipse([cx - 38, cy - 38, cx + 38, cy + 38], outline=(200, 30, 30), width=2)
    draw.line([(cx - 25, cy + 2), (cx - 6, cy + 22), (cx + 28, cy - 24)], fill=(200, 30, 30), width=6)
    # 机の上に置き、傾けて撮る
    bg_w, bg_h = int(W * 1.25), int(H * 1.35)
    bg = Image.new("RGB", (bg_w, bg_h), (92, 84, 74))
    # 木目のような筋
    bd = ImageDraw.Draw(bg)
    for i in range(0, bg_h, 6):
        c = 80 + rnd.randint(0, 22)
        bd.line([(0, i), (bg_w, i + rnd.randint(-20, 20))], fill=(c + 8, c, c - 10), width=3)
    ox, oy = (bg_w - W) // 2, (bg_h - H) // 2
    dst = [(ox + 40, oy + 25), (ox + W - 10, oy - 15), (ox + W + 25, oy + H + 30), (ox - 20, oy + H - 5)]
    src = [(0, 0), (W, 0), (W, H), (0, H)]
    coeffs = persp_coeffs(dst, src)
    mask = Image.new("L", paper.size, 255)
    warped = paper.transform(bg.size, Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(0, 0, 0))
    wmask = mask.transform(bg.size, Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=0)
    # 紙の影
    shadow = Image.new("RGB", bg.size, (0, 0, 0))
    smask = wmask.filter(ImageFilter.GaussianBlur(18)).point(lambda v: int(v * 0.55))
    bg.paste(shadow, (14, 18), smask)
    bg.paste(warped, (0, 0), wmask)
    # 手の影（左上から右下へ暗くなる斜めの帯）
    grad = Image.new("L", (64, 64))
    gp = grad.load()
    for yy in range(64):
        for xx in range(64):
            v = (xx * 0.6 + yy * 1.0) / (64 * 1.6)
            gp[xx, yy] = int(255 * (1.0 - 0.38 * max(0.0, v - 0.35) / 0.65))
    grad = grad.resize(bg.size, Image.BILINEAR)
    dark = Image.new("RGB", bg.size, (0, 0, 0))
    bg = Image.composite(bg, dark, grad)
    # 少しのぼけとざらつき
    bg = bg.filter(ImageFilter.GaussianBlur(1.1))
    noise = Image.new("L", (bg.size[0] // 4, bg.size[1] // 4))
    npx = noise.load()
    for yy in range(noise.size[1]):
        for xx in range(noise.size[0]):
            npx[xx, yy] = 128 + rnd.randint(-14, 14)
    noise = noise.resize(bg.size, Image.BILINEAR).convert("RGB")
    from PIL import ImageChops
    bg = ImageChops.overlay(bg, noise)
    bg = bg.resize((bg_w * 3 // 4, bg_h * 3 // 4), Image.LANCZOS)
    out = os.path.join(FILES, "shashin", "IMG_20231012_houkoku-p1.jpg")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bg.save(out, "JPEG", quality=82, optimize=False)
    truth["files"].append({"file": rel(out), "format": "jpg", "kind": "photo",
                           "photo_of": {"file": pdf_rel, "page": 1},
                           "note": "作業報告書の 1 頁目を印刷し、机の上で斜めから撮った写真。傾き・影・軽いぼけ・ざらつきがあり、"
                                   "行の左に鉛筆のチェック、右上に赤の確認の丸印を手で書いた。"})


def main():
    if os.path.isdir(FILES):
        shutil.rmtree(FILES)
    os.makedirs(FILES)
    build_ledger()
    build_star()
    build_daily_csv1()
    build_daily_csv2()
    pdf1 = build_report1()
    build_report2()
    build_photo(pdf1)
    with open(os.path.join(ROOT, "truth.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(truth, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    p("files", len(truth["files"]), "assets", len(truth["assets"]), "marks", len(truth["marks"]),
      "events", len(truth["events"]))


if __name__ == "__main__":
    main()
