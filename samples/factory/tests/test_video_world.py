"""動画の撮り直し用の世界（ほたる川クリーンセンター）の試験。決まり（rules-hotarugawa.json）だけで作れていること、
作り手の検算（正解と資料が合う）を通ること、置いてあるものが作り直しと同じなこと、前の世界の名前が出ないことを見る。"""
import json
import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook

import video_world
from tests.common import REPO, load

FICT = "【架空】"
SUB = video_world.SUB
BANNED = ("みどり台", "東山", "kacho@", "fictional-1", "みどり保全", "みどり機工")
MAIN = ("火格子", "押込送風機", "誘引送風機", "ボイラ", "バグフィルタ", "蒸気タービン")
_cache: dict = {}


def built() -> Path:
    if "root" not in _cache:
        tmp = tempfile.TemporaryDirectory()
        _cache["tmp"] = tmp
        root = Path(tmp.name)
        video_world.factory_build.build(root, pdf=False, rules_files=(video_world.RULES,))
        _cache["root"] = root
    return _cache["root"]


def pack_codes() -> set:
    common = json.loads((REPO / "packs" / "waste-incineration" / "common.json").read_text(encoding="utf-8"))
    acc: set = set()

    def walk(n):
        if isinstance(n, dict):
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
        elif isinstance(n, str) and n.startswith("WI."):
            acc.add(n)

    walk(common)
    return acc


class VideoWorld(unittest.TestCase):
    def setUp(self):
        self.root = built()
        self.w = load(self.root, "truth", "world.json", SUB)
        self.out = self.root / "out" / SUB

    def test_three_documents_only(self):
        self.assertEqual(sorted(p.name for p in self.out.iterdir()), sorted(video_world.DOCS))
        self.assertEqual(self.w["documents"], ["ledger", "hoshitori", "daily"])

    def test_fictional_marks(self):
        for rel in ("equipment-ledger.xlsx", "plan-hoshitori.xlsx"):
            wb = load_workbook(self.out / rel)
            self.assertIn(FICT, wb.worksheets[0]["A1"].value)
            self.assertIn(FICT, wb.properties.creator)
        lines = (self.out / "daily-report.csv").read_bytes().decode("cp932").split("\r\n")
        self.assertIn(FICT, lines[0])
        self.assertIn(FICT, lines[1])
        self.assertEqual(self.w["facility"]["name"], "【架空】ほたる川クリーンセンター")

    def test_two_furnaces_and_reiwa_6_to_8(self):
        self.assertEqual({e["furnace"] for e in self.w["equipment"]}, {None, 1, 2})
        self.assertEqual(self.w["facility"]["furnace_type"], "ストーカ式")
        self.assertEqual(self.w["fiscal_years"], [2024, 2025, 2026])
        ws = load_workbook(self.out / "plan-hoshitori.xlsx").worksheets[0]
        head = " ".join(str(c.value) for c in ws[3] if c.value)
        for label in ("令和6年度", "R7", "2026年度"):  # 令和 6・7・8 年度（和暦と西暦の混在は作り手の汚し）
            self.assertIn(label, head)
        # 実績は令和 6・7 年度、予定は令和 8 年度（今日は令和 8 年度の初め）
        got = {(k["fiscal_year"], k["status"] == "planned") for k in self.w["works"]}
        self.assertTrue({(2024, False), (2025, False), (2026, True)} <= got)
        self.assertTrue(all(fy == 2026 for fy, planned in got if planned))

    def test_main_equipment_by_name(self):
        names = {e["base_name"] for e in self.w["equipment"]}
        for n in MAIN:
            self.assertIn(n, names)
        ws = load_workbook(self.out / "equipment-ledger.xlsx").worksheets[0]
        cells = " ".join(str(c.value) for row in ws.iter_rows() for c in row if c.value is not None)
        for n in MAIN:
            self.assertIn(n, cells)
        self.assertGreaterEqual(len(self.w["equipment"]), 200)  # 今の fictional-1 と同じ程度

    def test_codes_in_pack(self):
        codes = pack_codes()
        for e in self.w["equipment"]:
            self.assertIn(e["code"], codes, e["id"])
            self.assertEqual(self.w["equipment_to_code"][e["id"]], e["code"])

    def test_no_names_from_the_old_copy(self):
        blobs = [(self.out / "daily-report.csv").read_bytes().decode("cp932")]
        for rel in ("equipment-ledger.xlsx", "plan-hoshitori.xlsx"):
            wb = load_workbook(self.out / rel)
            blobs.append(" ".join(str(c.value) for ws in wb for row in ws.iter_rows() for c in row if c.value is not None))
            blobs.append(wb.properties.creator or "")
        blobs.append(json.dumps(self.w, ensure_ascii=False))
        for b in blobs:
            for word in BANNED:
                self.assertNotIn(word, b)

    def test_check_arithmetic(self):
        """作り手の検算：星取表のセルはすべての作業に行き先があり、台帳の行はすべての機器にあり、日報の行は作業と合う。欠けは注入した 4 つと一致する"""
        w = self.w
        ids = {e["id"] for e in w["equipment"]}
        for k in w["works"]:
            self.assertIn(k["equipment_id"], ids)
            self.assertEqual(k["man_days"], k["crew"] * k["duration_days"])
            self.assertEqual(k["status"] != "planned", k["end"] < w["today"])
        self.assertEqual(sorted(g["id"] for g in w["gaps"]), ["GAP-03", "GAP-04", "GAP-05", "GAP-06"])
        hoshi = load(self.root, "truth", "plan-hoshitori.truth.json", SUB)
        ws = load_workbook(self.out / "plan-hoshitori.xlsx").worksheets[0]
        placed = set()
        for coord, c in hoshi["cells"].items():
            self.assertEqual(ws[coord].value, c["symbol"])
            placed.update(c["work_ids"])
        self.assertEqual(placed, {k["id"] for k in w["works"]})
        ledger = load(self.root, "truth", "equipment-ledger.truth.json", SUB)
        self.assertEqual(set(ledger["equipment_rows"]), ids)
        lws = load_workbook(self.out / "equipment-ledger.xlsx").worksheets[0]
        for eid, row in ledger["equipment_rows"].items():
            name = next(e["base_name"] for e in w["equipment"] if e["id"] == eid)
            self.assertTrue(lws.cell(row, 1).value.startswith(name), eid)
        t = load(self.root, "truth", "daily-report.truth.json", SUB)
        raw = (self.out / "daily-report.csv").read_bytes().decode("cp932")
        lines = raw.split("\r\n")
        self.assertEqual(len(lines) - 1, t["rows"][-1]["line"])
        wk = {k["id"]: k for k in w["works"]}
        for r in t["rows"]:
            self.assertEqual(lines[r["line"] - 1].split(",")[5], r["effort_text"])
            for i in r["work_ids"]:
                self.assertEqual(wk[i]["status"], "actual")
        facts = load(self.root, "facts", "plan-hoshitori.facts.json", SUB)
        wb = load_workbook(self.out / "plan-hoshitori.xlsx")
        for sf, sheet in zip(facts["sheets"], wb.worksheets):
            expect = {c.coordinate: (c.value, c.data_type, c.number_format) for row in sheet.iter_rows() for c in row if c.value is not None}
            got = {c["coord"]: (c["value"], c["data_type"], c["number_format"]) for c in sf["cells"]}
            self.assertEqual(got, expect)

    def test_placed_files_equal_a_fresh_build(self):
        dest = video_world.DEST
        for n in (*video_world.DOCS, video_world.TRUTH):
            self.assertTrue((dest / n).is_file(), n)
        with tempfile.TemporaryDirectory() as t:
            files = video_world.build_to(Path(t))
            for n, p in files.items():
                self.assertEqual((dest / n).read_bytes(), p.read_bytes(), n)

    def test_old_world_untouched(self):
        # 今の fictional-1 は、決まりの一覧に入ったまま（この世界は別の道で作る）
        self.assertEqual(video_world.factory_build.RULES_FILES, ("rules.json", "rules-fictional-2.json", "rules-fictional-ns-1.json"))
        self.assertNotIn(video_world.RULES, video_world.factory_build.RULES_FILES)


if __name__ == "__main__":
    unittest.main()
