"""v1 の資料（機器台帳・工事報告書・写真・2 つ目の施設・資料をまたぐ正解）の試験。"""
import io
import json
import re
import unittest
from pathlib import Path
from unittest import mock

from openpyxl import load_workbook

from tests.common import REPO, SUB, SUB2, built_root, factory_build, load
from writers import pdfconv

FICT = "【架空】"


def parse_effort(text: str, hours: int) -> int:
    m = re.fullmatch(r"(\d+)(人・日|人工|時間)|延べ(\d+)人", text)
    assert m, text
    n = int(m.group(1) or m.group(3))
    return n // hours if m.group(2) == "時間" else n


def ws_of(root: Path, sub: Path, rel: str):
    return load_workbook(root / "out" / sub / rel).worksheets[0]


class Ledger(unittest.TestCase):
    def setUp(self):
        self.root = built_root()
        self.world = load(self.root, "truth", "world.json")
        self.t = load(self.root, "truth", "equipment-ledger.truth.json")
        self.wb = load_workbook(self.root / "out" / SUB / "equipment-ledger.xlsx")
        self.ws = self.wb.worksheets[0]

    def test_fictional_marks(self):
        self.assertIn(FICT, self.ws["A1"].value)
        self.assertIn(FICT, self.wb.properties.creator)

    def test_indent_levels_and_numbers(self):
        t, ws = self.t, self.ws
        self.assertEqual(t["depth"], 3)
        self.assertEqual(t["columns"][:2], ["名称", "番号"])
        levels = set()
        for r in t["rows"]:
            cell = ws.cell(r["row"], 1)
            self.assertEqual(cell.value, r["name_text"])
            self.assertEqual(cell.alignment.indent, r["indent"])
            self.assertEqual(ws.cell(r["row"], 2).value, r["number"])
            self.assertEqual(len(r["number"].split("-")), r["level"])
            levels.add(r["level"])
        self.assertEqual(levels, {1, 2, 3})
        nums = [r["number"] for r in t["rows"]]
        self.assertEqual(len(nums), len(set(nums)))
        for pat in (r"\d+", r"\d+-\d+", r"\d+-\d+-\d+"):
            self.assertTrue(any(re.fullmatch(pat, n) for n in nums), pat)

    def test_equipment_number_in_name_and_newline(self):
        by_id = {r["equipment_id"]: r for r in self.t["rows"] if r["kind"] == "equipment"}
        idf = [e for e in self.world["equipment"] if e["key"] == "idf"]
        self.assertEqual(sorted(by_id[e["id"]]["name_text"] for e in idf),
                         ["誘引通風機（IDF-1）", "誘引通風機（IDF-2）"])
        multi = [r for r in by_id.values() if r["spec_text"] and "\n" in r["spec_text"]]
        self.assertEqual(len(multi), len(by_id))
        c = self.ws.cell(by_id[idf[0]["id"]]["row"], 3)
        self.assertIn("\n", c.value)
        self.assertTrue(c.alignment.wrap_text)

    def test_identity_matches_world(self):
        w = self.world
        self.assertEqual(set(self.t["equipment_rows"]), {e["id"] for e in w["equipment"]})
        code = {e["id"]: e["code"] for e in w["equipment"]}
        for r in self.t["rows"]:
            if r["kind"] == "equipment":
                self.assertEqual(r["key"], code[r["equipment_id"]])

    def test_replacement_and_removal_in_remarks(self):
        w = self.world
        rem = {r["equipment_id"]: r["remark_text"] for r in self.t["rows"] if r["kind"] == "equipment"}
        past = [x for x in w["works"] if x["pattern"] == "P-REPL-PAST"][0]
        fut = [x for x in w["works"] if x["pattern"] == "P-REPL-FUT"][0]
        self.assertIn("2021年12月", rem[past["equipment_id"]])
        self.assertIn("取替", rem[past["equipment_id"]])
        self.assertIn("2027年2月", rem[fut["equipment_id"]])
        self.assertIn("予定", rem[fut["equipment_id"]])
        removed = [r for r in self.t["rows"] if r["kind"] == "part" and r["remark_text"] and "撤去" in r["remark_text"]]
        self.assertEqual(len(removed), 1)
        self.assertEqual(removed[0]["equipment_id"], past["equipment_id"])


class Fictional2(unittest.TestCase):
    def setUp(self):
        self.root = built_root()
        self.w1 = load(self.root, "truth", "world.json")
        self.w2 = load(self.root, "truth", "world.json", SUB2)
        self.l1 = load(self.root, "truth", "equipment-ledger.truth.json")
        self.l2 = load(self.root, "truth", "equipment-ledger.truth.json", SUB2)
        self.h1 = load(self.root, "truth", "plan-hoshitori.truth.json")
        self.h2 = load(self.root, "truth", "plan-hoshitori.truth.json", SUB2)

    def test_fictional_marks_on_every_file(self):
        for rel in ("equipment-ledger.xlsx", "plan-hoshitori.xlsx"):
            wb = load_workbook(self.root / "out" / SUB2 / rel)
            self.assertIn(FICT, wb.worksheets[0]["A1"].value)
            self.assertIn(FICT, wb.properties.creator)
        self.assertTrue(self.w2["facility"]["name"].startswith(FICT))
        self.assertNotEqual(self.w2["facility"]["name"], self.w1["facility"]["name"])
        self.assertNotEqual(self.w2["seed"], self.w1["seed"])

    def test_own_world(self):
        w = self.w2
        self.assertEqual(w["facility"]["furnace_type"], "流動床式")
        self.assertEqual(len(w["facility"]["furnaces"]), 1)
        self.assertGreaterEqual(len(w["gaps"]), 5)
        common = json.loads((REPO / "packs" / "waste-incineration" / "common.json").read_text(encoding="utf-8"))
        text = json.dumps(common, ensure_ascii=False)
        for e in w["equipment"]:
            self.assertIn(f'"{e["code"]}"', text, e["id"])
        self.assertEqual(w["today"], self.w1["today"])
        self.assertEqual({"ledger", "hoshitori"}, set(w["documents"]))

    def test_depth_differs(self):
        self.assertEqual((self.h1["depth"], self.h2["depth"]), (2, 4))
        self.assertEqual((self.l1["depth"], self.l2["depth"]), (3, 4))
        self.assertNotEqual(self.h1["depth"], self.h2["depth"])
        self.assertNotEqual(self.l1["depth"], self.l2["depth"])
        ws = ws_of(self.root, SUB2, "plan-hoshitori.xlsx")
        t = self.h2
        self.assertEqual(t["columns"]["levels"], ["A", "B", "C"])
        top, sub = t["header_rows"]
        self.assertEqual([ws.cell(top, c).value for c in range(1, 6)], ["設備", "系統", "機器群", "機器", "号炉"])
        for col in "AB":
            self.assertTrue(any(m.startswith(col) and ":" in m for m in t["merged_ranges"]), col)
        ws2 = ws_of(self.root, SUB2, "equipment-ledger.xlsx")
        self.assertEqual(max(ws2.cell(r["row"], 1).alignment.indent for r in self.l2["rows"]), 3)
        self.assertFalse(self.l2["numbering"])
        self.assertEqual(self.l2["columns"][:2], ["名称", "仕様"])

    def test_names_differ_for_the_same_equipment(self):
        c1 = {e["code"]: e for e in self.w1["equipment"]}
        shared = [e for e in self.w2["equipment"] if e["code"] in c1]
        self.assertGreaterEqual(len(shared), 8)
        for e in shared:
            self.assertNotEqual(e["base_name"], c1[e["code"]]["base_name"], e["code"])
        by1 = {r["equipment_id"]: r["name_text"] for r in self.l1["rows"] if r["kind"] == "equipment"}
        by2 = {r["equipment_id"]: r["name_text"] for r in self.l2["rows"] if r["kind"] == "equipment"}
        name2 = {e["code"]: by2[e["id"]] for e in self.w2["equipment"]}
        idf1 = [by1[e["id"]] for e in self.w1["equipment"] if e["key"] == "idf"][0]
        self.assertEqual(name2["WI.DRAFT.IDF"], "IDF 誘引送風機")
        self.assertTrue(idf1.startswith("誘引通風機"))
        # 台帳と星取表の呼び名も別
        h = self.h2["equipment_names"]
        ids = {e["id"]: e for e in self.w2["equipment"]}
        for eid, nm in h.items():
            self.assertIn(ids[eid]["tag"], by2[eid])
            self.assertNotEqual(nm, by2[eid])


class Reports(unittest.TestCase):
    def setUp(self):
        self.root = built_root()
        self.t = load(self.root, "truth", "reports.truth.json")
        self.world = load(self.root, "truth", "world.json")

    def test_every_report_is_fictional_and_matches_truth(self):
        self.assertGreaterEqual(len(self.t["reports"]), 8)
        hours = self.world["man_day_hours"]
        for rep in self.t["reports"]:
            wb = load_workbook(self.root / "out" / SUB / rep["file_xlsx"])
            ws = wb.worksheets[0]
            self.assertIn(FICT, ws["A1"].value)
            self.assertIn(FICT, wb.properties.creator)
            for row in rep["rows"]:
                r = row["xlsx_row"]
                self.assertEqual(ws.cell(r, 1).value, row["no"])
                self.assertEqual(ws.cell(r, 2).value, row["equipment_text"])
                self.assertEqual(ws.cell(r, 3).value, row["label_text"])
                self.assertEqual(ws.cell(r, 5).value, row["duration_days"])
                self.assertEqual(ws.cell(r, 6).value, row["effort_text"])
                self.assertEqual(parse_effort(row["effort_text"], hours), row["man_days"])
            tot = rep["total"]
            c = ws[tot["man_days_cell"]]
            self.assertEqual(c.data_type, "n")
            self.assertEqual(c.value, sum(x["man_days"] for x in rep["rows"]))
            self.assertEqual(ws[tot["days_cell"]].value, rep["term_days"])

    def test_repeated_headings_and_continuation(self):
        multi = [r for r in self.t["reports"] if r["pages"] > 1]
        self.assertTrue(multi)
        for rep in self.t["reports"]:
            ws = load_workbook(self.root / "out" / SUB / rep["file_xlsx"]).worksheets[0]
            titles = [c.value for c in ws["A"] if isinstance(c.value, str) and c.value.startswith(FICT + rep["title"].removeprefix(FICT))]
            self.assertEqual(len(titles), rep["pages"])
            self.assertEqual(sum(1 for t in titles if t.endswith(rep["continued_mark"])), rep["pages"] - 1)
            heads = [c.row for c in ws["A"] if c.value == "No."]
            self.assertEqual(len(heads), rep["pages"])
            self.assertEqual(len(ws.row_breaks.brk), rep["pages"] - 1)
            self.assertEqual({row["page"] for row in rep["rows"]}, set(range(1, rep["pages"] + 1)))

    def test_bundle_row_and_precision_rows(self):
        rows = [x for r in self.t["reports"] for x in r["rows"]]
        self.assertTrue(any(x["bundle"] and len(x["work_ids"]) > 1 for x in rows))
        prec = [x for x in rows if x["precision"]]
        self.assertTrue(prec)
        self.assertTrue(all("精密機能検査" in x["label_text"] for x in prec))
        wk = {w["id"]: w for w in self.world["works"]}
        for x in rows:
            for wid in x["work_ids"]:
                self.assertEqual(wk[wid]["status"], "actual")

    def test_every_report_xlsx_is_all_actual_precision_covered(self):
        # 実績のある精密機能検査は、星取表（◎）と報告書の両方にある
        wk = [w for w in self.world["works"] if w["tag"] == "PRECISION" and w["status"] == "actual"]
        in_reports = {wid for r in self.t["reports"] for x in r["rows"] for wid in x["work_ids"]}
        hoshi = load(self.root, "truth", "plan-hoshitori.truth.json")
        in_hoshi = {wid for c in hoshi["cells"].values() if c["symbol"] == "◎" for wid in c["work_ids"]}
        for w in wk:
            self.assertIn(w["id"], in_reports)
            self.assertIn(w["id"], in_hoshi)


class PdfAndPhotos(unittest.TestCase):
    def setUp(self):
        self.root = built_root()
        self.t = load(self.root, "truth", "reports.truth.json")
        self.pdfs = [self.root / "out" / SUB / r["file_pdf"] for r in self.t["reports"]]
        if not all(p.exists() for p in self.pdfs):
            self.skipTest("PDF が無い（LibreOffice が無い環境）")

    def test_pdf_text_pages_and_fictional(self):
        import pypdfium2 as pdfium
        for rep, p in zip(self.t["reports"], self.pdfs):
            doc = pdfium.PdfDocument(str(p))
            try:
                self.assertEqual(len(doc), rep["pages"], rep["id"])
                self.assertIn(FICT, doc.get_metadata_value("Author"))
                for i in range(len(doc)):
                    text = doc[i].get_textpage().get_text_range()
                    self.assertIn(FICT + rep["title"].removeprefix(FICT), text)
                    self.assertIn("No.", text)
                    self.assertIn("（続き）" in text, [i > 0])
                    for row in rep["rows"]:
                        if row["page"] == i + 1:
                            self.assertIn(row["effort_text"], text)
                last = doc[len(doc) - 1].get_textpage().get_text_range()
                self.assertIn("合 計", last)
                self.assertIn(str(rep["total"]["man_days"]), last)
            finally:
                doc.close()

    def test_report_xlsx_row_cells_share_one_row(self):
        """同じ行の No.・機器・作業内容・工期・日数・工数は、xlsx の同じ行（行番号が同じ）にある。"""
        for rep in self.t["reports"]:
            ws = load_workbook(self.root / "out" / SUB / rep["file_xlsx"]).worksheets[0]
            for row in rep["rows"]:
                r = row["xlsx_row"]
                self.assertEqual(ws.cell(r, 1).value, row["no"], (rep["id"], r))
                self.assertEqual(ws.cell(r, 2).value, row["equipment_text"], (rep["id"], r))
                self.assertEqual(ws.cell(r, 3).value, row["label_text"], (rep["id"], r))
                self.assertEqual(ws.cell(r, 5).value, row["duration_days"], (rep["id"], r))
                self.assertEqual(ws.cell(r, 6).value, row["effort_text"], (rep["id"], r))
            # 明細の行は、見出しの行の直後から切れ目なく並ぶ
            for page in range(1, rep["pages"] + 1):
                rows = [x["xlsx_row"] for x in rep["rows"] if x["page"] == page]
                hdr = [r for r in range(1, ws.max_row + 1) if ws.cell(r, 1).value == "No."]
                self.assertEqual(rows, list(range(hdr[page - 1] + 1, hdr[page - 1] + 1 + len(rows))), rep["id"])

    def test_pdf_row_cells_share_one_line(self):
        """PDF でも、同じ行の機器（左）と工数（右）は同じ高さにあり、行は上から順に並ぶ。"""
        import pypdfium2 as pdfium

        def hits(page, text):
            tp = page.get_textpage()
            s = tp.search(text)
            out = []
            while True:
                h = s.get_next()
                if not h:
                    return out
                boxes = [tp.get_charbox(i) for i in range(h[0], h[0] + h[1])]
                out.append((min(b[1] for b in boxes) + max(b[3] for b in boxes)) / 2)  # 文字の中心の高さ（pt）

        for rep, p in zip(self.t["reports"], self.pdfs):
            doc = pdfium.PdfDocument(str(p))
            try:
                for i in range(len(doc)):
                    prev = None
                    for row in (x for x in rep["rows"] if x["page"] == i + 1):
                        eq = hits(doc[i], row["equipment_text"][:5])
                        ef = hits(doc[i], row["effort_text"])
                        self.assertTrue(eq and ef, (rep["id"], row["no"]))
                        # 行の高さは約 14pt。機器の行と同じ高さ（半行以内）に工数がある
                        y = min(eq, key=lambda v: min(abs(v - e) for e in ef))
                        self.assertLess(min(abs(y - e) for e in ef), 5, (rep["id"], row["no"]))
                        if prev is not None:
                            self.assertLess(y, prev, (rep["id"], row["no"]))  # 下の行ほど y は小さい
                        prev = y
            finally:
                doc.close()

    def test_photos(self):
        from PIL import Image
        t = load(self.root, "truth", "photos.truth.json")
        self.assertGreaterEqual(len(t["photos"]), 2)
        for p in t["photos"]:
            f = self.root / "out" / SUB / p["file"]
            self.assertTrue(f.exists())
            raw = f.read_bytes()
            self.assertTrue(70_000 <= len(raw) <= 130_000, len(raw))
            im = Image.open(io.BytesIO(raw))
            self.assertEqual(im.format, "JPEG")
            self.assertTrue(1700 <= max(im.size) <= 1900, im.size)
            self.assertIn(FICT, im.getexif()[0x9C9D].decode("utf-16-le") if isinstance(im.getexif()[0x9C9D], bytes) else str(im.getexif()[0x9C9D]))
            self.assertIn(FICT, im.info["comment"].decode("utf-8"))
            self.assertTrue(p["marks"])


class WithoutLibreOffice(unittest.TestCase):
    def test_no_soffice_counts_and_makes_no_pdf(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d, mock.patch.object(factory_build, "find_soffice", return_value=None):
            files, counts = factory_build.build_with_counts(Path(d))
            self.assertEqual(counts["pdf_made"], 0)
            self.assertEqual(counts["pdf_not_made"], counts["pdf_expected"])
            self.assertGreater(counts["pdf_expected"], 0)
            self.assertEqual(counts["photo_made"], 0)
            self.assertEqual(counts["photo_not_made"], counts["photo_expected"])
            self.assertGreater(counts["photo_expected"], 0)
            self.assertIn("soffice", counts["not_made_reason"])
            self.assertFalse([f for f in files if f.suffix in (".pdf", ".jpg")])
            self.assertEqual(list(Path(d).rglob("*.pdf")), [])
            self.assertEqual(list(Path(d).rglob("*.jpg")), [])

    def test_convert_returns_false_without_soffice(self):
        with mock.patch.object(pdfconv, "find_soffice", return_value=None):
            self.assertFalse(pdfconv.xlsx_to_pdf(Path("a.xlsx"), Path("a.pdf")))

    def test_each_call_uses_its_own_profile(self):
        seen = []

        def fake_run(cmd, **kw):
            seen.append([c for c in cmd if c.startswith("-env:UserInstallation=")])
            return mock.Mock(returncode=1)
        with mock.patch.object(pdfconv.subprocess, "run", side_effect=fake_run):
            pdfconv.xlsx_to_pdf(Path("a.xlsx"), Path("a.pdf"), soffice="soffice")
            pdfconv.xlsx_to_pdf(Path("a.xlsx"), Path("b.pdf"), soffice="soffice")
        self.assertEqual(len(seen), 2)
        self.assertTrue(all(len(s) == 1 and s[0].startswith("-env:UserInstallation=file:///") for s in seen))
        self.assertNotEqual(seen[0], seen[1])

    def test_normalize_pdf_is_idempotent_and_fixes_dates(self):
        raw = (b"%PDF-1.7\n/CreationDate(D:20300101120000Z')\n/ID [ <" + b"A" * 32 + b">\n<" + b"B" * 32 +
               b"> ]\n/DocChecksum /" + b"C" * 32 + b"\n")
        a = pdfconv.normalize_pdf(raw)
        self.assertEqual(len(a), len(raw))
        self.assertIn(b"D:20261001000000Z'", a)
        self.assertEqual(pdfconv.normalize_pdf(a), a)


class CrossDoc(unittest.TestCase):
    def setUp(self):
        self.root = built_root()
        self.hours = 8

    def _check(self, sub: Path, has_reports: bool):
        root = self.root
        world = load(root, "truth", "world.json", sub)
        cd = load(root, "truth", "crossdoc.truth.json", sub)
        hoshi = load(root, "truth", "plan-hoshitori.truth.json", sub)
        ledger = load(root, "truth", "equipment-ledger.truth.json", sub)
        wk = {w["id"]: w for w in world["works"]}
        self.assertEqual({x["work_id"] for x in cd["works"]}, set(wk))
        hws = ws_of(root, sub, "plan-hoshitori.xlsx")
        lws = ws_of(root, sub, "equipment-ledger.xlsx")
        col_year = {y["actual_col"]: y["fiscal_year"] for y in hoshi["year_columns"]}
        col_year.update({y["planned_col"]: y["fiscal_year"] for y in hoshi["year_columns"]})
        row_eq = {r["row"]: r["equipment_id"] for r in hoshi["rows"]}
        n_ref = {"hoshi": 0, "report": 0, "daily": 0}
        for x in cd["works"]:
            w = wk[x["work_id"]]
            self.assertEqual(x["equipment_id"], w["equipment_id"])
            # 台帳の行は、その機器の行
            lrow = lws.cell(x["ledger_row"], 1).value
            self.assertTrue(lrow.startswith(next(e["base_name"] for e in world["equipment"] if e["id"] == w["equipment_id"]))
                            or "（" in lrow or " " in lrow)
            self.assertEqual(ledger["equipment_rows"][w["equipment_id"]], x["ledger_row"])
            for ref in x["refs"]:
                if ref["doc"] == "plan-hoshitori.xlsx":
                    n_ref["hoshi"] += 1
                    coord = ref["cell"]
                    self.assertEqual(hws[coord].value, ref["symbol"])
                    col, row = re.fullmatch(r"([A-Z]+)(\d+)", coord).groups()
                    self.assertEqual(col_year[col], w["fiscal_year"])
                    self.assertEqual(row_eq[int(row)], w["equipment_id"])
                    self.assertEqual(col in {y["actual_col"] for y in hoshi["year_columns"]}, w["status"] == "actual")
                elif "report_id" in ref:
                    n_ref["report"] += 1
                    ws = load_workbook(root / "out" / sub / ref["source_xlsx"]).worksheets[0]
                    r = ref["xlsx_row"]
                    self.assertEqual(ws.cell(r, 1).value, ref["table_row_no"])
                    self.assertEqual(w["start"] <= w["end"], True)
                    effort = parse_effort(ws.cell(r, 6).value, self.hours)
                    group = [wk[i] for i in next(row["work_ids"] for rep in load(root, "truth", "reports.truth.json", sub)["reports"]
                                                 if rep["id"] == ref["report_id"] for row in rep["rows"] if row["xlsx_row"] == r)]
                    self.assertIn(w, group)
                    self.assertEqual(effort, sum(g["man_days"] for g in group))
                    self.assertEqual(ws.cell(r, 5).value, w["duration_days"])
                    self.assertIn(w["label"] if w["pattern"] not in world["rules"]["report"]["report_labels"]
                                  else world["rules"]["report"]["report_labels"][w["pattern"]], ws.cell(r, 3).value)
                    self.assertTrue(f"（{self._tag(world, w)}" in ws.cell(r, 2).value)
                    self.assertEqual(f"fy{w['fiscal_year']}" in ref["source_xlsx"], True)
                elif ref["doc"] == "daily-report.csv":
                    n_ref["daily"] += 1
                    lines = (root / "out" / sub / "daily-report.csv").read_bytes().decode("cp932").split("\r\n")
                    cols = lines[ref["line"] - 1].split(",")
                    self.assertEqual(parse_effort(cols[5], self.hours),
                                     sum(wk[i]["crew"] for i in next(
                                         r["work_ids"] for r in load(root, "truth", "daily-report.truth.json", sub)["rows"]
                                         if r["line"] == ref["line"])))
                    self.assertTrue(w["start"] <= ref["date"] <= w["end"])
        return world, cd, n_ref

    @staticmethod
    def _tag(world, w):
        e = next(e for e in world["equipment"] if e["id"] == w["equipment_id"])
        return e["tag"]

    def test_fictional_1_cross_references_agree_with_documents(self):
        world, cd, n = self._check(SUB, True)
        self.assertGreater(n["hoshi"], 100)
        self.assertGreater(n["report"], 30)
        self.assertGreater(n["daily"], 30)
        # 精密機能検査は、星取表・報告書・日報（2022 年度以降）の 3 つに現れる
        prec = {x["work_id"]: x for x in cd["works"] if x["precision"] and wk_status(world, x) == "actual"}
        self.assertTrue(prec)
        for x in prec.values():
            docs = {r["doc"] for r in x["refs"]}
            self.assertIn("plan-hoshitori.xlsx", docs)
            self.assertTrue(any("report-f" in d for d in docs), x["work_id"])
        self.assertTrue(any("daily-report.csv" in {r["doc"] for r in x["refs"]} for x in prec.values()))
        self.assertEqual(cd["precision_work_ids"], [w["id"] for w in world["works"] if w["tag"] == "PRECISION"])

    def test_fictional_2_cross_references(self):
        world, cd, n = self._check(SUB2, False)
        self.assertGreater(n["hoshi"], 50)
        self.assertEqual(n["report"] + n["daily"], 0)

    def test_photos_point_to_report_rows(self):
        t = load(self.root, "truth", "photos.truth.json")
        cd = load(self.root, "truth", "crossdoc.truth.json")
        refs = {x["work_id"]: x for x in cd["works"]}
        reports = {r["id"]: r for r in load(self.root, "truth", "reports.truth.json")["reports"]}
        for p in t["photos"]:
            rep = reports[p["source_report"]]
            self.assertEqual(p["source_pdf"], rep["file_pdf"])
            for m in p["marks"]:
                row = next(r for r in rep["rows"] if r["no"] == m["row_no"])
                self.assertEqual(row["page"], 1)
                self.assertEqual(row["effort_text"], m["text"])
                for wid in m["work_ids"]:
                    self.assertIn(p["file"], [r["doc"] for r in refs[wid]["refs"]])


def wk_status(world, x):
    return next(w["status"] for w in world["works"] if w["id"] == x["work_id"])


class LedgerDeterminism(unittest.TestCase):
    def test_zip_times_fixed_for_all_xlsx(self):
        import zipfile
        root = built_root()
        files = list((root / "out").rglob("*.xlsx"))
        self.assertGreaterEqual(len(files), 4 + 16)
        for f in files:
            with zipfile.ZipFile(f) as z:
                for i in z.infolist():
                    self.assertEqual(i.date_time, (2026, 10, 1, 0, 0, 0), f.name)
            wb = load_workbook(f)
            self.assertIn(FICT, wb.properties.creator, f.name)
            self.assertIn(FICT, wb.worksheets[0]["A1"].value, f.name)


if __name__ == "__main__":
    unittest.main()
