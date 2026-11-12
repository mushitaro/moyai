// 層 3 意味づけ（2）：資料をまたいで同じ機器・同じ作業を結ぶ。
// 機器は同一性の鍵が同じときだけ同じ（plan §2.1）。資料ごとに鍵が違うので、結ぶ案を同じ形ごとにまとめて聞き、
// 人（か AI）が受けたものだけを結ぶ。結べるか決まらないものは質問に回す。
import { nfkc } from "./era";
import { cue } from "./cues";
import { Asker, questionIdOf, type QuestionItem, YES_SPLIT } from "./questions";
import { filesLabel, type AssetRec, type EventRec, type MarkRec, type Records, type Series } from "./records";
import { nameKey, parseUnit, splitTag } from "./text";
import type { ActiveRule, RuleHits } from "./reading";

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
  /**
   * 資料をまたいで結ぶかが決まっていない（結ぶ問いに答えが無い、または先の資料の決まっていない機器と同じ名前で、その決定を待つ）。
   * 読みは決まっているので、その資料だけで読んだときと同じに節として持つ（セルは行き先を持つ）。問いが残るので計画は作らない。
   * 名前の同じ後の資料の機器と日報の行は、これが決まるまで結ばない
   */
  held?: true;
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
  /** 日数（工期の日数の欄。期間の行だけ） */
  days: number | null;
  /** 期間（「始まり〜終わり」）の 1 行でできたまとまり */
  period: boolean;
  bundle: boolean;
  decidedBy: Set<string>;
}

/** 1 つの機器の上の 1 回の作業。資料をまたいで同じ作業と決めたまとまりを、資料ごとに 1 つまで持つ */
export interface Job {
  id: string;
  cluster: Cluster;
  fiscalYear: number;
  /** 資料の名前の順。先頭が作業の名前の代表 */
  units: Occurrence[];
  decidedBy: Set<string>;
  /** 結ぶかどうかの答えを待っている */
  pending: boolean;
  /** 待っている質問（pending で、分かるときだけ。画面の写しに使う） */
  waitingOn?: string;
}

export type LinkMode = "mark" | "eventOnly" | "excluded" | "pending";

export interface WorkLink {
  job: Job;
  cluster: Cluster;
  mode: LinkMode;
  mark: MarkRec | null;
  decidedBy: Set<string>;
  /** 待っている質問（mode が pending で、分かるときだけ。画面の写しに使う） */
  waitingOn?: string;
}

export interface Linked {
  clusters: Cluster[];
  clusterOf: Map<string, Cluster>;
  occurrences: Occurrence[];
  jobs: Job[];
  links: WorkLink[];
  /** 日報の行で、機器が決まらない・外したもの */
  eventPending: Set<string>;
  /** 機器の決まらない日報の行 → その行が待つ質問の ID（分かるときだけ。未解決のセルに付ける） */
  eventWaitingOn: Map<string, string>;
  eventExcluded: Map<string, string>;
  /** 日報の行を外した決定の質問（行の ID → 質問の ID。画面の写しに使う） */
  eventExcludedBy: Map<string, string[]>;
  assetExcluded: Map<string, string>;
  /** 機器を外した決定の質問（機器の記録の ID → 質問の ID。画面の写しに使う） */
  assetExcludedBy: Map<string, string>;
  /** 結ぶ答えを待っている機器の記録（ID → 待っている質問の ID。画面の写しに使う） */
  assetWaitingOn: Map<string, string>;
}

const numberOf = (c: { series: Series | null; tagNumber: number | null }): number | null =>
  c.series?.kind === "number" ? c.series.n : c.tagNumber;

/** 号炉・系列の数がどちらにも書いてあって、違う（機器番号の末尾の数は見ない） */
const seriesDiffer = (a: { series: Series | null }, b: { series: Series | null }): boolean =>
  a.series?.kind === "number" && b.series?.kind === "number" && a.series.n !== b.series.n;

/**
 * 機器が結ばれうる鍵：名前（名前の中の機器番号を分けた名前も）と機器番号。決まっていない機器の名前は、決定（番号を分ける・段・号）で
 * 変わりうるので、元の書き方と分けた形の両方を鍵にする。結ぶ相手は名前か機器番号が同じものだけなので、鍵の重ならない機器は待たせない
 */
function matchKeys(names: readonly string[], tag: string | null): string[] {
  const ks = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    ks.add(`n:${nk(n)}`);
    const sp = splitTag(n);
    if (sp) {
      ks.add(`n:${nk(sp.name)}`);
      ks.add(`t:${nk(sp.tag)}`);
    }
  }
  if (tag) ks.add(`t:${nk(tag)}`);
  ks.delete("n:");
  ks.delete("t:");
  return [...ks];
}
const recKeys = (r: AssetRec): string[] => matchKeys([r.name, r.rawName], r.tag);

/**
 * 候補の機器の選択肢の文。名前と番号だけでは同じ文になることがある（番号の無い台帳で、系列ごとに同じ名前の機器）ので、
 * 見分けに使える系列・仕様の最初の行・出どころのセルを添える（人が台帳を見なくても選べるように）。
 */
function candidateLabel(c: Cluster): string {
  const head = `${c.name}${c.tag ? `（${c.tag}）` : ""}`;
  const r = c.recs[0];
  const parts: string[] = [];
  if (c.series) parts.push(c.series.kind === "number" ? `系列 ${c.series.n}` : `共通${c.series.meaning ? `（${c.series.meaning}）` : ""}`);
  const spec = r?.specs.find((s) => s.value.trim() !== "")?.value.split(/\r?\n/).find((x) => x.trim() !== "");
  if (spec) parts.push(spec.trim().slice(0, 30));
  if (r) parts.push(`${r.file}${r.sheet ? ` ${r.sheet}` : ""} ${r.nameRef}`);
  return parts.length ? `${head}：${parts.join("・")}` : head;
}

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

/** 読み方の規則の同じ機器（辞書）：名前の鍵 → そろえる先の名前の鍵。link を呼ぶたびに入れ直す */
let ALIAS = new Map<string, string>();
/** Skillパックの呼び名の辞書：書き方 → そろえる先（名前の鍵の中の語を置き換える）。link を呼ぶたびに入れ直す */
let TERMS: { re: RegExp; to: Map<string, string> } | null = null;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function setTerms(groups: readonly { forms: readonly string[] }[]): void {
  const to = new Map<string, string>();
  for (const g of groups) {
    const head = nameKey(g.forms[0] ?? "");
    for (const f of g.forms.slice(1)) {
      const k = nameKey(f);
      if (k && k !== head && !to.has(k)) to.set(k, head);
    }
  }
  if (!to.size) {
    TERMS = null;
    return;
  }
  // 長い書き方から先に当てる。英字だけの書き方（略）は、前後が英字でないときだけ
  const alts = [...to.keys()].sort((a, b) => b.length - a.length).map((k) => (/^[A-Za-z]+$/.test(k) ? `(?<![A-Za-z])${escapeRe(k)}(?![A-Za-z])` : escapeRe(k)));
  TERMS = { re: new RegExp(alts.join("|"), "gu"), to };
}
export const nk = (s: string): string => {
  let k = nameKey(s);
  // 規則どうしがつながる（A→B と B→C）ときは、たどった先にそろえる（輪になっても止まる）
  for (let i = 0; i < 20 && ALIAS.has(k); i++) k = ALIAS.get(k) as string;
  return k;
};
/** 作業の記録の名前から機器を引くときの鍵：名前の鍵に、Skillパックの呼び名の辞書を当てた形（台帳と星取表の機器どうしの結びには使わない） */
const ek = (s: string): string => {
  const k = nk(s);
  return TERMS ? k.replace(TERMS.re, (m) => TERMS?.to.get(m) ?? m) : k;
};

export function link(rec: Records, ask: Asker, rules: readonly ActiveRule[] = [], hits: RuleHits | null = null, names: readonly { forms: readonly string[] }[] = []): Linked {
  ALIAS = new Map();
  setTerms(names);
  // 同じ機器の呼び名の並び：どの名前も、並びの最後の名前と同じ機器として読む
  for (const a of rules) {
    if (a.rule.kind !== "sameAsset") continue;
    const to = nameKey(a.rule.names[a.rule.names.length - 1] ?? "");
    for (const n of a.rule.names.slice(0, -1)) if (nameKey(n) !== to) ALIAS.set(nameKey(n), to);
  }
  // 規則が効いた資産と行を数える（「読み方」のタブの効いたセル）：並びの最後でない名前を書いた所
  for (const a of rules) {
    if (a.rule.kind !== "sameAsset") continue;
    const ks = new Set(a.rule.names.slice(0, -1).map((n) => nameKey(n)));
    for (const x of rec.assets) if (ks.has(nameKey(x.name))) hits?.add(a.rule, x.file, x.nameRef);
    for (const e of rec.events) if (e.assetNames.some((n) => ks.has(nameKey(n)))) hits?.add(a.rule, e.file, e.refs[0] ?? "");
  }
  // ─── 機器 ───
  const parentOf = new Map<string, string | null>();
  const clusterOf = new Map<string, Cluster>();
  const clusters: Cluster[] = [];
  const assetExcluded = new Map<string, string>();
  const assetExcludedBy = new Map<string, string>();
  const assetWaitingOn = new Map<string, string>();
  /** 「この資料だけの機器か」に答えの無い機器 → その問い（機器のセルは待たせず、その機器の作業の行だけが待つ） */
  const heldUnmatchedQ = new Map<string, string>();
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
  // 結ぶかが決まっていない機器（held）。先の資料の決まっていない機器と、結ぶかの決まっていない機器の鍵（waitKeys）
  const held = new Set<string>();
  const waitKeys = new Set<string>();
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
      for (const r of recs) if (r.pending && !r.excluded) for (const k of recKeys(r)) waitKeys.add(k);
      continue;
    }
    // 先の資料の機器に決まっていないもの（名前の分け方・段など）があれば、それと名前か機器番号が同じ機器だけ、結ぶ案をその決定のあとに作る。
    // 鍵の重ならない機器は待たせない（ほかの資料の決まっていない行で、この資料の読みを止めない）。親が待つ機器も待つ
    const waits = new Set<string>();
    for (const r of recs) {
      if (r.pending || r.excluded) continue;
      if ((r.parentId && waits.has(r.parentId)) || recKeys(r).some((k) => waitKeys.has(k))) waits.add(r.id);
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
      if (waits.has(r.id)) {
        held.add(r.id);
        props.push({ r, cand: null, pattern: "skip", options: [] });
        continue;
      }
      const key = nk(r.name);
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
      // 号炉・系列の数がどちらにも書いてあって違う機器（「1号炉 給水ポンプ」と「2号炉 給水ポンプ」）は、名前が同じでも別の機器。候補にしない
      let cands = pool.filter((c) => nk(c.name) === key && !seriesDiffer(r, c));
      // 号の書いてある機器で、同じ段に同じ名前が無い：どの段でも、名前も号の数も同じ機器がただ 1 つなら候補にする
      // （平たい一覧の「誘引送風機（1号炉）」と、星取表の設備の下の「誘引送風機」の #1 の行。親の段の書き方が資料で違う）
      // 見るのは号炉・系列の号の数だけ（機器番号の末尾の数は見ない。台帳の「名前（ZQ-1）」を、別の段の 1 号の機器と結ばない）
      const seriesN = (x: { series: Series | null }) => (x.series?.kind === "number" ? x.series.n : null);
      if (!cands.length && seriesN(r) !== null) {
        const wide = clusters.filter((c) => c.recs.some((x) => done.has(x.tableId)) && nk(c.name) === key && seriesN(c) === seriesN(r));
        if (wide.length === 1) {
          cands = wide;
          scope = "global:";
        }
      }
      const sibs = recs.filter((x) => x.parentId === r.parentId && nk(x.name) === key && !x.pending && !x.excluded);
      const n = numberOf(r);
      let cand: Cluster | null = null;
      let pattern: string;
      if (cands.length === 0) pattern = "none";
      else if (cands.length === 1 && sibs.length === 1) {
        cand = cands[0] ?? null;
        const cn = cand ? numberOf(cand) : null;
        pattern = n !== null && cn !== null && n !== cn ? `${scope}uniqueNumberDiffers` : `${scope}unique`;
      } else {
        // 号炉が同じものがいくつかあれば、号機（機器番号）でも見分ける（「1号炉 No.1」と「1号炉 No.2」）
        const sameNum = n === null ? [] : cands.filter((c) => numberOf(c) === n);
        const byNum = sameNum.length > 1 && r.tag ? sameNum.filter((c) => !!c.tag && nk(c.tag) === nk(r.tag as string)) : sameNum;
        // 号の数で決まらず、同じ名前がいくつかあるとき：号機（機器番号）が同じものがただ 1 つ（「No.1 減温塔噴霧P」と「No.2 減温塔噴霧P」）
        const byMachine = byNum.length !== 1 && r.tag ? cands.filter((c) => !!c.tag && nk(c.tag) === nk(r.tag as string) && (n === null || numberOf(c) === n)) : [];
        if (byNum.length === 1) {
          cand = byNum[0] ?? null;
          pattern = `${scope}byNumber`;
        } else if (byMachine.length === 1) {
          cand = byMachine[0] ?? null;
          pattern = `${scope}byMachine`;
        } else if (cands.length < sibs.length) pattern = `${scope}fewer`;
        else pattern = "ambiguous";
      }
      // 名前と親で 1 つに決まらないとき：機器番号が同じ機器がただ 1 つあれば、それを案にする（段や親の書き方が資料で違っても、番号は同じ機器を指す）
      let options = cands;
      if (!cand && r.tag) {
        const tk = nk(r.tag);
        const byTag = clusters.filter((c) => !!c.tag && nk(c.tag) === tk && !seriesDiffer(r, c) && c.recs.some((x) => done.has(x.tableId)));
        if (byTag.length === 1 && byTag[0]) {
          cand = byTag[0];
          pattern = nk(cand.name) === key ? "tagName" : "tagOnly";
          options = [cand];
        }
      }
      proposed.set(r.id, cand);
      props.push({ r, cand, pattern, options });
    }
    // 形ごとにまとめて聞く
    const groups = new Map<string, Prop[]>();
    for (const p of props) if (p.pattern !== "skip") groups.set(p.pattern, [...(groups.get(p.pattern) ?? []), p]);
    const tableFile = recs[0]?.file ?? "";
    // 同じ様式の表（頁ごと・資料ごとに同じ見出しの表）の、同じ結び方の問いは 1 問にまとめる（答えは様式の全部の表に当たる）
    const fg = rec.formOf.get(tid);
    const form = fg && fg.tables.length > 1 ? fg : null;
    const accepted = new Map<string, { c: Cluster; qid: string }>();
    const unmatched: Prop[] = [];
    for (const [pattern, ps] of groups) {
      if (pattern === "none") {
        unmatched.push(...ps);
        continue;
      }
      // この資料には同じ親の下に同じ名前の機器がいくつもあり、先の資料には、それより少ない数しか無い（先の資料の 1 行が何台かをまとめた行のとき）。
      // 1 つに結ぶと、この資料で別の行の機器が 1 つになる。別の機器として入れるのを推す（様式ごとに 1 問。決めるのは人。「1 件ずつ決める」なら下の問い）
      let one = ps;
      if (pattern.replace(/^global:/, "") === "fewer") {
        const fkey = `assetLink|${tid}|${pattern}`;
        const fewerText = (where: string, n: number) =>
          `${where} の機器 ${n} 件は、同じ親の下に同じ名前の機器がいくつもあり、先の資料の同じ名前の機器はそれより少ない（先の資料の行は、何台かをまとめた行かもしれない）。結ばずに、別の機器として入れるか`;
        const a = ask.ask(
          fkey,
          {
            kind: "assetLink",
            text: fewerText(tableFile, ps.length),
            options: [
              { id: "none", label: "結ばずに、別の機器として入れる" },
              { id: "split", label: "1 件ずつ決める" },
            ],
            valueKind: "option",
            defaultAnswer: "none",
            sameShapeRows: ps.length,
            items: ps.map((p) => itemOfRec(p.r, p.options[0])),
          },
          form ? { key: `assetLink|${form.key}|${pattern}`, text: (n) => fewerText(filesLabel(form.files), n), always: true } : undefined,
        );
        if (a === "none") {
          unmatched.push(...ps.map((p) => ({ ...p, cand: null })));
          continue;
        }
        if (a !== "split") {
          for (const p of ps) {
            held.add(p.r.id);
            assetWaitingOn.set(p.r.id, questionIdOf(fkey));
          }
          continue;
        }
      } else if (pattern !== "ambiguous") one = [];
      if (one.length) {
        for (const p of one) {
          const key = `assetLinkOne|${tid}|${p.r.id}`;
          const a = ask.ask(key, {
            kind: "assetLinkOne",
            text: `「${p.r.name}」に当たる機器が先の資料に ${p.options.length} つある。どれと同じ機器か`,
            options: [...p.options.map((c, i) => ({ id: `c${i}`, label: candidateLabel(c) })), { id: "none", label: "どれとも違う（別の機器）" }],
            valueKind: "option",
            defaultAnswer: null,
            sameShapeRows: 1,
            // 候補ごとに 1 つ（i 番目が選択肢 c{i}）：この行と、その候補の出どころのセル
            items: p.options.map((c) => itemOfRec(p.r, c)),
          });
          if (a && a.startsWith("c")) {
            const c = p.options[Number(a.slice(1))];
            if (c) accepted.set(p.r.id, { c, qid: questionIdOf(key) });
          } else if (a === "none") unmatched.push({ ...p, cand: null });
          else {
            held.add(p.r.id);
            assetWaitingOn.set(p.r.id, questionIdOf(key));
          }
        }
        continue;
      }
      const label: Record<string, string> = {
        unique: "名前が同じで、同じ親の下にどちらも 1 つずつ",
        uniqueNumberDiffers: "名前が同じで 1 つずつだが、号の数と機器番号の数が違う",
        byNumber: "名前が同じものがいくつかあり、号の数と機器番号の末尾の数が同じ",
        byMachine: "名前が同じものがいくつかあり、号機（機器番号）が同じ",
        tagName: "機器番号と名前が同じ（階層や親の書き方は資料で違う）",
        tagOnly: "機器番号が同じ（名前の書き方は違う）",
      };
      const base = pattern.replace(/^global:/, "");
      const scopeNote = pattern.startsWith("global:") ? "（親どうしは結んでいない。名前と階層だけで当てた）" : "";
      const gkey = `assetLink|${tid}|${pattern}`;
      const linkText = (where: string, n: number) => `${where} の機器 ${n} 件を、先の資料の機器と同じものとして結ぶか。結び方：${label[base] ?? base}${scopeNote}`;
      const a = ask.ask(gkey, {
        kind: "assetLink",
        text: linkText(tableFile, ps.length),
        options: YES_SPLIT,
        valueKind: "option",
        defaultAnswer: base === "uniqueNumberDiffers" || base === "tagOnly" ? "split" : "yes",
        sameShapeRows: ps.length,
        items: ps.map((p) => itemOfRec(p.r, p.cand ?? undefined)),
      }, form ? { key: `assetLink|${form.key}|${pattern}`, text: (n) => linkText(filesLabel(form.files), n), always: true } : undefined);
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
          else {
            held.add(p.r.id);
            assetWaitingOn.set(p.r.id, questionIdOf(k1));
          }
        } else {
          held.add(p.r.id);
          assetWaitingOn.set(p.r.id, questionIdOf(gkey));
        }
      }
    }
    // 先の資料に無い機器
    if (unmatched.length) {
      const ukey = `assetUnmatched|${tid}`;
      const unmatchedText = (where: string, n: number) => `${where} の機器 ${n} 件は、先の資料に同じ名前の機器が無い。この資料だけの機器として入れるか`;
      const a = ask.ask(ukey, {
        kind: "assetUnmatched",
        text: unmatchedText(tableFile, unmatched.length),
        options: [
          { id: "yes", label: "この資料だけの機器として入れる" },
          { id: "exclude", label: "外す" },
        ],
        valueKind: "option",
        defaultAnswer: "yes",
        sameShapeRows: unmatched.length,
        items: unmatched.map((p) => itemOfRec(p.r)),
      }, form ? { key: `assetUnmatched|${form.key}`, text: (n) => unmatchedText(filesLabel(form.files), n), always: true } : undefined);
      for (const p of unmatched) {
        if (a === "exclude") {
          p.r.excluded = "先の資料に無い機器（決定で外した）";
          assetExcluded.set(p.r.id, p.r.excluded);
          assetExcludedBy.set(p.r.id, questionIdOf(ukey));
        } else if (a !== "yes") {
          // 「この資料だけの機器か」に答えが無い機器は、1 冊のときと同じに読んだまま持つ（セルはデータのまま。問いを待つセルにしない。
          // 資料を混ぜると後の資料が全部未確定になった 375t の形を戻さない。intake-many-v1）
          held.add(p.r.id);
          // 機器のセルはデータのまま。その機器の作業の行だけ、この問いを待つ（質問の無い未解決にしない）
          heldUnmatchedQ.set(p.r.id, questionIdOf(ukey));
        }
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
        else if (held.has(r.id)) c.held = true;
      }
    }
    for (const r of recs) {
      const c = clusterOf.get(r.id);
      if (!c || c.recs[0] !== r) continue;
      // この表で新しくできた節の親：この表の親の行の節
      c.parent = r.parentId ? (clusterOf.get(r.parentId) ?? null) : null;
    }
    done.add(tid);
    // 後の資料は、この表の決まっていない機器・結ぶかの決まっていない機器と同じ名前か機器番号のものだけ待つ
    for (const r of recs) if (!r.excluded && (r.pending || held.has(r.id))) for (const k of recKeys(r)) waitKeys.add(k);
  }
  for (const c of clusters) {
    if (c.recs.some((r) => r.pending)) c.pending = true;
    if (c.recs.every((r) => r.excluded)) c.excluded = c.recs[0]?.excluded ?? "外した";
  }

  // ─── 日報の行 → 機器 ───
  const eventPending = new Set<string>();
  /** 機器の決まらない日報の行 → その行が待つ質問の ID（分かるときだけ） */
  const eventWaitingOn = new Map<string, string>();
  const eventExcluded = new Map<string, string>();
  const eventExcludedBy = new Map<string, string[]>();
  const byName = new Map<string, Cluster[]>();
  // 呼び名の辞書を当てた鍵でも引く（名前の鍵で当たらないときだけ）
  const byTerm = new Map<string, Cluster[]>();
  const lookName = (s: string): Cluster[] | undefined => byName.get(nk(s)) ?? byTerm.get(ek(s));
  // 機器番号（同一性の鍵）でも引く：日報や報告書が「名前（機器番号）」と書く機器
  const byTag = new Map<string, Cluster[]>();
  // 決まっていない機器（読みの決まらない機器と、結ぶかの決まらない機器）は引く先にしない。その鍵に当たる行は、決まるまで待つ
  // 鍵 → その機器が待つ結ぶかの質問（分かるときだけ。待つ日報の行の未解決のセルに付ける）
  const heldKeys = new Map<string, string | null>();
  let heldQ: string | null = null;
  for (const c of clusters)
    if (!c.excluded && (c.pending || c.held))
      for (const r of c.recs) {
        const q = assetWaitingOn.get(r.id) ?? null;
        heldQ ??= q;
        for (const k of recKeys(r)) if (!heldKeys.get(k)) heldKeys.set(k, q);
      }
  const unsettled = heldKeys.size > 0 || clusters.some((c) => !c.excluded && (c.pending || c.held));
  for (const c of clusters) {
    if (c.excluded || c.pending || c.held) continue;
    // 資料をまたいで結んだ機器は、どの資料の名前でも引く（台帳の「1号炉ストーカ」と星取表の「ストーカ」）
    for (const k of new Set([c.name, ...c.recs.map((r) => r.name)].map(nk))) byName.set(k, [...(byName.get(k) ?? []), c]);
    for (const k of new Set([c.name, ...c.recs.map((r) => r.name)].map(ek))) byTerm.set(k, [...(byTerm.get(k) ?? []), c]);
    if (c.tag) byTag.set(nk(c.tag), [...(byTag.get(nk(c.tag)) ?? []), c]);
  }
  // 機器番号の列から引いた名前（「名前（番号）」の形にしたもの）→ その番号。番号の書き方（「1-STK」のように数で始まるもの）が
  // 名前の中の番号の形に合わなくても、列に書いた番号なので番号として引く
  const fromTagCol = new Map<string, { name: string; tag: string }>();
  const tagged = (nm: string) => {
    const col = fromTagCol.get(nk(nm));
    if (col) return col;
    const sp = splitTag(nm);
    return sp && byTag.has(nk(sp.tag)) ? sp : null;
  };
  // 名前の同じ機器が無い作業の行の名前を、号機と機器と部位に分けて引く（どの業種にも当たる書き方だけ。業種の語は読み方の規則・Skillパックの辞書）
  const kids = new Map<Cluster, Cluster[]>();
  for (const c of clusters) if (c.parent && !c.excluded && !c.pending && !c.held) kids.set(c.parent, [...(kids.get(c.parent) ?? []), c]);
  const below = (c: Cluster): Cluster[] => {
    const out: Cluster[] = [];
    const walk = (x: Cluster, depth: number) => {
      if (depth > 12) return;
      for (const k of kids.get(x) ?? []) {
        out.push(k);
        walk(k, depth + 1);
      }
    };
    walk(c, 0);
    return out;
  };
  /** 号機の書き方（No.1・#1・1号機・(1)）の数。号機でなければ null */
  const machineNo = (t: string): number | null => {
    const paren = /^[(（]\s*(\d+)\s*[)）]$/u.exec(nfkc(t).trim());
    if (paren) return Number(paren[1]);
    const u = parseUnit(t);
    return u?.kind === "number" ? u.n : null;
  };
  const machineOf = (c: Cluster): number | null => machineNo(c.name) ?? numberOf(c);
  /**
   * 名前を空白で区切り、号機の書き方を外して、「機器」か「機器 … 部位」として引く。号機の数があれば、機器の下の同じ数の機器（号の数か号機の名前）に絞る。
   * 号炉の欄の号（unitN）は頭の機器に当てる。当たらなければ空（推し量らない。いつもの問いになる）
   */
  const byParts = (nm: string, unitN: number | null): Cluster[] => {
    const toks = nfkc(nm).trim().split(/\s+/u).filter(Boolean);
    const nos = toks.map(machineNo);
    const rest = toks.filter((_, i) => nos[i] === null);
    const no = nos.find((x) => x !== null) ?? null;
    if (!rest.length || (rest.length === toks.length && rest.length < 2)) return [];
    const unitOk = (c: Cluster) => unitN === null || numberOf(c) === unitN || numberOf(c) === null;
    let heads = (lookName(rest.join(" ")) ?? lookName(rest.join("")) ?? []).filter(unitOk);
    let part: string | null = null;
    if (!heads.length && rest.length >= 2) {
      heads = (lookName(rest[0] ?? "") ?? []).filter(unitOk);
      part = rest.slice(1).join(" ");
    }
    if (!heads.length) return [];
    if (no !== null) {
      const m = [...new Set(heads.flatMap((h) => [h, ...below(h)]).filter((x) => machineOf(x) === no))];
      if (m.length) heads = m;
      else if (part === null) return [];
    }
    if (part === null) return heads;
    const pk = ek(part);
    return [...new Set(heads.flatMap(below).filter((x) => ek(x.name) === pk))];
  };
  type Case = { key: string; tableId: string; name: string; unitKey: string; cands: Cluster[]; events: EventRec[]; pattern: string };
  const cases = new Map<string, Case>();
  const eventNames = new Map<string, { names: string[]; unitKey: string }>();
  /** 機器の名前も機器番号も無い作業の行（表ごと）。あとで様式ごとに 1 回聞く */
  const noAsset = new Map<string, EventRec[]>();
  for (const e of rec.events) {
    // 同じ記録の名前の欄から作った機器のある行（PDF の折り返した記録）は、名前で引かない（下でその機器に当てる）
    if (e.excluded || e.pending || e.effortPending || e.assetId !== undefined) continue;
    const whole = e.assetNames[0] ?? "";
    if (!whole && !e.tag) {
      noAsset.set(e.tableId, [...(noAsset.get(e.tableId) ?? []), e]);
      continue;
    }
    // 並べた機器（「A・B・C（一式）」）：分けたどれもが機器の名前か機器番号で引ければ分ける。
    // 引けないときは、全体が 1 つの機器の名前なら分けない（名前に「・」を含む機器）
    let names = [whole];
    const known = (nm: string) => byName.has(nk(nm)) || !!tagged(nm);
    // 「まとまりの名前（A・B・C）」：括弧の中に並べた名前を、まとめた機器の名前として読む（括弧の前はまとまりの名前）
    const inParen = /^(.*?)[(（]([^()（）]+)[)）]\s*$/u.exec(nfkc(whole));
    const listed = inParen && cue.listSeparators.some((sep) => (inParen[2] ?? "").includes(sep)) && !known(whole) ? (inParen[2] ?? "") : whole;
    for (const sep of cue.listSeparators) {
      const parts = nfkc(listed).split(sep).map((x) => x.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      // 分けたどれもが機器なら分ける。全体が機器でなく、分けたうちの 1 つでも機器なら分ける。どれも機器でなければ、
      // 名前に「・」を含む 1 つの機器かもしれないので分けない（括弧の中の並びは、まとめた機器なので分ける）
      if (parts.every(known) || (!known(listed) && (parts.some(known) || listed !== whole))) {
        names = parts;
        break;
      }
    }
    // 機器番号の列に、どれかの機器の番号を書いた行：「名前（番号）」と同じに番号で引く（番号は同一性の鍵）
    if (names.length === 1 && e.tag && byTag.has(nk(e.tag)) && !tagged(whole)) {
      names = [`${whole}（${e.tag}）`];
      fromTagCol.set(nk(names[0] ?? ""), { name: whole, tag: e.tag });
    }
    // 決まっていない機器の名前か機器番号に当たる行と、決まっていない機器があるあいだに当たる機器の無い行は、その決定のあとに当てる
    // （先の答えで当てる先が変わるため）。決まった機器だけに当たる行は待たせない
    if (unsettled) {
      const heldHit = matchKeys([whole, listed, ...names], e.tag).filter((k) => heldKeys.has(k));
      if (heldHit.length) {
        eventPending.add(e.id);
        const q = heldHit.map((k) => heldKeys.get(k)).find((x) => !!x) ?? heldQ;
        if (q) eventWaitingOn.set(e.id, q);
        continue;
      }
      const hit = (nm: string) => {
        const sp = tagged(nm);
        return ((sp ? byTag.get(nk(sp.tag)) : byName.get(nk(nm))) ?? []).length > 0;
      };
      if (!names.every(hit)) {
        // 当たる機器が無い行は、決まっていない機器が決まるのを待つ（待つ質問は、その機器の結ぶかの質問）
        eventPending.add(e.id);
        if (heldQ) eventWaitingOn.set(e.id, heldQ);
        continue;
      }
    }
    const unitKey = !e.unit ? "-" : e.unit.kind === "number" ? `n${e.unit.n}` : e.unit.kind === "common" ? "common" : "ditto";
    eventNames.set(e.id, { names, unitKey });
    for (const nm of names) {
      const k = `${e.tableId}|${nk(nm)}|${unitKey}`;
      let cs = cases.get(k);
      if (!cs) {
        const sp = tagged(nm);
        let cands: Cluster[];
        let pattern: string;
        if (sp) {
          // 名前の中の機器番号が、どれか 1 つの機器の番号と同じ（番号は同一性の鍵。号の欄は見ない）
          cands = byTag.get(nk(sp.tag)) ?? [];
          const c0 = cands[0];
          pattern = cands.length === 1 && c0 ? (nk(c0.name) === nk(sp.name) ? "tagName" : "tagOnly") : "ambiguous";
        } else {
          cands = lookName(nm) ?? [];
          if (unitKey.startsWith("n")) cands = cands.filter((c) => numberOf(c) === Number(unitKey.slice(1)));
          else if (unitKey === "common") cands = cands.filter((c) => c.series?.kind === "common" || numberOf(c) === null);
          pattern = cands.length === 1 ? (unitKey === "-" ? "nameOnly" : "nameUnit") : "ambiguous";
          if (!cands.length && !(lookName(nm) ?? []).length) {
            const p = byParts(nm, unitKey.startsWith("n") ? Number(unitKey.slice(1)) : null);
            if (p.length) {
              cands = p;
              pattern = p.length === 1 ? "nameParts" : "ambiguous";
            }
          }
        }
        cs = { key: k, tableId: e.tableId, name: nm, unitKey, cands, events: [], pattern };
        cases.set(k, cs);
      }
      cs.events.push(e);
    }
  }
  /** wait：答えの無いとき、その名前の行が待つ質問の ID（未解決のセルに付ける） */
  const resolved = new Map<string, { c: Cluster | null; qid: string | null; excluded: boolean; wait?: string; why?: string }>();
  // 同じ様式の表（同じ様式の帳票を何冊も入れたとき）は、同じ形の問いをまとめて聞く
  const formKey = (tableId: string) => rec.formOf.get(tableId)?.key ?? tableId;
  // 機器の名前も機器番号も無い作業の行：機器に当てられない。推し量らず、同じ資料・同じ様式の表をまとめて 1 回聞く（答えるまで、その行はこの問いを待つ未解決）
  for (const [tableId, evs] of noAsset) {
    const key = `eventNoAsset|${tableId}`;
    const text = (rows: number) => `機器の名前も機器番号も書いていない作業の行がある（${rows} 行）。機器に当てられない`;
    const a = ask.ask(
      key,
      {
        kind: "eventAsset",
        text: text(evs.length),
        options: [{ id: "exclude", label: "その行を外す（理由を残す）" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: evs.length,
        items: [{ file: evs[0]?.file ?? "", sheet: evs[0]?.sheet ?? null, cells: evs.slice(0, 10).map((e) => e.refs[0] ?? "") }],
      },
      // 答えは「外す」だけ：同じ資料の表（PDF の頁ごとの表）と、同じ様式の表をまとめて 1 問
      { key: `eventNoAsset|${(rec.formOf.get(tableId)?.tables.length ?? 1) > 1 ? formKey(tableId) : `file:${evs[0]?.file ?? ""}`}|-`, text },
    );
    for (const e of evs)
      if (a === "exclude") {
        eventExcluded.set(e.id, "機器の名前も機器番号も無い行（決定で外した）");
        eventExcludedBy.set(e.id, [questionIdOf(key)]);
      } else {
        eventPending.add(e.id);
        eventWaitingOn.set(e.id, questionIdOf(key));
      }
  }
  const caseGroups = new Map<string, Case[]>();
  // 台帳も星取表も無い（機器の記録が 1 つも無い）組：日報・報告書の機器の名前は、どれも当てる先が無い。様式ごとにまとめて聞く
  const noAssets = !clusters.some((c) => !c.excluded);
  for (const cs of cases.values()) {
    // 当てる先の名前が 1 つも無い名前（台帳にも星取表にも無い機器）は、様式ごとに 1 問にまとめる（機器の記録があれば「1 件ずつ選ぶ」も選べる）
    const g = `${formKey(cs.tableId)}|${cs.cands.length === 0 ? "none" : cs.pattern}`;
    caseGroups.set(g, [...(caseGroups.get(g) ?? []), cs]);
  }
  /** 1 件ずつ聞く質問にしてよい名前の数の上限（越えれば「1 件ずつ聞く」を出さない。Architect の 64） */
  const SPLIT_MAX = 30;
  const unitLabel = (u: string) => (u === "-" ? "号の欄が空" : u === "common" ? "共通" : `${u.slice(1)} 号`);
  // 資料の名前のまま作った機器：同じ名前と号は、頁・表・様式をまたいで 1 つ
  const made = new Map<string, Cluster>();
  for (const [g, css] of caseGroups) {
    const [tableId, pattern] = g.split("|") as [string, string];
    const ev0 = css[0]?.events[0];
    const fileName = filesLabel([...new Set(css.flatMap((c) => c.events.map((e) => e.file)))].sort()) || (ev0?.file ?? "");
    const rows = css.reduce((a, c) => a + c.events.length, 0);
    // 当てる先の機器が無い：資料の名前のまま、名前と号ごとに新しい機器にするか（推し量らず人が決める。1 つずつ決めるなら下の問い）
    let one = pattern === "ambiguous";
    // まとめた工事の行：作業の欄が一式の印だけ（括弧の書き添えを除く。「一式（内訳は各行）」）で、名前の同じ機器も無い行。
    // 内訳はほかの行にあるので、作業にせず記録に残すのを推す（様式ごとに 1 問。決めるのは人。「1 件ずつ選ぶ」なら下の問い）
    let rest = css;
    if (one || pattern === "none") {
      const lumps = css.filter((cs) => cs.cands.length === 0 && cs.events.every((e) => lumpWork(e.workName)));
      if (lumps.length) {
        const lkey = `eventLump|${tableId}`;
        const lrows = lumps.reduce((a, c) => a + c.events.length, 0);
        const a = ask.ask(lkey, {
          kind: "eventAsset",
          text: `${fileName} の機器の名前 ${lumps.length} 通り（${lrows} 行）は、作業の欄が一式だけで、名前の同じ機器が無い（まとめた工事の行。内訳はほかの行）。作業にせず、記録に残すか`,
          options: [
            { id: "exclude", label: "作業にしない（記録に残す）" },
            { id: "split", label: "1 件ずつ機器を選ぶ" },
          ],
          valueKind: "option",
          defaultAnswer: "exclude",
          sameShapeRows: lrows,
          items: lumps.slice(0, 20).map((cs) => ({ file: cs.events[0]?.file ?? "", sheet: cs.events[0]?.sheet ?? null, cells: cs.events.slice(0, 1).map((e) => e.refs[0] ?? ""), note: cs.name })),
        });
        if (a !== "split") {
          for (const cs of lumps)
            resolved.set(cs.key, a === "exclude" ? { c: null, qid: questionIdOf(lkey), excluded: true, why: "まとめた工事の行（作業の欄が一式だけ。決定で外した）" } : { c: null, qid: null, excluded: false, wait: questionIdOf(lkey) });
          rest = css.filter((cs) => !lumps.includes(cs));
        }
      }
    }
    if (pattern === "none") {
      const nkey = `eventAssetNew|${tableId}`;
      const nrows = rest.reduce((a, c) => a + c.events.length, 0);
      const a = !rest.length ? null : ask.ask(nkey, {
        kind: "eventAsset",
        text: noAssets
          ? `${fileName} の機器の名前 ${rest.length} 通り（${nrows} 行）は、台帳にも星取表にも無い（機器の記録の資料が無い）。この資料の名前のまま、名前と号ごとに新しい機器として入れるか`
          : `${fileName} の機器の名前 ${rest.length} 通り（${nrows} 行）は、台帳にも星取表にも同じ名前の機器が無い（呼び名の辞書と、号機と部位に分けて引いても無い）。この資料の名前のまま、名前と号ごとに新しい機器として入れるか`,
        // 「名前ごとに決める」は置かない：当てる先の機器が 1 つも無いので、名前ごとの質問はどれも「外す」しか選べず、
        // 名前の数だけ質問が増えて作業画面が固まる（撮影で 3,478 件。Video の報告、11-06）
        // 機器の記録があるときは「1 件ずつ選ぶ」も置く（名前ごとに、同じ号の機器と号の無い機器から選ぶ）
        options: [
          { id: "new", label: "この資料の名前のまま、新しい機器として入れる" },
          ...(noAssets ? [] : [{ id: "split", label: "1 件ずつ機器を選ぶ" }]),
          { id: "exclude", label: "外す" },
        ],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: nrows,
        items: rest.slice(0, 20).map((cs) => ({ file: cs.events[0]?.file ?? "", sheet: cs.events[0]?.sheet ?? null, cells: cs.events.slice(0, 1).map((e) => e.refs[0] ?? ""), note: cs.name })),
      });
      if (a === "split" && !noAssets) one = true;
      else if (a === "new")
        for (const cs of rest) {
          const e0 = cs.events[0];
          if (!e0) continue;
          const same = made.get(`${nk(cs.name)}|${cs.unitKey}`);
          if (same) {
            resolved.set(cs.key, { c: same, qid: questionIdOf(nkey), excluded: false });
            continue;
          }
          const series: Series | null = cs.unitKey.startsWith("n") ? { kind: "number", n: Number(cs.unitKey.slice(1)) } : cs.unitKey === "common" ? { kind: "common", meaning: "" } : null;
          const nameRef = e0.nameRef ?? e0.refs[0] ?? "";
          const r: AssetRec = { id: `ev:${cs.key}`, file: e0.file, sheet: e0.sheet, sheetIndex: e0.sheetIndex, tableId: e0.tableId, shape: "tree", order: 0, level: 1, parentId: null, rawName: cs.name, name: cs.name, tag: e0.tag, tagNumber: null, nameRef, series, specs: [], installed: null, refs: [nameRef], excluded: null, pending: false };
          const c = newCluster(r);
          c.decidedBy.add(questionIdOf(nkey));
          made.set(`${nk(cs.name)}|${cs.unitKey}`, c);
          resolved.set(cs.key, { c, qid: questionIdOf(nkey), excluded: false });
        }
      else if (a === "exclude") for (const cs of rest) resolved.set(cs.key, { c: null, qid: questionIdOf(nkey), excluded: true });
      // 前の版で「名前ごとに決める」と答えた決定は、答えていないものとして扱う（選択肢から外した）
      else for (const cs of rest) resolved.set(cs.key, { c: null, qid: null, excluded: false, wait: questionIdOf(nkey) });
    }
    if (one) {
      for (const cs of rest) {
        const key = `eventAssetOne|${cs.key}`;
        // 名前で当たる機器が無いときは、同じ号の機器と、号の無い・共通の機器を選択肢に出す（推し量らない。決めるのは人）
        const none = cs.cands.length === 0;
        const unitN = cs.unitKey.startsWith("n") ? Number(cs.unitKey.slice(1)) : null;
        const choices = none
          ? clusters.filter((c) => !c.excluded && !c.pending && !c.held && c.recs.some((r) => r.level > 0) && (unitN === null || numberOf(c) === unitN || numberOf(c) === null)).slice(0, 40)
          : cs.cands;
        const ev0 = cs.events[0];
        const a = ask.ask(key, {
          kind: "eventAssetOne",
          text: none
            ? `${fileName} の機器「${cs.name}」（${unitLabel(cs.unitKey)}）に、名前の同じ機器が無い（${cs.events.length} 行）。どの機器か（同じ号の機器と、号の無い機器から選ぶ）`
            : `${fileName} の機器「${cs.name}」（${unitLabel(cs.unitKey)}）に当たる機器が ${cs.cands.length} つある（${cs.events.length} 行）。どの機器か`,
          options: [...choices.map((c, i) => ({ id: `c${i}`, label: `${c.name}${c.tag ? `（${c.tag}）` : ""}${seriesLabel(c.series)}` })), { id: "exclude", label: "外す" }],
          valueKind: "option",
          defaultAnswer: null,
          sameShapeRows: cs.events.length,
          // 選択肢ごとに、その行と、候補の機器の出どころ（items の i 番目が選択肢 c{i}）。候補が無ければ行だけ
          items: choices.length
            ? choices.map((c) => ({ file: ev0?.file ?? "", sheet: ev0?.sheet ?? null, cells: ev0?.refs.slice(0, 1) ?? [], target: c.recs.slice(0, 3).map((r) => ({ file: r.file, sheet: r.sheet, cells: [r.nameRef] })), note: cs.name }))
            : cs.events.slice(0, 10).map((e) => ({ file: e.file, sheet: e.sheet, cells: e.refs.slice(0, 1), note: cs.name })),
        });
        const pick = a?.startsWith("c") ? (choices[Number(a.slice(1))] ?? null) : null;
        resolved.set(cs.key, { c: pick, qid: a ? questionIdOf(key) : null, excluded: a === "exclude", ...(a ? {} : { wait: questionIdOf(key) }) });
      }
      continue;
    }
    if (pattern === "none") continue;
    const gkey = `eventAsset|${tableId}|${pattern}`;
    const how: Record<string, string> = {
      nameUnit: "名前と号が同じ",
      nameOnly: "号の欄は空で、名前が同じ",
      tagName: "名前の中の機器番号と名前が同じ",
      tagOnly: "名前の中の機器番号が同じ（名前の書き方は違う）",
      nameParts: "名前を号機と機器と部位に分けて引いた（「機器 号機 部位」の書き方）",
    };
    // 名前が多いときは「1 件ずつ聞く」を置かない（名前の数だけ質問が増え、作業画面が固まる。Architect の 64）。違う名前は同じ機器のルール（呼び名の並び）で直す
    const many = css.length > SPLIT_MAX;
    const a = ask.ask(gkey, {
      kind: "eventAsset",
      text: `${fileName} の機器の名前 ${css.length} 通り（${rows} 行）を、${how[pattern] ?? pattern}機器 1 つに当てるか${many ? "（1 件ずつは聞かない。違いは「同じ機器」のルールで直す）" : ""}`,
      options: many ? YES_SPLIT.filter((o) => o.id !== "split") : YES_SPLIT,
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
      // 名前が多いときの前の「1 件ずつ聞く」の決定は、答えていないものとして扱う（選択肢から外した）
      else if (a === "split" && !many) {
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
          // 行ごとに、比べる相手（候補の機器の出どころ）を添える（人が台帳を開かずに見比べられるように）
          items: cs.events.slice(0, 10).map((e) => ({ file: e.file, sheet: e.sheet, cells: e.refs.slice(0, 1), target: (c0?.recs ?? []).slice(0, 3).map((r) => ({ file: r.file, sheet: r.sheet, cells: [r.nameRef] })), note: cs.name })),
        });
        resolved.set(cs.key, { c: b === "c0" ? (c0 ?? null) : null, qid: b ? questionIdOf(k1) : null, excluded: b === "exclude", ...(b ? {} : { wait: questionIdOf(k1) }) });
      } else resolved.set(cs.key, { c: null, qid: null, excluded: false, wait: questionIdOf(gkey) });
    }
  }
  // ─── 日報の行 → 作業のまとまり ───
  const occMap = new Map<string, Occurrence>();
  for (const e of rec.events) {
    if (e.excluded || eventExcluded.has(e.id)) continue;
    // 同じ記録の名前の欄から作った機器（資料をまたいで結べば、結んだ機器）
    const own = e.assetId !== undefined ? (clusterOf.get(e.assetId) ?? null) : undefined;
    const en = eventNames.get(e.id);
    if ((own === undefined && !en) || own === null || e.pending || e.effortPending || e.fiscalYear === null || !e.date) {
      eventPending.add(e.id);
      continue;
    }
    const targets: Cluster[] = [];
    const qids = new Set<string>();
    let pend = false;
    let excl = false;
    let why: string | undefined;
    if (own) {
      const assetId = e.assetId ?? "";
      if (own.excluded) {
        eventExcluded.set(e.id, "機器を外した記録（決定で外した）");
        const q = assetExcludedBy.get(assetId);
        if (q) eventExcludedBy.set(e.id, [q]);
        continue;
      }
      if (own.pending || own.held) {
        eventPending.add(e.id);
        const q = assetWaitingOn.get(assetId) ?? heldUnmatchedQ.get(assetId);
        if (q) eventWaitingOn.set(e.id, q);
        continue;
      }
      targets.push(own);
    }
    for (const nm of own ? [] : (en?.names ?? [])) {
      const r = resolved.get(`${e.tableId}|${nk(nm)}|${en?.unitKey ?? "-"}`);
      if (!r || (!r.c && !r.excluded)) {
        pend = true;
        if (r?.wait && !eventWaitingOn.has(e.id)) eventWaitingOn.set(e.id, r.wait);
      }
      else if (r.excluded) {
        excl = true;
        why ??= r.why;
      }
      else if (r.c) targets.push(r.c);
      if (r?.qid) qids.add(r.qid);
    }
    if (pend) {
      eventPending.add(e.id);
      continue;
    }
    if (excl && targets.length === 0) {
      eventExcluded.set(e.id, why ?? "機器が当たらない行（決定で外した）");
      eventExcludedBy.set(e.id, [...qids]);
      continue;
    }
    const tkey = [...new Set(targets.map((t) => t.id))].sort().join(",");
    const wk = nk(e.workName);
    // 期間を持つ行（「始まり〜終わり」）は、その行だけで 1 回の作業。1 日の日付の行は、同じ作業・機器・年度でまとめる。
    // 同じ様式の表（帳票の頁・月のシート・年度のブック）は続いた 1 つの記録なので、様式のまとまりの中でまとめる
    const k = `${formKey(e.tableId)}|${wk}|${tkey}|${e.fiscalYear}${e.end ? `|r${e.tableId}:${e.row}` : ""}`;
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
        days: null,
        period: e.end !== null,
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
    const starts = o.events.map((e) => (e.date ? ymd(e.date) : "")).filter(Boolean).sort();
    const ends = o.events.map((e) => (e.end ? ymd(e.end) : e.date ? ymd(e.date) : "")).filter(Boolean).sort();
    o.start = starts[0] ?? null;
    o.end = ends[ends.length - 1] ?? null;
    const md = o.events.map((e) => e.manDays).filter((x): x is number => x !== null);
    o.manDays = md.length ? Math.round(md.reduce((a, b) => a + b, 0) * 1000) / 1000 : null;
    // 日数は、期間の行の日数の欄に書いてあるときだけ。1 日の日付の行をまとめたものからは数えない（推し量らない）
    // 1 つの行の、いくつかの期間（工程表の飛んだ週）は、期間ごとの日数の和
    o.days = o.period ? (o.events.every((e) => e.days !== null) ? o.events.reduce((a, e) => a + (e.days ?? 0), 0) : (o.events[0]?.days ?? null)) : null;
  }

  // ─── 資料をまたぐ同じ作業（機器ごと） ───
  const groupKey = (units: Occurrence[]) => [...new Set(units.map((u) => formKey(u.tableId)))].sort().join("+");
  // 資料の単位は様式のまとまり（同じ様式の表は続いた 1 つの記録。帳票の頁どうしを、別の資料の同じ作業として結ばない）
  const jobs = joinAcrossDocuments(occurrences, ask, groupKey, (o) => formKey(o.tableId));

  // ─── 作業 → 星取表の印 ───
  const markIndex = new Map<string, MarkRec[]>();
  for (const m of rec.marks) {
    if (m.excluded || m.pending || !m.assetId || m.planOrActual !== "actual") continue;
    const c = clusterOf.get(m.assetId);
    if (!c) continue;
    const k = `${c.id}|${m.fiscalYear}`;
    markIndex.set(k, [...(markIndex.get(k) ?? []), m]);
  }
  const jobsPer = new Map<string, number>();
  for (const j of jobs) jobsPer.set(`${j.cluster.id}|${j.fiscalYear}`, (jobsPer.get(`${j.cluster.id}|${j.fiscalYear}`) ?? 0) + 1);
  const covered = (c: Cluster, fy: number) =>
    c.recs.some((r) => {
      if (r.shape !== "grid") return false;
      const yr = rec.gridYears.get(r.tableId);
      return !!yr && fy >= yr.from && fy <= yr.to;
    });
  type LP = { j: Job; m: MarkRec | null; pattern: string; options: MarkRec[] };
  const lps: LP[] = [];
  const links: WorkLink[] = [];
  // 同じ機器・同じ年度の作業のうち、名前が星取（1 つ）の作業の名前と合うものがある組：その星取は、その作業のもの
  const markNamed = new Set<string>();
  for (const j of jobs) {
    if (j.pending) continue;
    const ms = markIndex.get(`${j.cluster.id}|${j.fiscalYear}`) ?? [];
    const m = ms.length === 1 ? ms[0] : undefined;
    if (m?.workName && nameMatch(m.workName, j.units.map((u) => u.workName))) markNamed.add(`${j.cluster.id}|${j.fiscalYear}`);
  }
  for (const j of jobs) {
    if (j.pending) {
      links.push({ job: j, cluster: j.cluster, mode: "pending", mark: null, decidedBy: new Set(), ...(j.waitingOn ? { waitingOn: j.waitingOn } : {}) });
      continue;
    }
    const ms = markIndex.get(`${j.cluster.id}|${j.fiscalYear}`) ?? [];
    if (ms.length === 0) lps.push({ j, m: null, pattern: covered(j.cluster, j.fiscalYear) ? "noMark" : "uncovered", options: [] });
    else if (ms.length === 1) {
      const m = ms[0] ?? null;
      const multi = (jobsPer.get(`${j.cluster.id}|${j.fiscalYear}`) ?? 0) > 1;
      const match = m?.workName ? nameMatch(m.workName, j.units.map((u) => u.workName)) : null;
      if (m && match) lps.push({ j, m, pattern: match, options: ms });
      else if (m && !m.workName && !multi) lps.push({ j, m, pattern: "plain", options: ms });
      // 星取に作業の名前があり、名前の合う別の作業がその星取を持つ：この作業は星取の作業と別（日報・報告書だけの記録）。
      // 何台もの機器をまとめた一式の作業は、名前が違っても星取の作業のことがあるので、これまでどおり 1 件ずつ聞く
      else if (m?.workName && markNamed.has(`${j.cluster.id}|${j.fiscalYear}`) && !j.units.some((u) => u.bundle)) lps.push({ j, m, pattern: "otherWork", options: ms });
      else lps.push({ j, m, pattern: "ambiguous", options: ms });
    } else lps.push({ j, m: null, pattern: "ambiguous", options: ms });
  }
  const lgroups = new Map<string, LP[]>();
  for (const lp of lps) lgroups.set(`${groupKey(lp.j.units)}|${lp.pattern}`, [...(lgroups.get(`${groupKey(lp.j.units)}|${lp.pattern}`) ?? []), lp]);
  const primary = (j: Job) => j.units[0] as Occurrence;
  const lpItem = (lp: LP): QuestionItem => ({
    file: primary(lp.j).file,
    sheet: primary(lp.j).sheet,
    cells: primary(lp.j).events.slice(0, 3).map((e) => e.refs[0] ?? ""),
    target: lp.options.map((m) => ({ file: m.file, sheet: m.sheet, cells: [m.ref] })),
    note: lp.j.cluster.name,
  });
  const rowsOf = (j: Job) => j.units.reduce((a, u) => a + u.events.length, 0);
  const filesOf = (j: Job) => [...new Set(j.units.map((u) => u.file))].join("・");
  for (const [g, items] of lgroups) {
    const pattern = g.slice(g.lastIndexOf("|") + 1);
    const tablesKey = g.slice(0, g.lastIndexOf("|"));
    const fileName = filesLabel([...new Set(items.flatMap((x) => x.j.units.map((u) => u.file)))].sort());
    const rows = items.reduce((a, x) => a + rowsOf(x.j), 0);
    if (pattern === "uncovered") {
      for (const lp of items) links.push({ job: lp.j, cluster: lp.j.cluster, mode: "eventOnly", mark: null, decidedBy: new Set() });
      continue;
    }
    if (pattern === "ambiguous") {
      for (const lp of items) {
        const key = `workLinkOne|${primary(lp.j).id}|${lp.j.cluster.id}`;
        const a = ask.ask(key, {
          kind: "workLinkOne",
          text: `${filesOf(lp.j)} の作業「${primary(lp.j).workName}」（${lp.j.cluster.name}、${lp.j.fiscalYear} 年度、${rowsOf(lp.j)} 行）に当たる星取が、ほかの作業の星取と同じか、いくつかある。どうするか`,
          options: [
            ...lp.options.map((m, i) => ({ id: `m${i}`, label: `星取「${m.symbol}」${m.workName ? `（${m.workName}）` : ""}も出どころにする（同じ作業）` })),
            { id: "eventOnly", label: "日報・報告書だけの記録にする" },
            { id: "exclude", label: "外す" },
          ],
          valueKind: "option",
          defaultAnswer: lp.options.length === 1 ? "m0" : null,
          sameShapeRows: rowsOf(lp.j),
          items: [lpItem(lp)],
        });
        const qid = questionIdOf(key);
        if (a?.startsWith("m")) links.push({ job: lp.j, cluster: lp.j.cluster, mode: "mark", mark: lp.options[Number(a.slice(1))] ?? null, decidedBy: new Set([qid]) });
        else if (a === "eventOnly") links.push({ job: lp.j, cluster: lp.j.cluster, mode: "eventOnly", mark: null, decidedBy: new Set([qid]) });
        else if (a === "exclude") links.push({ job: lp.j, cluster: lp.j.cluster, mode: "excluded", mark: null, decidedBy: new Set([qid]) });
        else links.push({ job: lp.j, cluster: lp.j.cluster, mode: "pending", mark: null, decidedBy: new Set(), waitingOn: qid });
      }
      continue;
    }
    const label: Record<string, string> = {
      named: "同じ機器・同じ年度で、星取の凡例の意味と作業の名前が同じ",
      namedPart: "同じ機器・同じ年度で、星取の凡例の意味が作業の名前に含まれる（または作業の名前が凡例の意味に含まれる）",
      plain: "同じ機器・同じ年度に、実績の星取が 1 つと作業が 1 つ",
      noMark: "同じ機器・同じ年度の実績の星取が無い",
      otherWork: "同じ機器・同じ年度の星取は、作業の名前の合う別の作業のもの（この作業の名前は星取の作業の名前と違う）",
    };
    const gkey = `workLink|${tablesKey}|${pattern}`;
    const isNoMark = pattern === "noMark" || pattern === "otherWork";
    const a = ask.ask(gkey, {
      kind: "workLink",
      text: isNoMark
        ? `${fileName} の作業 ${items.length} 件（${rows} 行）は、${label[pattern]}。日報・報告書だけの記録として入れるか`
        : `${fileName} の作業 ${items.length} 件（${rows} 行）を、星取と同じ作業として 1 つの記録に結ぶか。結び方：${label[pattern] ?? pattern}`,
      options: isNoMark
        ? [
            { id: "yes", label: "日報・報告書だけの記録として入れる" },
            // 名前の違う作業でも星取の作業のことがある（報告書の書き方が違うなど）：1 件ずつ決められる
            ...(pattern === "otherWork" ? [{ id: "split", label: "1 件ずつ決める" }] : []),
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
      if (isNoMark && a === "split" && pattern === "otherWork") {
        const k1 = `workLinkOne|${primary(lp.j).id}|${lp.j.cluster.id}`;
        const b = ask.ask(k1, {
          kind: "workLinkOne",
          text: `${filesOf(lp.j)} の作業「${primary(lp.j).workName}」（${lp.j.cluster.name}、${lp.j.fiscalYear} 年度、${rowsOf(lp.j)} 行）は、星取「${lp.m?.symbol ?? ""}」${lp.m?.workName ? `（${lp.m.workName}）` : ""}と同じ作業か`,
          options: [
            { id: "m0", label: "同じ作業（1 つの記録に結ぶ）" },
            { id: "eventOnly", label: "別の作業（日報・報告書だけの記録）" },
            { id: "exclude", label: "外す" },
          ],
          valueKind: "option",
          defaultAnswer: "eventOnly",
          sameShapeRows: rowsOf(lp.j),
          items: [lpItem(lp)],
        });
        const q1 = questionIdOf(k1);
        if (b === "m0") links.push({ job: lp.j, cluster: lp.j.cluster, mode: "mark", mark: lp.m, decidedBy: new Set([q1]) });
        else if (b === "eventOnly") links.push({ job: lp.j, cluster: lp.j.cluster, mode: "eventOnly", mark: null, decidedBy: new Set([q1]) });
        else if (b === "exclude") links.push({ job: lp.j, cluster: lp.j.cluster, mode: "excluded", mark: null, decidedBy: new Set([q1]) });
        else links.push({ job: lp.j, cluster: lp.j.cluster, mode: "pending", mark: null, decidedBy: new Set(), waitingOn: q1 });
        continue;
      }
      if (isNoMark) {
        if (a === "yes") links.push({ job: lp.j, cluster: lp.j.cluster, mode: "eventOnly", mark: null, decidedBy: new Set([gq]) });
        else if (a === "exclude") links.push({ job: lp.j, cluster: lp.j.cluster, mode: "excluded", mark: null, decidedBy: new Set([gq]) });
        else links.push({ job: lp.j, cluster: lp.j.cluster, mode: "pending", mark: null, decidedBy: new Set(), waitingOn: gq });
        continue;
      }
      if (a === "yes") links.push({ job: lp.j, cluster: lp.j.cluster, mode: "mark", mark: lp.m, decidedBy: new Set([gq]) });
      else if (a === "split") {
        const k1 = `workLinkOne|${primary(lp.j).id}|${lp.j.cluster.id}`;
        const b = ask.ask(k1, {
          kind: "workLinkOne",
          text: `${filesOf(lp.j)} の作業「${primary(lp.j).workName}」（${lp.j.cluster.name}、${lp.j.fiscalYear} 年度、${rowsOf(lp.j)} 行）は、星取「${lp.m?.symbol ?? ""}」と同じ作業か`,
          options: [
            { id: "m0", label: "同じ作業（1 つの記録に結ぶ）" },
            { id: "eventOnly", label: "別の作業（日報・報告書だけの記録）" },
            { id: "exclude", label: "外す" },
          ],
          valueKind: "option",
          defaultAnswer: null,
          sameShapeRows: rowsOf(lp.j),
          items: [lpItem(lp)],
        });
        const q1 = questionIdOf(k1);
        if (b === "m0") links.push({ job: lp.j, cluster: lp.j.cluster, mode: "mark", mark: lp.m, decidedBy: new Set([q1]) });
        else if (b === "eventOnly") links.push({ job: lp.j, cluster: lp.j.cluster, mode: "eventOnly", mark: null, decidedBy: new Set([q1]) });
        else if (b === "exclude") links.push({ job: lp.j, cluster: lp.j.cluster, mode: "excluded", mark: null, decidedBy: new Set([q1]) });
        else links.push({ job: lp.j, cluster: lp.j.cluster, mode: "pending", mark: null, decidedBy: new Set(), waitingOn: q1 });
      } else links.push({ job: lp.j, cluster: lp.j.cluster, mode: "pending", mark: null, decidedBy: new Set(), waitingOn: gq });
    }
  }
  return { clusters, clusterOf, occurrences, jobs, links, eventPending, eventWaitingOn, eventExcluded, eventExcludedBy, assetExcluded, assetExcludedBy, assetWaitingOn };
}

/** 凡例の意味と作業の名前：同じなら named、どちらかがもう一方を含むなら namedPart、どれとも違えば null */
function nameMatch(meaning: string, names: string[]): "named" | "namedPart" | null {
  const m = nk(meaning);
  if (!m) return null;
  if (names.some((n) => nk(n) === m)) return "named";
  if (names.some((n) => nk(n).includes(m) || (nk(n).length > 0 && m.includes(nk(n))))) return "namedPart";
  return null;
}

const byFile = (a: Occurrence, b: Occurrence) => a.file.localeCompare(b.file) || a.tableId.localeCompare(b.tableId) || a.id.localeCompare(b.id);

/**
 * 資料をまたいで同じ作業を結ぶ（機器ごと）。同じ機器・同じ年度の作業のまとまりが、ちがう表に 1 つずつあり、
 * 日付の範囲が重なれば、同じ作業の案にする（呼び名は資料ごとに違うので、名前では決めない）。案は形ごとにまとめて聞き、
 * 人（か AI）が受けたものだけを結ぶ。重なる相手がいくつかあるもの・日付が重ならないものも、推し量らずに聞く。
 */
function joinAcrossDocuments(occurrences: Occurrence[], ask: Asker, groupKey: (units: Occurrence[]) => string, docOf: (o: Occurrence) => string = (o) => o.tableId): Job[] {
  const groups = new Map<string, { c: Cluster; fy: number; units: Occurrence[] }>();
  for (const o of occurrences)
    for (const c of o.targets) {
      const k = `${c.id}|${o.fiscalYear}`;
      const g = groups.get(k) ?? { c, fy: o.fiscalYear, units: [] };
      g.units.push(o);
      groups.set(k, g);
    }
  const jobs: Job[] = [];
  const mk = (c: Cluster, fy: number, units: Occurrence[], decided: string[], pending = false, waitingOn: string | null = null) => {
    const us = [...units].sort(byFile);
    jobs.push({ id: `j:${c.id}|${fy}|${us.map((u) => u.id).join("+")}`, cluster: c, fiscalYear: fy, units: us, decidedBy: new Set(decided), pending, ...(pending && waitingOn ? { waitingOn } : {}) });
  };
  const overlap = (a: Occurrence, b: Occurrence) => !!a.start && !!a.end && !!b.start && !!b.end && a.start <= b.end && b.start <= a.end;
  type Prop = { c: Cluster; fy: number; units: Occurrence[]; pattern: "overlap" | "apart" };
  const props: Prop[] = [];
  type Pick = { c: Cluster; fy: number; anchor: Occurrence; table: string; cands: Occurrence[] };
  const picks: Pick[] = [];
  /** 重なる相手がいくつかあるまとまりの、選ばれる側の作業（選ばれなければ 1 つで入れる） */
  const leftovers = new Map<string, { c: Cluster; fy: number; u: Occurrence }>();
  for (const { c, fy, units } of groups.values()) {
    const us = [...units].sort(byFile);
    if (new Set(us.map((u) => docOf(u))).size < 2) {
      for (const u of us) mk(c, fy, [u], []);
      continue;
    }
    // 重なりでつながるまとまり（ちがう表どうしの重なりだけを辺にする）
    const parent = us.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] ?? i)));
    for (let i = 0; i < us.length; i++)
      for (let k = i + 1; k < us.length; k++) {
        const a = us[i] as Occurrence;
        const b = us[k] as Occurrence;
        if (docOf(a) !== docOf(b) && overlap(a, b)) parent[find(i)] = find(k);
      }
    const comps = new Map<number, Occurrence[]>();
    us.forEach((u, i) => comps.set(find(i), [...(comps.get(find(i)) ?? []), u]));
    const singles: Occurrence[] = [];
    for (const comp of comps.values()) {
      if (comp.length === 1) {
        singles.push(comp[0] as Occurrence);
        continue;
      }
      const perTable = new Map<string, Occurrence[]>();
      for (const u of comp) perTable.set(docOf(u), [...(perTable.get(docOf(u)) ?? []), u]);
      if ([...perTable.values()].every((x) => x.length === 1)) {
        props.push({ c, fy, units: comp, pattern: "overlap" });
        continue;
      }
      // 重なる相手がいくつかある：数のいちばん少ない表の作業ごとに、ほかの表のどれと同じかを聞く
      const tables = [...perTable.entries()].sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
      const [anchorTable, anchors] = tables[0] as [string, Occurrence[]];
      for (const u of comp) if (docOf(u) !== anchorTable) leftovers.set(`${c.id}|${u.id}`, { c, fy, u });
      for (const anchor of anchors) {
        let any = false;
        for (const [table, cands] of tables) {
          const near = cands.filter((x) => overlap(x, anchor));
          if (table === anchorTable || near.length === 0) continue;
          picks.push({ c, fy, anchor, table, cands: near });
          any = true;
        }
        if (!any) mk(c, fy, [anchor], []);
      }
    }
    // 重なる相手の無い作業：同じ機器・同じ年度に、どの表にも 1 つずつしか無ければ、日付のずれかもしれないので聞く
    const singleTables = new Set(singles.map((u) => docOf(u)));
    if (singles.length >= 2 && singleTables.size === singles.length && singles.length === us.length) props.push({ c, fy, units: singles, pattern: "apart" });
    else for (const u of singles) mk(c, fy, [u], []);
  }
  const datesOf = (o: Occurrence) => (o.start === o.end ? (o.start ?? "") : `${o.start ?? ""}〜${o.end ?? ""}`);
  const itemOf = (p: { units: Occurrence[]; c: Cluster }): QuestionItem => {
    const [u0, ...rest] = p.units;
    return {
      file: u0?.file ?? "",
      sheet: u0?.sheet ?? null,
      cells: (u0?.events ?? []).slice(0, 3).map((e) => e.refs[0] ?? ""),
      target: rest.map((u) => ({ file: u.file, sheet: u.sheet, cells: u.events.slice(0, 3).map((e) => e.refs[0] ?? "") })),
      note: p.c.name,
    };
  };
  // 形ごと（どの表とどの表か × 重なるか）にまとめて聞く
  const pgroups = new Map<string, Prop[]>();
  for (const p of props) pgroups.set(`${groupKey(p.units)}|${p.pattern}`, [...(pgroups.get(`${groupKey(p.units)}|${p.pattern}`) ?? []), p]);
  for (const [g, ps] of pgroups) {
    const pattern = g.slice(g.lastIndexOf("|") + 1) as Prop["pattern"];
    const files = [...new Set(ps.flatMap((p) => p.units.map((u) => u.file)))];
    const gkey = `workJoin|${g}`;
    const how =
      pattern === "overlap"
        ? "同じ機器・同じ年度で日付の範囲が重なり、資料ごとに 1 つずつある"
        : "同じ機器・同じ年度に資料ごとに 1 つずつあるが、日付の範囲は重ならない";
    const a = ask.ask(gkey, {
      kind: "workJoin",
      text: `${filesLabel(files.sort())} の作業 ${ps.length} 件（機器ごと）は、${how}。同じ作業として 1 つの記録に結ぶか（呼び名は資料ごとに違ってよい）`,
      options: [...YES_SPLIT, { id: "no", label: "いいえ（どれも別の作業として入れる）" }],
      valueKind: "option",
      defaultAnswer: pattern === "overlap" ? "yes" : null,
      sameShapeRows: ps.reduce((n, p) => n + p.units.reduce((m, u) => m + u.events.length, 0), 0),
      items: ps.map(itemOf),
    });
    const gq = questionIdOf(gkey);
    for (const p of ps) {
      if (a === "yes") mk(p.c, p.fy, p.units, [gq]);
      else if (a === "no") for (const u of p.units) mk(p.c, p.fy, [u], [gq]);
      else if (a === "split") {
        const k1 = `workJoinOne|${p.c.id}|${[...p.units].sort(byFile).map((u) => u.id).join("+")}`;
        const b = ask.ask(k1, {
          kind: "workJoin",
          text: `「${p.c.name}」の ${p.fy} 年度の作業（${p.units.map((u) => `${u.file}「${u.workName}」${datesOf(u)}`).join("、")}）は、同じ作業か`,
          options: [
            { id: "yes", label: "同じ作業（1 つの記録に結ぶ）" },
            { id: "no", label: "別の作業（別々に入れる）" },
          ],
          valueKind: "option",
          defaultAnswer: null,
          sameShapeRows: p.units.reduce((m, u) => m + u.events.length, 0),
          items: [itemOf(p)],
        });
        const q1 = questionIdOf(k1);
        if (b === "yes") mk(p.c, p.fy, p.units, [q1]);
        else if (b === "no") for (const u of p.units) mk(p.c, p.fy, [u], [q1]);
        else mk(p.c, p.fy, p.units, [], true, q1);
      } else mk(p.c, p.fy, p.units, [], true, gq);
    }
  }
  // 重なる相手がいくつかあるもの：1 件ずつ聞く。同じ相手を 2 度選んだら、あとの方は決まらないまま（推し量らない）
  const taken = new Map<string, string>();
  const joinedWith = new Map<Occurrence, { units: Occurrence[]; decided: string[]; pending: boolean; waitingOn: string | null; c: Cluster; fy: number }>();
  for (const p of picks) {
    const key = `workJoinPick|${p.c.id}|${p.anchor.id}|${p.table}`;
    const a = ask.ask(key, {
      kind: "workJoin",
      text: `「${p.c.name}」の ${p.fy} 年度の作業「${p.anchor.workName}」（${p.anchor.file}、${datesOf(p.anchor)}）と日付の重なる作業が、${p.cands[0]?.file ?? ""} に ${p.cands.length} つある。どれと同じ作業か`,
      options: [...p.cands.map((x, i) => ({ id: `c${i}`, label: `「${x.workName}」${datesOf(x)}` })), { id: "none", label: "どれとも別の作業" }],
      valueKind: "option",
      defaultAnswer: null,
      sameShapeRows: p.anchor.events.length,
      items: p.cands.map((x) => itemOf({ c: p.c, units: [p.anchor, x] })),
    });
    const q = questionIdOf(key);
    const cur = joinedWith.get(p.anchor) ?? { units: [p.anchor], decided: [], pending: false, waitingOn: null, c: p.c, fy: p.fy };
    joinedWith.set(p.anchor, cur);
    if (a?.startsWith("c")) {
      const x = p.cands[Number(a.slice(1))];
      if (x && !taken.has(`${p.c.id}|${x.id}`)) {
        taken.set(`${p.c.id}|${x.id}`, p.anchor.id);
        cur.units.push(x);
        cur.decided.push(q);
      } else {
        cur.pending = true;
        cur.waitingOn ??= q;
      }
    } else if (a === "none") cur.decided.push(q);
    else {
      cur.pending = true;
      cur.waitingOn ??= q;
    }
  }
  for (const j of joinedWith.values()) mk(j.c, j.fy, j.units, j.decided, j.pending, j.waitingOn);
  for (const [k, l] of leftovers) if (!taken.has(k)) mk(l.c, l.fy, [l.u], []);
  return jobs;
}

export function seriesLabel(s: Series | null): string {
  if (!s) return "";
  if (s.kind === "number") return `・${s.n} 号`;
  const m = cue.commonMeanings.find((x) => x.id === s.meaning);
  return `・共通${m ? `（${m.label}）` : ""}`;
}

/** 作業の欄が一式の印だけ（括弧の書き添えを除く。「一式（内訳は各行）」）：まとめた工事の行の印 */
function lumpWork(w: string): boolean {
  const t = nfkc(w).replace(/[(（][^()（）]*[)）]/gu, "").trim();
  const s = cue.stripSet(t);
  return s.set && s.text.replace(/\s+/gu, "") === "";
}
