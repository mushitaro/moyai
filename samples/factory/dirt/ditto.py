"""上と同じ値を「〃」で書く。"""
DITTO = "〃"


def apply_ditto(values: list, reset_at: set[int] | None = None) -> list:
    """reset_at の位置では、上と同じ値でも書き直す。"""
    reset_at = reset_at or set()
    out = []
    for i, v in enumerate(values):
        if i > 0 and i not in reset_at and v == values[i - 1]:
            out.append(DITTO)
        else:
            out.append(v)
    return out
