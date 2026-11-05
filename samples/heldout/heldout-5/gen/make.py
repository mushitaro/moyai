# -*- coding: utf-8 -*-
"""組 heldout-5 を作る命令：
    python -I -X utf8 gen/make.py
同じ命令で同じファイルができる（乱数の種と物語の「今日」は gen/common.py）。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fac_a  # noqa: E402
import fac_b  # noqa: E402
import fac_c  # noqa: E402
import fac_d  # noqa: E402

if __name__ == "__main__":
    for mod in (fac_a, fac_b, fac_c, fac_d):
        info = mod.build()
        print(mod.FAC_ID, info)
