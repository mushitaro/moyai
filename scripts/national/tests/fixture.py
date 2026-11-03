"""試験のための小さな作り物の表。行はすべて架空（名前に【架空】を入れ、コードは 99 で始める）。

見出しは全国の表と同じ 2〜6 行目の 5 段にし、同じ形の結合を作る：
  1 列だけの見出しは 2〜6 行目を縦に結合する
  単位のある見出しは 2〜5 行目を結合し、6 行目に単位を置く
  2 列にまたがる見出しは 2〜3 行目を横に結合し、4〜6 行目に下の見出しを縦に結合して置く
"""

from __future__ import annotations

import json
import os

# 列の並び。(見出しの形, 名前, 下の見出しか単位, 行の dict のキー)
COLUMNS = [
    ("one", "都道府県名", None, "pref"),
    ("one", "地方公共団体コード", None, "lgcode"),
    ("one", "施設コード", None, "code"),
    ("one", "地方公共団体名", None, "lg"),
    ("one", "施設名称", None, "name"),
    ("one", "施設所在地", None, "addr"),
    ("one", "処理方式", None, "furnace"),
    ("one", "ごみ処理事業実施方式", None, "contract"),
    # 単位の段は全角の括弧で書く（決まりは半角。NFKC で同じになる）
    ("unit", "施設全体の処理能力", "（t/日）", "cap"),
    # 名前の似た見出し（単位の段が無い）。決まりの列と取り違えないこと
    ("one", "施設全体の処理能力", None, "cap_note"),
    ("one", "余熱利用の状況", None, "heat"),
    ("group", "灰処理設備の有無", ["（焼却灰）", "（飛灰）"], ["ash_b", "ash_f"]),
    ("one", "運転管理体制", None, "ops"),
    ("one", "施設の改廃", None, "status"),
]


def facility(i: int, **kw) -> dict:
    """架空の施設の 1 行。名前・所在地・コードは i から作る。"""
    row = {
        "pref": "【架空】県",
        "lgcode": f"99{i:03d}",
        "code": f"99{i:03d}01",
        "lg": f"【架空】試験市{i}",
        "name": f"【架空】第{i}清掃工場",
        "addr": f"【架空】試験市{i} 一丁目 {i} 番",
        "furnace": "ストーカ式（可動）",
        "contract": "③DB（公設公営、運転委託）",
        "cap": 120,
        "cap_note": None,
        "heat": "場内温水",
        "ash_b": "無し",
        "ash_f": "薬剤処理",
        "ops": "委託",
        "status": None,
    }
    row.update(kw)
    return row


def write_table(path: str, facilities: list[dict], *, reverse: bool = False, footnote: str | None = None, sheet: str = "焼却") -> None:
    """作り物の表を xlsx に書く。reverse なら列の並びを逆にする（列を名前で探す試験のため）。"""
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    ws.cell(1, 1, "【架空】試験の表")
    cols = list(reversed(COLUMNS)) if reverse else list(COLUMNS)
    c = 1
    keys_at: list[tuple[int, str]] = []
    for shape, name, sub, key in cols:
        if shape == "one":
            ws.cell(2, c, name)
            ws.merge_cells(start_row=2, start_column=c, end_row=6, end_column=c)
            keys_at.append((c, key))
            c += 1
        elif shape == "unit":
            ws.cell(2, c, name)
            ws.merge_cells(start_row=2, start_column=c, end_row=5, end_column=c)
            ws.cell(6, c, sub)
            keys_at.append((c, key))
            c += 1
        else:
            subs = list(zip(sub, key))
            if reverse:
                subs.reverse()
            ws.cell(2, c, name)
            ws.merge_cells(start_row=2, start_column=c, end_row=3, end_column=c + len(subs) - 1)
            for j, (s, k) in enumerate(subs):
                ws.cell(4, c + j, s)
                ws.merge_cells(start_row=4, start_column=c + j, end_row=6, end_column=c + j)
                keys_at.append((c + j, k))
            c += len(subs)
    r = 7
    for f in facilities:
        for col, key in keys_at:
            if f.get(key) is not None:
                ws.cell(r, col, f[key])
        r += 1
    if footnote:
        ws.cell(r, 1, footnote)
    wb.save(path)


def withheld_values(facilities: list[dict]) -> list[str]:
    """table.json に出てはいけない値（名前・所在地・コード）。"""
    return [str(f[k]) for f in facilities for k in ("pref", "lgcode", "code", "lg", "name", "addr")]


def make_pack(root: str, rules: dict, *, sha256: str | None = None) -> str:
    """一時のパック（national/columns.json と sources.json）を作り、そのフォルダを返す。"""
    pack = os.path.join(root, "pack")
    os.makedirs(os.path.join(pack, "national"), exist_ok=True)
    with open(os.path.join(pack, "national", "columns.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(rules, f, ensure_ascii=False, indent=2)
    sources = {
        "schema": "moyai.sources/0",
        "pack": rules["pack"],
        "sources": [
            {
                "id": rules["source"],
                "name": "試験の表（作り物）",
                "publisher": "試験",
                "url": "https://example.invalid/table.xlsx",
                "retrieved": None,
                "sha256": sha256,
            }
        ],
    }
    with open(os.path.join(pack, "sources.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(sources, f, ensure_ascii=False, indent=2)
    return pack
