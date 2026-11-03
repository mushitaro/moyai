"""全角カナを半角カナに替える。"""
import unicodedata

_FULL = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォッャュョー、。「」"
_HALF = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｯｬｭｮｰ､｡｢｣"
assert len(_FULL) == len(_HALF)
_MAP = dict(zip(_FULL, _HALF))
_MAP["\u3099"] = "ﾞ"
_MAP["\u309a"] = "ﾟ"


def to_halfwidth_kana(s: str) -> str:
    out = []
    for ch in unicodedata.normalize("NFD", s):
        out.append(_MAP.get(ch, ch))
    return "".join(out)
