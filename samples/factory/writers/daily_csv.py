"""委託先の作業日報（業務システムの書き出し）を CSV で書く。"""
import csv
import io
import random
from datetime import date, timedelta
from pathlib import Path

from dirt import (DATE_STYLES, EFFORT_STYLES, date_text, effort_text, mixed_brackets,
                  to_halfwidth_kana)

TITLE = "【架空】作業日報 書き出し（委託先 業務システム）"
AUTHOR = "作成者,【架空】みどり保全 日報システム"
COLUMNS = ["日付", "工事名", "機器", "号炉", "作業内容", "工数", "備考"]


def _groups(world: dict):
    rules = world["rules"]
    today = date.fromisoformat(world["today"])
    contractors = {c["id"]: date.fromisoformat(c["from"]) for c in rules["contractors"]}
    eq = {e["id"]: e for e in world["equipment"]}
    groups = {}
    for w in world["works"]:
        if w["status"] != "actual" or not w["contractor"]:
            continue
        s = date.fromisoformat(w["start"])
        if s < contractors[w["contractor"]]:
            continue
        key = (w["pattern"], eq[w["equipment_id"]]["furnace"], w["start"]) if w["bundle"] else (w["id"],)
        groups.setdefault(key, []).append(w)
    out = []
    for key, ws in groups.items():
        ws.sort(key=lambda w: w["id"])
        out.append(ws)
    out.sort(key=lambda ws: (ws[0]["start"], ws[0]["id"]))
    return out, eq, today


def write_daily(world: dict, path: Path) -> dict:
    cfg = world["rules"]["dirt"]["csv"]
    hours = world["man_day_hours"]
    rng = random.Random(f"{world['seed']}-csv")
    groups, eq, today = _groups(world)

    recs = []
    for ws in groups:
        s, e = date.fromisoformat(ws[0]["start"]), date.fromisoformat(ws[0]["end"])
        d = s
        while d <= e and d <= today:
            recs.append((d, ws))
            d += timedelta(days=1)
    recs.sort(key=lambda x: (x[0], x[1][0]["id"]))

    lines = [[TITLE], AUTHOR.split(","), ["出力日", date_text(today, "wareki_kanji")], [], COLUMNS]
    header_line = len(lines)
    truth_rows = []
    for d, ws in recs:
        e0 = eq[ws[0]["equipment_id"]]
        fno = e0["furnace"]
        label = ws[0]["label"]
        f_label = e0["furnace_label"]
        if len(ws) > 1:
            names = "・".join(eq[w["equipment_id"]]["base_name"] for w in ws) + "（一式）"
        else:
            names = e0["base_name"]
        if fno is not None:
            sp = rng.choice(cfg["furnace_spellings"])
            furnace_txt = sp.format(n=fno, zn="１２３４"[fno - 1])
            work_name = f"{label}（{f_label}）"
        else:
            furnace_txt = "共通" if rng.random() < 0.5 else ""
            work_name = label
        work_name = mixed_brackets(work_name, rng) if rng.random() < cfg["brackets_mixed_rate"] else work_name
        names = mixed_brackets(names, rng) if rng.random() < cfg["brackets_mixed_rate"] else names
        content = label + (f"（{ws[0]['note_text']}）" if ws[0]["note_text"] else "")
        note = ws[0]["note_text"] or ""
        if rng.random() < cfg["halfwidth_kana_rate"]:
            content = to_halfwidth_kana(content)
            note = to_halfwidth_kana(note)
        md = sum(w["crew"] for w in ws)
        style = rng.choice(EFFORT_STYLES)
        raw = effort_text(md, style, hours)
        lines.append([date_text(d, rng.choice(DATE_STYLES)), work_name, names, furnace_txt, content, raw, note])
        truth_rows.append({
            "line": len(lines), "date": d.isoformat(), "work_ids": [w["id"] for w in ws],
            "equipment_ids": [w["equipment_id"] for w in ws], "bundle": len(ws) > 1,
            "effort_text": raw, "effort_style": style, "man_days": md,
        })

    buf = io.StringIO(newline="")
    csv.writer(buf, lineterminator="\r\n").writerows(lines)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(buf.getvalue().encode("cp932"))

    return {
        "schema": "moyai.factory.truth.daily/0",
        "file": "daily-report.csv",
        "encoding": "cp932",
        "newline": "CRLF",
        "title_line": 1,
        "author_line": 2,
        "header_line": header_line,
        "first_data_line": header_line + 1,
        "columns": COLUMNS,
        "hours_per_man_day": hours,
        "effort_rule": "工数は人・日に直す。人工と延べ人数は数をそのまま、時間は hours_per_man_day で割る",
        "missing_note": cfg["missing_note"],
        "rows": truth_rows,
    }
