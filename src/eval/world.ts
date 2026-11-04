// 正解の世界とパック（packs/<パック>/）を、評価の問題を作るために読む。世界は形ごとに入口を分ける（src/eval/worlds/）。
// 業種の語はここに置かない。名前・作業・印は、どれも世界とパックのデータから取る。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAnswerWorld } from "./worlds/answer";
import { loadFactoryV1 } from "./worlds/factory-v1";

export interface WorldEquipment {
  id: string;
  base_name: string;
  name: string;
  furnace: number | null;
  furnace_label: string;
  system: string;
}

export interface WorldWork {
  id: string;
  attr: string;
  equipment_id: string;
  fiscal_year: number;
  label: string;
  man_days: number;
  pattern: string;
  start: string;
  end: string | null;
  status: string;
}

export interface WorldData {
  /** どの形の正解の世界から読んだか（入口は形ごとに分ける。src/eval/worlds/）。 */
  format: WorldFormat;
  facilityName: string;
  contractorNames: string[];
  equipment: WorldEquipment[];
  works: WorldWork[];
  fiscalYears: number[];
  /** 1 人・日の時間。世界に無ければ null（推測で 8 と置かない。R10 の「時間を数にする」問いを作らない）。 */
  manDayHours: number | null;
  /** 凡例に無い記号。世界に無ければ null（R08 を作らない）。 */
  unknownSymbol: string | null;
  /** 台帳の番号（equipment_id → 番号）。 */
  numbers: Map<string, string>;
}

/** 正解の世界の形。factory-v1：今の工場（world.json と *.truth.json）。answer：運営者の指示書 §5 の形（answer/world.json と answer/files/）。 */
export type WorldFormat = "factory-v1" | "answer";

/** 世界の形が読めない（要る項目が無い）。推測で埋めず、無い項目の名前を返す。 */
export class WorldFormatError extends Error {
  constructor(
    readonly format: WorldFormat | null,
    readonly missing: string[],
  ) {
    super(format ? `正解の世界（${format}）に要る項目が無い：${missing.join("、")}` : "正解の世界の形が分からない（world.json も answer/world.json も無い）");
    this.name = "WorldFormatError";
  }
}

export function detectWorldFormat(dir: string): WorldFormat | null {
  if (existsSync(join(dir, "answer", "world.json"))) return "answer";
  if (existsSync(join(dir, "world.json")) && existsSync(join(dir, "equipment-ledger.truth.json"))) return "factory-v1";
  return null;
}

export interface WorldLoadOptions {
  /** 日付から年度を出すときの、パックの年度の始まりの月。 */
  fiscalYearStartMonth: number;
}

/** 正解の世界を読む。形を見分けて、形ごとの入口に渡す。 */
export function loadWorld(dir: string, opts: WorldLoadOptions): WorldData {
  const format = detectWorldFormat(dir);
  if (format === "factory-v1") return loadFactoryV1(dir);
  if (format === "answer") return loadAnswerWorld(dir, opts);
  throw new WorldFormatError(null, []);
}

export interface PackSource {
  id: string;
  url: string;
  name: string;
}

export interface PackCheck {
  id: string;
  name: string;
  sourceId: string | null;
}

export interface PackData {
  id: string;
  fiscalYearStartMonth: number;
  sources: PackSource[];
  checks: PackCheck[];
  commonSourceId: string | null;
  commonSystems: number;
}

const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf8"));

export function loadPack(packsDir: string, id: string): PackData {
  const dir = join(packsDir, id);
  const pack = readJson(join(dir, "pack.json"));
  const sources = readJson(join(dir, "sources.json")).sources.map((s: any) => ({ id: String(s.id), url: String(s.url), name: String(s.name) }));
  const checksPath = join(dir, "checks.json");
  const checks: PackCheck[] = existsSync(checksPath)
    ? readJson(checksPath).checks.map((c: any) => ({ id: String(c.id), name: String(c.name), sourceId: c.source?.id ? String(c.source.id) : null }))
    : [];
  const common = readJson(join(dir, pack.common ?? "common.json"));
  return {
    id,
    fiscalYearStartMonth: Number(pack.fiscalYearStartMonth),
    sources,
    checks,
    commonSourceId: common.source ? String(common.source) : null,
    commonSystems: Array.isArray(common.systems) ? common.systems.length : 0,
  };
}

/** 固有名詞を数える語の一覧：施設名・業者名と、その「【架空】」を外したもの。 */
export function properNounTerms(w: WorldData): string[] {
  const names = [w.facilityName, ...w.contractorNames].filter(Boolean);
  return [...names, ...names.map((n) => n.replace(/^【[^】]*】/, ""))];
}

/** 日付（YYYY-MM-DD）から年度を出す。startMonth はパックの年度の始まりの月。 */
export function fiscalYearOf(date: string, startMonth: number): number {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return m >= startMonth ? y : y - 1;
}
