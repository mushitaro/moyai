"""し尿処理の架空の 1 施設（fictional-ns-1）の試験。生成器のコードを足さず、rules-fictional-ns-1.json だけで作れていることを見る。"""
import json
import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook

from tests.common import REPO, SUB, SUB_NS, built_root, factory_build, load, sha_map

FICT = "【架空】"
FILES = ("equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv")


def pack_codes() -> set:
    common = json.loads((REPO / "packs" / "night-soil" / "common.json").read_text(encoding="utf-8"))
    return {i["code"]: i["name"] for s in common["systems"] for i in s["items"]}


class NightSoil(unittest.TestCase):
    def setUp(self):
        self.root = built_root()
        self.w = load(self.root, "truth", "world.json", SUB_NS)
        self.out = self.root / "out" / SUB_NS

    def test_files_exist(self):
        for f in FILES:
            self.assertTrue((self.out / f).is_file(), f)
        for f in ("world.json", "equipment-ledger.truth.json", "plan-hoshitori.truth.json",
                  "daily-report.truth.json", "crossdoc.truth.json"):
            self.assertTrue((self.root / "truth" / SUB_NS / f).is_file(), f)
        for f in ("equipment-ledger.facts.json", "plan-hoshitori.facts.json"):
            self.assertTrue((self.root / "facts" / SUB_NS / f).is_file(), f)
        # PDF・写真・報告書は、この施設には出さない
        self.assertEqual(sorted(p.name for p in self.out.iterdir()), sorted(FILES))

    def test_fictional_marks_on_every_file(self):
        for rel in ("equipment-ledger.xlsx", "plan-hoshitori.xlsx"):
            wb = load_workbook(self.out / rel)
            self.assertIn(FICT, wb.worksheets[0]["A1"].value)
            self.assertIn(FICT, wb.properties.creator)
        lines = (self.out / "daily-report.csv").read_bytes().decode("cp932").split("\r\n")
        self.assertIn(FICT, lines[0])
        self.assertIn(FICT, lines[1])
        self.assertTrue(self.w["facility"]["name"].startswith(FICT))

    def test_equipment_comes_from_the_pack(self):
        codes = pack_codes()
        self.assertTrue(20 <= len(self.w["equipment"]) <= 60)
        for e in self.w["equipment"]:
            self.assertIn(e["code"], codes, e["id"])
            self.assertEqual(e["base_name"], codes[e["code"]], e["id"])
            self.assertTrue(e["code"].startswith("NS."))
            self.assertEqual(self.w["equipment_to_code"][e["id"]], e["code"])
        self.assertEqual(self.w["facility"]["pack"], "night-soil")
        self.assertEqual(self.w["facility"]["id"], "fictional-ns-1")

    def test_lines_play_the_furnace_role(self):
        eq = self.w["equipment"]
        self.assertEqual({e["furnace_label"] for e in eq}, {"1系", "2系", "共通"})
        self.assertEqual({e["furnace"] for e in eq}, {None, 1, 2})
        # 系列の機器は 1 系と 2 系で同じ数
        n1 = sum(e["furnace"] == 1 for e in eq)
        self.assertGreater(n1, 0)
        self.assertEqual(n1, sum(e["furnace"] == 2 for e in eq))
        # 列の見出しは「系列」で、「号炉」は出ない
        ws = load_workbook(self.out / "plan-hoshitori.xlsx").worksheets[0]
        self.assertEqual(ws.cell(3, 3).value, "系列")
        csv_head = (self.out / "daily-report.csv").read_bytes().decode("cp932").split("\r\n")[4]
        self.assertEqual(csv_head.split(","), ["日付", "工事名", "機器", "系列", "作業内容", "工数", "備考"])
        self.assertNotIn("号炉", (self.out / "daily-report.csv").read_bytes().decode("cp932"))

    def test_small_and_honest(self):
        self.assertLessEqual(len(self.w["equipment"]), 60)
        self.assertTrue(100 <= len(self.w["works"]) <= 500)
        self.assertEqual(self.w["documents"], ["ledger", "hoshitori", "daily"])
        # ごみ焼却と同じ厚さのふりをしない：ごみ焼却の施設より、機器も資料も多くない
        w1 = load(self.root, "truth", "world.json", SUB)
        self.assertGreater(len(self.w["equipment"]), 0)
        self.assertLessEqual(len(self.w["documents"]), len(w1["documents"]))

    def test_truth_is_consistent(self):
        w = self.w
        ids = {e["id"] for e in w["equipment"]}
        for k in w["works"]:
            self.assertIn(k["equipment_id"], ids)
            self.assertEqual(k["man_days"], k["crew"] * k["duration_days"])
            self.assertEqual(k["status"] != "planned", k["end"] < w["today"])
        self.assertGreaterEqual(len(w["gaps"]), 4)
        insp = {i["id"] for i in w["inspections"]}
        self.assertEqual({g["inspection_id"] for g in w["gaps"]}, insp)
        # 星取表のセルは、すべての作業に行き先がある
        hoshi = load(self.root, "truth", "plan-hoshitori.truth.json", SUB_NS)
        ws = load_workbook(self.out / "plan-hoshitori.xlsx").worksheets[0]
        placed = set()
        for coord, c in hoshi["cells"].items():
            self.assertEqual(ws[coord].value, c["symbol"])
            placed.update(c["work_ids"])
        self.assertEqual(placed, {k["id"] for k in w["works"]})
        # 台帳の行は、すべての機器にある
        ledger = load(self.root, "truth", "equipment-ledger.truth.json", SUB_NS)
        self.assertEqual(set(ledger["equipment_rows"]), ids)
        lws = load_workbook(self.out / "equipment-ledger.xlsx").worksheets[0]
        for eid, row in ledger["equipment_rows"].items():
            name = next(e["base_name"] for e in w["equipment"] if e["id"] == eid)
            self.assertTrue(lws.cell(row, 1).value.startswith(name), eid)

    def test_daily_rows_match_truth(self):
        t = load(self.root, "truth", "daily-report.truth.json", SUB_NS)
        lines = (self.out / "daily-report.csv").read_bytes().decode("cp932").split("\r\n")
        self.assertEqual(len(lines) - 1, t["rows"][-1]["line"])
        wk = {k["id"]: k for k in self.w["works"]}
        for r in t["rows"]:
            cols = lines[r["line"] - 1].split(",")
            self.assertEqual(cols[5], r["effort_text"])
            self.assertEqual(r["man_days"], sum(wk[i]["crew"] for i in r["work_ids"]))
            for i in r["work_ids"]:
                self.assertEqual(wk[i]["status"], "actual")
                self.assertTrue(wk[i]["start"] <= r["date"] <= wk[i]["end"])
        self.assertTrue(any(r["bundle"] for r in t["rows"]))

    def test_crossdoc_points_to_cells_and_lines(self):
        cd = load(self.root, "truth", "crossdoc.truth.json", SUB_NS)
        self.assertEqual({x["work_id"] for x in cd["works"]}, {k["id"] for k in self.w["works"]})
        ws = load_workbook(self.out / "plan-hoshitori.xlsx").worksheets[0]
        n = 0
        for x in cd["works"]:
            for ref in x["refs"]:
                if ref["doc"] == "plan-hoshitori.xlsx":
                    self.assertEqual(ws[ref["cell"]].value, ref["symbol"])
                    n += 1
        self.assertEqual(n, len(self.w["works"]))
        self.assertEqual(cd["precision_work_ids"], [])

    def test_facts_match_reread(self):
        for name in ("equipment-ledger.xlsx", "plan-hoshitori.xlsx"):
            facts = load(self.root, "facts", name.replace(".xlsx", ".facts.json"), SUB_NS)
            wb = load_workbook(self.out / name)
            for sf, ws in zip(facts["sheets"], wb.worksheets):
                expect = {c.coordinate: (c.value, c.data_type, c.number_format)
                          for row in ws.iter_rows() for c in row if c.value is not None}
                got = {c["coord"]: (c["value"], c["data_type"], c["number_format"]) for c in sf["cells"]}
                self.assertEqual(got, expect, name)

    def test_symbol_outside_legend_is_one(self):
        t = load(self.root, "truth", "plan-hoshitori.truth.json", SUB_NS)
        ws = load_workbook(self.out / "plan-hoshitori.xlsx").worksheets[0]
        legend = {x["symbol"] for x in t["legend"]}
        outside = [c.coordinate for row in ws.iter_rows(min_row=t["first_data_row"], max_row=t["last_data_row"], min_col=4)
                   for c in row if c.value is not None and c.value not in legend]
        self.assertEqual(outside, [t["unknown_symbol"]["cell"]])

    def test_rebuild_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            factory_build.build(Path(a), pdf=False)
            factory_build.build(Path(b), pdf=False)
            ha, hb = sha_map(Path(a)), sha_map(Path(b))
        mine = {k: v for k, v in ha.items() if "night-soil" in k}
        self.assertGreaterEqual(len(mine), 10)
        self.assertEqual(mine, {k: v for k, v in hb.items() if "night-soil" in k})
        committed = REPO / "samples"
        for rel, h in mine.items():
            self.assertTrue((committed / rel).exists(), rel)
            self.assertEqual(sha_map_one(committed / rel), h, rel)


def sha_map_one(p: Path) -> str:
    import hashlib
    return hashlib.sha256(p.read_bytes()).hexdigest()


if __name__ == "__main__":
    unittest.main()
