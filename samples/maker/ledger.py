"""機器台帳（Excel）の書き手。

字下げの 1 列（全角の空白）、番号 1 / 1-1 / 1-1-1、名前に入った機器番号「(BFP-101)」、セルの中の改行、
「平成14年3月」の年月、取替・撤去・新設を備考に書く。台数はまとめて書く（号炉に分けない）か、施設の設定で号炉ごと。
"""
from __future__ import annotations

from .book import Answer, Book, ev
from .util import FAKE, era_fy, rng_for, wareki_ym


def write_ledger(W, doc, outdir, answers, _):
    fname = f"{FAKE}{W.fac['short']}_{doc.get('stem', '機器台帳')}.xlsx"
    r = rng_for(W.seed, "ledger")
    bk = Book(f"{FAKE}{W.fac['name']} 機器台帳", f"{FAKE}{W.fac['owner']} {doc.get('author', '施設係')}")
    ans = Answer(fname, False)
    S = bk.sheet(doc.get("sheet", "機器台帳"))
    S.put(1, 1, f"{W.fac['name']}（架空）　機器台帳", bold=True, size=13)
    S.put(2, 1, f"{FAKE}機器・型式・製作者はすべて架空。{wareki_ym(W.today.year, W.today.month)}現在")
    heads = ["番号", "名称", "型式", "仕様", "数量", "単位", "設置年月", "製作者", "備考"]
    for i, h in enumerate(heads):
        S.put(4, i + 1, h, bold=True, box=True, align="center")
    row = 5
    per_furnace = doc.get("perFurnace", False)
    com = W.prof["commissioned"]
    si = 0
    for s in W.rules["systems"]:
        if not s.get("ledger"):
            continue
        tpls = [t for t in W.rules["catalog"] if t["sys"] == s["key"] and W.applies(t) and not t.get("noLedger")]
        tpls = [t for t in tpls if W.units_of(t["key"])]
        if not tpls:
            continue
        si += 1
        num = f"{si}"
        S.put(row, 1, num, box=True)
        S.put(row, 2, s["ledger"], bold=True, box=True)
        ans.rec("parent", {"番号": num, "名称": s["ledger"]}, [ev(f"A{row}", num), ev(f"B{row}", s["ledger"])], sheet=S.title, r=row)
        row += 1
        for ti, t in enumerate(tpls):
            units = W.units_of(t["key"])
            groups = [units]
            if per_furnace and t["scope"] == "furnace" and W.F > 1:
                groups = [[u for u in units if u["furnace"] == f] for f in range(1, W.F + 1)]
            for gi, g in enumerate(groups):
                num2 = f"{si}-{ti + 1}" + (f"-{gi + 1}" if len(groups) > 1 else "")
                name = t["chart"][doc.get("nameVariant", 1) % len(t["chart"])] if r.random() < 0.3 else t["name"]
                if len(groups) > 1:
                    name = f"{W.unit(g[0]['furnace'])} " + name
                tag = g[0]["tag"]
                if tag and r.random() < doc.get("codeInName", 0.5):
                    name = f"{name}({tag}{'～' + g[-1]['tag'].split('-')[-1] if len(g) > 1 and g[-1]['tag'] else ''})"
                indent = "　" * (1 + (len(groups) > 1))
                sp = t.get("spec") or {}
                spec = sp.get("main") or ""
                if sp.get("kw"):
                    spec = (spec + "\n" if spec and spec != "—" else "") + f"電動機 {sp['kw']}kW"
                inst = min(u["installed"] for u in g)
                memo = []
                if any(u.get("added") for u in g):
                    memo.append(f"{era_fy(inst)} 新設")
                for w in W.works:
                    if w["asset"] in [u["id"] for u in g] and w["attr"] in ("REPLACE", "UPGRADE") and w["done"] and w["task"] in ("更新", "全数更新", "基幹改良（更新）", "ハード更新"):
                        memo.append(f"{era_fy(w['fy'])} 更新")
                        break
                vals = [num2, indent + name, sp.get("form") or "—", spec or "—", len(g), "台" if t["scope"] != "facility" or len(g) > 1 else "式",
                        wareki_ym(inst, 3 if inst == com else r.randint(1, 12)), W.vendor(sp.get("maker", "plant")) if sp else "", "　".join(memo)]
                evc = []
                f = {}
                for i, (h, v) in enumerate(zip(heads, vals)):
                    if v in ("", None):
                        continue
                    a = S.put(row, i + 1, v, box=True, wrap=(h == "仕様"))
                    evc.append(ev(a, v))
                    f[h] = v.strip() if isinstance(v, str) and h == "名称" else v
                has_parts = bool(t.get("parts")) and doc.get("parts", True)
                ans.rec("parent" if has_parts else "item", f, evc, sheet=S.title, r=row)
                for u in g:
                    W.seen_name(u["id"], fname, f["名称"])
                row += 1
                if has_parts:
                    for pi, p in enumerate(t["parts"]):
                        num3 = f"{num2}-{pi + 1}"
                        pts = [a for a in W.assets if a["parent"] in [u["id"] for u in g] and a["part"] == p]
                        vals = [num3, indent + "　" + p, "", "", len(pts), "式", "", "", ""]
                        evc = []
                        f = {}
                        for i, (h, v) in enumerate(zip(heads, vals)):
                            if v in ("", None):
                                continue
                            a = S.put(row, i + 1, v, box=True)
                            evc.append(ev(a, v))
                            f[h] = v.strip() if isinstance(v, str) and h == "名称" else v
                        ans.rec("item", f, evc, sheet=S.title, r=row)
                        for a_ in pts:
                            W.seen_name(a_["id"], fname, p)
                        row += 1
    for i, wdt in enumerate([8, 40, 24, 30, 6, 6, 14, 24, 18]):
        S.width(i + 1, wdt)
    bk.save(outdir / fname)
    answers[fname] = ans
