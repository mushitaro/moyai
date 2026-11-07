// AI の share_preview（仕事 share-preview-v1）：SHARE の画面が共有ファイルに書く中身の、形と数だけを返す。
// - 形：ツールの型・受け手（作業画面 → 橋渡し）・instructions の「今動くのは」（4,096 字の内）
// - 数：SHARE の画面と同じ関数（人だけの経路 checkpoint_preview）と同じ数。写る機器・作業・作業の年度の値は、写し取りの数え方どおり
// - 行の値（機器・作業の名前、年度、階級、分類のコード、費用、見え方のコード）と共有ファイルのバイト列を返さない
// - 確定した版が無ければ needs（「確定した版がありません。HOSHITORI の確定のシートで確定してから」）
// 計画はすべて架空。ファイルを書く試験は一時のフォルダで行う。
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HumanService } from "../../src/bridge/human";
import { BRIDGE_TOOL_RECEIVERS, ToolRelay } from "../../src/bridge/tools";
import type { TabHub } from "../../src/bridge/tab";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabTool, type TabToolResult } from "../../src/app/intake/tab-tools";
import { clearWorkingPlan, setWorkingPlan } from "../../src/app/state/plan-store";
import { getShareChoice, setShareChoice } from "../../src/app/state/share";
import { GO_HASH, resetScreenForTest } from "../../src/app/state/screen";
import { aiDecisions } from "../../src/plan/diff";
import { readHistory } from "../../src/plan/store";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { SHARE_NEEDS_TEXT, TOOLS, sharePreviewFromTabSchema, sharePreviewOutputSchema, type SharePreviewOut } from "../../src/shared/tools";
import type { Plan } from "../../src/shared/plan";
import { candidateClasses, copyOut } from "../../src/share/copyout";
import { chooseProfile } from "../../src/share/k";
import { defaultRingId, defaultShareFacility } from "../../src/share/share-preview";
import { truthToPlan } from "../fixtures/chart/truth-to-plan.mjs";
import { FACILITY_COMMON, SPEC, asset, detail, plan as planOf, table, vocab, work } from "./share/fixtures";

const NOW = Date.parse("2026-11-07T03:00:00.000Z");
const ANSWERS = { facility: { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

/** 一時のフォルダに状態フォルダと保存先を作り、人だけの経路の処理（HumanService）を直に呼ぶ */
function service() {
  // 共有フォルダの道も固有名詞の照らす相手なので、乱数の文字（計画の語と偶然重なる）を入れない名前にする
  dir = join(tmpdir(), `moyai-sp-${process.pid}-${Date.now()}`);
  const stateDir = join(dir, "state");
  mkdirSync(stateDir, { recursive: true });
  const human = new HumanService({ stateDir, packsDir: resolve("packs"), now: () => NOW, platform: "linux", env: {} });
  const call = async (action: string, payload: unknown): Promise<any> => human.handle({ action: action as never, payload: JSON.stringify(payload), session: "s1" });
  return { human, call, root: join(dir, "MOYAI"), ringRoot: join(dir, "共有フォルダ") };
}

const req = (planId: string, o: Partial<{ dest: "ring" | "ledger"; ringId: string | null; answers: typeof ANSWERS | null; national: boolean | null; screen: boolean }> = {}) =>
  sharePreviewFromTabSchema.parse({ mode: "share", planId, dest: "ring", ringId: null, answers: null, national: null, screen: true, ...o });

/** 計画を人が確定し（AI の決定を理由つきで受ける）、共有フォルダを作る */
async function confirmed(s: ReturnType<typeof service>) {
  expect(await s.call("settings_save", { root: s.root, name: "【架空】試験の人" })).toMatchObject({ ok: true });
  expect(await s.call("person_key_create", {})).toMatchObject({ ok: true });
  // 試しの計画には費用が無いので、実績の作業の年度の値 30 個に架空の費用を置く（共有ファイルにも答えにも出ないことを確かめる）
  const base = truthToPlan("fictional-1");
  let n = 0;
  const plan: Plan = { ...base, details: base.details.map((d) => (d.planOrActual === "actual" && n < 30 ? { ...d, cost: 1_234_000 + 1_000 * n++ } : d)) };
  const acceptances = aiDecisions(plan).map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
  expect(await s.call("plan_commit", { plan, reason: "試験の確定", acceptances, basedOn: null })).toMatchObject({ ok: true, version: 1 });
  const ring = await s.call("ring_create", { root: s.ringRoot, packId: "waste-incineration" });
  expect(ring).toMatchObject({ ok: true });
  const h = await readHistory(s.root, plan.planId);
  return { planId: plan.planId, ringId: ring.ringId as string, confirmedPlan: h.latest!.plan, contentHash: h.versions[0]!.contentHash };
}

describe("形：ツールの型と受け手と instructions", () => {
  it("読むツールで、作業画面が計画と SHARE の選びを渡し、橋渡しが数える。instructions の「今動くのは」に入り、4,096 字の内", () => {
    expect(TOOLS.share_preview.kind).toBe("read");
    expect(TOOLS.share_preview.waitsFor).toBeNull();
    expect(BRIDGE_TOOL_RECEIVERS.share_preview).toBe("tab_then_bridge");
    const now = MCP_INSTRUCTIONS.split("\n").find((l) => l.startsWith("今動くのは"))!;
    expect(now).toContain("・share_preview");
    expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
    // 引数は無い（共有先と見え方は人が SHARE で選ぶ）。送る・署名する欄は無い
    expect(TOOLS.share_preview.input.safeParse({}).success).toBe(true);
    expect(Object.keys(TOOLS.share_preview.input.shape)).toEqual([]);
    expect(TOOLS.share_preview.description).toContain("このツールは読むだけで、送らない");
    expect(TOOLS.share_preview.description).toContain("「社内で共有して」");
  });

  it("確定した版が無ければ needs だけを返し、ほかの欄は空", async () => {
    const s = service();
    expect(await s.call("settings_save", { root: s.root, name: "【架空】試験の人" })).toMatchObject({ ok: true });
    const out = await s.human.sharePreview(req("fixture-fictional-1"));
    expect(sharePreviewOutputSchema.parse(out)).toEqual(out);
    expect(out.needs).toEqual({ reason: "not_confirmed", text: "確定した版がありません。HOSHITORI の確定のシートで確定してから" });
    expect(SHARE_NEEDS_TEXT.not_confirmed).toBe("確定した版がありません。HOSHITORI の確定のシートで確定してから");
    expect(out).toMatchObject({ destination: null, version: null, counts: null, copy: null, hidden: [], you: null, file: null, checks: null, blocked: [] });
    // 計画の ID の形でないものは数えない（保存先の外を読まない）
    expect((await s.human.sharePreview(req("../外"))).needs?.reason).toBe("other");
  });
});

describe("数：SHARE の画面と同じ関数で、同じ数", () => {
  it("確定した版で、共有先・版・写る数・伏せる欄・相手から見たあなた・共有ファイルの数が、checkpoint_preview と同じ", async () => {
    const s = service();
    const c = await confirmed(s);
    const pv = await s.call("checkpoint_preview", { planId: c.planId, ringId: c.ringId, answers: ANSWERS });
    expect(pv.view.blockers).toEqual([]);
    const out: SharePreviewOut = await s.human.sharePreview(req(c.planId, { ringId: c.ringId, answers: ANSWERS }));
    expect(sharePreviewOutputSchema.parse(out)).toEqual(out);
    expect(out.needs).toBeNull();
    expect(out.screen).toBe(true);
    expect(out.destination).toEqual({ kind: "ring", name: "共有フォルダ" });
    // 版：番号・署名した日の年度（2026-11-07 は年度の始まり 4 月で 2026 年度）・呼び名・中身のハッシュの頭
    expect(out.version).toEqual({ number: 1, fiscalYear: 2026, name: "令和 8 年度版（第 1 版）", hashHead: c.contentHash.slice(0, 16) });
    // 写した行・行の総数・写さなかった理由（画面の言葉。0 は出さない）
    expect(out.copy!.copied).toBe(pv.view.copy.copied);
    expect(out.copy!.rows).toBe(pv.view.copy.rows);
    const skipped = Object.values(pv.view.copy.skipped as Record<string, number>).filter((n) => n > 0);
    expect(Object.values(out.copy!.skippedByReason).sort()).toEqual(skipped.sort());
    expect(out.copy!.copied + Object.values(out.copy!.skippedByReason).reduce((a, b) => a + b, 0)).toBe(out.copy!.rows);
    // 共有ファイル：塊の数・ハッシュの頭・大きさ・連番
    const body = JSON.parse(pv.view.bodyText) as { chunks: Record<string, unknown>[] };
    expect(out.file).toMatchObject({ chunks: body.chunks.length, hashHead: pv.view.bodyHash.slice(0, 16), bytes: pv.view.bytes, seq: pv.view.seq });
    expect(out.file!.columns.find((x) => x.name === "周期の階級")!.chunks).toBe(body.chunks.filter((x) => x.interval !== undefined).length);
    expect(out.file!.columns.find((x) => x.name === "共通の設備項目")!.chunks).toBe(body.chunks.length);
    // 相手から見たあなた：k・下限・全国 → 見え方 → この行・k の段
    expect(out.you).toMatchObject({ k: pv.view.k, minK: pv.view.minK, steps: pv.view.steps, kLevel: pv.view.profile.stage, group: "全国の表に載る施設" });
    expect(out.you!.label.startsWith("施設 ― ")).toBe(true);
    expect(out.checks).toEqual({ shape: 0, properNoun: 0, money: 0, freeText: 0, exactDate: 0 });
    expect(out.blocked).toEqual([]);
    expect(out.missingAxes).toEqual([]);
    // 伏せる欄：欄ごと写さない 8 つと、確定した版の中の値の数（画面の「欄ごと写さなかったもの」と同じ）
    expect(out.hidden.map((x) => x.field)).toEqual(["費用", "実施者", "日付", "外注先", "系統", "備考", "名前", "設置の年"]);
    expect(out.hidden.find((x) => x.field === "費用")!.values).toBe(pv.view.copy.withheld.cost);
    expect(out.hidden.find((x) => x.field === "費用")!.values).toBe(30);
    // 確定した版の中の数と、塊に写る数。費用の行はいつも 0
    const p = c.confirmedPlan;
    expect(out.counts!.equipment.inPlan).toBe(p.assets.length);
    expect(out.counts!.works.inPlan).toBe(p.works.length);
    expect(out.counts!.yearValues.inPlan).toBe(p.details.length);
    expect(out.counts!.costRows).toEqual({ inPlan: p.details.filter((d) => d.cost !== null).length, shared: 0 });
    expect(out.counts!.costRows.inPlan).toBe(30);
    for (const k of ["equipment", "works", "yearValues"] as const) {
      expect(out.counts![k].shared).toBeGreaterThan(0);
      expect(out.counts![k].shared!).toBeLessThanOrEqual(out.counts![k].inPlan);
    }
    // 作業の年度の値は、実績の値だけが写る
    expect(out.counts!.yearValues.shared!).toBeLessThanOrEqual(p.details.filter((d) => d.planOrActual === "actual").length);
  });

  it("SHARE の選びが無ければ、画面を開いたときの既定の選び（規模から読んだ値＋施設の答え・最初の共有フォルダ）で数える", async () => {
    const s = service();
    const c = await confirmed(s);
    const pv0 = await s.call("checkpoint_preview", { planId: c.planId, ringId: null, answers: { facility: {}, inNationalTable: null } });
    expect(pv0.reason).toBe("noRingChosen");
    const answers = { facility: defaultShareFacility(pv0.questions, pv0.plan.profile), inNationalTable: pv0.plan.inNationalTable };
    const ringId = defaultRingId(pv0.rings, pv0.plan.packId);
    expect(ringId).toBe(c.ringId);
    const pv = await s.call("checkpoint_preview", { planId: c.planId, ringId, answers });
    const out = await s.human.sharePreview(req(c.planId));
    expect(out.needs).toBeNull();
    expect(out.missingAxes.length).toBe(pv.view.missing.length);
    expect(out.blocked.length).toBe(pv.view.blockers.length);
    expect(out.copy?.copied ?? null).toBe(pv.view.copy?.copied ?? null);
    // 試しの計画は、全国の表に載るかを答えていない：見え方が決まるまで、写る数は数えない（null）。費用は 0
    expect(out.blocked).toContain("全国の表に載る施設かが未確定");
    expect(out.counts!.equipment.shared).toBeNull();
    expect(out.counts!.costRows.shared).toBe(0);
    // 全国の表に載るかは、作業中の計画の答えを先に使う（画面と同じ）
    const withNational = await s.human.sharePreview(req(c.planId, { national: true }));
    const pvN = await s.call("checkpoint_preview", { planId: c.planId, ringId, answers: { ...answers, inNationalTable: true } });
    expect(withNational.blocked.length).toBe(pvN.view.blockers.length);
    expect(withNational.missingAxes.length).toBe(pvN.view.missing.length);
    // 共有先が公開台帳で、台帳の clone を選んでいなければ、数えずに needs（次の手つき）
    const ledger = await s.human.sharePreview(req(c.planId, { dest: "ledger", answers: ANSWERS }));
    expect(ledger.needs?.reason).toBe("no_ledger");
    expect(ledger.destination).toBeNull();
  });

  it("写る機器・作業・作業の年度の値は、写し取りが塊に写した行のもと（重ねない）", () => {
    // 架空の計画：a4 は紐付けを人が受けていない、a5 は項目が無い、w5 は作業分類が無い、d9 は計画、d10 は写真から読んだまま
    const p = planOf({
      assets: [asset("a1", "T.FEED.LIFT"), asset("a2", "T.FEED.LIFT"), asset("a3", "T.POWER.GEN"), asset("a4", "T.FEED.LIFT", { commonItemAccepted: false, commonItemAuthor: "ai" }), asset("a5", null)],
      works: [
        work("w1", "OVERHAUL", ["a1"]),
        work("w2", "OVERHAUL", ["a2"]),
        work("w3", "OVERHAUL", ["a1", "a2"]),
        work("w4", "INSPECT", ["a3"]),
        work("w5", null, ["a3"]),
        work("w6", "OVERHAUL", ["a4"]),
        work("w7", "OVERHAUL", ["a5"]),
      ],
      details: [
        detail("d1", "w1", 2016, { cost: 1_000_000 }),
        detail("d2", "w1", 2019),
        detail("d3", "w2", 2017),
        detail("d4", "w3", 2020),
        detail("d5", "w4", 2018),
        detail("d6", "w5", 2018),
        detail("d7", "w6", 2018),
        detail("d8", "w7", 2018),
        detail("d9", "w4", 2021, { planOrActual: "plan" }),
        detail("d10", "w4", 2019, { needsReview: true }),
      ],
    });
    const ch = chooseProfile({ table, vocab, spec: SPEC, facility: FACILITY_COMMON, group: "NATIONAL", classes: candidateClasses(p) });
    if (!ch.ok) throw new Error("見え方が決まらない");
    const r = copyOut({ plan: p, lift: ch.lift, to: { kind: "ring", id: "0123456789abcdef" } });
    // 機器 a1・a2・a3、作業 w1・w2・w3・w4、作業の年度の値 d1〜d5（d4 は 2 つの機器で 2 行に数えるが、値は 1 つ）
    expect(r.fromPlan).toEqual({ assets: 3, works: 4, details: 5 });
    expect(r.copied).toBe(6);
  });
});

describe("行の値を返さない（安全の決まり 3）", () => {
  it("機器・作業・施設の名前、年度、階級、分類のコード、費用、見え方のコード、共有ファイルの中身が、答えのどこにも無い", async () => {
    const s = service();
    const c = await confirmed(s);
    const pv = await s.call("checkpoint_preview", { planId: c.planId, ringId: c.ringId, answers: ANSWERS });
    const out = await s.human.sharePreview(req(c.planId, { ringId: c.ringId, answers: ANSWERS }));
    expect(out.file).not.toBeNull();
    const text = JSON.stringify(out);
    const p: Plan = c.confirmedPlan;
    const words = new Set<string>();
    for (const a of p.assets) for (const w of [a.name, a.tag ?? "", a.series ?? "", a.installedOn ?? ""]) if (w.length >= 3) words.add(w);
    for (const w of p.works) for (const x of [w.kind, w.contractor ?? ""]) if (x.length >= 3) words.add(x);
    for (const d of p.details) {
      if (d.cost !== null) words.add(String(d.cost));
      for (const x of [d.startDate, d.endDate, d.performer]) if (x && x.length >= 3) words.add(x);
    }
    if (p.facility.name.length >= 2) words.add(p.facility.name);
    expect(words.size).toBeGreaterThan(50);
    const hits = [...words].filter((w) => text.includes(w));
    expect(hits).toEqual([]);
    // 年度（FY の形）・回数と周期・工数・日数の階級・分類のコード・見え方のコードは返さない
    const body = JSON.parse(pv.view.bodyText) as { chunks: { class: string; years: string[]; observed: string; interval?: string; manDays?: string; days?: string }[] };
    expect(text).not.toMatch(/FY\d{4}/);
    for (const ch of body.chunks) {
      expect(text).not.toContain(`"${ch.class}"`);
      expect(text).not.toContain(ch.class);
      for (const b of [ch.observed, ch.interval, ch.manDays, ch.days]) if (b) expect(text).not.toContain(`"${b}"`);
    }
    for (const code of Object.values(ANSWERS.facility)) expect(text).not.toContain(code);
    // 共有ファイルのバイト列もハッシュの全体も返さない（頭 16 字だけ）
    expect(text).not.toContain(pv.view.bodyHash);
    expect(text).not.toContain('"chunks":[');
  });
});

describe("作業画面の側", () => {
  const fakeLocation = { hash: "#/" };
  const CTX = { conversation: "c-share", rowsRemaining: 2000 };
  const ws = () => new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】共有の試験", fiscalYearStartMonth: 4, fictional: true });
  const data = (r: TabToolResult): any => {
    if (!r.ok) throw new Error(`誤り：${r.code}`);
    return r.data;
  };
  beforeEach(() => {
    resetScreenForTest();
    fakeLocation.hash = "#/";
    (globalThis as { location?: unknown }).location = fakeLocation;
  });
  afterEach(() => {
    clearWorkingPlan();
    setShareChoice(null);
    delete (globalThis as { location?: unknown }).location;
  });

  it("計画が無ければ画面を動かさず needs（型どおりの答え）", () => {
    const d = data(runTabTool(ws(), "share_preview", {}, CTX));
    expect(sharePreviewOutputSchema.parse(d)).toEqual(d);
    expect(d.needs.reason).toBe("no_plan");
    expect(d.screen).toBe(false);
    expect(fakeLocation.hash).toBe("#/");
  });

  it("計画があれば SHARE を開き、計画の ID と SHARE の選び（無ければ null）を橋渡しに渡す。ほかの計画の選びは渡さない", () => {
    const p = truthToPlan("fictional-1");
    setWorkingPlan(p, "intake");
    const d0 = data(runTabTool(ws(), "share_preview", {}, CTX));
    expect(sharePreviewFromTabSchema.parse(d0)).toEqual({ mode: "share", planId: p.planId, dest: "ring", ringId: null, answers: null, national: p.facility.inNationalTable, screen: true });
    expect(fakeLocation.hash).toBe(GO_HASH.share);
    setShareChoice({ planId: p.planId, dest: "ledger", ringId: null, answers: ANSWERS });
    const d1 = data(runTabTool(ws(), "share_preview", {}, CTX));
    expect(d1).toMatchObject({ dest: "ledger", answers: ANSWERS });
    setShareChoice({ planId: "plan-other", dest: "ledger", ringId: null, answers: ANSWERS });
    expect(data(runTabTool(ws(), "share_preview", {}, CTX))).toMatchObject({ dest: "ring", answers: null });
    expect(getShareChoice()?.planId).toBe("plan-other");
  });

  it("橋渡しは作業画面の途中の中身を確かめ、形の外れは渡さない。数えた答えは出力の型で確かめる", async () => {
    let fromTab: Record<string, unknown> = {};
    const tab = { callTool: async () => ({ kind: "ok", data: fromTab }) } as unknown as TabHub;
    let got: unknown = null;
    const relay = new ToolRelay(tab, {}, {
      share_preview: async (d) => {
        got = d;
        if (d.mode !== "share") return d;
        const p = sharePreviewFromTabSchema.safeParse(d);
        return p.success ? { ...(await import("../../src/share/share-preview")).sharePreviewNeeds("not_confirmed", true) } : "tab_bad_result";
      },
    });
    fromTab = { mode: "share", planId: "fixture-fictional-1", dest: "ring", ringId: null, answers: null, national: null, screen: true };
    const ok = await relay.run("share_preview", {}, "c1");
    expect("ok" in ok && ok.ok && (ok.data as SharePreviewOut).needs?.reason).toBe("not_confirmed");
    expect(got).toEqual(fromTab);
    fromTab = { mode: "share", planId: "fixture-fictional-1", dest: "send", ringId: null, answers: null, national: null, screen: true };
    const bad = await relay.run("share_preview", {}, "c1");
    expect("error" in bad && bad.error.code).toBe("tab_bad_result");
    // 型に無い欄（行の値）を足した答えは、出力の型で落とさず、渡す欄だけにする
    fromTab = { ...(await import("../../src/share/share-preview")).sharePreviewNeeds("no_plan", false), rows: [{ name: "架空の機器" }] };
    const extra = await relay.run("share_preview", {}, "c1");
    expect("ok" in extra && extra.ok && JSON.stringify(extra.data)).not.toContain("架空の機器");
  });
});
