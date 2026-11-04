# -*- coding: utf-8 -*-
"""組 heldout-4 の生成器の共通の部品。

乱数の種と物語の「今日」はここで固定する。同じ命令で同じファイルができる。
"""
import datetime as dt
import json
import os
import random

SEED = 4052611  # 組 heldout-4 の種（施設ごとに SEED + 施設の番号）
TODAY = dt.date(2026, 10, 1)  # 物語の「今日」
GEN_VERSION = "heldout-4 gen v1"
FIXED_TIME = dt.datetime(2026, 10, 1, 9, 0, 0)  # 文書のプロパティの日時（再現のため固定）

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 組のフォルダ
TMP = r"C:\tmp\moyai-heldout-4-tmp"

FONT_PATH = r"C:\Windows\Fonts\NotoSansJP-VF.ttf"


def rng(n):
    return random.Random(SEED + n)


def fy_of(d):
    return d.year if d.month >= 4 else d.year - 1


def era(d):
    """日付の元号と年（H31.4 → ('H',31)、R元.5 → ('R',1)）"""
    if d < dt.date(2019, 5, 1):
        return "H", d.year - 1988
    return "R", d.year - 2018


def wareki(d, gan=True):
    """'R7.4.3' の形。gan=True なら令和元年を『元』と書く"""
    e, y = era(d)
    ys = "元" if (gan and y == 1) else str(y)
    return f"{e}{ys}.{d.month}.{d.day}"


def wareki_long(d):
    e, y = era(d)
    name = {"H": "平成", "R": "令和"}[e]
    ys = "元" if y == 1 else str(y)
    return f"{name}{ys}年{d.month}月{d.day}日"


def fy_label(fy, style="R"):
    """年度の和暦の短い名前（2019 → 'H31'、2020 → 'R2'）"""
    if fy == 2019:
        return "H31"
    return f"R{fy - 2018}"


WEEK = "月火水木金土日"


def iso(d):
    return d.isoformat()


def daterange(a, b):
    d = a
    while d <= b:
        yield d
        d += dt.timedelta(days=1)


def workdays(a, b, holidays=()):
    return [d for d in daterange(a, b) if d.weekday() < 5 and d not in holidays]


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


class Facility:
    """1 施設の正解の世界。機器・作業と、ファイルごとの正解の記録を持つ。"""

    def __init__(self, fid, name, industry, profile, n):
        self.id = fid
        self.name = name
        self.industry = industry
        self.profile = profile
        self.rng = rng(n)
        self.equipment = {}  # id -> dict
        self.eq_order = []
        self.works = []
        self.unrecorded = []
        self.defects = []
        self.files = {}  # file -> {"plan": bool, "records": [], extra}
        self.wseq = 0
        self.dir = os.path.join(ROOT, fid)

    # ---- 機器
    def eq(self, eid, name, path, furnace=None, install_year=None, code=None):
        self.equipment[eid] = {
            "id": eid, "name": name, "names": {}, "furnace": furnace,
            "install_year": install_year, "code": code, "path": path, "rows": [],
        }
        self.eq_order.append(eid)
        return eid

    def eq_row(self, eids, file, loc, name_written):
        for e in eids:
            q = self.equipment[e]
            q["rows"].append(dict(file=file, **loc))
            q["names"].setdefault(file, name_written)

    def eq_name(self, eids, file, name_written):
        for e in eids:
            self.equipment[e]["names"].setdefault(file, name_written)

    # ---- 作業
    def work(self, label, attribute, status, fy, equipment, start=None, end=None,
             man_days=None, days=None, vendor=None, contract=None, precision=None, **extra):
        self.wseq += 1
        w = {"id": f"W{self.wseq:04d}", "label": label, "attribute": attribute,
             "status": status, "fiscal_year": fy, "equipment": list(equipment)}
        if start:
            w["start"] = iso(start)
        if end:
            w["end"] = iso(end)
        if man_days is not None:
            w["man_days"] = man_days
        if days is not None:
            w["days"] = days
        if vendor:
            w["vendor"] = vendor
        if contract:
            w["contract"] = contract
        if precision is not None and self.industry == "waste-incineration":
            w["precision"] = precision
        w.update(extra)
        w["rows"] = []
        self.works.append(w)
        return w

    @staticmethod
    def link(w, file, **loc):
        w["rows"].append(dict(file=file, **loc))

    # ---- ファイルの正解
    def file(self, fname, plan, **extra):
        self.files[fname] = {"plan": plan, "records": [], **extra}
        return self.files[fname]["records"]

    def path_of(self, fname):
        return os.path.join(self.dir, "files", fname)

    def write_answers(self):
        for fname, a in self.files.items():
            stem = os.path.splitext(fname)[0].replace("/", "__")
            obj = {"schema": "moyai.answer.file/0", "file": fname, "plan": a["plan"]}
            for k, v in a.items():
                if k not in ("plan", "records"):
                    obj[k] = v
            obj["records"] = a["records"]
            write_json(os.path.join(self.dir, "answer", "files", stem + ".json"), obj)
        eqs = []
        for e in self.eq_order:
            q = dict(self.equipment[e])
            eqs.append(q)
        world = {
            "schema": "moyai.answer.world/0",
            "facility": {"id": self.id, "name": self.name, "industry": self.industry,
                         "profile": self.profile},
            "fiscal_year_start_month": 4,
            "man_day_hours": 8,
            "today": iso(TODAY),
            "equipment": eqs,
            "works": self.works,
            "unrecorded": self.unrecorded,
            "defects": self.defects,
        }
        write_json(os.path.join(self.dir, "answer", "world.json"), world)


def set_props(wb, title):
    p = wb.properties
    p.creator = "【架空】サンプル生成器"
    p.lastModifiedBy = "【架空】サンプル生成器"
    p.title = title
    p.created = FIXED_TIME
    p.modified = FIXED_TIME


def save_wb(wb, path):
    """openpyxl の保存は zip の時刻を今にするので、保存後に中身の時刻を固定し直す。"""
    import zipfile
    import io
    os.makedirs(os.path.dirname(path), exist_ok=True)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    zin = zipfile.ZipFile(buf)
    out = io.BytesIO()
    zout = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
    for info in zin.infolist():
        data = zin.read(info.filename)
        if info.filename == "docProps/core.xml":
            # 保存時刻が入るので固定の時刻に置き換える
            import re
            s = data.decode("utf-8")
            s = re.sub(r"(<dcterms:modified[^>]*>)[^<]*(</dcterms:modified>)",
                       r"\g<1>2026-10-01T09:00:00Z\g<2>", s)
            s = re.sub(r"(<dcterms:created[^>]*>)[^<]*(</dcterms:created>)",
                       r"\g<1>2026-10-01T09:00:00Z\g<2>", s)
            data = s.encode("utf-8")
        zi = zipfile.ZipInfo(info.filename, date_time=(2026, 10, 1, 9, 0, 0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        zout.writestr(zi, data)
    zout.close()
    with open(path, "wb") as f:
        f.write(out.getvalue())


# ---- reportlab の共通
_FONT_DONE = False


def rl_font():
    global _FONT_DONE
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    if not _FONT_DONE:
        pdfmetrics.registerFont(TTFont("JP", FONT_PATH))
        _FONT_DONE = True
    return "JP"


def rl_canvas(path, title):
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    os.makedirs(os.path.dirname(path), exist_ok=True)
    c = canvas.Canvas(path, pagesize=A4, invariant=1)
    c.setTitle(title)
    c.setAuthor("【架空】サンプル生成器")
    c.setCreator("【架空】サンプル生成器")
    c.setSubject("架空のデータ")
    rl_font()
    return c
