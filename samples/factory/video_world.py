"""動画の撮り直し用の世界（ほたる川クリーンセンター）の資料を作り、video/world/hotarugawa/ に置く。
決まりは world/rules-hotarugawa.json だけ。作るのは施設台帳・星取表・作業日報の 3 つ（今のデモと同じ種類）と、
版の履歴の台本が読む正解の世界（world.truth.json）。packs/ のデモの資料には触れない。

  python -I -X utf8 samples/factory/video_world.py            video/world/hotarugawa/ に書く
  python -I -X utf8 samples/factory/video_world.py --check    置いてあるものが作り直しと同じバイト列かを確かめる（書かない）
"""
import argparse
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import build as factory_build  # noqa: E402

REPO = HERE.parent.parent
RULES = "rules-hotarugawa.json"
SUB = Path("waste-incineration") / "hotaru-video"
DEST = REPO / "video" / "world" / "hotarugawa"
DOCS = ("equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv")
TRUTH = "world.truth.json"


def build_to(tmp: Path) -> dict:
    """tmp の下に作り、置くファイルの名前 → 道 の表を返す。"""
    root = tmp / "samples"
    factory_build.build(root, pdf=False, rules_files=(RULES,))
    out = {name: root / "out" / SUB / name for name in DOCS}
    out[TRUTH] = root / "truth" / SUB / "world.json"
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", type=Path, default=DEST)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    with tempfile.TemporaryDirectory() as t:
        files = build_to(Path(t))
        if a.check:
            bad = [n for n, p in files.items() if not (a.dest / n).is_file() or (a.dest / n).read_bytes() != p.read_bytes()]
            for n in bad:
                print(f"作り直しと違う：{n}", file=sys.stderr)
            return 1 if bad else 0
        a.dest.mkdir(parents=True, exist_ok=True)
        for n, p in files.items():
            shutil.copyfile(p, a.dest / n)
            print((a.dest / n).as_posix())
    return 0


if __name__ == "__main__":
    sys.exit(main())
