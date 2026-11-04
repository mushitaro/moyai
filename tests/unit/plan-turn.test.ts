// 編集の番と、渡すメールの文（docs/plan.md §2.18.2・docs/screens.md 3.4）：番は保管先の turn.json。メールは版の場所とハッシュだけを運ぶ。
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TURN_SCHEMA, handoffMail, readTurn, writeTurn } from "../../src/plan/turn";

const dir = mkdtempSync(join(tmpdir(), "moyai-turn-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("編集の番とメール", () => {
  it("番は保管先の plans/<計画ID>/turn.json に置き、読み直せる。形の違うものは読まない", async () => {
    mkdirSync(join(dir, "plans", "plan-test"), { recursive: true });
    expect(await readTurn(dir, "plan-test")).toBeNull();
    const t = { schema: TURN_SCHEMA as typeof TURN_SCHEMA, planId: "plan-test", version: 3, state: "awaitingApproval" as const, holder: null, to: "boss@example.jp", from: "【架空】山田", note: "見てください", at: "2026-11-04T05:00:00.000Z" };
    await writeTurn(dir, t);
    expect(await readTurn(dir, "plan-test")).toEqual(t);
    expect(await readTurn(dir, "other-plan")).toBeNull();
  });

  it("メールは版の場所とハッシュとリンクだけを運び、計画の中身は運ばない", () => {
    const m = handoffMail({ name: "【架空】甲工場", version: 3, contentHash: "ab".repeat(32), kind: "approve", to: "boss@example.jp", note: "11 月の点検を入れました", by: "【架空】山田", planId: "plan-test", link: "http://127.0.0.1:43110/#/merge?open=plan-test&v=3&h=abababababababab" });
    expect(m.to).toBe("boss@example.jp");
    expect(m.subject).toBe("【MOYAI】【架空】甲工場 第 3 版の承認のお願い");
    expect(m.body).toContain("この版の承認をお願いします。");
    expect(m.body).toContain("11 月の点検を入れました");
    expect(m.body).toContain("plans/plan-test/versions/000003.json");
    expect(m.body).toContain("ab".repeat(32));
    expect(m.body).toContain("#/merge?open=plan-test&v=3");
    expect(m.body).toContain("計画の中身は運びません");
  });
});
