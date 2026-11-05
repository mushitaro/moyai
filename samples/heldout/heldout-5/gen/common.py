# -*- coding: utf-8 -*-
"""組 heldout-5 の生成器の共通の部品。

- 乱数の種と物語の「今日」はここで固定する（SEED, TODAY）。
- Excel・PDF・JPEG・CSV を、同じ命令で同じバイトになるように書く。
"""
import datetime as dt
import io
import json
import os
import random
import re
import zipfile

SEED = 20261105
TODAY = dt.date(2026, 10, 1)          # 物語の「今日」
FIXED_DT = dt.datetime(2026, 10, 1, 9, 0, 0)
MAN_DAY_HOURS = 8

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 組のフォルダ
GEN = os.path.join(ROOT, "gen")
TMP = r"C:\tmp\moyai-heldout-5-tmp"

FONT_PATH = r"C:\Windows\Fonts\NotoSansJP-VF.ttf"
HAND_FONT_PATH = r"C:\Windows\Fonts\HGRKK.TTC"     # 手書きに見せる書き込み用（画像の中だけ）


def rng(tag):
    """ファイルごとに独立した乱数（種 + 名札）。"""
    return random.Random(f"{SEED}:{tag}")


# ---------------------------------------------------------------- 年度と和暦

def fy_of(d):
    return d.year if d.month >= 4 else d.year - 1


def era(y, m=12, d=31):
    """(元号の頭文字, 元号の名, 年) を返す。2019-05-01 から令和。"""
    if (y, m, d) >= (2019, 5, 1):
        return "R", "令和", y - 2018
    return "H", "平成", y - 1988


def wa_long(d, gan=False):
    """令和7年4月7日。gan=True なら元年を「元年」と書く。"""
    a, name, n = era(d.year, d.month, d.day)
    ns = "元" if (gan and n == 1) else str(n)
    return f"{name}{ns}年{d.month}月{d.day}日"


def wa_short(d, gan=False):
    """R7.4.7"""
    a, name, n = era(d.year, d.month, d.day)
    ns = "元" if (gan and n == 1) else str(n)
    return f"{a}{ns}.{d.month}.{d.day}"


def fy_label(fy, gan=True):
    """年度の和暦の頭（R7、R元、H30）。年度の名は 4 月 1 日の元号ではなく、慣習どおり年度末の元号に寄せる：2019 年度は R元。"""
    if fy >= 2019:
        n = fy - 2018
        return "R元" if (gan and n == 1) else f"R{n}"
    return f"H{fy - 1988}"


WEEK = "月火水木金土日"


def youbi(d):
    return WEEK[d.weekday()]


def iso(d):
    return d.isoformat()


# ---------------------------------------------------------------- 書き出し

def ensure(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)


def normalize_zip(path):
    """openpyxl の zip の時刻を固定し、同じ命令で同じバイトにする。"""
    with open(path, "rb") as f:
        data = f.read()
    zin = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            raw = zin.read(info.filename)
            if info.filename == "docProps/core.xml":
                # openpyxl は保存の時刻を modified に書く。物語の「今日」に固定する
                raw = re.sub(rb"(<dcterms:modified[^>]*>)[^<]*(</dcterms:modified>)",
                             rb"\g<1>2026-10-01T09:00:00Z\g<2>", raw)
            zi =zipfile.ZipInfo(info.filename, date_time=(2026, 10, 1, 9, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = info.external_attr
            zout.writestr(zi, raw)
    with open(path, "wb") as f:
        f.write(out.getvalue())


def save_xlsx(wb, path, title, creator):
    p = wb.properties
    p.creator = creator
    p.lastModifiedBy = creator
    p.title = title
    p.created = FIXED_DT
    p.modified = FIXED_DT
    ensure(path)
    wb.save(path)
    normalize_zip(path)


def write_json(path, obj):
    ensure(path)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")


def write_text(path, text):
    ensure(path)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def answer_file(fac_dir, rel_file, plan, records, **extra):
    """answer/files/<stem>.json を書く。rel_file は files/ からの道。"""
    stem = os.path.splitext(rel_file)[0].replace("/", "__")
    obj = {"schema": "moyai.answer.file/0", "file": rel_file, "plan": plan}
    obj.update(extra)
    obj["records"] = records
    write_json(os.path.join(fac_dir, "answer", "files", stem + ".json"), obj)


# ---------------------------------------------------------------- 工数

def hours_of(span):
    """'8:00～17:00' → 実働時間（昼休み 1 時間を 12 時をまたぐときに引く）。"""
    a, b = span.replace("〜", "～").split("～")
    ah, am = [int(x) for x in a.split(":")]
    bh, bm = [int(x) for x in b.split(":")]
    h = (bh * 60 + bm - ah * 60 - am) / 60
    if ah < 12 and bh > 12:
        h -= 1
    return h


def md(persons, span):
    return round(persons * hours_of(span) / MAN_DAY_HOURS, 3)


def workdays(start, n, rnd=None, skip_sun=True, skip_sat=False):
    """start から n 日の作業日（日曜を飛ばす）。"""
    out = []
    d = start
    while len(out) < n:
        if (skip_sun and d.weekday() == 6) or (skip_sat and d.weekday() == 5):
            d += dt.timedelta(days=1)
            continue
        out.append(d)
        d += dt.timedelta(days=1)
    return out
