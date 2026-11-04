// 作業画面が当てている読み方（3 段目の Skill。docs/plan.md §2.17）。作業中の版の下書きと、保管先の承認済みの読み方。
// 確定（署名）のとき、ダイアログがここから使った読み方を橋渡しに渡す（橋渡しが保管先に書き、道と版を版の記録に書く）。
import type { LoadedReading } from "../../import/reading";

let current: { readings: LoadedReading[]; facilityKey: string | null } = { readings: [], facilityKey: null };

export function setCurrentReadings(readings: readonly LoadedReading[], facilityKey: string | null): void {
  current = { readings: [...readings], facilityKey };
}

export function getCurrentReadings(): { readings: LoadedReading[]; facilityKey: string | null } {
  return current;
}

/** 確定のときに橋渡しへ渡す形 */
export function readingsForCommit(): { skill: LoadedReading["skill"]; by: string | null; facilityKey: string | null }[] {
  return current.readings.map((r) => ({ skill: r.skill, by: null, facilityKey: current.facilityKey }));
}
