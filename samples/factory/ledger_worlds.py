"""公開の台帳のデモの架空の施設の正解の世界を組む（docs/plan.md §2.5・§2.8）。

world/ledger-facilities.json の施設ごとに、土台の決まり（rules-ledger-base.json か rules-fictional-2.json）に差だけを当て、
build_world で正解の世界を組んで samples/truth/<pack>/<施設>/world.json に書く。資料（Excel・CSV・PDF・写真）は書かない
（取り込みを通すのは fictional-1・fictional-2 だけ。台帳の施設は、scripts/ledger/ の道具が正解の世界から直接書いた計画を使う）。
乱数の種は施設ごとに決めてあり、もう一度走らせると同じバイト列になる。

  python -I -X utf8 samples/factory/ledger_worlds.py            samples/ の下に書く
  python -I -X utf8 samples/factory/ledger_worlds.py --root <道>  別の samples の根に書く（試験）
"""
import argparse
import copy
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from world.build_world import build_world, load_rules  # noqa: E402
from writers.ioutil import write_json  # noqa: E402

SPEC = HERE / "world" / "ledger-facilities.json"
FICT = "【架空】"


class LedgerWorldError(Exception):
    """差の当て方が決まらない。推測で埋めずに止める。"""


def load_spec(path: Path = SPEC) -> dict:
    spec = json.loads(path.read_text(encoding="utf-8"))
    if spec.get("schema") != "moyai.factory.ledger-facilities/0":
        raise LedgerWorldError("ledger-facilities.json の形でない")
    ids = [f["id"] for f in spec["facilities"]]
    if len(set(ids)) != len(ids):
        raise LedgerWorldError("施設の id が重なっている")
    for f in spec["facilities"]:
        for k in ("name", "contractor"):
            if FICT not in f[k]:
                raise LedgerWorldError(f"{f['id']}：{k} に【架空】が無い")
    return spec


def _merge(dst: dict, patch: dict) -> None:
    """辞書を重ねる（値が辞書どうしのときだけ中へ。ほかは置き換える）。"""
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict) and k not in ("cycle", "schedule", "crew", "days"):
            _merge(dst[k], v)
        else:
            dst[k] = copy.deepcopy(v)


def rules_for(fac: dict, base: dict) -> dict:
    """土台の決まりに、施設の差を当てた決まりを返す。"""
    r = copy.deepcopy(base)
    r["seed"] = fac["seed"]
    r["facility"] = {
        **r["facility"],
        "id": fac["id"],
        "name": fac["name"],
        # 検問所で人が答える見え方（全国の表の軸のコード）と処理能力。資料には書かない
        "answers": copy.deepcopy(fac["answers"]),
        "capacity_t_per_day": fac["capacity_t_per_day"],
    }
    r["contractors"] = [{**c, "name": fac["contractor"]} for c in r["contractors"]]
    r["gap_injections"] = []
    drop = set(fac.get("drop_templates", []))
    known = {t["key"] for t in r["equipment_templates"]}
    if drop - known:
        raise LedgerWorldError(f"{fac['id']}：知らない機器の型 {sorted(drop - known)}")
    r["equipment_templates"] = [t for t in r["equipment_templates"] if t["key"] not in drop]
    for t in r["equipment_templates"]:
        if t.get("install") is not None:
            t["install"] = t["install"] + fac.get("install_shift", 0)
    patterns = {p["id"]: p for p in r["patterns"]}
    for pid in fac.get("drop_patterns", []):
        if pid not in patterns:
            raise LedgerWorldError(f"{fac['id']}：知らない作業の型 {pid}")
        del patterns[pid]
    for pid, patch in fac.get("patterns", {}).items():
        if pid not in patterns:
            raise LedgerWorldError(f"{fac['id']}：知らない作業の型 {pid}")
        _merge(patterns[pid], patch)
    for p in fac.get("add_patterns", []):
        if p["id"] in patterns:
            raise LedgerWorldError(f"{fac['id']}：作業の型 {p['id']} がもうある")
        patterns[p["id"]] = copy.deepcopy(p)
    out = []
    for p in patterns.values():
        p["targets"] = [k for k in p["targets"] if k not in drop]
        if p["targets"]:
            out.append(p)
    r["patterns"] = out
    return r


def build_all(root: Path, spec: dict | None = None) -> list[Path]:
    spec = spec or load_spec()
    written = []
    for fac in spec["facilities"]:
        base = load_rules(HERE / "world" / fac["base"])
        rules = rules_for(fac, base)
        world = build_world(rules)
        if world["gaps"]:
            raise LedgerWorldError(f"{fac['id']}：欠けが出た（台帳の施設には欠けを入れない）")
        p = root / "truth" / rules["facility"]["pack"] / fac["id"] / "world.json"
        write_json(p, world)
        written.append(p)
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=HERE.parent, help="truth を置く samples のフォルダ")
    a = ap.parse_args()
    try:
        paths = build_all(a.root)
    except LedgerWorldError as e:
        print(f"ledger_worlds: {e}", file=sys.stderr)
        return 1
    print(f"ledger_worlds: {len(paths)} 施設の正解の世界を書いた", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
