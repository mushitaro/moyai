"""同じバイト列を出すための書き込み部品。"""
import json
import re
import zipfile
from pathlib import Path

FIXED_ZIP_TIME = (2026, 10, 1, 0, 0, 0)


def json_bytes(obj) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json_bytes(obj))


def rewrite_zip_fixed(path: Path) -> None:
    """zip を、同じ順・同じ日時・同じ圧縮で書き直す。"""
    with zipfile.ZipFile(path) as zin:
        entries = [(i.filename, zin.read(i.filename)) for i in zin.infolist()]
    tmp = path.with_suffix(path.suffix + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zout:
        for name, data in entries:
            if name == "docProps/core.xml":
                # openpyxl は保存のたびに更新日時を今の時刻にする。物語の今日に戻す
                data = re.sub(rb"(<dcterms:(created|modified)[^>]*>)[^<]*(</dcterms:\2>)",
                              rb"\g<1>2026-10-01T00:00:00Z\g<3>", data)
            zi = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.create_system = 3
            zi.external_attr = 0o600 << 16
            zout.writestr(zi, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    tmp.replace(path)
