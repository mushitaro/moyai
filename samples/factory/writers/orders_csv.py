"""業務の仕組みから書き出した発注明細の一覧（月ごとの CSV）を書く。
1 行目は題と抽出の条件（題・抽出日時・基準日・出力元を 1 行に並べる）、2 行目が列の見出し、3 行目から明細。
どの月も見出しの並びは同じ（同じ様式の CSV を何本も入れる試験の材料）。"""
import csv
import io
import random
from datetime import date, timedelta
from pathlib import Path


def _month_starts(fy: int, months: int) -> list[date]:
    out = []
    y, m = fy, 4
    for _ in range(months):
        out.append(date(y, m, 1))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _next_month(d: date) -> date:
    return date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)


def write_orders(world: dict, cfg: dict, out_dir: Path) -> dict:
    """cfg は world/exports-*.json。out_dir の下に orders/order-list-YYYY-MM.csv を書き、正解を返す。"""
    rng = random.Random(f"{world['seed']}-orders")
    eq = {e["id"]: e for e in world["equipment"]}
    contractors = {c["id"]: c["name"] for c in world["rules"]["contractors"]}
    files = []
    seq = 0
    for m0 in _month_starts(cfg["fiscal_year"], cfg["months"]):
        m1 = _next_month(m0)
        base = m1 - timedelta(days=1)
        works = sorted((w for w in world["works"] if m0 <= date.fromisoformat(w["start"]) < m1), key=lambda w: (w["start"], w["id"]))
        extracted = f"{m1.year}/{m1.month:02d}/{m1.day:02d} {cfg['extracted_at_hour']:02d}:00"
        lines = [
            [cfg["title"], f"抽出日時：{extracted}", f"基準日：{base.year}/{base.month:02d}/{base.day:02d}", f"出力元：{cfg['system']}"],
            list(cfg["columns"]),
        ]
        rows = []
        for w in works:
            seq += 1
            e = eq[w["equipment_id"]]
            s = date.fromisoformat(w["start"])
            ordered = s - timedelta(days=rng.randint(7, 30))
            done = date.fromisoformat(w["end"]) if w["status"] == "actual" and date.fromisoformat(w["end"]) <= base else None
            furnace = e["furnace_label"] if e["furnace"] is not None else "共通"
            title = f"{w['label']}（{furnace}）" if e["furnace"] is not None else w["label"]
            lines.append([
                f"PO-{cfg['fiscal_year']}-{seq:04d}",
                f"{ordered.year}/{ordered.month:02d}/{ordered.day:02d}",
                title,
                e["base_name"],
                furnace,
                w["label"],
                "1式",
                f"{done.year}/{done.month:02d}/{done.day:02d}" if done else "",
                contractors.get(w["contractor"], "") if w["contractor"] else "",
                w["note_text"] or "",
            ])
            rows.append({"line": len(lines), "work_id": w["id"], "equipment_id": w["equipment_id"], "status": w["status"],
                         "start": w["start"], "completed": done.isoformat() if done else None})
        name = f"orders/order-list-{m0.year}-{m0.month:02d}.csv"
        buf = io.StringIO(newline="")
        csv.writer(buf, lineterminator="\r\n").writerows(lines)
        path = out_dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(buf.getvalue().encode(cfg["encoding"]))
        files.append({"file": name, "title_line": 1, "header_line": 2, "first_data_line": 3, "rows": rows})
    return {
        "schema": "moyai.factory.truth.orders/0",
        "encoding": cfg["encoding"],
        "newline": "CRLF",
        "columns": list(cfg["columns"]),
        "note": "1 行目は題と抽出の条件（見出しではない）。2 行目が列の見出し。どの月も見出しの並びが同じ",
        "files": files,
    }
