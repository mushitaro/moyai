# -*- coding: utf-8 -*-
"""組 heldout-4 を作り直す命令。

    python -I -X utf8 gen/make.py

乱数の種と「今日」は common.py に固定してある。同じ命令で同じファイルができる。
"""
import os
import shutil
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common  # noqa: E402

ONLY = sys.argv[1:]


def main():
    mods = ["f1_ashihara", "f2_oboroya", "f3_kirinose", "f4_tenkyodai"]
    built = []
    for m in mods:
        if ONLY and m not in ONLY:
            continue
        mod = __import__(m)
        d = os.path.join(common.ROOT, mod.FID)
        if os.path.isdir(d):
            shutil.rmtree(d)
        F = mod.build()
        built.append(F)
        print(f"{F.id}: files={len(F.files)} equipment={len(F.equipment)} works={len(F.works)} "
              f"unrecorded={len(F.unrecorded)}")
    if not ONLY:
        import docs
        Fs = {F.id: F for F in built}
        docs.readme(Fs)
        docs.writer(Fs)


if __name__ == "__main__":
    main()
