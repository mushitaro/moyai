"""正解の世界を作る：施設の機器（1 台ずつ）、毎年の作業（日付・工数・業者）、契約。

業種の語は持たない。機器・作業・周期・業者の役・組み方は、パックの world.json と施設の facility.json から読む。
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from pathlib import Path

from .util import ROOT, d, daterange, fill, fy_range, read_json, rng_for

TD = dt.timedelta


class World:
    def __init__(self, fac_path: Path):
        self.fac_path = Path(fac_path)
        self.fac = read_json(fac_path)
        self.pack = self.fac["pack"]
        self.rules = read_json(ROOT / "packs" / self.pack / "world.json")
        self.seed = self.fac["seed"]
        self.today = d(self.fac["today"])
        self.prof = self.fac["profile"]
        self.F = self.prof.get("furnaces", 1)
        self.y0, self.y1 = self.fac["years"]
        self.plan_to = self.fac.get("planTo", self.y1 + 5)
        self.fym = self.rules.get("fiscalYearStartMonth", 4)
        self.today_fy = self.today.year if self.today.month >= self.fym else self.today.year - 1
        self.rates = dict(self.rules["rates"])
        self.rates.update(self.fac.get("rates", {}))
        self.cat = {t["key"]: t for t in self.rules["catalog"]}
        self.sys = {s["key"]: s for s in self.rules["systems"]}
        self.assets: list[dict] = []
        self.aidx: dict[str, dict] = {}
        self.works: list[dict] = []
        self.widx: dict[str, dict] = {}
        self.contracts: list[dict] = []
        self.cidx: dict[str, dict] = {}
        self.windows: dict[int, dict] = {}
        self.links: list[dict] = []
        self.errata: list[dict] = []
        self.gaps: list[dict] = list(self.fac.get("gapsNote", []))
        self.words = self.rules.get("text", {})
        self.vendor_names = self._vendors()
        self._build_assets()
        self._plan_occurrences()
        self._schedule()
        self._outage_works()
        self._breakdowns()
        self._routine()
        self._contracts()
        self.works.sort(key=lambda w: (w["start"], w["id"]))

    # ------------------------------------------------------------------ 業者
    def _vendors(self):
        out = {}
        style = self.fac.get("vendorStyle", "㈱")
        pick = self.fac.get("vendorPick", 0)
        for role, names in self.rules["vendors"].items():
            if role == "note":
                continue
            n = names[(pick + len(role)) % len(names)]
            if n.startswith("（") or n.startswith("("):
                out[role] = n
            elif style == "株式会社":
                out[role] = n + "株式会社"
            elif style == "(株)":
                out[role] = "(株)" + n
            else:
                out[role] = n + "㈱"
        return out

    def vendor(self, role: str) -> str:
        return self.vendor_names[role]

    # ------------------------------------------------------------------ 機器
    def applies(self, t: dict) -> bool:
        if t["key"] in self.fac.get("exclude", []):
            return False
        for axis, allowed in t.get("need", {}).items():
            if self.prof.get(axis) not in allowed:
                return False
        return True

    def _tag(self, t, f, i, n):
        if not t.get("tag"):
            return None
        st = self.fac.get("tagStyle", "dash")
        base = t["tag"]
        if t["scope"] == "furnace":
            if st == "dash":
                return f"{base}-{f}" + (f"-{i}" if n > 1 else "")
            return f"{base}-{f}{i:02d}"
        if st == "dash":
            return f"{base}-{i}" if n > 1 else base
        return f"{base}-{i:03d}"

    def _add_asset(self, a):
        self.assets.append(a)
        self.aidx[a["id"]] = a
        return a

    def _build_assets(self):
        com = self.prof["commissioned"]
        for t in self.rules["catalog"]:
            if not self.applies(t):
                continue
            installed = com + t.get("addedYearOffset", 0)
            if installed > self.plan_to:
                continue
            scope = t["scope"]
            kind = scope if scope in ("junction", "shared_part", "facility") else None
            furnaces = range(1, self.F + 1) if scope == "furnace" else [None]
            n = t.get("n", 1)
            for f in furnaces:
                for i in range(1, n + 1):
                    aid = t["key"] + (f"-{f}" if f else "") + (f"-{i}" if n > 1 else "")
                    a = self._add_asset({
                        "id": aid, "key": t["key"], "name": t["name"], "system": t["sys"],
                        "class": t.get("class"), "furnace": f, "unit": i if n > 1 else None, "units": n,
                        "part": None, "parent": None, "commonKind": t.get("commonKind", kind),
                        "installed": installed, "added": installed != com, "tag": self._tag(t, f or 0, i, n),
                    })
                    parts = t.get("parts", [])
                    pfs = range(1, self.F + 1) if (t.get("partsPerFurnace") and scope != "furnace") else [None]
                    for p in parts:
                        for pf in pfs:
                            pid = aid + "/" + p + (f"#{pf}" if pf else "")
                            self._add_asset({
                                "id": pid, "key": t["key"], "name": p, "system": t["sys"], "class": t.get("class"),
                                "furnace": f or pf, "unit": a["unit"], "units": n, "part": p, "parent": aid,
                                "commonKind": None if pf else a["commonKind"], "installed": installed,
                                "added": a["added"], "tag": None, "partFurnace": pf,
                            })

    def units_of(self, key):
        return [a for a in self.assets if a["key"] == key and a["part"] is None]

    def targets(self, t, task):
        units = self.units_of(t["key"])
        if task.get("p"):
            return [a for a in self.assets if a["key"] == t["key"] and a["part"] == task["p"]]
        return units

    # ------------------------------------------------------------------ 作業の年
    def _add_work(self, w):
        w["id"] = f"w{len(self.works) + 1:05d}"
        self.works.append(w)
        self.widx[w["id"]] = w
        return w

    def _plan_occurrences(self):
        r = rng_for(self.seed, "occ")
        ov = self.fac.get("overrides", {})
        ystart = self.y0
        self.pending = []  # (work, at) 日付を決める前
        for t in self.rules["catalog"]:
            if not self.applies(t):
                continue
            for ti, task in enumerate(t["tasks"]):
                okey = f"{t['key']}|{task['w']}"
                o = ov.get(okey, {})
                shared_phase = r.randrange(task["c"])
                for tg in self.targets(t, task):
                    c = task["c"]
                    inst = tg["installed"]
                    if task.get("once") == "added":
                        years = [inst] if inst >= ystart else []
                    elif "years" in o and (not o.get("target") or o["target"] == tg["id"]):
                        years = list(o["years"])
                    else:
                        # 1 行にまとめて書く機器（group・pair）は、同じ年度にまとめて整備する
                        phase = shared_phase if t.get("chartRow") in ("group", "pair") else r.randrange(c)
                        years = [y for y in range(ystart, self.plan_to + 1) if (y - 2000) % c == phase and y >= inst]
                        if task["a"] == "REPLACE" and c >= 6:
                            # 長い周期の更新は、竣工から周期を過ぎたあとだけ
                            years = [y for y in years if y - inst >= c - 1]
                    if o.get("target") and o["target"] != tg["id"] and "years" in o:
                        pass
                    skip = set(o.get("skip", [])) if (not o.get("target") or o["target"] == tg["id"]) else set()
                    skipdone = set(o.get("skipDone", [])) if (not o.get("target") or o["target"] == tg["id"]) else set()
                    nofuture = o.get("noFuture") and (not o.get("target") or o["target"] == tg["id"])
                    per = task.get("perYear", 1)
                    for y in years:
                        if y in skip:
                            continue
                        if nofuture and y > self.today_fy:
                            continue
                        for k in range(per):
                            st = "planned"
                            pr = r.random()
                            if y < self.today_fy:
                                if y in skipdone:
                                    st = "not_done"
                                elif per == 1 and pr < self.rates["postpone"] and task["a"] != "UPGRADE":
                                    st = "postponed"
                                elif per == 1 and pr < self.rates["postpone"] + self.rates["partial"]:
                                    st = "partial"
                                else:
                                    st = "done"
                            elif y == self.today_fy:
                                st = "planned_cur"
                            w = {"asset": tg["id"], "key": t["key"], "task": task["w"], "ti": ti, "attr": task["a"],
                                 "strategy": "時間基準保全", "fy": y, "plannedFy": y, "status": st, "legal": task.get("legal"),
                                 "vendorRole": task["v"], "ct": task["ct"], "at": task["at"], "flow": task.get("flow"),
                                 "mdRange": task["md"], "dRange": task["d"], "costK": task["k"], "k": k, "per": per,
                                 "cycle": c}
                            if st == "postponed":
                                w2 = dict(w)
                                w["status"] = "postponed"  # 計画した年度。実施は翌年度
                                w2["fy"] = y + 1
                                w2["status"] = "done" if y + 1 < self.today_fy else "planned_cur"
                                w2["postponedFrom"] = y
                                self.pending.append(w)
                                self.pending.append(w2)
                            else:
                                self.pending.append(w)
                    # 計画外の臨時の実施
                    if per == 1 and c >= 2:
                        for y in range(ystart, min(self.today_fy, self.plan_to)):
                            if y not in years and y >= inst and r.random() < self.rates["unplannedExtra"]:
                                self.pending.append({"asset": tg["id"], "key": t["key"], "task": task["w"], "ti": ti,
                                                     "attr": task["a"], "strategy": "時間基準保全", "fy": y, "plannedFy": None,
                                                     "status": "extra", "legal": task.get("legal"), "vendorRole": task["v"],
                                                     "ct": task["ct"], "at": task["at"], "flow": task.get("flow"),
                                                     "mdRange": task["md"], "dRange": task["d"], "costK": task["k"],
                                                     "k": 0, "per": 1, "cycle": c})
        # 基幹的設備改良
        up = self.prof.get("upgrade")
        self.upgrade = None
        if up:
            u = self.rules["upgrade"]
            y0 = up[0]
            self.upgrade = {"years": list(range(y0, y0 + u["years"])), "title": u["title"]}
            items = [k for k in u["items"] if k in self.cat and self.applies(self.cat[k])]
            for k in items:
                for a in self.units_of(k):
                    fyx = y0 + 1 if (a["furnace"] or 1) % 2 == 1 else y0 + 2
                    self.pending.append({"asset": a["id"], "key": k, "task": "基幹改良（更新）", "ti": 99, "attr": "UPGRADE",
                                         "strategy": "時間基準保全", "fy": fyx, "plannedFy": fyx,
                                         "status": "done" if fyx < self.today_fy else "planned_cur", "legal": None,
                                         "vendorRole": u["v"], "ct": "upgrade", "at": "F" if a["furnace"] else "A",
                                         "flow": "outer", "mdRange": [40, 80], "dRange": [8, 14], "costK": 0, "k": 0,
                                         "per": 1, "cycle": 30})

    # ------------------------------------------------------------------ 日付
    def _schedule(self):
        r = rng_for(self.seed, "sched")
        o = self.rules["outage"]
        steps = o["steps"]
        pre = []
        post = []
        seen_work = False
        for s in steps:
            if s["key"] == "work":
                seen_work = True
                continue
            (post if seen_work else pre).append(s)
        pre_days = sum(s["days"] for s in pre)
        post_days = sum(s["days"] for s in post)
        byfy = defaultdict(list)
        for w in self.pending:
            byfy[w["fy"]].append(w)
        for fy in sorted(byfy):
            allws = byfy[fy]
            for w in allws:
                w["days"] = r.randint(*w["dRange"])
                w["manDays"] = r.randint(*w["mdRange"])
                n = self.cat[w["key"]].get("n", 1) if w["key"] in self.cat else 1
                if self.cat.get(w["key"], {}).get("chartRow") == "group" and n > 1 and w["ti"] != 99:
                    # 1 行にまとめた機器の工数と費用は、まとめた全体の値を台数で割る
                    w["manDays"] = max(1, round(w["manDays"] / n))
                    w["costK"] = w["costK"] / n
            # まとめて整備する機器は同じ日に並行する（先頭の 1 件で日付を決め、ほかに写す）
            groups = defaultdict(list)
            for w in allws:
                if self.cat.get(w["key"], {}).get("chartRow") == "group":
                    groups[(w["key"], w["ti"], w["k"], self.aidx[w["asset"]]["furnace"], w["status"] == "postponed")].append(w)
            follow = {}
            for g in groups.values():
                for x in g[1:]:
                    follow[id(x)] = g[0]
            ws = [w for w in allws if id(w) not in follow]
            (m1, d1), (m2, d2) = o["startMonthDay"]
            a0 = dt.date(fy, m1, d1)
            a1 = dt.date(fy, m2, d2)
            start = a0 + TD(days=r.randint(0, (a1 - a0).days))
            win = {"furnaces": {}, "steps": []}
            # 全休炉の長さ（共通設備の作業が入る分）
            aw = [w for w in ws if w["at"] in ("A", "B", "D")]
            la = r.randint(*o["allDays"])
            byv = defaultdict(int)
            for w in aw:
                if w["at"] == "A":
                    byv[w["vendorRole"]] += w["days"]
            need = max(byv.values(), default=0)
            la = max(la, min(need, 14))
            cursor = start
            all_start = None
            for f in range(1, self.F + 1):
                fws = [w for w in ws if w["at"] == "F" and self.aidx[w["asset"]]["furnace"] == f]
                if f == 1:
                    wstart = cursor
                else:
                    wstart = all_start if f == 2 else cursor
                work0 = wstart + TD(days=pre_days)
                work_len = self._lay_furnace(fws, work0, o["flow"]["inner"])
                work_len = max(work_len, 10)
                wend = work0 + TD(days=work_len + post_days - 1)
                if f == 1:
                    # 全休炉は 1 号炉の窓の終わりの la 日
                    all_start = wend - TD(days=la - 1)
                    if self.F == 1:
                        all_start = work0
                        la = max(1, min(la, work_len))
                win["furnaces"][f] = {"start": wstart, "end": wend, "work0": work0, "workEnd": work0 + TD(days=work_len - 1)}
                self._steps_for(win, f, wstart, work0 + TD(days=work_len), pre, post)
                cursor = wend + TD(days=1)
            all_end = all_start + TD(days=la - 1)
            win["all"] = {"start": all_start, "end": all_end}
            blackout = all_start + TD(days=int(la * o["allOutage"]["blackoutAt"]))
            win["blackout"] = blackout
            self._la = la
            self._lay_all(aw, all_start, blackout)
            self.windows[fy] = win
            # いつでもできる作業と、月・四半期・半期の作業
            outs = [(v["start"], v["end"]) for v in win["furnaces"].values()]
            fya, fyb = fy_range(fy, self.fym)
            for w in ws:
                if w["at"] == "Y":
                    for _ in range(40):
                        s = fya + TD(days=r.randint(5, 330))
                        e = s + TD(days=w["days"] - 1)
                        if not any(s <= b and e >= a for a, b in outs) and s.weekday() < 5:
                            break
                    w["start"], w["end"] = s, e
                elif w["at"] in ("M", "Q", "H"):
                    months = {"M": [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3], "Q": [6, 9, 12, 2], "H": [7, 1]}[w["at"]]
                    mth = months[w["k"] % len(months)]
                    yy = fy if mth >= self.fym else fy + 1
                    s = dt.date(yy, mth, r.randint(6, 20))
                    while s.weekday() >= 5:
                        s += TD(days=1)
                    w["start"], w["end"] = s, s + TD(days=w["days"] - 1)
            for w in allws:
                if id(w) in follow:
                    w["start"], w["end"] = follow[id(w)]["start"], follow[id(w)]["end"]
            for w in allws:
                if "start" not in w:
                    raise RuntimeError(f"日付が決まらない作業 {w['key']} {w['task']} {w['at']}")
            for w in allws:
                self._finish_work(w)

    def _lay_furnace(self, fws, work0, inner):
        """炉内は上流から下流へ段を順に。段の中は部位ごとに並行。炉外は業者ごとにつながった期間。戻り値は機器整備の日数。"""
        t = 0
        vend_inner_end = {}
        for stage in inner:
            sw = [w for w in fws if w.get("flow") == stage]
            if not sw:
                continue
            ln = max(w["days"] for w in sw)
            for w in sw:
                w["start"] = work0 + TD(days=t)
                w["end"] = w["start"] + TD(days=w["days"] - 1)
                vend_inner_end[w["vendorRole"]] = max(vend_inner_end.get(w["vendorRole"], 0), t + w["days"])
            t += ln
        total = t
        outer = [w for w in fws if w.get("flow") not in inner]
        byv = defaultdict(list)
        for w in outer:
            byv[w["vendorRole"]].append(w)
        for v, lst in byv.items():
            # 元請（plant）の炉外の班は炉内と並行。専門の業者は炉内の作業に続けて 1 回のつながった期間にする
            c = 0 if v == "plant" else vend_inner_end.get(v, 0)
            for w in lst:
                w["start"] = work0 + TD(days=c)
                w["end"] = w["start"] + TD(days=w["days"] - 1)
                c += w["days"]
            total = max(total, c)
        return total

    def _lay_all(self, aw, all_start, blackout):
        byv = defaultdict(list)
        for w in aw:
            byv[(w["vendorRole"], w["at"])].append(w)
        dcs_start = blackout + TD(days=1)
        for (v, at), lst in sorted(byv.items()):
            if at == "A":
                c = all_start
            elif at == "B":
                c = blackout
            else:
                c = dcs_start
            all_end = all_start + TD(days=self._la - 1)
            for w in lst:
                if c + TD(days=w["days"] - 1) > all_end and c > all_start:
                    c = all_start if at == "A" else blackout  # 全休炉に収まらない分は別の班で並行
                w["start"] = c
                w["end"] = c + TD(days=w["days"] - 1)
                c = w["end"] + TD(days=1)

    def _steps_for(self, win, f, wstart, post0, pre, post):
        c = wstart
        for s in pre:
            win["steps"].append({"furnace": f, "key": s["key"], "name": s["name"], "start": c,
                                 "end": c + TD(days=s["days"] - 1), "md": s["md"], "vendor": s.get("vendor", "plant")})
            c += TD(days=s["days"])
        c = post0
        for s in post:
            win["steps"].append({"furnace": f, "key": s["key"], "name": s["name"], "start": c,
                                 "end": c + TD(days=s["days"] - 1), "md": s["md"], "vendor": s.get("vendor", "plant")})
            c += TD(days=s["days"])

    def _finish_work(self, w):
        w["vendor"] = self.vendor(w["vendorRole"])
        if w["status"] in ("planned", "planned_cur") and w["start"] <= self.today and w["fy"] <= self.today_fy:
            w["status"] = "done_cur" if w["fy"] == self.today_fy else w["status"]
        if w["status"] == "planned_cur" and w["start"] > self.today:
            w["status"] = "planned"
        done = w["status"] in ("done", "partial", "extra", "done_cur")
        w["done"] = done
        self._add_work(w)

    def _outage_works(self):
        """炉ごとの定期整備・全休炉（まとめた工事の行）と、窓の段（立下げ…立上げ）の作業。"""
        rows = self.rules.get("outageRows")
        if not rows:
            return
        for f in range(1, self.F + 1):
            self._add_asset({"id": f"F-{f}", "key": "_F", "name": self.unit(f), "system": "FAC", "class": None,
                             "furnace": f, "unit": None, "units": 1, "part": None, "parent": None, "commonKind": None,
                             "installed": self.prof["commissioned"], "added": False, "tag": None, "pseudo": True})
        self._add_asset({"id": "ALL", "key": "_ALL", "name": self.text("allUnits"), "system": "FAC", "class": None, "furnace": None,
                         "unit": None, "units": 1, "part": None, "parent": None, "commonKind": "facility",
                         "installed": self.prof["commissioned"], "added": False, "tag": None, "pseudo": True})
        base = {"strategy": "時間基準保全", "legal": None, "flow": None, "costK": 0, "k": 0, "per": 1, "cycle": 1,
                "mdRange": [0, 0], "dRange": [0, 0]}
        for fy, win in sorted(self.windows.items()):
            inwin = [w for w in self.works if w["fy"] == fy and w["at"] in ("F", "A", "B", "D")]
            for f, fw in win["furnaces"].items():
                md = sum(w["manDays"] for w in inwin if w["at"] == "F" and self.aidx[w["asset"]]["furnace"] == f)
                md += sum(s["md"] for s in win["steps"] if s["furnace"] == f)
                w = {**base, "asset": f"F-{f}", "key": "_F", "task": self.text("taskUnit"), "ti": "OUT", "attr": rows["furnace"]["a"],
                     "fy": fy, "plannedFy": fy, "status": "planned", "vendorRole": "plant", "ct": "bundle", "at": "F",
                     "start": fw["start"], "end": fw["end"], "days": (fw["end"] - fw["start"]).days + 1, "manDays": md,
                     "rollup": True}
                self._finish_outage(w)
            for s in win["steps"]:
                w = {**base, "asset": f"F-{s['furnace']}", "key": "_F", "task": s["name"], "ti": "STEP:" + s["key"],
                     "attr": None, "strategy": "定期整備の段", "fy": fy, "plannedFy": fy, "status": "planned",
                     "vendorRole": s["vendor"], "ct": "bundle", "at": "F", "start": s["start"], "end": s["end"],
                     "days": (s["end"] - s["start"]).days + 1, "manDays": s["md"], "stepKey": s["key"]}
                self._finish_outage(w)
            a = win["all"]
            md = sum(w["manDays"] for w in inwin if w["at"] in ("A", "B", "D"))
            w = {**base, "asset": "ALL", "key": "_ALL", "task": self.text("taskAll"), "ti": "ALL", "attr": rows["all"]["a"],
                 "fy": fy, "plannedFy": fy, "status": "planned", "vendorRole": "plant", "ct": "bundle", "at": "A",
                 "start": a["start"], "end": a["end"], "days": (a["end"] - a["start"]).days + 1, "manDays": md,
                 "rollup": True}
            self._finish_outage(w)

    def _finish_outage(self, w):
        if w["fy"] < self.today_fy:
            w["status"] = "done"
        elif w["fy"] == self.today_fy:
            w["status"] = "planned_cur"
        self._finish_work(w)

    # ------------------------------------------------------------------ 事後の補修
    def _breakdowns(self):
        r = rng_for(self.seed, "brk")
        rows = self.rules.get("breakdowns", [])
        for fy in range(self.y0, self.today_fy + 1):
            win = self.windows.get(fy)
            fya, fyb = fy_range(fy, self.fym)
            for grp in rows:
                for key in grp["for"]:
                    if key not in self.cat or not self.applies(self.cat[key]):
                        continue
                    for a in self.units_of(key):
                        if a["installed"] > fy:
                            continue
                        if r.random() >= self.rates["breakdownPerUnitYear"]:
                            continue
                        s = fya + TD(days=r.randint(3, 360))
                        if s > self.today:
                            continue
                        days = r.choice([1, 1, 1, 2, 3])
                        t = self.cat[key]
                        rep = self.rules["repair"]
                        role = t["spec"]["maker"] if t.get("spec") else rep["default"]
                        role = role if role in rep["own"] else rep["default"]
                        w = {"asset": a["id"], "key": key, "task": r.choice(grp["w"]), "ti": -1, "attr": None,
                             "strategy": "事後保全", "fy": fy, "plannedFy": None, "status": "breakdown", "legal": None,
                             "vendorRole": role, "ct": "repair", "at": "X", "flow": None, "days": days,
                             "manDays": days * r.randint(2, 5), "costK": 0, "k": 0, "per": 1, "cycle": None,
                             "start": s, "end": s + TD(days=days - 1), "done": True,
                             "emergency": r.random() < 0.25}
                        w["vendor"] = self.vendor(role)
                        self._add_work(w)

    def _routine(self):
        """日報にだけ書く細かな点検・清掃（日報のある年度だけ）。"""
        dy = None
        for doc in self.fac["docs"]:
            if doc["type"] in ("diary", "diary_csv"):
                dy = doc["years"]
        rt = self.rules.get("routine")
        if not dy or not rt:
            return
        r = rng_for(self.seed, "routine")
        pool = []
        for it in rt["items"]:
            for key in it["for"]:
                if key in self.cat and self.applies(self.cat[key]):
                    for a in self.units_of(key):
                        pool.append((a, it["w"]))
        if not pool:
            return
        a_, b_ = fy_range(dy[0], self.fym)[0], min(fy_range(dy[1], self.fym)[1], self.today)
        lam = self.rates["diaryRoutinePerDay"]
        for day in daterange(a_, b_):
            if day.weekday() >= 5:
                continue
            n = 0
            x = r.random()
            while x < lam / (n + 1.6) and n < 4:
                n += 1
                x = r.random()
            for _ in range(n):
                a, ws = r.choice(pool)
                w = {"asset": a["id"], "key": a["key"], "task": r.choice(ws), "ti": -2, "attr": "INSPECT",
                     "strategy": "日常点検", "fy": day.year if day.month >= self.fym else day.year - 1, "plannedFy": None,
                     "status": "routine", "legal": None, "vendorRole": rt["vendor"], "ct": rt["contract"], "at": "R",
                     "flow": None, "days": 1, "manDays": r.choice([1, 1, 2, 2, 3]), "costK": 0, "k": 0, "per": 1,
                     "cycle": None, "start": day, "end": day, "done": True}
                w["vendor"] = self.vendor(rt["vendor"])
                self._add_work(w)

    # ------------------------------------------------------------------ 契約
    def _add_contract(self, c):
        self.contracts.append(c)
        self.cidx[c["id"]] = c
        return c

    def _contracts(self):
        r = rng_for(self.seed, "ct")
        fac = self.fac["name"]
        byfy = defaultdict(list)
        for w in self.works:
            if w["done"] or w["status"] in ("planned",):
                byfy[w["fy"]].append(w)
        ann = {a["key"]: a for a in self.rules.get("annualContracts", [])}
        seq = defaultdict(int)

        def new(fy, **kw):
            seq[fy] += 1
            cid = f"C{fy}-{seq[fy]:03d}"
            c = {"id": cid, "fy": fy, "seq": seq[fy], "works": [], **kw}
            return self._add_contract(c)

        for fy in range(self.y0, self.today_fy + 1):
            ws = [w for w in byfy.get(fy, []) if w["done"] or w["fy"] == self.today_fy]
            fya, fyb = fy_range(fy, self.fym)
            # 年間の委託
            for key, a in ann.items():
                mine = [w for w in ws if w["ct"] == f"annual:{key}"]
                if not mine and not a.get("always"):
                    continue
                ti = a.get("titleIf")
                if ti and self.prof.get(ti["axis"]) == ti["value"]:
                    title = ti["title"].replace("{fac}", fac)
                else:
                    title = a["title"].replace("{fac}", fac)
                yen = r.randint(*a["yen"]) // 1000 * 1000
                c = new(fy, title=title, kind=a["kind"], method=r.choice(a["method"]), vendor=self.vendor(a["v"]),
                        amount=yen, start=fya, end=fyb, annual=True)
                for w in mine:
                    w["contract"] = c["id"]
                    c["works"].append(w["id"])
            # 購入（作業ではない）
            for p in self.rules.get("purchases", []):
                if p.get("oneOff") and r.random() < 0.5:
                    continue
                need = p.get("needAsset")
                if need and need in self.cat and not any(a["key"] == need and a["installed"] <= fy for a in self.assets):
                    continue
                new(fy, title=p["title"], kind="物品", method="指名競争入札" if not p.get("oneOff") else "随意契約",
                    vendor=self.vendor(p["v"]), amount=r.randint(*p["yen"]) // 1000 * 1000, start=fya, end=fyb,
                    unitPrice=not p.get("oneOff"), purchase=True)
            # 定期補修工事（まとめた工事）
            win = self.windows.get(fy)
            for f in range(1, self.F + 1):
                mine = [w for w in ws if w["ct"] == "bundle" and w["at"] == "F" and self.aidx[w["asset"]]["furnace"] == f]
                if not mine:
                    continue
                fw = win["furnaces"][f]
                k = sum(w["costK"] for w in mine)
                c = new(fy, title=self.text("contractUnit").replace("{fac}", fac).replace("{unit}", self.unit(f)), kind="工事", method="一般競争入札", vendor=self.vendor("plant"),
                        amount=int(k * r.uniform(0.85, 1.05)) * 1000 + 18_000_000, start=fw["start"], end=fw["end"],
                        bundle=f)
                for w in mine:
                    w["contract"] = c["id"]
                    c["works"].append(w["id"])
            mine = [w for w in ws if w["ct"] == "bundle" and w["at"] in ("A", "B", "D")]
            if mine:
                k = sum(w["costK"] for w in mine)
                c = new(fy, title=self.text("contractAll").replace("{fac}", fac), kind="工事", method="一般競争入札",
                        vendor=self.vendor("plant"), amount=int(k * r.uniform(0.85, 1.05)) * 1000 + 4_000_000,
                        start=win["all"]["start"], end=win["all"]["end"], bundle="all")
                for w in mine:
                    w["contract"] = c["id"]
                    c["works"].append(w["id"])
            # 単独の工事（同じ作業は年度で 1 件にまとめる）
            groups = defaultdict(list)
            for w in ws:
                if w["ct"] == "own":
                    groups[(w["key"], w["task"])].append(w)
            for (key, task), lst in sorted(groups.items(), key=lambda kv: min(w["start"] for w in kv[1])):
                t = self.cat[key]
                label = self.contract_target_label(lst)
                kind = "委託" if any(x in task for x in ("検査", "測定", "点検調査", "洗浄")) and lst[0]["attr"] == "INSPECT" else "工事"
                suffix = "業務委託" if kind == "委託" else "工事"
                title = f"{label}{task}{suffix}"
                k = sum(w["costK"] for w in lst)
                method = r.choice(["指名競争入札", "随意契約", "随意契約", "一般競争入札"] if k > 5000 else ["随意契約", "随意契約（少額）", "指名競争入札"])
                c = new(fy, title=title, kind=kind, method=method, vendor=lst[0]["vendor"],
                        amount=max(300_000, int(k * r.uniform(0.82, 1.08)) * 1000),
                        start=min(w["start"] for w in lst), end=max(w["end"] for w in lst))
                for w in lst:
                    w["contract"] = c["id"]
                    c["works"].append(w["id"])
            # 事後の修繕
            for w in sorted([w for w in ws if w["ct"] == "repair"], key=lambda w: w["start"]):
                t = self.cat[w["key"]]
                label = self.contract_target_label([w])
                c = new(fy, title=f"{label}{w['task']}修繕工事" if "修繕" not in w["task"] else f"{label}{w['task']}",
                        kind="工事", method="随意契約（緊急）" if w.get("emergency") else "随意契約",
                        vendor=w["vendor"], amount=r.randint(4, 38) * 100_000, start=w["start"], end=w["end"],
                        repair=True, emergency=w.get("emergency", False))
                w["contract"] = c["id"]
                c["works"].append(w["id"])
            # 基幹的設備改良（継続費）
            if self.upgrade and fy == self.upgrade["years"][0]:
                u = self.rules["upgrade"]
                ys = self.upgrade["years"]
                c = new(fy, title=f"{fac}{u['title']}", kind="工事", method="一般競争入札（総合評価）",
                        vendor=self.vendor(u["v"]), amount=r.randint(*u["amountYen"]) // 1_000_000 * 1_000_000,
                        start=dt.date(fy, 7, 1), end=fy_range(ys[-1], self.fym)[1], upgrade=ys)
                self.upgrade["contract"] = c["id"]
        if self.upgrade:
            cid = self.upgrade.get("contract")
            for w in self.works:
                if w["ct"] == "upgrade" and cid:
                    w["contract"] = cid
                    self.cidx[cid]["works"].append(w["id"])
        # 変更契約
        for c in self.contracts:
            if not c.get("annual") and not c.get("purchase") and r.random() < 0.07:
                c["change"] = int(c["amount"] * r.uniform(1.02, 1.12)) // 1000 * 1000
                c["changeEnd"] = c["end"] + TD(days=r.choice([0, 7, 14, 21]))
        for w in self.works:
            w.setdefault("contract", None)

    def contract_target_label(self, lst):
        """契約の件名に書く対象（系列と号機）。"""
        t = self.cat[lst[0]["key"]]
        name = self.rules["catalog"][[x["key"] for x in self.rules["catalog"]].index(t["key"])]["chart"][0]
        labs = []
        for w in lst:
            a = self.aidx[w["asset"]]
            f = a["furnace"]
            u = a["unit"]
            s = ""
            if f and self.F > 1:
                s += self.unit(f)
            if u:
                s += f"No.{u}"
            labs.append(s)
        labs = sorted(set(x for x in labs if x))
        part = self.aidx[lst[0]["asset"]]["part"]
        nm = name + (part if part and part not in name else "")
        if not labs:
            return nm
        if len(labs) == 1:
            return labs[0] + nm
        return nm + "（" + "・".join(labs) + "）"

    # ------------------------------------------------------------------ 正解に記録する道具
    def link(self, work_id, file, **loc):
        self.links.append({"work": work_id, "file": file, **loc})

    def seen_name(self, asset, file, name):
        """資料ごとの呼び名（正解の assets[].names）。"""
        if not hasattr(self, "seen"):
            self.seen = {}
        self.seen.setdefault((asset, file), name)

    def erratum(self, **kw):
        self.errata.append(kw)

    def gap(self, **kw):
        self.gaps.append(kw)

    def text(self, key):
        """業種の言葉（パックの world.json の text）。無ければ、どの項目を書けばよいかを言って止まる。"""
        if key not in self.words:
            raise KeyError(f"packs/{self.pack}/world.json の text.{key} が無い（業種の言葉はコードに書かない）")
        return self.words[key]

    def doc_text(self, key):
        d = self.text("doc")
        if key not in d:
            raise KeyError(f"packs/{self.pack}/world.json の text.doc.{key} が無い")
        return d[key]

    def unit(self, n):
        """系列（号炉）n の正式な書き方。"""
        return fill(self.text("unit"), n)
