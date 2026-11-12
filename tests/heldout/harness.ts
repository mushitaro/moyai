// 見ていない様式の試験の道具（docs/plan.md §2.6）：正解（contract.ts の形）から質問に答える台本と、物差し ①②③⑤⑥。
// 開発用の物差し（tests/unit/import/truth.ts）と同じ考え方を、書き方に依らない正解の形で書き直したもの。
// calibrate.test.ts が、開発用の資料でこの道具が開発用の物差しと同じ数を出すことを確かめる（道具の誤りを読み手の誤りと取り違えないため）。
// src/ は正解を読まない。試験の中の人だけの操作（質問に答える）は、この台本が人の代わりに押し、作者を human・理由に「試験の台本が押した」と書く。
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { IntakeSession, readSource } from "../../src/import";
import type { SourceFile } from "../../src/import/grid";
import type { Decision, QuestionItem, QuestionState } from "../../src/import/questions";
import type { Analysis, Survey } from "../../src/import/session";
import { WHOLE_FILE_ANSWERS, type LoadedReading } from "../../src/import/reading";
import { Plan } from "../../src/shared/plan";
import { measureFacts, measurePdfAgainstXlsx } from "../unit/import/truth";
import { hits, nf, resolve, rowOf, type Asset, type Event, type HeldoutTruth, type HeldoutWorld, type LoadedSet, type Mark, type Resolved } from "./contract";

export const AUTHOR_REASON = "試験の台本が押した（正解の世界から）";
type Detail = Plan["details"][number];

// ─── 正解の場所を、読み手の格子に引き当てた索引 ─────────────────────

interface Placed<T> {
  item: T;
  at: Resolved | null;
  why: string | null;
}

export class Index {
  readonly assets: Placed<Asset>[];
  readonly marks: Placed<Mark>[];
  readonly events: Placed<Event>[];
  readonly eq = new Map<string, HeldoutWorld["equipment"][number]>();
  readonly work = new Map<string, HeldoutWorld["works"][number]>();
  private readonly fileKind = new Map<string, string>();
  constructor(
    readonly truth: HeldoutTruth,
    readonly world: HeldoutWorld,
    readonly sources: SourceFile[],
  ) {
    const src = (f: string) => sources.find((s) => s.file === f);
    const place = <T extends { file: string; at: Parameters<typeof resolve>[1] }>(x: T): Placed<T> => {
      const r = resolve(src(x.file), x.at);
      return r.ok ? { item: x, at: r.at, why: null } : { item: x, at: null, why: r.why };
    };
    this.assets = truth.assets.map(place);
    this.marks = truth.marks.map(place);
    this.events = truth.events.map(place);
    for (const e of world.equipment) this.eq.set(e.id, e);
    for (const w of world.works) this.work.set(w.id, w);
    for (const f of truth.files) this.fileKind.set(f.file, f.kind);
  }
  kindOf(file: string): string | null {
    return this.fileKind.get(file) ?? null;
  }
  private sameSheet(a: string | null | undefined, b: string | null | undefined) {
    return a === undefined || a === null || b === undefined || b === null || a === b;
  }
  /** そのセルにある正解のもの（セルで書いた場所か、行とその文字で書いた場所。行のすべてのセルで書いたものは assetInRow で引く） */
  assetAt(file: string, sheet: string | null | undefined, ref: string): Asset | null {
    return this.assets.find((p) => p.at && p.item.file === file && this.sameSheet(p.at.sheet, sheet) && p.at.refs.has(ref) && ("cell" in p.item.at || "text" in p.item.at))?.item ?? null;
  }
  /** その行にある正解のもの（kind で絞れる。1 つに決まらなければ null） */
  assetInRow(file: string, sheet: string | null | undefined, row: number, kind?: Asset["kind"]): Asset | null {
    const xs = this.assets.filter((p) => p.at && p.item.file === file && this.sameSheet(p.at.sheet, sheet) && p.at.row === row && (!kind || p.item.kind === kind));
    return xs.length === 1 ? xs[0]!.item : null;
  }
  eventAt(file: string, sheet: string | null | undefined, ref: string): Event | null {
    return this.events.find((p) => p.at && p.item.file === file && this.sameSheet(p.at.sheet, sheet) && p.at.refs.has(ref))?.item ?? null;
  }
  markAt(file: string, sheet: string | null | undefined, ref: string): Mark | null {
    return this.marks.find((p) => p.at && p.item.file === file && this.sameSheet(p.at.sheet, sheet) && p.at.refs.has(ref))?.item ?? null;
  }
  /** もの の鍵：機器 e:<id>・部位 part:<id>:<名前>・まとまり p:<道> */
  keyOf(a: Asset | null): string | null {
    if (!a) return null;
    if (a.kind === "equipment") return a.equipment_id ? `e:${a.equipment_id}` : null;
    if (a.kind === "part") return `part:${a.equipment_id}:${nf(a.name_text)}`;
    return a.path ? `p:${a.path.join("/")}` : `p?:${a.name_text}`;
  }
  /** セルが指すもの。台帳は行で引く（番号や仕様の欄を指されても、その行のもの） */
  entityOf(file: string, sheet: string | null | undefined, ref: string): string | null {
    const a = this.assetAt(file, sheet, ref) ?? (this.kindOf(file) === "ledger" ? this.assetInRow(file, sheet, rowOf(ref)) : null);
    return this.keyOf(a);
  }
}

// ─── 決まった台本：正解から質問に答える ───────────────────────────

const eqOfKey = (k: string | null) => (k && k.startsWith("e:") ? k.slice(2) : null);

/**
 * 人数と作業時間の幅で工数を数える問い（src/import/records.ts の eventRecords）：見本の行（「人数 n・幅 h:mm～h:mm」・「人数 n」）と、
 * その行の正解の工数から、正解に合う答えを返す。昼休みの問いは「含まない」「含む（12:00 から L 時間と重なる分を引く）」「1 行 1 日」のうち、
 * 見本のどの行にも合うもの（昼休みの時間の問いには L）。合うものが無ければ外す。昼休みの問いでなければ undefined
 */
function spanAnswer(q: QuestionState, ix: Index): string | null | undefined {
  const lunchQ = q.options.some((o) => o.id === "noon");
  const hoursQ = q.valueKind === "number" && q.text.includes("昼休み");
  const noTimeQ = !lunchQ && q.options.some((o) => o.id === "perDay");
  if (!lunchQ && !hoursQ && !noTimeQ) return undefined;
  const samples: { persons: number; start: number; end: number; md: number }[] = [];
  for (const it of q.items) {
    const m = /^人数 (\d+)(?:・幅 (\d+):(\d+)～(\d+):(\d+))?$/.exec(it.note ?? "");
    if (!m) continue;
    const md = it.cells.map((c) => ix.eventAt(it.file, it.sheet, c)).find((e) => !!e)?.man_days ?? null;
    if (md === null) continue;
    const at = (h?: string, mm?: string) => (h === undefined ? Number.NaN : Number(h) * 60 + Number(mm));
    samples.push({ persons: Number(m[1]), start: at(m[2], m[3]), end: at(m[4], m[5]), md });
  }
  // 正解の工数は小数 3 桁に丸めてある
  const near = (a: number, b: number) => Math.abs(a - b) < 6e-4;
  const H = ix.world.man_day_hours;
  const perDay = samples.length > 0 && samples.every((x) => near(x.md, x.persons));
  if (noTimeQ) return perDay ? "perDay" : "exclude";
  const hoursOf = (x: (typeof samples)[number], lunch: number) => (x.end - x.start) / 60 - Math.max(0, Math.min(x.end, 720 + lunch * 60) - Math.max(x.start, 720)) / 60;
  const fits = (lunch: number) => samples.length > 0 && samples.every((x) => near(x.md, (x.persons * hoursOf(x, lunch)) / H));
  // 昼休みの時間の候補：見本の行の、幅の時間と正解の時間の差
  const cuts = [...new Set(samples.map((x) => Math.round(((x.end - x.start) / 60 - (x.md * H) / x.persons) * 100) / 100).filter((v) => v > 0))];
  const lunch = cuts.find((v) => fits(v)) ?? null;
  if (hoursQ) return lunch !== null ? String(lunch) : null;
  if (fits(0)) return "no";
  if (lunch !== null) return "noon";
  if (perDay) return "perDay";
  return "exclude";
}

export function answer(q: QuestionState, ix: Index): string | null {
  const ent = (it: { file: string; sheet: string | null; cells: string[] }) => ix.entityOf(it.file, it.sheet, it.cells[0] ?? "");
  const targetEnt = (it: QuestionItem) => {
    const tg = it.target?.[0];
    return tg ? ent(tg) : null;
  };
  const ev = (file: string, sheet: string | null, ref: string) => ix.eventAt(file, sheet, ref) ?? ix.markAt(file, sheet, ref);
  const worksOf = (it: { file: string; sheet: string | null; cells: string[] }) => it.cells.flatMap((c) => ev(it.file, it.sheet, c)?.work_ids ?? []);
  const sameWork = (a: { file: string; sheet: string | null; cells: string[] }, b: { file: string; sheet: string | null; cells: string[] }) => {
    const wa = new Set(worksOf(a));
    return wa.size > 0 && worksOf(b).some((w) => wa.has(w));
  };
  const eqIdsAt = (it: { file: string; sheet: string | null; cells: string[] }) => {
    const e = ix.eventAt(it.file, it.sheet, it.cells[0] ?? "");
    return e ? e.equipment_ids : null;
  };
  switch (q.kind) {
    case "tagSplit": {
      const ok = q.items.every((it) => {
        const a = ix.assetAt(it.file, it.sheet, it.cells[0] ?? "") ?? ix.assetInRow(it.file, it.sheet, rowOf(it.cells[0] ?? ""));
        const tag = a?.tag ?? (a?.equipment_id ? ix.eq.get(a.equipment_id)?.tag : null);
        return !!tag && typeof it.note === "string" && nf(it.note).startsWith(nf(tag));
      });
      return ok ? "yes" : "no";
    }
    case "levelSplit": {
      const levels = new Set(q.items.flatMap((it) => it.cells.map((c) => ix.assetInRow(it.file, it.sheet, rowOf(c))?.level ?? null)));
      return levels.size === 1 && ![...levels].includes(null) ? `level:${[...levels][0]}` : null;
    }
    case "levelJump":
      return "keep";
    case "yearKind":
      return "fiscal";
    case "blankSameAsAbove":
      return "same";
    case "hiddenData": {
      const f = ix.truth.files.find((x) => x.file === q.items[0]?.file);
      return f?.hidden_data ?? "include";
    }
    case "unknownSymbol":
    case "noLegend": {
      const it = q.items[0];
      const m = it ? ix.markAt(it.file, it.sheet, it.cells[0] ?? "") : null;
      return m ? (m.status === "planned" ? "plan" : "actual") : "exclude";
    }
    case "commonMeaning": {
      const allNull = q.items.every((it) =>
        it.cells.every((c) => {
          const a = ix.assetInRow(it.file, it.sheet, rowOf(c), "equipment");
          return a?.equipment_id ? ix.eq.get(a.equipment_id)?.furnace === null : false;
        }),
      );
      return allNull ? "facility" : null;
    }
    case "unitSpelling": {
      const ok = q.items.every((it) => it.cells.every((c) => (ix.eventAt(it.file, it.sheet, c)?.equipment_ids ?? []).every((id) => ix.eq.has(id)) && !!ix.eventAt(it.file, it.sheet, c)));
      return ok ? "yes" : "no";
    }
    case "hoursPerManDay":
      return String(ix.world.man_day_hours);
    case "effortUnknown": {
      const a = spanAnswer(q, ix);
      if (a !== undefined) return a;
      return q.options.length === 1 ? (q.options[0]?.id ?? null) : null;
    }
    case "assetLink": {
      const ok = q.items.every((it) => {
        const a = ent(it);
        return a !== null && a === targetEnt(it);
      });
      return ok ? "yes" : "split";
    }
    case "assetLinkOne": {
      const it = q.items[0];
      if (!it) return null;
      const a = ent(it);
      if (a === null) return null;
      if (q.options.some((o) => o.id === "c1")) {
        const i = q.items.findIndex((x) => targetEnt(x) === a);
        return i >= 0 && q.options.some((o) => o.id === `c${i}`) ? `c${i}` : "none";
      }
      if (it.target?.length) return a === targetEnt(it) ? "c0" : "none";
      return null;
    }
    case "assetUnmatched":
      return "yes";
    case "eventAsset": {
      // 台帳も星取表も無い組の「この資料の名前のまま新しい機器にするか」：正解でその行に機器があれば入れる
      if (q.options.some((o) => o.id === "new")) return q.items.every((it) => (eqIdsAt(it)?.length ?? 0) > 0) ? "new" : "exclude";
      // 機器の欄の無い台帳の「件名から機器の名前を取るか」：正解でその行に機器があれば取る
      if (q.options.some((o) => o.id === "title")) return q.items.every((it) => it.cells.some((c) => (ix.eventAt(it.file, it.sheet, c)?.equipment_ids.length ?? 0) > 0)) ? "title" : "exclude";
      // 号炉・機器・作業の区切りの無いセルの問い（選べるのは「外す」だけ）：人もそれを選ぶしかない
      if (q.options.length === 1 && q.options[0]?.id === "exclude") return "exclude";
      const ok = q.items.every((it) => {
        const ids = eqIdsAt(it);
        const e = eqOfKey(targetEnt(it));
        return !!ids && !!e && ids.includes(e);
      });
      return ok ? "yes" : "split";
    }
    case "eventAssetOne": {
      const it = q.items[0];
      if (!it) return null;
      // 選択肢から選ぶ形（items の i 番目が選択肢 c{i} の候補）：その行の機器のうち、候補になっているもの。
      // 一式の行の 1 つの名前に、その行の機器がいくつも候補に出たら、名前の字がいちばん重なる候補（正解は行ごとで、名前ごとではないため）
      if (q.options.filter((o) => o.id.startsWith("c")).length >= 2 || (q.options.some((o) => o.id === "c0") && it.target?.length)) {
        const ids = eqIdsAt(it);
        if (!ids) return null;
        const hits = q.items.map((x, i) => ({ i, e: eqOfKey(targetEnt(x)) })).filter((h) => h.e !== null && ids.includes(h.e) && q.options.some((o) => o.id === `c${h.i}`));
        if (!hits.length) return "exclude";
        const frag = nf(it.note ?? "");
        const overlap = (e: string) => [...new Set(frag)].filter((ch) => nf(ix.eq.get(e)?.name ?? "").includes(ch)).length;
        hits.sort((a, b) => overlap(b.e!) - overlap(a.e!) || a.i - b.i);
        return `c${hits[0]!.i}`;
      }
      if (q.options.some((o) => o.id === "c0") && q.options.length === 2) {
        const ids = eqIdsAt(it);
        if (!ids) return null;
        const e = eqOfKey(targetEnt(it));
        return e && ids.includes(e) ? "c0" : "exclude";
      }
      return null;
    }
    case "workJoin": {
      if (q.options.some((o) => o.id === "c0")) {
        const i = q.items.findIndex((it) => it.target?.[0] && sameWork(it, it.target[0]));
        return i >= 0 ? `c${i}` : "none";
      }
      const ok = q.items.every((it) => (it.target ?? []).length > 0 && (it.target ?? []).every((tg) => sameWork(it, tg)));
      if (q.options.some((o) => o.id === "split")) return ok ? "yes" : "split";
      return ok ? "yes" : "no";
    }
    case "workLink": {
      const isNoMark = q.options.some((o) => o.id === "exclude");
      const markedWorks = new Set(ix.truth.marks.flatMap((m) => m.work_ids));
      const ok = q.items.every((it) => {
        const lines = it.cells.map((c) => ix.eventAt(it.file, it.sheet, c)).filter((x): x is Event => !!x);
        if (isNoMark) return lines.every((l) => l.work_ids.every((w) => !markedWorks.has(w)));
        const tg = it.target?.[0];
        const cellWorks = tg ? (ix.markAt(tg.file, tg.sheet, tg.cells[0] ?? "")?.work_ids ?? []) : [];
        return lines.length > 0 && lines.every((l) => l.work_ids.some((w) => cellWorks.includes(w)));
      });
      // 印の無い作業を「日報・報告書だけの記録」として入れるかの問いは、正解で印があっても「入れる」（人は記録を捨てない。結べなかった分は ⑥ が数える）
      return ok ? "yes" : isNoMark ? "yes" : "split";
    }
    case "workLinkOne": {
      const it = q.items[0];
      if (!it) return null;
      const lines = it.cells.map((c) => ix.eventAt(it.file, it.sheet, c)).filter((x): x is Event => !!x);
      const marks = it.target ?? [];
      for (let i = 0; i < marks.length; i++) {
        const tg = marks[i]!;
        const cellWorks = ix.markAt(tg.file, tg.sheet, tg.cells[0] ?? "")?.work_ids ?? [];
        if (lines.length && lines.every((l) => l.work_ids.some((w) => cellWorks.includes(w)))) return q.options.some((o) => o.id === `m${i}`) ? `m${i}` : "m0";
      }
      return "eventOnly";
    }
    case "dateUnknown":
      // 日付の書いていない作業の行に、表の外に書いた期間（工期）を使うか：正解の行の期間は工期の中なので、使う
      if (q.options.some((o) => o.id === "heading")) return "heading";
      return q.options.length === 1 ? (q.options[0]?.id ?? null) : null;
    case "planActualConflict": {
      // 凡例の記号が予定か実績か（列の見出しと凡例が食い違うときも）：その印の正解
      const it = q.items[0];
      const m = it ? ix.markAt(it.file, it.sheet, it.cells[0] ?? "") : null;
      if (!m) return q.options.some((o) => o.id === "exclude") ? "exclude" : null;
      const want = m.status === "planned" ? "plan" : "actual";
      if (q.options.some((o) => o.id === want)) return want;
      return null;
    }
    case "effortConflict": {
      // 資料で違う工数・日数：世界の作業の値と同じ選択肢（無ければ空にする）
      const works = [...new Set(q.items.flatMap((it) => it.cells.flatMap((c) => ix.eventAt(it.file, it.sheet, c)?.work_ids ?? [])))];
      const days = q.text.includes("日数");
      const truth = [...new Set(works.map((w) => (days ? ix.work.get(w)?.duration_days : ix.work.get(w)?.man_days) ?? null))];
      if (truth.length !== 1 || truth[0] === null) return "none";
      const o = q.options.find((x) => x.id.startsWith("v") && Math.abs(Number(x.label) - (truth[0] as number)) < 1e-9);
      return o ? o.id : "none";
    }
    default:
      // 選択肢が 1 つだけの問い（「合わないまま外す」など）は、人もその 1 つを押すしかない。押して先へ進み、結果は物差しが数える。
      // ほかは、正解から答えられない（行き先の決まらないセル・計算済みの値の無い数式など）。開いたままにする
      return q.options.length === 1 ? (q.options[0]?.id ?? null) : null;
  }
}

export interface Script {
  rounds: number;
  answered: Decision[];
  asked: number;
  openAtEnd: QuestionState[];
  /** 正解から答えられず、既定の答えを受けた問い（acceptDefaults のときだけ）。種類ごとの数 */
  defaulted: Record<string, number>;
}

/** 既定の答えを受けたときの理由（正解から答えた問いと分けて数えるため） */
/**
 * 正解の一部しか機器の位置を持たない組（工場 v2 の正解を写した組。v2.ts は、星取表の 1 行 1 機器の行だけに機器を置き、機器台帳の行には置かない）で、
 * 問いを正解から答えられるか。知らない行を「別のもの」「違う」と答えない（答えられない問いに数える）。pack-bench だけが使う
 * - 機器を結ぶ問い（assetLink・assetLinkOne）：問いの行と、結ぶ相手の行の、どちらの機器も正解が知っているときだけ
 * - 番号を分ける問い（tagSplit）は、ここでは止めない：正解に機器の無い行（機器台帳の行）には、前と同じく「分けない」と答える。既定の答え（分ける）に回すと、
 *   さくら坂で未解決が 105 → 27,598 になった（2026-11-12 に測った）。機器台帳の行を正解に写すまでの扱い（mushitaro/moyai#14 の残り）
 * - 「共」の意味の問い（commonMeaning）：工場 v2 の正解は、共通の種類（施設全体・系列の合流・共有の部品）を写していないので、答えない
 */
export function truthKnows(q: QuestionState, ix: Index): boolean {
  if (q.kind === "commonMeaning") return !ix.truth.assets.some((a) => a.name_cleaned);
  if (q.kind !== "assetLink" && q.kind !== "assetLinkOne") return true;
  const known = (it: { file: string; sheet: string | null; cells: string[] } | undefined) => !!it && ix.entityOf(it.file, it.sheet, it.cells[0] ?? "") !== null;
  return q.items.length > 0 && q.items.every((it) => known(it) && (!it.target?.length || known(it.target[0])));
}

export const DEFAULT_REASON = "既定の答えを受けた（台本は正解から答えられない）";

/** 台本の選び。どれも Skillパックの物差し（pack-bench）だけが使う。見ていない様式の測り（heldout）・calibrate・demo は渡さない（測り方を変えない） */
export interface ScriptOptions {
  /**
   * 正解から答えられない問いに既定の答えがあれば、それを受ける（人が推された答えを押すのと同じ。数は defaulted に分けて出す）。
   * 機器を結ぶ問い（assetLink・assetLinkOne）は、問いの行と相手の行の機器を、どちらも正解が知っているときだけ正解から答える（truthKnows。「共」の意味の問いも）。
   * 知らなければ、正解から答えられない問いに数える（工場 v2 の正解を写した組は、機器台帳の行の機器を持たない）
   */
  acceptDefaults?: boolean;
  /**
   * 資料を丸ごと外す答え（参考として外す・読めない資料を外す）は、ほかに答えられる問いが無くなってから押す。
   * 読み手は、ほかの問いの答えを待つセルの多い資料にも、最初から「参考として外すか」を聞くことがある（答えれば読める星取表）。人は先にほかの問いに答える
   */
  deferWholeFile?: boolean;
}

/** 質問がなくなるまで、台本で答える（答えられない質問は開いたまま） */
export function runScript(session: { analyze(): Analysis; settle(ds: Decision[]): unknown }, mk: (an: Analysis) => Index, opt: ScriptOptions = {}): Script {
  const answered = new Map<string, Decision>();
  const defaulted: Record<string, number> = {};
  let rounds = 0;
  let an = session.analyze();
  const ix = mk(an);
  for (; rounds < 30; rounds++) {
    const ds: Decision[] = [];
    for (const q of an.open) {
      if (answered.has(q.questionId)) continue;
      const a = opt.acceptDefaults && !truthKnows(q, ix) ? null : answer(q, ix);
      if (a !== null) ds.push({ questionId: q.questionId, answer: a, author: "human", reason: AUTHOR_REASON });
      else if (opt.acceptDefaults && q.defaultAnswer !== null && q.options.some((o) => o.id === q.defaultAnswer)) {
        ds.push({ questionId: q.questionId, answer: q.defaultAnswer, author: "human", reason: DEFAULT_REASON });
        defaulted[q.kind] = (defaulted[q.kind] ?? 0) + 1;
      }
    }
    if (opt.deferWholeFile) {
      const rest = ds.filter((d) => !WHOLE_FILE_ANSWERS.includes(d.answer));
      if (rest.length) ds.splice(0, ds.length, ...rest);
    }
    if (!ds.length) break;
    for (const d of ds) answered.set(d.questionId, d);
    session.settle(ds);
    an = session.analyze();
  }
  const asked = new Set([...answered.keys(), ...an.open.map((q) => q.questionId)]).size;
  return { rounds, answered: [...answered.values()], asked, openAtEnd: an.open, defaulted };
}

// ─── 物差し ③ 読み取りの正しさ ────────────────────────────────────

export interface Accuracy {
  total: number;
  correct: number;
  extra: number;
  misses: string[];
}
const acc0 = (): Accuracy => ({ total: 0, correct: 0, extra: 0, misses: [] });
export const pct = (a: { correct: number; total: number }) => (a.total ? Math.round((a.correct / a.total) * 10000) / 100 : null);

const where = (p: Placed<{ file: string; at: unknown }>) => `${p.item.file} ${JSON.stringify(p.item.at)}`;

/** 計画の節：その場所を出どころに持つもの */
function nodeAt(plan: Plan, file: string, at: Resolved) {
  return plan.assets.find((a) => a.sources.some((s) => hits(s, file, at))) ?? null;
}

/** 機器の id → その機器を指す正解の場所（資料ごと） */
function equipmentPlaces(ix: Index): Map<string, Placed<Asset>[]> {
  const m = new Map<string, Placed<Asset>[]>();
  for (const p of ix.assets) if (p.item.kind === "equipment" && p.item.equipment_id) m.set(p.item.equipment_id, [...(m.get(p.item.equipment_id) ?? []), p]);
  return m;
}

/** 計画の節 → 世界の機器（正解の場所を出どころに持つか） */
function eqOfNodeFn(plan: Plan, ix: Index) {
  const byKey = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const places = equipmentPlaces(ix);
  return (k: string): string | null => {
    const a = byKey.get(k);
    if (!a) return null;
    for (const [eq, ps] of places) if (ps.some((p) => p.at && a.sources.some((s) => hits(s, p.item.file, p.at!)))) return eq;
    // 台帳も星取表も無い組（機器の記録の行が正解に無い）：日報の名前から作った機器は、出どころの行の正解の機器（1 つに決まるときだけ）
    const eqs = new Set(ix.events.filter((p) => p.at && a.sources.some((s) => hits(s, p.item.file, p.at!))).flatMap((p) => p.item.equipment_ids));
    return eqs.size === 1 ? ([...eqs][0] ?? null) : null;
  };
}

/** 資料ごとの、機器の節の正しさ：節がある・段・親・名前と番号・ほかの資料の同じ機器と同じ節・設置年・仕様 */
export function measureAssets(plan: Plan, ix: Index): Record<string, Accuracy> {
  const out: Record<string, Accuracy> = {};
  const byKey = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const places = equipmentPlaces(ix);
  const namesOf = new Map<string, Set<string>>();
  for (const p of ix.assets) if (p.item.equipment_id && p.item.kind === "equipment") namesOf.set(p.item.equipment_id, (namesOf.get(p.item.equipment_id) ?? new Set()).add(nf(p.item.name ?? p.item.name_text)));
  const src = (f: string) => ix.sources.find((s) => s.file === f);
  for (const p of ix.assets) {
    if (p.item.measure === false) continue;
    const x = p.item;
    const acc = (out[x.file] ??= acc0());
    acc.total++;
    if (!p.at) {
      acc.misses.push(`${where(p)}：${p.why}`);
      continue;
    }
    const a = nodeAt(plan, x.file, p.at);
    const why: string[] = [];
    if (!a) why.push("節が無い");
    else {
      if (x.level !== null && a.level !== x.level) why.push(`段 ${a.level}≠${x.level}`);
      if (x.parent !== undefined) {
        const parent = a.parentKey ? byKey.get(a.parentKey) : null;
        if (x.parent === null) {
          if (parent) why.push("親が余分");
        } else if (x.parent === "exists") {
          if (!parent) why.push("親が無い");
        } else {
          const pr = resolve(src(x.file), x.parent);
          if (!pr.ok) why.push(`親の場所：${pr.why}`);
          else if (!parent || !parent.sources.some((s) => hits(s, x.file, pr.at))) why.push("親が違う");
        }
      }
      // 名前：番号を分けたなら「書いた文字＝名前＋番号（括弧を除く）」、分けていなければ書いた文字か、その資料での呼び名。
      // 資料をまたいで 1 つの節になった機器は、どの資料の呼び名でもよい（節の名前は 1 つしか持てないため）
      const text = nf(x.name_text);
      const alt = x.equipment_id ? (namesOf.get(x.equipment_id) ?? new Set<string>()) : new Set<string>();
      const nameOk = nf(a.name) === nf(x.name ?? "\u0000") || alt.has(nf(a.name)) || (a.tag ? text.includes(nf(a.tag)) && nf(text.replace(nf(a.tag), "").replace(/[()（）［］[\]]/g, "")) === nf(a.name) : nf(a.name) === text);
      // 飾りを除いた名前で書いた正解（name_cleaned）：引き当てたセルの文字そのものの名前も正しい
      const written = x.name_cleaned ? (src(x.file)?.sheets.find((sh) => sh.name === p.at!.sheet)?.cells.find((c) => p.at!.refs.has(c.ref))?.text ?? null) : null;
      const writtenOk = written !== null && (nf(a.name) === nf(written) || (!!a.tag && nf(written).includes(nf(a.tag)) && nf(nf(written).replace(nf(a.tag), "").replace(/[()（）［］[\]]/g, "")) === nf(a.name)));
      if (!nameOk && !writtenOk) why.push(`名前 ${a.name}${a.tag ? `／${a.tag}` : ""}`);
      if (x.kind === "equipment" && x.equipment_id) {
        for (const o of places.get(x.equipment_id) ?? []) {
          if (o === p || !o.at || o.item.file === x.file) continue;
          if (!a.sources.some((s) => hits(s, o.item.file, o.at!))) why.push(`${o.item.file} の同じ機器と結んでいない`);
        }
      }
      if (x.install_year !== undefined && x.install_year !== null && a.installedOn !== String(x.install_year)) why.push(`設置年 ${a.installedOn}`);
      for (const t of x.spec_texts ?? []) if (!a.specs.some((s) => s.value === t)) why.push(`仕様「${t.slice(0, 20)}」が無い`);
    }
    if (why.length) acc.misses.push(`${where(p)}：${why.join("・")}`);
    else acc.correct++;
  }
  return out;
}

/** 資料ごとの、印の正しさ：明細がある・予定と実績・年度・対象の機器・精密機能検査の印。余分＝正解の印でないセルを出どころに持つ明細 */
export function measureMarks(plan: Plan, ix: Index, o: { extraByDetail?: boolean } = {}): Record<string, Accuracy> {
  const out: Record<string, Accuracy> = {};
  const workOf = new Map(plan.works.map((w) => [w.workKey, w]));
  const precisionLabel = ix.world.works.find((w) => w.precision)?.label ?? null;
  const markFiles = new Set(ix.truth.marks.map((m) => m.file));
  const claimed = new Set<string>();
  for (const p of ix.marks) {
    const x = p.item;
    const acc = (out[x.file] ??= acc0());
    // 数えない印（何台もの機器をまとめた行）：正解の印ではあるので、読んだ明細を読みすぎに数えない
    if (x.measure === false) {
      if (p.at) claimed.add(`${x.file}|${p.at.sheet}|${[...p.at.refs][0]}`);
      continue;
    }
    acc.total++;
    if (!p.at) {
      acc.misses.push(`${where(p)}：${p.why}`);
      continue;
    }
    const ds = plan.details.filter((d) => d.sources.some((s) => hits(s, x.file, p.at!)));
    for (const d of ds) claimed.add(`${x.file}|${p.at.sheet}|${[...p.at.refs][0]}`);
    const why: string[] = [];
    if (!ds.length) why.push("明細が無い");
    else {
      const want = x.status === "planned" ? "plan" : "actual";
      if (ds.some((d) => d.planOrActual !== want)) why.push("予定と実績");
      if (ds.some((d) => d.fiscalYear !== x.fiscal_year)) why.push("年度");
      // 印の機器の節：同じ資料の、その機器の名前のセル（同じ行を先に。予定の段と実績の段に分けて書く表は、名前が上の段にだけある）
      const sameEq = ix.assets.filter((a) => a.at && a.item.file === x.file && a.item.kind === "equipment" && a.item.equipment_id === x.equipment_id && a.at.sheet === p.at!.sheet);
      const leafPlace = sameEq.find((a) => a.at!.row === p.at!.row) ?? (sameEq.length === 1 ? sameEq[0] : undefined);
      const leaf = leafPlace?.at ? nodeAt(plan, x.file, leafPlace.at) : null;
      if (ds.some((d) => !workOf.get(d.workKey)?.targets.includes(leaf?.nodeKey ?? "?"))) why.push("対象の機器");
      const wantPrecision = x.work_ids.some((w) => ix.work.get(w)?.precision);
      const hasPrecision = ds.some((d) => nf(workOf.get(d.workKey)?.kind ?? "") === nf(precisionLabel ?? "\u0000"));
      if (wantPrecision !== hasPrecision) why.push("精密機能検査の印");
    }
    if (why.length) acc.misses.push(`${where(p)}：${why.join("・")}`);
    else acc.correct++;
  }
  // 余分：印の資料の、正解の印でないセルを出どころに持つ明細の数（セルごとに 1 つ）。extraByDetail のときは、明細ごと（下）
  for (const f of markFiles) {
    const extra = new Set<string>();
    const known = (s: Detail["sources"][number]) => claimed.has(`${f}|${s.sheet}|${s.cell}`) || ix.events.some((e) => e.at && hits(s, f, e.at));
    for (const d of plan.details) {
      const here = d.sources.filter((s) => s.file === f && s.cell);
      if (o.extraByDetail) {
        // 明細ごと：その資料の出どころのどれも正解の印・行でない明細（出どころの組ごとに 1 つ）。明細は、印のセルのほかに作業の名前のセルも出どころに持つ
        if (here.length > 0 && !here.some(known)) extra.add(here.map((s) => `${s.sheet}|${s.cell}`).sort().join(","));
      } else for (const s of here) if (!known(s)) extra.add(`${s.sheet}|${s.cell}`);
    }
    (out[f] ??= acc0()).extra += extra.size;
  }
  return out;
}

/** 印 1 つが指す作業の数まで合うか（参考） */
export function measureMarkWorkCount(plan: Plan, ix: Index): Accuracy {
  const acc = acc0();
  for (const p of ix.marks) {
    if (p.item.measure === false) continue;
    acc.total++;
    const got = p.at ? plan.details.filter((d) => d.sources.some((s) => hits(s, p.item.file, p.at!))).length : 0;
    if (got === p.item.work_ids.length) acc.correct++;
    else acc.misses.push(`${where(p)}：作業 ${got}≠${p.item.work_ids.length}`);
  }
  return acc;
}

/**
 * 資料ごとの、行（日報・報告書）の正しさ：その行のセルを出どころに持つ明細があり、機器ごとの明細の予定と実績・年度・期間・日数・工数が合う。
 * 一式の行は、機器ごとの明細と、まとめ工事の明細（機器の組・工数・日数）を見る。工数は、同じ明細を出どころに持つ行の工数の和と比べる（日報で 1 つの作業が何日にも分かれるため）。
 * 余分＝正解の行のどれでもないセルを出どころに持つ明細（頭書き・合計の行を記録にしていないか）。
 */
export function measureEvents(plan: Plan, ix: Index): Record<string, Accuracy> {
  const out: Record<string, Accuracy> = {};
  const workOf = new Map(plan.works.map((w) => [w.workKey, w]));
  const eqOf = eqOfNodeFn(plan, ix);
  const targetsOf = (d: Detail) => (workOf.get(d.workKey)?.targets ?? []).map(eqOf);
  const isBundle = (d: Detail) => (workOf.get(d.workKey)?.targets.length ?? 0) > 1;
  const detailsOf = (p: Placed<Event>) => (p.at ? plan.details.filter((d) => d.sources.some((s) => hits(s, p.item.file, p.at!))) : []);
  // 明細ごとの正解の工数：同じ資料の、その明細を出どころに持つ行の工数の和（報告書の行と日報の行が同じ明細でも、資料ごとに比べる）
  const sum = new Map<string, number>();
  const sk = (file: string, d: Detail) => `${file}|${d.detailKey}`;
  for (const p of ix.events) for (const d of detailsOf(p)) if (p.item.man_days !== null && isBundle(d) === p.item.bundle) sum.set(sk(p.item.file, d), (sum.get(sk(p.item.file, d)) ?? 0) + p.item.man_days);
  const seen = new Set<string>();
  for (const p of ix.events) {
    const x = p.item;
    const acc = (out[x.file] ??= acc0());
    acc.total++;
    if (!p.at) {
      acc.misses.push(`${where(p)}：${p.why}`);
      continue;
    }
    const ds = detailsOf(p);
    for (const d of ds) seen.add(d.detailKey);
    const perAsset = ds.filter((d) => targetsOf(d).length === 1);
    const why: string[] = [];
    const want = x.status === "planned" ? "plan" : "actual";
    if (!ds.length) why.push("明細が無い");
    else {
      for (const eq of x.equipment_ids) {
        const d = perAsset.find((z) => targetsOf(z)[0] === eq);
        if (!d) {
          why.push(`機器 ${eq} の明細が無い`);
          continue;
        }
        if (d.planOrActual !== want) why.push("予定と実績");
        if (d.fiscalYear !== x.fiscal_year) why.push(`年度 ${d.fiscalYear}`);
        if (!d.startDate || !d.endDate || d.startDate > x.start || d.endDate < x.end) why.push(`期間 ${d.startDate}〜${d.endDate}`);
        if (x.days !== null && d.days !== x.days) why.push(`日数 ${d.days}≠${x.days}`);
        if (!x.bundle && x.man_days !== null && Math.abs((d.manDays ?? -1) - (sum.get(sk(x.file, d)) ?? -2)) > 1e-6) why.push(`工数 ${d.manDays}≠${sum.get(sk(x.file, d))}`);
      }
      // まとめ工事の明細も、その行の期間を含む（開発用の日報の物差しと同じ）
      if (ds.some((d) => isBundle(d) && (!d.startDate || !d.endDate || d.startDate > x.start || d.endDate < x.end))) why.push("まとめ工事の期間");
      // 1 つの機器の行に、ほかの機器の明細が混ざっていないか
      const extraEq = new Set(perAsset.map((d) => targetsOf(d)[0]).filter((e): e is string => typeof e === "string" && !x.equipment_ids.includes(e)));
      if (extraEq.size) why.push(`ほかの機器 ${[...extraEq].join(",")}`);
      if (x.bundle) {
        const b = ds.find(isBundle);
        if (!b) why.push("まとめ工事の明細が無い");
        else {
          const tg = new Set(targetsOf(b));
          if (x.equipment_ids.some((e) => !tg.has(e)) || tg.size !== x.equipment_ids.length) why.push(`まとめ工事の機器 ${[...tg].join(",")}≠${x.equipment_ids.join(",")}`);
          if (x.man_days !== null && Math.abs((b.manDays ?? -1) - (sum.get(sk(x.file, b)) ?? -2)) > 1e-6) why.push(`まとめ工事の工数 ${b.manDays}≠${sum.get(sk(x.file, b))}`);
          if (x.days !== null && b.days !== x.days) why.push(`まとめ工事の日数 ${b.days}≠${x.days}`);
        }
      }
    }
    if (why.length) acc.misses.push(`${where(p)}：${why.join("・")}`);
    else acc.correct++;
  }
  const eventFiles = new Set(ix.truth.events.map((e) => e.file));
  for (const f of eventFiles) {
    const placed = ix.events.filter((p) => p.item.file === f && p.at);
    for (const d of plan.details) {
      if (seen.has(d.detailKey)) continue;
      if (d.sources.some((s) => s.file === f && s.cell !== null && !placed.some((p) => hits(s, f, p.at!)))) out[f]!.extra++;
    }
  }
  return out;
}

// ─── ⑥ 取り戻せた割合 ─────────────────────────────────────────────────

export interface Recovery {
  denominator: number;
  together: number;
  inPlan: number;
  manDays: { correct: number; total: number };
  days: { correct: number; total: number };
  marksOnly: number;
  notCounted: Record<string, number>;
  misses: string[];
}

/**
 * 分母：世界の実績の作業のうち、この組の資料のどれかに書いてあるもの（写真のように読まなかった資料だけのものは、理由ごとに数える）。
 * 戻せた：その作業の、読んだ資料の場所（印のセル・行）をすべて出どころに持つ実績の明細が 1 つある。
 * 工数：一式でない行に工数が書いてある作業のうち、その明細の工数が世界と同じ。日数：行に日数が書いてある作業のうち、その明細の日数が世界と同じ。
 */
export function measureRecovery(plan: Plan, ix: Index, read: Set<string>, o: { actualMarksOnly?: boolean } = {}): Recovery {
  const out: Recovery = { denominator: 0, together: 0, inPlan: 0, manDays: { correct: 0, total: 0 }, days: { correct: 0, total: 0 }, marksOnly: 0, notCounted: {}, misses: [] };
  const actual = plan.details.filter((d) => d.planOrActual === "actual");
  const workOf = new Map(plan.works.map((w) => [w.workKey, w]));
  const single = (d: Detail) => (workOf.get(d.workKey)?.targets.length ?? 0) === 1;
  // actualMarksOnly：実績の作業の場所は、実績として書いてある印と行。予定として書いてある印（予定の列・実績を書かずに予定のまま残した印）は、その作業をしたという記録ではない
  const placedOf = (w: string) => [...ix.marks.filter((p) => (!o.actualMarksOnly || p.item.status === "actual") && p.item.work_ids.includes(w)), ...ix.events.filter((p) => p.item.work_ids.includes(w))];
  for (const w of ix.world.works) {
    if (w.status !== "actual") continue;
    const all = placedOf(w.id);
    const readPs = all.filter((p) => read.has(p.item.file));
    if (!all.length) {
      out.notCounted["この組のどの資料にも書いていない"] = (out.notCounted["この組のどの資料にも書いていない"] ?? 0) + 1;
      continue;
    }
    if (!readPs.length) {
      const why = `読んでいない資料だけに書いてある（${[...new Set(all.map((p) => p.item.file))].join("・")}）`;
      out.notCounted[why] = (out.notCounted[why] ?? 0) + 1;
      continue;
    }
    out.denominator++;
    const hs = readPs.map((p) => (d: Detail) => !!p.at && d.sources.some((s) => hits(s, p.item.file, p.at!)));
    if (actual.some((d) => hs.some((h) => h(d)))) out.inPlan++;
    const together = actual.filter((d) => hs.every((h) => h(d)));
    const one = together.find((d) => single(d) && d.fiscalYear === w.fiscal_year) ?? together.find(single) ?? together[0];
    if (one) out.together++;
    else out.misses.push(`作業 ${w.id}（${[...new Set(readPs.map((p) => p.item.file))].join("・")}）：1 つの明細にそろっていない`);
    if (readPs.some((p) => "symbol" in p.item && p.item.status === "actual")) out.marksOnly++;
    const evs = readPs.filter((p): p is Placed<Event> => "equipment_ids" in p.item);
    if (evs.some((p) => !p.item.bundle && p.item.man_days !== null && p.item.work_ids.length === 1)) {
      out.manDays.total++;
      if (one && one.manDays === w.man_days) out.manDays.correct++;
      else out.misses.push(`作業 ${w.id}：工数 ${one?.manDays ?? "なし"}≠${w.man_days}`);
    }
    if (evs.some((p) => p.item.days !== null)) {
      out.days.total++;
      if (one && one.days === w.duration_days) out.days.correct++;
      else out.misses.push(`作業 ${w.id}：日数 ${one?.days ?? "なし"}≠${w.duration_days}`);
    }
  }
  return out;
}

// ─── 1 組を走らせる ───────────────────────────────────────────────

export interface FileResult {
  file: string;
  format: string;
  kind: string;
  /** ① 原本の漏れ（比べる相手が無ければ null）と、比べた相手 */
  leak: number | null;
  leakAgainst: string | null;
  leakDetail: string[];
  /** ② 未解決のセル */
  unresolved: number | null;
  rows: { input: number; imported: number; excluded: number; excludedBy?: Record<string, number>; unresolved: number; holds: boolean } | null;
  /** ③ 読み取りの正しさ（機器の節・印・行を合わせたもの） */
  accuracy: Accuracy | null;
  rejected: string | null;
}

export interface SetResult {
  set: string;
  files: FileResult[];
  asked: number;
  answered: number;
  openAtEnd: { kind: string; rows: number; text: string; options?: string[]; defaultAnswer?: string | null }[];
  /** 既定の答えを受けた問いの、種類ごとの数（acceptDefaults のときだけ。answered に含む） */
  defaulted?: Record<string, number>;
  unresolvedBefore: number;
  unresolvedAfter: number;
  planMade: boolean;
  blockers: string[];
  plan: { assets: number; works: number; details: number } | null;
  markWorkCount: { correct: number; total: number } | null;
  recovery: Omit<Recovery, "misses"> & { misses: string[] };
  unplaced: string[];
}

export interface RunOptions {
  /** 読む資料（既定は組の資料のうち、写真でないもの。写真は AI が読むので、この台本では読まない） */
  read?: string[];
  /** ① の相手：資料 → 事実の JSON（openpyxl・Python の csv が取ったもの） */
  facts?: Record<string, unknown>;
  facilityKey?: string;
  /** 当てる読み方（AI を入れた回で、Claude が会話で作った下書き） */
  readings?: LoadedReading[];
  /** 台本の選び（pack-bench だけ。ScriptOptions） */
  acceptDefaults?: boolean;
  deferWholeFile?: boolean;
  /**
   * 工場 v2 の正解を写した組（v2.ts。印は「書いてあるもの」で予定・実績を決める）の数え方（pack-bench だけ。見ていない様式・calibrate・demo の測り方は変えない）：
   * ⑥ の作業の場所は、実績として書いてある印と行だけ。読みすぎは、正解の印・行に 1 つも結ばない明細を数える（作業の名前のセルを読みすぎに数えない）
   */
  asWritten?: boolean;
  /** Skillパック（既定 waste-incineration）。空の文字は「パックなし」（pack-bench の初めて読む測りだけ） */
  packId?: string;
}

export async function runSet(set: LoadedSet, opt: RunOptions = {}): Promise<{ result: SetResult; plan: Plan | null; analysis: Analysis; index: Index; survey: Survey; answered: Decision[] }> {
  const { truth, world } = set;
  const read = opt.read ?? truth.files.filter((f) => f.kind !== "photo").map((f) => f.file);
  const s = new IntakeSession({
    planId: `heldout-${truth.set}`,
    displayName: world.facility.name,
    packId: opt.packId ?? "waste-incineration",
    facility: { facilityKey: opt.facilityKey ?? world.facility.id, name: world.facility.name, fiscalYearStartMonth: 4, scale: null, scaleUnit: null, legalFlags: [], fictional: true, inNationalTable: null },
  });
  if (opt.readings) s.setReadings(opt.readings);
  // 資料の道は資料の置き場所からの相対。ドライブの違う置き場所（Windows の一時のフォルダと作業場所）は相対にできないので、絶対の道のまま
  const bytes = (f: string) => new Uint8Array(readFileSync(isAbsolute(f) ? f : join(set.filesDir ?? join(set.dir, "files"), f)));
  const rejected = await s.add(read.map((n) => ({ name: n, bytes: bytes(n) })));
  const before = s.analyze();
  const unresolvedBefore = [...before.composition.status.values()].filter((x) => x.s === "unresolved").length;
  const script = runScript(s, (an) => new Index(truth, world, an.sources), { acceptDefaults: opt.acceptDefaults, deferWholeFile: opt.deferWholeFile });
  const comp = s.compose();
  const an = s.analyze();
  const ix = new Index(truth, world, an.sources);
  const plan = comp.plan;
  const assets = plan ? measureAssets(plan, ix) : {};
  const marks = plan ? measureMarks(plan, ix, { extraByDetail: opt.asWritten }) : {};
  const events = plan ? measureEvents(plan, ix) : {};
  const files: FileResult[] = [];
  for (const f of truth.files) {
    const fc = comp.counts.find((x) => x.file === f.file);
    const src = an.sources.find((x) => x.file === f.file);
    let leak: number | null = null;
    let leakAgainst: string | null = null;
    let leakDetail: string[] = [];
    const facts = opt.facts?.[f.file];
    if (src && facts) {
      const m = measureFacts(src, facts);
      leak = m.diffs;
      leakAgainst = "事実";
      leakDetail = m.detail;
    } else if (src && f.format === "pdf" && f.source_xlsx) {
      const xr = await readSource({ name: f.source_xlsx, bytes: bytes(f.source_xlsx) });
      if (xr.source) {
        const m = measurePdfAgainstXlsx(src, xr.source as SourceFile);
        leak = m.diffs;
        leakAgainst = `元の xlsx（列の位置のずれ ${m.columnShifts}）`;
        leakDetail = m.detail;
      }
    }
    const parts = [assets[f.file], marks[f.file], events[f.file]].filter((x): x is Accuracy => !!x);
    const accuracy = plan && parts.length ? parts.reduce((a, b) => ({ total: a.total + b.total, correct: a.correct + b.correct, extra: a.extra + b.extra, misses: [...a.misses, ...b.misses] }), acc0()) : null;
    const rej = rejected.find((r) => r.file === f.file);
    files.push({
      file: f.file,
      format: f.format,
      kind: f.kind,
      leak,
      leakAgainst,
      leakDetail: leakDetail.slice(0, 50),
      unresolved: fc?.unresolvedCells ?? null,
      rows: fc ? { input: fc.inputRows, imported: fc.importedRows, excluded: Object.values(fc.excludedRows).reduce((a, b) => a + b, 0), excludedBy: fc.excludedRows, unresolved: fc.unresolvedRows, holds: fc.holds } : null,
      accuracy: accuracy ? { ...accuracy, misses: accuracy.misses.slice(0, 50) } : null,
      rejected: rej ? rej.reason : read.includes(f.file) ? null : "読んでいない（写真は AI が読む）",
    });
  }
  const rc = plan ? measureRecovery(plan, ix, new Set(read), { actualMarksOnly: opt.asWritten }) : measureRecovery({ assets: [], works: [], details: [] } as unknown as Plan, ix, new Set(read), { actualMarksOnly: opt.asWritten });
  const unplaced = [...ix.assets, ...ix.marks, ...ix.events].filter((p) => !p.at).map((p) => `${where(p)}：${p.why}`);
  const result: SetResult = {
    set: truth.set,
    files,
    asked: script.asked,
    answered: script.answered.length,
    openAtEnd: script.openAtEnd.map((q) => ({ kind: q.kind, rows: q.sameShapeRows, text: q.text.slice(0, 200), options: q.options.map((o) => `${o.id}=${o.label}`.slice(0, 80)), defaultAnswer: q.defaultAnswer })),
    ...(opt.acceptDefaults ? { defaulted: script.defaulted } : {}),
    unresolvedBefore,
    unresolvedAfter: [...comp.status.values()].filter((x) => x.s === "unresolved").length,
    planMade: plan !== null,
    blockers: comp.blockers,
    plan: plan ? { assets: plan.assets.length, works: plan.works.length, details: plan.details.length } : null,
    markWorkCount: plan ? (({ correct, total }) => ({ correct, total }))(measureMarkWorkCount(plan, ix)) : null,
    recovery: { ...rc, misses: rc.misses.slice(0, 50) },
    unplaced: unplaced.slice(0, 50),
  };
  return { result, plan: plan ? Plan.parse(plan) : null, analysis: an, index: ix, survey: s.survey(), answered: script.answered };
}
