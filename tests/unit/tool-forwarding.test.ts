// 中継 → 橋渡し → タブ（タブのふり）のツールの往復（docs/plan.md §2.12）：タブが無いとき、読むものの送り直し、
// 案を置くもの・始めるものは送り直さず「結果不明」（タブにも知らせる）、答えの型の確かめ、星取表の行の上限（1 回 200・会話 2,000）。
// 中継は本物（createRelayServer）を MCP のクライアントからつなぎ、橋渡しの待ちの上限だけを短くする。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createRelayServer } from "../../src/cli/relay";
import { ERRORS, type ErrorCode } from "../../src/shared/errors";
import { encodeEvent } from "../../src/shared/events";
import { ROWS_PER_CONVERSATION } from "../../src/shared/tools";
import { FakeTab, SECRET_A, startTestBridge, type TestBridge } from "../helpers/bridge";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const SHORT = { read: 200, propose: 200, start: 200 };

async function bridge(): Promise<TestBridge> {
  const tb = await startTestBridge({ toolTimeouts: SHORT });
  cleanups.push(() => tb.close());
  return tb;
}

async function client(tb: TestBridge): Promise<Client> {
  const server = createRelayServer({ stateDir: tb.stateDir });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), c.connect(b)]);
  cleanups.push(() => c.close());
  await c.listTools();
  return c;
}

type Call = { requestId: string; name: string; args: any; conversation: string; rowsRemaining: number };

/** つながったタブのふり。answer が null を返す呼び出しには答えない */
async function tab(tb: TestBridge, answer: (call: Call) => unknown | null): Promise<{ calls: Call[]; unknowns: any[]; ws: FakeTab }> {
  const t = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
  await t.opened;
  t.send("tab.hello", { secret: SECRET_A, build: "test" });
  await t.next("bridge.welcome");
  const calls: Call[] = [];
  const unknowns: any[] = [];
  t.ws.on("message", (raw) => {
    const ev = JSON.parse(raw.toString("utf8"));
    if (ev.type === "bridge.tool_unknown") unknowns.push(ev.data);
    if (ev.type !== "bridge.tool_call") return;
    calls.push(ev.data);
    const result = answer(ev.data);
    if (result !== null) t.ws.send(encodeEvent("tab.tool_result", { requestId: ev.data.requestId, result: result as any }));
  });
  cleanups.push(() => t.ws.close());
  return { calls, unknowns, ws: t };
}

function expectError(r: any, code: ErrorCode, label = ""): void {
  expect(r.isError, label).toBe(true);
  expect(r.content, label).toEqual([{ type: "text", text: ERRORS[code].text }]);
}

const SURVEY = {
  files: [],
  samples: [],
  legends: [],
  notes: [],
  questions: [],
  unresolvedCells: 0,
  compose: { state: "idle", message: null },
};

/** 星取表の行を、上限どおりに返すタブ（全部で total 行） */
function rowsTab(total: number) {
  return (c: Call) => {
    if (c.name !== "chart_rows") return null;
    const n = Math.max(0, Math.min(c.args.limit, c.rowsRemaining, total - c.args.offset));
    const rows = Array.from({ length: n }, (_, i) => ({ rowRef: `r${c.args.offset + i}`, cells: { 段の道: "x" } }));
    return { ok: true, data: { rows, total, remainingInConversation: c.rowsRemaining - n, version: 1 } };
  };
}

describe("作業画面へ渡す", () => {
  it("タブが無ければ「作業画面が開いていません」と返す", async () => {
    const tb = await bridge();
    const c = await client(tb);
    expectError(await c.callTool({ name: "intake_survey", arguments: {} }), "work_screen_not_open");
    expect(ERRORS.work_screen_not_open.text).toContain("作業画面が開いていません");
  });

  it("タブの答えを型で確かめて渡す。既定の引数は橋渡しで埋まる", async () => {
    const tb = await bridge();
    const t = await tab(tb, () => ({ ok: true, data: SURVEY }));
    const c = await client(tb);
    const r: any = await c.callTool({ name: "intake_survey", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual(SURVEY);
    expect(t.calls[0]?.args).toEqual({ part: "all" });
    expect(t.calls[0]?.conversation).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("型に合わない答えは渡さない", async () => {
    const tb = await bridge();
    await tab(tb, () => ({ ok: true, data: { files: "x" } }));
    const c = await client(tb);
    expectError(await c.callTool({ name: "intake_survey", arguments: {} }), "tab_bad_result");
  });

  it("タブが返した誤りは、その文で返す", async () => {
    const tb = await bridge();
    await tab(tb, () => ({ ok: false, code: "no_working_plan" }));
    const c = await client(tb);
    expectError(await c.callTool({ name: "chart_rows", arguments: {} }), "no_working_plan");
  });
});

describe("待ちの上限と送り直し（橋渡しは 1 回だけ渡し、送り直しは中継がする）", () => {
  it("読むもの：答えが来なければ 1 回だけ送り直し、時間切れを返す。画面に「結果不明」は出さない", async () => {
    const tb = await bridge();
    const t = await tab(tb, () => null);
    const c = await client(tb);
    expectError(await c.callTool({ name: "intake_survey", arguments: {} }), "bridge_timeout");
    expect(t.calls).toHaveLength(2);
    expect(t.unknowns).toHaveLength(0);
  });

  it("読むもの：1 回目が来なくても、送り直しで来れば渡す", async () => {
    const tb = await bridge();
    let n = 0;
    const t = await tab(tb, () => (++n === 1 ? null : { ok: true, data: SURVEY }));
    const c = await client(tb);
    const r: any = await c.callTool({ name: "intake_survey", arguments: {} });
    expect(r.structuredContent).toEqual(SURVEY);
    expect(t.calls).toHaveLength(2);
  });

  it("案を置くもの：送り直さず「結果不明」を返し、タブにも知らせる", async () => {
    const tb = await bridge();
    const t = await tab(tb, () => null);
    const c = await client(tb);
    const r = await c.callTool({
      name: "intake_settle",
      arguments: { decisions: [{ questionId: "q-1", answer: "yes", author: "ai", reason: "見本" }] },
    });
    expectError(r, "result_unknown");
    expect(t.calls).toHaveLength(1);
    await expect.poll(() => t.unknowns.length).toBe(1);
    expect(t.unknowns[0]).toMatchObject({ name: "intake_settle", requestId: t.calls[0]?.requestId });
  });

  it("始めるもの（計画を作る）：20 秒の上限の中で印を返さなければ、送り直さず「結果不明」", async () => {
    const tb = await bridge();
    const t = await tab(tb, () => null);
    const c = await client(tb);
    expectError(await c.callTool({ name: "intake_compose", arguments: {} }), "result_unknown");
    expect(t.calls).toHaveLength(1);
    await expect.poll(() => t.unknowns.length).toBe(1);
  });

  it("答えを待つ間にタブが閉じたら、案を置くものは「結果不明」", async () => {
    const tb = await startTestBridge({ toolTimeouts: { propose: 5_000 } });
    cleanups.push(() => tb.close());
    const t = await tab(tb, () => null);
    const c = await client(tb);
    const p = c.callTool({ name: "intake_settle", arguments: { decisions: [{ questionId: "q", answer: "a", author: "ai", reason: "r" }] } });
    await expect.poll(() => t.calls.length).toBe(1);
    t.ws.ws.close();
    expectError(await p, "result_unknown");
  });

  it("作者が人の決定は、型で断り、タブへ渡さない", async () => {
    const tb = await bridge();
    const t = await tab(tb, () => ({ ok: true, data: { cellsAffected: 0, rowsAffected: 0, unresolved: 0 } }));
    const c = await client(tb);
    for (const d of [
      { questionId: "q", answer: "a", author: "human", reason: "r" },
      { questionId: "q", answer: "a", author: "ai", reason: "" },
    ]) {
      const r: any = await c.callTool({ name: "intake_settle", arguments: { decisions: [d] } });
      expect(r.isError).toBe(true);
    }
    expect(t.calls).toHaveLength(0);
  });
});

describe("星取表の行の上限", () => {
  it("1 回 200 行まで（201 は型で断る）", async () => {
    const tb = await bridge();
    const t = await tab(tb, rowsTab(3000));
    const c = await client(tb);
    const r: any = await c.callTool({ name: "chart_rows", arguments: { limit: 201 } });
    expect(r.isError).toBe(true);
    expect(t.calls).toHaveLength(0);
  });

  it("会話で 2,000 行まで。数えるのは橋渡しで、残りより多くはタブに求めない。別の会話は別に数える", async () => {
    const tb = await bridge();
    const t = await tab(tb, rowsTab(3000));
    const c = await client(tb);
    let offset = 0;
    for (let i = 0; i < 9; i++) {
      const r: any = await c.callTool({ name: "chart_rows", arguments: { offset, limit: 200 } });
      expect(r.structuredContent.rows).toHaveLength(200);
      expect(r.structuredContent.remainingInConversation).toBe(ROWS_PER_CONVERSATION - 200 * (i + 1));
      offset += 200;
    }
    const r10: any = await c.callTool({ name: "chart_rows", arguments: { offset, limit: 150 } });
    expect(r10.structuredContent.remainingInConversation).toBe(50);
    const r11: any = await c.callTool({ name: "chart_rows", arguments: { offset: offset + 150, limit: 200 } });
    // 残り 50 行なので、タブには 50 行だけを求める
    expect(t.calls.at(-1)?.args.limit).toBe(50);
    expect(t.calls.at(-1)?.rowsRemaining).toBe(50);
    expect(r11.structuredContent.rows).toHaveLength(50);
    expect(r11.structuredContent.remainingInConversation).toBe(0);
    const before = t.calls.length;
    expectError(await c.callTool({ name: "chart_rows", arguments: { offset: 0, limit: 1 } }), "rows_limit_reached");
    expect(t.calls).toHaveLength(before);
    // 中継のもう 1 つの接続は、別の会話
    const c2 = await client(tb);
    const other: any = await c2.callTool({ name: "chart_rows", arguments: { limit: 10 } });
    expect(other.structuredContent.remainingInConversation).toBe(ROWS_PER_CONVERSATION - 10);
  });

  it("上限を越えて返すタブ・残りを違えて返すタブの答えは渡さず、数にも入れない", async () => {
    const tb = await bridge();
    await tab(tb, (c) => ({
      ok: true,
      data: { rows: Array.from({ length: c.args.limit + 1 }, (_, i) => ({ rowRef: `r${i}`, cells: {} })), total: 999, remainingInConversation: 0, version: 1 },
    }));
    const c = await client(tb);
    expectError(await c.callTool({ name: "chart_rows", arguments: { limit: 5 } }), "tab_bad_result");
  });
});
