// 正解の世界の入口（answer）：運営者の指示書（サンプルの作り手への指示書）§5 の形。
//   samples/<業種>/<施設>/answer/world.json（機器・実際に行った作業・資料の結び・欠け・profile）と answer/files/<stem>.json。
// 指示書は中身を決めているが、項目の名前までは決めていない。だから項目の名前の候補を ANSWER_FIELDS の 1 か所に置き、
// どの候補も無い要る項目は、推測で埋めずに WorldFormatError で名前を返す。新しいサンプルができたら、ここだけを合わせる。
// 【未確認】新しいサンプルはまだ無い（2026-11-05）。この入口は、一時のフォルダに置いた小さな世界でだけ試した。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WorldFormatError, fiscalYearOf, type WorldData, type WorldEquipment, type WorldLoadOptions, type WorldWork } from "../world";

/** 項目の名前の候補（前から順に見る）。 */
export const ANSWER_FIELDS = {
  facility: ["facility"],
  facilityName: ["name"],
  equipment: ["equipment"],
  eqId: ["id", "equipment_id"],
  eqName: ["ledger_name", "name"],
  eqFurnace: ["furnace", "line", "series"],
  eqFurnaceLabel: ["furnace_label", "line_label", "series_label"],
  eqSystem: ["system"],
  eqNumber: ["number", "ledger_number", "code"],
  works: ["works"],
  wkId: ["id", "work_id"],
  wkEq: ["equipment_id", "equipment"],
  wkAttr: ["attr", "attribute"],
  wkLabel: ["label", "work", "name"],
  wkStart: ["start", "start_date"],
  wkEnd: ["end", "end_date"],
  wkManDays: ["man_days", "manDays"],
  wkStatus: ["status"],
  contractors: ["contractors"],
  contractorName: ["name"],
  manDayHours: ["man_day_hours", "hours_per_man_day"],
  unknownSymbol: ["unknown_symbol"],
} as const;

type Field = keyof typeof ANSWER_FIELDS;
const get = (o: any, f: Field): unknown => {
  if (!o || typeof o !== "object") return undefined;
  for (const k of ANSWER_FIELDS[f]) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

export function loadAnswerWorld(dir: string, opts: WorldLoadOptions): WorldData {
  const path = join(dir, "answer", "world.json");
  if (!existsSync(path)) throw new WorldFormatError("answer", ["answer/world.json"]);
  const w = JSON.parse(readFileSync(path, "utf8"));
  const missing = new Set<string>();
  const need = (o: any, f: Field, where: string): unknown => {
    const v = get(o, f);
    if (v === undefined) missing.add(`${where}.${ANSWER_FIELDS[f].join("|")}`);
    return v;
  };
  const eqRaw = need(w, "equipment", "world");
  const wkRaw = need(w, "works", "world");
  const equipment: WorldEquipment[] = [];
  const numbers = new Map<string, string>();
  for (const e of Array.isArray(eqRaw) ? eqRaw : []) {
    const id = need(e, "eqId", "equipment[]");
    const name = need(e, "eqName", "equipment[]");
    if (id === undefined || name === undefined) continue;
    const f = get(e, "eqFurnace");
    const furnace = typeof f === "number" ? f : f !== undefined && /^\d+$/.test(String(f)) ? Number(f) : null;
    const label = get(e, "eqFurnaceLabel");
    equipment.push({
      id: String(id),
      base_name: String(name),
      name: String(name),
      furnace,
      // 号炉・系統の名前が無ければ、書いてある値をそのまま使う（「1号炉」などの言い換えをしない）
      furnace_label: label !== undefined ? String(label) : f !== undefined ? String(f) : "",
      system: String(get(e, "eqSystem") ?? ""),
    });
    const n = get(e, "eqNumber");
    if (n !== undefined) numbers.set(String(id), String(n));
  }
  const works: WorldWork[] = [];
  for (const x of Array.isArray(wkRaw) ? wkRaw : []) {
    const id = need(x, "wkId", "works[]");
    const eq = need(x, "wkEq", "works[]");
    const start = need(x, "wkStart", "works[]");
    const md = need(x, "wkManDays", "works[]");
    const label = need(x, "wkLabel", "works[]");
    if (id === undefined || eq === undefined || start === undefined || md === undefined || label === undefined) continue;
    const date = String(start).slice(0, 10);
    const end = get(x, "wkEnd");
    works.push({
      id: String(id),
      attr: String(get(x, "wkAttr") ?? ""),
      equipment_id: String(eq),
      fiscal_year: fiscalYearOf(date, opts.fiscalYearStartMonth),
      label: String(label),
      man_days: Number(md),
      pattern: String(label),
      start: date,
      end: end === undefined ? null : String(end).slice(0, 10),
      // 指示書 §5.2 の works は「実際に行った作業」。状態が書いてなければ実績として読む
      status: String(get(x, "wkStatus") ?? "actual"),
    });
  }
  if (missing.size) throw new WorldFormatError("answer", [...missing]);
  const hours = Number(get(w, "manDayHours"));
  const sym = get(w, "unknownSymbol");
  return {
    format: "answer",
    facilityName: String(get(get(w, "facility"), "facilityName") ?? ""),
    contractorNames: (Array.isArray(get(w, "contractors")) ? (get(w, "contractors") as unknown[]) : []).map((c) => String(get(c, "contractorName") ?? c)),
    equipment,
    works,
    fiscalYears: [...new Set(works.map((x) => x.fiscal_year))].sort((a, b) => a - b),
    manDayHours: Number.isFinite(hours) && hours > 0 ? hours : null,
    unknownSymbol: typeof sym === "string" ? sym : null,
    numbers,
  };
}
