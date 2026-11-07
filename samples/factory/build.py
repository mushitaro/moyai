"""入口。python -I -X utf8 samples/factory/build.py で、資料・正解・事実をすべて作り直す。
LibreOffice が無いときは PDF を作らず、作れなかった数を知らせる（写真は PDF から作るので、同じく作らない）。"""
import argparse
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from world.build_world import build_world, load_rules  # noqa: E402
from writers.crossdoc import build_crossdoc  # noqa: E402
from writers.daily_csv import write_daily  # noqa: E402
from writers.facts import read_facts  # noqa: E402
from writers.hoshitori_xlsx import write_hoshitori  # noqa: E402
from writers.ioutil import write_json  # noqa: E402
from writers.ledger_xlsx import write_ledger  # noqa: E402
from writers.pdfconv import find_soffice, xlsx_to_pdf  # noqa: E402
from writers.photo import make_photo  # noqa: E402
from writers.report_xlsx import write_reports  # noqa: E402

REPO = HERE.parent.parent
RULES_FILES = ("rules.json", "rules-fictional-2.json", "rules-fictional-ns-1.json")
NO_SOFFICE = "LibreOffice（soffice）が見つからない"


def _photo_marks(rep: dict) -> list[dict]:
    """1 頁目の行に、手書きの印を付ける。精密機能検査と一式の行の工数に丸、ほかの行にチェック。
    同じ文字が頁に 2 回出る行には付けない（場所を決められない）。"""
    rows = [r for r in rep["rows"] if r["page"] == 1]
    texts = [r["effort_text"] for r in rows]
    marks = []
    for r in rows:
        if texts.count(r["effort_text"]) != 1:
            continue
        marks.append({"kind": "circle" if (r["precision"] or r["bundle"]) else "check", "text": r["effort_text"], "row_no": r["no"],
                      "work_ids": r["work_ids"]})
    return marks


def build_with_counts(root: Path, pdf: bool = True, rules_files: tuple = RULES_FILES) -> tuple[list[Path], dict]:
    """root の下に out / truth / facts を作る。(書いたファイルの一覧, 数えた結果) を返す。"""
    written: list[Path] = []
    counts = {"pdf_expected": 0, "pdf_made": 0, "pdf_not_made": 0,
              "photo_expected": 0, "photo_made": 0, "photo_not_made": 0, "not_made_reason": None}
    soffice = find_soffice() if pdf else None
    for rules_file in rules_files:
        world = build_world(load_rules(HERE / "world" / rules_file))
        fac = world["facility"]
        docs = set(world["documents"])
        sub = Path(fac["pack"]) / fac["id"]
        out, truth, facts = root / "out" / sub, root / "truth" / sub, root / "facts" / sub

        def put_truth(name, obj):
            write_json(truth / name, obj)
            written.append(truth / name)

        def put_facts(xlsx_name, fname):
            write_json(facts / fname, read_facts(out / xlsx_name, xlsx_name))
            written.append(facts / fname)

        put_truth("world.json", world)

        ledger = None
        if "ledger" in docs:
            ledger = write_ledger(world, out / "equipment-ledger.xlsx")
            written.append(out / "equipment-ledger.xlsx")
            put_truth("equipment-ledger.truth.json", ledger)
            put_facts("equipment-ledger.xlsx", "equipment-ledger.facts.json")

        hoshi = write_hoshitori(world, out / "plan-hoshitori.xlsx")
        written.append(out / "plan-hoshitori.xlsx")
        put_truth("plan-hoshitori.truth.json", hoshi)
        put_facts("plan-hoshitori.xlsx", "plan-hoshitori.facts.json")

        daily = None
        if "daily" in docs:
            daily = write_daily(world, out / "daily-report.csv")
            written.append(out / "daily-report.csv")
            put_truth("daily-report.truth.json", daily)

        reports, photos = None, []
        if "reports" in docs:
            reports = write_reports(world, out)
            for rep in reports["reports"]:
                written.append(out / rep["file_xlsx"])
            counts["pdf_expected"] += len(reports["reports"])
            if soffice:
                def conv(rep):
                    return xlsx_to_pdf(out / rep["file_xlsx"], out / rep["file_pdf"], soffice)
                with ThreadPoolExecutor(max_workers=4) as ex:
                    results = list(ex.map(conv, reports["reports"]))
            else:
                results = [False] * len(reports["reports"])
            pdf_ok = {}
            for rep, ok in zip(reports["reports"], results):
                pdf_ok[rep["id"]] = ok
                if ok:
                    written.append(out / rep["file_pdf"])
                    counts["pdf_made"] += 1
                else:
                    counts["pdf_not_made"] += 1
            if counts["pdf_not_made"]:
                counts["not_made_reason"] = ("--no-pdf を付けた" if not pdf else NO_SOFFICE if soffice is None
                                             else "PDF への変換に失敗した")
            put_truth("reports.truth.json", reports)

        if "photos" in docs and reports:
            by_id = {(r["furnace"], r["fiscal_year"]): r for r in reports["reports"]}
            for spec in world["rules"]["report"]["photos"]:
                counts["photo_expected"] += 1
                rep = by_id[(spec["furnace"], spec["fy"])]
                name = f"photos/inspection-photo-f{spec['furnace']}-fy{spec['fy']}.jpg"
                marks = _photo_marks(rep)
                # 正解は PDF の有る無しに依らず同じ（作る予定の写真と印）
                photos.append({"file": name, "source_report": rep["id"], "source_pdf": rep["file_pdf"],
                               "page": 1, "marks": marks,
                               "work_ids": sorted({w for m in marks for w in m["work_ids"]})})
                if not pdf_ok[rep["id"]]:
                    counts["photo_not_made"] += 1
                    continue
                info = make_photo(out / rep["file_pdf"], 1, marks, f"{world['seed']}-photo-{rep['id']}", out / name)
                if len(info["marks"]) != len(marks):
                    raise ValueError(f"{name}: 印を付けられなかった行がある")
                written.append(out / name)
                counts["photo_made"] += 1
            if counts["photo_not_made"] and counts["not_made_reason"] is None:
                counts["not_made_reason"] = "PDF が無い"
            put_truth("photos.truth.json", {"schema": "moyai.factory.truth.photos/0", "photos": photos,
                                            "note": "写真は報告書の PDF の 1 頁。印は手書きの丸（精密機能検査・一式の行の工数）とチェック（行）"})

        put_truth("crossdoc.truth.json", build_crossdoc(world, hoshi, ledger, reports, daily, photos))
    return written, counts


def build(root: Path, pdf: bool = True, rules_files: tuple = RULES_FILES) -> list[Path]:
    return build_with_counts(root, pdf, rules_files)[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=HERE.parent, help="out / truth / facts を置く samples のフォルダ")
    ap.add_argument("--rules", action="append", default=None, help="作る決まりのファイル（world/ の下の名前）。何度でも書ける。無ければ既定の全部。動画の世界は rules-hotarugawa.json")
    ap.add_argument("--no-pdf", action="store_true", help="PDF と写真を作らない（作れなかった数に数える）")
    a = ap.parse_args()
    files, counts = build_with_counts(a.root, pdf=not a.no_pdf, rules_files=tuple(a.rules) if a.rules else RULES_FILES)
    for f in files:
        print(f.relative_to(a.root).as_posix())
    print(f"PDF: 作った {counts['pdf_made']} / 作れなかった {counts['pdf_not_made']}"
          f"（予定 {counts['pdf_expected']}）", file=sys.stderr)
    print(f"写真: 作った {counts['photo_made']} / 作れなかった {counts['photo_not_made']}"
          f"（予定 {counts['photo_expected']}）", file=sys.stderr)
    if counts["not_made_reason"]:
        print(f"作れなかった理由: {counts['not_made_reason']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
