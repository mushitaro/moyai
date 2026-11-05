// 正解の世界の入口（factory-v1）：今の工場の形（samples/truth/<パック>/<施設>/ の world.json と equipment-ledger.truth.json）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorldData, WorldWork } from "../world";

const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf8"));

export function loadFactoryV1(dir: string): WorldData {
  const w = readJson(join(dir, "world.json"));
  const ledger = readJson(join(dir, "equipment-ledger.truth.json"));
  const numbers = new Map<string, string>();
  for (const r of ledger.rows ?? []) if (r.equipment_id && r.number) numbers.set(String(r.equipment_id), String(r.number));
  const hours = Number(w.man_day_hours);
  return {
    format: "factory-v1",
    facilityName: String(w.facility?.name ?? ""),
    contractorNames: (w.rules?.contractors ?? []).map((c: any) => String(c.name)),
    equipment: w.equipment,
    works: (w.works as WorldWork[]).map((x) => ({ ...x, end: x.end ?? null })),
    fiscalYears: w.fiscal_years,
    manDayHours: Number.isFinite(hours) && hours > 0 ? hours : null,
    unknownSymbol: w.rules?.dirt?.sheet?.unknown_symbol?.symbol ?? null,
    numbers,
  };
}
