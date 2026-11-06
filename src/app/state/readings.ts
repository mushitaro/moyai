// 作業画面が当てている読み方（3 段目の Skill。docs/plan.md §2.17）。作業中の版の下書きと、保管先の承認済みの読み方。
// 確定（署名）のとき、ダイアログがここから使った読み方を橋渡しに渡す（橋渡しが保管先に書き、道と版を版の記録に書く）。
import { isPlanRule, type LoadedReading } from "../../import/reading";
import { PLAN_RULE_SOURCE, cycleIdOf } from "../../plan/cycle";
import type { Plan } from "../../shared/plan";

let current: { readings: LoadedReading[]; facilityKey: string | null } = { readings: [], facilityKey: null };
const listeners = new Set<() => void>();

export function setCurrentReadings(readings: readonly LoadedReading[], facilityKey: string | null): void {
  current = { readings: [...readings], facilityKey };
  for (const l of listeners) l();
}

/** 当てている読み方が変わるたびに呼ぶ（計画ルールの案を出し直す。state/cycles.ts） */
export function subscribeCurrentReadings(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getCurrentReadings(): { readings: LoadedReading[]; facilityKey: string | null } {
  return current;
}

/**
 * この署名で版の記録に載せる読み方。下書きの計画ルールは、この署名で人が受けた周期の案（acceptedIds の detail:）のもとになったものだけを残す
 * （案の無いルールを、版の署名で承認しない。Architect の 42 の 2。案は確定のシートで人が全部受けるまで署名できない）。
 * 承認済みの読み方は中身を変えずに渡す（版が変わると、ほかの施設で承認済みの読み方を書き換えるため）。ルールが 0 になった下書きは載せない
 */
export function readingsSigned(plan: Plan | null, acceptedIds: ReadonlySet<string> = new Set()): LoadedReading[] {
  return signing(plan, acceptedIds).readings.map((x) => x.reading);
}

/** 載せる読み方と、削ったか（案を受けていない計画ルールを外した下書き）と、この版に載せない計画ルールの数 */
function signing(plan: Plan | null, acceptedIds: ReadonlySet<string>): { readings: { reading: LoadedReading; trimmed: boolean }[]; dropped: number } {
  const backed = new Set<string>();
  for (const d of plan?.details ?? []) {
    if (cycleIdOf(d.detailKey) === null || !acceptedIds.has(`detail:${d.detailKey}`)) continue;
    for (const s of d.sources) if (s.file === PLAN_RULE_SOURCE && s.sheet !== null && s.cell !== null) backed.add(`${s.sheet}\u0000${s.cell}`);
  }
  let dropped = 0;
  const readings: { reading: LoadedReading; trimmed: boolean }[] = [];
  for (const r of current.readings) {
    if (!r.draft) {
      readings.push({ reading: r, trimmed: false });
      continue;
    }
    const rules = r.skill.rules.filter((x) => !isPlanRule(x) || backed.has(`${r.skill.name}\u0000${x.id}`));
    dropped += r.skill.rules.length - rules.length;
    if (rules.length > 0) readings.push({ reading: { ...r, skill: { ...r.skill, rules } }, trimmed: rules.length < r.skill.rules.length });
  }
  return { readings, dropped };
}

/** この版に載せない計画ルールの数（案を受けていない下書きのルール。署名のダイアログに出し、人が知ったうえで署名する） */
export function droppedPlanRules(plan: Plan | null, acceptedIds: ReadonlySet<string> = new Set()): number {
  return signing(plan, acceptedIds).dropped;
}

/**
 * 確定のときに橋渡しへ渡す形。削った下書きは trimmed（橋渡しは保管先の今の下書きを書き直さず、削った中身を versions/ にだけ書く。
 * 版の記録には削った中身のハッシュが載る。Architect の 42 の答え 4）
 */
export function readingsForCommit(
  plan: Plan | null = null,
  acceptedIds: ReadonlySet<string> = new Set(),
): { skill: LoadedReading["skill"]; by: string | null; facilityKey: string | null; trimmed?: true }[] {
  return signing(plan, acceptedIds).readings.map(({ reading, trimmed }) => ({ skill: reading.skill, by: null, facilityKey: current.facilityKey, ...(trimmed ? { trimmed: true as const } : {}) }));
}
