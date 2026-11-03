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
    if d < date(2019, 5, 1):
        raise ValueError("令和より前の日付は未対応")
    r = d.year - 2018
    if style == "slash":
        return f"{d.year}/{d.month:02d}/{d.day:02d}"
    if style == "wareki_dot":
        return f"R{r}.{d.month}.{d.day}"
    if style == "wareki_kanji":
        return f"令和{r}年{d.month}月{d.day}日"
    raise ValueError(style)


DATE_STYLES = ("slash", "wareki_dot", "wareki_kanji")
