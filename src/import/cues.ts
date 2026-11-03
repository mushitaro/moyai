// 書類の一般の手がかりの語（packs/_cues/cues.json）を読み、比べる道具にする。語はコードに置かない。
import cuesJson from "../../packs/_cues/cues.json";
import { nfkc } from "./era";

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
  actual: normList(CUES.planActual.actual),
  plan: normList(CUES.planActual.plan),
  ditto: normList(CUES.ditto),
  common: normList(CUES.common),
  set: normList(CUES.set),
  fictional: normList(CUES.fictional),
};

export type ColumnCue = keyof typeof CUES.column;

export function containsAny(text: string, list: readonly string[]): boolean {
  const t = norm(text);
  return list.some((w) => t.includes(w));
}

export const cue = {
  isSubtotal: (t: string) => containsAny(t, sets.subtotal),
  isTotal: (t: string) => containsAny(t, sets.total) || sets.totalExact.includes(norm(t)),
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
  /** 見出しの語から列の役目の手がかり（一致した語の長いもの優先） */
  column(header: string): ColumnCue | null {
    const h = norm(header);
    if (!h) return null;
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
};

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
