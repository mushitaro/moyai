"""資料をまたぐ対応の正解。どの資料のどの行（セル）が、同じ作業か。試験だけが読む。"""


def build_crossdoc(world: dict, hoshitori: dict, ledger: dict | None, reports: dict | None, daily: dict | None,
                   photos: list[dict] | None) -> dict:
    by_work: dict = {w["id"]: [] for w in world["works"]}
    for coord, c in hoshitori["cells"].items():
        for wid in c["work_ids"]:
            by_work[wid].append({"doc": "plan-hoshitori.xlsx", "sheet": hoshitori["sheet"], "cell": coord,
                                 "symbol": c["symbol"]})
    if reports:
        for rep in reports["reports"]:
            for row in rep["rows"]:
                for wid in row["work_ids"]:
                    by_work[wid].append({"doc": rep["file_pdf"], "source_xlsx": rep["file_xlsx"], "report_id": rep["id"],
                                         "page": row["page"], "table_row_no": row["no"], "xlsx_row": row["xlsx_row"],
                                         "bundle": row["bundle"]})
    if daily:
        for row in daily["rows"]:
            for wid in row["work_ids"]:
                by_work[wid].append({"doc": daily["file"], "line": row["line"], "date": row["date"],
                                     "bundle": row["bundle"]})
    photo_of = {}
    for p in photos or []:
        for wid in p["work_ids"]:
            photo_of.setdefault(wid, []).append(p["file"])
    ledger_row = ledger["equipment_rows"] if ledger else {}
    works = []
    for w in world["works"]:
        refs = by_work[w["id"]]
        for f in photo_of.get(w["id"], []):
            refs.append({"doc": f, "kind": "photo_of_report_page"})
        entry = {"work_id": w["id"], "equipment_id": w["equipment_id"], "fiscal_year": w["fiscal_year"],
                 "pattern": w["pattern"], "label": w["label"], "precision": w["tag"] == "PRECISION",
                 "man_days": w["man_days"], "duration_days": w["duration_days"], "refs": refs}
        if ledger:
            entry["ledger_row"] = ledger_row[w["equipment_id"]]
        works.append(entry)
    return {
        "schema": "moyai.factory.truth.crossdoc/0",
        "facility": world["facility"]["id"],
        "note": "資料をまたいで同じ作業を指す行の対応。ledger_row は作業の対象の機器の台帳の行",
        "precision_work_ids": [w["id"] for w in world["works"] if w["tag"] == "PRECISION"],
        "works": works,
    }
