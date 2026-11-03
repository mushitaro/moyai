#!/usr/bin/env python3
"""全国の表から数だけを取り出す道具 v0（docs/plan.md §2.7・§2.8）。

パックの national/columns.json（列の名前と軸への読み替え）に従い、全国の表（xlsx）から
稼働の施設の軸の値だけを取り出して、軸の値の組ごとの施設の数を national/table.json に書く。
施設名・地方公共団体・所在地・コードは持たない。1 施設ごとの行は出さない。
業種の語はこのファイルに置かない（columns.json と sources.json に置く）。

使い方（リポジトリの根で）:
  python -I -X utf8 scripts/national/build.py --pack packs/waste-incineration
      sources.json の URL から表を一時のフォルダに取り、読んだら消す
  python -I -X utf8 scripts/national/build.py --pack packs/waste-incineration --xlsx <表> --retrieved 2026-11-03
      手元の表を読む（取得日は人が渡す）
  --edges 50,100,200,400   帯の境目を columns.json の代わりに渡す
  --out <フォルダ>          table.json を書く所（既定はパックの national/）

標準出力には何も書かない。数のまとめだけを標準エラーに書く（行の値は書かない）。
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import tempfile
import unicodedata
import urllib.request
from collections import Counter
from dataclasses import dataclass, field

TABLE_SCHEMA = "moyai.national-table/0"
COLUMNS_SCHEMA = "moyai.national-columns/0"
TOOL = "scripts/national/build.py"
# 紛れる数の下限（docs/plan.md §2.8 の送る側の下限。コードに固定し、引数で変えない）
K_MIN = 5
PROCESSED = (
    "加工した。元の表の値を軸ごとのコードと帯に読み替え、稼働の施設を軸の値の組ごとに数えた数だけを残した。"
    "施設名・地方公共団体・所在地・コードは持たない"
)
RULES_FILE = "columns.json"
EDGES_FROM_RULES = RULES_FILE
EDGES_FROM_ARGS = "コマンドの引数"
JST = datetime.timezone(datetime.timedelta(hours=9))
HEX64 = re.compile(r"^[0-9a-f]{64}$")


class NationalError(Exception):
    """表か決まりが読めない。値を決めずに止める。文には行の値を入れない（数と列の名前だけ）。"""


@dataclass
class Sheet:
    """表の 1 枚。rows[0] が 1 行目。merges は (上の行, 左の列, 下の行, 右の列)、どれも 1 から数える。"""

    rows: list[list]
    merges: list[tuple[int, int, int, int]] = field(default_factory=list)

    @property
    def width(self) -> int:
        return max((len(r) for r in self.rows), default=0)

    def value(self, row: int, col: int):
        if row < 1 or row > len(self.rows):
            return None
        r = self.rows[row - 1]
        return r[col - 1] if 1 <= col <= len(r) else None


# ---------------------------------------------------------------- 読む


def load_xlsx(path: str, sheet_name: str) -> Sheet:
    """xlsx の 1 枚を、値と結合の範囲だけにして読む（数式は保存された値を読む）。"""
    import warnings

    import openpyxl  # samples/factory/requirements.txt の版

    with warnings.catch_warnings():
        # 印刷範囲の名前の形に openpyxl が出す注意は、読む値に関わらない
        warnings.simplefilter("ignore", UserWarning)
        wb = openpyxl.load_workbook(path, data_only=True)
    try:
        if sheet_name not in wb.sheetnames:
            raise NationalError(f"シート「{sheet_name}」が無い（シートは {len(wb.sheetnames)} 枚）")
        ws = wb[sheet_name]
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        merges = [(m.min_row, m.min_col, m.max_row, m.max_col) for m in ws.merged_cells.ranges]
    finally:
        wb.close()
    return Sheet(rows=rows, merges=sorted(merges))


def norm_header(v) -> str:
    """見出しの比べ方：NFKC にして空白をすべて除く。"""
    if v is None:
        return ""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(v)))


def cell_text(v) -> str | None:
    """値の比べ方：前後の空白を除くだけ。空なら None。"""
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def header_paths(sheet: Sheet, first: int, last: int) -> list[tuple[str, ...]]:
    """列ごとの見出しの名前（段を上から並べたもの）。結合のセルは範囲のすべてのセルに同じ見出しがあるとする。
    空の段は飛ばし、同じ語が続けば 1 つにする。戻り値の i 番目が i+1 列目。"""
    if not (1 <= first <= last):
        raise NationalError(f"見出しの段が正しくない（{first}〜{last} 行目）")
    width = sheet.width
    grid = {(r, c): sheet.value(r, c) for r in range(first, last + 1) for c in range(1, width + 1)}
    for top, left, bottom, right in sheet.merges:
        if not (first <= top <= last):
            continue
        v = sheet.value(top, left)
        for r in range(top, min(bottom, last) + 1):
            for c in range(left, right + 1):
                grid[(r, c)] = v
    paths = []
    for c in range(1, width + 1):
        path: list[str] = []
        for r in range(first, last + 1):
            h = norm_header(grid.get((r, c)))
            if h and (not path or path[-1] != h):
                path.append(h)
        paths.append(tuple(path))
    return paths


def find_column(paths: list[tuple[str, ...]], want: list[str]) -> int:
    """見出しの名前がちょうど同じ列を 1 つだけ探し、列の番号（1 から）を返す。"""
    key = tuple(norm_header(w) for w in want)
    hits = [i + 1 for i, p in enumerate(paths) if p == key]
    label = " / ".join(want)
    if not hits:
        raise NationalError(f"列「{label}」が見出しに無い")
    if len(hits) > 1:
        raise NationalError(f"列「{label}」が見出しに {len(hits)} つある")
    return hits[0]


# ---------------------------------------------------------------- 決まり


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def check_rules(rules: dict) -> None:
    """columns.json の形を確かめる。足りなければ止める。"""
    if rules.get("schema") != COLUMNS_SCHEMA:
        raise NationalError(f"columns.json の schema が {COLUMNS_SCHEMA} でない")
    for k in ("pack", "source", "sheet", "header", "rowKey", "withhold", "status", "axes", "steps"):
        if k not in rules:
            raise NationalError(f"columns.json に {k} が無い")
    keys = [a["key"] for a in rules["axes"]]
    if len(set(keys)) != len(keys):
        raise NationalError("columns.json の軸の key が重なる")
    for a in rules["axes"]:
        kind = a.get("kind")
        if kind not in ("map", "band", "contains", "parts"):
            raise NationalError(f"軸 {a.get('key')} の kind が知らない形")
        if kind != "band":
            codes = [c["code"] for c in a.get("codes", [])]
            if not codes or len(set(codes)) != len(codes):
                raise NationalError(f"軸 {a['key']} の codes が空か重なる")
            targets = _targets(a)
            unknown = [t for t in targets if t is not None and t not in codes]
            if unknown:
                raise NationalError(f"軸 {a['key']} の読み替えの先が codes に無い（{len(unknown)} 件）")
        if kind == "map" and a.get("match") not in ("exact", "prefix"):
            raise NationalError(f"軸 {a['key']} の match は exact か prefix")
    for step in rules["steps"]:
        if not step or any(k not in keys for k in step):
            raise NationalError("columns.json の steps に知らない軸がある")


def _targets(a: dict) -> list:
    kind = a["kind"]
    if kind == "map":
        return [m["to"] for m in a["map"]] + [a.get("blank")]
    if kind == "contains":
        return [a["yes"], a["no"], a.get("blank")]
    if kind == "parts":
        return [f["to"] for f in a["first"]] + [a["else"], a.get("blank")]
    return []


def parse_edges(text: str) -> list[int]:
    try:
        return [int(x) for x in text.split(",")]
    except ValueError as e:
        raise NationalError("--edges は整数をカンマでつないだもの（例 50,100,200,400）") from e


def check_edges(edges) -> list[int]:
    if not isinstance(edges, list) or not edges:
        raise NationalError("帯の境目が空")
    if any(isinstance(e, bool) or not isinstance(e, int) or e <= 0 for e in edges):
        raise NationalError("帯の境目は正の整数")
    if any(b <= a for a, b in zip(edges, edges[1:])):
        raise NationalError("帯の境目は小さい順に、重ならずに並べる")
    return edges


def band_codes(edges: list[int], prefix: str, unit: str) -> list[dict]:
    """境目から帯のコードを作る。帯は下の端を含み、上の端を含まない（境目の値は上の帯に入る）。"""
    edges = check_edges(edges)
    out = [{"code": f"{prefix}LT{edges[0]}", "name": f"{edges[0]} {unit} 未満", "below": edges[0]}]
    for lo, hi in zip(edges, edges[1:]):
        out.append({"code": f"{prefix}{lo}_{hi}", "name": f"{lo} {unit} 以上 {hi} {unit} 未満", "atLeast": lo, "below": hi})
    out.append({"code": f"{prefix}{edges[-1]}P", "name": f"{edges[-1]} {unit} 以上", "atLeast": edges[-1]})
    return out


def band_of(x: float, edges: list[int], codes: list[dict]) -> str:
    for i, e in enumerate(edges):
        if x < e:
            return codes[i]["code"]
    return codes[-1]["code"]


def split_parts(text: str, sep: str) -> list[str]:
    return [p.strip() for p in text.split(sep) if p.strip()]


# ---------------------------------------------------------------- 数える


@dataclass
class Counted:
    rows: int = 0
    not_facility_rows: int = 0
    active: int = 0
    status: dict = field(default_factory=dict)  # 群のコード → 数
    sub: dict = field(default_factory=dict)  # 群のコード → 下の数
    tuples: list = field(default_factory=list)  # 稼働の施設ごとの軸の値の組（メモリの中だけ。書き出さない）
    cells: list = field(default_factory=list)  # 軸ごとの、セルの行き先の数
    withheld: list = field(default_factory=list)  # 持たない列の値（照らすためだけ。書き出さない）


def classify(rules: dict, sheet: Sheet, edges: list[int]) -> Counted:
    """表を決まりに従って読む。決まらないセルが 1 つでもあれば、数を添えて止める。"""
    check_rules(rules)
    first, last = rules["header"]["first"], rules["header"]["last"]
    paths = header_paths(sheet, first, last)
    key_col = find_column(paths, rules["rowKey"])
    withhold_cols = [find_column(paths, w) for w in rules["withhold"]]
    st = rules["status"]
    status_col = find_column(paths, st["column"])
    axes = rules["axes"]
    axis_cols = {}
    for a in axes:
        if a["kind"] == "parts":
            axis_cols[a["key"]] = [find_column(paths, c) for c in a["columns"]]
        else:
            axis_cols[a["key"]] = [find_column(paths, a["column"])]

    c = Counted()
    problems: Counter = Counter()
    groups = st["groups"]
    part_group = {}
    for g in groups:
        c.status[g["code"]] = 0
        if "sub" in g:
            c.sub[g["code"]] = 0
        for p in g["parts"] + (g["sub"]["parts"] if "sub" in g else []):
            if p in part_group:
                raise NationalError(f"「{st['column'][0]}」の語が 2 つの群にある")
            part_group[p] = g

    cells = {a["key"]: {"to": Counter(), "blank": 0, "from": Counter()} for a in axes}
    codes_by_axis = {a["key"]: band_codes(edges, a["prefix"], a["unit"]) for a in axes if a["kind"] == "band"}

    for r in range(last + 1, len(sheet.rows) + 1):
        row = sheet.rows[r - 1]
        if all(cell_text(v) is None for v in row):
            continue
        if cell_text(sheet.value(r, key_col)) is None:
            c.not_facility_rows += 1
            continue
        c.rows += 1
        c.withheld.extend(sheet.value(r, col) for col in withhold_cols)
        s = cell_text(sheet.value(r, status_col))
        if s is not None:
            parts = split_parts(s, st["split"])
            gs = {part_group[p]["code"] for p in parts if p in part_group}
            g = next((x for x in groups if x["code"] in gs), None)
            # 知らない語・2 つの群の語・下の語だけ（群の語が無い）は決まらない
            if any(p not in part_group for p in parts) or len(gs) != 1 or not any(p in g["parts"] for p in parts):
                problems[f"「{st['column'][0]}」の値が決まらない"] += 1
                continue
            c.status[g["code"]] += 1
            if "sub" in g and any(p in g["sub"]["parts"] for p in parts):
                c.sub[g["code"]] += 1
            continue
        c.active += 1
        tup = []
        for a in axes:
            v, why = _axis_value(a, [sheet.value(r, col) for col in axis_cols[a["key"]]], edges, codes_by_axis.get(a["key"]), cells[a["key"]])
            if why:
                problems[f"軸 {a['key']}：{why}"] += 1
            tup.append(v)
        c.tuples.append(tuple(tup))

    if problems:
        lines = "\n".join(f"  {k}：{n} 施設" for k, n in sorted(problems.items()))
        raise NationalError(f"決まらないセルがある。決まりを人が直すまで止める\n{lines}")

    for a in axes:
        k = a["key"]
        codes = band_codes(edges, a["prefix"], a["unit"]) if a["kind"] == "band" else a["codes"]
        rec = {"key": k, "to": {x["code"]: cells[k]["to"][x["code"]] for x in codes}, "blank": cells[k]["blank"]}
        if a["kind"] == "map":
            rec["from"] = [{"from": m["from"], "to": m["to"], "n": cells[k]["from"][m["from"]]} for m in a["map"]]
        c.cells.append(rec)
    return c


def _axis_value(a: dict, values: list, edges, band, rec) -> tuple[str | None, str | None]:
    """1 施設の 1 軸の値。戻り値は (コード, 決まらない理由)。"""
    kind = a["kind"]
    if kind == "band":
        x = values[0]
        if isinstance(x, bool) or not isinstance(x, (int, float)):
            return None, "数でない値か空"
        if x < 0:
            return None, "負の数"
        code = band_of(x, edges, band)
        rec["to"][code] += 1
        return code, None
    if kind == "parts":
        texts = [cell_text(v) for v in values]
        parts = [p for t in texts if t is not None for p in split_parts(t, a["split"])]
        if any(p not in a["known"] for p in parts):
            return None, "知らない値"
        for f in a["first"]:
            if any(p in f["parts"] for p in parts):
                rec["to"][f["to"]] += 1
                return f["to"], None
        if any(t is None for t in texts):
            if a.get("blank") is None:
                return None, "空のセル"
            rec["blank"] += 1
            rec["to"][a["blank"]] += 1
            return a["blank"], None
        rec["to"][a["else"]] += 1
        return a["else"], None
    t = cell_text(values[0])
    if t is None:
        if a.get("blank") is None:
            return None, "空のセル"
        rec["blank"] += 1
        rec["to"][a["blank"]] += 1
        return a["blank"], None
    if kind == "contains":
        code = a["yes"] if a["text"] in t else a["no"]
        rec["to"][code] += 1
        return code, None
    # map
    if a["match"] == "exact":
        hits = [m for m in a["map"] if m["from"] == t]
    else:
        hits = [m for m in a["map"] if t.startswith(m["from"])]
    if len(hits) != 1:
        return None, "読み替えに無い値" if not hits else "読み替えが 2 つ以上当たる"
    rec["from"][hits[0]["from"]] += 1
    rec["to"][hits[0]["to"]] += 1
    return hits[0]["to"], None


def k_steps(tuples: list, keys: list[str], steps: list[list[str]], k_min: int = K_MIN) -> list[dict]:
    """段ごとに、その段の軸の値の組が同じ施設が k_min 以上ある施設の数を数える。"""
    out = []
    for step in steps:
        idx = [keys.index(k) for k in step]
        sub = [tuple(t[i] for i in idx) for t in tuples]
        n = Counter(sub)
        out.append({"axes": list(step), "facilities": sum(1 for s in sub if n[s] >= k_min)})
    return out


# ---------------------------------------------------------------- 書く


def describe(rules: dict, edges: list[int]) -> list[str]:
    """数え方の文。決まりと境目だけから作る（表の値を入れない）。"""
    h = rules["header"]
    st = rules["status"]
    out = [
        f"見出しは {h['first']}〜{h['last']} 行目の {h['last'] - h['first'] + 1} 段。結合したセルは、結合の範囲のすべてのセルに同じ見出しがあるとして読んだ。列は見出しの名前で探し、列の番号では決めていない",
        f"「{' / '.join(rules['rowKey'])}」に値がある行を施設の行として数えた。値が無いのにほかの欄に値がある行は notFacilityRows に数えた",
        f"「{' / '.join(st['column'])}」が空の行を{st['activeName']}として数えた。空でない行は、値を「{st['split']}」で分け、群の語で分けた（知らない語、2 つの群の語、下の語だけの行があれば止める）",
    ]
    for g in st["groups"]:
        s = f"{g['name']}（{g['code']}）：{'・'.join(g['parts'])}"
        if "sub" in g:
            s += f"。うち{g['sub']['name']}（{g['sub']['code']}）：{'・'.join(g['sub']['parts'])} を含む行"
        out.append(s)
    for a in rules["axes"]:
        kind = a["kind"]
        if kind == "map":
            how = "値がちょうど同じもの" if a["match"] == "exact" else "値の頭が同じもの"
            s = f"{a['key']}：「{' / '.join(a['column'])}」の値を、columns.json の map の{how}で読み替えた"
        elif kind == "band":
            s = (
                f"{a['key']}：「{' / '.join(a['column'])}」の数を、境目 {'・'.join(str(e) for e in edges)} {a['unit']} で帯にした。"
                f"帯は下の端を含み上の端を含まない（{edges[0]} は「{edges[0]} {a['unit']} 以上」の側）"
            )
        elif kind == "contains":
            s = f"{a['key']}：「{' / '.join(a['column'])}」に「{a['text']}」を含めば {a['yes']}、含まなければ {a['no']}"
        else:
            cols = "」「".join(" / ".join(c) for c in a["columns"])
            rules_text = "、そうでなく".join(f"どれかに「{'・'.join(f['parts'])}」があれば {f['to']}" for f in a["first"])
            s = f"{a['key']}：「{cols}」のセルを「{a['split']}」で分け、{rules_text}、ほかは {a['else']}"
        if kind != "band":
            if a.get("blank") is None:
                s += "。空のセルがあれば止める"
            else:
                s += f"。空のセル（決まりに当たらないもの）は {a['blank']} に入れ、その数を cells の blank に出した"
        out.append(s)
    out.append(f"rows は、{st['activeName']}の施設を {'・'.join(a['key'] for a in rules['axes'])} の値の組ごとに数えたもの。1 施設ごとの行は出さない")
    out.append(f"k の steps は、その段の軸の値の組が同じ施設が {K_MIN} 以上ある施設の数。of は{st['activeName']}の施設の数")
    return out


def axis_codes(a: dict, edges: list[int]) -> dict:
    rec = {"key": a["key"], "name": a["name"]}
    if a["kind"] == "band":
        rec.update({"unit": a["unit"], "edges": list(edges), "codes": band_codes(edges, a["prefix"], a["unit"])})
    else:
        rec["codes"] = [{"code": x["code"], "name": x["name"]} for x in a["codes"]]
    return rec


def build_table(rules: dict, source: dict, counted: Counted, *, sha256: str, retrieved: str, rules_sha256: str, edges: list[int], edges_from: str) -> dict:
    axes = rules["axes"]
    keys = [a["key"] for a in axes]
    order = {a["key"]: {x["code"]: i for i, x in enumerate(axis_codes(a, edges)["codes"])} for a in axes}
    n = Counter(counted.tuples)
    rows = sorted(n.items(), key=lambda kv: [order[k][v] for k, v in zip(keys, kv[0])])
    st = rules["status"]
    status = []
    for g in st["groups"]:
        rec = {"code": g["code"], "name": g["name"], "n": counted.status[g["code"]]}
        if "sub" in g:
            rec["sub"] = {"code": g["sub"]["code"], "name": g["sub"]["name"], "n": counted.sub[g["code"]]}
        status.append(rec)
    return {
        "schema": TABLE_SCHEMA,
        "pack": rules["pack"],
        "source": {
            "id": source["id"],
            "name": source["name"],
            "publisher": source["publisher"],
            "url": source["url"],
            "retrieved": retrieved,
            "sha256": sha256,
            "processed": PROCESSED,
        },
        "rules": {"file": RULES_FILE, "sha256": rules_sha256, "edgesFrom": edges_from},
        "tool": TOOL,
        "counting": describe(rules, edges),
        "population": {
            "rows": counted.rows,
            "notFacilityRows": counted.not_facility_rows,
            "active": counted.active,
            "status": status,
        },
        "axes": [axis_codes(a, edges) for a in axes],
        "cells": counted.cells,
        "rows": [dict(zip(keys, t), n=c) for t, c in rows],
        "k": {"min": K_MIN, "of": counted.active, "steps": k_steps(counted.tuples, keys, rules["steps"])},
    }


def dumps(obj) -> str:
    """JSON にする。中に入れ物を持たない短い入れ物は 1 行に書く（rows の 1 組が 1 行になる）。"""
    return _dump(obj, 0) + "\n"


def _dump(obj, depth: int) -> str:
    flat = lambda v: json.dumps(v, ensure_ascii=False, separators=(", ", ": "))
    if not isinstance(obj, (dict, list)):
        return flat(obj)
    items = obj.values() if isinstance(obj, dict) else obj
    if not obj or (all(not isinstance(v, (dict, list)) for v in items) and len(flat(obj)) <= 120):
        return flat(obj)
    pad, inner = "  " * depth, "  " * (depth + 1)
    if isinstance(obj, dict):
        body = ",\n".join(f"{inner}{flat(k)}: {_dump(v, depth + 1)}" for k, v in obj.items())
        return "{\n" + body + "\n" + pad + "}"
    body = ",\n".join(f"{inner}{_dump(v, depth + 1)}" for v in obj)
    return "[\n" + body + "\n" + pad + "]"


def _tokens(obj, out: list) -> list:
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.append(str(k))
            _tokens(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _tokens(v, out)
    elif obj is not None and not isinstance(obj, bool):
        out.append(str(obj))
    return out


NAME_CHECK_METHOD = (
    "持たない列の値（重なりを除く）を、書き出すもの（table.json と columns.json）に照らした。"
    "数字だけの値は、文字列の中の数字の並びと数の値にちょうど同じものがあるかで照らした（SHA-256 は除く）。"
    "ほかは NFKC にして 2 文字以上のものを、文字列の部分で照らした。"
    "ただし source の欄は sources.json の写しなので、文字列がちょうど同じかだけで照らした"
)


def name_hits(withheld: list, docs: list, exact_docs: list = ()) -> tuple[int, int]:
    """持たない列（名前・所在地・コード）の値が、書き出すものに出ていないかを数える。照らし方は NAME_CHECK_METHOD。
    戻り値は (照らした値の数, 当たった値の数)。値そのものは返さない。"""
    tokens = [unicodedata.normalize("NFKC", t) for d in docs for t in _tokens(d, [])]
    words = [t for t in tokens if not HEX64.match(t)]
    digit_runs = {m for t in words for m in re.findall(r"\d+", t)}
    exact = {unicodedata.normalize("NFKC", t) for d in exact_docs for t in _tokens(d, [])}
    seen = set()
    hits = 0
    for v in withheld:
        t = cell_text(v)
        if t is None:
            continue
        t = unicodedata.normalize("NFKC", t)
        if t in seen:
            continue
        seen.add(t)
        if t in exact:
            hits += 1
        elif t.isdigit():
            if t in digit_runs:
                hits += 1
        elif len(t) >= 2 and any(t in w for w in words):
            hits += 1
    return len(seen), hits


# ---------------------------------------------------------------- 入口


def fetch(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "moyai-national/0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)


def source_entry(pack_dir: str, source_id: str) -> dict:
    doc = load_json(os.path.join(pack_dir, "sources.json"))
    hits = [s for s in doc.get("sources", []) if s.get("id") == source_id]
    if len(hits) != 1:
        raise NationalError(f"sources.json に {source_id} がちょうど 1 つ無い")
    return hits[0]


def run(pack_dir: str, *, xlsx: str | None = None, retrieved: str | None = None, edges: list[int] | None = None, out_dir: str | None = None, today: datetime.date | None = None) -> dict:
    """table.json を作って書き、書いた中身を返す。xlsx が無ければ sources.json の URL から一時のフォルダに取り、読んだら消す。"""
    rules_path = os.path.join(pack_dir, "national", "columns.json")
    rules = load_json(rules_path)
    check_rules(rules)
    source = source_entry(pack_dir, rules["source"])
    band_axes = [a for a in rules["axes"] if a["kind"] == "band"]
    if edges is None:
        edges_from = EDGES_FROM_RULES
        edges = band_axes[0]["edges"] if band_axes else []
    else:
        edges_from = EDGES_FROM_ARGS
    if len(band_axes) > 1:
        raise NationalError("帯の軸は 1 つまで（v0）")
    if band_axes:
        check_edges(edges)

    def read(path: str) -> tuple[str, Counted]:
        sha = sha256_file(path)
        if source.get("sha256") and source["sha256"] != sha:
            raise NationalError("表の SHA-256 が sources.json と違う。表が差し替わった。人が sources.json を照らし直してから走らせる")
        return sha, classify(rules, load_xlsx(path, rules["sheet"]), edges)

    if xlsx is not None:
        if not retrieved or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", retrieved):
            raise NationalError("手元の表を読むときは --retrieved に取得日（YYYY-MM-DD）を渡す")
        sha, counted = read(xlsx)
    else:
        retrieved = (today or datetime.datetime.now(JST).date()).isoformat()
        with tempfile.TemporaryDirectory(prefix="moyai-national-") as tmp:
            path = os.path.join(tmp, "table.xlsx")
            fetch(source["url"], path)
            sha, counted = read(path)

    table = build_table(
        rules,
        source,
        counted,
        sha256=sha,
        retrieved=retrieved,
        rules_sha256=sha256_file(rules_path),
        edges=edges,
        edges_from=edges_from,
    )
    body = {k: v for k, v in table.items() if k != "source"}
    checked, hits = name_hits(counted.withheld, [body, rules], [table["source"]])
    if hits:
        raise NationalError(f"持たない列の値が書き出すものに {hits} 件出た。書かずに止める")
    table["nameCheck"] = {"columns": [list(w) for w in rules["withhold"]], "method": NAME_CHECK_METHOD, "values": checked, "hits": 0}
    out_dir = out_dir or os.path.join(pack_dir, "national")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "table.json"), "w", encoding="utf-8", newline="\n") as f:
        f.write(dumps(table))
    return table


def summary(table: dict) -> str:
    p = table["population"]
    lines = [f"施設の行 {p['rows']}（施設の行でない行 {p['notFacilityRows']}）、稼働 {p['active']}"]
    for g in p["status"]:
        s = f"{g['name']} {g['n']}"
        if "sub" in g:
            s += f"（うち{g['sub']['name']} {g['sub']['n']}）"
        lines.append(s)
    k = table["k"]
    for s in k["steps"]:
        pct = 100 * s["facilities"] / k["of"] if k["of"] else 0
        lines.append(f"{'・'.join(s['axes'])}：{k['min']} 施設以上に紛れる {s['facilities']}/{k['of']}（{pct:.1f}%）")
    lines.append(f"rows {len(table['rows'])}、SHA-256 {table['source']['sha256']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="全国の表から数だけを取り出す")
    ap.add_argument("--pack", required=True, help="パックのフォルダ（national/columns.json と sources.json がある所）")
    ap.add_argument("--xlsx", help="手元の表（無ければ sources.json の URL から取る）")
    ap.add_argument("--retrieved", help="手元の表の取得日 YYYY-MM-DD")
    ap.add_argument("--edges", help="帯の境目（例 50,100,200,400）。無ければ columns.json の edges")
    ap.add_argument("--out", help="table.json を書くフォルダ（既定はパックの national/）")
    args = ap.parse_args(argv)
    try:
        table = run(
            args.pack,
            xlsx=args.xlsx,
            retrieved=args.retrieved,
            edges=parse_edges(args.edges) if args.edges else None,
            out_dir=args.out,
        )
    except NationalError as e:
        print(f"national: {e}", file=sys.stderr)
        return 1
    print(summary(table), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
