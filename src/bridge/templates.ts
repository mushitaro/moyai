// 様式と写し方の保管先（運営者の決定 3C：読み方の Skill と同じく、保管先の共有フォルダに置いて会社で共有する）。
//   <保管先>/様式/<名前>/template.xlsx   利用者が落とした様式（中身は AI に渡さない）
//   <保管先>/様式/<名前>/columns.json    写し方（列の役目。moyai.columns/0）
// 様式のファイルの SHA-256 と写し方の JCS の SHA-256 から版を作り、前の版は versions/<版>/ に写して残す（消さない）。
// 書いた写し方は下書き。その写し方で書き出した Excel に、人が信じる鍵で署名したとき承認される（plan/exports.ts。自分の署名も数える。Architect の縛り 5）。
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { columnsHash, templateVersion, type ExportInfo } from "../plan/exports";
export { templateVersion };
import { PLAN_ID, readHistory, type PlanHistory } from "../plan/store";
import { isTemplateColumns, type TemplateColumns } from "../plan/template";
import { safeSegment } from "./readings";

export const TEMPLATES = "様式";
const FILE = "template.xlsx";
const COLUMNS = "columns.json";
/** 様式のファイルの大きさの上限 */
export const TEMPLATE_MAX_BYTES = 8 * 1024 * 1024;

const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");

async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export type SaveTemplateResult = { ok: true; name: string; path: string; version: string } | { ok: false; reason: "nameInvalid" | "columnsInvalid" | "fileInvalid" };

/** 様式と写し方を書く（下書き）。同じ中身なら書き直さない。前の版は versions/<版>/ に写す */
export async function saveTemplate(root: string, name: string, bytes: Uint8Array, columns: unknown): Promise<SaveTemplateResult> {
  if (!safeSegment(name)) return { ok: false, reason: "nameInvalid" };
  if (!isTemplateColumns(columns)) return { ok: false, reason: "columnsInvalid" };
  // .xlsx は zip（PK で始まる）
  if (bytes.length < 4 || bytes.length > TEMPLATE_MAX_BYTES || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { ok: false, reason: "fileInvalid" };
  const dir = join(root, TEMPLATES, name);
  const colText = `${JSON.stringify(columns, null, 1)}\n`;
  const version = templateVersion(sha(bytes), columnsHash(columns));
  await mkdir(dir, { recursive: true });
  const old = await readOne(dir);
  if (old) {
    if (old.version === version) return { ok: true, name, path: relPath(root, dir), version };
    const keep = join(dir, "versions", old.version);
    await mkdir(keep, { recursive: true });
    if (!existsSync(join(keep, FILE))) await writeFile(join(keep, FILE), old.bytes);
    if (!existsSync(join(keep, COLUMNS))) await writeFile(join(keep, COLUMNS), old.colText, "utf8");
  }
  await writeAtomic(join(dir, FILE), bytes);
  await writeAtomic(join(dir, COLUMNS), colText);
  return { ok: true, name, path: relPath(root, dir), version };
}

const relPath = (root: string, dir: string) => relative(root, dir).split(sep).join("/");

const subdirs = (d: string): string[] => {
  try {
    return readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && e.name !== "versions")
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
};

/** 1 つの置き場所の様式と写し方（形の外れたものは null） */
async function readOne(dir: string): Promise<{ bytes: Uint8Array; columns: TemplateColumns; colText: string; fileHash: string; columnsHash: string; version: string } | null> {
  if (!existsSync(join(dir, FILE)) || !existsSync(join(dir, COLUMNS))) return null;
  const bytes = new Uint8Array(await readFile(join(dir, FILE)));
  const colText = await readFile(join(dir, COLUMNS), "utf8");
  let columns: unknown;
  try {
    columns = JSON.parse(colText);
  } catch {
    return null;
  }
  if (!isTemplateColumns(columns)) return null;
  const fileHash = sha(bytes);
  const ch = columnsHash(columns);
  return { bytes, columns, colText, fileHash, columnsHash: ch, version: templateVersion(fileHash, ch) };
}

/** 承認の記録：その写し方で書き出した、信じる鍵の署名のうち最初の版の番号・署名した人・時刻（いちばん新しい） */
export interface TemplateApproval {
  in: number;
  by: string;
  at: string;
}

export interface ListedTemplate {
  name: string;
  path: string;
  /** 置き場所のいちばん上の版か（false は versions/ に残した前の版） */
  current: boolean;
  version: string;
  fileHash: string;
  columnsHash: string;
  columns: TemplateColumns;
  approval: TemplateApproval | null;
}

/** 保管先の様式の一覧（いちばん上の版と、versions/ の前の版。形の外れたものは数えない） */
export async function listTemplates(root: string, approved: ReadonlyMap<string, TemplateApproval>): Promise<ListedTemplate[]> {
  const out: ListedTemplate[] = [];
  for (const name of subdirs(join(root, TEMPLATES))) {
    const dir = join(root, TEMPLATES, name);
    const places = [{ dir, current: true }, ...subdirs(join(dir, "versions")).map((v) => ({ dir: join(dir, "versions", v), current: false }))];
    const seen = new Set<string>();
    for (const p of places) {
      const t = await readOne(p.dir);
      // 直してから元に戻すと、同じ版がいちばん上と versions/ の両方にある。1 つにする（いちばん上を先に読む）
      if (!t || seen.has(t.version)) continue;
      seen.add(t.version);
      out.push({ name, path: relPath(root, p.dir), current: p.current, version: t.version, fileHash: t.fileHash, columnsHash: t.columnsHash, columns: t.columns, approval: approved.get(t.version) ?? null });
    }
  }
  return out;
}

/** 名前と版で、様式のファイルと写し方を読む（書き出すとき。版が合わなければ null） */
export async function readTemplateVersion(root: string, name: string, version: string): Promise<{ bytes: Uint8Array; columns: TemplateColumns; fileHash: string; columnsHash: string } | null> {
  if (!safeSegment(name) || !/^[0-9a-f]{64}$/.test(version)) return null;
  const dir = join(root, TEMPLATES, name);
  for (const d of [dir, join(dir, "versions", version)]) {
    const t = await readOne(d);
    if (t && t.version === version) return t;
  }
  return null;
}

/**
 * 承認済みの写し方：確かめで合う版の、信じる鍵の書き出しの署名が使った様式の版 → 承認の記録。
 * 確かめで合わない版から先と、署名の無い前の形の版は数えない（読み方の承認と同じ）
 */
export async function approvedTemplateVersions(root: string, trusted: (x: ExportInfo) => boolean): Promise<Map<string, TemplateApproval>> {
  const out = new Map<string, TemplateApproval>();
  for (const planId of subdirs(join(root, "plans"))) {
    if (!PLAN_ID.test(planId)) continue;
    let hist: PlanHistory;
    try {
      hist = await readHistory(root, planId);
    } catch {
      continue;
    }
    const bad = hist.versions.findIndex((v) => v.problem !== null);
    for (const v of bad < 0 ? hist.versions : hist.versions.slice(0, bad)) {
      for (const x of v.exports) {
        if (!trusted(x)) continue;
        const was = out.get(x.template.version);
        if (!was) out.set(x.template.version, { in: v.version, by: x.by, at: x.at });
        else out.set(x.template.version, { in: Math.min(was.in, v.version), by: x.at > was.at ? x.by : was.by, at: x.at > was.at ? x.at : was.at });
      }
    }
  }
  return out;
}
