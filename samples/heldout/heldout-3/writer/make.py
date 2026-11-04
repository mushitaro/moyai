# -*- coding: utf-8 -*-
"""heldout-3 の資料と truth.json を書く。もう一度走らせても同じ中身を書く（種と「今日」を固定）。

走らせ方: python -I -X utf8 writer/make.py
"""
import csv
import io
import json
import random
import re
import shutil
import subprocess
import sys
import zipfile
from collections import OrderedDict, defaultdict
from datetime import date

sys.dont_write_bytecode = True
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from common import (ROOT, FILES, TMP, TODAY, SEED, SYSTEM_ORDER, load_world, d, days_of,
                    wareki_long, fy_label, short_h, tag_of, col_letter)

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

SOFFICE = r"C:\Program Files\LibreOffice\program\soffice.exe"
LO_PROFILE = "file:///C:/tmp/moyai-heldout-3-tmp/lo"
FONT = "MS Gothic"
CREATOR = "【架空】みどり台クリーンセンター 施設管理係"

W = load_world()
EQ = {e["id"]: e for e in W["equipment"]}
WORKS = W["works"]
TRUTH = OrderedDict(schema="moyai.heldout.truth/0", set="heldout-3", world="world.json",
                    files=[], assets=[], marks=[], events=[])

thin = Side(style="thin", color="000000")
hair = Side(style="hair", color="000000")
med = Side(style="medium", color="000000")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)


def f(size=10, bold=False, strike=False, color="000000"):
    return Font(name=FONT, size=size, bold=bold, strike=strike, color=color)


def new_wb(title):
    wb = Workbook()
    wb.properties.creator = CREATOR
    wb.properties.title = title
    wb.properties.lastModifiedBy = CREATOR
    return wb


def fix_xlsx(path):
    """zip の時刻と core.xml の日時を固定して、同じバイトを書く。"""
    stamp = "2026-10-01T00:00:00Z"
    with zipfile.ZipFile(path) as z:
        items = [(i.filename, z.read(i.filename)) for i in z.infolist()]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in items:
            if name == "docProps/core.xml":
                t = data.decode("utf-8")
                t = re.sub(r"(<dcterms:created[^>]*>)[^<]*(</dcterms:created>)", r"\g<1>" + stamp + r"\2", t)
                t = re.sub(r"(<dcterms:modified[^>]*>)[^<]*(</dcterms:modified>)", r"\g<1>" + stamp + r"\2", t)
                data = t.encode("utf-8")
            zi = zipfile.ZipInfo(name, date_time=(2026, 10, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
    path.write_bytes(buf.getvalue())


def save(wb, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    fix_xlsx(path)


def rel(p):
    return p.relative_to(FILES).as_posix()


# ---------------------------------------------------------------- 機器台帳
def make_ledger():
    path = FILES / "ledger" / "kiki-daicho_R8.xlsx"
    wb = new_wb("【架空】機器台帳")
    cov = wb.active
    cov.title = "表紙"
    cov["A1"] = "【架空】機器台帳"
    cov["A1"].font = f(18, True)
    cov["A3"] = "施設名"
    cov["B3"] = "【架空】みどり台クリーンセンター"
    cov["A4"] = "炉形式"
    cov["B4"] = "ストーカ式焼却炉　2炉"
    cov["A5"] = "管理者"
    cov["B5"] = "施設管理係"
    cov["A7"] = "記入の決まり"
    cov["A8"] = "・設備ごとに 1 シート（整理番号の順）。"
    cov["A9"] = "・区分：「機」＝機器、「部」＝その上の機器の部位。"
    cov["A10"] = "・機器番号：先頭の数字は号炉（0＝共通）。"
    cov["A11"] = "・設置年は和暦の略号（H＝平成）。部位は機器と同じ。"
    cov["A12"] = "・取消線の行は撤去済み（記録として残す）。"
    cov["A14"] = "改訂"
    cov["B14"] = "内容"
    cov["A15"] = "R4.1"
    cov["B15"] = "2号炉 押込送風機の電動機を取り替えたため修正"
    cov["A16"] = "R8.3"
    cov["B16"] = "計装設備の更新（基幹改良）が終わったため確認"
    for r in range(3, 17):
        cov.cell(r, 1).font = f(10, r in (7, 14))
        cov.cell(r, 2).font = f()
    cov.column_dimensions["A"].width = 12
    cov.column_dimensions["B"].width = 60

    by_sys = OrderedDict((s, []) for s in SYSTEM_ORDER)
    for e in W["equipment"]:
        by_sys[e["system"]].append(e)
    sys_short = {"受入供給設備": "受入供給", "燃焼設備": "燃焼", "燃焼ガス冷却設備": "ガス冷却",
                 "排ガス処理設備": "排ガス処理", "通風設備": "通風", "余熱利用設備": "余熱利用",
                 "灰出し設備": "灰出し", "電気設備": "電気", "計装設備": "計装"}
    fill_h = PatternFill("solid", fgColor="D9E1F2")
    for no, (sysname, eqs) in enumerate(by_sys.items(), start=1):
        sn = f"{no:02d}{sys_short[sysname]}"
        ws = wb.create_sheet(sn)
        ws["A1"] = "【架空】機器台帳"
        ws.merge_cells("A1:H1")
        ws["A1"].font = f(14, True)
        ws["A1"].alignment = Alignment(horizontal="center")
        ws["A2"] = "施設名"
        ws["B2"] = "【架空】みどり台クリーンセンター"
        ws.merge_cells("B2:E2")
        ws["G2"] = "整理番号"
        ws["H2"] = f"{no:02d}"
        ws["A3"] = "設備名"
        ws["B3"] = sysname
        ws.merge_cells("B3:E3")
        ws["G3"] = "作成"
        ws["H3"] = "R8.3.31"
        for c in ("A2", "A3", "G2", "G3"):
            ws[c].font = f(10, True)
            ws[c].fill = fill_h
        for c in ("B2", "B3", "H2", "H3"):
            ws[c].font = f(11, c == "B3")
        group_cell = {"cell": "B3", "sheet": sn}
        TRUTH["assets"].append(OrderedDict(
            file=rel(path), at=group_cell, kind="group", level=1, parent=None, equipment_id=None,
            path=[sysname], name_text=sysname, name=sysname, tag=None, install_year=None, spec_texts=[]))
        heads = ["区分", "号炉", "機器名称", "機器番号", "仕様（1）", "仕様（2）", "設置年", "備考"]
        for i, h in enumerate(heads, start=1):
            c = ws.cell(5, i, h)
            c.font = f(10, True)
            c.fill = fill_h
            c.border = BOX
            c.alignment = Alignment(horizontal="center", vertical="center")
        r = 6
        for e in eqs:
            name_text = e["base_name"]
            if e["id"] == "E25":
                name_text = "ＤＣＳ"
            vals = ["機", e["furnace_label"], name_text, tag_of(e), e["spec"][0], e["spec"][1],
                    short_h(e["install_year"]), ""]
            for i, v in enumerate(vals, start=1):
                c = ws.cell(r, i, v)
                c.font = f()
                c.border = BOX
            eq_cell = {"cell": f"C{r}", "sheet": sn}
            TRUTH["assets"].append(OrderedDict(
                file=rel(path), at=eq_cell, kind="equipment", level=2, parent=group_cell,
                equipment_id=e["id"], name_text=name_text, name=e["base_name"], tag=tag_of(e),
                install_year=e["install_year"], spec_texts=list(e["spec"])))
            r += 1
            for p in e["parts"]:
                removed = "remark" in p
                sp = list(p["spec"])
                vals = ["部", "", p["name"], "", sp[0], sp[1] if len(sp) > 1 else "", "",
                        p.get("remark", "")]
                for i, v in enumerate(vals, start=1):
                    c = ws.cell(r, i, v if v != "" else None)
                    c.font = f(strike=removed and i <= 7)
                    c.border = BOX
                ws.cell(r, 3).alignment = Alignment(indent=0)
                specs = [sp[0]] + ([sp[1]] if len(sp) > 1 else [])
                if removed:
                    specs = specs + [p["remark"]]
                TRUTH["assets"].append(OrderedDict(
                    file=rel(path), at={"cell": f"C{r}", "sheet": sn}, kind="part", level=3,
                    parent=eq_cell, equipment_id=e["id"], name_text=p["name"], name=p["name"],
                    tag=None, install_year=None, spec_texts=specs))
                r += 1
        ws.cell(r + 1, 1, "※ 区分・機器番号・設置年の書き方は表紙のとおり。").font = f(9)
        widths = [6, 8, 24, 10, 24, 26, 8, 30]
        for i, wdt in enumerate(widths, start=1):
            ws.column_dimensions[col_letter(i)].width = wdt
        ws.freeze_panes = "A6"
    save(wb, path)
    TRUTH["files"].append(OrderedDict(
        file=rel(path), format="xlsx", kind="ledger",
        note="表紙と、設備ごとに 1 シート（9 シート）の分冊の台帳。設備名はシートの頭の欄に 1 回だけ書き、"
             "行の「区分」の列（機＝機器／部＝部位）で段を表す。号炉は別の列、機器番号は「号炉-記号」（0＝共通）、"
             "設置年は「H14」の略号。撤去した部位は取消線の行で残す。"))


# ---------------------------------------------------------------- 星取表
ITEM_OF = {
    "定期整備（分解）": "定期整備（分解）",
    "排ガス処理設備の点検": "定期点検",
    "通風機の分解整備": "分解整備",
    "ごみクレーンの年次点検": "年次点検",
    "灰クレーンの年次点検": "年次点検",
    "精密機能検査": "精密機能検査",
    "計量機の定期検査": "定期検査",
    "切断機の点検": "定期点検",
    "全休止のタービン系の分解整備": "分解整備（全休止時）",
    "全休止の電気・計装の点検": "定期点検（全休止時）",
    "押込送風機の電動機取替": "電動機取替",
    "DCS の更新（基幹改良）": "更新（基幹改良）",
    "誘引通風機の取替": "本体取替",
}


def make_star():
    path = FILES / "star" / "choki-hozen-keikaku_hoshitori.xlsx"
    wb = new_wb("【架空】長期保全計画表（星取表）")
    years = W["fiscal_years"]
    YC = 7  # G 列 = 2019
    sheets = [("1号炉", lambda e: e["furnace"] == 1, "1号炉系"),
              ("2号炉", lambda e: e["furnace"] == 2, "2号炉系"),
              ("共通", lambda e: e["furnace"] is None, "共通系")]
    fill_h = PatternFill("solid", fgColor="E2EFDA")
    fill_now = PatternFill("solid", fgColor="FFF2CC")
    first = True
    for sn, pred, label in sheets:
        ws = wb.active if first else wb.create_sheet(sn)
        ws.title = sn
        first = False
        ws["A1"] = f"【架空】みどり台クリーンセンター　長期保全計画表（星取表）　{label}"
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=YC + len(years))
        ws["A1"].font = f(14, True)
        ws["A2"] = "凡例　▲：実施済　△：計画　（令和8年9月末現在。2026年度は黄色の列）"
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=YC + len(years))
        ws["A2"].font = f(10)
        heads = ["No.", "設備区分", "機器名称", "機器番号", "作業項目", "受注"]
        for i, h in enumerate(heads, start=1):
            ws.cell(3, i, h)
            ws.merge_cells(start_row=3, start_column=i, end_row=4, end_column=i)
        ws.cell(3, YC, "年　　度")
        ws.merge_cells(start_row=3, start_column=YC, end_row=3, end_column=YC + len(years) - 1)
        bc = YC + len(years)
        ws.cell(3, bc, "備考")
        ws.merge_cells(start_row=3, start_column=bc, end_row=4, end_column=bc)
        for j, y in enumerate(years):
            ws.cell(4, YC + j, y)
        for rr in (3, 4):
            for cc in range(1, bc + 1):
                c = ws.cell(rr, cc)
                c.font = f(10, True)
                c.fill = fill_h
                c.border = BOX
                c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        eqs = [e for e in W["equipment"] if pred(e)]
        eqs.sort(key=lambda e: (SYSTEM_ORDER.index(e["system"]), W["equipment"].index(e)))
        r = 5
        no = 0
        last_sys = None
        group_cell = None
        for e in eqs:
            ws_works = [w for w in WORKS if w["equipment_id"] == e["id"]]
            items = []
            for w in ws_works:
                it = ITEM_OF[w["label"]]
                if it not in items:
                    items.append(it)
            if not items:
                items = ["定期点検"]
            eq_cell = None
            for k, it in enumerate(items):
                no += 1
                ws.cell(r, 1, no)
                if e["system"] != last_sys:
                    ws.cell(r, 2, e["system"])
                    group_cell = {"cell": f"B{r}", "sheet": sn}
                    TRUTH["assets"].append(OrderedDict(
                        file=rel(path), at=group_cell, kind="group", level=1, parent=None,
                        equipment_id=None, path=[e["system"]], name_text=e["system"],
                        name=e["system"], tag=None, install_year=None, spec_texts=[], measure=False))
                    last_sys = e["system"]
                if k == 0:
                    ws.cell(r, 3, e["base_name"])
                    ws.cell(r, 4, tag_of(e))
                    eq_cell = {"cell": f"C{r}", "sheet": sn}
                    TRUTH["assets"].append(OrderedDict(
                        file=rel(path), at=eq_cell, kind="equipment", level=2, parent=group_cell,
                        equipment_id=e["id"], name_text=e["base_name"], name=e["base_name"],
                        tag=tag_of(e), install_year=None, spec_texts=[]))
                ws.cell(r, 5, it)
                its = [w for w in ws_works if ITEM_OF[w["label"]] == it]
                ws.cell(r, 6, "直営" if any(w["contractor"] is None for w in its) and
                        all(w["contractor"] is None for w in its) else "委託")
                seen = set()
                for w in its:
                    fy = w["fiscal_year"]
                    assert (fy,) not in seen, (e["id"], it, fy)
                    seen.add((fy,))
                    col = YC + years.index(fy)
                    sym = "▲" if w["status"] == "actual" else "△"
                    ws.cell(r, col, sym)
                    TRUTH["marks"].append(OrderedDict(
                        file=rel(path), at={"cell": f"{col_letter(col)}{r}", "sheet": sn},
                        fiscal_year=fy, status=w["status"], equipment_id=e["id"],
                        work_ids=[w["id"]], symbol=sym))
                note = ""
                if it == "電動機取替":
                    note = "R3.12 電動機取替（旧電動機は撤去）"
                elif it == "更新（基幹改良）":
                    note = "R7.10～R8.2"
                elif it == "本体取替":
                    note = "R9.2 予定"
                ws.cell(r, bc, note or None)
                for cc in range(1, bc + 1):
                    c = ws.cell(r, cc)
                    c.font = f(10)
                    c.border = BOX
                    if cc >= YC and cc < bc:
                        c.alignment = Alignment(horizontal="center")
                        if years[cc - YC] == 2026:
                            c.fill = fill_now
                r += 1
        ws.cell(r + 1, 1, "※ 年度は 4 月から翌年 3 月。設備区分・機器名称が空欄の行は、上の行と同じ。").font = f(9)
        widths = [5, 16, 20, 9, 20, 6] + [7] * len(years) + [28]
        for i, wdt in enumerate(widths, start=1):
            ws.column_dimensions[col_letter(i)].width = wdt
        ws.freeze_panes = ws.cell(5, YC)
    save(wb, path)
    TRUTH["files"].append(OrderedDict(
        file=rel(path), format="xlsx", kind="star",
        note="号炉ごとの 3 シート（1号炉・2号炉・共通）。行は機器 × 作業項目で、同じ機器の 2 行目からは設備区分と機器名称が空欄。"
             "年度は西暦の数だけの 1 段（上に「年度」の帯）、印は ▲ 実施済・△ 計画の 1 種類ずつ。"))


# ---------------------------------------------------------------- 作業日報（日ごと）
KUBUN = {"OVERHAUL": "整備", "INSPECT": "点検", "REPLACE": "取替", "UPGRADE": "更新"}


def furnace_short(e):
    return f"{e['furnace']}号" if e["furnace"] else "共通"


def make_daily_a():
    path = FILES / "daily" / "sagyo-nippo_2024-2026.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for w in WORKS:
        if w["status"] != "actual" or w["fiscal_year"] < 2024:
            continue
        for day in days_of(w):
            rows.append((day, W["equipment"].index(EQ[w["equipment_id"]]), w, day))
    rows.sort(key=lambda t: (t[0], t[1]))
    lines = [["【架空】作業日報データ（点検整備・委託作業）"],
             ["出力条件：作業日 2024/04/01～2026/09/30　施設＝【架空】みどり台クリーンセンター"],
             ["出力日時：2026/10/01 08:15"],
             [],
             ["作業日", "炉", "機器番号", "機器名称", "作業区分", "作業内容", "人員(名)", "延作業時間(h)", "備考"]]
    for day, _, w, _ in rows:
        e = EQ[w["equipment_id"]]
        hours = w["crew"] * W["man_day_hours"]
        note = ""
        if day == d(w["start"]) and w["duration_days"] > 1:
            note = "着手"
        elif day == d(w["end"]) and w["duration_days"] > 1:
            note = "完了"
        lines.append([day.strftime("%Y%m%d"), furnace_short(e), tag_of(e), e["base_name"],
                      KUBUN[w["attr"]], w["label"], str(w["crew"]), f"{hours:.1f}", note])
        TRUTH["events"].append(OrderedDict(
            file=rel(path), at={"row": len(lines), "sheet": None}, status="actual",
            fiscal_year=w["fiscal_year"], equipment_ids=[e["id"]], work_ids=[w["id"]],
            start=day.isoformat(), end=day.isoformat(), man_days=w["crew"], days=None, bundle=False))
    buf = io.StringIO()
    wr = csv.writer(buf, lineterminator="\r\n")
    for ln in lines:
        wr.writerow(ln)
    path.write_bytes(buf.getvalue().encode("utf-8-sig"))
    TRUTH["files"].append(OrderedDict(
        file=rel(path), format="csv", kind="daily", encoding="utf-8-sig", delimiter=",",
        note="委託作業の日報システムの書き出し。1 行＝1 日 × 1 機器 × 1 作業で、何日もの作業は日ごとの行に分ける。"
             "頭に出力条件の 3 行、作業日は yyyymmdd、工数は人員と延作業時間（h）。合計の行は無い。"))


# ---------------------------------------------------------------- 工事実績集計（年度・工事ごと）
def bundle_title(key_label, fur, members):
    names = [EQ[w["equipment_id"]]["base_name"] for w in members]
    fl = f"{fur}号炉 " if fur else ""
    if key_label == "定期整備（分解）":
        return f"{fl}定期整備工事", "・".join(names)
    if key_label == "排ガス処理設備の点検":
        if len(members) == 3:
            return f"{fl}排ガス処理設備点検", "排ガス処理設備 一式"
        return f"{fl}排ガス処理設備点検", "・".join(names)
    if key_label == "通風機の分解整備":
        return f"{fl}通風機分解整備", "・".join(names)
    if key_label == "全休止のタービン系の分解整備":
        return "全休止 タービン系分解整備", "・".join(names)
    if key_label == "全休止の電気・計装の点検":
        return "全休止 電気・計装設備点検", "・".join(names)
    if key_label == "精密機能検査":
        return f"{fl}精密機能検査", "・".join(names)
    if key_label == "押込送風機の電動機取替":
        return f"{fl}押込送風機 電動機取替", "押込送風機（電動機）"
    base = {"ごみクレーンの年次点検": "ごみクレーン年次点検", "灰クレーンの年次点検": "灰クレーン年次点検",
            "計量機の定期検査": "計量機定期検査", "切断機の点検": "粗大ごみ切断機点検"}[key_label]
    return base, "・".join(names)


def make_daily_b():
    path = FILES / "daily" / "koji-jisseki_H31-R5.csv"
    groups = OrderedDict()
    for w in WORKS:
        if w["status"] != "actual" or w["fiscal_year"] > 2023:
            continue
        e = EQ[w["equipment_id"]]
        key = (w["fiscal_year"], w["start"], w["end"], w["label"], e["furnace"])
        groups.setdefault(key, []).append(w)
    keys = sorted(groups, key=lambda k: (k[0], k[1], k[4] or 0))
    lines = [["【架空】年度別 点検整備工事 実績集計（平成31年度～令和5年度）　みどり台クリーンセンター"],
             [],
             ["年度", "工事件名", "対象機器", "着工日", "竣工日", "工期(日)", "延べ人工", "備考"]]
    cur_fy = None
    fy_sum = 0
    total = 0

    def flush_sub():
        lines.append(["", f"（{fy_label(cur_fy)} 計）", "", "", "", "", str(fy_sum), ""])

    for k in keys:
        fy, st, en, label, fur = k
        mem = groups[k]
        if fy != cur_fy:
            if cur_fy is not None:
                flush_sub()
            cur_fy = fy
            fy_sum = 0
            fy_cell = fy_label(fy)
        else:
            fy_cell = ""
        title, target = bundle_title(label, fur, mem)
        md = sum(w["man_days"] for w in mem)
        dur = mem[0]["duration_days"]
        assert all(w["duration_days"] == dur for w in mem)
        note = "直営" if all(w["contractor"] is None for w in mem) else ""
        lines.append([fy_cell, title, target, wareki_long(d(st)), wareki_long(d(en)), str(dur), str(md), note])
        fy_sum += md
        total += md
        TRUTH["events"].append(OrderedDict(
            file=rel(path), at={"row": len(lines), "sheet": None}, status="actual", fiscal_year=fy,
            equipment_ids=[w["equipment_id"] for w in mem], work_ids=[w["id"] for w in mem],
            start=st, end=en, man_days=md, days=dur, bundle=len(mem) > 1))
    flush_sub()
    lines.append(["", "（総　計）", "", "", "", "", str(total), ""])
    lines.append([])
    lines.append(["※ 延べ人工は 1 人 1 日（8 時間）を 1 とする。「一式」は、その号炉の集じん装置・HCL、SOx 除去設備・NOx 除去設備の 3 機器。"])
    buf = io.StringIO()
    wr = csv.writer(buf, delimiter="\t", lineterminator="\r\n")
    for ln in lines:
        wr.writerow(ln)
    path.write_bytes(buf.getvalue().encode("utf-16"))
    TRUTH["files"].append(OrderedDict(
        file=rel(path), format="csv", kind="daily", encoding="utf-16", delimiter="\t",
        note="Excel の「Unicode テキスト」で保存した UTF-16（BOM 付き）・タブ区切りの年度別の工事実績。1 行＝1 工事で、"
             "同じ工期の機器をまとめた行がある（「一式」も）。年度は各年度の最初の行だけ、日付は和暦（平成31年→令和元年の切り替えあり）、年度計と総計の行。"))


# ---------------------------------------------------------------- 報告書（xlsx → pdf）
def to_pdf(xlsx, pdf_out):
    outdir = TMP / "pdfout"
    if outdir.exists():
        shutil.rmtree(outdir)
    outdir.mkdir(parents=True)
    subprocess.run([SOFFICE, f"-env:UserInstallation={LO_PROFILE}", "--headless", "--convert-to", "pdf",
                    "--outdir", str(outdir), str(xlsx)], check=True, capture_output=True, timeout=240)
    produced = outdir / (xlsx.stem + ".pdf")
    data = produced.read_bytes()
    # 作成日時と ID を同じ長さの固定値に置き換える（中身は変えない）
    data = re.sub(rb"/(?:CreationDate|ModDate)\((D:[^)]*)\)", lambda m: re.sub(rb"\((D:[^)]*)\)", lambda n: b"(" + (b"D:20261001000000+09'00'" + b" " * 64)[:len(n.group(1))] + b")", m.group(0)), data)
    data = re.sub(rb"(<xmp:CreateDate>)[^<]*(</xmp:CreateDate>)", lambda m: m.group(1) + b"2026-10-01T00:00:00+09:00"[:len(m.group(0)) - len(m.group(1)) - len(m.group(2))].ljust(len(m.group(0)) - len(m.group(1)) - len(m.group(2)), b" ") + m.group(2), data)
    data = re.sub(rb"/ID\s*\[\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\]", lambda m: m.group(0).replace(m.group(1), b"0" * len(m.group(1))).replace(m.group(2), b"0" * len(m.group(2))), data)
    data = re.sub(rb"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d([+-]\d\d:\d\d|Z)",
                  lambda m: (b"2026-10-01T00:00:00" + m.group(1)), data)
    data = re.sub(rb"/DocChecksum\s*/([0-9A-Fa-f]+)", lambda m: m.group(0).replace(m.group(1), b"0" * len(m.group(1))), data)
    pdf_out.parent.mkdir(parents=True, exist_ok=True)
    pdf_out.write_bytes(data)


def setup_print(ws, landscape):
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_options.horizontalCentered = True
    ws.page_margins.left = ws.page_margins.right = 0.5
    ws.page_margins.top = ws.page_margins.bottom = 0.6


CIRC = "①②③④⑤⑥⑦⑧⑨⑩"


def make_report1():
    src = FILES / "report" / "src" / "R6-2go-teiki-seibi.xlsx"
    pdf = FILES / "report" / "R6-2go-teiki-seibi_jisseki.pdf"
    ws_list = [w for w in WORKS if w["fiscal_year"] == 2024 and w["start"] == "2024-10-05"]
    order = [w["id"] for w in ws_list]
    wb = new_wb("【架空】令和6年度 2号炉定期整備工事 作業実績報告書")
    ws = wb.active
    ws.title = "報告書"
    ws["A1"] = "【架空】令和6年度　2号炉定期整備工事　作業実績報告書"
    ws.merge_cells("A1:J1")
    ws["A1"].font = f(16, True)
    ws["A1"].alignment = Alignment(horizontal="center")
    info = [("施設名", "【架空】みどり台クリーンセンター"), ("工事件名", "2号炉 定期整備工事"),
            ("作業期間", "令和6年10月5日 ～ 令和6年10月16日（12日間）"), ("受注者", "【架空】みどり保全株式会社")]
    for i, (k, v) in enumerate(info):
        r = 3 + i
        ws.cell(r, 1, k).font = f(10, True)
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
        ws.cell(r, 3, v).font = f(10)
        ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=6)
    ws["H3"] = "提出日"
    ws["I3"] = "令和6年10月25日"
    ws.merge_cells("I3:J3")
    r0 = 8
    heads = ["番号", "設備区分", "機器名称", "作業項目", "作業期間（令和6年）", None, "日数", "人員(人/日)", "延時間(h)", "備考"]
    for i, h in enumerate(heads, start=1):
        if h is not None:
            ws.cell(r0, i, h)
    ws.cell(r0 + 1, 5, "自")
    ws.cell(r0 + 1, 6, "至")
    for i in (1, 2, 3, 4, 7, 8, 9, 10):
        ws.merge_cells(start_row=r0, start_column=i, end_row=r0 + 1, end_column=i)
    ws.merge_cells(start_row=r0, start_column=5, end_row=r0, end_column=6)
    for rr in (r0, r0 + 1):
        for cc in range(1, 11):
            c = ws.cell(rr, cc)
            c.font = f(10, True)
            c.border = BOX
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            c.fill = PatternFill("solid", fgColor="EDEDED")
    item = {"定期整備（分解）": "定期整備（分解・清掃・摩耗部品交換）",
            "排ガス処理設備の点検": "内部点検・計装校正",
            "通風機の分解整備": "分解整備（軸受・羽根車点検）"}
    r = r0 + 2
    last_sys = None
    total_h = 0
    for k, w in enumerate(ws_list):
        e = EQ[w["equipment_id"]]
        name = f"2号{e['base_name']}"
        hours = w["man_days"] * W["man_day_hours"]
        total_h += hours
        sysc = e["system"] if e["system"] != last_sys else ""
        last_sys = e["system"]
        vals = [CIRC[k], sysc, name, item[w["label"]], f"{d(w['start']).month}/{d(w['start']).day}",
                f"{d(w['end']).month}/{d(w['end']).day}", w["duration_days"], w["crew"], hours, ""]
        for i, v in enumerate(vals, start=1):
            c = ws.cell(r, i, v if v != "" else None)
            c.font = f(10)
            c.border = BOX
            c.alignment = Alignment(horizontal="center" if i in (1, 5, 6, 7, 8, 9) else "left", vertical="center")
        TRUTH["events"].append(OrderedDict(
            file=rel(pdf), at={"texts": [name, str(hours)]}, status="actual", fiscal_year=2024,
            equipment_ids=[e["id"]], work_ids=[w["id"]], start=w["start"], end=w["end"],
            man_days=w["man_days"], days=w["duration_days"], bundle=False))
        r += 1
    ws.cell(r, 1, "合　計")
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
    ws.cell(r, 9, total_h)
    for cc in range(1, 11):
        c = ws.cell(r, cc)
        c.font = f(10, True)
        c.border = BOX
        c.alignment = Alignment(horizontal="center")
    ws.cell(r + 2, 1, "※ 延時間は 人員 × 作業日数 × 8 時間（1 人 1 日 8 時間）で計上した。休日も連続して作業した。").font = f(9)
    ws.cell(r + 3, 1, "※ 2号炉 集じん装置は本工事の対象外。").font = f(9)
    ws.cell(r + 5, 7, "上記のとおり報告します。").font = f(10)
    ws.cell(r + 6, 7, "【架空】みどり保全株式会社　現場代理人　（記名省略）").font = f(10)
    for i, wdt in enumerate([6, 16, 22, 34, 8, 8, 6, 10, 10, 14], start=1):
        ws.column_dimensions[col_letter(i)].width = wdt
    setup_print(ws, landscape=True)
    save(wb, src)
    to_pdf(src, pdf)
    TRUTH["files"].append(OrderedDict(
        file=rel(pdf), format="pdf", kind="report", source_xlsx=rel(src),
        note="委託先の作業実績報告書（A4 横 1 頁）。番号は丸数字、作業期間は「自・至」の 2 列に月/日だけを書き、年は見出しの「令和6年」。"
             "工数は延時間（h）で、人・日は 8 で割る。合計の行と注記がある。"))
    return pdf


def make_report2():
    src = FILES / "report" / "src" / "2023-zenkyushi-shukei.xlsx"
    pdf = FILES / "report" / "2023-zenkyushi-tenken_shukei.pdf"
    ws_ = {w["id"]: w for w in WORKS}
    tb = [ws_["W0088"], ws_["W0089"]]
    ei = [ws_["W0090"], ws_["W0091"], ws_["W0092"]]
    wb = new_wb("【架空】全炉休止期間 点検整備作業 日数・人工集計表")
    ws = wb.active
    ws.title = "集計表"
    ws["A1"] = "【架空】全炉休止期間　点検整備作業　日数・人工集計表（2023年度）"
    ws.merge_cells("A1:G1")
    ws["A1"].font = f(14, True)
    ws["A1"].alignment = Alignment(horizontal="center")
    ws["A2"] = "施設：【架空】みどり台クリーンセンター"
    ws.merge_cells("A2:D2")
    ws["F2"] = "2023年10月6日"
    ws.merge_cells("F2:G2")
    ws["A3"] = "全炉休止：2023/9/14（木）～ 9/27（水）"
    ws.merge_cells("A3:D3")
    heads = ["区分", "作業項目", "対象機器", "工期", "日数", "人工(人日)", "備考"]
    r0 = 5
    for i, h in enumerate(heads, start=1):
        c = ws.cell(r0, i, h)
        c.font = f(10, True)
        c.border = BOX
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.fill = PatternFill("solid", fgColor="DDEBF7")
    period = "2023/9/14～9/27"
    rows = [("タービン系", "分解整備", "蒸気復水器", [tb[0]], "空冷ファン 6 台"),
            ("", "分解整備", "蒸気タービン発電設備", [tb[1]], "開放点検"),
            ("電気・計装", "定期点検　一式", "受変電配電設備・発電機・DCS", ei, "内訳は別紙")]
    r = r0 + 1
    tot = 0
    for kub, item, tgt, mem, note in rows:
        md = sum(w["man_days"] for w in mem)
        tot += md
        vals = [kub, item, tgt, period, mem[0]["duration_days"], md, note]
        for i, v in enumerate(vals, start=1):
            c = ws.cell(r, i, v if v != "" else None)
            c.font = f(10)
            c.border = BOX
            c.alignment = Alignment(vertical="center", wrap_text=True,
                                    horizontal="center" if i in (4, 5, 6) else "left")
        TRUTH["events"].append(OrderedDict(
            file=rel(pdf), at={"texts": [tgt, str(md)]}, status="actual", fiscal_year=2023,
            equipment_ids=[w["equipment_id"] for w in mem], work_ids=[w["id"] for w in mem],
            start=mem[0]["start"], end=mem[0]["end"], man_days=md, days=mem[0]["duration_days"],
            bundle=len(mem) > 1))
        r += 1
    ws.cell(r, 1, "計")
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5)
    ws.cell(r, 6, tot)
    for cc in range(1, 8):
        c = ws.cell(r, cc)
        c.font = f(10, True)
        c.border = BOX
        c.alignment = Alignment(horizontal="center")
    ws.cell(r + 2, 1, "注 1）人工は 1 人 1 日を 1 人日とする。").font = f(9)
    ws.cell(r + 3, 1, "注 2）電気・計装の一式は 3 機器の合計（受変電配電設備・発電機・DCS）。").font = f(9)
    ws.cell(r + 5, 5, "施設管理係　確認欄").font = f(9)
    for i, wdt in enumerate([12, 16, 30, 18, 7, 11, 16], start=1):
        ws.column_dimensions[col_letter(i)].width = wdt
    setup_print(ws, landscape=False)
    save(wb, src)
    to_pdf(src, pdf)
    TRUTH["files"].append(OrderedDict(
        file=rel(pdf), format="pdf", kind="report", source_xlsx=rel(src),
        note="全炉休止の期間の点検整備の集計表（A4 縦 1 頁）。工期は西暦の「2023/9/14～9/27」を 1 つのセルに、"
             "区分は最初の行だけ。電気・計装は 3 機器を「一式」の 1 行にまとめ、人工は人日。"))
    return pdf


# ---------------------------------------------------------------- 写真
def solve8(src_pts, dst_pts):
    """出力の点 → 入力の点 の射影の係数（PIL の PERSPECTIVE 用）。"""
    A, B = [], []
    for (x, y), (u, v) in zip(dst_pts, src_pts):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    n = 8
    M = [row[:] + [b] for row, b in zip(A, B)]
    for i in range(n):
        p = max(range(i, n), key=lambda k: abs(M[k][i]))
        M[i], M[p] = M[p], M[i]
        for k in range(n):
            if k != i:
                fct = M[k][i] / M[i][i]
                for j in range(i, n + 1):
                    M[k][j] -= fct * M[i][j]
    return [M[i][n] / M[i][i] for i in range(n)]


def make_photo(pdf):
    import pypdfium2 as pdfium
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops
    rnd = random.Random(SEED)
    doc = pdfium.PdfDocument(str(pdf))
    page = doc[0]
    scale = 3.0
    pil = page.render(scale=scale).to_pil().convert("RGB")
    pw, ph = page.get_size()
    # 手書きの印（赤のチェックと「確認」の印）を紙に描く
    tp = page.get_textpage()
    draw = ImageDraw.Draw(pil)
    red = (190, 28, 38)
    for word in ["蒸気復水器", "蒸気タービン発電設備", "受変電配電設備"]:
        s = tp.search(word)
        hit = s.get_next()
        if hit:
            idx, cnt = hit
            l, b, r_, t = tp.get_charbox(idx)
            x0 = l * scale - 70
            y0 = (ph - t) * scale + 6
            pts = [(x0, y0 + 18), (x0 + 14 + rnd.uniform(-3, 3), y0 + 38), (x0 + 48 + rnd.uniform(-4, 4), y0 - 10)]
            draw.line(pts, fill=red, width=7, joint="curve")
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\msmincho.ttc", 44)
    except OSError:
        font = ImageFont.load_default()
    cx, cy = pil.width * 0.80, pil.height * 0.30
    draw.ellipse([cx - 66, cy - 66, cx + 66, cy + 66], outline=red, width=6)
    draw.text((cx - 44, cy - 26), "確認", fill=red, font=font)
    # 紙の上の 4 割だけが写る（カメラを近づけた）
    pil = pil.crop((0, 0, pil.width, int(pil.height * 0.40)))
    # 写真の画面（ホワイトボード）
    Wd, Hd = 2400, 1800
    bg = Image.new("RGB", (Wd, Hd), (214, 218, 221))
    bd = ImageDraw.Draw(bg)
    for y in range(Hd):
        g = int(12 * y / Hd)
        bd.line([(0, y), (Wd, y)], fill=(212 - g, 216 - g, 219 - g))
    bd.rectangle([0, 0, Wd, 46], fill=(140, 142, 146))
    for _ in range(6):
        x = rnd.randint(100, Wd - 300); y = rnd.randint(80, 300)
        bd.arc([x, y, x + rnd.randint(120, 300), y + rnd.randint(40, 120)], rnd.randint(0, 180), rnd.randint(200, 360),
               fill=(185, 190, 200), width=6)
    sw, sh = pil.size
    dst = [(250, 230), (2170, 330), (2280, 1930), (140, 1860)]
    coeffs = solve8([(0, 0), (sw, 0), (sw, sh), (0, sh)], dst)
    paper = pil.transform((Wd, Hd), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new("L", (sw, sh), 255).transform((Wd, Hd), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    shadow = Image.new("L", (Wd, Hd), 0)
    ImageDraw.Draw(shadow).polygon([(x + 26, y + 30) for x, y in dst], fill=130)
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    bg = Image.composite(Image.new("RGB", (Wd, Hd), (90, 93, 97)), bg, shadow)
    bg.paste(paper, (0, 0), mask)
    md = ImageDraw.Draw(bg)
    for (x, y) in [(330, 270), (2090, 365)]:
        md.ellipse([x - 38, y - 38, x + 38, y + 38], fill=(30, 70, 160))
        md.ellipse([x - 22, y - 28, x + 4, y - 9], fill=(110, 150, 220))
    # 光のむら（左上が明るく右下が暗い）と、蛍光灯の照り返し
    shade = Image.new("L", (2, 2))
    shade.putdata([255, 232, 222, 178])
    shade = shade.resize((Wd, Hd), Image.BILINEAR).filter(ImageFilter.GaussianBlur(40))
    bg = Image.composite(bg, Image.new("RGB", (Wd, Hd), (0, 0, 0)), shade)
    glare = Image.new("L", (Wd, Hd), 0)
    ImageDraw.Draw(glare).ellipse([1450, 520, 1950, 780], fill=120)
    glare = glare.filter(ImageFilter.GaussianBlur(60))
    bg = Image.composite(Image.new("RGB", (Wd, Hd), (255, 255, 248)), bg, glare)
    bg = bg.rotate(-1.4, resample=Image.BICUBIC, fillcolor=(120, 122, 126))
    bg = bg.filter(ImageFilter.GaussianBlur(1.6))
    nrnd = random.Random(SEED + 1)
    noise = Image.frombytes("L", (Wd, Hd), nrnd.randbytes(Wd * Hd)).point(lambda v: 120 + v * 16 // 255)
    noise = noise.convert("RGB")
    bg = ImageChops.add(bg, noise, scale=1.0, offset=-128)
    out = FILES / "photo" / "IMG_20231006_093214.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    bg.save(out, "JPEG", quality=80, optimize=False)
    TRUTH["files"].append(OrderedDict(
        file=rel(out), format="jpg", kind="photo", photo_of={"file": rel(pdf), "page": 1},
        note="全炉休止の集計表（報告書）の 1 頁を印刷し、事務所のホワイトボードに磁石で留めて、左下から斜めに撮った写真。"
             "赤ペンのチェックと「確認」の丸印の手書き、蛍光灯の照り返し、影、少しのぼけと傾き。"))


def main():
    random.seed(SEED)
    if FILES.exists():
        shutil.rmtree(FILES)
    FILES.mkdir()
    TMP.mkdir(parents=True, exist_ok=True)
    make_ledger()
    make_star()
    make_daily_a()
    make_daily_b()
    make_report1()
    p2 = make_report2()
    make_photo(p2)
    (ROOT / "truth.json").write_text(json.dumps(TRUTH, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("files:", len(TRUTH["files"]), "assets:", len(TRUTH["assets"]), "marks:", len(TRUTH["marks"]),
          "events:", len(TRUTH["events"]))


if __name__ == "__main__":
    main()
