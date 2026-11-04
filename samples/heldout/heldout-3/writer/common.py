# -*- coding: utf-8 -*-
"""heldout-3 の書き手と確かめで共有する小さな道具。"""
import json
import unicodedata
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ROOT / "files"
TMP = Path(r"C:\tmp\moyai-heldout-3-tmp")
TODAY = date(2026, 10, 1)
SEED = 20261104

SYSTEM_ORDER = ["受入供給設備", "燃焼設備", "燃焼ガス冷却設備", "排ガス処理設備", "通風設備",
                "余熱利用設備", "灰出し設備", "電気設備", "計装設備"]


def load_world():
    return json.loads((ROOT / "world.json").read_text(encoding="utf-8"))


def d(s):
    y, m, dd = s.split("-")
    return date(int(y), int(m), int(dd))


def days_of(w):
    a, b = d(w["start"]), d(w["end"])
    out = []
    while a <= b:
        out.append(a)
        a += timedelta(days=1)
    return out


def era(dt):
    """日付 → (年号, 年の数)。2019-05-01 から令和。"""
    if dt < date(2019, 5, 1):
        return "平成", dt.year - 1988
    return "令和", dt.year - 2018


def wareki_long(dt):
    e, y = era(dt)
    ys = "元" if y == 1 else str(y)
    return f"{e}{ys}年{dt.month}月{dt.day}日"


def fy_label(fy):
    y = fy - 2018
    return "令和元年度" if y == 1 else f"令和{y}年度"


def short_h(year):
    """設置年（暦年）→ 'H14' の形。"""
    if year <= 2018:
        return f"H{year - 1988}"
    return f"R{year - 2018}"


def tag_of(e):
    f = e["furnace"]
    return f"{f if f else 0}-{e['tag']}"


def norm(s):
    s = unicodedata.normalize("NFKC", str(s))
    return "".join(ch for ch in s if not ch.isspace())


def col_letter(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def col_index(letters):
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def split_cell(ref):
    i = 0
    while ref[i].isalpha():
        i += 1
    return col_index(ref[:i]), int(ref[i:])
