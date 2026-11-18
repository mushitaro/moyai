// 資料を作業画面から消す（運営者 2026-11-18：デモで別の資料に入れ替えたい）。人の「消す」と AI の intake_remove_files が同じ道（workspace の removeFiles）を通る。
// - 消すと、その資料から読んだ行・その資料にだけかかる問いと答えが外れ、作業中の計画は今の道で作り直す（行が残りの資料のものだけになる）。
// - 確定した版（保管先の版の履歴）・ディスクの資料には触れない。作業画面に無い名前は、どれも消さずに断る。
// - AI は apply なしで先に数だけを返し、apply: true で消す。人が画面で答えた問いにかかる資料は、AI からは消さない。
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabToolAsync } from "../../src/app/intake/tab-tools";
import { clearWorkingPlan, getWorkingPlan, setWorkingPlan } from "../../src/app/state/plan-store";
import { BRIDGE_TOOL_RECEIVERS } from "../../src/bridge/tools";
import { INTAKE_REMOVE_NOTES, TOOLS, TOOL_NAMES } from "../../src/shared/tools";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { skillMoyaiMarkdown } from "../../src/shared/skill-moyai";
import { DEMO_MIXED_NOTE } from "../../src/shared/tools";

const PACK = "waste-incineration";
const DIR = `samples/out/${PACK}/fictional-1/`;
const FILES = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"];
const CTX = { conversation: "c-remove", rowsRemaining: 2000 };
/** 資料の中のセルの値（AI の結果に入ってはいけない） */
const CELL_VALUES = ["【架空】", "通風補機"];

afterEach(() => clearWorkingPlan());

async function workspace(files = FILES): Promise<IntakeWorkspace> {
  const ws = new IntakeWorkspace({ packId: PACK, facilityName: "【架空】消す試験", fiscalYearStartMonth: 4, fictional: true });
  await ws.addFiles(
    files.map((n) => {
      const b = new Uint8Array(readFileSync(DIR + n));
      return { name: n, size: b.length, bytes: async () => b };
    }),
  );
  return ws;
}

/** 既定の答えを、AI が会話の人の答えとして置く（問いが無くなるまで） */
function settleAll(ws: IntakeWorkspace, author: "ai_relayed_human" | "human" = "ai_relayed_human"): void {
  for (let round = 0; round < 15; round++) {
    const open = ws.view.questions.filter((q) => ws.view.open.includes(q.questionId) && q.defaultAnswer !== null);
    if (!open.length) return;
    if (author === "human") for (const q of open) expect(ws.answerAsHuman(q.questionId, q.defaultAnswer!, "画面で答えた").ok).toBe(true);
    else expect(ws.settle(open.map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer!, author, reason: "会話で既定の答えでよいと言った" }))).ok).toBe(true);
  }
}

async function composed(ws: IntakeWorkspace): Promise<void> {
  ws.startCompose("human");
  await ws.whenComposed();
  expect(ws.compose.state).toBe("done");
}

/**
 * 消したあと、今の道で作り直した計画を待つ。残りの資料に答えていない問いが出て作れなければ（作り直していない）、
 * 署名は止まり（notRecomposed）、答えてから作ると、消した資料の行は無い
 */
async function recomposed(ws: IntakeWorkspace): Promise<void> {
  await ws.whenComposed();
  if (ws.compose.state === "failed") {
    expect(ws.notRecomposed()).toBe(true);
    settleAll(ws);
    await composed(ws);
  }
  expect(ws.compose.state).toBe("done");
  expect(ws.notRecomposed()).toBe(false);
  expect(detailFiles().has("daily-report.csv")).toBe(false);
  expect(detailFiles().size).toBeGreaterThan(0);
}

/** 作業中の計画の行（作業明細）の出どころの資料 */
const detailFiles = () => new Set(getWorkingPlan()!.plan.details.flatMap((d) => d.sources.map((x) => x.file)));

async function tool(ws: IntakeWorkspace, args: Record<string, unknown>): Promise<any> {
  const r = await runTabToolAsync(ws, "intake_remove_files", args, CTX);
  if (!r.ok) throw new Error(`誤り：${r.code}`);
  expect(TOOLS.intake_remove_files.output.safeParse(r.data).success).toBe(true);
  const text = JSON.stringify(r.data);
  for (const v of CELL_VALUES) expect(text).not.toContain(v);
  return r.data;
}

describe("ツールの形", () => {
  test("21 個目の intake_remove_files：作業画面が受ける案のツール。名前に確定・送るの語を含まず、instructions と SKILL.md の一覧にある", () => {
    expect(TOOL_NAMES).toContain("intake_remove_files");
    expect(TOOLS.intake_remove_files.kind).toBe("propose");
    expect(TOOLS.intake_remove_files.waitsFor).toBeNull();
    expect(BRIDGE_TOOL_RECEIVERS.intake_remove_files).toBe("tab");
    expect(MCP_INSTRUCTIONS).toMatch(/Working tools: [^\n]*intake_remove_files/);
    expect(skillMoyaiMarkdown()).toContain("intake_remove_files");
    // AI の文は英語で、利用者には利用者の言葉で返す（どのツールの説明にも添える）
    expect(TOOLS.intake_remove_files.description).toContain("Reply to the user in the user's language");
    for (const n of Object.values(INTAKE_REMOVE_NOTES)) expect(n).toMatch(/^[\x20-\x7e]+$/);
    // デモの資料を断ったときの次の手は、消す道を指す（読み込み直しだけの「消すボタンは無い」ではない）
    expect(DEMO_MIXED_NOTE).toContain("intake_remove_files");
    expect(DEMO_MIXED_NOTE).not.toMatch(/no button to remove/);
    // 型：files は 1 つ以上 200 まで、apply は真偽
    expect(TOOLS.intake_remove_files.input.safeParse({ files: [] }).success).toBe(false);
    expect(TOOLS.intake_remove_files.input.safeParse({ files: Array.from({ length: 201 }, (_, i) => `f${i}.csv`) }).success).toBe(false);
    expect(TOOLS.intake_remove_files.input.safeParse({ files: ["a.csv"], apply: "yes" }).success).toBe(false);
  });
});

describe("作業場：資料を消す", () => {
  test("消すと、その資料から読んだ行と、その資料にだけかかる問い・答えが外れ、作業中の計画は残りの資料で作り直す", async () => {
    const ws = await workspace();
    settleAll(ws);
    await composed(ws);
    expect(detailFiles().has("daily-report.csv")).toBe(true);
    const before = ws.decisions().length;
    const qBefore = ws.view.questions.length;

    const r = await ws.removeFiles(["daily-report.csv"], "human");
    if (!r.ok) throw new Error(r.reason);
    expect(r.removed).toEqual(["daily-report.csv"]);
    expect(r.filesLeft).toBe(2);
    expect(r.plan).toBe("recomposing");
    expect(ws.fileNames).toEqual(["equipment-ledger.xlsx", "plan-hoshitori.xlsx"]);
    // 答えは、残った問いにかかるものだけが残る
    const dropped = Object.values(r.droppedDecisions).reduce((a, b) => a + b, 0);
    expect(dropped).toBeGreaterThan(0);
    expect(ws.decisions().length).toBe(before - dropped);
    expect(r.droppedQuestions).toBeGreaterThan(0);
    expect(ws.view.questions.length).toBeLessThan(qBefore);
    const left = new Set(ws.view.questions.map((q) => q.questionId));
    for (const d of ws.decisions()) expect(left.has(d.questionId)).toBe(true);
    await recomposed(ws);
  });

  test("確定した版（保管先の版の中身）は変わらない：版をもとにした作業中の計画は、資料が残らなくても消さない", async () => {
    const ws = await workspace(["equipment-ledger.xlsx"]);
    settleAll(ws);
    await composed(ws);
    // 確定した版 1 のつもりの計画（保管先の版の中身の写し）
    const stored = structuredClone({ ...getWorkingPlan()!.plan, version: 1 });
    const frozen = JSON.stringify(stored);
    setWorkingPlan(stored, "intake");
    expect(getWorkingPlan()!.base).toBe(1);

    const r = await ws.removeFiles(["equipment-ledger.xlsx"], "human");
    if (!r.ok) throw new Error(r.reason);
    expect(r.filesLeft).toBe(0);
    expect(r.plan).toBe("kept");
    expect(getWorkingPlan()!.plan.version).toBe(1);
    expect(JSON.stringify(stored)).toBe(frozen);
    // 資料が無いので、作り直せない（作るのは資料を入れてから）
    expect(ws.composeBlockers().length).toBeGreaterThan(0);
  });

  test("資料が 1 つも残らず、版をもとにしていなければ、作業中の計画も消える", async () => {
    const ws = await workspace(["equipment-ledger.xlsx"]);
    settleAll(ws);
    await composed(ws);
    expect(getWorkingPlan()!.base).toBeNull();
    const r = await ws.removeFiles(["equipment-ledger.xlsx"], "human");
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan).toBe("cleared");
    expect(getWorkingPlan()).toBeNull();
    expect(ws.fileCount).toBe(0);
    expect(ws.decisions()).toEqual([]);
  });

  test("作業画面に無い名前が 1 つでもあれば、どれも消さない", async () => {
    const ws = await workspace();
    const dv = ws.decisions().length;
    const r = await ws.removeFiles(["daily-report.csv", "nai.xlsx"], "human");
    expect(r).toEqual({ ok: false, reason: "unknown", unknown: ["nai.xlsx"] });
    expect(ws.fileNames).toEqual(FILES);
    expect(ws.decisions().length).toBe(dv);
  });

  test("dryRun は消さずに、かかる問いと答えの数だけを返す", async () => {
    const ws = await workspace();
    settleAll(ws);
    const r = await ws.removeFiles(["daily-report.csv"], "ai", true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.removed).toEqual([]);
    expect(r.touchingQuestions).toBeGreaterThan(0);
    expect(r.touchingDecisions.ai_relayed_human).toBeGreaterThan(0);
    expect(ws.fileNames).toEqual(FILES);
  });

  test("デモで入れた印と出どころは、消した資料の分だけ外れる", async () => {
    const ws = await workspace();
    ws.markDemoFiles(FILES);
    expect(ws.userFileNames).toEqual([]);
    await ws.removeFiles(["plan-hoshitori.xlsx"], "human");
    expect(ws.userFileNames).toEqual([]);
    expect(ws.fileNames).toEqual(["equipment-ledger.xlsx", "daily-report.csv"]);
  });
});

describe("AI の道具：intake_remove_files", () => {
  test("apply なしは消さずに数だけ、apply: true で消す。消したことは作業の欄に出る", async () => {
    const ws = await workspace();
    settleAll(ws);
    await composed(ws);
    const p = await tool(ws, { files: ["daily-report.csv"] });
    expect(p).toMatchObject({ applied: false, removed: [], files: ["daily-report.csv"], unknown: [], dropped: null, filesLeft: 3, plan: "kept", refused: null, note: INTAKE_REMOVE_NOTES.preview });
    expect(p.touching.questions).toBeGreaterThan(0);
    expect(ws.fileCount).toBe(3);

    const a = await tool(ws, { files: ["daily-report.csv"], apply: true });
    expect(a).toMatchObject({ applied: true, removed: ["daily-report.csv"], filesLeft: 2, plan: "recomposing", refused: null, note: INTAKE_REMOVE_NOTES.recomposing });
    expect(a.dropped.questions).toBeGreaterThan(0);
    expect(ws.notices.some((n) => n.kind === "ai" && /1/.test(n.text))).toBe(true);
    await recomposed(ws);
  });

  test("知らない名前は断る（どれも消さない）", async () => {
    const ws = await workspace();
    const r = await tool(ws, { files: ["daily-report.csv", "secret.xlsx"], apply: true });
    expect(r).toMatchObject({ applied: false, removed: [], unknown: ["secret.xlsx"], refused: "unknown", note: INTAKE_REMOVE_NOTES.unknown });
    expect(ws.fileCount).toBe(3);
  });

  test("人が画面で答えた問いにかかる資料は、AI からは消さない（人が画面で消す）", async () => {
    const ws = await workspace(["daily-report.csv"]);
    settleAll(ws, "human");
    expect(ws.decisions().some((d) => d.author === "human")).toBe(true);
    const r = await tool(ws, { files: ["daily-report.csv"], apply: true });
    expect(r).toMatchObject({ applied: false, removed: [], refused: "human_decided", note: INTAKE_REMOVE_NOTES.human_decided });
    expect(r.touching.decisions.human).toBeGreaterThan(0);
    expect(ws.fileCount).toBe(1);
    // 人の「消す」は消せる
    const h = await ws.removeFiles(["daily-report.csv"], "human");
    expect(h.ok).toBe(true);
    expect(ws.fileCount).toBe(0);
  });

  test("読込の途中は消さない（busy）", async () => {
    const ws = await workspace(["equipment-ledger.xlsx"]);
    const b = new Uint8Array(readFileSync(DIR + "daily-report.csv"));
    const reading = ws.addFiles([{ name: "daily-report.csv", size: b.length, bytes: async () => b }]);
    const r = await tool(ws, { files: ["equipment-ledger.xlsx"], apply: true });
    expect(r).toMatchObject({ applied: false, refused: "busy" });
    await reading;
    expect(ws.fileCount).toBe(2);
  });
});
