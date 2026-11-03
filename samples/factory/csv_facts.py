"""CSV の原本の事実（物差し ①）：MOYAI とは別の読み手（Python の csv）で、書いた CSV を読み直す。

書き手が宣言した文字コード（正解の encoding）で読み、記録ごとに、記録の始まりの物理の行の番号と欄の並びを書く。
MOYAI の CSV の読み手は文字コードと区切りを自分で決めるので、ここで決めた値と比べることになる。

使い方：python -I -X utf8 samples/factory/csv_facts.py <CSV> <encoding> <区切り> <出す JSON> [<資料の名前>]
"""

import csv
import io
import json
import sys


def facts(path: str, encoding: str, delimiter: str, name: str) -> dict:
    with open(path, "rb") as f:
        raw = f.read()
    text = raw.decode(encoding)
    if text.startswith("﻿"):
        text = text[1:]
    # 記録の始まりの行：読み手が読み終えた行の数（line_num）の、1 つ前の記録の終わりの次
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, quotechar='"')
    records = []
    end = 0
    for fields in reader:
        records.append({"line": end + 1, "fields": fields})
        end = reader.line_num
    return {
        "schema": "moyai.factory.facts.csv/0",
        "file": name,
        "reader": f"python {sys.version.split()[0]} csv",
        "encoding": encoding,
        "delimiter": delimiter,
        "records": records,
    }


def main() -> None:
    if len(sys.argv) not in (5, 6):
        sys.exit(__doc__)
    path, encoding, delimiter, out = sys.argv[1:5]
    name = sys.argv[5] if len(sys.argv) == 6 else path.replace("\\", "/").split("/")[-1]
    d = facts(path, encoding, "\t" if delimiter == "\\t" else delimiter, name)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{name}: 記録 {len(d['records'])}")


if __name__ == "__main__":
    main()
