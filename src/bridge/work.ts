// 施設ごとの「作業中」（mushitaro/moyai#82）。作業画面の作業中のもの（資料の写し・資料の印・取り込みの答え・作業中の計画・確定のシートの確定）を、
// 保管先の <root>/plans/<計画ID>/work/state.json に残す。資料のバイト列は、版と同じ plans/<計画ID>/sources/<SHA-256>（同じ中身は 1 つ）。
// - 書くのは橋渡し。作業画面が、変わるたびに間を置いてまとめて送る（作業画面だけの経路 /tab/work-*。タブの秘密で確かめる。人だけの経路ではない）。
// - 作業中は版ではない（署名も鎖も無い）。署名した版は今のまま別。確定したあとは、次の版の作業中として続く（消さない）。
// - AI のツールには作業中を読む・書く・消す道が無い（ツールの道で作業画面が変わった結果が、作業画面から書かれるだけ）。消すのは人だけ（人だけの経路 work_discard）。
// - 行の値・鍵は記録（ログ）に書かない。ここが書くのは保管先のファイルだけ。
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PLAN_ID, planDir } from "../plan/paths";

export const WORK_SCHEMA = "moyai.work/1";
/** 1 つの作業中の state.json の上限（計画と答えと確定。資料のバイト列は入らない） */
export const WORK_STATE_MAX_BYTES = 32 * 1024 * 1024;

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

export const workFileSchema = z.object({
  name: z.string().min(1).max(255),
  sha256: sha256Hex,
  size: z.number().int().min(0),
  /** デモで入れた資料（【架空】の資料と、利用者の資料を混ぜない印） */
  demo: z.boolean().optional(),
});

export const workStateSchema = z.object({
  schema: z.literal(WORK_SCHEMA),
  savedAt: z.string().max(40),
  build: z.string().max(120),
  planId: z.string().regex(PLAN_ID),
  /** トップの行に出す名前と、未確定の数（作業画面が数える。行の値ではない） */
  displayName: z.string().max(200),
  fictional: z.boolean(),
  open: z.number().int().min(0),
  /** 確定していない変更があるか（確定した直後は false。トップは、これか未確定があるときだけ「作業中」と出す） */
  changed: z.boolean(),
  /** もとにした版（無ければ null） */
  base: z.number().int().min(1).nullable(),
  settings: z.object({ packId: z.string().max(80), facilityName: z.string().max(200), fiscalYearStartMonth: z.number().int().min(1).max(12), fictional: z.boolean() }),
  files: z.array(workFileSchema).max(500),
  /** 写さなかった資料の数（写真も写すので今は 0。前の形の作業中を読むため残す） */
  skipped: z.number().int().min(0),
  decisions: z.array(z.unknown()).max(100_000),
  /** 作業中の計画（まだ作っていなければ null） */
  plan: z.unknown().nullable(),
  proposals: z.array(z.unknown()).max(100_000),
  accepted: z.array(z.object({ id: z.string().max(200), hash: z.string().regex(/^[0-9a-f]{16}$/), reason: z.string().max(500) })).max(100_000),
});
export type WorkState = z.infer<typeof workStateSchema>;

export interface WorkSummary {
  planId: string;
  displayName: string;
  fictional: boolean;
  open: number;
  changed: boolean;
  base: number | null;
  savedAt: string;
}

const workDir = (root: string, planId: string) => join(planDir(root, planId), "work");
const statePath = (root: string, planId: string) => join(workDir(root, planId), "state.json");
const sourcePath = (root: string, planId: string, sha: string) => join(planDir(root, planId), "sources", sha);

export type WorkWrite = { ok: true } | { ok: false; reason: "workInvalid" | "workSourceMissing" | "workTooLarge" };

/** 作業中を書く（形を確かめ、書いた資料の写しがそろっているときだけ。途中で切れても前のものが残るよう、別の名前に書いてから移す） */
export async function writeWork(root: string, raw: unknown): Promise<WorkWrite> {
  const p = workStateSchema.safeParse(raw);
  if (!p.success) return { ok: false, reason: "workInvalid" };
  const s = p.data;
  const plan = s.plan as { planId?: unknown } | null;
  if (plan !== null && (typeof plan !== "object" || plan.planId !== s.planId)) return { ok: false, reason: "workInvalid" };
  for (const f of s.files) {
    try {
      const st = await stat(sourcePath(root, s.planId, f.sha256));
      if (st.size !== f.size) return { ok: false, reason: "workSourceMissing" };
    } catch {
      return { ok: false, reason: "workSourceMissing" };
    }
  }
  const text = `${JSON.stringify(s)}\n`;
  if (Buffer.byteLength(text) > WORK_STATE_MAX_BYTES) return { ok: false, reason: "workTooLarge" };
  const dir = workDir(root, s.planId);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `state.json.tmp-${randomUUID()}`);
  await writeFile(tmp, text);
  await rename(tmp, statePath(root, s.planId));
  return { ok: true };
}

/** 作業中を読む（無い・壊れていれば null） */
export async function readWork(root: string, planId: string): Promise<WorkState | null> {
  if (!PLAN_ID.test(planId)) return null;
  try {
    const p = workStateSchema.safeParse(JSON.parse(await readFile(statePath(root, planId), "utf8")));
    return p.success && p.data.planId === planId ? p.data : null;
  } catch {
    return null;
  }
}

/** 保管先の作業中の一覧（トップの行。名前・未確定の数・時刻だけ） */
export async function listWork(root: string): Promise<WorkSummary[]> {
  let ids: string[];
  try {
    ids = (await readdir(join(root, "plans"), { withFileTypes: true })).filter((d) => d.isDirectory() && PLAN_ID.test(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
  const out: WorkSummary[] = [];
  for (const id of ids) {
    const w = await readWork(root, id);
    if (w) out.push({ planId: w.planId, displayName: w.displayName, fictional: w.fictional, open: w.open, changed: w.changed, base: w.base, savedAt: w.savedAt });
  }
  return out;
}

/** 作業中の資料を 1 つ読む（その作業中が持つ資料だけ。ハッシュが合わなければ渡さない） */
export async function readWorkSource(root: string, planId: string, sha: string): Promise<Buffer | null> {
  const w = await readWork(root, planId);
  if (!w || !w.files.some((f) => f.sha256 === sha)) return null;
  try {
    const b = await readFile(sourcePath(root, planId, sha));
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(b).digest("hex") === sha ? b : null;
  } catch {
    return null;
  }
}

/** 署名した版の記録が持つ資料の SHA-256（plans/<計画ID>/versions/*.json の sources） */
async function versionSources(root: string, planId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const dir = join(planDir(root, planId), "versions");
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return out;
  }
  for (const n of names) {
    try {
      const v = JSON.parse(await readFile(join(dir, n), "utf8")) as { sources?: { sha256?: unknown }[]; record?: { sources?: { sha256?: unknown }[] } };
      for (const x of [...(v.sources ?? []), ...(v.record?.sources ?? [])]) if (typeof x?.sha256 === "string") out.add(x.sha256);
    } catch {
      // 読めない版の記録があれば、資料は消さない（消しすぎない）
      out.add("*");
    }
  }
  return out;
}

/** 作業中を消す（人だけ）。作業中だけが持っていた資料の写しも消す。署名した版と、版が持つ資料は消さない */
export async function discardWork(root: string, planId: string): Promise<boolean> {
  if (!PLAN_ID.test(planId)) return false;
  const w = await readWork(root, planId);
  await rm(workDir(root, planId), { recursive: true, force: true });
  if (w && w.files.length > 0) {
    const keep = await versionSources(root, planId);
    if (!keep.has("*")) for (const f of w.files) if (!keep.has(f.sha256)) await rm(sourcePath(root, planId, f.sha256), { force: true });
  }
  return true;
}
