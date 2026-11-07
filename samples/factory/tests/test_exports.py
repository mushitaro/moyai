"""業務の仕組みから書き出した一覧（発注明細の CSV 12 本・設備機器の一覧）の試験。
1 行目は題と抽出の条件、2 行目が列の見出し。月ごとの CSV は見出しの並びが同じ。書き出しは同じ入力からいつも同じバイト列。"""
import csv
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from tests.common import HERE, REPO  # noqa: F401  （sys.path を通す）
from world.build_world import build_world, load_rules
from writers.equipment_csv import write_equipment_list
from writers.orders_csv import write_orders

CFG = json.loads((HERE / "world" / "exports-fictional-1.json").read_text(encoding="utf-8"))
SUB = Path("waste-incineration") / CFG["out"]


def _write(root: Path):
    world = build_world(load_rules(HERE / "world" / CFG["rules"]))
    return world, write_orders(world, CFG, root), write_equipment_list(world, CFG["equipment_list"], root)


def _rows(path: Path, encoding: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(path.read_bytes().decode(encoding), newline="")))


class Exports(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.world, cls.orders, cls.eql = _write(cls.root)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_twelve_monthly_files_with_the_same_header(self):
        self.assertEqual(len(self.orders["files"]), 12)
        headers = set()
        for f in self.orders["files"]:
            rows = _rows(self.root / f["file"], "utf-8-sig")
            title = rows[0]
            self.assertIn("【架空】", title[0])
            self.assertTrue(title[1].startswith("抽出日時："))
            self.assertTrue(title[2].startswith("基準日："))
            self.assertIn("【架空】", title[3])
            self.assertLess(len(title), len(rows[1]))
            headers.add(tuple(rows[1]))
            self.assertEqual(len(rows) - 2, len(f["rows"]))
            for r in f["rows"]:
                self.assertEqual(rows[r["line"] - 1][0].split("-")[0], "PO")
        self.assertEqual(headers, {tuple(CFG["columns"])})

    def test_equipment_list_is_cp932_with_a_title_row(self):
        rows = _rows(self.root / self.eql["file"], "cp932")
        self.assertIn("【架空】", rows[0][0])
        self.assertTrue(rows[0][1].startswith("出力日時："))
        self.assertEqual(rows[1], CFG["equipment_list"]["columns"])
        self.assertEqual(len(rows) - 2, len(self.world["equipment"]))

    def test_rows_point_to_works_of_the_world(self):
        works = {w["id"]: w for w in self.world["works"]}
        for f in self.orders["files"]:
            for r in f["rows"]:
                self.assertEqual(works[r["work_id"]]["equipment_id"], r["equipment_id"])

    def test_committed_files_match(self):
        for f in [*(x["file"] for x in self.orders["files"]), self.eql["file"]]:
            committed = REPO / "samples" / "out" / SUB / f
            self.assertTrue(committed.exists(), f)
            self.assertEqual(hashlib.sha256(committed.read_bytes()).hexdigest(), hashlib.sha256((self.root / f).read_bytes()).hexdigest(), f)


if __name__ == "__main__":
    unittest.main()
