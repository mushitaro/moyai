// 施設ごとの作業中（mushitaro/moyai#82）：保管先の plans/<計画ID>/work/ に、作業画面だけの道（タブの秘密）で書く・読む。
// - 資料の写しがそろっていなければ書かない。形が違えば書かない。資料はその作業中が持つものだけを返す。
// - AI のツールと中継には、作業中を読む・書く・消す道が無い。消すのは人だけの経路（work_discard）。
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeSettings } from "../../src/bridge/places";
import { BRIDGE_TOOL_RECEIVERS } from "../../src/bridge/tools";
import { WORK_SCHEMA, listWork, readWork, writeWork } from "../../src/bridge/work";
import { HEADER_TAB_SECRET, ROUTES } from "../../src/shared/routes";
import { TOOL_NAMES } from "../../src/shared/tools";
import { FakeTab, SECRET_A, http, startTestBridge, type TestBridge } from "../helpers/bridge";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const PLAN = "intake-waste-test";
const state = (over: Record<string, unknown> = {}) => ({
  schema: WORK_SCHEMA,
  savedAt: "2026-11-12T00:00:00.000Z",
  build: "t",
  planId: PLAN,
  displayName: "【架空】試験の工場",
  fictional: true,
  open: 3,
  changed: true,
  base: null,
  settings: { packId: "waste-incineration", facilityName: "【架空】試験の工場", fiscalYearStartMonth: 4, fictional: true },
  files: [] as { name: string; sha256: string; size: number }[],
  skipped: 0,
  decisions: [],
  plan: { planId: PLAN },
  proposals: [],
  accepted: [],
  ...over,
});

async function bridgeWithTab(): Promise<{ t: TestBridge; root: string }> {
  const root = mkdtempSync(join(tmpdir(), "moyai-work-root-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const t = await startTestBridge();
  cleanups.push(() => t.close());
  writeSettings(t.stateDir, { v: 1, root, ledger: null, name: null });
  const tab = new FakeTab(`ws://${t.host}/ws`, t.origin);
  await tab.opened;
  cleanups.push(() => tab.ws.close());
  tab.send("tab.hello", { secret: SECRET_A, build: "test" });
  await tab.next("bridge.welcome");
  return { t, root };
}
const good = (t: TestBridge) => ({ origin: t.origin, "sec-fetch-site": "same-origin", "content-type": "application/json", [HEADER_TAB_SECRET]: SECRET_A });
const post = (t: TestBridge, path: string, body: unknown, headers = good(t)) => http(t.bridge.port, "POST", path, headers, body === undefined ? undefined : JSON.stringify(body));

describe("作業中の道（作業画面だけ。タブの秘密）", () => {
  it("資料を置き、作業中を書き、一覧と読み出しと資料のバイト列が戻る", async () => {
    const { t, root } = await bridgeWithTab();
    const bytes = Buffer.from("資料の中身\n");
    const put = await post(t, ROUTES.tabWorkSource.path, { planId: PLAN, base64: bytes.toString("base64") });
    expect(put.body).toMatchObject({ ok: true, size: bytes.length });
    const sha = (put.body as { sha256: string }).sha256;
    const s = state({ files: [{ name: "日報.xlsx", sha256: sha, size: bytes.length }] });
    expect((await post(t, ROUTES.tabWorkSave.path, { state: s })).body).toEqual({ ok: true });
    expect(existsSync(join(root, "plans", PLAN, "work", "state.json"))).toBe(true);
    const list = await post(t, ROUTES.tabWorkList.path, undefined, { ...good(t), "content-type": "" });
    expect((list.body as { works: unknown[] }).works).toEqual([
      { planId: PLAN, displayName: "【架空】試験の工場", fictional: true, open: 3, changed: true, base: null, savedAt: s.savedAt },
    ]);
    expect((await post(t, ROUTES.tabWorkRead.path, { planId: PLAN })).body).toMatchObject({ ok: true, state: { planId: PLAN, files: s.files } });
    const src = await post(t, ROUTES.tabWorkRead.path, { planId: PLAN, sha256: sha });
    expect(src.headers["content-type"]).toBe("application/octet-stream");
    expect(src.body).toBe("資料の中身\n");
  });

  it("資料の写しがそろっていない・形が違う・計画 ID が合わないなら書かない。その作業中が持たない資料は返さない", async () => {
    const { t, root } = await bridgeWithTab();
    expect((await post(t, ROUTES.tabWorkSave.path, { state: state({ files: [{ name: "x", sha256: "a".repeat(64), size: 1 }] }) })).body).toEqual({ ok: false, reason: "workSourceMissing" });
    expect((await post(t, ROUTES.tabWorkSave.path, { state: { ...state(), schema: "moyai.work/0" } })).body).toEqual({ ok: false, reason: "workInvalid" });
    expect((await post(t, ROUTES.tabWorkSave.path, { state: state({ plan: { planId: "other" } }) })).body).toEqual({ ok: false, reason: "workInvalid" });
    expect((await post(t, ROUTES.tabWorkSave.path, { state: state({ planId: "../x" }) })).body).toEqual({ ok: false, reason: "workInvalid" });
    expect(existsSync(join(root, "plans", PLAN, "work"))).toBe(false);
    // 版の資料として置いたものでも、作業中が持たなければ作業中の道からは返さない
    const put = await post(t, ROUTES.tabWorkSource.path, { planId: PLAN, base64: Buffer.from("x").toString("base64") });
    const sha = (put.body as { sha256: string }).sha256;
    await post(t, ROUTES.tabWorkSave.path, { state: state() });
    expect((await post(t, ROUTES.tabWorkRead.path, { planId: PLAN, sha256: sha })).body).toEqual({ ok: false, reason: "workSourceMissing" });
  });

  it("タブの秘密が無い・違う・Origin が無いなら断り、何も書かない", async () => {
    const { t, root } = await bridgeWithTab();
    for (const h of [
      { origin: t.origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
      { ...good(t), [HEADER_TAB_SECRET]: "x".repeat(43) },
      { "sec-fetch-site": "same-origin", "content-type": "application/json", [HEADER_TAB_SECRET]: SECRET_A },
    ]) {
      const r = await post(t, ROUTES.tabWorkSave.path, { state: state() }, h as ReturnType<typeof good>);
      expect(r.status).toBeGreaterThanOrEqual(400);
      const l = await post(t, ROUTES.tabWorkList.path, undefined, { ...(h as ReturnType<typeof good>), "content-type": "" });
      expect(l.status).toBeGreaterThanOrEqual(400);
    }
    expect(existsSync(join(root, "plans"))).toBe(false);
  });

  it("中継の鍵では通らない（AI の道からは書けない）", async () => {
    const { t, root } = await bridgeWithTab();
    const relay = { origin: t.origin, "content-type": "application/json", authorization: `Bearer ${t.bridge.relayKey}` };
    const r = await post(t, ROUTES.tabWorkSave.path, { state: state() }, relay as unknown as ReturnType<typeof good>);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(existsSync(join(root, "plans"))).toBe(false);
  });
});

describe("AI のツールからは、作業中を消せない・書き換えられない", () => {
  it("作業中の道は作業画面だけの経路と人だけの経路にあり、ツールの名前・受け手・中継には無い", () => {
    for (const id of ["tabWorkSource", "tabWorkSave", "tabWorkList", "tabWorkRead"] as const) expect(ROUTES[id]).toMatchObject({ kind: "tab", requires: { tabSecret: true } });
    expect(ROUTES.workDiscard).toMatchObject({ kind: "human", requires: { tabSecret: true, oneTimeToken: true }, action: "work_discard" });
    expect(TOOL_NAMES.filter((n) => /work/.test(n))).toEqual([]);
    const relay = readFileSync("src/cli/relay.ts", "utf8");
    const tools = readFileSync("src/bridge/tools.ts", "utf8");
    for (const p of ["/tab/work", "work-save", "work-source", "work-discard", "./work"]) {
      expect(relay).not.toContain(p);
      expect(tools).not.toContain(p);
    }
    expect(Object.keys(BRIDGE_TOOL_RECEIVERS).filter((n) => /work/.test(n))).toEqual([]);
    // 作業画面の AI のツールの受け手も、作業中の道を呼ばない（ツールで作業画面が変わった結果が、作業中の写しから書かれるだけ）
    for (const f of ["src/app/intake/tab-tools.ts", "src/app/intake/screen-set.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/tabWork|workCall|work_discard|state\/work/);
    }
  });
});

describe("保管先のファイル", () => {
  it("書いたものだけを一覧に出し、壊れたものは出さない", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyai-work-fs-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    expect(await listWork(root)).toEqual([]);
    expect(await writeWork(root, state())).toEqual({ ok: true });
    expect((await readWork(root, PLAN))?.open).toBe(3);
    expect(await readWork(root, "../etc")).toBeNull();
    expect((await listWork(root)).map((w) => w.planId)).toEqual([PLAN]);
  });
});
