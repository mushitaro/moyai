"""全国の表から数だけを取り出す道具の試験。網に出ない（表を取る所は差し替える）。一時のフォルダで行う。

作り物の表（架空の行）で、見出しの 5 段の読み方・読み替え・帯・数え方・空の改廃の扱いを確かめ、
パックに置いた table.json に、元の表の名前の列の値が出ていないことを形で確かめる。
"""

from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import unittest

from scripts.national import build as b
from scripts.national.tests import fixture as fx

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PACK = os.path.join(ROOT, "packs", "waste-incineration")
RULES_PATH = os.path.join(PACK, "national", "columns.json")
TABLE_PATH = os.path.join(PACK, "national", "table.json")
DATE = "2026-11-03"

G1_HEAT = "場内温水, 発電（場外利用）"


def facilities() -> list[dict]:
    """稼働 14・休止 2・廃止 2（うち移管 1）・新設 3 の、架空の 21 施設。"""
    act = [fx.facility(i, heat=G1_HEAT) for i in range(1, 6)]  # 同じ軸の値の 5 施設
    act += [
        fx.facility(6, heat=G1_HEAT, contract="⑨その他公設民営"),
        fx.facility(7, cap=150, heat="発電（場内利用）", ash_b="溶融処理", ash_f="セメント固化, 薬剤処理", contract="⑦DB+O（公設民営、長期包括運営委託）"),
        fx.facility(8, cap=100, heat="無し", ash_b="セメント固化", contract="③DB（公設公営,運転委託）"),
        fx.facility(9, cap=199.5, heat="発電（場内利用）, 場外蒸気", ash_b=None, ash_f=None, contract=None),
        fx.facility(10, furnace="流動床式", cap=49.5, heat="場内温水", contract="⑧DBO（公設民営）"),
        fx.facility(11, furnace="シャフト式", cap=50, heat="発電（場外利用）", ash_f="溶融処理", contract="⑩PFI-BTO（民設民営）"),
        fx.facility(12, furnace="回転式", cap=400, heat="発電（場内利用）", ash_b="溶融処理, 無し", contract="⑬PFI-RO（民設民営）"),
        fx.facility(13, furnace="固定床式", cap=399, heat="場外蒸気", ash_f="セメント固化", contract="①DB（公設公営、直営）"),
        # 改廃のセルが空白だけ：空として稼働に数える
        fx.facility(14, furnace="その他", cap=1200, heat="その他", contract="⑥その他公設公営", status="  "),
    ]
    # 稼働でない行の軸の値は読まない（知らない値でも止めない）
    odd = {"furnace": "【架空】知らない方式", "cap": "【架空】数でない", "ash_b": "【架空】知らない処理"}
    rest = [
        fx.facility(21, status="休止", **odd),
        fx.facility(22, status="休止"),
        fx.facility(23, status="廃止"),
        fx.facility(24, status="廃止, 移管"),
        fx.facility(25, status="新設（建設中）"),
        fx.facility(26, status="新設（建設中）, 新設（新規稼働）"),
        fx.facility(27, status="新設（新規稼働）"),
    ]
    return act + rest


def real_rules() -> dict:
    return b.load_json(RULES_PATH)


class TempCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="moyai-national-test-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def table_file(self, rows, name="t.xlsx", **kw) -> str:
        path = os.path.join(self.tmp, name)
        fx.write_table(path, rows, **kw)
        return path

    def run_quiet(self, pack, **kw):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            table = b.run(pack, out_dir=os.path.join(self.tmp, "out"), **kw)
        self.assertEqual(out.getvalue(), "", "標準出力に何か書いた")
        return table


class HeaderTest(unittest.TestCase):
    """見出しの 5 段の読み方（openpyxl を使わない、セルの格子だけの試験）。"""

    def sheet(self):
        # 2〜6 行目が見出し。A は縦の結合、B は単位が 6 行目、C:D は横の結合の下に 2 つ、E は結合なしで 2 行目だけ
        rows = [
            ["題", None, None, None, None, None],
            ["名前", "能力", "灰", None, "メモ", "能力"],
            [None, None, None, None, None, None],
            [None, None, "（焼却灰）", "（飛灰）", None, None],
            [None, None, None, None, None, None],
            [None, "（t/日）", None, None, None, None],
            ["値", 1, "a", "b", "x", 2],
        ]
        merges = [(2, 1, 6, 1), (2, 2, 5, 2), (2, 3, 3, 4), (4, 3, 6, 3), (4, 4, 6, 4), (1, 1, 1, 6)]
        return b.Sheet(rows=rows, merges=merges)

    def test_paths(self):
        paths = b.header_paths(self.sheet(), 2, 6)
        self.assertEqual(paths[0], ("名前",))
        self.assertEqual(paths[1], ("能力", "(t/日)"))
        self.assertEqual(paths[2], ("灰", "(焼却灰)"))
        self.assertEqual(paths[3], ("灰", "(飛灰)"))
        self.assertEqual(paths[4], ("メモ",))
        self.assertEqual(paths[5], ("能力",))

    def test_title_row_is_not_header(self):
        # 1 行目の結合（題）は見出しの段に入れない
        paths = b.header_paths(self.sheet(), 2, 6)
        self.assertNotIn("題", [h for p in paths for h in p])

    def test_find_column_by_name(self):
        paths = b.header_paths(self.sheet(), 2, 6)
        self.assertEqual(b.find_column(paths, ["能力", "(t/日)"]), 2)
        self.assertEqual(b.find_column(paths, ["能力"]), 6)  # 単位の段が無い列とは別
        self.assertEqual(b.find_column(paths, ["灰", "（飛灰）"]), 4)  # 全角と半角の括弧は NFKC で同じ
        self.assertEqual(b.find_column(paths, [" 名 前 "]), 1)  # 空白は除いて比べる

    def test_find_column_missing_or_twice(self):
        paths = b.header_paths(self.sheet(), 2, 6)
        with self.assertRaises(b.NationalError):
            b.find_column(paths, ["無い列"])
        with self.assertRaises(b.NationalError):
            b.find_column([("同じ",), ("同じ",)], ["同じ"])

    def test_bad_header_rows(self):
        with self.assertRaises(b.NationalError):
            b.header_paths(self.sheet(), 6, 2)


class BandTest(unittest.TestCase):
    def test_codes_from_edges(self):
        codes = b.band_codes([50, 100, 200, 400], "C", "t/日")
        self.assertEqual([c["code"] for c in codes], ["CLT50", "C50_100", "C100_200", "C200_400", "C400P"])
        self.assertEqual(codes[1]["name"], "50 t/日 以上 100 t/日 未満")

    def test_edge_goes_up(self):
        edges = [50, 100, 200, 400]
        codes = b.band_codes(edges, "C", "t/日")
        got = {x: b.band_of(x, edges, codes) for x in (0.8, 49.9, 50, 99.99, 100, 200, 399, 400, 1800)}
        self.assertEqual(
            got,
            {0.8: "CLT50", 49.9: "CLT50", 50: "C50_100", 99.99: "C50_100", 100: "C100_200", 200: "C200_400", 399: "C200_400", 400: "C400P", 1800: "C400P"},
        )

    def test_other_edges(self):
        edges = [100, 300]
        codes = b.band_codes(edges, "X", "kL/日")
        self.assertEqual([c["code"] for c in codes], ["XLT100", "X100_300", "X300P"])
        self.assertEqual(b.band_of(50, edges, codes), "XLT100")

    def test_bad_edges(self):
        for bad in ([], [50, 50], [0, 10], [100, 50], [1.5], [True]):
            with self.subTest(bad=bad), self.assertRaises(b.NationalError):
                b.check_edges(bad)
        with self.assertRaises(b.NationalError):
            b.parse_edges("50,百")
        self.assertEqual(b.parse_edges("50,100"), [50, 100])


class CountTest(TempCase):
    """作り物の表を、パックの columns.json で読む。"""

    def build(self, rows=None, rules=None, **kw):
        rows = facilities() if rows is None else rows
        path = self.table_file(rows, footnote=kw.pop("footnote", None), reverse=kw.pop("reverse", False))
        pack = fx.make_pack(self.tmp, rules or real_rules())
        return self.run_quiet(pack, xlsx=path, retrieved=DATE, **kw)

    def test_population(self):
        t = self.build(footnote="【架空】注：試験の注")
        p = t["population"]
        self.assertEqual(p["rows"], 21)
        self.assertEqual(p["notFacilityRows"], 1)
        self.assertEqual(p["active"], 14)
        st = {g["code"]: g for g in p["status"]}
        self.assertEqual(st["SUSPENDED"]["n"], 2)
        self.assertEqual(st["CLOSED"]["n"], 2)
        self.assertEqual(st["CLOSED"]["sub"]["n"], 1)
        self.assertEqual(st["NEW"]["n"], 3)
        self.assertEqual(p["active"] + sum(g["n"] for g in p["status"]), p["rows"])

    def test_cells(self):
        t = self.build()
        cells = {c["key"]: c for c in t["cells"]}
        self.assertEqual(cells["furnace"]["to"], {"STOKER": 9, "FLUID": 1, "SHAFT": 1, "ROTARY": 1, "FIXED": 1, "OTHER": 1})
        self.assertEqual(cells["capacity_t_per_day"]["to"], {"CLT50": 1, "C50_100": 1, "C100_200": 9, "C200_400": 1, "C400P": 2})
        self.assertEqual(cells["turbine"]["to"], {"YES": 10, "NO": 4})
        self.assertEqual(cells["ash"]["to"], {"MELT": 3, "CEMENT": 2, "OUT": 9})
        self.assertEqual(cells["ash"]["blank"], 1)
        self.assertEqual(cells["contract"]["to"], {"OM": 5, "SINGLE": 9})
        self.assertEqual(cells["contract"]["blank"], 1)
        frm = {m["from"]: m["n"] for m in cells["contract"]["from"]}
        self.assertEqual(frm["③"], 6)  # 「、」と「,」の書き方の揺れも頭の ③ で読む
        self.assertEqual((frm["⑦"], frm["⑧"], frm["⑨"], frm["⑩"], frm["⑬"], frm["①"], frm["⑥"]), (1, 1, 1, 1, 1, 1, 1))
        self.assertEqual((frm["②"], frm["④"], frm["⑤"], frm["⑪"], frm["⑫"]), (0, 0, 0, 0, 0))

    def test_rows_are_counts(self):
        t = self.build()
        keys = [a["key"] for a in t["axes"]]
        self.assertEqual(sum(r["n"] for r in t["rows"]), 14)
        for r in t["rows"]:
            self.assertEqual(list(r), keys + ["n"])
        g1 = [r for r in t["rows"] if (r["furnace"], r["capacity_t_per_day"], r["turbine"], r["ash"], r["contract"]) == ("STOKER", "C100_200", "YES", "OUT", "SINGLE")]
        self.assertEqual(g1[0]["n"], 6)  # 5 施設と、灰も方式も空の 1 施設

    def test_k_steps(self):
        t = self.build()
        self.assertEqual(t["k"]["min"], 5)
        self.assertEqual(t["k"]["of"], 14)
        self.assertEqual([s["facilities"] for s in t["k"]["steps"]], [9, 8, 7, 6])
        self.assertEqual(t["k"]["steps"][-1]["axes"], ["furnace", "capacity_t_per_day", "turbine", "ash", "contract"])

    def test_column_order_does_not_matter(self):
        a = self.build()
        shutil.rmtree(os.path.join(self.tmp, "out"))
        b2 = self.build(reverse=True)
        for k in ("population", "cells", "rows", "k", "axes", "counting"):
            self.assertEqual(a[k], b2[k], k)

    def test_edges_from_outside(self):
        t = self.build(edges=[100, 300])
        self.assertEqual(t["rules"]["edgesFrom"], b.EDGES_FROM_ARGS)
        cap = next(a for a in t["axes"] if a["key"] == "capacity_t_per_day")
        self.assertEqual(cap["edges"], [100, 300])
        self.assertEqual([c["code"] for c in cap["codes"]], ["CLT100", "C100_300", "C300P"])
        cells = next(c for c in t["cells"] if c["key"] == "capacity_t_per_day")
        self.assertEqual(cells["to"], {"CLT100": 2, "C100_300": 9, "C300P": 3})
        d = self.build()
        self.assertEqual(d["rules"]["edgesFrom"], b.EDGES_FROM_RULES)

    def test_writes_table_and_rules_hash(self):
        t = self.build()
        with open(os.path.join(self.tmp, "out", "table.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f), t)
        with open(os.path.join(self.tmp, "pack", "national", "columns.json"), "rb") as f:
            self.assertEqual(t["rules"]["sha256"], hashlib.sha256(f.read()).hexdigest())
        self.assertEqual(t["source"]["retrieved"], DATE)
        self.assertIn("加工した", t["source"]["processed"])

    def test_no_names_in_output(self):
        rows = facilities()
        t = self.build(rows)
        with open(os.path.join(self.tmp, "out", "table.json"), encoding="utf-8") as f:
            text = f.read()
        for v in fx.withheld_values(rows):
            self.assertNotIn(v, text)
        self.assertNotIn("【架空】", text)
        self.assertEqual(t["nameCheck"]["hits"], 0)
        self.assertEqual(t["nameCheck"]["values"], len(set(fx.withheld_values(rows))))


class StopTest(TempCase):
    """決まらないセルがあれば、数を添えて止め、table.json を書かない。文に値を入れない。"""

    def expect_stop(self, rows, words, rules=None, **kw):
        path = self.table_file(rows)
        pack = fx.make_pack(self.tmp, rules or real_rules(), sha256=kw.pop("sha256", None))
        with self.assertRaises(b.NationalError) as cm:
            self.run_quiet(pack, xlsx=path, retrieved=kw.pop("retrieved", DATE), **kw)
        msg = str(cm.exception)
        for w in words:
            self.assertIn(w, msg)
        for r in rows:
            for v in r.values():
                if isinstance(v, str) and v.startswith("【架空】"):
                    self.assertNotIn(v, msg)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "out", "table.json")))
        return msg

    def test_unknown_furnace(self):
        self.expect_stop([fx.facility(1, furnace="【架空】知らない方式"), fx.facility(2, furnace="【架空】知らない方式")], ["furnace", "読み替えに無い値", "2 施設"])

    def test_capacity_not_number(self):
        self.expect_stop([fx.facility(1, cap="【架空】百")], ["capacity_t_per_day", "数でない値か空"])
        self.expect_stop([fx.facility(1, cap=None)], ["capacity_t_per_day"])

    def test_unknown_ash_part(self):
        self.expect_stop([fx.facility(1, ash_f="薬剤処理, 【架空】埋立")], ["ash", "知らない値"])

    def test_contract_without_number(self):
        self.expect_stop([fx.facility(1, contract="【架空】DB")], ["contract", "読み替えに無い値"])

    def test_turbine_blank(self):
        self.expect_stop([fx.facility(1, heat=None)], ["turbine", "空のセル"])

    def test_status_cannot_decide(self):
        for s in ("【架空】改修中", "移管", "休止, 廃止"):
            with self.subTest(status=s):
                self.expect_stop([fx.facility(1, status=s)], ["施設の改廃", "決まらない"])
                shutil.rmtree(self.tmp)
                os.makedirs(self.tmp)

    def test_missing_column(self):
        rules = real_rules()
        rules["axes"][0]["column"] = ["【架空】無い列"]
        self.expect_stop([fx.facility(1)], ["無い列", "見出しに無い"], rules=rules)

    def test_sha_differs(self):
        self.expect_stop([fx.facility(1)], ["SHA-256"], sha256="0" * 64)

    def test_retrieved_needed(self):
        self.expect_stop([fx.facility(1)], ["--retrieved"], retrieved=None)

    def test_name_leak_is_stopped(self):
        # 決まりを誤って名前の列に当てても、名前を書き出さずに止める
        rows = [fx.facility(1), fx.facility(2)]
        rules = real_rules()
        rules["axes"][0]["column"] = ["施設名称"]
        rules["axes"][0]["map"] = [{"from": r["name"], "to": "OTHER"} for r in rows]
        self.expect_stop(rows, ["持たない列の値", "2 件"], rules=rules)

    def test_main_returns_1(self):
        path = self.table_file([fx.facility(1, furnace="【架空】知らない方式")])
        pack = fx.make_pack(self.tmp, real_rules())
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = b.main(["--pack", pack, "--xlsx", path, "--retrieved", DATE, "--out", os.path.join(self.tmp, "out")])
        self.assertEqual(rc, 1)
        self.assertEqual(out.getvalue(), "")
        self.assertIn("読み替えに無い値", err.getvalue())


class FetchTest(TempCase):
    """表を取る道（網には出さず、取る関数を差し替える）。読んだら一時のフォルダごと消す。"""

    def test_fetch_then_delete(self):
        src = self.table_file(facilities())
        with open(src, "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        pack = fx.make_pack(self.tmp, real_rules(), sha256=sha)
        seen = []

        def fake_fetch(url, dest):
            seen.append((url, dest))
            shutil.copyfile(src, dest)

        orig = b.fetch
        b.fetch = fake_fetch
        try:
            import datetime

            t = self.run_quiet(pack, today=datetime.date(2026, 11, 3))
        finally:
            b.fetch = orig
        self.assertEqual(seen[0][0], "https://example.invalid/table.xlsx")
        self.assertFalse(os.path.exists(seen[0][1]), "取った表が残っている")
        self.assertFalse(os.path.exists(os.path.dirname(seen[0][1])), "一時のフォルダが残っている")
        self.assertEqual(t["source"]["sha256"], sha)
        self.assertEqual(t["source"]["retrieved"], "2026-11-03")
        self.assertEqual(t["population"]["active"], 14)


def _strings(obj, out):
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.append(("key", k))
            _strings(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _strings(v, out)
    elif isinstance(obj, str):
        out.append(("value", obj))
    return out


class PackTableTest(unittest.TestCase):
    """パックに置いた table.json を、元の表なしで確かめる。"""

    @classmethod
    def setUpClass(cls):
        cls.table = b.load_json(TABLE_PATH)
        cls.rules = real_rules()
        cls.source = b.source_entry(PACK, cls.rules["source"])

    def test_tied_to_rules_and_source(self):
        with open(RULES_PATH, "rb") as f:
            self.assertEqual(self.table["rules"]["sha256"], hashlib.sha256(f.read()).hexdigest(), "columns.json を直したら table.json を作り直す")
        s = self.table["source"]
        self.assertEqual(s["sha256"], self.source["sha256"])
        for k in ("id", "name", "publisher", "url"):
            self.assertEqual(s[k], self.source[k])
        self.assertRegex(s["retrieved"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertEqual(s["processed"], b.PROCESSED)
        self.assertEqual(self.table["schema"], b.TABLE_SCHEMA)

    def test_recount(self):
        p = self.table["population"]
        st = {g["code"]: g for g in p["status"]}
        self.assertEqual((p["rows"], p["notFacilityRows"], p["active"]), (1014, 0, 844))
        self.assertEqual((st["SUSPENDED"]["n"], st["CLOSED"]["n"], st["CLOSED"]["sub"]["n"], st["NEW"]["n"]), (118, 22, 1, 30))

    def test_rows_add_up(self):
        t = self.table
        keys = [a["key"] for a in self.rules["axes"]]
        codes = {a["key"]: {c["code"] for c in a["codes"]} for a in t["axes"]}
        self.assertEqual(sum(r["n"] for r in t["rows"]), t["population"]["active"])
        combos = [tuple(r[k] for k in keys) for r in t["rows"]]
        self.assertEqual(len(combos), len(set(combos)))
        for r in t["rows"]:
            self.assertEqual(list(r), keys + ["n"])
            self.assertGreater(r["n"], 0)
            for k in keys:
                self.assertIn(r[k], codes[k])
        for c in t["cells"]:
            self.assertEqual(sum(c["to"].values()), t["population"]["active"], c["key"])
        steps = [s["facilities"] for s in t["k"]["steps"]]
        self.assertEqual(steps, sorted(steps, reverse=True))
        self.assertEqual([s["axes"] for s in t["k"]["steps"]], self.rules["steps"])
        self.assertEqual(t["k"]["of"], t["population"]["active"])
        # k の数は rows から数え直せる
        for s in t["k"]["steps"]:
            idx = [keys.index(k) for k in s["axes"]]
            n = {}
            for combo, r in zip(combos, t["rows"]):
                sub = tuple(combo[i] for i in idx)
                n[sub] = n.get(sub, 0) + r["n"]
            self.assertEqual(sum(v for v in n.values() if v >= t["k"]["min"]), s["facilities"])

    def test_no_names(self):
        """どの文字列も、決まり・出典・道具の決まった文・コードから来ていて、元の表の値から来ていない。"""
        t = self.table
        edges = next(a for a in t["axes"] if a["key"] == "capacity_t_per_day")["edges"]
        allowed = {s for _, s in _strings(self.rules, [])}
        allowed |= {s for _, s in _strings(self.source, [])}
        allowed |= set(b.describe(self.rules, edges))
        for a in self.rules["axes"]:
            allowed |= {s for _, s in _strings(b.axis_codes(a, edges), [])}
        allowed |= {b.TABLE_SCHEMA, b.PROCESSED, b.RULES_FILE, b.EDGES_FROM_RULES, b.EDGES_FROM_ARGS, b.TOOL, b.NAME_CHECK_METHOD}
        allowed |= {
            "schema", "pack", "source", "id", "name", "publisher", "url", "retrieved", "sha256", "processed",
            "rules", "file", "edgesFrom", "tool", "counting", "population", "rows", "notFacilityRows", "active",
            "status", "code", "n", "sub", "axes", "key", "unit", "edges", "codes", "below", "atLeast",
            "cells", "to", "blank", "from", "k", "min", "of", "steps", "facilities",
            "nameCheck", "columns", "method", "values", "hits",
        }
        stray = [s for _, s in _strings(t, []) if s not in allowed and not re.fullmatch(r"[0-9a-f]{64}|\d{4}-\d{2}-\d{2}", s)]
        self.assertEqual(stray, [], "決まりにも出典にも無い文字列がある")
        self.assertEqual(t["nameCheck"]["hits"], 0)
        self.assertGreater(t["nameCheck"]["values"], 0)
        self.assertEqual(t["nameCheck"]["columns"], self.rules["withhold"])
        for w in ("施設名称", "地方公共団体名", "施設所在地"):
            self.assertIn([w], self.rules["withhold"])

    def test_numbers_are_small(self):
        """数は数と境目だけ（コードのような 5 桁以上の数が無い）。"""
        nums = []

        def walk(o):
            if isinstance(o, dict):
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
            elif isinstance(o, (int, float)) and not isinstance(o, bool):
                nums.append(o)

        walk(self.table)
        self.assertTrue(nums)
        self.assertLess(max(nums), 10000)


if __name__ == "__main__":
    unittest.main()
