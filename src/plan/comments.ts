// コメント（docs/screens.md 3.2・6、P2 の 6）：版・行・呼び名・時刻・文を、保管先の計画のフォルダの下に 1 つ 1 ファイルで置く（足すだけ）。
// 星取表の行（行の切り替えと行の鍵、見せる道の字）に付ける。行を選ばずに書けば、計画そのものに付く。
// 署名はしない（決めるのは版の署名。コメントは話し合いのため）。共有（輪・台帳）には写さない。
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { PLAN_ID, planDir } from "./store";

export const COMMENT_SCHEMA = "moyai.comment/0";
export const COMMENT_MAX = 2000;

export const PlanComment = z.object({
  schema: z.literal(COMMENT_SCHEMA),
  planId: z.string(),
  /** 書いたときに見ていた版（まだ署名していない版なら、その次の版の番号） */
  version: z.number().int().min(0),
  /** 星取表の行（無ければ計画そのもの） */
  row: z.object({ mode: z.enum(["ledger", "common"]), id: z.string().min(1).max(500), label: z.string().max(500) }).nullable(),
  by: z.string().min(1).max(40),
  at: z.string(),
  text: z.string().min(1).max(COMMENT_MAX),
});
export type PlanComment = z.infer<typeof PlanComment>;

const commentsDir = (root: string, planId: string) => join(planDir(root, planId), "comments");

/** コメントを足す（ファイルの名前は時刻と乱数。上書きしない） */
export async function addComment(
  root: string,
  c: Omit<PlanComment, "schema" | "at">,
  now: Date = new Date(),
): Promise<{ ok: true; comment: PlanComment } | { ok: false; reason: "planIdInvalid" | "textEmpty" | "nameInvalid" }> {
  if (!PLAN_ID.test(c.planId)) return { ok: false, reason: "planIdInvalid" };
  const text = c.text.trim();
  if (!text) return { ok: false, reason: "textEmpty" };
  const comment = PlanComment.safeParse({ ...c, text, schema: COMMENT_SCHEMA, at: now.toISOString() });
  if (!comment.success) return { ok: false, reason: "nameInvalid" };
  const dir = commentsDir(root, c.planId);
  await mkdir(dir, { recursive: true });
  const name = `${now.toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.json`;
  await writeFile(join(dir, name), `${JSON.stringify(comment.data, null, 2)}\n`, { flag: "wx" });
  return { ok: true, comment: comment.data };
}

/** 計画のコメントを古い順に読む。読めないファイルは数えて返す（黙って捨てない） */
export async function readComments(root: string, planId: string): Promise<{ comments: PlanComment[]; unreadable: number }> {
  if (!PLAN_ID.test(planId)) return { comments: [], unreadable: 0 };
  let names: string[] = [];
  try {
    names = (await readdir(commentsDir(root, planId))).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return { comments: [], unreadable: 0 };
  }
  const comments: PlanComment[] = [];
  let unreadable = 0;
  for (const n of names) {
    try {
      const c = PlanComment.safeParse(JSON.parse(await readFile(join(commentsDir(root, planId), n), "utf8")));
      if (c.success && c.data.planId === planId) comments.push(c.data);
      else unreadable++;
    } catch {
      unreadable++;
    }
  }
  comments.sort((a, b) => a.at.localeCompare(b.at));
  return { comments, unreadable };
}
