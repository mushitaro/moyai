// 層 3 意味づけ（2）：資料をまたいで同じ機器・同じ作業を結ぶ。
// 機器は同一性の鍵が同じときだけ同じ（plan §2.1）。資料ごとに鍵が違うので、結ぶ案を同じ形ごとにまとめて聞き、
// 人（か AI）が受けたものだけを結ぶ。結べるか決まらないものは質問に回す。
import { nfkc } from "./era";
import { cue } from "./cues";
import { Asker, questionIdOf, type QuestionItem, YES_SPLIT } from "./questions";
import type { AssetRec, EventRec, MarkRec, Records, Series } from "./records";
import { nameKey } from "./text";

export interface Cluster {
  id: string;
  recs: AssetRec[];
  name: string;
  tag: string | null;
  tagNumber: number | null;
  series: Series | null;
  parent: Cluster | null;
  /** 決めた質問（作者を数える） */
  decidedBy: Set<string>;
  pending: boolean;
  excluded: string | null;
}

export interface Occurrence {
  id: string;
  tableId: string;
  file: string;
  sheet: string | null;
  workName: string;
  fiscalYear: number;
  /** 比べるための作業の名前（NFKC・空白なし） */
  workKey: string;
  events: EventRec[];
  targets: Cluster[];
  start: string | null;
  end: string | null;
  manDays: number | null;
  bundle: boolean;
  decidedBy: Set<string>;
}

export type LinkMode = "mark" | "eventOnly" | "excluded" | "pending";

export interface WorkLink {
  occurrence: Occurrence;
  cluster: Cluster;
  mode: LinkMode;
  mark: MarkRec | null;
  decidedBy: Set<string>;
}

export interface Linked {
  clusters: Cluster[];
  clusterOf: Map<string, Cluster>;
  occurrences: Occurrence[];
  links: WorkLink[];
  /** 日報の行で、機器が決まらない・外したもの */
  eventPending: Set<string>;
  eventExcluded: Map<string, string>;
  assetExcluded: Map<string, string>;
}

const numberOf = (c: { series: Series | null; tagNumber: number | null }): number | null =>
  c.series?.kind === "number" ? c.series.n : c.tagNumber;

function itemOfRec(r: AssetRec, target?: Cluster): QuestionItem {
  return {
    file: r.file,
    sheet: r.sheet,
    cells: [r.nameRef],
    ...(target ? { target: target.recs.slice(0, 3).map((t) => ({ file: t.file, sheet: t.sheet, cells: [t.nameRef] })) } : {}),
  };
}

function ymd(d: { y: number; m: number; d: number }): string {
  return `${String(d.y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

export function link(rec: Records, ask: Asker): Linked {
  // ─── 機器 ───
  const parentOf = new Map<string, string | null>();
  const clusterOf = new Map<string, Cluster>();
  const clusters: Cluster[] = [];
  const assetExcluded = new Map<string, string>();
  const tables = [...new Set(rec.assets.map((a) => a.tableId))];
  const firstOf = (tid: string) => rec.assets.find((a) => a.tableId === tid);
  tables.sort((a, b) => {
    const x = firstOf(a);
    const y = firstOf(b);
    if (!x || !y) return 0;
    if (x.shape !== y.shape) return x.shape === "tree" ? -1 : 1;
    return x.file.localeCompare(y.file) || x.sheetIndex - y.sheetIndex || x.order - y.order;
  });
  const newCluster = (r: AssetRec): Cluster => {
    const c: Cluster = {
      id: r.id,
      recs: [r],
      name: r.name,
      tag: r.tag,
      tagNumber: r.tagNumber,
      series: r.series,
      parent: null,
      decidedBy: new Set(),
      pending: r.pending,
      excluded: r.excluded,
    };
    clusters.push(c);
    clusterOf.set(r.id, c);
    return c;
  };
  const join = (c: Cluster, r: AssetRec, qid: string) => {
    c.recs.push(r);
    clusterOf.set(r.id, c);
    if (!c.tag && r.tag) {
      c.tag = r.tag;
      c.tagNumber = r.tagNumber;
    }
    if (!c.series && r.series) c.series = r.series;
    c.decidedBy.add(qid);
  };
  const childrenOf = (p: Cluster | null, tablesBefore: Set<string>) =>
    clusters.filter((c) => c.parent === p && c.recs.some((r) => tablesBefore.has(r.tableId)));
  const done = new Set<string>();
  for (const tid of tables) {
    const recs = rec.assets.filter((a) => a.tableId === tid).sort((a, b) => a.order - b.order);
    for (const r of recs) parentOf.set(r.id, r.parentId);
    if (done.size === 0) {
      for (const r of recs) newCluster(r);
      for (const r of recs) {
        const c = clusterOf.get(r.id);
        if (c) c.parent = r.parentId ? (clusterOf.get(r.parentId) ?? null) : null;
      }
      done.add(tid);
      continue;
    }
    // 先の資料の機器に決まっていないもの（名前の分け方・段など）があれば、結ぶ案はその決定のあとに作る
    if (rec.assets.some((a) => done.has(a.tableId) && a.pending && !a.excluded)) {
      for (const r of recs) {
        r.pending = true;
        const c = newCluster(r);
        c.parent = r.parentId ? (clusterOf.get(r.parentId) ?? null) : null;
      }
      done.add(tid);
      continue;
    }
    // 1 回目：親の案が受けられるとして、案を作る
    type Prop = { r: AssetRec; cand: Cluster | null; pattern: string; options: Cluster[] };
    const props: Prop[] = [];
    const proposed = new Map<string, Cluster | null>();
    for (const r of recs) {
      if (r.pending || r.excluded) {
        props.push({ r, cand: null, pattern: "skip", options: [] });
        continue;
      }
      const key = nameKey(r.name);
      const pc = r.parentId ? proposed.get(r.parentId) : null;
      let pool: Cluster[];
      let scope: string;
      if (!r.parentId) {
        pool = childrenOf(null, done);
        scope = "";
      } else if (pc) {
        pool = childrenOf(pc, done);
        scope = "";
      } else {
        pool = clusters.filter((c) => c.recs.some((x) => done.has(x.tableId) && x.level === r.level));
        scope = "global:";
      }
      const cands = pool.filter((c) => nameKey(c.name) === key);
      const sibs = recs.filter((x) => x.parentId === r.parentId && nameKey(x.name) === key && !x.pending && !x.excluded);
      const n = numberOf(r);
      let cand: Cluster | null = null;
      let pattern: string;
      if (cands.length === 0) pattern = "none";
      else if (cands.length === 1 && sibs.length === 1) {
        cand = cands[0] ?? null;
        const cn = cand ? numberOf(cand) : null;
        pattern = n !== null && cn !== null && n !== cn ? `${scope}uniqueNumberDiffers` : `${scope}unique`;
      } else {
        const byNum = n === null ? [] : cands.filter((c) => numberOf(c) === n);
        if (byNum.length === 1) {
          cand = byNum[0] ?? null;
          pattern = `${scope}byNumber`;
        } else pattern = "ambiguous";
      }
      proposed.set(r.id, cand);
      props.push({ r, cand, pattern, options: cands });
    }
    // 形ごとにまとめて聞く
    const groups = new Map<string, Prop[]>();
    for (const p of props) if (p.pattern !== "skip") groups.set(p.pattern, [...(groups.get(p.pattern) ?? []), p]);
    const tableFile = recs[0]?.file ?? "";
    const accepted = new Map<string, { c: Cluster; qid: string }>();
    const unmatched: Prop[] = [];
    for (const [pattern, ps] of groups) {
      if (pattern === "none") {
        unmatched.push(...ps);
        continue;
      }
      if (pattern === "ambiguous") {
        for (const p of ps) {
          const key = `assetLinkOne|${tid}|${p.r.id}`;
          const a = ask.ask(key, {
            kind: "assetLinkOne",
            text: `「${p.r.name}」に当たる機器が先の資料に ${p.options.length} つある。どれと同じ機器か`,
            options: [...p.options.map((c, i) => ({ id: `c${i}`, label: `${c.name}${c.tag ? `（${c.tag}）` : ""}` })), { id: "none", label: "どれとも違う（別の機器）" }],
            valueKind: "option",
            defaultAnswer: null,
            sameShapeRows: 1,
            items: [itemOfRec(p.r)],
          });
          if (a && a.startsWith("c")) {
            const c = p.options[Number(a.slice(1))];
            if (c) accepted.set(p.r.id, { c, qid: questionIdOf(key) });
          } else if (a === "none") unmatched.push({ ...p, cand: null });
          else p.r.pending = true;
        }
        continue;
      }
      const label: Record<string, string> = {
        unique: "名前が同じで、同じ親の下にどちらも 1 つずつ",
        uniqueNumberDiffers: "名前が同じで 1 つずつだが、号の数と機器番号の数が違う",
        byNumber: "名前が同じものがいくつかあり、号の数と機器番号の末尾の数が同じ",
      };
      const base = pattern.replace(/^global:/, "");
      const scopeNote = pattern.startsWith("global:") ? "（親どうしは結んでいない。名前と段だけで当てた）" : "";
      const gkey = `assetLink|${tid}|${pattern}`;
      const a = ask.ask(gkey, {
        kind: "assetLink",
        text: `${tableFile} の機器 ${ps.length} 件を、先の資料の機器と同じものとして結ぶか。結び方：${label[base] ?? base}${scopeNote}`,
        options: YES_SPLIT,
        valueKind: "option",
        defaultAnswer: base === "uniqueNumberDiffers" ? "split" : "yes",
        sameShapeRows: ps.length,
        items: ps.map((p) => itemOfRec(p.r, p.cand ?? undefined)),
      });
      for (const p of ps) {
        if (!p.cand) continue;
        if (a === "yes") accepted.set(p.r.id, { c: p.cand, qid: questionIdOf(gkey) });
        else if (a === "split") {
          const k1 = `assetLinkOne|${tid}|${p.r.id}`;
          const b = ask.ask(k1, {
            kind: "assetLinkOne",
            text: `「${p.r.name}」は、先の資料の「${p.cand.name}${p.cand.tag ? `（${p.cand.tag}）` : ""}」と同じ機器か`,
            options: [
              { id: "c0", label: "同じ機器" },
              { id: "none", label: "別の機器" },
            ],
            valueKind: "option",
            defaultAnswer: null,
            sameShapeRows: 1,
            items: [itemOfRec(p.r, p.cand)],
          });
          if (b === "c0") accepted.set(p.r.id, { c: p.cand, qid: questionIdOf(k1) });
          else if (b === "none") unmatched.push({ ...p, cand: null });
          else p.r.pending = true;
        } else p.r.pending = true;
      }
    }
    // 先の資料に無い機器
    if (unmatched.length) {
      const ukey = `assetUnmatched|${tid}`;
      const a = ask.ask(ukey, {
        kind: "assetUnmatched",
        text: `${tableFile} の機器 ${unmatched.length} 件は、先の資料に同じ名前の機器が無い。この資料だけの機器として入れるか`,
        options: [
          { id: "yes", label: "この資料だけの機器として入れる" },
          { id: "exclude", label: "外す" },
        ],
        valueKind: "option",
        defaultAnswer: "yes",
        sameShapeRows: unmatched.length,
        items: unmatched.map((p) => itemOfRec(p.r)),
      });
      for (const p of unmatched) {
        if (a === "exclude") {
          p.r.excluded = "先の資料に無い機器（決定で外した）";
          assetExcluded.set(p.r.id, p.r.excluded);
        } else if (a !== "yes") p.r.pending = true;
        else (p.r as AssetRec & { unmatchedQ?: string }).unmatchedQ = questionIdOf(ukey);
      }
    }
    // 2 回目：受けたものを結び、残りは新しい節に
    for (const r of recs) {
      const acc = accepted.get(r.id);
      if (acc && !r.pending) join(acc.c, r, acc.qid);
      else {
        const c = newCluster(r);
        const q = (r as AssetRec & { unmatchedQ?: string }).unmatchedQ;
        if (q) c.decidedBy.add(q);
        if (r.pending) c.pending = true;
      }
    }
    for (const r of recs) {
      const c = clusterOf.get(r.id);
      if (!c || c.recs[0] !== r) continue;
      // この表で新しくできた節の親：この表の親の行の節
      c.parent = r.parentId ? (clusterOf.get(r.parentId) ?? null) : null;
    }
    done.add(tid);
  }
  for (const c of clusters) {
    if (c.recs.some((r) => r.pending)) c.pending = true;
    if (c.recs.every((r) => r.excluded)) c.excluded = c.recs[0]?.excluded ?? "外した";
  }

  // ─── 日報の行 → 機器 ───
  const eventPending = new Set<string>();
  const eventExcluded = new Map<string, string>();
  const byName = new Map<string, Cluster[]>();
  for (const c of clusters) {
    if (c.excluded) continue;
    const k = nameKey(c.name);
    byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  type Case = { key: string; tableId: string; name: string; unitKey: string; cands: Cluster[]; events: EventRec[]; pattern: string };
  const cases = new Map<string, Case>();
  const eventNames = new Map<string, { names: string[]; unitKey: string }>();
  // 機器の節に決まっていないものがあれば、日報の行を機器に当てるのは、その決定のあとにする（先の答えで変わるため）
  const assetsSettled = clusters.every((c) => c.excluded || !c.pending);
  for (const e of rec.events) {
    if (e.excluded || e.pending || e.effortPending) continue;
    if (!assetsSettled) {
      eventPending.add(e.id);
      continue;
    }
    const whole = e.assetNames[0] ?? "";
    if (!whole) {
      eventPending.add(e.id);
      continue;
    }
    let names = [whole];
    if (!byName.has(nameKey(whole))) {
      for (const sep of cue.listSeparators) {
        const parts = nfkc(whole).split(sep).map((x) => x.trim()).filter(Boolean);
        if (parts.length > 1) {
          names = parts;
          break;
        }
      }
    }
    const unitKey = !e.unit ? "-" : e.unit.kind === "number" ? `n${e.unit.n}` : e.unit.kind === "common" ? "common" : "ditto";
    eventNames.set(e.id, { names, unitKey });
    for (const nm of names) {
      const k = `${e.tableId}|${nameKey(nm)}|${unitKey}`;
      let cs = cases.get(k);
      if (!cs) {
        let cands = byName.get(nameKey(nm)) ?? [];
        if (unitKey.startsWith("n")) cands = cands.filter((c) => numberOf(c) === Number(unitKey.slice(1)));
        else if (unitKey === "common") cands = cands.filter((c) => c.series?.kind === "common" || numberOf(c) === null);
        const pattern = cands.length === 1 ? (unitKey === "-" ? "nameOnly" : "nameUnit") : "ambiguous";
        cs = { key: k, tableId: e.tableId, name: nm, unitKey, cands, events: [], pattern };
        cases.set(k, cs);
      }
      cs.events.push(e);
    }
  }
  const resolved = new Map<string, { c: Cluster | null; qid: string | null; excluded: boolean }>();
  const caseGroups = new Map<string, Case[]>();
  for (const cs of cases.values()) {
    const g = `${cs.tableId}|${cs.pattern}`;
    caseGroups.set(g, [...(caseGroups.get(g) ?? []), cs]);
  }
  const unitLabel = (u: string) => (u === "-" ? "号の欄が空" : u === "common" ? "共通" : `${u.slice(1)} 号`);
  for (const [g, css] of caseGroups) {
    const [tableId, pattern] = g.split("|") as [string, string];
    const ev0 = css[0]?.events[0];
    const fileName = ev0?.file ?? "";
    const rows = css.reduce((a, c) => a + c.events.length, 0);
    if (pattern === "ambiguous") {
      for (const cs of css) {
        const key = `eventAssetOne|${cs.key}`;
        const a = ask.ask(key, {
          kind: "eventAssetOne",
          text: `${fileName} の機器「${cs.name}」（${unitLabel(cs.unitKey)}）に当たる機器が ${cs.cands.length === 0 ? "無い" : `${cs.cands.length} つある`}（${cs.events.length} 行）。どの機器か`,
          options: [...cs.cands.map((c, i) => ({ id: `c${i}`, label: `${c.name}${c.tag ? `（${c.tag}）` : ""}${seriesLabel(c.series)}` })), { id: "exclude", label: "外す" }],
          valueKind: "option",
          defaultAnswer: null,
          sameShapeRows: cs.events.length,
          items: cs.events.slice(0, 10).map((e) => ({ file: e.file, sheet: e.sheet, cells: e.refs.slice(0, 1) })),
        });
        const pick = a?.startsWith("c") ? (cs.cands[Number(a.slice(1))] ?? null) : null;
        resolved.set(cs.key, { c: pick, qid: a ? questionIdOf(key) : null, excluded: a === "exclude" });
      }
      continue;
    }
    const gkey = `eventAsset|${tableId}|${pattern}`;
    const a = ask.ask(gkey, {
      kind: "eventAsset",
      text: `${fileName} の機器の名前 ${css.length} 通り（${rows} 行）を、${pattern === "nameUnit" ? "名前と号が同じ" : "号の欄は空で、名前が同じ"}機器 1 つに当てるか`,
      options: YES_SPLIT,
      valueKind: "option",
      defaultAnswer: "yes",
      sameShapeRows: rows,
      items: css.map((cs) => ({
        file: cs.events[0]?.file ?? "",
        sheet: cs.events[0]?.sheet ?? null,
        cells: cs.events.slice(0, 1).map((e) => e.refs[0] ?? ""),
        target: (cs.cands[0]?.recs ?? []).slice(0, 3).map((r) => ({ file: r.file, sheet: r.sheet, cells: [r.nameRef] })),
        note: cs.name,
      })),
    });
    for (const cs of css) {
      if (a === "yes") resolved.set(cs.key, { c: cs.cands[0] ?? null, qid: questionIdOf(gkey), excluded: false });
      else if (a === "split") {
        const k1 = `eventAssetOne|${cs.key}`;
        const c0 = cs.cands[0];
        const b = ask.ask(k1, {
          kind: "eventAssetOne",
          text: `${fileName} の機器「${cs.name}」（${unitLabel(cs.unitKey)}、${cs.events.length} 行）は「${c0?.name ?? ""}${c0?.tag ? `（${c0.tag}）` : ""}${seriesLabel(c0?.series ?? null)}」か`,
          options: [
            { id: "c0", label: "はい" },
            { id: "exclude", label: "いいえ（外す）" },
          ],
          valueKind: "option",
          defaultAnswer: null,
          sameShapeRows: cs.events.length,
          items: cs.events.slice(0, 10).map((e) => ({ file: e.file, sheet: e.sheet, cells: e.refs.slice(0, 1) })),
        });
        resolved.set(cs.key, { c: b === "c0" ? (c0 ?? null) : null, qid: b ? questionIdOf(k1) : null, excluded: b === "exclude" });
      } else resolved.set(cs.key, { c: null, qid: null, excluded: false });
    }
  }
  // ─── 日報の行 → 作業のまとまり ───
  const occMap = new Map<string, Occurrence>();
  for (const e of rec.events) {
    if (e.excluded) continue;
    const en = eventNames.get(e.id);
    if (!en || e.pending || e.effortPending || e.fiscalYear === null || !e.date) {
      eventPending.add(e.id);
      continue;
    }
    const targets: Cluster[] = [];
    const qids = new Set<string>();
    let pend = false;
    let excl = false;
    for (const nm of en.names) {
      const r = resolved.get(`${e.tableId}|${nameKey(nm)}|${en.unitKey}`);
      if (!r || (!r.c && !r.excluded)) pend = true;
      else if (r.excluded) excl = true;
      else if (r.c) targets.push(r.c);
      if (r?.qid) qids.add(r.qid);
    }
    if (pend) {
      eventPending.add(e.id);
      continue;
    }
    if (excl && targets.length === 0) {
      eventExcluded.set(e.id, "機器が当たらない行（決定で外した）");
      continue;
    }
    const tkey = [...new Set(targets.map((t) => t.id))].sort().join(",");
    const wk = nameKey(e.workName);
    const k = `${e.tableId}|${wk}|${tkey}|${e.fiscalYear}`;
    let o = occMap.get(k);
    if (!o) {
      o = {
        id: `o:${k}`,
        tableId: e.tableId,
        file: e.file,
        sheet: e.sheet,
        workName: e.workName,
        fiscalYear: e.fiscalYear,
        workKey: wk,
        events: [],
        targets: [...new Map(targets.map((t) => [t.id, t])).values()],
        start: null,
        end: null,
        manDays: null,
        bundle: new Set(targets.map((t) => t.id)).size > 1,
        decidedBy: new Set(),
      };
      occMap.set(k, o);
    }
    o.events.push(e);
    for (const q of qids) o.decidedBy.add(q);
  }
  const occurrences = [...occMap.values()];
  for (const o of occurrences) {
    // 表示の名前は、行の中でいちばん多い書き方（比べるのは NFKC の形）
    const freq = new Map<string, number>();
    for (const e of o.events) freq.set(e.workName, (freq.get(e.workName) ?? 0) + 1);
    o.workName = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? o.workName;
    const dates = o.events.map((e) => (e.date ? ymd(e.date) : "")).filter(Boolean).sort();
    o.start = dates[0] ?? null;
    o.end = dates[dates.length - 1] ?? null;
    const md = o.events.map((e) => e.manDays).filter((x): x is number => x !== null);
    o.manDays = md.length ? Math.round(md.reduce((a, b) => a + b, 0) * 1000) / 1000 : null;
  }
  // ─── 作業のまとまり → 星取表の印 ───
  const markIndex = new Map<string, MarkRec[]>();
  for (const m of rec.marks) {
    if (m.excluded || m.pending || !m.assetId || m.planOrActual !== "actual") continue;
    const c = clusterOf.get(m.assetId);
    if (!c) continue;
    const k = `${c.id}|${m.fiscalYear}`;
    markIndex.set(k, [...(markIndex.get(k) ?? []), m]);
  }
  const occPer = new Map<string, number>();
  for (const o of occurrences) for (const t of o.targets) occPer.set(`${t.id}|${o.fiscalYear}`, (occPer.get(`${t.id}|${o.fiscalYear}`) ?? 0) + 1);
  const covered = (c: Cluster, fy: number) =>
    c.recs.some((r) => {
      if (r.shape !== "grid") return false;
      const yr = rec.gridYears.get(r.tableId);
      return !!yr && fy >= yr.from && fy <= yr.to;
    });
  type LP = { o: Occurrence; c: Cluster; m: MarkRec | null; pattern: string; options: MarkRec[] };
  const lps: LP[] = [];
  for (const o of occurrences)
    for (const c of o.targets) {
      const ms = markIndex.get(`${c.id}|${o.fiscalYear}`) ?? [];
      if (ms.length === 0) lps.push({ o, c, m: null, pattern: covered(c, o.fiscalYear) ? "noMark" : "uncovered", options: [] });
      else if (ms.length === 1) {
        const m = ms[0] ?? null;
        const multi = (occPer.get(`${c.id}|${o.fiscalYear}`) ?? 0) > 1;
        if (m?.workName && nameKey(m.workName) === nameKey(o.workName)) lps.push({ o, c, m, pattern: "named", options: ms });
        else if (m && !m.workName && !multi) lps.push({ o, c, m, pattern: "plain", options: ms });
        else lps.push({ o, c, m, pattern: "ambiguous", options: ms });
      } else lps.push({ o, c, m: null, pattern: "ambiguous", options: ms });
    }
  const links: WorkLink[] = [];
  const lgroups = new Map<string, LP[]>();
  for (const lp of lps) lgroups.set(`${lp.o.tableId}|${lp.pattern}`, [...(lgroups.get(`${lp.o.tableId}|${lp.pattern}`) ?? []), lp]);
  const lpItem = (lp: LP): QuestionItem => ({
    file: lp.o.file,
    sheet: lp.o.sheet,
    cells: lp.o.events.slice(0, 3).map((e) => e.refs[0] ?? ""),
    target: lp.options.map((m) => ({ file: m.file, sheet: m.sheet, cells: [m.ref] })),
    note: lp.c.name,
  });
  for (const [g, items] of lgroups) {
    const [tableId, pattern] = g.split("|") as [string, string];
    const fileName = items[0]?.o.file ?? "";
    const rows = items.reduce((a, x) => a + x.o.events.length, 0);
    if (pattern === "uncovered") {
      for (const lp of items) links.push({ occurrence: lp.o, cluster: lp.c, mode: "eventOnly", mark: null, decidedBy: new Set() });
      continue;
    }
    if (pattern === "ambiguous") {
      for (const lp of items) {
        const key = `workLinkOne|${lp.o.id}|${lp.c.id}`;
        const a = ask.ask(key, {
          kind: "workLinkOne",
          text: `${fileName} の作業「${lp.o.workName}」（${lp.c.name}、${lp.o.fiscalYear} 年度、${lp.o.events.length} 行）に当たる星取表の印が、ほかの作業の印と同じか、いくつかある。どうするか`,
          options: [
            ...lp.options.map((m, i) => ({ id: `m${i}`, label: `星取表の印「${m.symbol}」${m.workName ? `（${m.workName}）` : ""}も出どころにする（同じ作業）` })),
            { id: "eventOnly", label: "日報だけの記録にする" },
            { id: "exclude", label: "外す" },
          ],
          valueKind: "option",
          defaultAnswer: lp.options.length === 1 ? "m0" : null,
          sameShapeRows: lp.o.events.length,
          items: [lpItem(lp)],
        });
        const qid = questionIdOf(key);
        if (a?.startsWith("m")) links.push({ occurrence: lp.o, cluster: lp.c, mode: "mark", mark: lp.options[Number(a.slice(1))] ?? null, decidedBy: new Set([qid]) });
        else if (a === "eventOnly") links.push({ occurrence: lp.o, cluster: lp.c, mode: "eventOnly", mark: null, decidedBy: new Set([qid]) });
        else if (a === "exclude") links.push({ occurrence: lp.o, cluster: lp.c, mode: "excluded", mark: null, decidedBy: new Set([qid]) });
        else links.push({ occurrence: lp.o, cluster: lp.c, mode: "pending", mark: null, decidedBy: new Set() });
      }
      continue;
    }
    const label: Record<string, string> = {
      named: "同じ機器・同じ年度で、星取表の印の凡例の意味と作業の名前が同じ",
      plain: "同じ機器・同じ年度に、星取表の実績の印が 1 つと日報の作業が 1 つ",
      noMark: "星取表に、同じ機器・同じ年度の実績の印が無い",
    };
    const gkey = `workLink|${tableId}|${pattern}`;
    const isNoMark = pattern === "noMark";
    const a = ask.ask(gkey, {
      kind: "workLink",
      text: isNoMark
        ? `${fileName} の作業 ${items.length} 件（${rows} 行）は、${label[pattern]}。日報だけの記録として入れるか`
        : `${fileName} の作業 ${items.length} 件（${rows} 行）を、星取表の印と同じ作業として 1 つの記録に結ぶか。結び方：${label[pattern] ?? pattern}`,
      options: isNoMark
        ? [
            { id: "yes", label: "日報だけの記録として入れる" },
            { id: "exclude", label: "外す" },
          ]
        : YES_SPLIT,
      valueKind: "option",
      defaultAnswer: "yes",
      sameShapeRows: rows,
      items: items.map(lpItem),
    });
    const gq = questionIdOf(gkey);
    for (const lp of items) {
      if (isNoMark) {
        if (a === "yes") links.push({ occurrence: lp.o, cluster: lp.c, mode: "eventOnly", mark: null, decidedBy: new Set([gq]) });
        else if (a === "exclude") links.push({ occurrence: lp.o, cluster: lp.c, mode: "excluded", mark: null, decidedBy: new Set([gq]) });
        else links.push({ occurrence: lp.o, cluster: lp.c, mode: "pending", mark: null, decidedBy: new Set() });
        continue;
      }
      if (a === "yes") links.push({ occurrence: lp.o, cluster: lp.c, mode: "mark", mark: lp.m, decidedBy: new Set([gq]) });
      else if (a === "split") {
        const k1 = `workLinkOne|${lp.o.id}|${lp.c.id}`;
        const b = ask.ask(k1, {
          kind: "workLinkOne",
          text: `${fileName} の作業「${lp.o.workName}」（${lp.c.name}、${lp.o.fiscalYear} 年度、${lp.o.events.length} 行）は、星取表の印「${lp.m?.symbol ?? ""}」と同じ作業か`,
          options: [
            { id: "m0", label: "同じ作業（1 つの記録に結ぶ）" },
            { id: "eventOnly", label: "別の作業（日報だけの記録）" },
            { id: "exclude", label: "外す" },
          ],
          valueKind: "option",
          defaultAnswer: null,
          sameShapeRows: lp.o.events.length,
          items: [lpItem(lp)],
        });
        const q1 = questionIdOf(k1);
        if (b === "m0") links.push({ occurrence: lp.o, cluster: lp.c, mode: "mark", mark: lp.m, decidedBy: new Set([q1]) });
        else if (b === "eventOnly") links.push({ occurrence: lp.o, cluster: lp.c, mode: "eventOnly", mark: null, decidedBy: new Set([q1]) });
        else if (b === "exclude") links.push({ occurrence: lp.o, cluster: lp.c, mode: "excluded", mark: null, decidedBy: new Set([q1]) });
        else links.push({ occurrence: lp.o, cluster: lp.c, mode: "pending", mark: null, decidedBy: new Set() });
      } else links.push({ occurrence: lp.o, cluster: lp.c, mode: "pending", mark: null, decidedBy: new Set() });
    }
  }
  return { clusters, clusterOf, occurrences, links, eventPending, eventExcluded, assetExcluded };
}

export function seriesLabel(s: Series | null): string {
  if (!s) return "";
  if (s.kind === "number") return `・${s.n} 号`;
  const m = cue.commonMeanings.find((x) => x.id === s.meaning);
  return `・共通${m ? `（${m.label}）` : ""}`;
}
