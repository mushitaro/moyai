"""この施設のサンプルを自分で確かめる（samples/maker/check.py を呼ぶ）。使い方：python <この施設>/gen/check.py"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2]))

from maker.check import main  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
sys.exit(main([str(HERE.parent)]))
