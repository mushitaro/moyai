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

  it("台帳を根拠にした周期の案は、今の台帳の版と、この会話で読んだ集計の似た施設 5 以上を照らしてから渡す（台帳の中-5）", async () => {
    const V = "abcdef012345";
    let head: string | null = V;
    const sent: string[] = [];
    const sentArgs: Record<string, unknown>[] = [];
    const tab = {
      callTool: async (name: string, args: Record<string, unknown>) => {
        sent.push(name);
        sentArgs.push(args);
        if (name === "peer_reference") return { kind: "ok", data: { mode: "ledger" } };
        return { kind: "ok", data: { matched: 2, conflicts: 0, examples: [], proposals: [], version: 1 } };
      },
    } as unknown as TabHub;
    const stat = (n: number) => (n >= 5 ? { shown: "median", n, median: "I3", q1: "I2", q3: "I4" } : n >= 3 ? { shown: "range", n, low: "I2", high: "I4" } : { shown: "x" });
    const agg = (commonItem: string, n: number) => ({ place: "ledger", commonItem, work: "OVERHAUL", interval: stat(n), manDays: { shown: "x" }, days: { shown: "x" } });
    const relay = new ToolRelay(tab, {}, {
      peer_reference: async () => ({ mode: "ledger", position: "municipal", floorK: 3, places: [], aggregates: [agg("WI.A", 6), agg("WI.B", 4)], cards: [], ledgerVersion: head, needs: [], reason: null }),
      ledger_version: async () => head,
    });
    const propose = (commonItem: string, ledgerVersion = V) =>
      relay.run("chart_propose", { rules: [{ when: [], set: { field: "work.trigger", value: 3 }, reason: "台帳" }], basedOnVersion: 1, basis: "台帳", ledger: { ledgerVersion, commonItem, work: "OVERHAUL" } }, "c1");
    const code = (a: Awaited<ReturnType<typeof propose>>) => ("error" in a ? a.error.code : "ok");

    // 台帳をまだ読んでいない会話では渡さない
    expect(code(await propose("WI.A"))).toBe("ledger_basis_unchecked");
    expect(sent).toEqual([]);
    await relay.run("peer_reference", { place: "ledger" }, "c1");
    // 似た施設 6（中央の帯）なら渡す。4（幅の帯）・読んでいない項目・違う版は渡さない
    expect(code(await propose("WI.A"))).toBe("ok");
    // 照らした集計（似た施設の数・帯）を作業画面に渡す（Architect の 52。AI の書いた数は使わない）
    expect((sentArgs.at(-1)!.ledger as { checked: unknown }).checked).toEqual({ n: 6, median: "I3", q1: "I2", q3: "I4" });
    expect(code(await propose("WI.B"))).toBe("ledger_basis_unchecked");
    expect(code(await propose("WI.C"))).toBe("ledger_basis_unchecked");
    expect(code(await propose("WI.A", "000000000000"))).toBe("ledger_basis_unchecked");
    // 別の会話で読んだ集計は使えない
    expect(code(await relay.run("chart_propose", { rules: [], basedOnVersion: 1, basis: "台帳", ledger: { ledgerVersion: V, commonItem: "WI.A", work: "OVERHAUL" } }, "c2"))).toBe("ledger_basis_unchecked");
    // 台帳を pull して版が変わったら、読み直すまで渡さない
    head = "111111111111";
    expect(code(await propose("WI.A", head))).toBe("ledger_basis_unchecked");
    expect(sent.filter((n) => n === "chart_propose")).toHaveLength(1);
    // 台帳を根拠にしない案（ledger を添えない）は前のとおり渡す
    expect(code(await relay.run("chart_propose", { rules: [], basedOnVersion: 1, basis: "利用者の答え" }, "c1"))).toBe("ok");
  });
});
