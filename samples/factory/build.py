"""入口。python -I -X utf8 samples/factory/build.py で、資料・正解・事実をすべて作り直す。"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from world.build_world import build_world  # noqa: E402
from writers.daily_csv import write_daily  # noqa: E402
from writers.facts import read_facts  # noqa: E402
from writers.hoshitori_xlsx import write_hoshitori  # noqa: E402
from writers.ioutil import write_json  # noqa: E402

REPO = HERE.parent.parent
PACK_COMMON = REPO / "packs" / "waste-incineration" / "common.json"


def build(root: Path) -> list[Path]:
    """root の下に out / truth / facts を作る。書いたファイルの一覧を返す。"""
    world = build_world()
    fac = world["facility"]
    sub = Path(fac["pack"]) / fac["id"]
    out, truth, facts = root / "out" / sub, root / "truth" / sub, root / "facts" / sub
    written = []

    write_json(truth / "world.json", world)
    written.append(truth / "world.json")

    t = write_hoshitori(world, out / "plan-hoshitori.xlsx")
    written.append(out / "plan-hoshitori.xlsx")
    write_json(truth / "plan-hoshitori.truth.json", t)
    written.append(truth / "plan-hoshitori.truth.json")
    write_json(facts / "plan-hoshitori.facts.json", read_facts(out / "plan-hoshitori.xlsx", "plan-hoshitori.xlsx"))
    written.append(facts / "plan-hoshitori.facts.json")

    d = write_daily(world, out / "daily-report.csv")
    written.append(out / "daily-report.csv")
    write_json(truth / "daily-report.truth.json", d)
    written.append(truth / "daily-report.truth.json")
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=HERE.parent, help="out / truth / facts を置く samples のフォルダ")
    a = ap.parse_args()
    files = build(a.root)
    for f in files:
        print(f.relative_to(a.root).as_posix())
    return 0


if __name__ == "__main__":
    sys.exit(main())
