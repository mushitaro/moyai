import hashlib
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
REPO = HERE.parent.parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import build as factory_build  # noqa: E402

SUB = Path("waste-incineration") / "fictional-1"
SUB2 = Path("waste-incineration") / "fictional-2"
SUB_NS = Path("night-soil") / "fictional-ns-1"
_cache: dict = {}


def built_root() -> Path:
    """一時のフォルダに 1 回だけ作る（試験どうしで使い回す）。"""
    if "root" not in _cache:
        tmp = tempfile.TemporaryDirectory()
        _cache["tmp"] = tmp
        _cache["root"] = Path(tmp.name)
        factory_build.build(_cache["root"])
    return _cache["root"]


def sha_map(root: Path) -> dict:
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*")) if p.is_file()}


def load(root: Path, kind: str, name: str, sub: Path = SUB):
    return json.loads((root / kind / sub / name).read_text(encoding="utf-8"))
