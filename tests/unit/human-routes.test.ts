// human-only（docs/plan.md §5.1）の続き：確定・版・設定・輪と鍵・検問所の人だけの経路。
// どの経路も、素の HTTP・タブの秘密の無い要求・Origin の無い要求・偽った Origin で秘密なし・使い終えた印・切れた印を拒む。拒む試験は消さない。
// あわせて、正しいタブから、Documents が日本語の OneDrive の下にある PC の形で、確定 → 輪を作る → 検問所 → 送る → 確かめるを通す。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aiDecisions } from "../../src/plan/diff";
import { HEADER_TAB_SECRET, ROUTES, ROUTE_IDS, type HumanAction, type RouteDef } from "../../src/shared/routes";
import { EXPOSED_TOOL_NAMES, TOOL_NAMES } from "../../src/shared/tools";
import { truthToPlan } from "../fixtures/chart/truth-to-plan.mjs";
import { FakeTab, SECRET_A, http, startTestBridge, type TestBridge } from "../helpers/bridge";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const NEW_ROUTES = ROUTE_IDS.filter((id) => ROUTES[id].kind === "human" && id !== "commitTrial");
/** 人だけの経路の道と操作の名前 */
const R = (id: (typeof NEW_ROUTES)[number]) => ROUTES[id] as RouteDef & { path: string; action: HumanAction };

let tb: TestBridge | null = null;
let extra = "";
afterEach(async () => {
  await tb?.close();
  tb = null;
  if (extra) rmSync(extra, { recursive: true, force: true });
  extra = "";
});

async function tab(t: TestBridge) {
  const tb = new FakeTab(`ws://${t.host}/ws`, t.origin);
  await tb.opened;
  tb.send("tab.hello", { secret: SECRET_A, build: "test" });
  await tb.next("bridge.welcome");
  let n = 0;
  return {
    tab: tb,
    async token(action: HumanAction, payload: string): Promise<string> {
      const requestId = `r${++n}`;
      tb.send("tab.token_request", { requestId, action, payloadHash: sha(payload) });
      const tok = await tb.next("bridge.token");
      return tok.token as string;
    },
  };
}

const good = (t: TestBridge) => ({ "content-type": "application/json", origin: t.origin, "sec-fetch-site": "same-origin", [HEADER_TAB_SECRET]: SECRET_A });
const post = (t: TestBridge, path: string, headers: Record<string, string>, body: unknown) => http(t.bridge.port, "POST", path, headers, JSON.stringify(body));

describe("新しい人だけの経路は、どれも守りを越えさせない", () => {
  it("人だけの経路が増えた（確定・版・設定・輪・検問所）。どれも MCP のツールに無い", () => {
    expect(NEW_ROUTES.sort()).toEqual(["planCommit", "planRevert", "planStatus", "ringCreate", "ringVerify", "settingsRead", "settingsSave", "checkpointOpenText", "checkpointPreview", "checkpointSend"].sort());
    for (const id of NEW_ROUTES) {
      const r: RouteDef = ROUTES[id];
      expect(r.requires).toEqual({ tabSecret: true, oneTimeToken: true });
      for (const n of [...TOOL_NAMES, ...EXPOSED_TOOL_NAMES]) expect(n).not.toBe(r.action);
    }
  });

  it.each(NEW_ROUTES)("%s：素の HTTP（Origin も秘密も無い）を拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const path = R(id).path;
    const t = await token(R(id).action, "{}");
    expect((await http(tb.bridge.port, "GET", path)).body.error.code).toBe("method_not_allowed");
    const r = await post(tb, path, { "content-type": "application/json" }, { token: t, payload: "{}" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("origin_missing");
  });

  it.each(NEW_ROUTES)("%s：タブの秘密が無ければ、正しい Origin と印でも拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    const r = await post(tb, R(id).path, { "content-type": "application/json", origin: tb.origin }, { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("secret_missing");
  });

  it.each(NEW_ROUTES)("%s：Origin の無い要求は、秘密と印がそろっていても拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    const r = await post(tb, R(id).path, { "content-type": "application/json", [HEADER_TAB_SECRET]: SECRET_A }, { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("origin_missing");
  });

  it.each(NEW_ROUTES)("%s：偽った Origin で秘密なしの要求を拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    const r = await post(tb, R(id).path, { "content-type": "application/json", origin: "http://evil.example" }, { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("origin_not_allowed");
  });

  it.each(NEW_ROUTES)("%s：使い終えた印を拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    const first = await post(tb, R(id).path, good(tb), { token: t, payload: "{}" });
    expect(first.status).toBe(200);
    const again = await post(tb, R(id).path, good(tb), { token: t, payload: "{}" });
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe("token_unknown");
  });

  it.each(NEW_ROUTES)("%s：切れた印（120 秒）を拒む", async (id) => {
    let now = 1_000_000;
    tb = await startTestBridge({ now: () => now });
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    now += 120_001;
    const r = await post(tb, R(id).path, good(tb), { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("token_expired");
  });

  it.each(NEW_ROUTES)("%s：ほかの操作に結んだ印では通らない", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const other: HumanAction = R(id).action === "plan_status" ? "settings_read" : "plan_status";
    const t = await token(other, "{}");
    const r = await post(tb, R(id).path, good(tb), { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("token_mismatch");
  });
});

describe("正しいタブから：確定 → 輪を作る → 検問所 → 送る → 確かめる（Documents が日本語の OneDrive の下）", () => {
  it("端まで通る。中身の形が違う・理由が空・合言葉が違うものは断る", async () => {
    // 輪のフォルダの道も固有名詞の照らす相手なので、乱数の英字（計画の語と偶然重なる）を入れない名前にする（数だけは照らさない）
    extra = join(tmpdir(), `moyai-human-${process.pid}-${Date.now()}`);
    mkdirSync(extra, { recursive: true });
    const docs = join(extra, "利用者", "OneDrive", "ドキュメント");
    const onedrive = join(extra, "利用者", "OneDrive");
    tb = await startTestBridge({ human: { platform: "win32", env: { OneDrive: onedrive }, shell: async () => ({ documents: docs, mounts: [] }), openText: () => {} } });
    const t = await tab(tb);
    const call = async (id: (typeof NEW_ROUTES)[number], payload: unknown) => {
      const text = JSON.stringify(payload);
      const tok = await t.token(R(id).action, text);
      const r = await post(tb!, R(id).path, good(tb!), { token: tok, payload: text });
      expect(r.status, id).toBe(200);
      return r.body;
    };

    // 設定：Documents は OneDrive の下、既定の置き場所はその下の MOYAI
    const s = await call("settingsRead", {});
    expect(s.documents).toBe(docs);
    expect(s.documentsSynced).toEqual({ kind: "onedrive", base: onedrive });
    expect(s.root).toBe(join(docs, "MOYAI"));
    expect(s.packs.find((p: { id: string }) => p.id === "waste-incineration")?.ready).toBe(true);
    expect((await call("settingsSave", { root: "相対の道" })).reason).toBe("rootInvalid");

    // 確定：人が受けていない決定（AI の当てはめ）を受け、理由つきで
    const plan = truthToPlan("fictional-1");
    const st = await call("planStatus", { planId: plan.planId });
    expect(st).toMatchObject({ ok: true, latest: null, synced: { kind: "onedrive" } });
    const ds = aiDecisions(plan);
    expect(ds.length).toBeGreaterThan(0);
    expect((await call("planCommit", { plan, reason: "", acceptances: [], basedOn: null })).reason).toBe("reasonEmpty");
    expect((await call("planCommit", { plan, reason: "試験の確定", acceptances: [], basedOn: null })).reason).toBe("pendingDecisions");
    const c = await call("planCommit", { plan, reason: "試験の確定", acceptances: ds.map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" })), basedOn: null });
    expect(c).toMatchObject({ ok: true, version: 1 });
    expect(existsSync(c.files.version)).toBe(true);
    expect(existsSync(c.files.report)).toBe(true);
    expect(c.files.version.startsWith(join(docs, "MOYAI", "plans"))).toBe(true);

    // 輪を作る（合言葉は 8 文字以上）
    const ringRoot = join(extra, "輪");
    expect((await call("ringCreate", { root: ringRoot, packId: "waste-incineration", passphrase: "短い" })).reason).toBe("passphraseShort");
    const rc = await call("ringCreate", { root: ringRoot, packId: "waste-incineration", passphrase: "架空の合言葉 試験です" });
    expect(rc).toMatchObject({ ok: true });
    expect(rc.fingerprint).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);

    // 検問所：見え方が決まるまでは送れない。決まれば数はすべて 0、k ≥ 5
    const pv0 = await call("checkpointPreview", { planId: plan.planId, ringId: rc.ringId, answers: { facility: {}, inNationalTable: true } });
    expect(pv0.view.blockers).toContain("profileIncomplete");
    expect(pv0.questions.map((q: { key: string }) => q.key)).toEqual(["furnace", "capacity_t_per_day", "turbine", "ash", "contract"]);
    const answers = { facility: { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };
    const pv = await call("checkpointPreview", { planId: plan.planId, ringId: rc.ringId, answers });
    expect(pv.view.blockers).toEqual([]);
    expect(pv.view.counts).toEqual({ shape: 0, properNoun: 0, money: 0, freeText: 0, exactDate: 0 });
    expect(pv.view.k).toBeGreaterThanOrEqual(5);
    expect(sha(pv.view.bodyText)).toBe(pv.view.bodyHash);

    // 送る：合言葉が違えば置かない。合えば置き、受け手と同じ関数で ✓
    const bad = await call("checkpointSend", { planId: plan.planId, version: 1, ringId: rc.ringId, answers, previewHash: pv.view.bodyHash, passphrase: "違う合言葉です" });
    expect(bad.reason).toBe("passphrase");
    const sent = await call("checkpointSend", { planId: plan.planId, version: 1, ringId: rc.ringId, answers, previewHash: pv.view.bodyHash, passphrase: "架空の合言葉 試験です" });
    expect(sent).toMatchObject({ ok: true, seq: 1 });
    expect(sent.report.ok).toBe(true);
    const v = await call("ringVerify", { ringId: rc.ringId });
    expect(v.report.lines.map((l: { kind: string; status: string }) => `${l.kind}:${l.status}`)).toEqual(["circle:ok", "member:ok", "bundle:ok"]);

    // 版の履歴と戻す
    const back = await call("planRevert", { planId: plan.planId, to: 1, reason: "試しに戻す", basedOn: 1 });
    expect(back).toMatchObject({ ok: true, version: 2 });
    // 版が変わったので、前の版で見た検問所からは送らない
    const stale = await call("checkpointSend", { planId: plan.planId, version: 1, ringId: rc.ringId, answers, previewHash: pv.view.bodyHash, passphrase: "架空の合言葉 試験です" });
    expect(stale.reason).toBe("versionChanged");
  });
});
