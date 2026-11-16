// 書類の一般の手がかりの語（packs/_cues/cues.json）を読み、比べる道具にする。語はコードに置かない。
// import attribute：受け口（services/ledger-intake）の feedback.ts が読み方の形を確かめるので、e2e の台本（Playwright）が直に読み込む（src/share/ledger-place.ts と同じ）
import cuesJson from "../../packs/_cues/cues.json" with { type: "json" };
import { nfkc, parseDateText, parseYearLabel } from "./era";

export const CUES = cuesJson;

/** 比べるための形の覚え（nfkc と同じ。上限を越えたら空にする） */
const NORM_MEMO = new Map<string, string>();
const NORM_MEMO_MAX = 200_000;

/** 比べるための形：NFKC にし、空白をすべて除く */
export function norm(s: string): string {
  const hit = NORM_MEMO.get(s);
  if (hit !== undefined) return hit;
  const v = nfkc(s).replace(/[\s　]+/g, "");
  if (NORM_MEMO.size >= NORM_MEMO_MAX) NORM_MEMO.clear();
  NORM_MEMO.set(s, v);
  return v;
}

const normList = (xs: readonly string[]) => xs.map(norm).filter((x) => x !== "");

const sets = {
  subtotal: normList(CUES.rowRole.subtotal),
  total: normList(CUES.rowRole.total),
  totalExact: normList(CUES.rowRole.totalExact),
  legend: normList(CUES.rowRole.legend),
  notePrefix: normList(CUES.rowRole.notePrefix),
  continued: normList(CUES.rowRole.continued),
  asOf: normList(CUES.rowRole.asOf),
  count: normList(CUES.rowRole.count),
  actual: normList(CUES.planActual.actual),
  plan: normList(CUES.planActual.plan),
  ditto: normList(CUES.ditto),
  common: normList(CUES.common),
  set: normList(CUES.set),
  fictional: normList(CUES.fictional),
};

export type ColumnCue = keyof typeof CUES.column;
/** 列の役目の手がかりの語（比べる形にしたもの。column が呼ばれるたびに作り直さない） */
const columnLists = (Object.entries(CUES.column) as [ColumnCue, string[]][]).map(([k, words]) => [k, normList(words)] as const);

/** 契約の一覧の欄（packs/_cues/cues.json の contract。説明と単価契約の印を除く） */
export type ContractField = Exclude<keyof typeof CUES.contract, "note" | "unitPrice">;
const contractLists = (Object.entries(CUES.contract) as [string, unknown][])
  .filter((e): e is [ContractField, string[]] => e[0] !== "note" && e[0] !== "unitPrice" && Array.isArray(e[1]))
  .map(([k, ws]) => [k, normList(ws)] as const);
const unitPriceWords = normList(CUES.contract.unitPrice);
/** 発注明細の欄（packs/_cues/cues.json の orderLine。説明を除く） */
export type OrderLineField = Exclude<keyof typeof CUES.orderLine, "note">;
const orderLineLists = (Object.entries(CUES.orderLine) as [string, unknown][])
  .filter((e): e is [OrderLineField, string[]] => e[0] !== "note" && Array.isArray(e[1]))
  .map(([k, ws]) => [k, normList(ws)] as const);
const dittoWords = normList(CUES.ditto);

/** 見出しの語から列の役目の手がかり（cue.column の中身。覚えは cue.column が持つ） */
const COLUMN_MEMO = new Map<string, ColumnCue | null>();
function columnOf(header: string): ColumnCue | null {
  const h = stripParen(norm(header));
  if (!h) return null;
  // 字が英語だけの見出し（「Tag No.」）は、語ごとに比べる英語の手がかりを先に見る（字の頭と終わりで比べると「No.」が先に当たる）
  // 英語の手がかりで決まらなければ、日本語の手がかりの語と同じ字のものだけを取る（「Nozzle」を「No」の番号にしない）
  if (LATIN_ONLY.test(nfkc(header))) return enColumnOf(header) ?? columnLists.find(([, words]) => words.includes(h))?.[0] ?? null;
  // 年や日付そのもの（「令和8年度」「2026/10/01」）は見出しの語ではなく値
  if (parseYearLabel(h) !== null || parseDateText(h) !== null) return null;
  let best: { k: ColumnCue; len: number } | null = null;
  for (const [k, words] of columnLists) {
    for (const w of words) {
      if (h === w || h.startsWith(w) || h.endsWith(w)) {
        const len = w.length + (h === w ? 100 : 0);
        if (!best || len > best.len) best = { k, len };
      }
    }
  }
  return best?.k ?? enColumnOf(header);
}

// ─── 英語の手がかり（packs/_cues/cues.json の en。グローバル対応の段 1b、2026-11-16）────────────
// 語ごとに比べる（NFKC・小文字。語を分けたまま比べるので「no」が「notes」に当たらない）。
// 日本語の手がかりで決まらないときだけ見るので、日本語の資料の読みは変わらない。
const EN = CUES.en;
const HAS_LATIN = /[A-Za-z]/;
/** 字が英語の字・数字・記号だけ（日本語の字が無い） */
const LATIN_ONLY = /^(?=.*[A-Za-z])[\x20-\x7e]+$/;
/** 英語の語の並び：NFKC・小文字にして、空白・区切りの記号で分ける */
export function enTokens(s: string): string[] {
  return nfkc(s)
    .toLowerCase()
    .split(/[\s　_:;,()（）[\]{}]+/u)
    .map((w) => w.replace(/^[.'"]+|['".]+$/g, ""))
    .filter((w) => w !== "");
}
const enPhrases = (xs: readonly string[]) => xs.map(enTokens).filter((p) => p.length > 0);
const startsWithWords = (h: readonly string[], p: readonly string[]) => p.length <= h.length && p.every((w, i) => h[i] === w);
const endsWithWords = (h: readonly string[], p: readonly string[]) => p.length <= h.length && p.every((w, i) => h[h.length - p.length + i] === w);
const sameWords = (h: readonly string[], p: readonly string[]) => p.length === h.length && startsWithWords(h, p);
const containsWords = (h: readonly string[], p: readonly string[]) => {
  for (let i = 0; i + p.length <= h.length; i++) if (p.every((w, j) => h[i + j] === w)) return true;
  return false;
};
const phraseLen = (p: readonly string[]) => p.join(" ").length;
const enSets = {
  subtotal: enPhrases(EN.rowRole.subtotal),
  total: enPhrases(EN.rowRole.total),
  legend: enPhrases(EN.rowRole.legend),
  continued: enPhrases(EN.rowRole.continued),
  notePrefix: EN.rowRole.notePrefix.map((w) => nfkc(w).toLowerCase()),
  actual: enPhrases(EN.planActual.actual),
  plan: enPhrases(EN.planActual.plan),
  ditto: EN.ditto.map((w) => nfkc(w).toLowerCase()),
  manDays: enPhrases(EN.headerUnit.manDays),
  hours: enPhrases(EN.headerUnit.hours),
};
const enColumnLists = (Object.entries(EN.column) as [ColumnCue, string[]][]).map(([k, ws]) => [k, enPhrases(ws)] as const);
const enContains = (t: string, list: readonly (readonly string[])[]) => {
  if (!HAS_LATIN.test(t)) return false;
  const h = enTokens(t);
  return list.some((p) => containsWords(h, p));
};
/** 末尾の括弧を除く（空白を残したまま。英語の語の比べ方のため）。除くと空になるなら除かない */
function stripParenRaw(h: string): string {
  const s = h.replace(/\s*[(（〔［[【][^()（）〔〕［］[\]【】]*[)）〕］\]】]\s*$/u, "");
  return s.trim() ? s : h;
}
/** 英語の見出しの列の役目：語の並びが同じ（優先）か、頭か終わりの語が同じ。長い語を優先 */
function enColumnOf(header: string): ColumnCue | null {
  if (!HAS_LATIN.test(header)) return null;
  const h = enTokens(stripParenRaw(nfkc(header)));
  if (!h.length) return null;
  let best: { k: ColumnCue; len: number } | null = null;
  for (const [k, phrases] of enColumnLists) {
    for (const p of phrases) {
      const exact = sameWords(h, p);
      if (exact || startsWithWords(h, p) || endsWithWords(h, p)) {
        const len = phraseLen(p) + (exact ? 100 : 0);
        if (!best || len > best.len) best = { k, len };
      }
    }
  }
  return best?.k ?? null;
}
/** 英語の見出しの終わりの語だけで当たる役目（語そのものの見出しは除く。長い語を優先） */
function enColumnTail(header: string): ColumnCue | null {
  if (!HAS_LATIN.test(header)) return null;
  const h = enTokens(stripParenRaw(nfkc(header)));
  let best: { k: ColumnCue; len: number } | null = null;
  for (const [k, phrases] of enColumnLists)
    for (const p of phrases) if (p.length < h.length && endsWithWords(h, p) && (!best || phraseLen(p) > best.len)) best = { k, len: phraseLen(p) };
  return best?.k ?? null;
}
/** 英語の見出しの工数の単位：括弧の中の語か、見出しの終わりの語 */
function enHeaderUnit(header: string): "manDays" | "hours" | null {
  if (!HAS_LATIN.test(header)) return null;
  const s = nfkc(header);
  const paren = /[(（]([^()（）]*)[)）]\s*$/u.exec(s)?.[1] ?? null;
  if (paren !== null) {
    const ts = enTokens(paren);
    if (enSets.manDays.some((p) => sameWords(ts, p))) return "manDays";
    if (enSets.hours.some((p) => sameWords(ts, p))) return "hours";
  }
  const bare = enTokens(stripParenRaw(s));
  if (enSets.manDays.some((p) => endsWithWords(bare, p))) return "manDays";
  if (enSets.hours.some((p) => endsWithWords(bare, p))) return "hours";
  return null;
}
/** 英語の実績・予定の語（頭か終わりの語）。両方を含む・どちらも無いときは null */
function enPlanActual(t: string): "plan" | "actual" | null {
  if (!HAS_LATIN.test(t)) return null;
  const h = enTokens(t);
  const on = (ps: readonly (readonly string[])[]) => ps.some((p) => startsWithWords(h, p) || endsWithWords(h, p));
  const a = on(enSets.actual);
  const p = on(enSets.plan);
  if (a === p) return null;
  return a ? "actual" : "plan";
}
/** 英語の実績・予定の語を両方含む文の、終わりの語（planActualHead の英語の版） */
function enPlanActualHead(t: string): "plan" | "actual" | null {
  if (!HAS_LATIN.test(t)) return null;
  const h = enTokens(t.replace(/[。.、,]+\s*$/u, ""));
  const len = (ps: readonly (readonly string[])[]) => ps.filter((p) => endsWithWords(h, p)).reduce((m, p) => Math.max(m, phraseLen(p)), 0);
  const a = len(enSets.actual);
  const p = len(enSets.plan);
  if (a === p) return null;
  return a > p ? "actual" : "plan";
}

export function containsAny(text: string, list: readonly string[]): boolean {
  const t = norm(text);
  return list.some((w) => t.includes(w));
}

export const cue = {
  isSubtotal: (t: string) => containsAny(t, sets.subtotal) || enContains(t, enSets.subtotal),
  // 「延人員 計」のように、列の名前と「計」を空白で分けた書き方も合計
  // 末尾に単位の括弧を添えた書き方（「年度別概算費用　計（千円）」）も同じ
  isTotal: (t: string) =>
    containsAny(t, sets.total) || sets.totalExact.includes(norm(t)) || /\S[\s　]+計(?:\s*[(（][^()（）]*[)）])?$/u.test(nfkc(t)) || enContains(t, enSets.total),
  /** 件数の行（「件数」）：表の行の数を書いたもの */
  isCount: (t: string) => sets.count.includes(norm(t)),
  isLegendTitle: (t: string) => containsAny(t, sets.legend) || enContains(t, enSets.legend),
  /** 凡例の見出しの語を除いた文字（同じセルに「○：予定」などが続く書き方のため） */
  stripLegendTitle(t: string): string {
    let s = nfkc(t);
    for (const w of CUES.rowRole.legend) s = s.split(nfkc(w)).join("");
    for (const w of EN.rowRole.legend) s = s.replace(new RegExp(`(^|[^A-Za-z])${escapeRe(w)}(?![A-Za-z])\\s*:?`, "gi"), "$1");
    return s;
  },
  isNote: (t: string) => sets.notePrefix.some((p) => norm(t).startsWith(p)) || enSets.notePrefix.some((p) => nfkc(t).trim().toLowerCase().startsWith(p)),
  isContinued: (t: string) => containsAny(t, sets.continued) || enContains(t, enSets.continued),
  /** 続きの印（「（続き）」など）を除いた文字（頁ごとにくり返す題を 1 頁目の題と比べるため） */
  stripContinued(t: string): string {
    let s = nfkc(t);
    for (const w of CUES.rowRole.continued) s = s.replace(new RegExp(`[(（]?\\s*${escapeRe(nfkc(w))}\\s*[)）]?`, "g"), "");
    return s.trim();
  },
  isAsOf: (t: string) => containsAny(t, sets.asOf),
  isDitto: (t: string) => sets.ditto.includes(norm(t)) || enSets.ditto.includes(nfkc(t).trim().toLowerCase()),
  isCommon: (t: string) => sets.common.includes(norm(t)),
  hasFictionalMark: (t: string) => containsAny(t, sets.fictional),
  /** 実績・予定の語。両方を含む・どちらも無いときは null */
  planActual(t: string): "plan" | "actual" | null {
    const n = norm(t);
    const a = sets.actual.some((w) => n === w || n.endsWith(w) || n.startsWith(w));
    const p = sets.plan.some((w) => n === w || n.endsWith(w) || n.startsWith(w));
    if (!a && !p) return enPlanActual(t);
    if (a === p) return null;
    return a ? "actual" : "plan";
  },
  /**
   * 実績・予定の語を両方含む文（凡例「計画どおり実施」「実施予定」）の、述語の語：文の終わりの語がどちらか。
   * 日本語の句は終わりの語が述語（「計画どおり」は「実施」にかかる）。終わりがどちらの語でもなければ null
   */
  planActualHead(t: string): "plan" | "actual" | null {
    const n = norm(t).replace(/[。.、,]+$/u, "");
    const a = sets.actual.filter((w) => n.endsWith(w)).reduce((m, w) => Math.max(m, w.length), 0);
    const p = sets.plan.filter((w) => n.endsWith(w)).reduce((m, w) => Math.max(m, w.length), 0);
    if (a === 0 && p === 0) return enPlanActualHead(t);
    if (a === p) return null;
    return a > p ? "actual" : "plan";
  },
  /** 見出しの語から列の役目の手がかり（一致した語の長いもの優先）。末尾の括弧（単位など：「工数(人日)」「延工数(h)」）は除いて比べる */
  column(header: string): ColumnCue | null {
    const hit = COLUMN_MEMO.get(header);
    if (hit !== undefined) return hit;
    const v = columnOf(header);
    if (COLUMN_MEMO.size >= NORM_MEMO_MAX) COLUMN_MEMO.clear();
    COLUMN_MEMO.set(header, v);
    return v;
  },
  /** 見出しの終わりの語（複合語の頭：「作業区分」の「区分」）だけで当たる役目（語そのものの見出しは除く。長い語を優先）。無ければ null */
  columnTail(header: string): ColumnCue | null {
    const h = stripParen(norm(header));
    let best: { k: ColumnCue; len: number } | null = null;
    for (const [k, words] of columnLists) for (const w of words) if (h !== w && h.endsWith(w) && (!best || w.length > best.len)) best = { k, len: w.length };
    return best?.k ?? enColumnTail(header);
  },
  /** その役目の見出しの語（そろえた文字） */
  words: (k: ColumnCue): string[] => normList(CUES.column[k]),
  /** 見出しに書いた工数の単位（「工数(人日)」→ 人・日、「延工数(h)」「時間」→ 時間）。書いていなければ null */
  headerUnit(header: string): "manDays" | "hours" | null {
    const h = norm(header);
    const paren = /[(（]([^()（）]*)[)）]$/.exec(h)?.[1] ?? null;
    const inParen = (ws: readonly string[]) => paren !== null && ws.some((w) => norm(w).toLowerCase() === paren.toLowerCase());
    // 単位の語の後ろの計の語（「人工計」「延べ時間合計」）は、単位を変えない
    const totals = normList([...CUES.rowRole.total, ...CUES.rowRole.totalExact]).sort((a, b) => b.length - a.length);
    const dropTotal = (s: string) => {
      const t = totals.find((w) => s.length > w.length && s.endsWith(w));
      return t ? s.slice(0, -t.length) : s;
    };
    const bareH = dropTotal(stripParen(h));
    // 延べの人数の見出し（「延人員」）は、人・日を数えたもの
    if (CUES.headerUnit.manDays.some((w) => norm(w).length >= 3 && bareH.endsWith(norm(w)))) return "manDays";
    if (inParen(CUES.headerUnit.manDays)) return "manDays";
    if (inParen(CUES.headerUnit.hours)) return "hours";
    // 括弧が無いとき：見出しそのものが単位の語を含む（「延べ時間」「作業時間」）。人・日の単位の語そのもの（「人工」「人日」）も人・日
    const bare = bareH;
    if (CUES.headerUnit.manDays.some((w) => bare.endsWith(norm(w)))) return "manDays";
    if (CUES.headerUnit.hours.some((w) => norm(w).length > 1 && bare.endsWith(norm(w)))) return "hours";
    return enHeaderUnit(header);
  },
  /** 一式の印（「（一式）」など）を除いた文字と、印があったか */
  stripSet(t: string): { text: string; set: boolean } {
    let s = nfkc(t);
    let set = false;
    for (const w of CUES.set) {
      const re = new RegExp(`[(（]?\\s*${escapeRe(w)}\\s*[)）]?`, "g");
      if (re.test(s)) {
        set = true;
        s = s.replace(re, "");
      }
    }
    return { text: s.trim(), set };
  },
  listSeparators: CUES.listSeparators,
  commonMeanings: CUES.commonMeanings,
  /**
   * 契約の一覧の欄の語（見出しの段の並びから）。2 段の見出しは「上の段(下の段)」の形でも比べる（「工期」の下に「着手」「完了」）。
   * 見出しはそのまま・末尾の括弧（単位「（円）」・税の扱いなど）を 1 つか 2 つ除いた形で、語と同じものだけを取る。無ければ null
   */
  contract(parts: readonly string[]): ContractField | null {
    return headerHit(parts, contractLists);
  },
  /** 発注明細の欄の語（見出しの比べ方は契約の一覧と同じ）。無ければ null */
  orderLine(parts: readonly string[]): OrderLineField | null {
    return headerHit(parts, orderLineLists);
  },
  /** 単価契約の印（件名・契約方法・区分に書いたもの） */
  isUnitPrice: (t: string) => containsAny(t, unitPriceWords),
  /** 「〃」で始まる字（変更契約の行「〃（第1回変更）」：上の行と同じ契約） */
  startsWithDitto: (t: string) => dittoWords.some((w) => norm(t).startsWith(w)),
};

/**
 * 見出しの段の並びを、欄の語の一覧と比べる。2 段の見出しは「上の段(下の段)」の形でも比べる。
 * 見出しはそのまま・末尾の括弧を 1 つか 2 つ除いた形で、語と同じものだけを取る。無ければ null
 */
function headerHit<K extends string>(parts: readonly string[], lists: readonly (readonly [K, string[]])[]): K | null {
  const ps = parts.map(norm).filter((p) => p !== "");
  if (!ps.length) return null;
  const first = ps[0] ?? "";
  const last = ps[ps.length - 1] ?? "";
  const forms = [...(ps.length >= 2 ? [`${first}(${last})`] : []), last, first, ps.join("")];
  for (const f of forms) {
    const once = stripParen(f);
    for (const h of [f, once, stripParen(once)]) {
      const hit = lists.find(([, ws]) => ws.includes(h));
      if (hit) return hit[0];
    }
  }
  return null;
}

/** 末尾の括弧（単位・番号など：() （） 〔〕 ［］ [] 【】）を除く。除くと空になるなら除かない */
function stripParen(h: string): string {
  const s = h.replace(/[(（〔［[【][^()（）〔〕［］[\]【】]*[)）〕］\]】]$/u, "");
  return s || h;
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
