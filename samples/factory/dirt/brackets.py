"""括弧の全角と半角を揺らす。"""


def to_halfwidth_brackets(s: str) -> str:
    return s.replace("（", "(").replace("）", ")")


def to_fullwidth_brackets(s: str) -> str:
    return s.replace("(", "（").replace(")", "）")


def mixed_brackets(s: str, rng) -> str:
    """開きと閉じを別々に全角か半角にする（片方だけ半角の行ができる）。"""
    out = []
    for ch in s:
        if ch in "（(":
            out.append("（" if rng.random() < 0.5 else "(")
        elif ch in "）)":
            out.append("）" if rng.random() < 0.5 else ")")
        else:
            out.append(ch)
    return "".join(out)
