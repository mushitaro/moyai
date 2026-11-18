// AI が、保管先の確定・署名した最新の版を読むだけで読める（2026-11-18、運営者が Claude Desktop で「既にある計画の中身を確かめられない」と困った）。
// - 作業中の計画が無いとき、chart_rows は確定した最新の版の行を返す（source: confirmed と版の番号）。作業中の計画があるときは今のまま（source: working）
// - intake_survey の要約（part: all）に、保管先の確定した版の一覧の要約（施設の名前・年度・第 n 版・機器と作業の数）が載る
// - 署名か鎖が合わない版・この PC が前に見た版が消えた版は読まない（history_broken・history_vanished）
// - 確定版は読むだけ：次の版を開く・確定・署名の道具は無い。AI の文は「＋ 次の版」は人が押すと書く
// 計画はすべて架空。ファイルを書く試験は一時のフォルダで行う。
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HumanService } from "../../src/bridge/human";
import { ToolRelay } from "../../src/bridge/tools";
import type { TabHub } from "../../src/bridge/tab";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabTool } from "../../src/app/intake/tab-tools";
import { clearWorkingPlan, setWorkingPlan } from "../../src/app/state/plan-store";
import { aiDecisions } from "../../src/plan/diff";
import { readHistory } from "../../src/plan/store";
import { ERRORS } from "../../src/shared/errors";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { skillMoyaiMarkdown } from "../../src/shared/skill-moyai";
import { CHART_ROWS_CONFIRMED_NOTE, CONFIRMED_SURVEY_NOTE, EXPOSED_TOOL_NAMES, TOOLS } from "../../src/shared/tools";
import type { Plan } from "../../src/shared/plan";
import { truthToPlan } from "../fixtures/chart/truth-to-plan.mjs";

const NOW = Date.parse("2026-11-07T03:00:00.000Z");

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
  clearWorkingPlan();
});
beforeEach(() => clearWorkingPlan());

/** 一時のフォルダに状態フォルダと保管先を作り、人だけの経路の処理（HumanService）を直に呼ぶ */
function service() {
  dir = join(tmpdir(), `moyai-rc-${process.pid}-${Date.now()}`);
  const stateDir = join(dir, "state");
  mkdirSync(stateDir, { recursive: true });
  const human = new HumanService({ stateDir, packsDir: resolve("packs"), now: () => NOW, platform: "linux", env: {} });
  const call = async (action: string, payload: unknown): Promise<any> => human.handle({ action: action as never, payload: JSON.stringify(payload), session: "s1" });
  return { human, call, root: join(dir, "MOYAI") };
}

/** 人が確定し署名した版を 1 つ置く（AI の決定は理由つきで受ける） */
async function confirmed(s: ReturnType<typeof service>): Promise<Plan> {
  expect(await s.call("settings_save", { root: s.root, name: "【架空】試験の人" })).toMatchObject({ ok: true });
  expect(await s.call("person_key_create", {})).toMatchObject({ ok: true });
  const plan = truthToPlan("fictional-1") as Plan;
  const acceptances = aiDecisions(plan).map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
  expect(await s.call("plan_commit", { plan, reason: "試験の確定", acceptances, basedOn: null })).toMatchObject({ ok: true, version: 1 });
  return (await readHistory(s.root, plan.planId)).latest!.plan;
}

/** 本物の作業画面の受け手（tab-tools）を、ふりのタブの中で動かす */
function realTab(): { hub: TabHub; calls: string[] } {
  const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "", fiscalYearStartMonth: 4, fictional: true });
  const calls: string[] = [];
  const hub = {
    callTool: async (name: string, args: Record<string, unknown>, conversation: string, remaining: number) => {
      calls.push(name);
      const r = runTabTool(ws, name as never, args, { conversation, rowsRemaining: remaining });
      return r.ok ? { kind: "ok", data: r.data, session: "s1" } : { kind: "error", code: r.code };
    },
  } as unknown as TabHub;
  return { hub, calls };
}

function relayOf(s: ReturnType<typeof service>, hub: TabHub) {
  return new ToolRelay(hub, {}, { confirmed_latest: () => s.human.confirmedLatest() });
}

const okData = (a: Awaited<ReturnType<ToolRelay["run"]>>): any => {
  if (!("ok" in a && a.ok)) throw new Error(`誤り：${JSON.stringify(a)}`);
  return a.data;
};

describe("作業中の計画が無く、確定した版だけがある", () => {
  it("chart_rows は確定した最新の版の行を返す（source: confirmed・版の番号・施設の名前。数は会話の上限で数える）", async () => {
    const s = service();
    const plan = await confirmed(s);
    const { hub } = realTab();
    const relay = relayOf(s, hub);
    const d = okData(await relay.run("chart_rows", { offset: 0, limit: 50, view: "adjusted" }, "c1"));
    expect(TOOLS.chart_rows.output.parse(d)).toEqual(d);
    expect(d.source).toBe("confirmed");
    expect(d.version).toBe(1);
    expect(d.confirmed).toEqual({ planId: plan.planId, facilityName: plan.displayName, version: 1, versionName: "令和 8 年度版（第 1 版）" });
    expect(d.note).toBe(CHART_ROWS_CONFIRMED_NOTE);
    expect(d.total).toBeGreaterThan(0);
    expect(d.rows.length).toBe(Math.min(50, d.total));
    expect(d.rows[0].cells["階層"]).toBeTruthy();
    expect(d.remainingInConversation).toBe(2000 - d.rows.length);
    expect(relay.rowsReadIn("c1")).toBe(d.rows.length);
    // 機器の行の id を渡すと、その機器の作業の行（w:…）
    const node = plan.assets.find((a) => plan.works.some((w) => w.targets.includes(a.nodeKey)))!;
    const w = okData(await relay.run("chart_rows", { offset: 0, limit: 50, view: "adjusted", rowRef: `n:${node.nodeKey}` }, "c1"));
    expect(w.source).toBe("confirmed");
    expect(w.rows.length).toBeGreaterThan(0);
    expect(w.rows.every((r: { rowRef: string }) => r.rowRef.startsWith("w:"))).toBe(true);
  });

  it("planId で施設を選べる。知らない planId は「作業中の計画が無い」のまま", async () => {
    const s = service();
    const plan = await confirmed(s);
    const relay = relayOf(s, realTab().hub);
    expect(okData(await relay.run("chart_rows", { offset: 0, limit: 5, view: "adjusted", planId: plan.planId }, "c1")).confirmed.planId).toBe(plan.planId);
    const none = await relay.run("chart_rows", { offset: 0, limit: 5, view: "adjusted", planId: "plan-unknown" }, "c1");
    expect("error" in none && none.error.code).toBe("no_working_plan");
  });

  it("intake_survey の要約（part: all）に確定した版の一覧の要約が載る。ほかの part には載らない", async () => {
    const s = service();
    const plan = await confirmed(s);
    const relay = relayOf(s, realTab().hub);
    const d = okData(await relay.run("intake_survey", { part: "all" }, "c1"));
    expect(TOOLS.intake_survey.output.parse(d)).toEqual(d);
    expect(d.filesTotal).toBe(0);
    expect(d.confirmed).toEqual({
      plans: [{ planId: plan.planId, facilityName: plan.displayName, version: 1, fiscalYear: 2026, versionName: "令和 8 年度版（第 1 版）", equipment: plan.assets.length, works: plan.works.length }],
      total: 1,
      refused: [],
      note: CONFIRMED_SURVEY_NOTE,
    });
    // 行の値（機器・作業の名前）は載せない
    const json = JSON.stringify(d.confirmed);
    for (const a of plan.assets.slice(0, 20)) if (a.name !== plan.displayName) expect(json).not.toContain(`"${a.name}"`);
    for (const part of ["questions", "files", "compose", "crosswalk"]) expect(okData(await relay.run("intake_survey", { part }, "c1")).confirmed).toBeUndefined();
  });

  it("確定した版が無ければ、chart_rows は今のとおり no_working_plan、intake_survey の confirmed は空の一覧", async () => {
    const s = service();
    expect(await s.call("settings_save", { root: s.root, name: "【架空】試験の人" })).toMatchObject({ ok: true });
    const relay = relayOf(s, realTab().hub);
    const r = await relay.run("chart_rows", { offset: 0, limit: 5, view: "adjusted" }, "c1");
    expect("error" in r && r.error.code).toBe("no_working_plan");
    expect(okData(await relay.run("intake_survey", { part: "all" }, "c1")).confirmed).toMatchObject({ plans: [], total: 0, refused: [] });
  });
});

describe("署名と鎖が合わない版は読まない", () => {
  it("版の中身を書き換えると history_broken（行を返さない）。intake_survey は理由だけを載せる", async () => {
    const s = service();
    const plan = await confirmed(s);
    const vdir = join(s.root, "plans", plan.planId, "versions");
    const file = readdirSync(vdir).find((f) => /^\d{6}\.json$/.test(f))!;
    const rec = JSON.parse(readFileSync(join(vdir, file), "utf8"));
    rec.plan.displayName = "【架空】書き換えた名前";
    writeFileSync(join(vdir, file), JSON.stringify(rec));
    const relay = relayOf(s, realTab().hub);
    const r = await relay.run("chart_rows", { offset: 0, limit: 5, view: "adjusted" }, "c1");
    expect("error" in r && r.error.code).toBe("history_broken");
    expect(relay.rowsReadIn("c1")).toBe(0);
    const d = okData(await relay.run("intake_survey", { part: "all" }, "c1"));
    expect(d.confirmed.plans).toEqual([]);
    expect(d.confirmed.refused).toEqual([{ planId: plan.planId, reason: "history_broken", text: expect.any(String) }]);
    expect(JSON.stringify(d)).not.toContain("書き換えた名前");
  });

  it("この PC が前に見た署名が消えると history_vanished", async () => {
    const s = service();
    const plan = await confirmed(s);
    // 一度読む（この PC が見た版と署名を覚える）
    expect(await s.human.confirmedLatest()).toMatchObject({ ok: [{ planId: plan.planId }] });
    const vdir = join(s.root, "plans", plan.planId);
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const sig = walk(vdir).find((p) => /sig/i.test(p))!;
    expect(sig).toBeTruthy();
    rmSync(sig);
    const relay = relayOf(s, realTab().hub);
    const r = await relay.run("chart_rows", { offset: 0, limit: 5, view: "adjusted" }, "c1");
    expect("error" in r && r.error.code).toBe("history_vanished");
    expect(ERRORS.history_vanished.to).toBe("ai");
  });
});

describe("作業中の計画があるときは今のまま", () => {
  it("chart_rows は作業中の計画の行（source: working・作業中の版）。確定した版は読まない", async () => {
    const s = service();
    const plan = await confirmed(s);
    const working = { ...plan, planId: "plan-working-other", version: 0 };
    const w = setWorkingPlan(working, "intake");
    let asked = 0;
    const relay = new ToolRelay(realTab().hub, {}, {
      confirmed_latest: async () => {
        asked++;
        return s.human.confirmedLatest();
      },
    });
    const d = okData(await relay.run("chart_rows", { offset: 0, limit: 10, view: "adjusted" }, "c1"));
    expect(d.source).toBe("working");
    expect(d.version).toBe(w.revision);
    expect(d.confirmed).toBeUndefined();
    expect(asked).toBe(0);
  });
});

describe("確定版は読むだけ：AI の道具と文", () => {
  it("次の版を開く・確定・署名の道具は無い。AI の文は「＋ 次の版」を人が押すと英語で書き、利用者の言葉で返す", () => {
    for (const n of EXPOSED_TOOL_NAMES) expect(n).not.toMatch(/next_version|plan_open|plan_commit|confirm|sign/);
    for (const t of [TOOLS.chart_rows.description, TOOLS.intake_survey.description, MCP_INSTRUCTIONS, skillMoyaiMarkdown(), CHART_ROWS_CONFIRMED_NOTE, CONFIRMED_SURVEY_NOTE]) {
      expect(t).toContain('"+ Next version"');
      expect(t).toMatch(/AI cannot open/);
    }
    expect(TOOLS.chart_rows.description).toContain("Reply to the user in the user's language");
    expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
    expect(readFileSync("skills/moyai/SKILL.md", "utf8")).toContain('"+ Next version"');
  });
});
