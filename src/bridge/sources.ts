// 版を組んだ資料の置き場所（1C・重-2。Architect の形と縛り 5 つ）：plans/<計画ID>/sources/<SHA-256>。
// 資料は人だけの経路で 1 つずつ先に置き、確定では SHA-256 だけを送る。橋渡しは「あること」と「ハッシュ」を照らす。
// 名前は表示にだけ使い、道には使わない（置き場所は SHA-256 だけで決める）。AI のツールにも、輪と台帳の束にも渡さない。
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { planDir } from "../plan/store";
import type { VersionDecision, VersionSource } from "../plan/store";
import { AUTHOR_KINDS } from "../shared/fields";

/** 1 つの資料と、1 つの版の資料の合計の上限（取り込みの 1 ファイル 64 MB とそろえる。台帳の新-6） */
export const SOURCE_MAX_BYTES = 64 * 1024 * 1024;
export const SOURCES_TOTAL_MAX_BYTES = 256 * 1024 * 1024;
const SHA = /^[0-9a-f]{64}$/;
/** 資料の名前の形（表示だけ。区切り・制御の文字を使わない） */
const SOURCE_NAME = /^[^\\/:*?"<>|\x00-\x1f]{1,200}$/u;

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const pathOf = (root: string, planId: string, h: string) => join(planDir(root, planId), "sources", h);

/** 置いてある資料が、その SHA-256 の中身か（無い・読めなければ false） */
async function holds(p: string, h: string): Promise<boolean> {
  try {
    return sha(new Uint8Array(await readFile(p))) === h;
  } catch {
    return false;
  }
}

/**
 * 資料を置く。同じ中身ならもう置いてあるので書き直さない（中身が違えば一時の名前から置き換える）。
 * 同じ資料を、作業中の写し（/api/work の資料）と確定の前の置き（plan_source_put）が同時に置くことがある。
 * 一時の名前は呼び出しごとに別にする（同じ名前だと、片方の置き換えで一時のファイルが消え、もう片方が ENOENT で落ちていた）。
 * 置き換えが断られても（Windows では、ほかが開いているファイルへの置き換えが EPERM・EBUSY になる）、
 * ほかの呼び出しが同じ中身を置き終えていれば、それでよい（置き場所は SHA-256 で決まり、同じ名前なら同じ中身）
 */
export async function putSource(root: string, planId: string, bytes: Uint8Array): Promise<{ ok: true; sha256: string; size: number } | { ok: false; reason: "sourceTooLarge" | "sourceEmpty" }> {
  if (bytes.length === 0) return { ok: false, reason: "sourceEmpty" };
  if (bytes.length > SOURCE_MAX_BYTES) return { ok: false, reason: "sourceTooLarge" };
  const h = sha(bytes);
  const p = pathOf(root, planId, h);
  await mkdir(join(planDir(root, planId), "sources"), { recursive: true });
  if (!(await holds(p, h))) {
    const tmp = `${p}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(tmp, bytes);
    try {
      await rename(tmp, p);
    } catch (e) {
      await rm(tmp, { force: true });
      if (!(await holds(p, h))) throw e;
    }
  }
  return { ok: true, sha256: h, size: bytes.length };
}

export type SourcesCheck = { ok: true } | { ok: false; reason: "sourcesInvalid" | "sourceMissing" | "sourceChanged" | "sourcesTooLarge" };

/** 確定のときに、版の記録に書く資料と決定を照らす（形・上限・あること・ハッシュ。決定は版の資料に掛かるものだけ） */
export async function checkSources(root: string, planId: string, sources: readonly VersionSource[], decisions: readonly VersionDecision[]): Promise<SourcesCheck> {
  let total = 0;
  const shas = new Set<string>();
  for (const s of sources) {
    if (!SHA.test(s.sha256) || !SOURCE_NAME.test(s.name) || s.name.trim() !== s.name || !Number.isInteger(s.size) || s.size < 1 || s.size > SOURCE_MAX_BYTES) return { ok: false, reason: "sourcesInvalid" };
    if (shas.has(s.sha256)) return { ok: false, reason: "sourcesInvalid" };
    shas.add(s.sha256);
    total += s.size;
  }
  if (total > SOURCES_TOTAL_MAX_BYTES) return { ok: false, reason: "sourcesTooLarge" };
  for (const d of decisions) {
    if (!AUTHOR_KINDS.includes(d.author) || d.reason.length < 1 || d.sources.length === 0 || !d.sources.every((x) => shas.has(x))) return { ok: false, reason: "sourcesInvalid" };
  }
  for (const s of sources) {
    const p = pathOf(root, planId, s.sha256);
    try {
      const st = await stat(p);
      if (st.size !== s.size) return { ok: false, reason: "sourceChanged" };
      if (sha(new Uint8Array(await readFile(p))) !== s.sha256) return { ok: false, reason: "sourceChanged" };
    } catch {
      return { ok: false, reason: "sourceMissing" };
    }
  }
  return { ok: true };
}

/** 版の記録にある資料を 1 つ読む（記録にあるものだけ。ハッシュが合わなければ渡さない） */
export async function readSource(root: string, planId: string, sources: readonly VersionSource[] | undefined, h: string): Promise<{ ok: true; name: string; bytes: Buffer } | { ok: false; reason: "sourceUnknown" | "sourceMissing" | "sourceChanged" }> {
  const s = (sources ?? []).find((x) => x.sha256 === h);
  if (!s) return { ok: false, reason: "sourceUnknown" };
  let bytes: Buffer;
  try {
    bytes = await readFile(pathOf(root, planId, h));
  } catch {
    return { ok: false, reason: "sourceMissing" };
  }
  if (sha(new Uint8Array(bytes)) !== h) return { ok: false, reason: "sourceChanged" };
  return { ok: true, name: s.name, bytes };
}
