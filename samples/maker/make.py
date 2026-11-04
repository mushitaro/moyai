"""1 施設のサンプルを作る：資料（files/）・ファイルごとの正解（answer/files/）・世界の正解（answer/world.json）・証拠（gen/evidence/）。

使い方：python samples/maker/make.py samples/<業種>/<施設>
"""
from __future__ import annotations

import shutil
import sys
from collections import Counter
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    __package__ = "maker"

from maker.util import ROOT, write_json  # noqa: E402
from maker.world import World  # noqa: E402

VERSION = 1


def writers():
    from maker import chart, diary, diarybook, gantt, ledger, orders, photo, specpdf

    return {
        "chart": chart.write_chart,
        "diary": diarybook.write_diary_books,
        "diary_csv": diary.write_diary_csv,
        "inspect_csv": diary.write_inspect_csv,
        "gantt": gantt.write_gantt,
        "orders": orders.write_orders,
        "ledger": ledger.write_ledger,
        "spec_pdf": specpdf.write_spec_pdf,
        "photo": photo.write_photos,
    }


def build(fac_dir: Path):
    fac_dir = Path(fac_dir).resolve()
    W = World(fac_dir / "gen" / "facility.json")
    files = fac_dir / "files"
    if files.exists():
        shutil.rmtree(files)
    files.mkdir(parents=True)
    for p in (fac_dir / "answer" / "files", fac_dir / "gen" / "evidence"):
        if p.exists():
            shutil.rmtree(p)
    answers = {}
    wr = writers()
    for doc in W.fac["docs"]:
        wr[doc["type"]](W, doc, files, answers, None)
    for fname, ans in answers.items():
        stem = Path(fname).stem
        write_json(fac_dir / "answer" / "files" / f"{stem}.json", ans.dump())
        write_json(fac_dir / "gen" / "evidence" / f"{stem}.json", ans.dump_evidence())
    write_json(fac_dir / "answer" / "world.json", world_answer(W, answers))
    from maker import doc

    doc.readme(W, answers, fac_dir)
    doc.usermd(W, answers, fac_dir)
    _wrappers(fac_dir)
    return W, answers


def _wrappers(fac_dir):
    """施設の gen/ に、作り直しと自己点検の小さな入口を置く（中身は samples/maker/ の雛形）。"""
    here = Path(__file__).resolve().parent
    for name in ("make.py", "check.py"):
        text = (here / "templates" / name).read_bytes()
        (fac_dir / "gen" / name).write_bytes(text)


def profile(W):
    p = W.prof
    out = {k: p[k] for k in ("furnace", "turbine", "dust", "ash", "contract") if k in p}
    if "perFurnace" in p:
        cap = p["perFurnace"] * W.F
        out["capacity_t_per_day"] = cap
        edges = [50, 100, 200, 400]
        names = ["CLT50", "C50_100", "C100_200", "C200_400", "C400P"]
        out["capacityBand"] = names[sum(1 for e in edges if cap >= e)]
    if "capacity_kl_per_day" in p:
        out["capacity_kl_per_day"] = p["capacity_kl_per_day"]
    if "method" in p:
        out["method"] = p["method"]
    if isinstance(out.get("turbine"), bool):
        out["turbine"] = "YES" if out["turbine"] else "NO"
    out["upgraded"] = "実施済み" if (W.upgrade and W.upgrade["years"][-1] <= W.today_fy) else ("実施中" if W.upgrade else "未実施")
    out["furnaces"] = W.F
    out["commissioned"] = p["commissioned"]
    return out


def world_answer(W, answers):
    links = W.links
    weak = ("annual", "bundle", "rollup", "upgrade")
    linked = Counter(x["work"] for x in links if x.get("how") not in weak)
    linked_weak = Counter(x["work"] for x in links if x.get("how") in weak)
    names = {}
    for (aid, file), name in getattr(W, "seen", {}).items():
        names.setdefault(aid, {})[file] = name
    assets = []
    for a in W.assets:
        aa = {k: a[k] for k in ("id", "name", "system", "class", "furnace", "unit", "part", "parent", "commonKind",
                                "installed", "tag") if k in a}
        if a.get("added"):
            aa["added"] = True
        if a.get("pseudo"):
            aa["pseudo"] = True
        if a["id"] in names:
            aa["names"] = names[a["id"]]
        assets.append(aa)
    works = []
    for w in W.works:
        works.append({k: w.get(k) for k in ("id", "asset", "task", "attr", "strategy", "fy", "plannedFy", "status", "done",
                                             "start", "end", "manDays", "days", "vendor", "contract", "legal", "rollup",
                                             "postponedFrom") if w.get(k) is not None})
    contracts = []
    for c in W.contracts:
        contracts.append({k: v for k, v in c.items() if k not in ("seq",)})
    # どの資料にも書いていない作業と、その理由
    diary_years = None
    for doc in W.fac["docs"]:
        if doc["type"] in ("diary", "diary_csv"):
            diary_years = doc["years"]
    errata_by_work = {}
    for e in W.errata:
        for wid in e.get("works", []):
            errata_by_work.setdefault(wid, []).append(e["type"])
    unrec = []
    for w in W.works:
        if not w["done"] or linked[w["id"]]:
            continue
        reasons = []
        for t in errata_by_work.get(w["id"], []):
            reasons.append({"omitMark": "星取表の書き漏れ", "lastYearUnreflected": "星取表は最後の年度を一部だけ反映",
                            "wrongYear": "星取表の年度の書き間違い"}.get(t, t))
        if linked_weak[w["id"]]:
            reasons.append("契約の行（年間の委託・まとめた工事）にだけある")
        if w["status"] == "breakdown":
            reasons.append("事後の補修（星取表にほとんど書かない）")
        if diary_years is None:
            reasons.append("日報の無い施設")
        elif not (diary_years[0] <= w["fy"] <= diary_years[1]):
            reasons.append("日報の無い年度")
        if not w.get("contract"):
            reasons.append("発注の無い作業（直営・常駐）")
        if not reasons:
            reasons.append("どの資料の書き手も書かなかった")
        unrec.append({"work": w["id"], "reasons": reasons})
    counts = Counter(r for u in unrec for r in u["reasons"])
    files = []
    for fname, ans in answers.items():
        files.append({"file": fname, "plan": ans.plan, "records": len(ans.records)})
    return {
        "schema": "moyai.sample-world/0",
        "maker": {"version": VERSION, "seed": W.seed, "today": W.today, "rules": f"packs/{W.pack}/world.json"},
        "facility": {"id": W.fac["id"], "name": W.fac["name"], "short": W.fac["short"], "owner": W.fac["owner"],
                     "pack": W.pack, "years": [W.y0, W.y1], "planTo": W.plan_to, "fiscalYearStartMonth": W.fym,
                     "fictional": True},
        "profile": profile(W),
        "rates": W.rates,
        "files": files,
        "assets": assets,
        "works": works,
        "contracts": contracts,
        "links": links,
        "unrecorded": unrec,
        "unrecordedByReason": dict(counts),
        "gaps": W.gaps,
        "errata": W.errata,
        "upgrade": W.upgrade,
        "counts": {"assets": sum(1 for a in W.assets if not a.get("pseudo")), "works": len(W.works),
                   "worksDone": sum(1 for w in W.works if w["done"]), "contracts": len(W.contracts),
                   "linkedWorks": len(linked), "unrecorded": len(unrec),
                   "note": "linkedWorks は、作業そのものを書いた行（星取表の印・日報の行・工程表の行・単独の契約の行）の結びがある作業の数。年間の委託・まとめた工事・継続費の契約の行だけの結び（links[].how が annual・bundle・rollup・upgrade）は数えない"},
    }


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for arg in sys.argv[1:]:
        W, answers = build(Path(arg))
        print(f"{arg}: files {len(answers)}, assets {sum(1 for a in W.assets if not a.get('pseudo'))}, "
              f"works {len(W.works)}, contracts {len(W.contracts)}")
