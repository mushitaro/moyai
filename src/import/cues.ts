// 書類の一般の手がかりの語（packs/_cues/cues.json）を読み、比べる道具にする。語はコードに置かない。
import cuesJson from "../../packs/_cues/cues.json";
import { nfkc, parseDateText, parseYearLabel } from "./era";

export const CUES = cuesJson;

/** 比べるための形：NFKC にし、空白をすべて除く */
export function norm(s: string): string {
  return nfkc(s).replace(/[\s　]+/g, "");
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

export function containsAny(text: string, list: readonly string[]): boolean {
  const t = norm(text);
  return list.some((w) => t.includes(w));
}

export const cue = {
  isSubtotal: (t: string) => containsAny(t, sets.subtotal),
  // 「延人員 計」のように、列の名前と「計」を空白で分けた書き方も合計
  isTotal: (t: string) => containsAny(t, sets.total) || sets.totalExact.includes(norm(t)) || /\S[\s　]+計$/u.test(nfkc(t)),
  /** 件数の行（「件数」）：表の行の数を書いたもの */
  isCount: (t: string) => sets.count.includes(norm(t)),
  isLegendTitle: (t: string) => containsAny(t, sets.legend),
  /** 凡例の見出しの語を除いた文字（同じセルに「○：予定」などが続く書き方のため） */
  stripLegendTitle(t: string): string {
    let s = nfkc(t);
    for (const w of CUES.rowRole.legend) s = s.split(nfkc(w)).join("");
    return s;
  },
  isNote: (t: string) => sets.notePrefix.some((p) => norm(t).startsWith(p)),
  isContinued: (t: string) => containsAny(t, sets.continued),
  /** 続きの印（「（続き）」など）を除いた文字（頁ごとにくり返す題を 1 頁目の題と比べるため） */
  stripContinued(t: string): string {
    let s = nfkc(t);
    for (const w of CUES.rowRole.continued) s = s.replace(new RegExp(`[(（]?\\s*${escapeRe(nfkc(w))}\\s*[)）]?`, "g"), "");
    return s.trim();
  },
  isAsOf: (t: string) => containsAny(t, sets.asOf),
  isDitto: (t: string) => sets.ditto.includes(norm(t)),
  isCommon: (t: string) => sets.common.includes(norm(t)),
  hasFictionalMark: (t: string) => containsAny(t, sets.fictional),
  /** 実績・予定の語。両方を含む・どちらも無いときは null */
  planActual(t: string): "plan" | "actual" | null {
    const n = norm(t);
    const a = sets.actual.some((w) => n === w || n.endsWith(w) || n.startsWith(w));
    const p = sets.plan.some((w) => n === w || n.endsWith(w) || n.startsWith(w));
    if (a === p) return null;
    return a ? "actual" : "plan";
  },
  /** 見出しの語から列の役目の手がかり（一致した語の長いもの優先）。末尾の括弧（単位など：「工数(人日)」「延工数(h)」）は除いて比べる */
  column(header: string): ColumnCue | null {
    const h = stripParen(norm(header));
    if (!h) return null;
    // 年や日付そのもの（「令和8年度」「2026/10/01」）は見出しの語ではなく値
    if (parseYearLabel(h) !== null || parseDateText(h) !== null) return null;
    let best: { k: ColumnCue; len: number } | null = null;
    for (const [k, words] of Object.entries(CUES.column) as [ColumnCue, string[]][]) {
      for (const w of normList(words)) {
        if (h === w || h.startsWith(w) || h.endsWith(w)) {
          const len = w.length + (h === w ? 100 : 0);
          if (!best || len > best.len) best = { k, len };
        }
      }
    }
    return best?.k ?? null;
  },
  /** その役目の見出しの語（そろえた文字） */
  words: (k: ColumnCue): string[] => normList(CUES.column[k]),
  /** 見出しに書いた工数の単位（「工数(人日)」→ 人・日、「延工数(h)」「時間」→ 時間）。書いていなければ null */
  headerUnit(header: string): "manDays" | "hours" | null {
    const h = norm(header);
    const paren = /[(（]([^()（）]*)[)）]$/.exec(h)?.[1] ?? null;
    const inParen = (ws: readonly string[]) => paren !== null && ws.some((w) => norm(w).toLowerCase() === paren.toLowerCase());
    const bareH = stripParen(h);
    // 延べの人数の見出し（「延人員」）は、人・日を数えたもの
    if (CUES.headerUnit.manDays.some((w) => norm(w).length >= 3 && bareH.endsWith(norm(w)))) return "manDays";
    if (inParen(CUES.headerUnit.manDays)) return "manDays";
    if (inParen(CUES.headerUnit.hours)) return "hours";
    // 括弧が無いとき：見出しそのものが単位の語を含む（「延べ時間」「作業時間」）
    const bare = stripParen(h);
    if (CUES.headerUnit.manDays.some((w) => bare.endsWith(norm(w)) && bare !== norm(w))) return "manDays";
    if (CUES.headerUnit.hours.some((w) => norm(w).length > 1 && bare.endsWith(norm(w)))) return "hours";
    return null;
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
