// 星取表が使う名前の表：作業の属性の名前（packs/_kinds/work.json）と、パックの共通の設備項目（packs/<パック>/common.json）。
// 名前はデータから読む。コードに業種の語を置かない。
import kindsWork from "../../../packs/_kinds/work.json";
import { catalogFromPack, type ChartCatalog } from "../../plan/chart";

const commons = import.meta.glob<unknown>("../../../packs/*/common.json", { eager: true, import: "default" });

const byPack = new Map<string, unknown>();
for (const [path, json] of Object.entries(commons)) {
  const m = /packs\/([^/]+)\/common\.json$/.exec(path);
  if (m?.[1]) byPack.set(m[1], json);
}

const cache = new Map<string, ChartCatalog | null>();

/** パックの名前の表。パックが無ければ null（共通の行は出せない） */
export function catalogFor(packId: string): ChartCatalog | null {
  if (!cache.has(packId)) {
    const common = byPack.get(packId);
    cache.set(packId, common === undefined ? null : catalogFromPack(common, kindsWork));
  }
  return cache.get(packId) ?? null;
}

let empty: ChartCatalog | null = null;
/** パックが無いときも台帳の行は描けるように、作業の属性の名前だけを持つ表 */
export function emptyCatalog(): ChartCatalog {
  return (empty ??= catalogFromPack({ systems: [] }, kindsWork));
}

/** 選べるパック（packs/<パック>/common.json があるもの）。名前はデータの表の名前から出す */
export function packChoices(): { id: string; table: string }[] {
  return [...byPack.entries()]
    .map(([id, json]) => ({ id, table: String((json as { table?: unknown }).table ?? "") }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
