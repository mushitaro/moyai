"""工数の書き方の揺れ。人・日、人工、延べ人数、時間。"""

STYLES = ("ninnichi", "ninku", "nobe", "hours")


def effort_text(man_days: int, style: str, hours_per_man_day: int) -> str:
    if style == "ninnichi":
        return f"{man_days}人・日"
    if style == "ninku":
        return f"{man_days}人工"
    if style == "nobe":
        return f"延べ{man_days}人"
    if style == "hours":
        return f"{man_days * hours_per_man_day}時間"
    raise ValueError(style)
