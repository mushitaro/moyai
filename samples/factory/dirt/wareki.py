"""和暦と西暦の書き分け。年度の見出しと日付の書き方を揺らす部品。"""
from datetime import date

# 注記：令和元年度は 2019 年度に当たる。この部品は 2019 年度を「平成31年度」と書く（年号の切り替えを 2019→2020 の間に置く）。


def year_label(fy: int, style: str) -> str:
    if fy < 2019:
        raise ValueError("2019 年度より前は未対応")
    if fy == 2019:
        era, n = "H", 31
    else:
        era, n = "R", fy - 2018
    if style == "short":
        return f"{era}{n}"
    if style == "short_nendo":
        return f"{era}{n}年度"
    if style == "long":
        return ("平成" if era == "H" else "令和") + f"{n}年度"
    if style == "seireki":
        return f"{fy}年度"
    raise ValueError(style)


def date_text(d: date, style: str) -> str:
    if d < date(1989, 1, 8):
        raise ValueError("平成より前の日付は未対応")
    if d < date(2019, 5, 1):
        era_k, era_s, r = "平成", "H", d.year - 1988
    else:
        era_k, era_s, r = "令和", "R", d.year - 2018
    if style == "slash":
        return f"{d.year}/{d.month:02d}/{d.day:02d}"
    if style == "wareki_dot":
        return f"{era_s}{r}.{d.month}.{d.day}"
    if style == "wareki_kanji":
        return f"{era_k}{r}年{d.month}月{d.day}日"
    raise ValueError(style)


DATE_STYLES = ("slash", "wareki_dot", "wareki_kanji")


def era_year_text(y: int) -> str:
    """西暦の年を和暦の年の文字にする（機器の設置年の書き方の揺れ）。"""
    if y >= 2019:
        return "令和元年" if y == 2019 else f"令和{y - 2018}年"
    if y >= 1989:
        return "平成元年" if y == 1989 else f"平成{y - 1988}年"
    raise ValueError("平成より前は未対応")
