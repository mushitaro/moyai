# -*- coding: utf-8 -*-
"""heldout-2 の資料と truth.json を書く。

走らせ方:
  python -I -X utf8 writer/make_all.py

乱数の種と「今日」は固定（SEED / TODAY）。一時のファイルは C:/tmp/moyai-heldout-2-tmp に置く。
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
import zipfile
from collections import defaultdict
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

SEED = 20261104
TODAY = dt.date(2026, 10, 1)  # world.today
FIXED_TS = (2026, 10, 1, 9, 0, 0)

ROOT = Path(__file__).resolve().parent.parent
FILES = ROOT / "files"
TMP = Path("C:/tmp/moyai-heldout-2-tmp")
SOFFICE = r"C:\Program Files\LibreOffice\program\soffice.exe"
AUTHOR = "【架空】みどり台クリーンセンター 施設管理係"
FONT = "MS Gothic"

W = json.loads((ROOT / "world.json").read_text(encoding="utf-8"))
EQ = {e["id"]: e for e in W["equipment"]}
WK = {w["id"]: w for w in W["works"]}
HOURS = W["man_day_hours"]
SYSTEMS = []
for e in W["equipment"]:
    if e["system"] not in SYSTEMS:
        SYSTEMS.append(e["system"])
MECH_SYSTEMS = [s for s in SYSTEMS if s not in ("電気設備", "計装設備")]
ELEC_SYSTEMS = [s for s in SYSTEMS if s in ("電気設備", "計装設備")]

truth = {
    "schema": "moyai.heldout.truth/0",
    "set": "heldout-2",
    "world": "world.json",
    "files": [],
    "assets": [],
    "marks": [],
    "events": [],
}


# ---------------------------------------------------------------- helpers
def d(s):
    return dt.date.fromisoformat(s)


def wareki(date, short_year=False):
    """R5.8.31 の形。2019 年 4 月以降だけを扱う。"""
    y = date.year - 2018
    return f"R{y}.{date.month}.{date.day}"


def wday(date):
    return "月火水木金土日"[date.weekday()]


def furnace_prefix(e):
    return f"{e['furnace']}号炉" if e["furnace"] else ""


def doc_tag(e):
    return f"{e['tag']}-{e['furnace']}" if e["furnace"] else e["tag"]


def hm(man_days):
    h = man_days * HOURS
    return f"{h}:00"


def thin():
    s = Side(style="thin", color="000000")
    return Border(left=s, right=s, top=s, bottom=s)


def fix_xlsx(path):
    """zip の時刻と core.xml の時刻を固定して、同じバイトにする。"""
    src = path.read_bytes()
    zin = zipfile.ZipFile(io.BytesIO(src))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == "docProps/core.xml":
                t = data.decode("utf-8")
                t = re.sub(r"(<dcterms:created[^>]*>)[^<]*(<)", r"\g<1>2026-10-01T09:00:00Z\2", t)
                t = re.sub(r"(<dcterms:modified[^>]*>)[^<]*(<)", r"\g<1>2026-10-01T09:00:00Z\2", t)
                data = t.encode("utf-8")
            zi = zipfile.ZipInfo(info.filename, FIXED_TS)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zout.writestr(zi, data)
    path.write_bytes(out.getvalue())


def new_wb():
    wb = openpyxl.Workbook()
    wb.properties.creator = AUTHOR
    wb.properties.lastModifiedBy = AUTHOR
    wb.properties.created = dt.datetime(2026, 10, 1, 9, 0, 0)
    wb.properties.modified = dt.datetime(2026, 10, 1, 9, 0, 0)
    return wb


def save_wb(wb, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    fix_xlsx(path)


def add_file(entry):
    truth["files"].append(entry)


# ---------------------------------------------------------------- 1. 機器台帳
def make_ledger():
    rel = "daicho/setsubi-daicho_R8.xlsx"
    wb = new_wb()
    ws = wb.active
    ws.title = "設備台帳"
    f = Font(name=FONT, size=10)
    fb = Font(name=FONT, size=10, bold=True)
    widths = {"A": 9, "B": 34, "C": 6, "D": 20, "E": 26, "F": 10, "G": 9, "H": 30}
    for k, v in widths.items():
        ws.column_dimensions[k].width = v
    ws["A1"] = "【架空】みどり台クリーンセンター　設備台帳（機械設備・電気計装設備）"
    ws["A1"].font = Font(name=FONT, size=14, bold=True)
    ws["A2"] = "令和8年10月1日 現在　／　経過年数は R8.10.1 時点（設置年からの年数）"
    ws["A2"].font = f
    ws["A3"] = "項番は「設備-機器-部位」の順に枝番を付ける（例 5-2-1 は 5 番の設備の 2 番目の機器の 1 番目の部位）。名称の（ ）内は機器番号。"
    ws["A3"].font = f
    headers = ["項番", "名　　称（機器番号）", "数量", "型　式", "能力・仕様", "設置年(西暦)", "経過年数", "備　考"]
    border = thin()
    gfill = PatternFill("solid", fgColor="D9E1F2")
    hfill = PatternFill("solid", fgColor="BFBFBF")

    row = [5]  # mutable

    def header(title):
        r = row[0]
        ws.cell(r, 1, title).font = Font(name=FONT, size=12, bold=True)
        r += 1
        for i, h in enumerate(headers, 1):
            c = ws.cell(r, i, h)
            c.font = fb
            c.fill = hfill
            c.border = border
            c.alignment = Alignment(horizontal="center", vertical="center")
        row[0] = r + 1

    def body(systems, start_no):
        no = start_no
        for sysname in systems:
            r = row[0]
            gcell = f"B{r}"
            ws.cell(r, 1, f"{no}").font = fb
            ws.cell(r, 2, sysname).font = fb
            for ci in range(1, 9):
                ws.cell(r, ci).fill = gfill
                ws.cell(r, ci).border = border
            ws.cell(r, 1).alignment = Alignment(horizontal="left")
            truth["assets"].append({
                "file": rel, "at": {"cell": gcell, "sheet": ws.title}, "kind": "group", "level": 1,
                "parent": None, "equipment_id": None, "path": [sysname],
                "name_text": sysname, "name": sysname, "tag": None,
            })
            r += 1
            eqs = [e for e in W["equipment"] if e["system"] == sysname]
            for k, e in enumerate(eqs, 1):
                name = furnace_prefix(e) + e["base_name"]
                name_text = f"{name}（{doc_tag(e)}）"
                ws.cell(r, 1, f"{no}-{k}")
                ws.cell(r, 2, name_text).alignment = Alignment(indent=1)
                ws.cell(r, 3, "1式" if e["id"] in ("E23", "E25") else "1基")
                ws.cell(r, 4, e["spec"][0])
                ws.cell(r, 5, e["spec"][1])
                ws.cell(r, 6, e["install_year"])
                ws.cell(r, 7, TODAY.year - e["install_year"])
                for ci in range(1, 9):
                    ws.cell(r, ci).font = f
                    ws.cell(r, ci).border = border
                ecell = f"B{r}"
                truth["assets"].append({
                    "file": rel, "at": {"cell": ecell, "sheet": ws.title}, "kind": "equipment", "level": 2,
                    "parent": {"cell": gcell, "sheet": ws.title}, "equipment_id": e["id"],
                    "name_text": name_text, "name": name, "tag": doc_tag(e),
                    "install_year": e["install_year"],
                    "spec_texts": [e["spec"][0], e["spec"][1]],
                })
                r += 1
                for j, p in enumerate(e["parts"], 1):
                    ws.cell(r, 1, f"{no}-{k}-{j}")
                    ws.cell(r, 2, p["name"]).alignment = Alignment(indent=3)
                    ws.cell(r, 3, "1式")
                    ws.cell(r, 5, p["spec"][0])
                    specs = [p["spec"][0]]
                    if len(p["spec"]) > 1:
                        ws.cell(r, 4, p["spec"][0])
                        ws.cell(r, 5, p["spec"][1])
                        specs = [p["spec"][0], p["spec"][1]]
                    note = None
                    if p["name"] == "旧電動機":
                        note = "R3.12 電動機取替により撤去、予備品として倉庫保管"
                        ws.cell(r, 8, note)
                        specs.append(note)
                    for ci in range(1, 9):
                        ws.cell(r, ci).font = Font(name=FONT, size=9)
                        ws.cell(r, ci).border = border
                    truth["assets"].append({
                        "file": rel, "at": {"cell": f"B{r}", "sheet": ws.title}, "kind": "part", "level": 3,
                        "parent": {"cell": ecell, "sheet": ws.title}, "equipment_id": e["id"],
                        "name_text": p["name"], "name": p["name"], "tag": None,
                        "spec_texts": specs,
                    })
                    r += 1
            row[0] = r
            no += 1
        return no

    header("Ⅰ　機械設備")
    nxt = body(MECH_SYSTEMS, 1)
    row[0] += 2
    header("Ⅱ　電気・計装設備")
    body(ELEC_SYSTEMS, nxt)
    r = row[0] + 1
    ws.cell(r, 1, "注）設置年は当初の据付年。部位の行の設置年は機器に同じ（記載を省略）。").font = f
    ws.cell(r + 1, 1, "注）数量の「1式」は複数の盤・装置をまとめて 1 件として管理するもの。").font = f
    ws.freeze_panes = "A5"
    ws.page_setup.orientation = "landscape"
    save_wb(wb, FILES / rel)
    add_file({"file": rel, "format": "xlsx", "kind": "ledger",
              "note": "1 シートに機械設備と電気・計装設備の 2 つの表を上下に置いた台帳。段は項番の枝番（1／1-1／1-1-1）と名称の字下げで表し、機器番号は名称の（ ）内に書く。設置年は西暦の数値で、経過年数の列がある。"})


# ---------------------------------------------------------------- 2. 星取表
SYM = {
    "定期整備（分解）": "整",
    "通風機の分解整備": "整",
    "全休止のタービン系の分解整備": "整",
    "排ガス処理設備の点検": "点",
    "ごみクレーンの年次点検": "点",
    "灰クレーンの年次点検": "点",
    "計量機の定期検査": "点",
    "切断機の点検": "点",
    "全休止の電気・計装の点検": "点",
    "精密機能検査": "精",
    "押込送風機の電動機取替": "取",
    "誘引通風機の取替": "取",
    "DCS の更新（基幹改良）": "更",
}


def half(date):
    return 0 if 4 <= date.month <= 9 else 1


def make_star():
    rel = "hoshitori/hozen-jisseki-keikaku_R1-R10.xlsx"
    wb = new_wb()
    ws = wb.active
    ws.title = "保全実績・計画"
    f = Font(name=FONT, size=10)
    fb = Font(name=FONT, size=10, bold=True)
    border = thin()
    years = W["fiscal_years"]
    c0 = 5
    lastc = c0 + len(years) * 2  # 備考
    ws["A1"] = "【架空】みどり台クリーンセンター　機器別 保全実績・計画表（令和元年度～令和10年度）"
    ws["A1"].font = Font(name=FONT, size=14, bold=True)
    ws["A2"] = "令和8年10月1日 現在"
    ws["A2"].font = f
    ws["A3"] = ("凡例　点＝点検・検査　整＝分解整備　精＝精密機能検査　取＝取替　更＝更新（基幹改良）"
                "　／　記号だけ＝実施済、（ ）付き＝予定　例：整＝分解整備を実施済、（整）＝分解整備の予定")
    ws["A3"].font = f
    ws["A4"] = "各年度は上期（4～9月）と下期（10～3月）に分け、着手した期に記号を書く。同じ期に 2 つの作業があるときは「・」で並べる。"
    ws["A4"].font = f
    hfill = PatternFill("solid", fgColor="D9D9D9")
    for c, h in ((1, "No."), (2, "設備・機器名称"), (3, "号炉"), (4, "管理番号"), (lastc, "備　考")):
        ws.cell(6, c, h)
        ws.merge_cells(start_row=6, start_column=c, end_row=7, end_column=c)
    for i, fy in enumerate(years):
        c = c0 + i * 2
        label = f"R元\n({fy})" if fy == 2019 else f"R{fy - 2018}\n({fy})"
        ws.cell(6, c, label)
        ws.merge_cells(start_row=6, start_column=c, end_row=6, end_column=c + 1)
        ws.cell(7, c, "上")
        ws.cell(7, c + 1, "下")
        ws.column_dimensions[get_column_letter(c)].width = 6.5
        ws.column_dimensions[get_column_letter(c + 1)].width = 6.5
    ws.cell(5, c0, "年度（上段：和暦　下段：西暦）")
    ws.cell(5, c0).font = f
    for r in (6, 7):
        for c in range(1, lastc + 1):
            cell = ws.cell(r, c)
            cell.font = fb
            cell.fill = hfill
            cell.border = border
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[6].height = 28
    ws.column_dimensions["A"].width = 5
    ws.column_dimensions["B"].width = 24
    ws.column_dimensions["C"].width = 6
    ws.column_dimensions["D"].width = 9
    ws.column_dimensions[get_column_letter(lastc)].width = 34

    # works by (equipment, fy, half)
    cells = defaultdict(list)
    for w in W["works"]:
        cells[(w["equipment_id"], w["fiscal_year"], half(d(w["start"])))].append(w)

    gfill = PatternFill("solid", fgColor="E2EFDA")
    notes = {
        "E25": "R7下の更新は R7.10～R8.2 の継続工事",
        "E18": "R8下の取替は R9.2 に施工予定",
        "E19": "R3下の取替は電動機のみ（直営）",
    }
    r = 8
    no = 1
    for sysname in SYSTEMS:
        ws.cell(r, 2, sysname).font = fb
        for c in range(1, lastc + 1):
            ws.cell(r, c).fill = gfill
            ws.cell(r, c).border = border
        gcell = f"B{r}"
        truth["assets"].append({
            "file": rel, "at": {"cell": gcell, "sheet": ws.title}, "kind": "group", "level": 1,
            "parent": None, "equipment_id": None, "path": [sysname],
            "name_text": sysname, "name": sysname, "tag": None, "measure": False,
        })
        r += 1
        for e in [e for e in W["equipment"] if e["system"] == sysname]:
            ws.cell(r, 1, no)
            ws.cell(r, 2, e["base_name"])
            ws.cell(r, 3, f"{e['furnace']}号" if e["furnace"] else "共通")
            ws.cell(r, 4, doc_tag(e))
            if e["id"] in notes:
                ws.cell(r, lastc, notes[e["id"]])
            for c in range(1, lastc + 1):
                ws.cell(r, c).font = f
                ws.cell(r, c).border = border
                if c >= c0 and c < lastc:
                    ws.cell(r, c).alignment = Alignment(horizontal="center")
            truth["assets"].append({
                "file": rel, "at": {"cell": f"B{r}", "sheet": ws.title}, "kind": "equipment", "level": 2,
                "parent": {"cell": gcell, "sheet": ws.title}, "equipment_id": e["id"],
                "name_text": e["base_name"], "name": e["base_name"], "tag": doc_tag(e),
            })
            for i, fy in enumerate(years):
                for h in (0, 1):
                    ws_ = cells.get((e["id"], fy, h))
                    if not ws_:
                        continue
                    ws_ = sorted(ws_, key=lambda w: (w["start"], w["id"]))
                    sts = {w["status"] for w in ws_}
                    assert len(sts) == 1, (e["id"], fy, h)
                    st = sts.pop()
                    s = "・".join(SYM[w["label"]] for w in ws_)
                    if st == "planned":
                        s = f"（{s}）"
                    col = c0 + i * 2 + h
                    ws.cell(r, col, s)
                    cl = f"{get_column_letter(col)}{r}"
                    truth["marks"].append({
                        "file": rel, "at": {"cell": cl, "sheet": ws.title}, "fiscal_year": fy,
                        "status": st, "equipment_id": e["id"], "work_ids": [w["id"] for w in ws_],
                        "symbol": s,
                    })
            r += 1
            no += 1
    r += 1
    ws.cell(r, 1, "※ 号炉の「共通」は 1・2 号炉の共用設備。管理番号は設備台帳の機器番号と同じ。").font = f
    ws.cell(r + 1, 1, "※ 全休止（タービン・電気・計装）は炉の全停止期間に合わせて実施。").font = f
    ws.freeze_panes = "E8"
    ws.page_setup.orientation = "landscape"
    save_wb(wb, FILES / rel)
    add_file({"file": rel, "format": "xlsx", "kind": "star",
              "note": "機器 1 行で、年度を上期・下期の 2 列に分けた星取表。記号は作業の種類（点・整・精・取・更）で、（ ）付きが予定、記号だけが実施済。まとまりは塗りつぶしの見出し行で、号炉と管理番号は別の列。"})


# ---------------------------------------------------------------- 3a. 保全システムの書き出し（UTF-8, カンマ）
BUNDLE_LABELS = {"排ガス処理設備の点検", "全休止の電気・計装の点検"}
KUBUN = {"整": "整備", "点": "点検", "精": "検査", "取": "取替", "更": "更新"}


def make_wo_export():
    rel = "daily/hozen-system_WO-export_2022-2026.csv"
    sel = [w for w in W["works"]
           if d(w["start"]) >= dt.date(2022, 4, 1) and d(w["start"]) <= dt.date(2027, 3, 31)]
    # 束ね: 同じ label・同じ start・同じ furnace の 排ガス／電気計装
    groups = defaultdict(list)
    singles = []
    for w in sel:
        if w["label"] in BUNDLE_LABELS:
            e = EQ[w["equipment_id"]]
            groups[(w["label"], w["start"], e["furnace"])].append(w)
        else:
            singles.append([w])
    recs = singles + list(groups.values())
    recs.sort(key=lambda ws_: (ws_[0]["start"], min(EQ[w["equipment_id"]]["id"] for w in ws_)))

    rng = random.Random(SEED)
    lines = []
    lines.append(["【架空】みどり台クリーンセンター 保全管理システム 作業指示（WO）一覧 書き出し"])
    lines.append(["出力日時", "2026/10/01 09:15", "抽出条件", "着手日 2022/04/01～2027/03/31、状態＝完了・計画中", "工数の単位", "時間（h:mm）"])
    header = ["WO番号", "状態", "設備コード", "設備名称", "作業件名", "作業区分", "着手日", "完了日",
              "工期(日)", "予定工数", "実績工数", "施工", "備考"]
    lines.append(header)
    meta = []  # (line index, works)
    seq = defaultdict(int)
    for ws_ in recs:
        w0 = ws_[0]
        e0 = EQ[w0["equipment_id"]]
        fy = w0["fiscal_year"]
        seq[fy] += rng.randint(1, 4)
        wo = f"WO-{fy}-{seq[fy]:04d}"
        if len(ws_) > 1:
            if w0["label"] == "排ガス処理設備の点検":
                code = f"EGT-{e0['furnace']}"
                name = f"{e0['furnace']}号炉 排ガス処理設備一式（集じん装置・HCL、SOx 除去設備・NOx 除去設備）"
            else:
                code = "EIC-0"
                name = "電気・計装設備一式（受変電配電設備・発電機・DCS）"
        else:
            code = doc_tag(e0)
            name = furnace_prefix(e0) + e0["base_name"]
        md = sum(w["man_days"] for w in ws_)
        st = w0["status"]
        sym = SYM[w0["label"]]
        note = ""
        if w0["contractor"] is None:
            sekou = "直営"
        else:
            sekou = "委託"
        if w0["label"] == "DCS の更新（基幹改良）":
            note = "年度をまたぐ継続工事\n（R7.10.14 着手、R8.2.27 完了）"
        elif w0["label"] == "精密機能検査":
            note = "法定の精密機能検査\n（3 年ごと）"
        elif w0["label"] == "誘引通風機の取替":
            note = "R8年度予算、R9.2 施工予定"
        lines.append([
            wo, "完了" if st == "actual" else "計画中", code, name, w0["label"], KUBUN[sym],
            w0["start"].replace("-", "/"), w0["end"].replace("-", "/"), str(w0["duration_days"]),
            hm(md) if st == "planned" else "", hm(md) if st == "actual" else "", sekou, note,
        ])
        meta.append((len(lines) - 1, ws_))
    lines.append(["件数", str(len(recs))])

    buf = io.StringIO()
    wr = csv.writer(buf, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    phys = []  # 各記録の始まりの物理行
    cur = 1
    for i, rec in enumerate(lines):
        phys.append(cur)
        s = io.StringIO()
        csv.writer(s, lineterminator="\r\n").writerow(rec)
        txt = s.getvalue()
        cur += txt.count("\n")
        wr.writerow(rec)
    data = buf.getvalue()
    p = FILES / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data.encode("utf-8"))
    for li, ws_ in meta:
        w0 = ws_[0]
        truth["events"].append({
            "file": rel, "at": {"row": phys[li], "sheet": None}, "status": w0["status"],
            "fiscal_year": w0["fiscal_year"],
            "equipment_ids": sorted(w["equipment_id"] for w in ws_),
            "work_ids": [w["id"] for w in sorted(ws_, key=lambda w: w["equipment_id"])],
            "start": w0["start"], "end": w0["end"],
            "man_days": sum(w["man_days"] for w in ws_), "days": w0["duration_days"],
            "bundle": len(ws_) > 1,
        })
    add_file({"file": rel, "format": "csv", "kind": "daily", "encoding": "utf-8", "delimiter": ",",
              "note": "保全管理システムの WO 一覧の書き出し（UTF-8、BOM 無し、カンマ）。1 行 1 WO で、排ガス処理と電気・計装は「一式」に束ねた行。工数は h:mm の時間で、予定と実績の列が分かれ、備考には囲みの中の改行がある。"})


# ---------------------------------------------------------------- 3b. 作業日報の集計（cp932, タブ）
HANKANA = {
    "ストーカ": "ｽﾄｰｶ", "焼却炉本体": "焼却炉本体", "ボイラ": "ﾎﾞｲﾗ", "集じん装置": "集じん装置",
    "HCL、SOx 除去設備": "HCL･SOx除去設備", "NOx 除去設備": "NOx除去設備", "ごみクレーン": "ｺﾞﾐｸﾚｰﾝ",
    "灰クレーン": "灰ｸﾚｰﾝ", "可燃性粗大ごみ切断機": "可燃性粗大ごみ切断機",
}
WORKTXT = {
    "定期整備（分解）": "定期整備(分解)", "排ガス処理設備の点検": "排ｶﾞｽ処理設備点検",
    "ごみクレーンの年次点検": "年次点検", "灰クレーンの年次点検": "年次点検",
    "切断機の点検": "点検", "精密機能検査": "精密機能検査",
}


def make_nippo():
    rel = "daily/sagyo-nippo-shukei_R8-kamiki.csv"
    sel = [w for w in W["works"] if w["fiscal_year"] == 2026 and w["status"] == "actual"]
    rows = []
    for w in sel:
        s, e_ = d(w["start"]), d(w["end"])
        n = (e_ - s).days + 1
        assert n == w["duration_days"]
        per = w["man_days"] / n
        assert per == w["crew"]
        for k in range(n):
            day = s + dt.timedelta(days=k)
            rows.append((day, EQ[w["equipment_id"]]["id"], w, per))
    rows.sort(key=lambda t: (t[0], t[1]))
    out = []
    out.append(["【架空】みどり台クリーンセンター　作業日報 集計表（令和8年度 上期・委託分）"])
    out.append(["受託者", "【架空】みどり保全", "", "工数は人工（1人工＝8時間）"])
    out.append([])
    out.append(["日付", "曜", "炉", "機器", "作業内容", "人員(名)", "工数(人工)", "備考"])
    meta = []
    cur_month = None
    month_sum = 0.0
    total = 0.0

    def flush():
        out.append([f"{cur_month}月計", "", "", "", "", "", f"{month_sum:.1f}", ""])

    for day, eid, w, per in rows:
        if cur_month is not None and day.month != cur_month:
            flush()
            month_sum = 0.0
        cur_month = day.month
        e = EQ[eid]
        out.append([wareki(day), wday(day), str(e["furnace"]) if e["furnace"] else "-",
                    HANKANA[e["base_name"]], WORKTXT[w["label"]], str(w["crew"]), f"{per:.1f}", ""])
        meta.append((len(out), day, w, per))
        month_sum += per
        total += per
    flush()
    out.append(["上期累計", "", "", "", "", "", f"{total:.1f}", ""])
    txt = "".join("\t".join(r) + "\r\n" for r in out)
    p = FILES / rel
    p.write_bytes(txt.encode("cp932"))
    for ln, day, w, per in meta:
        truth["events"].append({
            "file": rel, "at": {"row": ln, "sheet": None}, "status": "actual", "fiscal_year": w["fiscal_year"],
            "equipment_ids": [w["equipment_id"]], "work_ids": [w["id"]],
            "start": day.isoformat(), "end": day.isoformat(), "man_days": int(per) if float(per).is_integer() else per, "days": None, "bundle": False,
        })
    add_file({"file": rel, "format": "csv", "kind": "daily", "encoding": "cp932", "delimiter": "\t",
              "note": "委託先の作業日報を月ごとに集計した表（Shift_JIS、タブ）。1 行が 1 日 × 1 機器で、日付は R8.4.6 の和暦、曜は別の列、機器名は半角カナまじり。工数は人工の小数で、月計と上期累計の行がある。"})


# ---------------------------------------------------------------- 4. 報告書（xlsx → PDF）
def soffice_pdf(xlsx, outdir):
    TMP.mkdir(parents=True, exist_ok=True)
    tmpo = TMP / "pdfout"
    tmpo.mkdir(exist_ok=True)
    subprocess.run([SOFFICE, "-env:UserInstallation=file:///C:/tmp/moyai-heldout-2-tmp/lo", "--headless",
                    "--convert-to", "pdf", "--outdir", str(tmpo), str(xlsx)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
    pdf = tmpo / (xlsx.stem + ".pdf")
    dst = outdir / pdf.name
    data = pdf.read_bytes()
    # 作成日時と /ID を固定する（長さは変えないので xref はそのまま）
    data = re.sub(rb"/CreationDate\(D:\d{14}\+09'00'\)", b"/CreationDate(D:20261001090000+09'00')", data)
    data = re.sub(rb"/ModDate\(D:\d{14}\+09'00'\)", b"/ModDate(D:20261001090000+09'00')", data)
    data = re.sub(rb"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00", b"2026-10-01T09:00:00+09:00", data)
    data = re.sub(rb"/DocChecksum\s*/[0-9A-Fa-f]{32}", b"/DocChecksum /" + b"0" * 32, data)
    fixed_id = format(sum(xlsx.name.encode()) * 2654435761 % (1 << 128), "032X").encode()
    data = re.sub(rb"(/ID\s*\[\s*)<[0-9A-Fa-f]{32}>(\s*)<[0-9A-Fa-f]{32}>",
                  lambda m: m.group(1) + b"<" + fixed_id + b">" + m.group(2) + b"<" + fixed_id + b">", data)
    dst.write_bytes(data)
    return dst


def page_setup(ws, landscape=True):
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.page_margins.left = ws.page_margins.right = 0.5
    ws.page_margins.top = ws.page_margins.bottom = 0.6


def make_report_kanryo():
    rel_x = "reports/kanryo-hokoku_R5_1go-zenkyushi.xlsx"
    rel = "reports/kanryo-hokoku_R5_1go-zenkyushi.pdf"
    sel = [w for w in W["works"] if w["fiscal_year"] == 2023 and "2023-08-31" <= w["start"] <= "2023-09-14"]
    wb = new_wb()
    ws = wb.active
    ws.title = "完了報告"
    f = Font(name=FONT, size=10)
    fb = Font(name=FONT, size=10, bold=True)
    border = thin()
    widths = [6, 34, 30, 22, 8, 10, 30]
    for i, wd in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = wd
    ws["G1"] = "令和5年10月6日"
    ws["G1"].alignment = Alignment(horizontal="right")
    ws["A2"] = "【架空】みどり台クリーンセンター　所長　様"
    ws["G3"] = "受託者　【架空】みどり保全　現場代理人"
    ws["G3"].alignment = Alignment(horizontal="right")
    ws["A5"] = "【架空】令和5年度 焼却施設定期整備業務（1号炉・全休止）完了報告書"
    ws.merge_cells("A5:G5")
    ws["A5"].font = Font(name=FONT, size=14, bold=True)
    ws["A5"].alignment = Alignment(horizontal="center")
    ws["A7"] = "標記業務について、下記のとおり完了しましたので報告いたします。"
    ws["A9"] = "記"
    ws.merge_cells("A9:G9")
    ws["A9"].alignment = Alignment(horizontal="center")
    ws["A10"] = "1.　業 務 名　　令和5年度 焼却施設定期整備業務（1号炉定期整備及び全休止整備）"
    ws["A11"] = "2.　履行期間　　令和5年8月31日 から 令和5年9月27日 まで"
    ws["A12"] = "3.　実施内容　　下表のとおり（延人員は 1 人 1 日 8 時間で換算）"
    for r in range(1, 13):
        for c in range(1, 8):
            if ws.cell(r, c).font != Font(name=FONT, size=14, bold=True):
                ws.cell(r, c).font = f
    ws["A5"].font = Font(name=FONT, size=14, bold=True)
    hdr = ["No.", "設備／機器〔番号〕", "作業内容", "実施期間", "日数", "延人員(人)", "備　考"]
    r = 14
    for i, h in enumerate(hdr, 1):
        c = ws.cell(r, i, h)
        c.font = fb
        c.border = border
        c.fill = PatternFill("solid", fgColor="D9D9D9")
        c.alignment = Alignment(horizontal="center")
    r += 1
    no = 1
    total = 0
    order = [s for s in SYSTEMS if any(EQ[w["equipment_id"]]["system"] == s for w in sel)]
    for sysname in order:
        ws.cell(r, 2, f"〈{sysname}〉").font = fb
        for c in range(1, 8):
            ws.cell(r, c).border = border
        r += 1
        sub = 0
        for w in sorted([w for w in sel if EQ[w["equipment_id"]]["system"] == sysname], key=lambda w: (w["start"], w["equipment_id"])):
            e = EQ[w["equipment_id"]]
            name = f"{furnace_prefix(e)}{e['base_name']}〔{doc_tag(e)}〕"
            s, en = d(w["start"]), d(w["end"])
            period = f"{wareki(s)}～{wareki(en)}"
            vals = [str(no), name, w["label"], period, w["duration_days"], w["man_days"], ""]
            if w["label"].startswith("全休止"):
                vals[6] = "全休止期間に実施"
            for i, v in enumerate(vals, 1):
                c = ws.cell(r, i, v)
                c.font = f
                c.border = border
                if i in (1, 5, 6):
                    c.alignment = Alignment(horizontal="center")
            truth["events"].append({
                "file": rel, "at": {"texts": [str(no), name, period]}, "status": w["status"],
                "fiscal_year": w["fiscal_year"], "equipment_ids": [w["equipment_id"]], "work_ids": [w["id"]],
                "start": w["start"], "end": w["end"], "man_days": w["man_days"], "days": w["duration_days"],
                "bundle": False,
            })
            sub += w["man_days"]
            no += 1
            r += 1
        ws.cell(r, 3, "小　計").font = fb
        ws.cell(r, 6, sub).font = fb
        ws.cell(r, 6).alignment = Alignment(horizontal="center")
        for c in range(1, 8):
            ws.cell(r, c).border = border
        total += sub
        r += 1
    ws.cell(r, 3, "合　計").font = fb
    ws.cell(r, 6, total).font = fb
    ws.cell(r, 6).alignment = Alignment(horizontal="center")
    for c in range(1, 8):
        ws.cell(r, c).border = border
    r += 2
    ws.cell(r, 1, "添付：作業写真帳、点検記録表、試運転記録（別冊）").font = f
    ws.cell(r + 1, 7, "以上").font = f
    ws.cell(r + 1, 7).alignment = Alignment(horizontal="right")
    page_setup(ws, landscape=False)
    ws.print_area = f"A1:G{r + 1}"
    save_wb(wb, FILES / rel_x)
    soffice_pdf(FILES / rel_x, (FILES / rel).parent)
    add_file({"file": rel, "format": "pdf", "kind": "report", "source_xlsx": rel_x,
              "note": "受託者から所長あての「記」書きの完了報告書（縦の A4）。表は設備の見出し行の下に機器の行を並べ、小計と合計の行がある。実施期間は R5.8.31～R5.9.11 の和暦の 1 セル、工数は延人員(人)。"})


def make_report_keikaku():
    rel_x = "reports/sekou-keikaku_R8_2go-teiki.xlsx"
    rel = "reports/sekou-keikaku_R8_2go-teiki.pdf"
    sel = [w for w in W["works"] if w["fiscal_year"] == 2026 and w["start"] == "2026-10-05"]
    s0, e0 = d("2026-10-05"), d("2026-10-16")
    days = [(s0 + dt.timedelta(days=k)) for k in range((e0 - s0).days + 1)]
    wb = new_wb()
    ws = wb.active
    ws.title = "実施工程表"
    f = Font(name=FONT, size=10)
    fb = Font(name=FONT, size=10, bold=True)
    border = thin()
    base = ["No.", "工種", "機器名称〔番号〕", "作業内容", "人員\n(人/日)", "日数", "延人員\n(人)"]
    widths = [5, 18, 30, 22, 8, 6, 8]
    for i, wd in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = wd
    dc0 = len(base) + 1
    for k in range(len(days)):
        ws.column_dimensions[get_column_letter(dc0 + k)].width = 4.2
    remc = dc0 + len(days)
    ws.column_dimensions[get_column_letter(remc)].width = 16
    ws["A1"] = "【架空】令和8年度 2号炉定期整備工事　実施工程表（予定）"
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=remc)
    ws["A1"].font = Font(name=FONT, size=14, bold=True)
    ws["A1"].alignment = Alignment(horizontal="center")
    ws["A3"] = "工事場所：【架空】みどり台クリーンセンター 2号炉系"
    ws["A4"] = "予定工期：令和8年10月5日（月）～ 令和8年10月16日（金）　12日間（炉停止期間中は土日も作業）"
    ws["A5"] = "施　　工：【架空】みどり保全"
    ws.cell(3, remc - 3, "提出日 R8.9.18")
    for r in (3, 4, 5):
        for c in range(1, remc + 1):
            ws.cell(r, c).font = f
    hr = 7
    for i, h in enumerate(base, 1):
        ws.cell(hr, i, h)
        ws.merge_cells(start_row=hr, start_column=i, end_row=hr + 1, end_column=i)
    ws.cell(hr, dc0, "令和8年10月")
    ws.merge_cells(start_row=hr, start_column=dc0, end_row=hr, end_column=remc - 1)
    for k, day in enumerate(days):
        ws.cell(hr + 1, dc0 + k, f"{day.day}\n{wday(day)}")
    ws.cell(hr, remc, "備考")
    ws.merge_cells(start_row=hr, start_column=remc, end_row=hr + 1, end_column=remc)
    for r in (hr, hr + 1):
        ws.row_dimensions[r].height = 26
        for c in range(1, remc + 1):
            cell = ws.cell(r, c)
            cell.font = fb
            cell.border = border
            cell.fill = PatternFill("solid", fgColor="D9D9D9")
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    bar = PatternFill("solid", fgColor="4F81BD")
    r = hr + 2
    total = 0
    for no, w in enumerate(sorted(sel, key=lambda w: w["equipment_id"]), 1):
        e = EQ[w["equipment_id"]]
        name = f"{furnace_prefix(e)}{e['base_name']}〔{doc_tag(e)}〕"
        vals = [str(no), e["system"], name, w["label"], w["crew"], w["duration_days"], w["man_days"]]
        for i, v in enumerate(vals, 1):
            c = ws.cell(r, i, v)
            c.font = f
            c.border = border
            if i in (1, 5, 6, 7):
                c.alignment = Alignment(horizontal="center")
        for k, day in enumerate(days):
            c = ws.cell(r, dc0 + k)
            c.border = border
            if d(w["start"]) <= day <= d(w["end"]):
                c.fill = bar
        ws.cell(r, remc).border = border
        truth["events"].append({
            "file": rel, "at": {"texts": [str(no), name, w["label"]]}, "status": w["status"],
            "fiscal_year": w["fiscal_year"], "equipment_ids": [w["equipment_id"]], "work_ids": [w["id"]],
            "start": w["start"], "end": w["end"], "man_days": w["man_days"], "days": w["duration_days"],
            "bundle": False,
        })
        total += w["man_days"]
        r += 1
    ws.cell(r, 4, "延人員 計").font = fb
    ws.cell(r, 7, total).font = fb
    ws.cell(r, 7).alignment = Alignment(horizontal="center")
    for c in range(1, remc + 1):
        ws.cell(r, c).border = border
    r += 2
    ws.cell(r, 1, "凡例：塗りつぶしの帯＝作業予定日。人員は 1 日あたりの配置予定、延人員＝人員×日数（1 人 1 日 8 時間）。").font = f
    ws.cell(r + 1, 1, "※ 誘引通風機（1号炉）の取替は本工程に含まない（R9.2 別途施工予定）。").font = f
    page_setup(ws, landscape=True)
    ws.print_area = f"A1:{get_column_letter(remc)}{r + 1}"
    save_wb(wb, FILES / rel_x)
    soffice_pdf(FILES / rel_x, (FILES / rel).parent)
    add_file({"file": rel, "format": "pdf", "kind": "report", "source_xlsx": rel_x,
              "note": "定期整備工事の着手前に出す実施工程表（横の A4、予定）。左に工種・機器・作業・人員・日数・延人員、右に日ごとの列を塗った帯（文字無し）のガント図。年は頭書きにだけあり、表の中の日付は日と曜だけ。"})
    return rel


# ---------------------------------------------------------------- 5. 写真
def make_photo(pdf_rel):
    import pypdfium2 as pdfium
    from PIL import Image, ImageDraw, ImageFilter

    rng = random.Random(SEED + 5)
    rel = "photos/IMG_20261003_0841.jpg"
    pdf = pdfium.PdfDocument(str(FILES / pdf_rel))
    page = pdf[0]
    scale = 2.2
    pil = page.render(scale=scale).to_pil().convert("RGB")
    tp = page.get_textpage()
    ph = page.get_height()
    # 手書きの赤いチェック：機器の行の左
    draw = ImageDraw.Draw(pil)
    marks = []
    for key in ("STK-2", "FNC-2", "BLR-2", "BGF-2", "DSC-2", "NXR-2"):
        se = tp.search(key)
        res = se.get_next()
        if res is None:
            continue
        idx, cnt = res
        box = tp.get_charbox(idx)
        x = box[0] * scale
        y = (ph - box[3]) * scale
        marks.append((x, y))
    for (x, y) in marks:
        x0 = 40 + rng.uniform(-4, 4)
        y0 = y + rng.uniform(-3, 3)
        pts = [(x0, y0 + 10), (x0 + 8, y0 + 20), (x0 + 26, y0 - 6)]
        draw.line(pts, fill=(200, 30, 40), width=4, joint="curve")
    # 余白に赤丸（確認印のつもり、文字なし）
    W_, H_ = pil.size
    cx, cy = W_ - 170, 120
    for k in range(3):
        rr = 52 + k
        draw.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(205, 40, 50), width=3)
    draw.line([(cx - 30, cy), (cx + 30, cy)], fill=(205, 40, 50), width=3)
    # 紙を少し黄ばませる
    paper = Image.new("RGB", pil.size, (246, 242, 230))
    pil = Image.blend(pil, paper, 0.12)
    # 背景（灰色の作業台）とクリップボード
    BW, BH = 2600, 2000
    bg = Image.new("RGB", (BW, BH), (92, 96, 100))
    nd = ImageDraw.Draw(bg)
    for _ in range(9000):
        x, y = rng.randrange(BW), rng.randrange(BH)
        v = rng.randint(-14, 14)
        nd.point((x, y), fill=(92 + v, 96 + v, 100 + v))
    board = Image.new("RGBA", (W_ + 120, H_ + 220), (120, 82, 48, 255))
    bd = ImageDraw.Draw(board)
    bd.rectangle([0, 0, board.size[0] - 1, board.size[1] - 1], outline=(80, 52, 30, 255), width=6)
    board.paste(pil, (60, 160))
    # 金属のクリップ
    clipw = 420
    bd.rounded_rectangle([board.size[0] // 2 - clipw // 2, 60, board.size[0] // 2 + clipw // 2, 200], radius=24,
                         fill=(175, 178, 182, 255), outline=(110, 112, 116, 255), width=5)
    board = board.rotate(-3.2, resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0, 0))
    # 影
    shadow = Image.new("RGBA", board.size, (0, 0, 0, 0))
    alpha = board.split()[3].point(lambda a: 120 if a > 0 else 0)
    shadow.putalpha(alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    ox = (BW - board.size[0]) // 2
    oy = (BH - board.size[1]) // 2
    bg = bg.convert("RGBA")
    bg.alpha_composite(shadow, (ox + 26, oy + 30))
    bg.alpha_composite(board, (ox, oy))
    img = bg.convert("RGB")
    # 弱い台形（真上より少し手前から）
    w0, h0 = img.size
    dx = int(w0 * 0.035)
    coeffs = _persp_coeffs([(0, 0), (w0, 0), (w0, h0), (0, h0)],
                           [(-dx, 0), (w0 + dx, 0), (w0 - dx * 0, h0), (0, h0)])
    img = img.transform((w0, h0), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(92, 96, 100))
    # 照明のむら（左上が明るい）と、右下に手の影
    grad = Image.new("L", img.size)
    gd = ImageDraw.Draw(grad)
    for i in range(0, max(img.size), 8):
        v = int(255 - 70 * i / max(img.size))
        gd.line([(i, 0), (0, i)], fill=v, width=10)
    grad = grad.filter(ImageFilter.GaussianBlur(40))
    dark = Image.new("RGB", img.size, (20, 20, 25))
    img = Image.composite(img, dark, grad.point(lambda v: max(150, v)))
    hand = Image.new("L", img.size, 0)
    hd = ImageDraw.Draw(hand)
    hd.ellipse([int(w0 * 0.72), int(h0 * 0.78), int(w0 * 1.15), int(h0 * 1.25)], fill=110)
    hand = hand.filter(ImageFilter.GaussianBlur(70))
    img = Image.composite(dark, img, hand)
    img = img.filter(ImageFilter.GaussianBlur(1.1))
    img = img.resize((int(w0 * 0.62), int(h0 * 0.62)), Image.LANCZOS)
    p = FILES / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    img.save(p, "JPEG", quality=78, optimize=False)
    add_file({"file": rel, "format": "jpg", "kind": "photo", "photo_of": {"file": pdf_rel, "page": 1},
              "note": "実施工程表（予定）の 1 頁をクリップボードに挟み、ほぼ真上から少し傾けて撮った写真。赤ペンのチェックと丸印の書き込み、照明のむら、手の影、軽いぼけがある。"})


def _solve(a, b):
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                k = m[r][c] / m[c][c]
                for j in range(c, n + 1):
                    m[r][j] -= k * m[c][j]
    return [m[i][n] / m[i][i] for i in range(n)]


def _persp_coeffs(src, dst):
    """PIL の PERSPECTIVE 用の係数（出力の点 dst → 入力の点 src）。"""
    a, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        # 出力 (u,v) から入力 (x,y) を求める式
        a.append([u, v, 1, 0, 0, 0, -x * u, -x * v])
        b.append(x)
        a.append([0, 0, 0, u, v, 1, -y * u, -y * v])
        b.append(y)
    return _solve(a, b)


# ---------------------------------------------------------------- main
def main():
    random.seed(SEED)
    if FILES.exists():
        shutil.rmtree(FILES)
    FILES.mkdir()
    make_ledger()
    make_star()
    make_wo_export()
    make_nippo()
    make_report_kanryo()
    pdf_rel = make_report_keikaku()
    make_photo(pdf_rel)
    (ROOT / "truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("files:", len(truth["files"]), "assets:", len(truth["assets"]), "marks:", len(truth["marks"]),
          "events:", len(truth["events"]))


if __name__ == "__main__":
    main()
