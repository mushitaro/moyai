// タブの側のツールの受け手（src/app/intake/tab-tools.ts）を、工場の資料（fictional-1・fictional-2）で動かす：
// intake_survey → intake_settle（既定の答えを AI がチャットの人の答えとして置く）→ intake_compose（印をすぐ返す）
// → intake_survey の compose → chart_rows。答えの確かめ（出していない選択肢・人の決定・知らない質問）も試す。
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { connectTabTools, runTabTool, TAB_TOOL_RECEIVERS } from "../../../src/app/intake/tab-tools";
import { BridgeClient } from "../../../src/app/bridge-client";
import { encodeEvent } from "../../../src/shared/events";
import { clearWorkingPlan, getWorkingPlan } from "../../../src/app/state/plan-store";
import { BRIDGE_TOOL_RECEIVERS } from "../../../src/bridge/tools";
import { TOOL_NAMES, TOOLS } from "../../../src/shared/tools";

const PACK = "waste-incineration";
const CASES = [
  { facility: "fictional-1", files: ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"] },
  { facility: "fictional-2", files: ["equipment-ledger.xlsx", "plan-hoshitori.xlsx"] },
];
const CTX = { conversation: "c-test", rowsRemaining: 2000 };

afterEach(() => clearWorkingPlan());

async function workspace(c: (typeof CASES)[number]): Promise<IntakeWorkspace> {
  const ws = new IntakeWorkspace({ packId: PACK, facilityName: `【架空】${c.facility}`, fiscalYearStartMonth: 4, fictional: true });
  const dir = `samples/out/${PACK}/${c.facility}/`;
  await ws.addFiles(
    c.files.map((n) => {
      const b = new Uint8Array(readFileSync(dir + n));
      return { name: n, size: b.length, bytes: async () => b };
    }),
  );
  return ws;
}

function ok(r: ReturnType<typeof runTabTool>): any {
  if (!r.ok) throw new Error(`誤り：${r.code}`);
  return r.data;
}

test("受け手が tab のツールには、どれもタブの側の受け手がある", () => {
  for (const n of TOOL_NAMES) expect(Boolean(TAB_TOOL_RECEIVERS[n]), n).toBe(BRIDGE_TOOL_RECEIVERS[n] === "tab");
});

describe("工場の資料で、要約 → 決定 → 計画 → 星取表の行", () => {
  for (const c of CASES) {
    test(c.facility, async () => {
      const ws = await workspace(c);
      const s0 = ok(runTabTool(ws, "intake_survey", {}, CTX));
      expect(TOOLS.intake_survey.output.safeParse(s0).success).toBe(true);
      expect(s0.files.map((f: any) => f.fileRef).sort()).toEqual([...c.files].sort());
      expect(s0.samples.length).toBeLessThanOrEqual(20);
      expect(s0.questions.length).toBeGreaterThan(0);
      expect(s0.unresolvedCells).toBeGreaterThan(0);
      for (const q of s0.questions) {
        if (q.valueKind === "option") expect(q.options.length, q.text).toBeGreaterThan(0);
        if (q.defaultAnswer !== null && q.valueKind === "option") expect(q.options.map((o: any) => o.id)).toContain(q.defaultAnswer);
      }
      // 質問だけの要約には見本を付けない
      const sq = ok(runTabTool(ws, "intake_survey", { part: "questions" }, CTX));
      expect(sq.samples).toEqual([]);
      expect(sq.questions).toEqual(s0.questions);

      // 計画がまだ無いので、星取表の行は読めない
      expect(runTabTool(ws, "chart_rows", {}, CTX)).toEqual({ ok: false, code: "no_working_plan" });

      // 既定の答えを、AI がチャットの人の答えとして置く（答えが出るたびに次の質問が出るので繰り返す）
      let rounds = 0;
      for (;;) {
        const s = ok(runTabTool(ws, "intake_survey", { part: "questions" }, CTX));
        if (!s.questions.length) break;
        expect(++rounds).toBeLessThan(15);
        const decisions = s.questions
          .filter((q: any) => q.defaultAnswer !== null)
          .map((q: any) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "利用者がチャットで既定の答えでよいと言った" }));
        expect(decisions.length, "既定の答えの無い質問が残った").toBe(s.questions.length);
        const r = ok(runTabTool(ws, "intake_settle", { decisions }, CTX));
        expect(TOOLS.intake_settle.output.safeParse(r).success).toBe(true);
        expect(r.cellsAffected).toBeGreaterThanOrEqual(0);
      }
      const s1 = ok(runTabTool(ws, "intake_survey", {}, CTX));
      expect(s1.unresolvedCells).toBe(0);
      expect(s1.compose.state).toBe("idle");

      // 作り始めた印はすぐ返り、作るのはそのあと
      const started = ok(runTabTool(ws, "intake_compose", {}, CTX));
      expect(started.started).toBe(true);
      expect(Number.isNaN(Date.parse(started.startedAt))).toBe(false);
      expect(ok(runTabTool(ws, "intake_survey", { part: "compose" }, CTX)).compose.state).toBe("running");
      // 作っている最中にもう一度呼んでも、始め直さない
      expect(ok(runTabTool(ws, "intake_compose", {}, CTX))).toEqual({ started: false, startedAt: started.startedAt });
      await ws.whenComposed();
      const s2 = ok(runTabTool(ws, "intake_survey", { part: "compose" }, CTX));
      expect(s2.compose.state).toBe("done");
      expect(s2.compose.message).toMatch(/機器の節 \d+/);
      const working = getWorkingPlan();
      expect(working?.origin).toBe("intake");
      expect(working?.plan.facility.fictional).toBe(true);
      expect(working?.plan.displayName).toBe(`【架空】${c.facility}`);
      // AI の答えの作者が残る
      expect(working?.plan.details.some((d) => d.author === "ai_relayed_human")).toBe(true);

      // 星取表の行：上限どおりに返し、残りを数える
      const rows = ok(runTabTool(ws, "chart_rows", { limit: 200 }, CTX));
      expect(TOOLS.chart_rows.output.safeParse(rows).success).toBe(true);
      expect(rows.total).toBeGreaterThan(0);
      expect(rows.rows.length).toBe(Math.min(200, rows.total));
      expect(rows.remainingInConversation).toBe(2000 - rows.rows.length);
      expect(rows.version).toBe(working?.revision);
      expect(rows.rows.some((r: any) => Object.values(r.cells).some((v) => v === "○" || v === "●" || v === "◎"))).toBe(true);
      // 会話の残りが少なければ、残りまでしか返さない
      const few = ok(runTabTool(ws, "chart_rows", { limit: 200 }, { ...CTX, rowsRemaining: 3 }));
      expect(few.rows).toHaveLength(Math.min(3, rows.total));
      expect(few.remainingInConversation).toBe(3 - few.rows.length);
      // 画面に AI の作業が出る
      expect(ws.notices.some((n) => n.text.includes("決定"))).toBe(true);
    });
  }
});

describe("決定の確かめ（AI も人も同じ確かめを通る）", () => {
  test("出していない選択肢・正でない数・知らない質問は、どれも置かずに断る", async () => {
    const ws = await workspace(CASES[1]!);
    const s = ok(runTabTool(ws, "intake_survey", { part: "questions" }, CTX));
    const opt = s.questions.find((q: any) => q.valueKind === "option");
    const before = ws.decisions().length;
    const bad = runTabTool(ws, "intake_settle", { decisions: [{ questionId: opt.questionId, answer: "above", author: "ai", reason: "r" }] }, CTX);
    expect(bad).toEqual({ ok: false, code: "answer_not_offered" });
    // 1 つでも当てはまらなければ、ほかの正しい決定も置かない
    const mixed = runTabTool(
      ws,
      "intake_settle",
      {
        decisions: [
          { questionId: opt.questionId, answer: opt.defaultAnswer ?? opt.options[0].id, author: "ai", reason: "r" },
          { questionId: "q-nope", answer: "yes", author: "ai", reason: "r" },
        ],
      },
      CTX,
    );
    expect(mixed).toEqual({ ok: false, code: "unknown_question" });
    expect(ws.decisions()).toHaveLength(before);
    // 画面の人の答えも同じ確かめを通る
    expect(ws.answerAsHuman(opt.questionId, "above", "画面で人が選んだ")).toMatchObject({ ok: false, code: "answer_not_offered" });
  });

  test("数の質問は正の数だけを受ける", async () => {
    const ws = await workspace(CASES[0]!);
    const s = ok(runTabTool(ws, "intake_survey", { part: "questions" }, CTX));
    const num = s.questions.find((q: any) => q.valueKind === "number");
    expect(num).toBeTruthy();
    expect(num.options).toEqual([]);
    for (const answer of ["0", "-1", "abc", " "])
      expect(runTabTool(ws, "intake_settle", { decisions: [{ questionId: num.questionId, answer, author: "ai", reason: "r" }] }, CTX)).toEqual({
        ok: false,
        code: "answer_not_offered",
      });
    expect(ok(runTabTool(ws, "intake_settle", { decisions: [{ questionId: num.questionId, answer: "7.5", author: "ai", reason: "r" }] }, CTX))).toBeTruthy();
  });

  test("人が画面で答えた質問は、AI が変えられない。取り消すと開く", async () => {
    const ws = await workspace(CASES[1]!);
    const q = ok(runTabTool(ws, "intake_survey", { part: "questions" }, CTX)).questions.find((x: any) => x.defaultAnswer !== null);
    expect(ws.answerAsHuman(q.questionId, q.defaultAnswer, "画面で人が選んだ").ok).toBe(true);
    const other = q.options.find((o: any) => o.id !== q.defaultAnswer);
    const r = runTabTool(ws, "intake_settle", { decisions: [{ questionId: q.questionId, answer: other.id, author: "ai", reason: "r" }] }, CTX);
    expect(r).toEqual({ ok: false, code: "human_decided" });
    expect(ws.decisions().find((d) => d.questionId === q.questionId)?.author).toBe("human");
    ws.undo(q.questionId);
    expect(ws.decisions().some((d) => d.questionId === q.questionId)).toBe(false);
  });

  test("AI だけで決めたもの（作者が ai）は計画を作れても一覧に出せる形で残り、作者の印が計画に残る", async () => {
    const ws = await workspace(CASES[1]!);
    for (let i = 0; i < 10; i++) {
      const s = ok(runTabTool(ws, "intake_survey", { part: "questions" }, CTX));
      if (!s.questions.length) break;
      ok(runTabTool(ws, "intake_settle", { decisions: s.questions.map((q: any) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai", reason: "既定の答え" })) }, CTX));
    }
    expect(ws.decisions().every((d) => d.author === "ai")).toBe(true);
    ok(runTabTool(ws, "intake_compose", {}, CTX));
    await ws.whenComposed();
    expect(getWorkingPlan()?.plan.details.some((d) => d.author === "ai")).toBe(true);
    // 結ぶ質問を AI だけで答えたものだけが、AI だけで結んだものの一覧に出る
    for (const x of ws.aiOnlyLinks()) expect(x.decision.author).toBe("ai");
  });

  test("止める決まりに当たる間は、AI が作り始めても計画を作らず、理由を返す", async () => {
    const ws = await workspace(CASES[1]!);
    ok(runTabTool(ws, "intake_compose", {}, CTX));
    await ws.whenComposed();
    const s = ok(runTabTool(ws, "intake_survey", { part: "compose" }, CTX));
    expect(s.compose.state).toBe("failed");
    expect(s.compose.message).toMatch(/未解決のセル|答えの無い質問/);
    expect(getWorkingPlan()).toBeNull();
  });

  test("施設の名前が空なら作らない（画面の理由と同じ）", async () => {
    const ws = new IntakeWorkspace({ packId: PACK, facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    expect(ws.composeBlockers()).toEqual(expect.arrayContaining(["資料がまだ無い", "施設の名前が空"]));
  });

  test("橋渡しとの接続に受け手をつなぐ：呼び出しに答え、「結果不明」の知らせを画面の作業の一覧に出す", async () => {
    const ws = await workspace(CASES[1]!);
    const client = new BridgeClient("ws://127.0.0.1:1/ws"); // つながない。届いた通信を receive で渡す
    const sent: any[] = [];
    (client as any).send = (type: string, data: unknown) => sent.push({ type, data });
    connectTabTools(client, ws);
    client.receive(encodeEvent("bridge.tool_call", { requestId: "t1", name: "intake_survey", args: { part: "compose" }, conversation: "c", rowsRemaining: 2000 }));
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ type: "tab.tool_result", data: { requestId: "t1", result: { ok: true } } });
    client.receive(encodeEvent("bridge.tool_call", { requestId: "t2", name: "chart_rows", args: { offset: 0, limit: 10, view: "adjusted" }, conversation: "c", rowsRemaining: 2000 }));
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1].data.result).toEqual({ ok: false, code: "no_working_plan" });
    client.receive(encodeEvent("bridge.tool_unknown", { requestId: "t3", name: "intake_settle" }));
    expect(ws.notices[0]).toMatchObject({ kind: "unknown" });
    expect(ws.notices[0]?.text).toContain("結果不明");
    expect(ws.notices[0]?.text).toContain("intake_settle");
  });

  test("64 MB を越えるファイルは読まずに理由を残す", async () => {
    const ws = new IntakeWorkspace({ packId: PACK, facilityName: "x", fiscalYearStartMonth: 4, fictional: false });
    let read = false;
    await ws.addFiles([{ name: "big.xlsx", size: 64 * 1024 * 1024 + 1, bytes: async () => ((read = true), new Uint8Array()) }]);
    expect(read).toBe(false);
    expect(ws.skippedFiles[0]?.reason).toContain("64 MB");
    expect(ok(runTabTool(ws, "intake_survey", {}, CTX)).notes.join("\n")).toContain("big.xlsx");
  });
});
