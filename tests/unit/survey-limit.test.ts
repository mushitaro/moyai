// intake_survey の答えの大きさの上限（ops/tasks/intake-many-v1）：中継 → 橋渡し → タブ（タブのふり）を通しても、
// AI に届く結果（JSON の文字）が上限の内で、質問を分けたときは cursor で続きが読める。タブには part・cursor・limit がそのまま届く。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createRelayServer } from "../../src/cli/relay";
import { encodeEvent } from "../../src/shared/events";
import { SURVEY_MAX_BYTES } from "../../src/shared/tools";
import { FakeTab, SECRET_A, startTestBridge, type TestBridge } from "../helpers/bridge";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function bridge(): Promise<TestBridge> {
  const tb = await startTestBridge({ toolTimeouts: { read: 2_000, propose: 2_000, start: 2_000 } });
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

type Call = { requestId: string; name: string; args: Record<string, unknown> };

async function tab(tb: TestBridge, data: Record<string, unknown>): Promise<Call[]> {
  const t = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
  await t.opened;
  t.send("tab.hello", { secret: SECRET_A, build: "test" });
  await t.next("bridge.welcome");
  const calls: Call[] = [];
  t.ws.on("message", (raw) => {
    const ev = JSON.parse(raw.toString("utf8"));
    if (ev.type !== "bridge.tool_call") return;
    calls.push(ev.data);
    t.ws.send(encodeEvent("tab.tool_result", { requestId: ev.data.requestId, result: { ok: true, data } as never }));
  });
  cleanups.push(() => t.ws.close());
  return calls;
}

/** 質問 900（同じ選択肢の並び 8 個）の要約。タブ → 橋渡しの 1 通の上限（1 MB）の内で、AI の結果の上限は越える */
function survey(): Record<string, unknown> {
  const options = Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, label: `【架空】選択肢の説明 ${i}` }));
  const questions = Array.from({ length: 900 }, (_, i) => ({
    questionId: `q-${i}`,
    kind: "columnRole",
    text: `列 ${String.fromCharCode(65 + (i % 26))}（見出し「【架空】見出し ${i}」・中身の見本 「【架空】値 ${i}」・表の 3〜${30 + i} 行目）の役目が決まらない`,
    sameShapeRows: 1,
    defaultAnswer: "o0",
    valueKind: "option",
    options,
  }));
  return {
    files: Array.from({ length: 100 }, (_, i) => ({ fileRef: `【架空】資料_${i}.pdf`, sheets: 1, rows: 50 })),
    samples: [],
    legends: [],
    notes: ["【架空】注記"],
    questions,
    questionGroups: [{ kind: "columnRole", shape: "列 X（見出し「…」・中身の見本 「…」・表の n〜n 行目）の役目が決まらない", count: 900, rows: 900, example: { questionId: "q-0", text: questions[0]!.text } }],
    unresolvedCells: 1234,
    stuck: [],
    compose: { state: "idle", message: null },
    crosswalk: null,
  };
}

const textBytes = (r: { content: { type: string; text?: string }[] }) => Buffer.byteLength(r.content.map((c) => c.text ?? "").join(""), "utf8");

describe("intake_survey の答えの大きさ（中継 → 橋渡し → タブ）", () => {
  it("上限を越える要約は分けて返し、cursor で続きが読める。どの答えも上限の内", async () => {
    const tb = await bridge();
    const big = survey();
    expect(Buffer.byteLength(JSON.stringify(big))).toBeGreaterThan(SURVEY_MAX_BYTES * 3);
    expect(Buffer.byteLength(JSON.stringify(big))).toBeLessThan(900_000);
    const calls = await tab(tb, big);
    const c = await client(tb);
    const r: any = await c.callTool({ name: "intake_survey", arguments: {} });
    expect(r.isError, JSON.stringify(r.content).slice(0, 300)).toBeFalsy();
    expect(textBytes(r)).toBeLessThanOrEqual(SURVEY_MAX_BYTES);
    const page = r.structuredContent.questionsPage;
    expect(page.total).toBe(900);
    expect(page.nextCursor).toBe(r.structuredContent.questions.length);
    expect(r.structuredContent.questionGroups[0].count).toBe(900);
    // 同じ選択肢の並びは、2 問目から先の質問を指す
    expect(r.structuredContent.questions[1].options).toEqual([]);
    expect(r.structuredContent.questions[1].sameOptionsAs).toBe("q-0");
    const ids: string[] = r.structuredContent.questions.map((q: { questionId: string }) => q.questionId);
    let next: number | null = page.nextCursor;
    for (let i = 0; next !== null && i < 50; i++) {
      const r2: any = await c.callTool({ name: "intake_survey", arguments: { part: "questions", cursor: next } });
      expect(r2.isError).toBeFalsy();
      expect(textBytes(r2)).toBeLessThanOrEqual(SURVEY_MAX_BYTES);
      ids.push(...r2.structuredContent.questions.map((q: { questionId: string }) => q.questionId));
      next = r2.structuredContent.questionsPage.nextCursor;
    }
    expect(ids).toEqual((big.questions as { questionId: string }[]).map((q) => q.questionId));
    expect(calls[0]?.args).toEqual({ part: "all" });
    expect(calls[1]?.args).toMatchObject({ part: "questions", cursor: expect.any(Number) });
    const r3: any = await c.callTool({ name: "intake_survey", arguments: { part: "questions", cursor: 3, limit: 2 } });
    expect(r3.structuredContent.questions.map((q: { questionId: string }) => q.questionId)).toEqual(["q-3", "q-4"]);
    expect(r3.structuredContent.questionsPage).toEqual({ total: 900, cursor: 3, returned: 2, nextCursor: 5 });
  });
});
