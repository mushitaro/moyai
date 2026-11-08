// Skillパック（2 段目）の読み方：packs/<id>/reading.json。規則の形は 3 段目（会話で作る読み方）と同じで、効く順はいちばん後
// （3 段目の施設・担当・会社 → Skillパック → 標準の読み手）。語と決まりは packs/ に置き、コードには置かない。
// 作業画面（ブラウザ）でも同じに読むので、ファイルは静的に取り込む。Skillパックを足したら、ここに 1 行足す。
import wasteReading from "../../packs/waste-incineration/reading.json";
import wastePack from "../../packs/waste-incineration/pack.json";
import { PackReading, packRules, type ActiveRule } from "./reading";

const READINGS: Record<string, { reading: unknown; version: string }> = {
  "waste-incineration": { reading: wasteReading, version: `waste-incineration@${wastePack.version}` },
};

const memo = new Map<string, ActiveRule[]>();

/** その Skillパックの読み方の規則（無ければ空。形の合わないファイルは当てない） */
export function packReadingRules(packId: string | null | undefined): ActiveRule[] {
  if (!packId) return [];
  const hit = memo.get(packId);
  if (hit) return hit;
  const e = READINGS[packId];
  const p = e ? PackReading.safeParse(e.reading) : null;
  const rules = p?.success ? packRules(p.data, e!.version) : [];
  memo.set(packId, rules);
  return rules;
}
