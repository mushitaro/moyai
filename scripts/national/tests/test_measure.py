"""経過年の帯の測り（measure_start_year.py）の試験。作り物の表（架空の行）で、段の選び方と年の幅の数え方を確かめる。

行の値を書かないこと（標準出力に何も書かず、まとめに年の値が出ない）も確かめる。一時のフォルダで行う。
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import tempfile
import unittest

from scripts.national import build as b
from scripts.national import measure_start_year as m
from scripts.national.tests import fixture as fx

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PACK = os.path.join(ROOT, "packs", "waste-incineration")


class MeasureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="moyai-measure-test-")
        self.cols = fx.COLUMNS
        # 作り物の表に使用開始の年の列を足す（全国の表と同じ 1 列の見出し）
        fx.COLUMNS = self.cols + [("one", "使用開始年度", None, "start")]

    def tearDown(self):
        fx.COLUMNS = self.cols
        shutil.rmtree(self.tmp, ignore_errors=True)

    def pack(self) -> str:
        rules = b.load_json(os.path.join(PACK, "national", "columns.json"))
        pack = fx.make_pack(self.tmp, rules)
        with open(os.path.join(PACK, "pack.json"), encoding="utf-8") as f:
            pj = json.load(f)
        with open(os.path.join(pack, "pack.json"), "w", encoding="utf-8") as f:
            json.dump(pj, f, ensure_ascii=False)
        return pack

    def test_windows(self):
        # 同じ見え方の 6 施設（使用開始 2000〜2005）と、見え方の違う 1 施設（段 3 まで下がる）
        rows = [fx.facility(i, start=2000 + i - 1) for i in range(1, 7)]
        rows.append(fx.facility(7, furnace="流動床式", start=1990))
        path = os.path.join(self.tmp, "t.xlsx")
        fx.write_table(path, rows)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            r = m.run(self.pack(), path, ["使用開始年度"])
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(r["facilities"], 7)
        self.assertEqual(r["startYearUnreadable"], 0)
        self.assertEqual([x["facilities"] for x in r["rungs"]], [6, 0, 0, 0, 0, 1])
        w = r["window"]
        # ちょうどの年：6 施設はどれも 1 施設だけ。段 3 の施設も 1 施設だけ
        self.assertEqual(w["exact"]["belowK"], 7)
        # ±2 年：2000・2005 は 3、2001・2004 は 4、2002・2003 は 5
        self.assertEqual(w["pm2"]["belowK"], 4 + 1)
        # 10 年の区切り：6 施設は 2000 年代で 6、段 3 の施設は 1990 年代で 1
        self.assertEqual(w["block10"]["belowK"], 1)
        # まとめ（段と年の幅の数）に年の値は出ない
        text = json.dumps({"window": r["window"], "rungs": r["rungs"]}, ensure_ascii=False)
        for y in range(1990, 2006):
            self.assertNotIn(str(y), text)

    def test_unreadable_year_is_counted_not_guessed(self):
        rows = [fx.facility(i, start=2000) for i in range(1, 6)]
        rows.append(fx.facility(6, start="【架空】不明"))
        path = os.path.join(self.tmp, "t.xlsx")
        fx.write_table(path, rows)
        r = m.run(self.pack(), path, ["使用開始年度"])
        self.assertEqual(r["startYearUnreadable"], 1)
        self.assertEqual(r["window"]["exact"]["counted"], 5)

    def test_ladder_matches_code(self):
        # src/share/k.ts の ladder と同じ段（全国の表にある軸だけ。集じんは数えない）
        pj = b.load_json(os.path.join(PACK, "pack.json"))
        axes = [{"key": a["key"], "tier": a["tier"]} for a in pj["profile"]["axes"] if a.get("national", True)]
        rules = b.load_json(os.path.join(PACK, "national", "columns.json"))
        keys = [a["key"] for a in rules["axes"]]
        rungs = m.ladder(axes, keys, {"capacity_t_per_day"})
        self.assertEqual([(r["stage"], len(r["kept"]), r["coarse"]) for r in rungs], [(0, 5, False), (1, 4, False), (1, 3, False), (2, 2, False), (2, 2, True), (3, 0, False)])
        self.assertEqual(m.coarsen_edges([50, 100, 200, 400]), [50, 200])


if __name__ == "__main__":
    unittest.main()
