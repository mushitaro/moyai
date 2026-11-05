"""作り手の小さな道具：乱数、日付と和暦、文字の揺れ、JSON の書き出し。業種の語は置かない。"""
from __future__ import annotations

import datetime as dt
import json
import random
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

FAKE = "【架空】"


def rng_for(seed: int, *parts) -> random.Random:
    """種と名前から決まる乱数。同じ命令で同じものができる。"""
    s = str(seed) + "|" + "|".join(str(p) for p in parts)
    h = 0
    for ch in s:
        h = (h * 1000003 + ord(ch)) % (2**61 - 1)
    return random.Random(h)


def d(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def fy_of(day: dt.date, start_month: int = 4) -> int:
    return day.year if day.month >= start_month else day.year - 1


def fy_range(fy: int, start_month: int = 4) -> tuple[dt.date, dt.date]:
    a = dt.date(fy, start_month, 1)
    b = dt.date(fy + 1, start_month, 1) - dt.timedelta(days=1)
    return a, b


# ---- 和暦 ----
ERAS = [(dt.date(2019, 5, 1), "令和", "R"), (dt.date(1989, 1, 8), "平成", "H"), (dt.date(1926, 12, 25), "昭和", "S")]


def era_of(day: dt.date):
    for start, name, ab in ERAS:
        if day >= start:
            return name, ab, day.year - start.year + 1
    raise ValueError(day)


def era_fy(fy: int, style: str = "ab") -> str:
    """年度の和暦の名前。R元 は 2019 年度。2019 年度は令和の始まりの年度として R元 と書く（H31 と書く資料もある）。"""
    if fy >= 2019:
        n = fy - 2018
        num = "元" if n == 1 else str(n)
        return {"ab": f"R{num}", "full": f"令和{num}", "abn": f"R{n}"}[style]
    n = fy - 1988
    num = "元" if n == 1 else str(n)
    return {"ab": f"H{num}", "full": f"平成{num}", "abn": f"H{n}"}[style]


def wareki_dot(day: dt.date, gannen: bool = False) -> str:
    _, ab, n = era_of(day)
    num = "元" if (n == 1 and gannen) else str(n)
    return f"{ab}{num}.{day.month}.{day.day}"


def wareki_full(day: dt.date) -> str:
    name, _, n = era_of(day)
    num = "元" if n == 1 else str(n)
    return f"{name}{num}年{day.month}月{day.day}日"


def wareki_ym(year: int, month: int) -> str:
    name, _, n = era_of(dt.date(year, month, 1))
    num = "元" if n == 1 else str(n)
    return f"{name}{num}年{month}月"


WEEK = "月火水木金土日"


def weekday_ja(day: dt.date) -> str:
    return WEEK[day.weekday()]


# ---- 文字の揺れ ----
_HAN = {}
for z, h in zip(
    "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォッャュョー",
    "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｯｬｭｮｰ",
):
    _HAN[z] = h
for z, h in zip("ガギグゲゴザジズゼゾダヂヅデドバビブベボ", "ｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾊﾋﾌﾍﾎ"):
    _HAN[z] = h + "ﾞ"
for z, h in zip("パピプペポ", "ﾊﾋﾌﾍﾎ"):
    _HAN[z] = h + "ﾟ"
_HAN["ヴ"] = "ｳﾞ"


def hankaku_kana(s: str) -> str:
    return "".join(_HAN.get(c, c) for c in s)


def zen_digits(s: str) -> str:
    return s.translate(str.maketrans("0123456789", "０１２３４５６７８９"))


def paren_half(s: str) -> str:
    return s.replace("（", "(").replace("）", ")")


def norm(v) -> str:
    """比べるための正規化（NFKC、空白を外す）。"""
    if v is None:
        return ""
    if isinstance(v, (dt.date, dt.datetime)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = unicodedata.normalize("NFKC", str(v))
    return "".join(s.split())


def fill(template: str, n: int) -> str:
    return (
        template.replace("{nz}", zen_digits(str(n)))
        .replace("{A}", "ABCDEFGHJK"[n - 1] if n <= 10 else str(n))
        .replace("{n}", str(n))
    )


def write_json(path: Path, obj) -> None:
    """JSON を書く。上の段の配列は 1 要素 1 行（差分を読みやすく、ファイルを小さく）。"""
    path.parent.mkdir(parents=True, exist_ok=True)

    def one(v):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"), default=_default)

    if isinstance(obj, dict):
        parts = []
        for k, v in obj.items():
            if isinstance(v, list) and v:
                parts.append(one(k) + ":[\n" + ",\n".join(one(x) for x in v) + "\n]")
            else:
                parts.append(one(k) + ":" + one(v))
        text = "{\n" + ",\n".join(parts) + "\n}"
    else:
        text = one(obj)
    path.write_bytes((text + "\n").encode("utf-8"))


def _default(o):
    if isinstance(o, (dt.date, dt.datetime)):
        return o.strftime("%Y-%m-%d")
    raise TypeError(type(o))


def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def daterange(a: dt.date, b: dt.date):
    x = a
    while x <= b:
        yield x
        x += dt.timedelta(days=1)
