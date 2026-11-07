// intake_survey の答えの大きさを、AI の 1 回の結果の上限の内に収める（橋渡しの側。作業画面が返した要約を、AI に渡す前に分ける）。
// 質問が多いときは、質問を同じ形ごとにまとめた要約（形・件数・代表の 1 問）と、続きを読む道（part: questions と cursor、か limit）を返す。
// 同じ選択肢の並びは、1 回目の質問だけに書き、2 回目からは sameOptionsAs でその質問を指す（同じ答えの中だけ）。
// 見本・詰まっている所・注記・凡例・資料の一覧は、収まらなければ短くし、短くしたことを注記の先頭に書く（黙って落とさない）。
import { SURVEY_MAX_BYTES } from "../shared/tools";

type Question = { questionId: string; kind: string; text: string; sameShapeRows: number; options: unknown[]; sameOptionsAs?: string } & Record<string, unknown>;
type Group = { kind: string; shape: string; count: number; rows: number; example: { questionId: string; text: string } };
type Stuck = { fileRef: string; cells: number; header: { row: number; cells: string[] }[]; rows: { cells: string[]; unresolved: string[] }[] } & Record<string, unknown>;
type Sample = { fileRef: string; row: number; cells: string[] };

export interface SurveyPageOptions {
  part: string;
  /** 何件目の質問から載せるか（0 から）。省けば 0 */
  cursor?: number;
  /** 載せる質問の数の上限。省けば大きさの上限まで */
  limit?: number;
  /** 答えの大きさの上限（UTF-8 のバイト）。試験のほかは省く */
  maxBytes?: number;
}

/** 形の要約の数の上限（多い形から）と、代表の 1 問の文の長さ（字） */
export const SURVEY_GROUPS_MAX = 20;
const GROUP_TEXT = 120;
/** 選択肢の並びを sameOptionsAs で指す下限の数（短い並びはそのまま書く） */
const SHARE_OPTIONS_MIN = 3;
/** 先頭に足す注記の分（短くするときに残しておく大きさ） */
const NOTE_ROOM = 600;

const enc = new TextEncoder();
export const jsonBytes = (x: unknown): number => enc.encode(JSON.stringify(x)).length;

/** 質問のほかの欄を、上限に収まるまで順に短くする手（どれも、何を短くしたかを返す） */
const SHRINK: ((d: Record<string, unknown>) => string | null)[] = [
  (d) => cutStuck(d, { files: 20, header: 1, rows: 2, cells: 20, unresolved: 10 }),
  (d) => cutSamples(d, { rows: 20, cells: 20 }),
  (d) => cutList(d, "legends", 30, (x) => JSON.stringify(x)),
  (d) => cutList(d, "notes", 30),
  (d) => cutStuck(d, { files: 8, header: 1, rows: 1, cells: 12, unresolved: 6 }),
  (d) => cutSamples(d, { rows: 10, cells: 12 }),
  (d) => {
    if (d.crosswalk === null || d.crosswalk === undefined) return null;
    d.crosswalk = null;
    return "紐付けの要約（part: crosswalk で読む）";
  },
  (d) => cutList(d, "files", 40),
  (d) => cutList(d, "notes", 10),
  (d) => cutStuck(d, { files: 3, header: 0, rows: 1, cells: 8, unresolved: 4 }),
  (d) => cutSamples(d, { rows: 5, cells: 8 }),
  (d) => cutList(d, "legends", 10, (x) => JSON.stringify(x)),
  (d) => cutList(d, "files", 10),
];

function cutList(d: Record<string, unknown>, key: string, max: number, dedupeKey?: (x: unknown) => string): string | null {
  const xs = d[key];
  if (!Array.isArray(xs)) return null;
  let ys = xs;
  if (dedupeKey) {
    const seen = new Set<string>();
    ys = xs.filter((x) => {
      const k = dedupeKey(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (ys.length > max) ys = ys.slice(0, max);
  if (ys.length === xs.length) return null;
  d[key] = ys;
  const label: Record<string, string> = { legends: "凡例", notes: "注記", files: "資料の一覧" };
  return `${label[key] ?? key}（${xs.length} のうち ${ys.length}）`;
}

function cutSamples(d: Record<string, unknown>, lim: { rows: number; cells: number }): string | null {
  const xs = d.samples as Sample[] | undefined;
  if (!Array.isArray(xs)) return null;
  const ys = xs.slice(0, lim.rows).map((s) => (s.cells.length > lim.cells ? { ...s, cells: s.cells.slice(0, lim.cells) } : s));
  if (ys.length === xs.length && ys.every((s, i) => s === xs[i])) return null;
  d.samples = ys;
  return `見本の行（${xs.length} 行のうち ${ys.length} 行、1 行 ${lim.cells} セルまで）`;
}

function cutStuck(d: Record<string, unknown>, lim: { files: number; header: number; rows: number; cells: number; unresolved: number }): string | null {
  const xs = d.stuck as Stuck[] | undefined;
  if (!Array.isArray(xs)) return null;
  let changed = xs.length > lim.files;
  const ys = xs.slice(0, lim.files).map((s) => {
    const header = s.header.slice(0, lim.header).map((h) => (h.cells.length > lim.cells ? { ...h, cells: h.cells.slice(0, lim.cells) } : h));
    const rows = s.rows.slice(0, lim.rows).map((r) => (r.cells.length > lim.cells || r.unresolved.length > lim.unresolved ? { ...r, cells: r.cells.slice(0, lim.cells), unresolved: r.unresolved.slice(0, lim.unresolved) } : r));
    if (header.length !== s.header.length || rows.length !== s.rows.length || header.some((h, i) => h !== s.header[i]) || rows.some((r, i) => r !== s.rows[i])) changed = true;
    return { ...s, header, rows };
  });
  if (!changed) return null;
  d.stuck = ys;
  return `詰まっている所（${xs.length} 資料のうち ${ys.length}、見本の行は資料ごとに ${lim.rows} 行まで）`;
}

/** sameOptionsAs で指した選択肢の並びを、その質問に書き戻す（指す先が無ければ空のまま） */
function expandOptions(qs: Question[]): Question[] {
  const byId = new Map(qs.filter((q) => q.options.length > 0).map((q) => [q.questionId, q.options]));
  return qs.map((q) => {
    if (q.sameOptionsAs === undefined) return q;
    const { sameOptionsAs, ...rest } = q;
    return { ...rest, options: byId.get(sameOptionsAs) ?? [] } as Question;
  });
}

/** 同じ選択肢の並びは、この答えの中で先に出た質問だけに書き、後の質問は sameOptionsAs でその質問を指す */
function shareOptions(qs: Question[]): Question[] {
  const first = new Map<string, string>();
  return qs.map((q) => {
    if (q.options.length < SHARE_OPTIONS_MIN) return q;
    const k = JSON.stringify(q.options);
    const id = first.get(k);
    if (id === undefined) {
      first.set(k, q.questionId);
      return q;
    }
    return { ...q, options: [], sameOptionsAs: id };
  });
}

/**
 * intake_survey の答え（出力の型で確かめたもの）を、上限の内に収める。part: skills の本文は分けない（別の上限で縛る）。
 * cursor か limit を渡したとき・質問が収まらないときは questionsPage を添える。質問を分けたときは questionGroups（多い形から 20 まで）も添える
 */
export function pageSurvey(input: Record<string, unknown>, opts: SurveyPageOptions): Record<string, unknown> {
  const max = opts.maxBytes ?? SURVEY_MAX_BYTES;
  const d: Record<string, unknown> = { ...input };
  const groupsAll = (Array.isArray(d.questionGroups) ? d.questionGroups : []) as Group[];
  delete d.questionGroups;
  if (opts.part === "skills") return d;
  // 作業画面は、同じ選択肢の並びを先の質問だけに書いて送る（sameOptionsAs）。分ける前に戻し、答えごとに書き直す
  const all = expandOptions((Array.isArray(d.questions) ? d.questions : []) as Question[]);
  const asksQuestions = opts.part === "all" || opts.part === "questions";
  if (!asksQuestions) {
    d.questions = [];
    return fitBase(d, max, []);
  }
  const cursor = Math.min(Math.max(0, Math.floor(opts.cursor ?? 0)), all.length);
  const limit = opts.limit === undefined ? all.length : Math.max(1, Math.floor(opts.limit));
  const wanted = all.slice(cursor, cursor + limit);
  // 続きを読むとき（cursor が 1 以上）は、質問のほかの欄（見本・詰まっている所・注記・凡例）を載せない（もう読んだもの）
  if (cursor > 0) {
    d.samples = [];
    d.stuck = [];
    d.notes = [];
    d.legends = [];
  }
  const whole = { ...d, questions: shareOptions(wanted) };
  const paged = cursor > 0 || wanted.length < all.length;
  if (!paged && jsonBytes(whole) <= max) return whole;

  // 収まらない・分けて読むとき：ほかの欄を短くし（上限のおよそ半分まで）、残りに入るだけ質問を入れる。
  // 載せきれないときは、形の要約と続きを読む道を添える
  const groups = groupsAll.slice(0, SURVEY_GROUPS_MAX).map((g) => ({ ...g, example: { ...g.example, text: g.example.text.slice(0, GROUP_TEXT) } }));
  const base: Record<string, unknown> = { ...d, questions: [], questionGroups: groups, questionsPage: { total: all.length, cursor, returned: 0, nextCursor: null } };
  const cut: string[] = [];
  for (const step of SHRINK) {
    if (jsonBytes(base) + NOTE_ROOM <= max / 2) break;
    const what = step(base);
    if (what) cut.push(what);
  }
  const notes = Array.isArray(base.notes) ? (base.notes as string[]) : [];
  const make = (k: number): Record<string, unknown> => {
    const next = cursor + k < all.length ? cursor + k : null;
    const split = paged || next !== null;
    const head = [
      split
        ? `質問は ${all.length} 件。ここに載せたのは ${k ? `${cursor + 1}〜${cursor + k}` : "0"} 件目（1 回の答えの大きさの上限 ${Math.round(max / 1000)} KB のため分けて返す）。` +
          (next !== null ? `続きは intake_survey（part: questions、cursor: ${next}）で読む。questionGroups は同じ形の質問の件数と代表の 1 問。` : "")
        : "",
      cut.length ? `大きさの上限のため短くした欄：${cut.join("・")}。` : "",
    ].join("");
    const out: Record<string, unknown> = { ...base, questions: shareOptions(wanted.slice(0, k)), notes: head ? [head, ...notes] : notes };
    if (split) out.questionsPage = { total: all.length, cursor, returned: k, nextCursor: next };
    else {
      delete out.questionsPage;
      delete out.questionGroups;
    }
    return out;
  };
  // 1 件ずつ測ると質問が多いときに遅いので、1 件ごとの大きさを足して見積もり、最後に測って確かめる（外れたら減らす）
  const sizes = shareOptions(wanted).map((q) => jsonBytes(q) + 1);
  let room = max - jsonBytes(make(0));
  let n = 0;
  for (const sz of sizes) {
    if (sz > room) break;
    room -= sz;
    n++;
  }
  let best = make(n);
  while (n > 0 && jsonBytes(best) > max) best = make(--n);
  return jsonBytes(best) > max ? lastResort(best, max) : best;
}

/** 質問を載せない答え（part: compose・crosswalk）を上限に収める */
function fitBase(d: Record<string, unknown>, max: number, cut: string[]): Record<string, unknown> {
  for (const step of SHRINK) {
    if (jsonBytes(d) <= max) break;
    const what = step(d);
    if (what) cut.push(what);
  }
  if (cut.length) d.notes = [`1 回の答えの大きさの上限 ${Math.round(max / 1000)} KB のため短くした欄：${cut.join("・")}。`, ...(Array.isArray(d.notes) ? (d.notes as string[]) : [])];
  return jsonBytes(d) > max ? lastResort(d, max) : d;
}

/** どう短くしても収まらないとき（資料の名前が長く多いなど）：一覧を空にし、そのことを注記に書く */
function lastResort(d: Record<string, unknown>, max: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...d, samples: [], stuck: [], legends: [], files: [], notes: [] };
  out.notes = [`1 回の答えの大きさの上限 ${Math.round(max / 1000)} KB に収まらないので、資料の一覧・見本・詰まっている所・凡例・注記を載せていない。part: questions か part: compose で分けて読む。`];
  if (jsonBytes(out) > max) out.crosswalk = null;
  if (jsonBytes(out) > max) {
    out.questions = [];
    out.questionGroups = [];
  }
  return out;
}
