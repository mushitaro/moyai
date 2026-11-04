// コメント（src/plan/comments.ts）：保管先に 1 つ 1 ファイルで足し、古い順に読む。空の文・壊れたファイルは扱いを分ける。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addComment, readComments } from "../../src/plan/comments";
import { planDir } from "../../src/plan/store";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});
const root = () => (dir = mkdtempSync(join(tmpdir(), "moyai-comments-")));

describe("コメント", () => {
  it("足すと 1 つ 1 ファイル。古い順に読む", async () => {
    const r = root();
    const a = await addComment(r, { planId: "plan-a", version: 2, row: { mode: "common", id: "c|WI.X|OVERHAUL", label: "焼却炉 › 分解整備" }, by: "【架空】課長", text: "  2028 年度にずらすと、炉の停止は何日増えますか。 " }, new Date("2026-11-04T09:00:00Z"));
    expect(a.ok).toBe(true);
    const b = await addComment(r, { planId: "plan-a", version: 2, row: null, by: "【架空】山田", text: "計画全体の見直しは来週" }, new Date("2026-11-04T08:00:00Z"));
    expect(b.ok).toBe(true);
    const { comments, unreadable } = await readComments(r, "plan-a");
    expect(unreadable).toBe(0);
    expect(comments.map((c) => c.by)).toEqual(["【架空】山田", "【架空】課長"]);
    expect(comments[1]).toMatchObject({ text: "2028 年度にずらすと、炉の停止は何日増えますか。", row: { label: "焼却炉 › 分解整備" }, version: 2 });
  });

  it("空の文は足さない。壊れたファイルは数えて返す。無い計画は空", async () => {
    const r = root();
    expect(await addComment(r, { planId: "plan-a", version: 1, row: null, by: "【架空】山田", text: "   " })).toEqual({ ok: false, reason: "textEmpty" });
    expect(await addComment(r, { planId: "../x", version: 1, row: null, by: "【架空】山田", text: "x" })).toEqual({ ok: false, reason: "planIdInvalid" });
    await addComment(r, { planId: "plan-a", version: 1, row: null, by: "【架空】山田", text: "読める" });
    writeFileSync(join(planDir(r, "plan-a"), "comments", "zz-broken.json"), "{");
    const got = await readComments(r, "plan-a");
    expect(got.comments).toHaveLength(1);
    expect(got.unreadable).toBe(1);
    expect(await readComments(r, "plan-none")).toEqual({ comments: [], unreadable: 0 });
  });
});
