// ルールの来歴（docs/screens.md 3.2、Wire、11-07 夜。動画 C14）：古い版の署名の「適用 Skill」、古い版のルールのシート、ルールの詳細の適用先。
// データは橋渡しが保管先の版の記録から読んだもの（plan_version_read の readingSkills と readings_lineage）。版の記録の形と署名される字は変えない（読むだけ）。
// 出すのは MOYAI が読める版だけ（保管先の確かめで合う版）。読めない施設は数えない（「ほか n」とも言わない）。
// ルールの版は「v n」で呼ぶ：置き場所ごとに、読み方の版（中身のハッシュ）を初めて版の記録に載せた時刻の順に数える。載せていない版（下書き）は数えない。
import type { ReadingScope, ReadingSkill } from "../../import/reading";

/** 版の記録に載った読み方（名前・保管先からの道・版） */
export interface RecordedSkillRef {
  name: string;
  path: string;
  version: string;
}

/** 版の記録の読み方を保管先の中身と照らしたもの。中身が見つからなければ scope と skill は null */
export interface RecordedReading extends RecordedSkillRef {
  scope: ReadingScope | null;
  skill: ReadingSkill | null;
}

/** 読み方の置き場所（保管先の今の版のあるところ） */
export interface LineagePlace {
  path: string;
  name: string;
  scope: ReadingScope;
  owner: string | null;
}

/** 読み方を版の記録に載せた版（橋渡しの readings_lineage の 1 行） */
export interface LineageVersion {
  planId: string;
  displayName: string;
  fictional: boolean;
  fiscalYearStartMonth: number;
  version: number;
  at: string;
  contentHash: string;
  signedAt: string | null;
  held: "editing" | "awaitingApproval" | "returned" | null;
  from: "store";
  openable: boolean;
  skills: RecordedSkillRef[];
}

export interface Lineage {
  places: LineagePlace[];
  applied: LineageVersion[];
}

/** 置き場所の道（versions/<版> に残した前の版は、その上の置き場所） */
export const placeOf = (path: string): string => path.replace(/\/versions\/[0-9a-f]{64}$/, "");

/** ルールの版ごとの行：置き場所の読み方の版を、初めて版の記録に載せた時刻の順に v1, v2… と数える */
export function ruleVersions(l: Lineage, place: string): { version: string; n: number; firstAt: string }[] {
  const first = new Map<string, string>();
  for (const a of l.applied)
    for (const s of a.skills) {
      if (placeOf(s.path) !== place) continue;
      const was = first.get(s.version);
      if (was === undefined || a.at < was) first.set(s.version, a.at);
    }
  return [...first]
    .sort((a, b) => (a[1] !== b[1] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([version, firstAt], i) => ({ version, n: i + 1, firstAt }));
}

/** 読み方の版の番号（v n の n）。版の記録に載っていない版・来歴をまだ読んでいないときは null */
export function ruleVersionNo(l: Lineage | null, place: string, version: string): number | null {
  if (!l) return null;
  return ruleVersions(l, place).find((x) => x.version === version)?.n ?? null;
}

/** 適用先：置き場所の読み方を版の記録に載せた版を、新しい順（版の記録の時刻。同じなら計画 ID・版の番号の大きい順）に。ruleNo はその版が載せたルールの版 */
export function appliedTo(l: Lineage, place: string): { v: LineageVersion; ruleNo: number | null }[] {
  const nos = new Map(ruleVersions(l, place).map((x) => [x.version, x.n]));
  return l.applied
    .flatMap((v) => {
      const s = v.skills.find((x) => placeOf(x.path) === place);
      return s ? [{ v, ruleNo: nos.get(s.version) ?? null }] : [];
    })
    .sort((a, b) => (a.v.at !== b.v.at ? (a.v.at < b.v.at ? 1 : -1) : a.v.planId !== b.v.planId ? (a.v.planId < b.v.planId ? -1 : 1) : b.v.version - a.v.version));
}

/**
 * 作業画面のルールの置き場所：保管先から読んだルールは道から。下書き（道が無い）は、同じ名前・範囲の置き場所
 * （施設の範囲は今の施設の鍵のもの）。保管先にまだ無ければ null
 */
export function placeFor(l: Lineage | null, r: { name: string; scope: ReadingScope; path: string | null }, facilityKey: string | null): string | null {
  if (r.path) return placeOf(r.path);
  if (!l) return null;
  const same = l.places.filter((p) => p.name === r.name && p.scope === r.scope);
  return (r.scope === "facility" ? same.find((p) => p.owner === facilityKey) : same[0])?.path ?? null;
}

/**
 * 横の板の「署名 n」に出す版：古い版を見るだけで開いているあいだは、その版（いちばん新しい版の署名は出さない）。
 * ほかは、いちばん新しい版。古い版とは、見るだけで開いた版で、保管先のいちばん新しい版より前のもの
 */
export function signaturesVersion<V extends { version: number }>(versions: readonly V[] | null | undefined, viewingOld: number | null): { info: V | null; old: boolean } {
  const list = versions ?? [];
  const latest = list.at(-1) ?? null;
  if (viewingOld !== null && latest && viewingOld < latest.version) {
    const v = list.find((x) => x.version === viewingOld) ?? null;
    return { info: v, old: v !== null };
  }
  return { info: latest, old: false };
}
