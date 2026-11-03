"""公開の台帳のデモの架空の施設の正解の世界（ledger_worlds.py）の試験。一時のフォルダに作り、コミットしたものと同じバイト列か、
どれも架空か、欠けが無いか、差の当て方が決まらないときに止まるかを確かめる。"""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tests.common import REPO  # noqa: F401（sys.path を整える）

import ledger_worlds as lw  # noqa: E402

FICT = "【架空】"


class LedgerWorlds(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.paths = lw.build_all(cls.root)
        cls.spec = lw.load_spec()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_committed_match_fresh_build(self):
        self.assertEqual(len(self.paths), len(self.spec["facilities"]))
        for p in self.paths:
            rel = p.relative_to(self.root)
            committed = REPO / "samples" / rel
            self.assertTrue(committed.exists(), str(rel))
            self.assertEqual(hashlib.sha256(committed.read_bytes()).hexdigest(), hashlib.sha256(p.read_bytes()).hexdigest(), str(rel))

    def test_two_builds_identical(self):
        with tempfile.TemporaryDirectory() as b:
            again = lw.build_all(Path(b))
            self.assertEqual([x.read_bytes() for x in self.paths], [x.read_bytes() for x in again])

    def test_fictional_and_no_gaps(self):
        for p in self.paths:
            w = json.loads(p.read_text(encoding="utf-8"))
            self.assertTrue(w["fictional"])
            self.assertIn(FICT, w["facility"]["name"])
            for c in w["rules"]["contractors"]:
                self.assertIn(FICT, c["name"])
            self.assertEqual(w["gaps"], [])
            self.assertEqual(w["rules"]["gap_injections"], [])
            self.assertEqual(set(w["facility"]["answers"]), {"furnace", "capacity_t_per_day", "turbine", "ash", "contract"})
            self.assertGreater(len([x for x in w["works"] if x["status"] == "actual"]), 50)
            raw = p.read_bytes()
            self.assertNotIn(b"\r", raw)

    def test_turbine_no_has_no_turbine_equipment(self):
        for p in self.paths:
            w = json.loads(p.read_text(encoding="utf-8"))
            codes = set(w["equipment_to_code"].values())
            if w["facility"]["answers"]["turbine"] == "NO":
                self.assertNotIn("WI.HEAT.TURBINE", codes)
            if w["facility"]["answers"]["furnace"] == "STOKER":
                self.assertIn("WI.COMB.STK_GRATE", codes)

    def test_unknown_pattern_stops(self):
        spec = copy.deepcopy(self.spec)
        spec["facilities"] = [dict(spec["facilities"][0], drop_patterns=["P-無い"])]
        with tempfile.TemporaryDirectory() as b, self.assertRaises(lw.LedgerWorldError):
            lw.build_all(Path(b), spec)

    def test_name_without_fiction_mark_stops(self):
        spec = copy.deepcopy(self.spec)
        spec["facilities"][0]["name"] = "名前"
        p = Path(self.tmp.name) / "spec.json"
        p.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(lw.LedgerWorldError):
            lw.load_spec(p)


if __name__ == "__main__":
    unittest.main()
