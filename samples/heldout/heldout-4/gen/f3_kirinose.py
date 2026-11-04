# -*- coding: utf-8 -*-
"""施設 3：【架空】霧ノ瀬浄化センター（下水道・終末処理場）

資料：維持管理作業日報（xlsx。1 日 1 シートの帳票、続紙のシートあり）・
主ポンプ 月例点検記録（xlsx。年度の途中で No.4 の列が増え、見出しが変わる）
"""
import datetime as dt
import os

import openpyxl
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from common import Facility, TODAY, iso, set_props, save_wb, wareki, write_text, WEEK

D = dt.date
FID = "f-kirinose"
NAME = "【架空】霧ノ瀬浄化センター"
F_DAILY = "【架空】霧ノ瀬浄化C_維持管理作業日報_R8.8.xlsx"
F_PUMP = "【架空】霧ノ瀬浄化C_主ポンプ月例点検記録_R7.xlsx"

V_OP = "霧ノ瀬水処理管理㈱"  # 運転管理の委託先（職員の欄に入れない）
V_MECH = "瑠璃機械整備㈱"
V_ELEC = "江戸紫電気保安㈱"
V_DEW = "鶸色脱水機サービス㈱"
V_PUMP = "浅葱ポンプ工業㈱"

THIN = Side(style="thin", color="000000")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def build():
    F = Facility(FID, NAME, "sewer", {
        "treatment": "標準活性汚泥法", "capacity_m3_per_day": 42000, "sewer_system": "分流式",
        "sludge": "脱水・場外搬出", "contract": "運転管理委託（単年度）", "completed": 1991,
    }, 3)
    R = F.rng
    E = F.eq
    E("H01", "除塵機 No.1", ["沈砂池設備", "除塵機", "No.1"], None, 1991, "SC-1")
    E("H02", "除塵機 No.2", ["沈砂池設備", "除塵機", "No.2"], None, 1991, "SC-2")
    E("H03", "沈砂かき揚げ機", ["沈砂池設備", "沈砂かき揚げ機"], None, 1991, "GR-1")
    E("H04", "主ポンプ No.1", ["ポンプ設備", "主ポンプ", "No.1"], None, 1991, "MP-1")
    E("H05", "主ポンプ No.2", ["ポンプ設備", "主ポンプ", "No.2"], None, 1991, "MP-2")
    E("H06", "主ポンプ No.3", ["ポンプ設備", "主ポンプ", "No.3"], None, 2003, "MP-3")
    E("H07", "主ポンプ No.4", ["ポンプ設備", "主ポンプ", "No.4"], None, 2025, "MP-4")
    E("H08", "最初沈殿池 汚泥かき寄せ機 1系", ["水処理設備", "最初沈殿池", "汚泥かき寄せ機", "1系"], 1, 1991)
    E("H09", "最初沈殿池 汚泥かき寄せ機 2系", ["水処理設備", "最初沈殿池", "汚泥かき寄せ機", "2系"], 2, 1991)
    E("H10", "送風機 No.1", ["水処理設備", "送風機", "No.1"], None, 1991, "B-1")
    E("H11", "送風機 No.2", ["水処理設備", "送風機", "No.2"], None, 1991, "B-2")
    E("H12", "送風機 No.3", ["水処理設備", "送風機", "No.3"], None, 2010, "B-3")
    E("H13", "反応タンク 散気装置 1系", ["水処理設備", "反応タンク", "散気装置", "1系"], 1, 1991)
    E("H14", "反応タンク 散気装置 2系", ["水処理設備", "反応タンク", "散気装置", "2系"], 2, 1991)
    E("H15", "最終沈殿池 汚泥かき寄せ機 1系", ["水処理設備", "最終沈殿池", "汚泥かき寄せ機", "1系"], 1, 1991)
    E("H16", "最終沈殿池 汚泥かき寄せ機 2系", ["水処理設備", "最終沈殿池", "汚泥かき寄せ機", "2系"], 2, 1991)
    E("H17", "次亜塩素酸ナトリウム注入設備", ["消毒設備", "次亜注入設備"], None, 1991)
    E("H18", "重力濃縮槽", ["汚泥処理設備", "重力濃縮槽"], None, 1991)
    E("H19", "脱水機 No.1", ["汚泥処理設備", "脱水機", "No.1"], None, 2008, "DH-1")
    E("H20", "脱水機 No.2", ["汚泥処理設備", "脱水機", "No.2"], None, 2008, "DH-2")
    E("H21", "受変電設備", ["電気設備", "受変電設備"], None, 1991)
    E("H22", "自家発電設備", ["電気設備", "自家発電設備"], None, 1991)
    E("H23", "監視制御設備", ["計装設備", "監視制御設備"], None, 2014)
    E("H24", "場内全体", ["場内全体"], None, 1991)
    write_daily(F)
    write_pump(F)
    write_user(F)
    F.write_answers()
    return F


# ======================================================================
def daily_plan(F):
    """令和8年8月の日ごとの作業（明細）"""
    R = F.rng
    days = [d for d in (D(2026, 8, i) for i in range(1, 32)) if d.weekday() < 5]
    plan = {d: [] for d in days}

    def add(d, sysn, eqs, eqname, work, vendor, staff, ven, t0, t1, memo="", wid=None):
        plan[d].append(dict(sys=sysn, eqs=eqs, eqname=eqname, work=work, vendor=vendor, staff=staff, ven=ven,
                            t0=t0, t1=t1, memo=memo, wid=wid))

    # 定例
    for d in days:
        if d.day in (13, 14):
            continue  # お盆の 2 日は明細なし（巡回のみで書かない）
        if d.weekday() == 0:
            add(d, "沈砂池", ["H01", "H02"], "除塵機 №1・№2", "し渣搬出・目視点検", "", 2, 0, "9:00", "10:30")
        if d.weekday() == 2:
            add(d, "汚泥処理", ["H18"], "重力濃縮槽", "スカム除去", "", 2, 0, "13:30", "15:00")
    add(D(2026, 8, 3), "電気", ["H22"], "自家発電設備", "月次 無負荷試運転", "", 1, 0, "10:00", "10:30")
    add(D(2026, 8, 5), "水処理", ["H12"], "送風機 No.3", "定期点検（軸受・Vベルト）", V_MECH, 1, 2, "9:00", "16:00")
    add(D(2026, 8, 6), "計装", ["H23"], "監視制御設備", "月次点検", V_ELEC, 0, 1, "9:00", "12:00")
    add(D(2026, 8, 7), "消毒", ["H17"], "次亜注入ﾎﾟﾝﾌﾟ", "注入量確認・配管点検", "", 1, 0, "14:00", "15:00")
    add(D(2026, 8, 11), "ポンプ", ["H05"], "主ﾎﾟﾝﾌﾟ (2)", "グランドパッキン取替", V_PUMP, 1, 2, "9:00", "15:30",
        memo="漏水量 増のため")
    add(D(2026, 8, 12), "沈砂池", ["H03"], "沈砂かき揚げ機", "チェーン張り調整", "", 2, 0, "9:30", "11:30")
    for i, d in enumerate([D(2026, 8, 18), D(2026, 8, 19), D(2026, 8, 20)]):
        add(d, "汚泥処理", ["H20"], "脱水機 No.2", f"分解整備（{i + 1}日目）", V_DEW, 1, 3, "8:30", "17:00",
            memo="ろ布取替を含む" if i == 0 else "", wid="dew2")
    # 8/19 は受変電の年次点検（全停電）。明細が多く続紙になる
    d = D(2026, 8, 19)
    add(d, "電気", ["H21"], "受変電設備", "年次点検（全停電 9:00～15:00）", V_ELEC, 1, 4, "8:30", "16:00", wid="ss")
    add(d, "電気", ["H22"], "自家発電設備", "停電中の負荷運転", "", 1, 0, "8:50", "15:10", wid="eg")
    add(d, "計装", ["H23"], "監視制御設備", "停電前の停止・復電後の再起動確認", V_ELEC, 1, 1, "8:30", "15:40", wid="sv")
    for k, e in enumerate(["H04", "H05", "H06", "H07"], 1):
        add(d, "ポンプ", [e], f"主ポンプ {['①', '②', '③', '④'][k - 1]}", "復電後の起動確認", "", 1, 0, "15:00", "15:30",
            wid=f"mp{k}")
    for k, e in enumerate(["H10", "H11", "H12"], 1):
        add(d, "水処理", [e], f"送風機 {k}号", "復電後の起動確認", "", 1, 0, "15:10", "15:40", wid=f"bl{k}")
    add(d, "沈砂池", ["H01"], "除塵機 №1", "レーキ破損 補修", V_MECH, 1, 2, "10:00", "14:00", memo="停電中に実施")
    add(d, "水処理", ["H08", "H09"], "最初沈殿池かき寄せ機（1・2系）", "復電後の運転確認", "", 1, 0, "15:20", "15:50")
    add(d, "水処理", ["H15", "H16"], "最終沈殿池かき寄せ機（1・2系）", "復電後の運転確認", "", 1, 0, "15:20", "15:50")
    add(D(2026, 8, 21), "ポンプ", ["H04", "H05", "H06", "H07"], "主ポンプ No.1～4", "月例点検", "", 2, 0, "9:00",
        "11:30")
    add(D(2026, 8, 25), "消毒", ["H17"], "次亜注入設備", "注入ポンプ No.2 ダイヤフラム取替", V_MECH, 0, 2, "9:00",
        "12:00")
    for i, d in enumerate([D(2026, 8, 26), D(2026, 8, 27)]):
        add(d, "水処理", ["H08"], "最初沈殿池 1系 かき寄せ機", f"チェーン・フライト調整（{i + 1}/2）", V_MECH, 1, 3,
            "8:30", "17:00", wid="ps1")
    add(D(2026, 8, 28), "水処理", ["H13"], "反応タンク1系 散気装置", "目詰まり点検（散気量確認）", "", 2, 0, "13:00",
        "15:00")
    add(D(2026, 8, 31), "汚泥処理", ["H19"], "脱水機 No.1", "ろ布洗浄ノズル清掃", "", 1, 0, "13:00", "14:30")
    return days, plan


def hrs(t0, t1):
    h0, m0 = map(int, t0.split(":"))
    h1, m1 = map(int, t1.split(":"))
    v = (h1 * 60 + m1 - h0 * 60 - m0) / 60
    if v > 5:
        v -= 1.0  # 昼休み
    return v


def write_daily(F):
    R = F.rng
    days, plan = daily_plan(F)
    wb = openpyxl.Workbook()
    set_props(wb, "【架空】霧ノ瀬浄化センター 維持管理作業日報 令和8年8月")
    wb.remove(wb.active)
    recs = F.file(F_DAILY, False)
    writers = ["森下", "久遠", "森下", "笹倉"]
    works = {}
    nmax = 12
    no = 120
    for d in days:
        items = plan[d]
        no += 1
        first = items[:nmax]
        rest = items[nmax:]
        sheets = [(f"{d.month}月{d.day}日", first, False)]
        if rest:
            sheets.append((f"{d.month}月{d.day}日 (続)", rest, True))
        weather = R.choice(["晴", "晴", "曇", "晴時々曇", "雨"])
        writer = writers[d.day % 4]
        inflow = 30000 + R.randint(-2500, 3500) + (6000 if weather == "雨" else 0)
        outflow = inflow - R.randint(200, 900)
        rain = R.choice([0, 0, 0, 0.5, 2.0]) if weather != "雨" else R.choice([12.5, 21.0, 8.0])
        seq_in_day = 0
        for (sname, its, cont) in sheets:
            ws = wb.create_sheet(sname)
            SH = sname
            ws["A1"] = "【架空】霧ノ瀬浄化センター　維持管理作業日報" + ("（続き）" if cont else "")
            ws["A1"].font = Font(name="ＭＳ 明朝", size=13, bold=True)
            ws.merge_cells("A1:I1")
            ws["A1"].alignment = Alignment(horizontal="center")
            ws["A2"] = "日付"
            c = ws["B2"]
            c.value = dt.datetime(d.year, d.month, d.day)
            c.number_format = '[$-ja-JP]ggge"年"m"月"d"日"'
            ws["C2"] = f"（{WEEK[d.weekday()]}）"
            ws["D2"] = "天候"
            ws["E2"] = weather
            ws["F2"] = "記入者"
            ws["G2"] = writer
            ws["H2"] = "No."
            ws["I2"] = no
            sheet_fields = {"date": iso(d), "weather": weather, "writer": writer, "no": no}
            if not cont:
                ws["A3"] = "流入水量（m³）"
                ws["B3"] = inflow
                ws["D3"] = "放流水量（m³）"
                ws["E3"] = outflow
                ws["F3"] = "降雨量（mm）"
                ws["G3"] = rain
                for k in ("B3", "E3"):
                    ws[k].number_format = "#,##0"
                sheet_fields.update(inflow_m3=inflow, outflow_m3=outflow, rain_mm=rain)
            else:
                ws["A3"] = "前葉から続く"
                ws["A3"].font = Font(name="ＭＳ 明朝", size=9, italic=True)
            ws["I4"] = "架空のデータ"
            # 明細の見出し（2 段）
            for col, t in zip("ABCDEFHI", ["No.", "施設", "機器", "作業内容", "業者", "人員", "作業時間", "備考"]):
                ws[f"{col}6"] = t
            ws["F7"] = "職員"
            ws["G7"] = "業者"
            for col in "ABCDEHI":
                ws.merge_cells(f"{col}6:{col}7")
            ws.merge_cells("F6:G6")
            for rr in (6, 7):
                for cc in range(1, 10):
                    cl = ws.cell(rr, cc)
                    cl.border = BOX
                    cl.alignment = Alignment(horizontal="center", vertical="center")
                    cl.fill = PatternFill("solid", fgColor="E2EFDA")
            start_no = 1 if not cont else nmax + 1
            for k in range(12):
                rr = 8 + k
                ws.cell(rr, 1, start_no + k)
                for cc in range(1, 10):
                    ws.cell(rr, cc).border = BOX
            for k, it in enumerate(its):
                rr = 8 + k
                ws.cell(rr, 2, it["sys"])
                ws.cell(rr, 3, it["eqname"])
                ws.cell(rr, 4, it["work"])
                ws.cell(rr, 5, it["vendor"] or None)
                ws.cell(rr, 6, it["staff"] or None)
                ws.cell(rr, 7, it["ven"] or None)
                ws.cell(rr, 8, f"{it['t0']}～{it['t1']}")
                if it["memo"]:
                    ws.cell(rr, 9, it["memo"])
                f = dict(sheet_fields)
                f.update(line=start_no + k, system=it["sys"], equipment=it["eqname"], work=it["work"],
                         time=f"{it['t0']}～{it['t1']}")
                if it["vendor"]:
                    f["vendor"] = it["vendor"]
                if it["staff"]:
                    f["staff"] = it["staff"]
                if it["ven"]:
                    f["vendor_persons"] = it["ven"]
                if it["memo"]:
                    f["memo"] = it["memo"]
                recs.append({"sheet": SH, "r": rr, "kind": "item", "fields": f})
                # 作業
                key = it["wid"] and (it["wid"] if it["wid"] in ("dew2", "ps1") else None)
                h = hrs(it["t0"], it["t1"])
                md = (it["staff"] + it["ven"]) * h / 8
                if key and key in works:
                    w = works[key]
                    w["end"] = iso(d)
                    w["days"] = (d - dt.date.fromisoformat(w["start"])).days + 1
                    w["man_days"] = round(w["man_days"] + md, 4)
                else:
                    attr = "REPLACE" if "取替" in it["work"] else ("OVERHAUL" if any(x in it["work"] for x in ("補修", "整備", "調整", "清掃", "除去")) else "INSPECT")
                    lab = f"{F.equipment[it['eqs'][0]]['name'] if len(it['eqs']) == 1 else it['eqname']} {it['work'].split('（')[0]}"
                    w = F.work(lab, attr, "actual", 2026, it["eqs"], start=d, end=d, man_days=round(md, 4),
                               days=1, vendor=it["vendor"] or "運転管理（委託）")
                    if key:
                        works[key] = w
                F.link(w, F_DAILY, sheet=SH, r=rr)
                F.eq_name(it["eqs"], F_DAILY, it["eqname"])
            if not its:
                recs.append({"sheet": SH, "r": 2, "kind": "item", "fields": dict(sheet_fields)})
            ws["A21"] = "特記事項"
            ws["B21"] = "全停電（受変電 年次点検）。停電中は自家発で場内の負荷を確保。" if d.day == 19 and not cont else \
                ("盆期間。場内巡回のみ。" if d.day in (13, 14) else None)
            ws.merge_cells("B21:I22")
            ws["G24"] = "所長"
            ws["H24"] = "係長"
            ws["I24"] = "担当"
            for col, wdt in zip("ABCDEFGHI", [5, 9, 24, 32, 18, 6, 6, 13, 22]):
                ws.column_dimensions[col].width = wdt
            ws.page_setup.orientation = "landscape"
            ws.page_setup.fitToWidth = 1
    save_wb(wb, F.path_of(F_DAILY))


# ======================================================================
def write_pump(F):
    R = F.rng
    wb = openpyxl.Workbook()
    set_props(wb, "【架空】霧ノ瀬浄化センター 主ポンプ月例点検記録 令和7年度")
    ws = wb.active
    ws.title = "R7"
    SH = ws.title
    recs = F.file(F_PUMP, False)
    ws["A1"] = "【架空】霧ノ瀬浄化センター　主ポンプ 月例点検記録（令和7年度）"
    ws["A1"].font = Font(name="ＭＳ ゴシック", size=13, bold=True)
    ws["A2"] = "架空のデータ　　ポンプ棟　点検：保全班"
    SUB = ["運転時間\n(h)", "絶縁抵抗\n(MΩ)", "振動\n(mm/s)", "軸受温度\n(℃)"]
    hours = {1: 151200, 2: 149800, 3: 98300, 4: 0}

    def header(r0, pumps):
        ws.cell(r0, 1, "点検日")
        ws.merge_cells(start_row=r0, start_column=1, end_row=r0 + 1, end_column=1)
        col = 2
        for p in pumps:
            ws.cell(r0, col, f"No.{p} 主ポンプ" + ("（増設）" if p == 4 else ""))
            ws.merge_cells(start_row=r0, start_column=col, end_row=r0, end_column=col + 3)
            for j, t in enumerate(SUB):
                ws.cell(r0 + 1, col + j, t)
            col += 4
        ws.cell(r0, col, "点検者")
        ws.merge_cells(start_row=r0, start_column=col, end_row=r0 + 1, end_column=col)
        ws.cell(r0, col + 1, "備考")
        ws.merge_cells(start_row=r0, start_column=col + 1, end_row=r0 + 1, end_column=col + 1)
        for rr in (r0, r0 + 1):
            for cc in range(1, col + 2):
                cl = ws.cell(rr, cc)
                cl.border = BOX
                cl.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                cl.fill = PatternFill("solid", fgColor="DDEBF7")
                cl.font = Font(name="ＭＳ ゴシック", size=9, bold=True)
        return col

    months = [(2025, m) for m in range(4, 13)] + [(2026, m) for m in (1, 2, 3)]
    r = 4
    col_insp = header(r, [1, 2, 3])
    r += 2
    inspectors = ["笹倉", "森下", "笹倉・森下"]
    overhaul = None
    for (y, m) in months:
        if (y, m) == (2025, 10):
            r += 1
            note = "※ 令和7年10月1日 No.4 主ポンプ（増設）供用開始。10月から No.4 の欄を足した様式に変更。"
            ws.cell(r, 1, note)
            ws.cell(r, 1).font = Font(name="ＭＳ ゴシック", size=9, color="C00000")
            r += 1
            col_insp = header(r, [1, 2, 3, 4])
            r += 2
        pumps = [1, 2, 3] if (y, m) < (2025, 10) else [1, 2, 3, 4]
        d = D(y, m, 15)
        while d.weekday() >= 5:
            d += dt.timedelta(days=1)
        ws.cell(r, 1, dt.datetime(d.year, d.month, d.day)).number_format = "m/d"
        f = {"date": iso(d)}
        memo = ""
        insp = inspectors[m % 3]
        for i, p in enumerate(pumps):
            col = 2 + 4 * i
            skip = False
            if p == 2 and (y, m) == (2025, 8):
                ws.cell(r, col, "整備中")
                ws.merge_cells(start_row=r, start_column=col, end_row=r, end_column=col + 3)
                ws.cell(r, col).alignment = Alignment(horizontal="center")
                f[f"no{p}_status"] = "整備中"
                memo = "No.2 分解整備（8/4～8/29 浅葱ポンプ工業）"
                skip = True
                overhaul = F.work("主ポンプ No.2 分解整備", "OVERHAUL", "actual", 2025, ["H05"],
                                  start=D(2025, 8, 4), end=D(2025, 8, 29), days=26, vendor=V_PUMP)
                F.link(overhaul, F_PUMP, sheet=SH, r=r)
            if p == 3 and (y, m) == (2026, 1):
                skip = True  # 点検の抜け（欄が空）
            if skip:
                continue
            run = R.randint(380, 620) if not (p == 4 and (y, m) == (2025, 10)) else R.randint(200, 260)
            hours[p] += run
            ins = R.choice([50, 100, 100, 200, 500]) if p != 4 else 1000
            vib = round(R.uniform(1.2, 3.4) if p != 1 else R.uniform(2.6, 4.4), 1)
            tmp = R.randint(36, 52)
            vals = [hours[p], ins, vib, tmp]
            for j, v in enumerate(vals):
                ws.cell(r, col + j, v)
            ws.cell(r, col).number_format = "#,##0"
            f.update({f"no{p}_hours": hours[p], f"no{p}_insulation_MOhm": ins, f"no{p}_vibration_mm_s": vib,
                      f"no{p}_bearing_temp_C": tmp})
            w = F.work(f"主ポンプ No.{p} 月例点検", "INSPECT", "actual", 2025, [f"H0{3 + p}"], start=d, end=d,
                       days=1, vendor="保全班（職員）")
            F.link(w, F_PUMP, sheet=SH, r=r)
        if (y, m) == (2026, 1):
            pass  # No.3 の欄は空。備考にも書いていない
        if (y, m) == (2025, 12):
            memo = "No.1 振動やや大。次回 重点確認"
        ws.cell(r, col_insp, insp)
        f["inspector"] = insp
        if memo:
            ws.cell(r, col_insp + 1, memo)
            f["memo"] = memo
        for cc in range(1, col_insp + 2):
            ws.cell(r, cc).border = BOX
            ws.cell(r, cc).font = Font(name="ＭＳ ゴシック", size=9)
        recs.append({"sheet": SH, "r": r, "kind": "item", "fields": f})
        r += 1
    ws.cell(r + 1, 1, "注）絶縁抵抗は 1000V メガーで測定。振動は軸受部の速度の実効値。運転時間は積算計の読み。")
    ws.column_dimensions["A"].width = 9
    for cc in range(2, 20):
        ws.column_dimensions[openpyxl.utils.get_column_letter(cc)].width = 8.5
    ws.column_dimensions[openpyxl.utils.get_column_letter(col_insp + 1)].width = 34
    for p, e in zip([1, 2, 3, 4], ["H04", "H05", "H06", "H07"]):
        F.eq_name([e], F_PUMP, f"No.{p} 主ポンプ")
    F.defects.append({"kind": "点検の抜け", "where": f"{F_PUMP} R7 の 1 月の行で No.3 主ポンプの欄が空（点検していない）",
                      "check": "月例点検の周期の超え"})
    save_wb(wb, F.path_of(F_PUMP))


def write_user(F):
    t = f"""# {F.name} の担当者が答えられること

（維持管理係の担当者の言葉で。聞かれたら答える）

## ファイル
- `{F_DAILY}`：令和8年8月の維持管理作業日報。1 日に 1 シート。土日は書いていない。
- `{F_PUMP}`：令和7年度の主ポンプの月例点検の記録。毎月 15 日ごろ（土日なら次の平日）に点検する。

## 日報
- シートの名前が日付。「(続)」が付いたシートは、その日の明細が 12 行に入りきらなかった分の続き（8月19日の全停電の日）。続きのシートの明細は No.13 から。
- 上の「日付・天候・記入者・No.」と「流入水量・放流水量・降雨量」はその日の値。続きのシートには水量を書かない。
- 人員の「職員」は運転管理の委託先の人（うちの直営の人ではないが、日報では職員と書く）、「業者」はそのとき来た業者の人数。
- 作業時間は始めと終わりの時刻。お昼をまたぐものは 1 時間の休憩を引く。
- 8月13日・14日はお盆で、巡回だけなので明細は書いていない。
- 機器の書き方は人によって違う：「主ﾎﾟﾝﾌﾟ (2)」「主ポンプ ②」は主ポンプ No.2、「送風機 3号」は送風機 No.3、「除塵機 №1」は除塵機 No.1。
- 「1・2系」は水処理の系列の 1 系と 2 系の両方。系列が無い機器は場に 1 つ。
- 8月18日～20日の脱水機 No.2 の分解整備、8月26日・27日の最初沈殿池 1系 かき寄せ機の調整は、何日かかけた 1 つの工事。

## 主ポンプの記録
- 主ポンプは No.1～No.3 だったが、令和7年10月1日に No.4 を増設して使い始めた。10月からは No.4 の欄を足した様式に変えたので、表の途中で見出しが変わっている。
- 運転時間は積算計の読み（h）、絶縁抵抗は MΩ、振動は mm/s、軸受温度は ℃。
- 8月の No.2 は分解整備で止めていたので「整備中」。
- 1月の No.3 の欄が空なのは、点検をしていなかったから（記録の書き忘れではない）。
- 点検者の欄の「笹倉・森下」は 2 人で点検したということ。
"""
    write_text(os.path.join(F.dir, "user.md"), t)
