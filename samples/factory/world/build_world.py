"""rules.json から正解の世界を組む。数や日付はコードに埋めず、rules.json から読む。"""
import json
import random
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
RULES_PATH = HERE / "rules.json"


def load_rules(path: Path = RULES_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def fiscal_year(d: date) -> int:
    return d.year if d.month >= 4 else d.year - 1


def _pick(v, furnace_no):
    """値が furnace 番号ごとの辞書なら引く。そうでなければそのまま。"""
    if isinstance(v, dict):
        return v[str(furnace_no)]
    return v


def _md_date(fy: int, md: str) -> date:
    m, d = (int(x) for x in md.split("-"))
    return date(fy if m >= 4 else fy + 1, m, d)


def build_equipment(rules: dict) -> list[dict]:
    sys_idx = {s["key"]: i for i, s in enumerate(rules["systems"])}
    sys_name = {s["key"]: s["name"] for s in rules["systems"]}
    group_idx = {}
    for t in rules["equipment_templates"]:
        g = tuple(t.get("groups", []))
        group_idx.setdefault((t["system"], g), len(group_idx))
    items = []
    for ti, t in enumerate(rules["equipment_templates"]):
        gi = group_idx[(t["system"], tuple(t.get("groups", [])))]
        if t["scope"] == "furnace":
            for f in rules["facility"]["furnaces"]:
                items.append((sys_idx[t["system"]], gi, f["no"], ti, t, f))
        else:
            items.append((sys_idx[t["system"]], gi, 0, ti, t, None))
    items.sort(key=lambda x: x[:4])
    out = []
    for i, (_, _, _, _, t, f) in enumerate(items, 1):
        out.append({
            "id": f"E{i:02d}",
            "key": t["key"],
            "base_name": t["name"],
            "name": (f["label"] + " " if f else "") + t["name"],
            "system_key": t["system"],
            "system": sys_name[t["system"]],
            "path": [sys_name[t["system"]]] + list(t.get("groups", [])),
            "furnace": f["no"] if f else None,
            "furnace_label": f["label"] if f else "共通",
            "code": t["code"],
            "tag": t.get("tag"),
            "install_year": t.get("install"),
            "spec": list(t.get("spec", [])),
            "parts": [p for p in t.get("parts", []) if p.get("furnace_only") in (None, f["no"] if f else None)],
        })
    return out


def _cycle_ok(cycle, fy, furnace_no):
    if cycle is None:
        return True
    start = _pick(cycle["from"], furnace_no)
    return fy >= start and (fy - start) % cycle["every"] == 0


def _outage_dates(rules, fy):
    o = rules["outage"]
    s = _md_date(fy, o["start_md"])
    return s, s + timedelta(days=o["days"] - 1)


def generate_works(rules: dict, equipment: list[dict]) -> list[dict]:
    rng = random.Random(f"{rules['seed']}-works")
    fy0, fy1 = rules["fiscal_years"]["from"], rules["fiscal_years"]["to"]
    by_key = {}
    for e in equipment:
        by_key.setdefault((e["key"], e["furnace"]), e)
    patterns = {p["id"]: p for p in rules["patterns"]}
    draws = {}  # (pattern, furnace, fy) -> (start, end)  同じ日程を「with」で使う
    works = []

    def emit(p, fy, furnace_no, start, end):
        draws[(p["id"], furnace_no, fy)] = (start, end)
        crew_cfg = p["crew"]
        for key in p["targets"]:
            e = by_key[(key, furnace_no if p["per"] == "furnace" else None)]
            crew = crew_cfg["base"] + rng.randint(-crew_cfg["jitter"], crew_cfg["jitter"])
            days = (end - start).days + 1
            works.append({
                "pattern": p["id"], "equipment_id": e["id"], "fiscal_year": fiscal_year(start),
                "attr": p["attr"], "tag": p["tag"], "label": p["label"],
                "start": start.isoformat(), "end": end.isoformat(),
                "duration_days": days, "crew": crew, "man_days": crew * days,
                "contractor": p.get("contractor"), "bundle": p["bundle"],
                "note_text": p.get("note_text"),
            })

    # with 参照があるので、with でない型を先に、with の型を後に組む
    ordered = sorted(rules["patterns"], key=lambda p: p["schedule"]["kind"] == "with")
    for p in ordered:
        sch = p["schedule"]
        furnaces = [f["no"] for f in rules["facility"]["furnaces"]] if p["per"] == "furnace" else [None]
        if "only_furnace" in p:
            furnaces = [p["only_furnace"]]
        for fy in range(fy0, fy1 + 1):
            for fno in furnaces:
                kind = sch["kind"]
                if kind == "outage":
                    if fy not in rules["outage"]["years"]:
                        continue
                    s, e = _outage_dates(rules, fy)
                    emit(p, fy, fno, s, e)
                    continue
                if kind == "dates":
                    for ds, de in sch["dates"]:
                        s, e = date.fromisoformat(ds), date.fromisoformat(de)
                        if fiscal_year(s) == fy:
                            emit(p, fy, fno, s, e)
                    continue
                if not _cycle_ok(p.get("cycle"), fy, fno):
                    continue
                if kind == "with":
                    s, e = draws[(sch["pattern"], fno, fy)]
                    emit(p, fy, fno, s, e)
                    continue
                if kind == "fixed":
                    days = _pick(p["days"], fno)
                    if sch.get("follow_outage") and fy in rules["outage"]["years"]:
                        rel = rules["outage"]["furnace_overhaul"][str(fno)]
                        os_, oe = _outage_dates(rules, fy)
                        base = os_ if rel["anchor"] == "outage_start" else oe
                        s = base + timedelta(days=rel["offset_days"])
                    else:
                        s = _md_date(fy, _pick(sch["month_day"], fno))
                    emit(p, fy, fno, s, s + timedelta(days=days - 1))
                    continue
                raise ValueError(f"未知の schedule: {kind}")
    return works


def apply_injections(rules: dict, equipment: list[dict], works: list[dict]) -> list[dict]:
    """欠けを入れる。remove は作業を消す。unrecord は予定のまま実績を付けない。"""
    eq = {e["id"]: e for e in equipment}

    def matches(w, m):
        e = eq[w["equipment_id"]]
        if w["pattern"] != m["pattern"] or w["fiscal_year"] != m["fy"]:
            return False
        if "furnace" in m and e["furnace"] != m["furnace"]:
            return False
        if "equip_key" in m and e["key"] != m["equip_key"]:
            return False
        return True

    for inj in rules["gap_injections"]:
        hit = [w for w in works if matches(w, inj["match"])]
        if len(hit) != 1:
            raise ValueError(f"{inj['id']}: 当たる作業が {len(hit)} 件（1 件であるべき）")
        w = hit[0]
        if inj["op"] == "remove":
            works.remove(w)
        elif inj["op"] == "unrecord":
            w["unrecorded"] = True
        else:
            raise ValueError(inj["op"])
    return works


def set_status(rules: dict, works: list[dict]) -> None:
    today = date.fromisoformat(rules["today"])
    for w in works:
        s, e = date.fromisoformat(w["start"]), date.fromisoformat(w["end"])
        if e < today:
            w["status"] = "planned_unrecorded" if w.pop("unrecorded", False) else "actual"
        elif s >= today:
            w["status"] = "planned"
        else:
            raise ValueError("今日をまたぐ作業は未対応: " + w["start"])
    works.sort(key=lambda w: (w["start"], w["equipment_id"], w["pattern"]))
    for i, w in enumerate(works, 1):
        w["id"] = f"W{i:04d}"


def derive_gaps(rules: dict, equipment: list[dict], works: list[dict]) -> list[dict]:
    """作業の結果だけから欠けを見つけ、注入した欠けの ID とひもづける。"""
    eq = {e["id"]: e for e in equipment}
    inj = rules["gap_injections"]
    inspections = {i["id"] for i in rules["inspections"]}
    gaps = []
    lim = rules["interval_limit_years"]

    def inj_for(kind, pred):
        c = [i for i in inj if i["inspection"] == kind and pred(i)]
        if len(c) != 1:
            raise ValueError(f"{kind}: 注入との対応が {len(c)} 件")
        return c[0]

    # 精密機能検査の間
    prec = {}
    for w in works:
        if w["tag"] == "PRECISION":
            prec.setdefault(w["equipment_id"], []).append(w["fiscal_year"])
    for eid, fys in sorted(prec.items()):
        fys.sort()
        for a, b in zip(fys, fys[1:]):
            if b - a > lim:
                e = eq[eid]
                i = inj_for("INSP-INTERVAL", lambda i: a < i["match"]["fy"] < b
                            and i["match"].get("furnace") == e["furnace"])
                gaps.append({"id": i["id"], "inspection_id": "INSP-INTERVAL", "equipment_id": eid,
                             "fiscal_year": i["match"]["fy"],
                             "what": f"精密機能検査の間が {b - a} 年（{a} 年度の次が {b} 年度）。{lim} 年を越える"})
    # 過去の予定に実績が無い
    for w in works:
        if w["status"] == "planned_unrecorded":
            i = inj_for("INSP-NOACTUAL", lambda i: i["match"]["pattern"] == w["pattern"]
                        and i["match"]["fy"] == w["fiscal_year"]
                        and (("equip_key" not in i["match"]) or i["match"]["equip_key"] == eq[w["equipment_id"]]["key"])
                        and i["match"].get("furnace", eq[w["equipment_id"]]["furnace"]) == eq[w["equipment_id"]]["furnace"])
            gaps.append({"id": i["id"], "inspection_id": "INSP-NOACTUAL", "equipment_id": w["equipment_id"],
                         "fiscal_year": w["fiscal_year"], "work_id": w["id"],
                         "what": f"{w['fiscal_year']} 年度の予定（{w['start']}）に実績が無い"})
    # 計画の窓に予定が無い
    win = rules["plan_window"]
    planned = {w["equipment_id"] for w in works
               if w["status"] == "planned" and win["fy_from"] <= w["fiscal_year"] <= win["fy_to"]}
    for e in equipment:
        if e["id"] not in planned:
            i = inj_for("INSP-NOPLAN", lambda i: any(
                w["pattern"] == i["match"]["pattern"] and w["equipment_id"] == e["id"] for w in works))
            gaps.append({"id": i["id"], "inspection_id": "INSP-NOPLAN", "equipment_id": e["id"],
                         "fiscal_year": i["match"]["fy"],
                         "what": f"{win['fy_from']}〜{win['fy_to']} 年度の窓に予定が 1 つも無い"})
    gaps.sort(key=lambda g: g["id"])
    if {g["id"] for g in gaps} != {i["id"] for i in inj}:
        raise ValueError("注入した欠けと、見つけた欠けが合わない")
    for g in gaps:
        assert g["inspection_id"] in inspections
    return gaps


def build_world(rules: dict | None = None) -> dict:
    rules = rules or load_rules()
    equipment = build_equipment(rules)
    works = generate_works(rules, equipment)
    works = apply_injections(rules, equipment, works)
    set_status(rules, works)
    gaps = derive_gaps(rules, equipment, works)
    fy0, fy1 = rules["fiscal_years"]["from"], rules["fiscal_years"]["to"]
    return {
        "schema": "moyai.factory.world/0",
        "world_version": rules["world_version"],
        "fictional": True,
        "facility": rules["facility"],
        "documents": rules["documents"],
        "seed": rules["seed"],
        "today": rules["today"],
        "fiscal_years": list(range(fy0, fy1 + 1)),
        "plan_window": rules["plan_window"],
        "man_day_hours": rules["man_day_hours"],
        "equipment": equipment,
        "equipment_to_code": {e["id"]: e["code"] for e in equipment},
        "works": works,
        "inspections": rules["inspections"],
        "gaps": gaps,
        "rules": rules,
    }
