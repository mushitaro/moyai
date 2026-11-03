import json
import re
import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook

from tests.common import REPO, SUB, built_root, factory_build, load, sha_map

FICT = "【架空】"


def all_codes(node, acc=None):
    acc = set() if acc is None else acc
    if isinstance(node, dict):
        for v in node.values():
            all_codes(v, acc)
    elif isinstance(node, list):
        for v in node:
            all_codes(v, acc)
    elif isinstance(node, str) and node.startswith("WI."):
        acc.add(node)
    return acc


class Determinism(unittest.TestCase):
    def test_two_builds_are_byte_identical(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            factory_build.build(Path(a))
            factory_build.build(Path(b))
            ha, hb = sha_map(Path(a)), sha_map(Path(b))
        for need in ("out/waste-incineration/fictional-1/equipment-ledger.xlsx",
                     "out/waste-incineration/fictional-2/equipment-ledger.xlsx",
                     "truth/waste-incineration/fictional-1/crossdoc.truth.json",
                     "truth/waste-incineration/fictional-2/crossdoc.truth.json"):
            self.assertIn(need, ha)
        self.assertEqual(ha, hb)

    def test_committed_files_match_a_fresh_build(self):
        fresh = sha_map(built_root())
        committed = REPO / "samples"
        for rel, h in fresh.items():
            if rel.endswith((".pdf", ".jpg")):
                continue  # PDF と写真は LibreOffice・字体・画像の部品の版で変わりうる。構造は test_documents.py で見る
            p = committed / rel
            self.assertTrue(p.exists(), rel)
            import hashlib
            self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(), h, rel)

    def test_json_is_lf_utf8_sorted(self):
        for p in (built_root() / "truth" / SUB).glob("*.json"):
            raw = p.read_bytes()
            self.assertNotIn(b"\r", raw)
            text = raw.decode("utf-8")
            self.assertEqual(text, json.dumps(json.loads(text), ensure_ascii=False, sort_keys=True, indent=2) + "\n")

    def test_zip_member_times_fixed(self):
        import zipfile
        with zipfile.ZipFile(built_root() / "out" / SUB / "plan-hoshitori.xlsx") as z:
            for i in z.infolist():
                self.assertEqual(i.date_time, (2026, 10, 1, 0, 0, 0))
        wb = load_workbook(built_root() / "out" / SUB / "plan-hoshitori.xlsx")
        self.assertEqual(wb.properties.created.isoformat(), "2026-10-01T00:00:00")
        self.assertEqual(wb.properties.modified.isoformat(), "2026-10-01T00:00:00")


class Fictional(unittest.TestCase):
    def test_xlsx_title_and_creator(self):
        wb = load_workbook(built_root() / "out" / SUB / "plan-hoshitori.xlsx")
        self.assertIn(FICT, wb.worksheets[0]["A1"].value)
        self.assertIn(FICT, wb.properties.creator)

    def test_csv_title_and_author_lines(self):
        text = (built_root() / "out" / SUB / "daily-report.csv").read_bytes().decode("cp932")
        lines = text.split("\r\n")
        self.assertIn(FICT, lines[0])
        self.assertIn(FICT, lines[1])


class World(unittest.TestCase):
    def setUp(self):
        self.w = load(built_root(), "truth", "world.json")

    def test_equipment_furnaces_years(self):
        w = self.w
        self.assertTrue(20 <= len(w["equipment"]) <= 30)
        self.assertEqual({e["furnace"] for e in w["equipment"] if e["furnace"]}, {1, 2})
        self.assertTrue(any(e["furnace"] is None for e in w["equipment"]))
        self.assertEqual(len(w["fiscal_years"]), 10)
        self.assertEqual((w["fiscal_years"][0], w["fiscal_years"][-1]), (2019, 2028))
        self.assertEqual(w["today"], "2026-10-01")

    def test_codes_in_common_json(self):
        common = json.loads((REPO / "packs" / "waste-incineration" / "common.json").read_text(encoding="utf-8"))
        codes = all_codes(common)
        for e in self.w["equipment"]:
            self.assertTrue(e["code"].startswith("WI."))
            self.assertIn(e["code"], codes, e["id"])
            self.assertEqual(self.w["equipment_to_code"][e["id"]], e["code"])

    def test_works(self):
        w = self.w
        ids = {e["id"] for e in w["equipment"]}
        attrs = set()
        for k in w["works"]:
            self.assertIn(k["equipment_id"], ids)
            self.assertIn(k["attr"], {"INSPECT", "OVERHAUL", "REPLACE", "UPGRADE"})
            self.assertEqual(k["man_days"], k["crew"] * k["duration_days"])
            self.assertLessEqual(k["start"], k["end"])
            attrs.add(k["attr"])
        self.assertEqual(attrs, {"INSPECT", "OVERHAUL", "REPLACE", "UPGRADE"})
        tags = {k["tag"] for k in w["works"]}
        self.assertTrue({"ANNUAL", "SHUTDOWN", "PRECISION", "MAJOR"} <= tags)
        fy2026 = {k["status"] for k in w["works"] if k["fiscal_year"] == 2026}
        self.assertTrue({"actual", "planned"} <= fy2026)
        for k in w["works"]:
            self.assertEqual(k["status"] != "planned", k["end"] < w["today"])
        self.assertEqual(w["seed"], w["rules"]["seed"])

    def test_gaps(self):
        w = self.w
        self.assertGreaterEqual(len(w["gaps"]), 5)
        self.assertTrue(3 <= len(w["inspections"]) <= 6)
        insp = {i["id"] for i in w["inspections"]}
        for g in w["gaps"]:
            self.assertIn(g["inspection_id"], insp)
            self.assertTrue(g["what"])
            self.assertIn(g["equipment_id"], {e["id"] for e in w["equipment"]})
        self.assertEqual({g["inspection_id"] for g in w["gaps"]}, insp)


class Hoshitori(unittest.TestCase):
    def setUp(self):
        root = built_root()
        self.t = load(root, "truth", "plan-hoshitori.truth.json")
        self.ws = load_workbook(root / "out" / SUB / "plan-hoshitori.xlsx").worksheets[0]

    def test_vertical_merge_ditto_two_row_header(self):
        ws, t = self.ws, self.t
        merged = [m for m in ws.merged_cells.ranges if m.min_col == 1 and m.max_col == 1 and m.max_row > m.min_row
                  and m.min_row >= t["first_data_row"]]
        self.assertGreaterEqual(len(merged), 1)
        self.assertTrue(any(ws.cell(r, 3).value == "〃" for r in range(t["first_data_row"], t["last_data_row"] + 1)))
        top, sub = t["header_rows"]
        years = [m for m in ws.merged_cells.ranges if m.min_row == top and m.max_row == top and m.max_col - m.min_col == 1
                 and m.min_col >= 4]
        self.assertEqual(len(years), 10)
        for m in years:
            self.assertEqual(ws.cell(sub, m.min_col).value, "実績")
            self.assertEqual(ws.cell(sub, m.max_col).value, "予定")
        labels = [y["label"] for y in t["year_columns"]]
        self.assertEqual([ws[f"{y['actual_col']}{top}"].value for y in t["year_columns"]], labels)
        self.assertTrue(any(re.fullmatch(r"[HR]\d+", s) for s in labels))
        self.assertTrue(any("令和" in s for s in labels))
        self.assertTrue(any(re.fullmatch(r"\d{4}年度", s) for s in labels))
        self.assertEqual(labels[0][0], "H")
        self.assertEqual(labels[1][0], "R")

    def test_one_symbol_outside_legend(self):
        ws, t = self.ws, self.t
        legend = {x["symbol"] for x in t["legend"]}
        self.assertTrue({"○", "●", "◎"} <= legend)
        # 凡例が表の下にあり、シートの値と一致する
        for x in t["legend"]:
            self.assertEqual(ws.cell(x["row"], 2).value, x["symbol"])
            self.assertGreater(x["row"], t["last_data_row"])
        outside = []
        for row in ws.iter_rows(min_row=t["first_data_row"], max_row=t["last_data_row"], min_col=4):
            for c in row:
                if c.value is not None and c.value not in legend:
                    outside.append(c.coordinate)
        self.assertEqual(outside, [t["unknown_symbol"]["cell"]])

    def test_subtotal_numeric_not_formula(self):
        ws, t = self.ws, self.t
        r = t["subtotal"]["row"]
        for col, n in t["subtotal"]["values"].items():
            c = ws[f"{col}{r}"]
            self.assertEqual(c.data_type, "n")
            self.assertEqual(c.value, n)
            actual = sum(1 for rr in range(t["first_data_row"], t["last_data_row"] + 1)
                         if ws[f"{col}{rr}"].value is not None)
            self.assertEqual(actual, n)

    def test_cells_map_to_works(self):
        world = load(built_root(), "truth", "world.json")
        wk = {w["id"]: w for w in world["works"]}
        placed = set()
        for coord, c in self.t["cells"].items():
            self.assertEqual(self.ws[coord].value, c["symbol"])
            placed.update(c["work_ids"])
        self.assertEqual(placed, set(wk))


class Daily(unittest.TestCase):
    def setUp(self):
        root = built_root()
        self.raw = (root / "out" / SUB / "daily-report.csv").read_bytes()
        self.t = load(root, "truth", "daily-report.truth.json")

    def test_cp932_crlf(self):
        text = self.raw.decode("cp932")
        self.assertNotIn("\n", text.replace("\r\n", ""))
        self.assertTrue(text.endswith("\r\n"))

    def test_halfwidth_kana_and_bundle(self):
        text = self.raw.decode("cp932")
        self.assertRegex(text, r"[\uff66-\uff9f]")
        self.assertTrue(any(r["bundle"] and len(r["work_ids"]) > 1 for r in self.t["rows"]))
        self.assertIn("（一式）", text.replace("(一式)", "（一式）"))

    def test_truth_lines_and_effort(self):
        lines = self.raw.decode("cp932").split("\r\n")
        t = self.t
        self.assertEqual(lines[t["header_line"] - 1].split(",")[0], "日付")
        self.assertEqual(len(lines) - 1, t["rows"][-1]["line"])
        styles = set()
        for r in t["rows"]:
            cols = lines[r["line"] - 1].split(",")
            self.assertEqual(cols[5], r["effort_text"])
            styles.add(r["effort_style"])
            m = re.fullmatch(r"(\d+)(人・日|人工|時間)|延べ(\d+)人", r["effort_text"])
            self.assertTrue(m)
            n = int(m.group(1) or m.group(3))
            md = n / t["hours_per_man_day"] if m.group(2) == "時間" else n
            self.assertEqual(md, r["man_days"])
        self.assertEqual(styles, {"ninnichi", "ninku", "nobe", "hours"})


class Facts(unittest.TestCase):
    def test_facts_match_reread(self):
        root = built_root()
        facts = load(root, "facts", "plan-hoshitori.facts.json")
        wb = load_workbook(root / "out" / SUB / "plan-hoshitori.xlsx")
        self.assertEqual(len(facts["sheets"]), len(wb.worksheets))
        for sf, ws in zip(facts["sheets"], wb.worksheets):
            self.assertEqual(sf["title"], ws.title)
            expect = {}
            for row in ws.iter_rows():
                for c in row:
                    if c.value is not None:
                        expect[c.coordinate] = (c.value, c.data_type, c.number_format)
            got = {c["coord"]: (c["value"], c["data_type"], c["number_format"]) for c in sf["cells"]}
            self.assertEqual(got, expect)
            self.assertEqual(sf["merged"], sorted(str(m) for m in ws.merged_cells.ranges))
            self.assertEqual(sf["hidden_rows"], [])
            self.assertEqual(sf["hidden_cols"], [])
            self.assertTrue(any(c["data_type"] == "n" for c in sf["cells"]))


if __name__ == "__main__":
    unittest.main()
