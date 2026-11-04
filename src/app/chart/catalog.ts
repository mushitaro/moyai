// 星取表が使う名前の表：作業の属性の名前（packs/_kinds/work.json）と、パックの共通の設備項目（packs/<パック>/common.json）。
// 名前はデータから読む。コードに業種の語を置かない。
import kindsWork from "../../../packs/_kinds/work.json";
import { catalogFromPack, type ChartCatalog } from "../../plan/chart";

const commons = import.meta.glob<unknown>("../../../packs/*/common.json", { eager: true, import: "default" });
const packJsons = import.meta.glob<unknown>("../../../packs/*/pack.json", { eager: true, import: "default" });

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

/** パックの年度の始まりの月（pack.json）。無ければ null（画面は今の値のまま） */
export function packFiscalStart(packId: string): number | null {
  const json = packJsons[`../../../packs/${packId}/pack.json`] as { fiscalYearStartMonth?: unknown } | undefined;
  const m = json?.fiscalYearStartMonth;
  return typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
}

/** 選べるパック（packs/<パック>/common.json があるもの）。画面に出すのは pack.json の名前（無ければ ID） */
export function packChoices(): { id: string; name: string; table: string }[] {
  return [...byPack.entries()]
    .map(([id, json]) => {
      const pj = packJsons[`../../../packs/${id}/pack.json`] as { name?: unknown } | undefined;
      return { id, name: typeof pj?.name === "string" && pj.name ? pj.name : id, table: String((json as { table?: unknown }).table ?? "") };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
