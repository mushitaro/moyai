"""この施設のサンプルを作り直す（samples/maker/make.py を呼ぶ）。使い方：python <この施設>/gen/make.py"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2]))

from maker.make import build  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
build(HERE.parent)
