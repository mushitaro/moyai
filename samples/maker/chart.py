"""星取表（年度の整備計画表）の書き手。

様式は施設の設定（docs[].layout・header・legend…）で選ぶ。中身はすべて正解の世界から作り、
書き漏れ・年度の書き間違い・最後の年度の一部だけの反映は、世界の割合で入れて正解に記録する。
"""
from __future__ import annotations

from collections import defaultdict

from .book import Answer, Book, addr, ev
from .util import FAKE, era_fy, fill, rng_for, wareki_dot, zen_digits

SKIP_STATUS = ("breakdown", "routine")
DONE = ("done", "partial", "extra", "done_cur")


class Node:
    def __init__(self, label, depth, sys=None, key=None):
        self.label = label
        self.depth = depth
        self.sys = sys
        self.key = key
        self.children = []
        self.tasks = []  # TaskRow
        self.code = None
        self.label_comment = None

    def add(self, n):
        self.children.append(n)
        return n


class TaskRow:
    def __init__(self, w, ti, targets, cycle, costk, key, code=None, breakdown=False):
        self.w = w
        self.ti = ti
        self.targets = targets
        self.cycle = cycle
        self.costk = costk
        self.key = key
        self.code = code
        self.breakdown = breakdown


def build_tree(W, doc, electrical):
    """設備 → 機器 → 号炉・系統 → 部位・No. の木。electrical が None なら全部、True なら電気・計装だけ。"""
    r = rng_for(W.seed, "chart-names", doc["stem"])
    nm = W.rules["naming"]
    fstyles = doc.get("furnaceStyle", [0])
    ustyles = doc.get("unitStyle", [0])
    nv = doc.get("nameVariant", 0)
    names = doc.get("names", {})
    excl = set(doc.get("chartExclude", []))
    roots = []
    sysv = doc.get("sysVariant", 0)

    cur_fstyle = [fstyles[0]]

    def fl(f):
        return fill(nm["furnace"]["chart"][cur_fstyle[0]], f)

    def ul(i):
        return fill(nm["unit"]["chart"][r.choice(ustyles)], i)

    # 炉全体・施設全体の節
    top = Node(doc.get("topLabel", W.text("chartTop")), 0, sys="FAC")
    if W.rules.get("outageRows") and W.F >= 1:
        orow = W.rules["outageRows"]
        fur = top.add(Node(doc.get("furnaceAllLabel", W.text("chartUnitsAll")), 1))
        for f in range(1, W.F + 1):
            n = fur.add(Node(fl(f), 2))
            n.tasks.append(TaskRow(orow["furnace"]["w"][doc.get("outageW", 0)], "OUT", [f"F-{f}"], 1, None, "_F"))
        if W.F >= 2:
            n = top.add(Node(nm["common"]["chart"][doc.get("commonStyle", 1)], 1))
            n.tasks.append(TaskRow(orow["all"]["w"][doc.get("outageW", 0)], "ALL", ["ALL"], 1, None, "_ALL"))
    for t in W.rules["catalog"]:
        if t["sys"] == "FAC" and W.applies(t) and t["key"] not in excl:
            n = top.add(Node(t["chart"][0], 1, key=t["key"]))
            for ti, task in enumerate(t["tasks"]):
                n.tasks.append(TaskRow(task["w"], ti, [u["id"] for u in W.units_of(t["key"])], task["c"], task["k"], t["key"]))
    if W.upgrade:
        n = top.add(Node(W.upgrade["title"], 1))
        n.tasks.append(TaskRow("長寿命化（交付金）", 99, [w["asset"] for w in W.works if w["ti"] == 99], None, None, "_UP"))
        n.upgrade = True
    if electrical is not True:
        roots.append(top)

    for s in W.rules["systems"]:
        if s["key"] == "FAC":
            continue
        if electrical is True and not s.get("electrical"):
            continue
        if electrical is False and s.get("electrical"):
            continue
        tpls = [t for t in W.rules["catalog"] if t["sys"] == s["key"] and W.applies(t) and t["key"] not in excl]
        if not tpls:
            continue
        sn = Node(s["chart"][sysv % len(s["chart"])], 0, sys=s["key"])
        roots.append(sn)
        under = {}
        for t in tpls:
            units = W.units_of(t["key"])
            if not units:
                continue
            label = t["chart"][names.get(t["key"], nv) % len(t["chart"])]
            cur_fstyle[0] = r.choice(fstyles)  # 号炉の書き方は機器ごとに揺れる
            parent = under.get(t.get("under"), sn)
            tn = parent.add(Node(label, parent.depth + 1, sys=s["key"], key=t["key"]))
            under[t["key"]] = tn
            if label != t["name"] and r.random() < doc.get("nameComment", 0.35):
                tn.label_comment = f"完成図書では「{t['name']}」"
            mode = t.get("chartRow", "unit")
            unit_tasks = [(ti, x) for ti, x in enumerate(t["tasks"]) if not x.get("p")]
            part_tasks = [(ti, x) for ti, x in enumerate(t["tasks"]) if x.get("p")]
            parts = t.get("parts", [])

            def add_tasks(node, tlist, tg_ids, mult=1, code=None):
                for ti, x in tlist:
                    node.tasks.append(TaskRow(x["w"], ti, tg_ids, x["c"], x["k"] * mult, t["key"], code=code))

            def add_parts(node, base_units, pf=None):
                for p in parts:
                    pts = [ti_x for ti_x in part_tasks if ti_x[1]["p"] == p]
                    if not pts:
                        continue
                    ids = [a["id"] for a in W.assets if a["parent"] in [u["id"] for u in base_units] and a["part"] == p
                           and (pf is None or a.get("partFurnace") == pf)]
                    pn = node.add(Node(p, node.depth + 1, key=t["key"]))
                    add_tasks(pn, pts, ids)

            if t["scope"] == "furnace" and W.F > 1 and mode != "pair":
                for f in range(1, W.F + 1):
                    fus = [u for u in units if u["furnace"] == f]
                    fn = tn.add(Node(fl(f) if not t.get("nameWithFurnace") else fl(f), tn.depth + 1, key=t["key"]))
                    if len(fus) > 1 and mode == "unit":
                        for u in fus:
                            un = fn.add(Node(ul(u["unit"]), fn.depth + 1, key=t["key"]))
                            add_tasks(un, unit_tasks, [u["id"]], code=u["tag"])
                            un.code = u["tag"]
                            add_parts(un, [u])
                    else:
                        add_tasks(fn, unit_tasks, [u["id"] for u in fus], mult=len(fus),
                                  code=fus[0]["tag"] if len(fus) == 1 else None)
                        fn.code = fus[0]["tag"] if len(fus) == 1 else None
                        add_parts(fn, fus)
            elif mode == "pair" or (t["scope"] == "furnace" and W.F == 1):
                add_tasks(tn, unit_tasks, [u["id"] for u in units], mult=len(units))
                add_parts(tn, units)
            else:
                if len(units) > 1 and mode == "unit":
                    for u in units:
                        un = tn.add(Node(ul(u["unit"]), tn.depth + 1, key=t["key"]))
                        add_tasks(un, unit_tasks, [u["id"]], code=u["tag"])
                        un.code = u["tag"]
                        add_parts(un, [u])
                else:
                    add_tasks(tn, unit_tasks, [u["id"] for u in units], mult=len(units),
                              code=units[0]["tag"] if len(units) == 1 else None)
                    tn.code = units[0]["tag"] if len(units) == 1 else None
                    if t.get("partsPerFurnace") and W.F > 1:
                        for pf in range(1, W.F + 1):
                            fn = tn.add(Node(fill(nm["furnace"]["chart"][2], pf), tn.depth + 1, key=t["key"]))
                            add_parts(fn, units, pf=pf)
                    else:
                        add_parts(tn, units)
            # 事後の補修の行（星取表にはほとんど書かない）
            if doc.get("breakdownRows") and r.random() < 0.18:
                brk = [w for w in W.works if w["key"] == t["key"] and w["status"] == "breakdown"]
                if brk:
                    tn.tasks.append(TaskRow("補修（事後）", "BRK", [u["id"] for u in units], "—", None, t["key"], breakdown=True))
    return roots


def flatten(roots):
    """木を行に。行は (node, task, path, first) の並び。"""
    out = []

    def walk(n, path):
        p = path + [n.label]
        if n.tasks:
            for i, t in enumerate(n.tasks):
                out.append({"node": n, "task": t, "path": p, "first": i == 0})
        else:
            out.append({"node": n, "task": None, "path": p, "first": True})
        for c in n.children:
            walk(c, p)

    for rt in roots:
        walk(rt, [])
    return out


def task_works(W, row_task, fy=None):
    tg = set(row_task.targets)
    out = []
    for w in W.works:
        if w["asset"] not in tg:
            continue
        if row_task.breakdown:
            if w["status"] != "breakdown":
                continue
        else:
            if w["status"] in SKIP_STATUS or w["ti"] != row_task.ti:
                continue
        if fy is not None and w["fy"] != fy:
            continue
        out.append(w)
    return out


def symbols(W, rt, years, legend, r, file, cellmap_hint):
    """年度ごとの記号（書いてあるもの）と、世界の正解との食い違い。"""
    rates = W.rates
    by = defaultdict(list)
    for w in task_works(W, rt):
        by[w["fy"]].append(w)
    marks = {}
    plans = {}
    errs = []
    for y in years:
        ws = by.get(y, [])
        if not ws:
            continue
        planned = any(w["plannedFy"] == y for w in ws)
        done = [w for w in ws if w["status"] in DONE]
        post = any(w["status"] == "postponed" for w in ws)
        partial = any(w["status"] == "partial" for w in done)
        if rt.breakdown:
            if done and r.random() < 0.85:
                marks[y] = "●"
            continue
        if legend == "pa":
            if planned:
                plans[y] = "○"
            if done:
                marks[y] = "△" if partial else "●"
        elif legend == "simple":
            if done:
                marks[y] = "▲" if partial else "●"
            elif post:
                marks[y] = "○→" if r.random() < 0.5 else "延期"
            elif planned:
                marks[y] = "○"
        else:
            if done:
                if partial:
                    marks[y] = "△"
                elif planned:
                    marks[y] = "◎"
                else:
                    marks[y] = "●"
            elif post:
                marks[y] = "○→" if r.random() < 0.6 else "○"
            elif planned:
                marks[y] = "○"
        # 最後の年度は一部だけ反映
        if y == W.today_fy and done and r.random() > rates["lastYearReflected"]:
            if legend == "pa":
                marks.pop(y, None)
            else:
                marks[y] = "○" if planned else None
                if marks[y] is None:
                    marks.pop(y)
            errs.append({"type": "lastYearUnreflected", "works": [w["id"] for w in done], "year": y})
        elif y < W.today_fy and done and r.random() < rates["omitMark"]:
            if legend == "pa":
                marks.pop(y, None)
            else:
                if planned:
                    marks[y] = "○"
                else:
                    marks.pop(y, None)
            errs.append({"type": "omitMark", "works": [w["id"] for w in done], "year": y})
    # 年度の書き間違い（隣の年度へずれる）
    for y in list(marks):
        if y < W.today_fy - 1 and marks[y] in ("◎", "●") and r.random() < rates["wrongYear"]:
            ny = y + r.choice([-1, 1])
            if ny in years and ny not in marks and ny < W.today_fy:
                marks[ny] = marks.pop(y)
                errs.append({"type": "wrongYear", "works": [w["id"] for w in by[y] if w["status"] in DONE],
                             "year": y, "writtenYear": ny})
    return marks, plans, errs


def write_chart(W, doc, outdir, answers, evidences):
    stem = doc["stem"]
    fname = f"{FAKE}{W.fac['short']}_{stem}.xlsx"
    r = rng_for(W.seed, "chart", stem)
    bk = Book(f"{FAKE}{W.fac['name']} {doc.get('title', '星取表')}", f"{FAKE}{W.fac['owner']} {doc.get('author', '施設管理課')}")
    ans = Answer(fname, True)
    sheets = []
    if doc.get("elecSheet"):
        sheets.append((doc.get("sheetMech", "星取表（機械設備）"), False, doc))
        e = dict(doc)
        e.update(doc["elecSheet"])
        sheets.append((doc.get("sheetElec", "星取表（電気・計装）"), True, e))
    else:
        sheets.append((doc.get("sheetName", "星取表"), None, doc))
    for sname, elec, sd in sheets:
        write_sheet(W, bk.sheet(sname), sd, elec, ans, r, fname)
    if doc.get("mgmtSheet"):
        write_mgmt(W, bk.sheet(doc["mgmtSheet"].get("name", "機器別管理基準")), doc["mgmtSheet"], ans, r, fname)
    if doc.get("notes"):
        ws = bk.sheet("注記")
        ws.put(1, 1, f"{FAKE}{W.fac['name']}（架空）の施設保全計画の注記。施設・機器・業者・金額はすべて架空です。", bold=True)
        for i, line in enumerate(doc["notes"]):
            ws.put(3 + i, 1, line)
        ws.width(1, 110)
    bk.save(outdir / fname)
    answers[fname] = ans
    return fname


def header_years(W, sd):
    return list(range(sd["yearsFrom"], sd["yearsTo"] + 1))


def write_sheet(W, S, sd, elec, ans, r, fname):
    years = header_years(W, sd)
    roots = build_tree(W, sd, elec)
    rows = flatten(roots)
    layout = sd.get("layout", "cols")
    legend = sd.get("legend", "pd")
    header = sd.get("header", "era2")
    unit = sd.get("costUnit", "千円")
    scale = W.fac.get("costScale", 1.0)
    has_code = sd.get("codeCol", False)
    maxdepth = max(len(x["path"]) for x in rows)
    # 列の配置
    c = 1
    if layout == "cols":
        name_cols = list(range(1, maxdepth + 1))
        c = maxdepth + 1
    elif layout == "numbered":
        no_col = 1
        name_cols = [2]
        c = 3
    elif layout == "merged":
        name_cols = list(range(1, maxdepth + 1))
        c = maxdepth + 1
    else:
        name_cols = [1]
        c = 2
    code_col = None
    if has_code:
        code_col = c
        c += 1
    work_col = c
    cyc_col = c + 1
    cost_col = c + 2 if unit else None
    c = c + 3 if unit else c + 2
    ycols = {}
    per = 2 if legend == "pa" else 1
    for y in years:
        ycols[y] = c
        c += per
    memo_col = c
    last_col = c
    # 題と凡例
    title = sd.get("titleText", f"{W.fac['name']}（架空）　施設保全計画　{S.title}")
    S.put(1, 1, title, bold=True, size=13)
    S.put(2, 1, f"{FAKE}施設・機器・業者・数値はすべて架空です。")
    S.put(2, max(work_col, last_col - 4), f"作成：{sd.get('author', '保全係')}　最終更新：{wareki_dot(W.today, gannen=True)}")
    legends = {"pd": "凡例　○：計画　◎：計画どおり実施　●：実施（計画外・延期後）　△：一部実施　○→：延期",
               "simple": "凡例　○：予定　●：実績",
               "pa": "凡例　予定欄 ○：予定　　実績欄 ●：実施　△：一部実施"}
    legend_top = sd.get("legendTop", True)
    if legend_top:
        S.put(3, 1, legends[legend])
    hr = 5
    hdr_rows = 2 if header in ("era2", "pa", "eraStack") else 1
    base_rows = hdr_rows
    pa_sub = legend == "pa" and header != "pa"
    if pa_sub:
        hdr_rows += 1
    # 見出し
    labels = sd.get("colLabels", {})
    if layout in ("cols", "merged"):
        heads = labels.get("names", W.text("chartHeads"))
        if layout == "cols":
            S.put(hr, 1, labels.get("name", "設備・機器名称"), bold=True, box=True)
            S.merge(hr, 1, hr + hdr_rows - 1, maxdepth)
        else:
            for i in range(maxdepth):
                S.put(hr, i + 1, heads[i], bold=True, box=True)
                if hdr_rows > 1:
                    S.merge(hr, i + 1, hr + hdr_rows - 1, i + 1)
    elif layout == "numbered":
        S.put(hr, 1, "No.", bold=True, box=True)
        S.put(hr, 2, labels.get("name", "設備・機器名称"), bold=True, box=True)
        if hdr_rows > 1:
            S.merge(hr, 1, hr + 1, 1)
            S.merge(hr, 2, hr + 1, 2)
    else:
        S.put(hr, 1, labels.get("name", "機器・装置名"), bold=True, box=True)
        if hdr_rows > 1:
            S.merge(hr, 1, hr + 1, 1)
    for col, lab in ((code_col, "機器番号"), (work_col, labels.get("work", "点検・整備内容")),
                     (cyc_col, labels.get("cycle", "周期\n(年)")),
                     (cost_col, labels.get("cost", f"概算費用\n({unit}/回)"))):
        if col:
            S.put(hr, col, lab, bold=True, box=True, wrap=True, align="center")
            if hdr_rows > 1:
                S.merge(hr, col, hr + 1, col)
    if header == "era2":
        for y in years:
            S.put(hr, ycols[y], era_fy(y), bold=True, box=True, align="center")
            S.put(hr + 1, ycols[y], y, box=True, align="center")
    elif header == "eraNL":
        for y in years:
            S.put(hr, ycols[y], f"{era_fy(y)}\n({y})", bold=True, box=True, align="center", wrap=True)
    elif header == "fy4":
        for y in years:
            S.put(hr, ycols[y], f"{y}年度", bold=True, box=True, align="center")
    elif header == "pa":
        for y in years:
            S.put(hr, ycols[y], f"{era_fy(y, 'full')}年度" if sd.get("paFull") else f"{era_fy(y)}年度", bold=True, box=True, align="center")
            S.merge(hr, ycols[y], hr, ycols[y] + 1)
            S.put(hr + 1, ycols[y], "予定", box=True, align="center")
            S.put(hr + 1, ycols[y] + 1, "実績", box=True, align="center")
    elif header == "eraStack":
        h = [y for y in years if y < 2019]
        rr = [y for y in years if y >= 2019]
        if h:
            S.put(hr, ycols[h[0]], "平　成", bold=True, align="center", box=True)
            S.merge(hr, ycols[h[0]], hr, ycols[h[-1]])
        if rr:
            S.put(hr, ycols[rr[0]], "令　和", bold=True, align="center", box=True)
            S.merge(hr, ycols[rr[0]], hr, ycols[rr[-1]])
        for y in years:
            n = y - 1988 if y < 2019 else y - 2018
            S.put(hr + 1, ycols[y], "元" if (y == 2019) else n, box=True, align="center")
    if pa_sub:
        # 年度の見出しの下に「予定／実績」の段を足し、年度の見出しは 2 列に結合する
        for y in years:
            S.put(hr + base_rows, ycols[y], "予定", box=True, align="center")
            S.put(hr + base_rows, ycols[y] + 1, "実績", box=True, align="center")
            for rr_ in range(hr if header != "eraStack" else hr + 1, hr + base_rows):
                S.merge(rr_, ycols[y], rr_, ycols[y] + 1)
    S.put(hr, memo_col, "備考", bold=True, box=True)
    if hdr_rows > 1:
        S.merge(hr, memo_col, hr + 1, memo_col)
    # 年度の列の表し方（網掛けで実績と計画を分ける）
    shade_future = sd.get("shadeFuture", "EAF1FB")
    row = hr + hdr_rows
    totals_top = sd.get("totalsTop", False)
    total_row = None
    if totals_top:
        total_row = row
        row += 1
    # 本体
    sub_systems = set(sd.get("subtotals", []))
    summary_sys = set(sd.get("parentSummary", []))
    yearly = defaultdict(float)
    sys_cost = defaultdict(float)
    numbering = {}
    counters = [0] * 10
    parent_rows = []  # (row, node, sys) まとめの印を後で書く
    item_marks_by_node = defaultdict(list)
    cur_sys = None
    sys_first_row = {}
    sys_last_row = {}
    breakdown_memo = {}
    if sd.get("breakdownMemo", True):
        for w in W.works:
            if w["status"] == "breakdown" and r.random() < W.rates["breakdownInChart"]:
                breakdown_memo.setdefault(w["key"], []).append(w)
    name_fmt_prefix = sd.get("sysPrefix", "num")

    def write_label(rw, node, path):
        depth = len(path) - 1
        lab = node.label
        written = lab
        if depth == 0:
            idx = len(sys_first_row) - 1  # 節の番号（炉全体・施設全体が 0）
            if name_fmt_prefix == "num":
                written = f"{zen_digits(str(idx)) if idx % 2 else idx}．{lab}" if idx else f"0.{lab}"
            elif name_fmt_prefix == "paren":
                written = f"({idx}) {lab}"
            elif name_fmt_prefix == "box":
                written = f"■{lab}"
        if layout == "cols" or layout == "merged":
            col = name_cols[min(depth, len(name_cols) - 1)]
            a = S.put(rw, col, written, bold=depth == 0)
            return a, written, col
        elif layout == "numbered":
            counters[depth] += 1
            for k in range(depth + 1, 10):
                counters[k] = 0
            num = "-".join(str(counters[k]) for k in range(depth + 1))
            S.put(rw, 1, num)
            a = S.put(rw, 2, written, bold=depth == 0, indent=depth * 2)
            return a, written, 2
        else:
            pre = "　" * depth + ("・" if depth >= 2 and sd.get("bullets", True) else "")
            written = pre + written if depth else (f"■{lab}" if name_fmt_prefix == "box" else written)
            a = S.put(rw, 1, written, bold=depth == 0)
        return a, written, 1

    rows_out = []
    for x in rows:
        node, task, path = x["node"], x["task"], x["path"]
        depth = len(path) - 1
        if depth == 0:
            if cur_sys is not None and cur_sys in sub_systems:
                rows_out.append(("subtotal", row, cur_sys))
                row += 1
            cur_sys = node.sys
            sys_first_row[node.sys] = row
        sys_last_row[cur_sys] = row
        rec_fields = {"path": [p for p in path]}
        evc = []
        comments = {}
        if x["first"]:
            a, written, lcol = write_label(row, node, path)
            evc.append(ev(a, written))
            if node.label_comment:
                S.memo(row, lcol, node.label_comment)
                comments[a] = node.label_comment
        elif layout == "merged" and sd.get("ditto") and r.random() < sd["ditto"]:
            # 上と同じ名前を「〃」で書く（正解の path は意味の名前）
            col = name_cols[min(depth, len(name_cols) - 1)]
            evc.append(ev(S.put(row, col, "〃", align="center"), "〃"))
        if task is None:
            kind = "parent"
            if node.sys in summary_sys and depth >= 1 and node.children:
                parent_rows.append((row, node))
            ans.rec("parent", {"path": path, **({"comments": comments} if comments else {})}, evc, sheet=S.title, r=row)
            S.group_row(row, depth if sd.get("groups") else 0)
            row += 1
            continue
        # 作業の行
        kind = "parent" if (x["first"] and node.children) else "item"
        code = task.code if code_col else None
        if code_col and code and x["first"]:
            evc.append(ev(S.put(row, code_col, code), code))
            rec_fields["code"] = code
        elif code_col and code and not x["first"] and r.random() < 0.5:
            evc.append(ev(S.put(row, code_col, code), code))
            rec_fields["code"] = code
        wtext = task.w
        if r.random() < sd.get("workNewline", 0.04) and "（" not in wtext:
            wtext = wtext + "\n（OH）" if "整備" in wtext else wtext
        evc.append(ev(S.put(row, work_col, wtext, wrap="\n" in wtext), wtext))
        rec_fields["work"] = wtext
        if task.cycle is not None:
            cy = task.cycle
            if cy != "—" and r.random() < W.rates["cycleAsText"]:
                cyw = f"{cy}年"
            else:
                cyw = cy
            evc.append(ev(S.put(row, cyc_col, cyw, align="center"), cyw))
            if cy != "—":
                rec_fields["cycle"] = cy
            else:
                rec_fields["cycle"] = "—"
        cost = None
        if cost_col and task.costk:
            ck = round(task.costk * scale / 100) * 100 if task.costk >= 1000 else round(task.costk * scale / 10) * 10
            cost = ck if unit == "千円" else ck * 1000
            if not sd.get("costSparse") or r.random() < 0.8:
                evc.append(ev(S.put(row, cost_col, cost, fmt="#,##0"), cost))
                rec_fields["cost"] = cost
                rec_fields["unit"] = unit
                sys_cost[cur_sys] += cost
            else:
                cost = None
        marks, plans, errs = symbols(W, task, years, legend, r, fname, None)
        if node.key == "_UP" or getattr(node, "upgrade", False):
            ys = [y for y in W.upgrade["years"] if y in ycols]
            if ys:
                txt = "◀ 基幹的設備改良工事 ▶" if legend != "pa" else "基幹的設備改良工事（継続費）"
                a = S.put(row, ycols[ys[0]], txt, align="center", fill="FFF2CC")
                S.merge(row, ycols[ys[0]], row, ycols[ys[-1]] + (1 if legend == "pa" else 0))
                marks = {y: txt for y in ys}
                evc.append(ev(a, txt))
                for y in ys:
                    for w in task_works(W, task, y):
                        W.link(w["id"], fname, sheet=S.title, r=row, year=y)
                memo = f"{era_fy(ys[0])}～{era_fy(ys[-1])}　継続費"
                evc.append(ev(S.put(row, memo_col, memo), memo))
                rec_fields["memo"] = memo
                um = W.text("upgradeMemo").format(y0=era_fy(ys[0]), y1=era_fy(ys[1]), y2=era_fy(ys[-1]))
                S.memo(row, ycols[ys[0]], um)
                comments[addr(row, ycols[ys[0]])] = um
                rec_fields["marks"] = {str(y): txt for y in ys}
                if comments:
                    rec_fields["comments"] = comments
                ans.rec(kind, rec_fields, evc, sheet=S.title, r=row)
                row += 1
                continue
        for e in errs:
            W.erratum(file=fname, sheet=S.title, r=row, **e)
        out_marks = {}
        for y, sym in sorted(marks.items()):
            a = S.put(row, ycols[y] + (1 if legend == "pa" else 0), sym, align="center",
                      fill=shade_future if (y > W.today_fy and shade_future) else None)
            evc.append(ev(a, sym))
            out_marks[str(y)] = sym
            if cost:
                yearly[y] += cost
        out_plans = {}
        for y, sym in sorted(plans.items()):
            a = S.put(row, ycols[y], sym, align="center", fill=shade_future if (y > W.today_fy and shade_future) else None)
            evc.append(ev(a, sym))
            out_plans[str(y)] = sym
            if cost and y not in marks:
                yearly[y] += cost
        if out_marks:
            rec_fields["marks"] = out_marks
        if out_plans:
            rec_fields["plans"] = out_plans
        # 正解の結び（書いた記号の年度と、世界の作業）
        moved = {e["writtenYear"]: e["year"] for e in errs if e["type"] == "wrongYear"}
        for ys, sym in list(marks.items()) + list(plans.items()):
            src = moved.get(ys, ys)
            for w in task_works(W, task, src):
                W.link(w["id"], fname, sheet=S.title, r=row, year=ys)
        # メモ（延期・計画外）
        if sd.get("memoComments", True):
            for w in task_works(W, task):
                if w["status"] == "postponed" and w["fy"] in ycols and marks.get(w["fy"]) in ("○→", "○", "延期", None) and r.random() < 0.7:
                    txt = f"{era_fy(w['fy'])}予定 → {era_fy(w['fy'] + 1)}に延期（予算の都合）"
                    col = ycols[w["fy"]]
                    S.memo(row, col, txt)
                    comments[addr(row, col)] = txt
                elif w["status"] == "extra" and w["fy"] in ycols and r.random() < 0.6:
                    txt = f"{era_fy(w['fy'])} 臨時で実施（計画外）"
                    col = ycols[w["fy"]] + (1 if legend == "pa" else 0)
                    if addr(row, col) not in comments:
                        S.memo(row, col, txt)
                        comments[addr(row, col)] = txt
        # 備考
        memo_parts = []
        if x["first"]:
            for w in breakdown_memo.get(task.key, []):
                if w["asset"] in task.targets or W.aidx[w["asset"]]["parent"] in task.targets:
                    memo_parts.append(f"{wareki_dot(w['start'])} {w['task']}（臨時）")
                    W.link(w["id"], fname, sheet=S.title, r=row, how="memo")
            for tid in task.targets:
                a = W.aidx[tid]
                if a.get("added") and a["installed"] in ycols:
                    memo_parts.append(f"{era_fy(a['installed'])} 新設")
                    break
        if W.cat.get(task.key, {}).get("tasks") and isinstance(task.ti, int) and 0 <= task.ti < 90:
            tdef = W.cat[task.key]["tasks"][task.ti]
            if tdef["a"] == "REPLACE" and tdef["c"] >= 8:
                done_years = sorted({w["fy"] for w in task_works(W, task) if w["status"] in DONE})
                if done_years and r.random() < 0.6:
                    memo_parts.append(f"{era_fy(done_years[-1])} 更新")
                nxt = [w["fy"] for w in task_works(W, task) if w["status"] == "planned" and w["fy"] > sd["yearsTo"]]
                if not nxt and done_years and done_years[-1] + tdef["c"] > sd["yearsTo"] and r.random() < 0.5:
                    memo_parts.append(f"{era_fy(done_years[-1] + tdef['c'], 'abn')}に更新の予定")
        if memo_parts:
            memo = "　".join(memo_parts[:2])
            evc.append(ev(S.put(row, memo_col, memo), memo))
            rec_fields["memo"] = memo
        if comments:
            rec_fields["comments"] = comments
        ans.rec(kind, rec_fields, evc, sheet=S.title, r=row)
        for tid in task.targets:
            W.seen_name(tid, fname, " › ".join(path))
        item_marks_by_node[node].append(marks)
        S.group_row(row, depth if sd.get("groups") else 0)
        row += 1
    if cur_sys in sub_systems:
        rows_out.append(("subtotal", row, cur_sys))
        row += 1
    # まとめの印（親の行に下の行のまとめ。正解には入れない）
    def desc_marks(n):
        out = list(item_marks_by_node.get(n, []))
        for c in n.children:
            out += desc_marks(c)
        return out

    for prow, node in parent_rows:
        ms = desc_marks(node)
        for y in years:
            syms = [m.get(y) for m in ms if m.get(y)]
            if not syms:
                continue
            s = "◎" if any(x in ("◎", "●", "△") for x in syms) else "○"
            if legend == "simple":
                s = "●" if any(x in ("●", "▲") for x in syms) else "○"
            if legend == "pa":
                continue
            S.put(prow, ycols[y], s, align="center", color="7F7F7F")
    # 小計（行の位置は書いた順に後から差し込めないので、節の終わりの空けた行に書く）
    mismatch = sd.get("mismatchSubtotal")
    for _, srow, sk in rows_out:
        label = "　小計（" + W.sys[sk]["chart"][sd.get("sysVariant", 0) % 3] + "）"
        val = sys_cost[sk]
        if mismatch == sk:
            val = val + sd.get("mismatchBy", 12000)
            W.gap(kind="subtotal_mismatch", check=None, file=fname, sheet=S.title, r=srow,
                  note=f"小計 {val:,.0f} は上の行の費用の和 {sys_cost[sk]:,.0f} と合わない（差 {sd.get('mismatchBy', 12000):,}）")
        S.put(srow, 1, label, bold=True)
        if cost_col:
            S.put(srow, cost_col, val, bold=True, fmt="#,##0")
        ans.rec("subtotal", {}, [ev(addr(srow, 1), label)], sheet=S.title, r=srow)
    # 合計（年度ごと）
    if cost_col and sd.get("yearTotals", True):
        if total_row is None:
            total_row = row
            row += 1
        lab = sd.get("totalLabel", f"年度別概算費用　計（{unit}）")
        S.put(total_row, 1, lab, bold=True)
        evc = [ev(addr(total_row, 1), lab)]
        for y in years:
            if yearly.get(y):
                S.put(total_row, ycols[y] + (1 if legend == "pa" else 0), int(yearly[y]), bold=True, fmt="#,##0")
        ans.rec("total", {}, evc, sheet=S.title, r=total_row)
    # 表の下の凡例と注記
    row += 1
    if not legend_top:
        S.put(row, 1, legends[legend])
        row += 1
    for note in sd.get("footNotes", []):
        S.put(row, 1, note.replace("{last}", era_fy(W.today_fy)))
        row += 1
    # 1 シートに 2 つ目の表（法定の点検の一覧）
    if sd.get("secondTable"):
        row = write_second_table(W, S, sd, ans, row + 1, fname)
    # 体裁
    for i, col in enumerate(name_cols):
        S.width(col, 4 if (layout == "cols" and i < len(name_cols) - 1) else 26)
    if layout == "merged":
        for col in name_cols:
            S.width(col, 16)
        _merge_systems(S, name_cols[0], sys_first_row, sys_last_row, ans)
    S.width(work_col, 26)
    S.width(memo_col, 34)
    for y in years:
        S.width(ycols[y], 5.5)
        if legend == "pa":
            S.width(ycols[y] + 1, 5.5)
    for y in years[: sd.get("hideYears", 0)]:
        S.hide_col(ycols[y])
        if legend == "pa":
            S.hide_col(ycols[y] + 1)
    S.ws.freeze_panes = S.ws.cell(row=hr + hdr_rows, column=work_col + 1)
    if sd.get("groups"):
        S.ws.sheet_properties.outlinePr.summaryBelow = False


def _merge_systems(S, col, first, last, ans):
    """縦に結合した大分類（設備の列）。"""
    for k, a in first.items():
        b = last.get(k, a)
        if b > a:
            S.merge(a, col, b, col)


def write_second_table(W, S, sd, ans, row, fname):
    """同じシートの下に、法定の点検の一覧をもう 1 つ置く（見出しが途中で変わる）。"""
    S.put(row, 1, "法定点検等　実施予定一覧", bold=True, size=11)
    row += 1
    heads = ["区分", "点検・検査", "根拠", "周期", "次回予定", "所管"]
    for i, h in enumerate(heads):
        S.put(row, 1 + i, h, bold=True, box=True)
    row += 1
    for lg in W.rules["legal"]:
        ws = [w for w in W.works if w.get("legal") == lg["key"]]
        if not ws:
            continue
        nxt = sorted(w["start"] for w in ws if w["status"] == "planned")
        cyc = f"{lg['cycle']}年" if lg.get("cycle") else f"年{lg['perYear']}回"
        vals = ["法定" if lg["level"] != "recommendation" else "通知", lg["name"], lg["basis"].split("（")[0], cyc,
                wareki_dot(nxt[0]) if nxt else "—", "施設係"]
        evc = []
        for i, v in enumerate(vals):
            evc.append(ev(S.put(row, 1 + i, v, box=True), v))
        ans.rec("item", {"区分": vals[0], "点検・検査": vals[1], "根拠": vals[2], "周期": vals[3], "次回予定": vals[4], "所管": vals[5]},
                evc, sheet=S.title, r=row)
        row += 1
    return row


def write_mgmt(W, S, md, ans, r, fname):
    """長寿命化の計画の機器別管理基準（保全方式の列が無い：計画の欠け）。健全度は 4 段。"""
    S.put(1, 1, f"{W.fac['name']}（架空）　機器別管理基準", bold=True, size=13)
    S.put(2, 1, f"{FAKE}施設・機器・数値はすべて架空です。健全度は {era_fy(W.today_fy - 1)} 評価（4：健全 … 1：要更新）")
    cols = ["設備・機器", "対象箇所", "診断項目", "評価方法", "管理値", "診断頻度", "目標耐用年数", "健全度"]
    if md.get("withStrategy"):
        cols.insert(3, "保全方式")
    for i, h in enumerate(cols):
        S.put(4, 1 + i, h, bold=True, box=True)
    row = 5
    pick = md["items"]
    health_bad = md.get("bad", {})
    odd = md.get("outOfScale", {})
    for key in pick:
        if key not in W.cat or not W.applies(W.cat[key]):
            continue
        t = W.cat[key]
        for u in W.units_of(key):
            if t["scope"] == "furnace" and u["unit"] not in (None, 1):
                continue
            nm = t["chart"][0] + (f"（{W.unit(u['furnace'])}）" if u["furnace"] else "")
            it = md["defs"].get(key, ["本体", "外観・異音・振動", "目視・測定", "異常なきこと", "1年"])
            hv = health_bad.get(u["id"], odd.get(u["id"], r.choice([3, 3, 4, 4, 2, 3])))
            vals = [nm, it[0], it[1], it[2], it[3], it[4], md.get("life", {}).get(key, 20), hv]
            if md.get("withStrategy"):
                vals.insert(3, "時間基準保全")
            evc = []
            f = {}
            for i, v in enumerate(vals):
                evc.append(ev(S.put(row, 1 + i, v, box=True), v))
                f[cols[i]] = v
            ans.rec("item", f, evc, sheet=S.title, r=row)
            if u["id"] in odd:
                W.gap(kind="scale_valid", check="scale_valid", file=fname, sheet=S.title, r=row,
                      note=f"健全度「{odd[u['id']]}」は 4 段（1〜4）の外")
            if u["id"] in health_bad:
                W.gap(kind="followup", check="followup", file=fname, sheet=S.title, r=row, asset=u["id"],
                      note=f"健全度 {health_bad[u['id']]} なのに、星取表に措置（整備・更新）の予定が無い")
            row += 1
    if not md.get("withStrategy"):
        W.gap(kind="plan_fields", check="plan_fields", file=fname, sheet=S.title,
              note="機器別管理基準に保全方式の列が無い（手引きの表Ⅱ-7 の作成例は保全方式を書く）")
    for i, w in enumerate([22, 14, 18, 14, 14, 10, 10, 8]):
        S.width(1 + i, w)
