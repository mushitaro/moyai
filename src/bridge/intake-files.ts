// 資料を作業画面に入れる（intake_add_files）の、橋渡しの側：道を確かめ、読む資料を選ぶ。中身は読まない（作業画面が経路で取りに来る）。
// - demo：Skillパックの demo/ の資料（パックの中の決まった場所。施設の名前は demo/demo.json）。
// - folder：利用者がチャットで言ったフォルダの直下の資料だけ。絶対の道で、`..` を含まず、シンボリックリンクでなく、
//   状態フォルダとリポジトリの中でないもの（実体の道でも確かめる）。下のフォルダとシンボリックリンクのファイルは読まない。
//   AI が添えた Skillパック（作業画面で選べるものだけ）と施設名（40 字まで）は、そのまま作業画面へ渡す（置くのは欄が空のときだけ。作業画面が決める）。
// 断った資料は、名前と理由を返す（黙って捨てない）。返すのは名前・大きさ・理由だけで、中身は AI に渡さない。
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import { open } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { ErrorCode } from "../shared/errors";
import { matchFiles } from "../shared/file-match";
import { INTAKE_ADD_EXTENSIONS, INTAKE_ADD_MAX_BYTES, INTAKE_ADD_MAX_FILES, INTAKE_ADD_MAX_REFUSED, intakeFacilityNameOk, type IntakeRefusal } from "../shared/tools";
import type { TemplateShape } from "../shared/template-layout";
import { normPath } from "./places";
import { TEMPLATE_MAX_BYTES } from "./templates";

export const DEMO_DIR = "demo";
export const DEMO_MANIFEST = "demo.json";
const PACK_ID = /^[a-z][a-z0-9-]{0,63}$/;

export interface IntakeFile {
  /** 実体の道（作業画面へは渡さない） */
  path: string;
  name: string;
  size: number;
}

export interface IntakeCollection {
  source: "demo" | "folder" | "template";
  pack: string | null;
  facilityName: string | null;
  files: IntakeFile[];
  /** 断った資料（並べるのは上限まで） */
  refused: { name: string; reason: IntakeRefusal }[];
  /** 断った資料の数（並べなかった分も数える） */
  refusedTotal: number;
  /** 資料の種類でないもの（ほかの種類のファイル・下のフォルダ・そのリンク）の数。名前は返さない */
  others: number;
  /** template：様式の形（橋渡しが読んで作る。AI に返すのはこれと名前・大きさだけ） */
  template?: TemplateShape;
  /** folder の match・list：入れなかった資料の名前（並べるのは上限まで）と数 */
  left?: string[];
  leftTotal?: number;
  /** folder の list：入れずに名前だけを返す（作業画面に渡さない） */
  listOnly?: boolean;
}

export interface IntakeEnv {
  packsDir: string;
  /** 状態フォルダ（中の資料は読まない）。null は試験 */
  stateDir: string | null;
  /** リポジトリの根（中の資料は読まない。demo は例外で、パックの demo/ だけ） */
  repoRoot: string;
  platform?: NodeJS.Platform;
}

const allowedKind = (name: string) => (INTAKE_ADD_EXTENSIONS as readonly string[]).includes(extname(name).toLowerCase());

/** 道が base の中か（同じ道も中と数える） */
function inside(path: string, base: string, platform: NodeJS.Platform): boolean {
  const p = normPath(path, platform);
  const b = normPath(base, platform);
  return p === b || p.startsWith(`${b}/`);
}

/** ネットワークの道（\\server\share・//server/share）と装置の道。ドライブ文字か / から始まる道だけを受ける（Security の点検 11-08 の中5） */
export const NETWORK_PATH = /^[\\/]{2}/;

function realOr(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** 利用者が言ったフォルダの道を確かめる。読んでよければ、そのままの道と実体の道。だめなら誤りの名前 */
export function checkFolder(raw: string, env: IntakeEnv): { path: string; real: string } | ErrorCode {
  const platform = env.platform ?? process.platform;
  const t = raw.trim();
  if (!t || t.includes("\u0000") || t.length > 1000) return "intake_path_not_allowed";
  // ネットワークの道と装置の道（\\server\share・//server/share・\\?\・\\.\）は受けない（見るだけで SMB・WebDAV で外へつなぐ）
  if (NETWORK_PATH.test(t)) return "intake_path_not_allowed";
  if (!isAbsolute(t)) return "intake_path_not_allowed";
  if (t.split(/[\\/]+/).some((s) => s === "..")) return "intake_path_not_allowed";
  const path = resolve(t);
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch {
    return "intake_folder_missing";
  }
  if (st.isSymbolicLink()) return "intake_path_not_allowed";
  if (!st.isDirectory()) return "intake_folder_missing";
  const real = realOr(path);
  if (NETWORK_PATH.test(real)) return "intake_path_not_allowed";
  const forbidden = [env.repoRoot, ...(env.stateDir ? [env.stateDir] : [])].flatMap((b) => [resolve(b), realOr(resolve(b))]);
  if (forbidden.some((b) => inside(path, b, platform) || inside(real, b, platform))) return "intake_path_not_allowed";
  return { path, real };
}

/**
 * フォルダの直下から資料を選ぶ（名前の順）。資料の種類の名前のもので、リンク・ファイルでない・大きさ・数で断ったものは名前と理由を返す。
 * 資料の種類でないもの（ほかの種類のファイル・下のフォルダ）は、名前を返さずに数だけを数える（フォルダの中身の一覧を AI に渡さない）。
 */
export function pickFiles(dir: string, o: { skipNames?: ReadonlySet<string> } = {}): Omit<IntakeCollection, "source" | "pack" | "facilityName"> | ErrorCode {
  let names: string[];
  try {
    names = readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch {
    return "intake_folder_missing";
  }
  const files: IntakeFile[] = [];
  const refused: { name: string; reason: IntakeRefusal }[] = [];
  let refusedTotal = 0;
  let others = 0;
  const refuse = (name: string, reason: IntakeRefusal) => {
    refusedTotal++;
    if (refused.length < INTAKE_ADD_MAX_REFUSED) refused.push({ name: name.slice(0, 260), reason });
  };
  for (const name of names) {
    if (o.skipNames?.has(name)) continue;
    if (!allowedKind(name)) {
      others++;
      continue;
    }
    const path = join(dir, name);
    let st: Stats;
    try {
      st = lstatSync(path);
    } catch {
      refuse(name, "changed");
      continue;
    }
    if (st.isSymbolicLink()) refuse(name, "link");
    else if (!st.isFile()) refuse(name, "not_file");
    else if (st.size > INTAKE_ADD_MAX_BYTES) refuse(name, "too_large");
    else if (files.length >= INTAKE_ADD_MAX_FILES) refuse(name, "over_count");
    else files.push({ path, name, size: st.size });
  }
  return { files, refused, refusedTotal, others };
}

/** デモの施設の名前（demo/demo.json の facilityName。【架空】の印のあるものだけ） */
function demoFacilityName(dir: string): string | null {
  try {
    const v = JSON.parse(readFileSync(join(dir, DEMO_MANIFEST), "utf8")) as { facilityName?: unknown };
    const n = typeof v.facilityName === "string" ? v.facilityName.trim() : "";
    return n && n.length <= 80 && n.includes("【架空】") ? n : null;
  } catch {
    return null;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** demo/ のあるパック（名前の順） */
export function demoPacks(packsDir: string): string[] {
  try {
    return readdirSync(packsDir)
      .filter((d) => PACK_ID.test(d) && isDir(join(packsDir, d, DEMO_DIR)))
      .sort();
  } catch {
    return [];
  }
}

/**
 * 作業画面の Skillパックの欄で選べる Skillパック（packs/<ID>/common.json のあるもの。src/app/chart/catalog.ts の packChoices と同じ決まり）。
 * 名前は pack.json の name（無ければ ID）。ID の順
 */
export function skillPacks(packsDir: string): { id: string; name: string }[] {
  let ids: string[];
  try {
    ids = readdirSync(packsDir).filter((d) => PACK_ID.test(d) && isFile(join(packsDir, d, "common.json")));
  } catch {
    return [];
  }
  return ids.sort().map((id) => {
    try {
      const n = (JSON.parse(readFileSync(join(packsDir, id, "pack.json"), "utf8")) as { name?: unknown }).name;
      return { id, name: typeof n === "string" && n.trim() ? n.trim().slice(0, 80) : id };
    } catch {
      return { id, name: id };
    }
  });
}

/** 誤りの文に並べる、選べる Skillパックの ID と名前（intake_pack_unknown の {packs}） */
export function skillPacksText(packsDir: string): string {
  const list = skillPacks(packsDir);
  return list.length ? list.map((p) => `${p.id}：${p.name}`).join("・") : "選べる Skillパックが 1 つもありません";
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 道の形の確かめ（folder と template で同じ）：絶対の道で、`..`・装置の道・NUL を含まない */
function pathShapeOk(t: string): boolean {
  if (!t || t.includes("\u0000") || t.length > 1000) return false;
  if (NETWORK_PATH.test(t)) return false;
  if (!isAbsolute(t)) return false;
  return !t.split(/[\\/]+/).some((s) => s === "..");
}

/**
 * source: template の様式のファイルを確かめる（.xlsx 1 つ）：道の形は folder と同じ。シンボリックリンクでないファイルで、8 MB まで。
 * 状態フォルダとリポジトリの中は読まない
 */
export function checkTemplateFile(raw: string, env: IntakeEnv): IntakeFile | ErrorCode {
  const platform = env.platform ?? process.platform;
  const t = raw.trim();
  if (!pathShapeOk(t)) return "intake_path_not_allowed";
  const path = resolve(t);
  // 状態フォルダとリポジトリの中は、あるかどうかも確かめずに断る（入れ物の実体の道でも）
  const forbidden = [env.repoRoot, ...(env.stateDir ? [env.stateDir] : [])].flatMap((b) => [resolve(b), realOr(resolve(b))]);
  const within = (p: string) => forbidden.some((b) => inside(p, b, platform));
  if (within(path) || within(join(realOr(dirname(path)), basename(path)))) return "intake_path_not_allowed";
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch {
    return "intake_template_missing";
  }
  if (st.isSymbolicLink()) return "intake_path_not_allowed";
  if (within(realOr(path)) || NETWORK_PATH.test(realOr(path))) return "intake_path_not_allowed";
  if (!st.isFile() || extname(path).toLowerCase() !== ".xlsx" || st.size > TEMPLATE_MAX_BYTES || st.size === 0) return "intake_template_missing";
  return { path, name: basename(path), size: st.size };
}

/** intake_add_files の引数から、読む資料を選ぶ */
export function collectIntake(args: { source: "demo" | "folder" | "template"; path?: string; pack?: string; facilityName?: string; match?: string; list?: boolean }, env: IntakeEnv): IntakeCollection | ErrorCode {
  if (args.source === "template") {
    if (args.pack !== undefined || args.facilityName !== undefined || args.match !== undefined || args.list !== undefined) return "invalid_input";
    const f = checkTemplateFile(args.path ?? "", env);
    if (typeof f === "string") return f;
    return { source: "template", pack: null, facilityName: null, files: [f], refused: [], refusedTotal: 0, others: 0 };
  }
  if (args.source === "demo") {
    if (args.match !== undefined || args.list !== undefined) return "invalid_input";
    const packs = demoPacks(env.packsDir);
    const pack = args.pack ?? (packs.length === 1 ? packs[0]! : null);
    if (!pack || !packs.includes(pack)) return "intake_demo_missing";
    const dir = join(env.packsDir, pack, DEMO_DIR);
    // README.md と demo.json はデモの説明で、資料ではない
    const r = pickFiles(dir, { skipNames: new Set(["README.md", DEMO_MANIFEST]) });
    if (typeof r === "string") return "intake_demo_missing";
    if (r.files.length === 0) return "intake_demo_missing";
    return { source: "demo", pack, facilityName: demoFacilityName(dir), ...r };
  }
  // 添えた Skillパックと施設名は、資料を読む前に確かめる（入力の型でも確かめてあるが、ここでも外れたものは直さずに断る）
  if (args.pack !== undefined && !skillPacks(env.packsDir).some((p) => p.id === args.pack)) return "intake_pack_unknown";
  if (args.facilityName !== undefined && !intakeFacilityNameOk(args.facilityName)) return "invalid_input";
  const c = checkFolder(args.path ?? "", env);
  if (typeof c === "string") return c;
  const r = pickFiles(c.path);
  if (typeof r === "string") return r;
  const base = { source: "folder" as const, pack: args.pack ?? null, facilityName: args.facilityName ?? null };
  if (args.list !== true && args.match === undefined) return { ...base, ...r };
  // 一部だけ入れる（match）か、名前だけを見る（list）。入れなかった資料は名前を left に返す（名前の比べは intake_survey の match と同じ。#57）
  const hit = args.list === true ? new Set<string>() : new Set(matchFiles(args.match ?? "", r.files.map((f) => f.name)));
  const take = r.files.filter((f) => hit.has(f.name));
  const left = r.files.filter((f) => !hit.has(f.name)).map((f) => f.name);
  return { ...base, ...r, files: take, left: left.slice(0, INTAKE_ADD_MAX_REFUSED), leftTotal: left.length, ...(args.list === true ? { listOnly: true } : {}) };
}

/**
 * 作業画面が取りに来た資料を読む。選んだときと同じ形（シンボリックリンクでないファイル・同じ大きさ・上限の内）のときだけ。
 * 変わっていれば null（作業画面は changed として断る）。
 */
export async function readIntakeFile(f: { path: string; size: number }): Promise<Buffer | null> {
  try {
    const st = lstatSync(f.path);
    if (st.isSymbolicLink() || !st.isFile() || st.size !== f.size || st.size > INTAKE_ADD_MAX_BYTES) return null;
    const h = await open(f.path, "r");
    try {
      const buf = Buffer.alloc(f.size);
      const { bytesRead } = await h.read(buf, 0, f.size, 0);
      return bytesRead === f.size ? buf : null;
    } finally {
      await h.close();
    }
  } catch {
    return null;
  }
}
