"""施設ごとの README.md（わざと入れた揺れと食い違いの一覧）と user.md（担当者が知っていること）を書く。

README は作る側と測る人のためのもので、読み手には渡さない。user.md は担当者の言葉で、ファイルの読み方の手順や MOYAI の決定の形は書かない。
"""
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path

from .util import ROOT, era_fy

LEG = {
    "pd": "○ は計画、◎ は計画どおりにやった年、● は計画に無かったのにやった年（延期したあとにやった年も ●）、△ は一部だけやった年、○→ は延期",
    "simple": "○ は予定、● はやった年。▲ は一部だけやった年（凡例には書いていない）。「延期」や ○→ と書いた年もある",
    "pa": "年度ごとに「予定」と「実績」の 2 列。予定の欄の ○ は当初の計画、実績の欄の ● はやった年、△ は一部だけ",
}
HEAD = {
    "era2": "年度の見出しは 2 段で、上が和暦（H25・R元…）、下が西暦",
    "eraNL": "年度の見出しは 1 つのセルに「R2」と改行して「(2020)」",
    "fy4": "年度の見出しは「2019年度」の西暦",
    "pa": "年度の見出しは「R2年度」を 2 列に結合し、その下に予定・実績",
    "eraStack": "年度の見出しは元号を 1 段にまとめ（「平　成」「令　和」）、その下に年の数（元・2・3…）",
}
LAYOUT = {
    "cols": "設備 → 機器 → 号炉・系統 → 部位を、左から列をずらして書いた（列で字下げ）",
    "indent": "名前は 1 列。段は全角の空白で字下げし、深い段は「・」を付けた",
    "numbered": "番号の列（1 / 1-1 / 1-1-1）と名前の列。名前は書式のインデントで字下げ",
    "merged": "大分類の列を縦に結合し、機器・号炉・部位を列に分けた。上と同じ名前は「〃」や空欄",
}


def _docs(W, t):
    return [d for d in W.fac["docs"] if d["type"] == t]


def readme(W, answers, fac_dir: Path):
    L = []
    p = W.prof
    name = W.fac["name"]
    rel = fac_dir.relative_to(ROOT).as_posix()
    L.append(f"# 【架空】{name}（{W.fac['owner']}）— サンプルの世界")
    L.append("")
    L.append("すべて架空の施設です。実在の自治体・施設・会社・人とは関係ありません。施設の性質の分布だけを、公開の統計から加工して使いました（下の「出典と加工」）。")
    L.append("")
    L.append("この README は作る側と測る人のためのものです。読み手（AI）には渡しません。読み手の質問に答える役が見るのは `user.md` と `answer/world.json` だけです。")
    L.append("")
    L.append("## 施設の性質")
    L.append("")
    prof = __import__("maker.make", fromlist=["profile"]).profile(W)
    for k, v in prof.items():
        L.append(f"- `{k}`: {v}")
    L.append(f"- 物語の「今日」: {W.today.isoformat()}（{era_fy(W.today_fy)} 年度の途中）。乱数の種: {W.seed}")
    L.append("")
    L.append("## 作り直しの命令")
    L.append("")
    L.append("```")
    L.append(f"python samples/maker/make.py {rel}")
    L.append(f"python {rel}/gen/check.py")
    L.append("```")
    L.append("")
    L.append("世界の決まりは `packs/%s/world.json`、施設の設定は `gen/facility.json`。同じ命令で同じものができます（作り直すときは `samples/maker/make.py` の VERSION を上げる）。" % W.pack)
    L.append("")
    L.append("## 資料")
    L.append("")
    L.append("| ファイル | 何か | 正解の行 |")
    L.append("|---|---|---|")
    for fname, ans in answers.items():
        L.append(f"| `{fname}` | {_what(W, fname)} | {len(ans.records)} |")
    L.append("")
    L.append("## わざと入れた揺れと食い違い")
    L.append("")
    L.append("### 1. 資料の汚さ（取り込みが読み切るもの）")
    L.append("")
    for line in _dirt(W, answers):
        L.append(f"- {line}")
    L.append("")
    L.append("### 2. 資料どうしの書き方の違い（同じ機器・同じ作業を、資料ごとに違う形で書いた）")
    L.append("")
    for line in _cross(W, answers):
        L.append(f"- {line}")
    L.append("")
    L.append("### 3. 星取表の書き漏れ・年度の書き間違い・最後の年度の一部だけの反映")
    L.append("")
    cnt = Counter(e["type"] for e in W.errata)
    L.append(f"世界の割合（`packs/{W.pack}/world.json` の rates）：書き漏れ {W.rates['omitMark']:.0%}、年度の書き間違い {W.rates['wrongYear']:.0%}、"
             f"最後の年度の反映 {W.rates['lastYearReflected']:.0%}。入った数：書き漏れ {cnt.get('omitMark', 0)}、年度の書き間違い {cnt.get('wrongYear', 0)}、"
             f"最後の年度で反映していない {cnt.get('lastYearUnreflected', 0)}。全部は `answer/world.json` の `errata`。例：")
    L.append("")
    shown = defaultdict(int)
    for e in W.errata:
        if shown[e["type"]] >= 4:
            continue
        shown[e["type"]] += 1
        what = {"omitMark": "やったのに印が無い（○ のまま、か空欄）", "wrongYear": f"{e.get('year')} 年度の実施を {e.get('writtenYear')} 年度の列に書いた",
                "lastYearUnreflected": "今年度やったのに、まだ ○ のまま"}[e["type"]]
        w0 = W.widx[e["works"][0]] if e.get("works") else None
        lab = f"{W.aidx[w0['asset']]['name']} {w0['task']}" if w0 else ""
        L.append(f"- `{e['sheet']}` の {e['r']} 行（{lab}、{e.get('year')} 年度）：{what}")
    L.append("")
    L.append("### 4. 計画の欠け（MOYAI の検査が見つけるはずのもの）")
    L.append("")
    if W.gaps:
        L.append("| 欠け | 検査の種類 | どこ | 中身 |")
        L.append("|---|---|---|---|")
        for g in W.gaps:
            where = g.get("what") or (f"`{g.get('sheet')}` {g.get('r', '')} 行" if g.get("sheet") else "")
            L.append(f"| {g['kind']} | {g.get('check') or '（検査の種類に無い。欠けの種類で記録）'} | {where} | {g['note']} |")
    else:
        L.append("- 入れていない")
    L.append("")
    L.append("### 5. どの資料にも書いていない作業")
    L.append("")
    import json

    wj = json.loads((fac_dir / "answer" / "world.json").read_text(encoding="utf-8"))
    ur = wj["unrecordedByReason"]
    L.append(f"実際に行った作業 {wj['counts']['worksDone']} 件のうち、作業そのものを書いた行の結びがあるのは {wj['counts']['linkedWorks']} 件"
             f"（工事・委託の契約の行だけの結びは数えない）。結びの無い {wj['counts']['unrecorded']} 件の理由（1 件に複数の理由がある）：")
    L.append("")
    for k, v in sorted(ur.items(), key=lambda kv: -kv[1]):
        L.append(f"- {k}：{v} 件")
    L.append("")
    L.append("## 正解の形")
    L.append("")
    L.append("- `answer/files/<stem>.json`：ファイルごとの正解（作り手への指示書 §5.1）。Excel は `sheet` と `r`、CSV は `r`（1 行目が 1）、PDF は `seq`、写真は `seq` と `image`。")
    L.append("- 星取表の `path` は名前の頭の番号（「1.」「(1)」「■」）と字下げの空白・「・」を外した名前の並び。「〃」の行は意味の名前で書いた。`code` は機器番号の列があるときだけ。")
    L.append("- 予定と実績を 2 列に分けた星取表は、実績の列を `marks`、予定の列を `plans` に入れた。3 年度にまたがる結合のセル（基幹改良）は、結合が掛かる年度すべてに同じ文字を入れた。")
    L.append("- 写真の正解で、影やぼけで読めなくしたセルは「読めない」。")
    L.append("- `answer/world.json`：機器（1 台ずつ）・作業（属性・日付・工数・業者・契約）・契約・結び（`links`：どの資料のどの行がどの作業か）・書いていない作業と理由・計画の欠け・書き漏れ・施設の性質。")
    L.append("- `gen/evidence/<stem>.json`：正解の値が書いてあるセルの番地と値（`check.py` が照らす）。")
    L.append("")
    L.append("## 出典と加工")
    L.append("")
    if W.pack == "waste-incineration":
        L.append("- 施設の性質（炉型・処理能力の帯・蒸気タービン・灰処理・運営の形）は、環境省「一般廃棄物処理実態調査結果（令和 6 年度）施設の表（焼却施設）」から数だけを取り出した `packs/waste-incineration/national/table.json` の分布に寄せて選んだ（加工した）。表の行や施設名は写していない。")
    else:
        L.append("- し尿処理の施設の性質は、全国の表（同じ調査の 08.xlsx）から数をまだ取り出していないので、分布には照らしていない（未確認）。")
    L.append("- 機器の項目は、環境省の長寿命化総合計画作成の手引きの表Ⅱ-4（パックの `common.json`）。法令の点検の周期は、照らしたもの（精密機能検査の 3 年＝課長通知）だけを `recommendation` にし、ほかは `app`（`world.json` の legal）。")
    L.append("- 金額・工数・業者・型式・製造番号・人名はすべて架空。")
    (fac_dir / "README.md").write_bytes(("\n".join(L) + "\n").encode("utf-8"))


def _what(W, fname):
    if "星取表" in fname or "計画" in fname:
        return "年度の整備計画表（星取表）"
    if "作業日報" in fname:
        return "作業日報（年度のブック、月のシート、1 日 1 枚の帳票）"
    if "作業実績" in fname:
        return "委託先の業務の仕組みから書き出した作業の記録（CSV）"
    if "工程表" in fname:
        return "定期整備の工程表（年度のシート、週のガント）"
    if "発注台帳" in fname:
        return "発注台帳（年度のシート）"
    if "完成図書" in fname:
        return "完成図書 第3編 機器仕様一覧表（文字の PDF）"
    if "日常点検表" in fname:
        return "日常点検表を撮った写真"
    if "台帳" in fname:
        return "機器台帳"
    if "巡視" in fname or "点検" in fname:
        return "定期巡視点検の記録（CSV）"
    return ""


def _dirt(W, answers):
    out = []
    for d in W.fac["docs"]:
        t = d["type"]
        if t == "chart":
            f = [a for a in answers if d["stem"] in a][0]
            parts = [LAYOUT[d.get("layout", "cols")], HEAD[d.get("header", "era2")], f"凡例：{LEG[d.get('legend', 'pd')]}"]
            if d.get("hideYears"):
                parts.append(f"古い年度の列を {d['hideYears']} 列隠した（{era_fy(d['yearsFrom'])}〜）")
            if d.get("elecSheet"):
                e = d["elecSheet"]
                parts.append(f"機械と電気・計装を別のシートにした。電気・計装のシートは {LAYOUT[e.get('layout', 'indent')]}、{HEAD[e.get('header', 'eraNL')]}"
                             + (f"、年度は {era_fy(e['yearsFrom'])}〜{era_fy(e['yearsTo'])}" if e.get("yearsTo") else ""))
            parts.append("周期を「2年」と文字で書いた行が混ざる（数の行と文字の行）")
            parts.append("号炉の書き方が機器ごとに揺れる（" + "・".join(sorted({x for x in _furnace_forms(W, d)})) + "）")
            parts.append("1 台ずつの行と、" + ("2 炉で 1 行・" if W.F > 1 else "") + "台数をまとめて 1 行の機器が混ざる")
            parts.append("Excel のメモ：延期の理由（「R2予定 → R3に延期」）、計画外の臨時の実施、完成図書との名前の違い")
            parts.append("備考に取替・新設・更新（「R3 更新」）と、文の中の年度（「R18に更新の予定」）、事後の補修（「R5.3.8 …（臨時）」）")
            own = [x for x in answers[f].records if x["kind"] == "parent" and "work" in x["fields"]]
            if own:
                x = own[0]
                parts.append(f"自分の作業を持つ親の行（{x['sheet']} の {x['r']} 行「{' › '.join(x['fields']['path'])}」に「{x['fields']['work']}」、その下に子の行。ほかに {len(own) - 1} 行）")
            if d.get("parentSummary"):
                parts.append("親の行の灰色の印は下の行のまとめ（正解には入れない）")
            if d.get("subtotals"):
                parts.append("設備ごとの小計と年度ごとの合計（数の値）" + ("。合計の行が表の上" if d.get("totalsTop") else ""))
            if d.get("costUnit") == "円":
                parts.append("費用は円（ほかの施設は千円）")
            if d.get("groups"):
                parts.append("Excel の行のグループ（段ごとに畳める）")
            if d.get("secondTable"):
                parts.append("同じシートの下に 2 つ目の表（法定点検等の実施予定一覧。見出しが途中で変わる）")
            if d.get("mgmtSheet"):
                parts.append("機器別管理基準のシート（健全度の列。保全方式の列が無い）")
            if W.upgrade:
                parts.append(f"基幹的設備改良工事の行は {era_fy(W.upgrade['years'][0])}〜{era_fy(W.upgrade['years'][-1])} の 3 年度に結合したセル")
            parts.append("未来の年度の列を網掛けで分けた")
            if d.get("notes"):
                parts.append("注記のシート")
            out.append(f"`{f}`：" + "。".join(parts) + "。")
        elif t == "diary":
            out.append(f"作業日報（{era_fy(d['years'][0])}〜{era_fy(d['years'][1])}）：年度ごとのブック、月ごとのシート、1 日 1 枚の帳票。12 行を超える日は続紙（「作業日報（続紙）」、頁 2/2）。"
                       f"{era_fy(d.get('formatChange', 0))} 年度から様式が変わる（それより前は和暦の文字の日付・人員と延べ時間、あとは日付のセル・職種別人員と人工計）。"
                       "号炉の書き方（1号・１号炉・1炉・#1・共通・—）、号機（No.2・№2・2号機・(2)・B号機）、呼び名（IDF・誘引ﾌｧﾝ・BFP・給水P など）と半角カナが揺れる。"
                       "号炉も機器も作業内容の欄に詰めて書いた行がある。補修と細かな点検（ストレーナ清掃・グリスアップ…）は日報にだけある。結合したセル、運転状況の欄")
        elif t == "diary_csv":
            out.append(f"作業実績の CSV（{d['years'][0]}〜{d['years'][1]} 年度、{d.get('encoding', 'cp932')}）：1 行目がコメント、2 行目が見出し。1 行 1 件。"
                       "まとめ工事の行（「…定期補修工事」「一式（内訳は各行）」「延べ◯人工」）を工事の初日に置いた。日付は「2023/05/10」と「2023-05-10」が混ざる。"
                       "半角カナ・括弧の全角半角・号炉の書き方が揺れる。作業時間は人数×7.5 か 8 時間"
                       + ("。Shift_JIS に無い文字（—）は ― に置いた" if d.get("encoding", "cp932") == "cp932" else ""))
        elif t == "gantt":
            out.append(f"工程表（{era_fy(d['years'][0])}〜{era_fy(d['years'][1])}）：年度ごとのシート、週の列（月の見出しは週の列の上）。週のセルはその週に作業した日数で、網掛けの色で炉・全休炉・段を分けた。"
                       "工数の書き方が行ごとに揺れる（延べ人工の数、「45人工」の文字、「6日間」の日数だけ、着手・完了の無い期間だけ）。炉と全休炉の見出しの行は複数の機器をまとめた工事の行。行のグループ")
        elif t == "orders":
            out.append(f"発注台帳（{era_fy(d['years'][0])}〜{era_fy(d['years'][1])}）：年度ごとのシート。{era_fy(d.get('textDatesUntil', 2018))} 年度までは和暦の文字の日付（「H27.5.12」と「平成27年5月12日」が混ざる）、あとは日付のセル。"
                       "単価契約（予定総額と支払額が違う）、変更契約の行（「　〃　（第1回変更）」）、緊急の随意契約、定期補修工事の一式、継続費の基幹改良（年割額）。件名に施設の正式名と略称が混ざる。区分ごとの小計と合計（数の値）"
                       + ("。履行期間を 1 つのセルに「R8.4～R9.3」と書いた" if d.get("oneCellPeriod") else ""))
        elif t == "spec_pdf":
            out.append("完成図書の機器仕様一覧表（PDF）：竣工のときのまま（あとで足した機器は無い）。号炉に分けず数量でまとめた（「6 台」）。頁ごとに見出しをくり返す。表紙の頁。名前は完成図書の名前（星取表の呼び名と違う）")
        elif t == "ledger":
            out.append("機器台帳（Excel）：番号 1 / 1-1 / 1-1-1、名前は 1 列で全角の空白の字下げ、名前に入った機器番号「(BFP-101～103)」、仕様のセルの中の改行、設置年月は「平成14年3月」、備考に新設・更新。"
                       + ("号炉ごとに行を分けた（ほかの資料は台数でまとめる）" if d.get("perFurnace") else "台数でまとめた（号炉に分けない）"))
        elif t == "photo":
            out.append(f"日常点検表の写真（{len(d['weeks'])} 枚、JPEG）：紙を撮ったもの。傾き（3〜8 度）、影、ぼけ、明るさのむら、紙の折れ、手書きのチェック・×・数・印。1 枚に 2 セルずつ、染みとぼけで読めなくしたセル（正解は「読めない」）")
        elif t == "inspect_csv":
            out.append(f"定期巡視点検の CSV（{d.get('encoding', 'cp932')}）：1 行目がコメント。判定は「良」「否」と、凡例に無い「○」が混ざる。測った値と単位の列")
    return out


def _furnace_forms(W, d):
    nm = W.rules["naming"]["furnace"]["chart"]
    return [nm[i].replace("{n}", "1").replace("{nz}", "１") for i in d.get("furnaceStyle", [0])]


def _cross(W, answers):
    out = []
    seen = getattr(W, "seen", {})
    by = defaultdict(dict)
    for (aid, f), nm in seen.items():
        by[aid][f] = nm
    def kind(f):
        for k in ("星取表", "計画", "作業日報", "作業実績", "工程表", "完成図書", "台帳", "日常点検表", "巡視"):
            if k in f:
                return k
        return f

    cands = []
    for a in W.assets:
        if a.get("pseudo") or a["part"]:
            continue
        names = by.get(a["id"], {})
        vals = {}
        for f, nm in names.items():
            short = nm.split(" › ")[-1] if " › " in nm else nm
            vals.setdefault(short, set()).add(kind(f))
        if len(vals) >= 2:
            kinds = set().union(*vals.values())
            cands.append((-len(kinds), -len(vals), a["id"], a, vals))
    cands.sort(key=lambda x: (x[0], x[1], x[2]))
    used = set()
    for _, _, aid, a, vals in cands:
        if a["key"] in used:
            continue
        used.add(a["key"])
        out.append(f"`{aid}`（完成図書・台帳の名前「{a['name']}」）の呼び名：" + "、".join(f"「{k}」（{'・'.join(sorted(v))}）" for k, v in list(vals.items())[:5]))
        if len(used) >= 10:
            break
    out.append("粒度：完成図書・機器台帳は台数でまとめ、星取表は 1 台ずつの行・2 炉で 1 行・まとめて 1 行が混ざる。台帳の 1 行が、星取表では部位（クレーン → 巻上装置・走行装置・横行装置・バケット など）に分かれる")
    out.append("日付：星取表は年度の印だけ。日報・工程表・発注台帳は日付（工程表の着手・完了と、日報の作業した日は同じ作業。発注台帳の工期は契約の期間で、作業の日より広い）")
    out.append("工数：日報は 1 日の人数（と延べ時間）、工程表は延べ人工（数か文字）か日数だけ、CSV は人数と時間。同じ作業の日報の人数の和が、工程表の延べ人工になる")
    out.append("どの資料のどの行がどの作業かは `answer/world.json` の `links`（`how` が bundle・annual・rollup・upgrade の結びは、契約やまとめた工事の行で、作業そのものの行ではない）")
    out.append("事後の補修は、星取表にはほとんど書かない（一部だけ備考か「補修（事後）」の行）。日報と発注台帳の修繕工事にはある")
    return out


def usermd(W, answers, fac_dir: Path):
    p = W.prof
    L = [f"# {W.fac['name']}（架空）の担当者が知っていること", ""]
    L.append("聞かれたら答えられることを、担当者の言葉で書いた。")
    L.append("")
    L.append("## うちの施設")
    L.append("")
    if W.pack == "waste-incineration":
        fur = {"STOKER": "ストーカ炉", "FLUID": "流動床炉", "SHAFT": "シャフト式のガス化溶融炉", "ROTARY": "キルン式のガス化溶融炉", "FIXED": "固定床の炉"}[p["furnace"]]
        L.append(f"- {fur}が {W.F} 炉。1 炉 {p['perFurnace']}t/日で、全体で {p['perFurnace'] * W.F}t/日。{p['commissioned']} 年度に竣工した。")
        L.append(f"- 蒸気タービンで発電{'している' if p.get('turbine') else 'はしていない'}。集じんは{'ろ過式集じん器（バグフィルタ）' if p.get('dust') == 'BF' else '電気集じん器'}。"
                 f"灰は{'溶融している' if p.get('ash') == 'MELT' else ('セメント固化している' if p.get('ash') == 'CEMENT' else '処理して外へ搬出している')}。")
        L.append(f"- 運営は{'運営事業者への長期包括（O&M）' if p.get('contract') == 'OM' else '市町村の直営で、運転管理は単年度の委託'}。")
        if W.upgrade:
            ys = W.upgrade["years"]
            L.append(f"- 基幹的設備改良工事を {era_fy(ys[0])}〜{era_fy(ys[-1])} 年度にやった（{era_fy(ys[0])} が実施設計、そのあと 1 号炉、2 号炉の順）。")
        else:
            L.append("- 基幹的設備改良工事はまだやっていない。")
        L.append("- 毎年、1 号炉の定期整備 → 全炉を止める全休炉整備 → 2 号炉の定期整備の順。全休炉のあいだに受変電の全停電の点検をする。")
    else:
        L.append(f"- し尿処理施設。処理方式は{p.get('methodName')}、処理能力は {p['capacity_kl_per_day']}kL/日。{p['commissioned']} 年度に竣工した。")
        L.append("- 炉は無い。年に 1 回、受変電の年次点検のときに全停止する。")
    L.append("- 号炉や号機の書き方は人と資料でまちまち。「1号」「#1」「1炉」「１号炉」はどれも 1 号炉。号機は「No.2」「№2」「2号機」「(2)」「B号機」がどれも 2 台目。"
             if W.pack == "waste-incineration" else "- 号機の書き方は人と資料でまちまち。「No.2」「№2」「2号機」「(2)」「B号機」はどれも 2 台目。")
    L.append("- 「共通」は 3 つの意味で使っている：系統に共通の部品（消石灰のサイロなど）、系統が合流して分かれる機器（脱気器・復水器・火格子の油圧装置など）、施設全体の設備（精密機能検査・排ガス測定など）。日報で「共通」「—」「共」と書いた行は炉を分けない作業。"
             if W.pack == "waste-incineration" else "- 「共通」は施設全体の作業（精密機能検査・水質検査など）。")
    L.append("- 年度は 4 月から 3 月。")
    L.append("")
    L.append("## ファイルごと")
    L.append("")
    for d in W.fac["docs"]:
        t = d["type"]
        if t == "chart":
            f = [a for a in answers if d["stem"] in a][0]
            L.append(f"### {f}")
            L.append("")
            L.append("- 施設の整備の計画表（星取表）。保全係が毎年見直している。")
            L.append(f"- 記号：{LEG[d.get('legend', 'pd')]}。")
            L.append(f"- 費用は 1 回あたりの概算で、単位は{d.get('costUnit', '千円')}（税抜）。2 炉で 1 行にした行や台数をまとめた行は、その全体の額。")
            L.append("- 周期は年。「2年」と文字で書いた行もあるが同じ意味。")
            L.append(f"- {era_fy(W.today_fy)} 年度の実績はまだ一部しか入れていない（日報と発注台帳を見て、あとでまとめて入れる）。")
            if d.get("hideYears"):
                L.append(f"- 古い年度の列（{era_fy(d['yearsFrom'])} から {d['hideYears']} 年度分）は隠してある。消してはいない。")
            if d.get("parentSummary"):
                L.append("- 親の行に灰色で付けた記号は、下の行のどれかでやった年の目印。親の行そのものの作業ではない。")
            if d.get("elecSheet"):
                L.append("- 電気・計装は別のシート。そちらは改定の作業中で、先の年度まで入れていない。")
            if d.get("mgmtSheet"):
                L.append("- 「機器別管理基準」のシートは長寿命化の計画のもの。健全度は 4 がいちばんよく、1 がいちばん悪い。")
            L.append("- 事後の補修（壊れて直したもの）は基本は書いていない。備考にたまに書いたものはある。")
            L.append("- メモには延期の理由や、計画に無かった臨時の実施を書いた。")
            L.append("")
        elif t == "diary":
            L.append(f"### 作業日報（{era_fy(d['years'][0])}〜{era_fy(d['years'][1])} 年度のブック）")
            L.append("")
            L.append("- 運転管理の委託先と保全係が毎日書く帳票。1 日 1 枚で、書ききれない日は続紙に書いた（頁の欄が 2/2）。")
            L.append(f"- {era_fy(d.get('formatChange', 0))} 年度から様式を変えた。前の様式の「人員」はその日にその作業に入った人数、「延べ時間」は人数×8 時間。新しい様式は職種ごとの人数と、その合計の「人工計」。")
            L.append("- 1 人が 1 日働いて 1 人工。")
            L.append("- 施工業者が「常駐（運転管理）」「運転管理委託」の行は、運転管理の委託先が自分でやった作業。")
            L.append("- 細かな点検や手当て（ストレーナ清掃・グリスアップなど）と、壊れて直した補修は、日報にしか書いていない。")
            L.append("")
        elif t == "diary_csv":
            L.append(f"### 作業実績の CSV（{d['years'][0]}〜{d['years'][1]} 年度）")
            L.append("")
            L.append(f"- 委託先の業務の仕組みから書き出したもの。文字コードは{'Shift_JIS' if d.get('encoding', 'cp932') == 'cp932' else 'UTF-8'}。1 行目は書き出しのコメント。")
            L.append("- 1 行が 1 日の 1 件。人数はその日に入った人数、作業時間は延べの時間。")
            L.append("- 作業内容が「一式（内訳は各行）」の行は、定期補修工事のまとめの行。中身の作業は同じファイルの別の行にある。")
            L.append("")
        elif t == "gantt":
            L.append(f"### 工程表（{era_fy(d['years'][0])}〜{era_fy(d['years'][1])} 年度）")
            L.append("")
            L.append("- 定期整備の工程表。元請と打ち合わせて作り、終わったあとに実際の日に直した。")
            L.append("- 週の列の数字は、その週に作業した日数（日曜は休み）。")
            L.append("- 延べ人工はその作業の全体の人工。数字で書いた行と「◯人工」と書いた行がある。「◯日間」としか書いていない行は人工を控えていない。")
            L.append("- 「■ 1号炉　定期整備」などの見出しの行は、その炉の整備の期間と全体の人工。")
            L.append("")
        elif t == "orders":
            L.append(f"### 発注台帳（{era_fy(d['years'][0])}〜{era_fy(d['years'][1])} 年度）")
            L.append("")
            L.append("- 契約係の発注台帳。金額は税込の円。")
            L.append("- 単価契約は契約金額が予定の総額で、支払額は使った分。")
            L.append("- 「〃（第1回変更）」の行は、すぐ上の契約の変更契約（変更後の金額）。")
            L.append("- 「定期補修工事」は、その炉の定期整備の中の機器の整備をまとめた 1 件の契約。")
            if W.upgrade:
                L.append("- 基幹的設備改良工事は 3 年度の継続費。2 年目と 3 年目のシートには、その年度の年割額の行がある。")
            L.append("")
        elif t == "spec_pdf":
            L.append("### 完成図書 第3編 機器仕様一覧表（PDF）")
            L.append("")
            L.append("- 竣工のときにプラントの会社が出した完成図書の一部。そのあとに足した機器や更新した中身は入っていない。")
            L.append("- 数量は施設全体の台数（号炉に分けていない）。名前は完成図書の名前で、現場の呼び名と違うものがある（誘引通風機＝誘引送風機、ろ過式集じん器＝バグフィルタ など）。")
            L.append("")
        elif t == "ledger":
            L.append(f"### 機器台帳")
            L.append("")
            L.append("- 施設係の機器台帳。" + ("号炉ごとに行を分けている。" if d.get("perFurnace") else "台数でまとめている（号炉に分けていない）。"))
            L.append("- 名前の後ろの括弧の中は機器番号（「～」は番号の範囲）。")
            L.append("- 設置年月は竣工か、あとで足した年月。備考の「新設」「更新」はその年度にやったこと。")
            L.append("")
        elif t == "photo":
            L.append("### 日常点検表の写真")
            L.append("")
            L.append("- 運転員が毎日つける紙の点検表を、携帯で撮ったもの。週に 1 枚。")
            L.append("- チェックは良、× は否。数は測った値。いちばん下の段は点検した人の印。")
            L.append("- 染みやぼけで読めないところは、紙の原本もどこかへいって分からない。")
            L.append("")
        elif t == "inspect_csv":
            L.append("### 定期巡視点検の記録（CSV）")
            L.append("")
            L.append("- 毎週水曜の巡視の記録を、監視の仕組みから書き出したもの。Shift_JIS。")
            L.append("- 判定の「良」と「○」は同じ意味（人によって書き方が違う）。「否」は異常あり。")
            L.append("")
    (fac_dir / "user.md").write_bytes(("\n".join(L) + "\n").encode("utf-8"))
