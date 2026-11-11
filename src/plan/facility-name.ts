// 施設の名前を変える（mushitaro/moyai#56）。名前は署名した版の記録に入る表示の字で、施設の鍵（planId）と署名鍵は変わらない。
// - 人：HOSHITORI の見出しでその場で直す → 作業中の計画の名前が変わる（決めるのは人。次に署名した版から効く。前の版は前の名前のまま）。
// - Claude：chart_propose の facilityName で案を置くだけ（nameProposal）。確定のシートに「施設の名前　前 → 後」が並び、人が受けて署名すると、
//   橋渡しが署名の前に名前を替える（applyNameAcceptance）。
// - 【架空】の施設は【架空】の印を外せない（人の直しは印を付け直し、Claude の案は断る）。
import type { AuthorKind } from "../shared/fields";
import type { Plan } from "../shared/plan";

/** 名前の形：1〜40 字（サロゲートの組も 1 字）・前後に空白なし・制御の文字なし（intake_add_files の施設名と同じ形） */
function nameShapeOk(s: string): boolean {
  return s.length > 0 && s.trim() === s && [...s].length <= 40 && !/[\u0000-\u001f\u007f-\u009f]/.test(s);
}

export const FICTION_MARK = "【架空】";
export const NAME_DECISION_ID = "name:";

/** 名前の形（1〜40 字・前後に空白なし・制御の文字なし）。架空の施設なら【架空】を含むこと */
export function facilityNameOk(plan: Pick<Plan, "facility">, name: string): boolean {
  return nameShapeOk(name) && (!plan.facility.fictional || name.includes(FICTION_MARK));
}

/** 名前を替えた計画（表示の名前と、共有の照らしに使う施設の名前をそろえる。案は消す） */
function renamed(plan: Plan, name: string): Plan {
  const { nameProposal: _p, ...rest } = plan;
  return { ...rest, displayName: name, facility: { ...plan.facility, name } };
}

/** 人がその場で直した名前。架空の施設で【架空】が外れていれば付け直す。形が合わなければ null（変えない） */
export function renameByHuman(plan: Plan, typed: string): Plan | null {
  const t = typed.trim();
  const name = plan.facility.fictional && !t.includes(FICTION_MARK) ? `${FICTION_MARK}${t}` : t;
  if (!facilityNameOk(plan, name)) return null;
  if (name === plan.displayName && !plan.nameProposal) return plan;
  return renamed(plan, name);
}

export type NameProposalResult = { ok: true; plan: Plan; state: "proposed" | "same" } | { ok: false; code: "facility_name_invalid" | "facility_name_fictional" };

/** Claude の名前の案。今と同じ名前なら案を消す（same）。架空の施設で【架空】を外す案は断る */
export function proposeName(plan: Plan, name: string, author: Extract<AuthorKind, "ai" | "ai_relayed_human">, basis: string): NameProposalResult {
  if (!nameShapeOk(name)) return { ok: false, code: "facility_name_invalid" };
  if (plan.facility.fictional && !name.includes(FICTION_MARK)) return { ok: false, code: "facility_name_fictional" };
  if (name === plan.displayName) {
    const { nameProposal: _p, ...rest } = plan;
    return { ok: true, plan: rest, state: "same" };
  }
  return { ok: true, plan: { ...plan, nameProposal: { name, author, basis } }, state: "proposed" };
}

/** 人が受けた名前の案を効かせる（橋渡しが署名の前に）。形が合わない案は効かせずに消す */
export function applyNameAcceptance(plan: Plan, accepted: boolean): Plan {
  const p = plan.nameProposal;
  if (!p || !accepted) return plan;
  if (!facilityNameOk(plan, p.name)) {
    const { nameProposal: _x, ...rest } = plan;
    return rest;
  }
  return renamed(plan, p.name);
}
