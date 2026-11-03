#!/usr/bin/env python3
"""帯の境目を決めるための測り（docs/sharing.md）：経過年の帯が、使用開始の年をどこまで明かすかを全国の表で数える。

塊の years（作業をした年度）と ageAtWork（最初の作業のときの経過年の帯）がそろうと、受け手は
「設置の年度 ∈ [最初の年度 − 帯の上, 最初の年度 − 帯の下]」と読める。全国の表には使用開始年度の列があるので、
見え方（段の順で k ≥ 5 に届いた段）に、その年の幅を足すと何施設に紛れるかを数える。

- 元の表はリポジトリに入れない（scripts/national/build.py と同じ。手元の表の道を渡す）。
- 施設ごとの行・名前・コード・年の値は書かない。標準エラーに数のまとめだけを書く（--json で同じまとめをファイルにも書く）。
- 段の順は src/share/k.ts の ladder と同じ（全国の表にある軸だけ。後ろの軸から外す → 帯の軸を粗くする → 業種だけ）。
  見え方の軸とその順はパックの pack.json の profile から読む。業種の語はこのファイルに置かない。

使い方（リポジトリの根で）:
  python -I -X utf8 scripts/national/measure_start_year.py --pack packs/waste-incineration --xlsx <手元の表> --start-column 使用開始年度
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter

if __package__ in (None, ""):
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from scripts.national import build as b  # noqa: E402

K_MIN = b.K_MIN
# 年の幅：exact は 1 年、pm1 は ±1 年（3 年）、pm2 は ±2 年（5 年）、block5・block10 は 5 年・10 年の区切り（西暦の 5・10 の倍数から）
WINDOWS = ("exact", "pm1", "pm2", "block5", "block10")


def coarsen_edges(edges: list[int]) -> list[int]:
    """src/share/k.ts の coarsenEdges と同じ：最後の境目から 1 つおきに外す。"""
    n = len(edges)
    return [e for i, e in enumerate(edges) if (n - 1 - i) % 2 == 1]


def coarse_code(fine: str, edges: list[int], prefix: str, unit: str) -> str:
    """細かい帯のコードを、粗くした帯のコードにする（k.ts の coarseOf と同じ範囲の考え方）。"""
    fine_codes = b.band_codes(edges, prefix, unit)
    coarse = b.band_codes(coarsen_edges(edges), prefix, unit)
    rng = {c["code"]: (c.get("atLeast", float("-inf")), c.get("below", float("inf"))) for c in fine_codes}
    lo, hi = rng[fine]
    for c in coarse:
        clo, chi = c.get("atLeast", float("-inf")), c.get("below", float("inf"))
        if lo >= clo and hi <= chi:
            return c["code"]
    raise b.NationalError("粗くした帯に入らない")


def ladder(profile_axes: list[dict], table_keys: list[str], band_keys: set[str]) -> list[dict]:
    """src/share/k.ts の ladder と同じ段の順。"""
    axes = [a for a in profile_axes if a["key"] in table_keys]

    def stage_of(kept):
        tiers = {next(a["tier"] for a in axes if a["key"] == k) for k in kept}
        return 0 if "refine" in tiers else 1 if "secondary" in tiers else 2 if tiers else 3

    kept = [a["key"] for a in axes]
    rungs = [{"stage": stage_of(kept), "kept": list(kept), "coarse": False}]
    for a in reversed(axes):
        if a["tier"] == "primary":
            continue
        kept.remove(a["key"])
        rungs.append({"stage": stage_of(kept), "kept": list(kept), "coarse": False})
    if any(k in band_keys for k in kept):
        rungs.append({"stage": stage_of(kept), "kept": list(kept), "coarse": True})
    rungs.append({"stage": 3, "kept": [], "coarse": False})
    return rungs


def read_start_years(rules: dict, sheet: b.Sheet, column: list[str]) -> list:
    """稼働の施設の行（classify と同じ順）の使用開始の年の値。読めない値は None。"""
    first, last = rules["header"]["first"], rules["header"]["last"]
    paths = b.header_paths(sheet, first, last)
    key_col = b.find_column(paths, rules["rowKey"])
    status_col = b.find_column(paths, rules["status"]["column"])
    col = b.find_column(paths, column)
    out = []
    for r in range(last + 1, len(sheet.rows) + 1):
        row = sheet.rows[r - 1]
        if all(b.cell_text(v) is None for v in row):
            continue
        if b.cell_text(sheet.value(r, key_col)) is None:
            continue
        if b.cell_text(sheet.value(r, status_col)) is not None:
            continue
        v = sheet.value(r, col)
        if isinstance(v, bool):
            out.append(None)
        elif isinstance(v, int):
            out.append(v)
        elif isinstance(v, float) and v.is_integer():
            out.append(int(v))
        elif isinstance(v, str) and v.strip().isdigit():
            out.append(int(v.strip()))
        else:
            out.append(None)
    return out


def in_window(kind: str, y: int, other: int) -> bool:
    if kind == "exact":
        return other == y
    if kind == "pm1":
        return abs(other - y) <= 1
    if kind == "pm2":
        return abs(other - y) <= 2
    if kind == "block5":
        return other // 5 == y // 5
    if kind == "block10":
        return other // 10 == y // 10
    raise ValueError(kind)


def measure(rules: dict, profile_axes: list[dict], tuples: list[tuple], years: list, edges: list[int]) -> dict:
    """数のまとめを返す（施設ごとの値は返さない）。"""
    if len(tuples) != len(years):
        raise b.NationalError("稼働の施設の数が、使用開始の年の列と合わない")
    keys = [a["key"] for a in rules["axes"]]
    band_axes = {a["key"]: a for a in rules["axes"] if a["kind"] == "band"}
    rungs = ladder(profile_axes, keys, set(band_axes))

    def cell(t, rung):
        vals = []
        for k in rung["kept"]:
            v = t[keys.index(k)]
            if rung["coarse"] and k in band_axes:
                a = band_axes[k]
                v = coarse_code(v, edges, a["prefix"], a["unit"])
            vals.append(v)
        return tuple(vals)

    counts = [Counter(cell(t, r) for t in tuples) for r in rungs]
    chosen = []
    for t in tuples:
        idx = next((i for i, r in enumerate(rungs) if counts[i][cell(t, r)] >= K_MIN), None)
        chosen.append(idx)
    by_rung = Counter(chosen)
    # 受け手から見た候補：その施設が選んだ段で、見え方の値が同じすべての施設（ほかの段を選んだ施設も入る。kNational と同じ）
    members: dict = {}
    for ri, r in enumerate(rungs):
        for j, t in enumerate(tuples):
            members.setdefault((ri, cell(t, r)), []).append(j)
    result = {"window": {}, "facilities": len(tuples), "startYearUnreadable": sum(1 for y in years if y is None)}
    for w in WINDOWS:
        below = 0
        ks = []
        for i, t in enumerate(tuples):
            if chosen[i] is None or years[i] is None:
                continue
            group = members[(chosen[i], cell(t, rungs[chosen[i]]))]
            k = sum(1 for j in group if years[j] is not None and in_window(w, years[i], years[j]))
            ks.append(k)
            if k < K_MIN:
                below += 1
        ks.sort()
        result["window"][w] = {
            "counted": len(ks),
            "belowK": below,
            "median": ks[len(ks) // 2] if ks else None,
        }
    result["rungs"] = [
        {"stage": r["stage"], "kept": r["kept"], "coarse": r["coarse"], "facilities": by_rung.get(i, 0)} for i, r in enumerate(rungs)
    ]
    result["notReached"] = by_rung.get(None, 0)
    return result


def run(pack_dir: str, xlsx: str, start_column: list[str]) -> dict:
    rules_path = os.path.join(pack_dir, "national", "columns.json")
    rules = b.load_json(rules_path)
    b.check_rules(rules)
    source = b.source_entry(pack_dir, rules["source"])
    sha = b.sha256_file(xlsx)
    if source.get("sha256") and source["sha256"] != sha:
        raise b.NationalError("表の SHA-256 が sources.json と違う")
    pack = b.load_json(os.path.join(pack_dir, "pack.json"))
    profile_axes = [{"key": a["key"], "tier": a["tier"]} for a in pack["profile"]["axes"] if a.get("national", True)]
    band_axes = [a for a in rules["axes"] if a["kind"] == "band"]
    edges = band_axes[0]["edges"] if band_axes else []
    sheet = b.load_xlsx(xlsx, rules["sheet"])
    counted = b.classify(rules, sheet, edges)
    years = read_start_years(rules, sheet, start_column)
    out = measure(rules, profile_axes, counted.tuples, years, edges)
    out["source"] = {"id": rules["source"], "sha256": sha}
    out["startColumn"] = start_column
    out["kMin"] = K_MIN
    return out


def summary(m: dict) -> str:
    lines = [f"稼働 {m['facilities']}、使用開始の年が読めない {m['startYearUnreadable']}"]
    for r in m["rungs"]:
        lines.append(f"段 {r['stage']}{'（粗い帯）' if r['coarse'] else ''} {'・'.join(r['kept']) or '業種だけ'}：{r['facilities']} 施設がここで k ≥ {m['kMin']}")
    for w, v in m["window"].items():
        lines.append(f"年の幅 {w}：数えた {v['counted']} 施設のうち k < {m['kMin']} が {v['belowK']}（中央の k {v['median']}）")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="経過年の帯が使用開始の年をどこまで明かすかを数える")
    ap.add_argument("--pack", required=True)
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--start-column", required=True, help="使用開始の年の列の見出し（段は / で区切る）")
    ap.add_argument("--json", help="まとめを書くファイル（数だけ）")
    a = ap.parse_args(argv)
    try:
        m = run(a.pack, a.xlsx, [s.strip() for s in a.start_column.split("/")])
    except b.NationalError as e:
        print(f"measure: {e}", file=sys.stderr)
        return 1
    print(summary(m), file=sys.stderr)
    if a.json:
        with open(a.json, "w", encoding="utf-8", newline="\n") as f:
            json.dump(m, f, ensure_ascii=False, indent=2)
            f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
