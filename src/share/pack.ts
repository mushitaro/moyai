// 共有に使うパックの部品を読む：見え方の軸（pack.json の profile）、公開語彙（vocab.json）、全国の表（national/table.json）。
// 送る側（検問所）と受ける側（verify ring）が同じこの関数で読む。足りないものは理由つきで返し、推測で埋めない。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadNational, loadVocab, type NationalTable, type ProfileSpec, type Tier, type Vocab } from "./k";

export const PACK_ID = /^[a-z][a-z0-9-]{0,63}$/;
export const PACKS_DIR_ENV = "MOYAI_PACKS_DIR";

/** パックのフォルダ。既定は dist/cli.js の隣の ../packs（リポジトリの packs/）。試験は環境変数で一時のフォルダに向けられる。 */
export function resolvePacksDir(env: NodeJS.ProcessEnv = process.env, from: string = import.meta.url): string {
  if (env[PACKS_DIR_ENV]) return env[PACKS_DIR_ENV] as string;
  const here = dirname(fileURLToPath(from));
  // dist/cli.js からは ../packs、src/share/pack.ts からは ../../packs
  for (const rel of ["../packs", "../../packs"]) {
    const p = join(here, rel);
    try {
      readFileSync(join(p, "_kinds", "work.json"));
      return p;
    } catch {
      /* 次を見る */
    }
  }
  return join(here, "..", "packs");
}

export interface SharePack {
  id: string;
  /** パックの表示名 */
  name: string;
  spec: ProfileSpec;
  vocab: Vocab;
  table: NationalTable;
  /** 公開語彙の分類の名前（画面の ③ の日本語。名前は vocab.json か common.json から読む） */
  classNames: Record<string, string>;
  /** 全国の表の軸の名前とコードの名前 */
  axes: { key: string; name: string; unit: string | null; codes: { code: string; name: string }[] }[];
}

export type SharePackLoad = { ok: true; pack: SharePack } | { ok: false; reason: "packIdInvalid" | "packMissing" | "sharingOff" | "profileMissing" | "vocabMissing" | "nationalMissing" | "packInvalid" };

const TIERS: readonly Tier[] = ["primary", "secondary", "refine"];

function readText(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** パックの共有の部品を読む。どれかが無ければ、何が無いかを返す（共有は送れない）。 */
export function loadSharePack(packsDir: string, packId: string): SharePackLoad {
  if (!PACK_ID.test(packId)) return { ok: false, reason: "packIdInvalid" };
  const dir = join(packsDir, packId);
  const packText = readText(join(dir, "pack.json"));
  if (packText === null) return { ok: false, reason: "packMissing" };
  let pack: { name?: unknown; sharing?: unknown; profile?: { axes?: unknown }; vocab?: unknown; national?: { table?: unknown } };
  try {
    pack = JSON.parse(packText);
  } catch {
    return { ok: false, reason: "packInvalid" };
  }
  if (pack.sharing === "off") return { ok: false, reason: "sharingOff" };
  const axes = pack.profile?.axes;
  if (!Array.isArray(axes) || axes.length === 0) return { ok: false, reason: "profileMissing" };
  const spec: ProfileSpec = { axes: [] };
  for (const a of axes as { key?: unknown; tier?: unknown }[]) {
    if (typeof a?.key !== "string" || !TIERS.includes(a.tier as Tier)) return { ok: false, reason: "packInvalid" };
    spec.axes.push({ key: a.key, tier: a.tier as Tier });
  }
  const vocabRel = typeof pack.vocab === "string" ? pack.vocab : "vocab.json";
  const tableRel = typeof pack.national?.table === "string" ? pack.national.table : "national/table.json";
  if (vocabRel.includes("..") || tableRel.includes("..")) return { ok: false, reason: "packInvalid" };
  const vocabText = readText(join(dir, vocabRel));
  if (vocabText === null) return { ok: false, reason: "vocabMissing" };
  const tableText = readText(join(dir, tableRel));
  if (tableText === null) return { ok: false, reason: "nationalMissing" };
  let vocab: Vocab;
  let table: NationalTable;
  try {
    vocab = loadVocab(vocabText);
    table = loadNational(tableText);
  } catch {
    return { ok: false, reason: "packInvalid" };
  }
  if (vocab.pack !== packId || table.pack !== packId) return { ok: false, reason: "packInvalid" };
  const classNames: Record<string, string> = {};
  const collect = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(collect);
    const o = v as Record<string, unknown>;
    if (typeof o.code === "string" && typeof o.name === "string" && vocab.byCode.has(o.code) && classNames[o.code] === undefined) classNames[o.code] = o.name;
    for (const x of Object.values(o)) if (x && typeof x === "object") collect(x);
  };
  try {
    collect(JSON.parse(vocabText));
    const common = readText(join(dir, "common.json"));
    if (common !== null) collect(JSON.parse(common));
  } catch {
    /* 名前が読めなければコードのまま見せる */
  }
  const rawAxes = (JSON.parse(tableText) as { axes?: { key?: unknown; name?: unknown; unit?: unknown; codes?: { code?: unknown; name?: unknown }[] }[] }).axes ?? [];
  const axisInfo = rawAxes
    .filter((a) => typeof a.key === "string")
    .map((a) => ({
      key: a.key as string,
      name: typeof a.name === "string" ? a.name : (a.key as string),
      unit: typeof a.unit === "string" ? a.unit : null,
      codes: (a.codes ?? []).filter((c) => typeof c.code === "string").map((c) => ({ code: c.code as string, name: typeof c.name === "string" ? c.name : (c.code as string) })),
    }));
  return { ok: true, pack: { id: packId, name: typeof pack.name === "string" ? pack.name : packId, spec, vocab, table, classNames, axes: axisInfo } };
}
