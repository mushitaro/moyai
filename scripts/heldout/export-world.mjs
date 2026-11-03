// 見ていない様式の書き手に渡す「正解の世界の書き出し」（docs/plan.md §2.6）。
// 工場の正解の世界（samples/truth/<パック>/<施設>/world.json）から、施設・機器・作業の事実だけを写す。
// 生成器の書き方の決まり（rules：資料の種類・汚し・名前の書き方・呼び名の揺れ・欠けの入れ方・乱数の種）は写さない。
// 新しい書き手は、これと samples/heldout/CONTRACT.md だけを見て資料を書く。
//
// 使い方：node scripts/heldout/export-world.mjs <world.json> <crossdoc.truth.json> <出す JSON>
import { readFileSync, writeFileSync } from "node:fs";

/**
 * @param {any} world 工場の world.json
 * @param {string[]} precisionIds 精密機能検査の作業の id（crossdoc の precision_work_ids）
 */
export function exportWorld(world, precisionIds) {
  const precision = new Set(precisionIds);
  return {
    schema: "moyai.heldout.world/0",
    note: "【架空】の施設。施設・機器・作業の事実だけ。資料の書き方は、あなたが決める。",
    facility: {
      id: world.facility.id,
      name: world.facility.name,
      furnace_type: world.facility.furnace_type,
      furnaces: world.facility.furnaces.map((f) => ({ no: f.no, label: f.label })),
    },
    fiscal_year_start_month: 4,
    fiscal_years: world.fiscal_years,
    today: world.today,
    man_day_hours: world.man_day_hours,
    plan_window: world.plan_window,
    equipment: world.equipment.map((e) => ({
      id: e.id,
      name: e.name,
      base_name: e.base_name,
      tag: e.tag,
      system: e.system,
      path: e.path,
      parts: e.parts,
      furnace: e.furnace,
      furnace_label: e.furnace_label,
      install_year: e.install_year,
      spec: e.spec,
    })),
    // 予定にも実績にも書かない作業（工場が検査の欠けとして入れたもの。status が planned・actual 以外）は写さない
    works: world.works.filter((w) => w.status === "planned" || w.status === "actual").map((w) => ({
      id: w.id,
      equipment_id: w.equipment_id,
      fiscal_year: w.fiscal_year,
      status: w.status,
      label: w.label,
      attr: w.attr,
      start: w.start ?? null,
      end: w.end ?? null,
      man_days: w.man_days ?? null,
      duration_days: w.duration_days ?? null,
      crew: w.crew ?? null,
      contractor: w.contractor ?? null,
      precision: precision.has(w.id),
    })),
    contractors: (world.rules?.contractors ?? []).map((c) => ({ id: c.id, name: c.name, from: c.from ?? null })),
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const [, , worldPath, crossdocPath, out] = process.argv;
  if (!worldPath || !crossdocPath || !out) {
    console.error("使い方：node scripts/heldout/export-world.mjs <world.json> <crossdoc.truth.json> <出す JSON>");
    process.exit(2);
  }
  const world = JSON.parse(readFileSync(worldPath, "utf8"));
  const cross = JSON.parse(readFileSync(crossdocPath, "utf8"));
  const w = exportWorld(world, cross.precision_work_ids ?? []);
  writeFileSync(out, `${JSON.stringify(w, null, 1)}\n`, "utf8");
  console.error(`世界の書き出し：機器 ${w.equipment.length}・作業 ${w.works.length} → ${out}`);
}
