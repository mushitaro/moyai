// 橋渡しの ToolRelay：外へ出た台帳（AI に返した結果の種類・件数・大きさ。中身は残さない）と、
// 同じ会話で chart_rows を並べて呼んでも会話の上限（2,000 行）を越えないこと。タブはふり（callTool だけを持つ）。
import { describe, expect, it } from "vitest";
import { ToolRelay } from "../../src/bridge/tools";
import type { TabHub } from "../../src/bridge/tab";
import { ROWS_PER_CONVERSATION } from "../../src/shared/tools";

/** 少し待ってから、頼まれた数だけ行を返すタブ */
function slowRowsTab(): TabHub {
  return {
    callTool: async (_name: string, args: { limit: number }, _conv: string, remaining: number) => {
      await new Promise((r) => setTimeout(r, 5));
      const n = Math.min(args.limit, remaining);
      const rows = Array.from({ length: n }, (_, i) => ({ rowRef: `r${i}`, cells: { 段の道: "x" } }));
      return { kind: "ok", data: { rows, total: 99999, remainingInConversation: remaining - n, version: 1 } };
    },
  } as unknown as TabHub;
}

describe("ToolRelay", () => {
  it("同じ会話で並べて呼んでも、渡す行は会話の上限を越えない", async () => {
    const relay = new ToolRelay(slowRowsTab());
    const answers = await Promise.all(Array.from({ length: 14 }, () => relay.run("chart_rows", { offset: 0, limit: 200 }, "c1")));
    const rows = answers.reduce((s, a) => s + ("ok" in a && a.ok ? (a.data.rows as unknown[]).length : 0), 0);
    expect(rows).toBeLessThanOrEqual(ROWS_PER_CONVERSATION);
    expect(relay.rowsReadIn("c1")).toBe(rows);
    expect(answers.some((a) => "error" in a && a.error.code === "rows_limit_reached")).toBe(true);
  });

  it("外へ出た台帳に、呼び出しごとの種類・大きさ・行の数と会話の合計を残す（中身は残さない）", async () => {
    const relay = new ToolRelay(slowRowsTab());
    await relay.run("chart_rows", { offset: 0, limit: 3 }, "c1");
    await relay.run("chart_rows", { offset: 3, limit: 2 }, "c2");
    await relay.run("note_for_human", {}, "c1"); // 未実装（誤りの答えも数える）
    const log = relay.outboundLog();
    expect(log.map((e) => [e.tool, e.ok, e.rows, e.conversation])).toEqual([
      ["chart_rows", true, 3, "c1"],
      ["chart_rows", true, 2, "c2"],
      ["note_for_human", false, null, "c1"],
    ]);
    for (const e of log) {
      expect(e.bytes).toBeGreaterThan(0);
      expect(Object.keys(e).sort()).toEqual(["at", "bytes", "conversation", "imageBytes", "ok", "rows", "tool"]);
      expect(e.imageBytes).toBeNull();
    }
    const t = relay.outboundTotals("c1");
    expect(t.calls).toBe(2);
    expect(t.rows).toBe(3);
    expect(t.bytes).toBe(log[0]!.bytes + log[2]!.bytes);
  });
});
