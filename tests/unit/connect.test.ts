// 業務システムとの連携（運営者の判断 2026-11-16）の単体の試験：約束の型（突合と書き込みの案）・資料にする CSV・
// 設定のオンとオフ・本番の書き込みの鍵の確かめ（送る直前に橋渡しの側で必ず通す）・人が見た差分との照らし・カナリア・キーが出ないこと。
// 偽の連携（src/bridge/connect/fake.ts）だけを使い、どこにも通信しない。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectService, type LatestSigned } from "../../src/bridge/connect";
import { createFakeConnect, FAKE_TARGETS, fakeSeed } from "../../src/bridge/connect/fake";
import type { ConnectBackend, EamConnector } from "../../src/bridge/connect/types";
import { HumanService } from "../../src/bridge/human";
import { readSettings, writeSettings } from "../../src/bridge/places";
import { connectTargetSchema, planLinesOfPlan, planLinesOfRecords, planWrite, resultsCsv } from "../../src/shared/connect";
import { commitPlan } from "../../src/plan/store";
import { SIGNER } from "../helpers/signer";
import { FakeTab, SECRET_A, http, startTestBridge } from "../helpers/bridge";
import { HEADER_RELAY_KEY, HEADER_TAB_SECRET, ROUTES } from "../../src/shared/routes";
import { asset, detail, plan, work } from "./share/fixtures";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "moyai-connect-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

/** 偽の連携の資産の木に合わせた【架空】の計画：1 つ食い違い・1 つ一致・1 つ足す（つなぎ先だけの計画が 1 つ残る） */
function signedPlan() {
  const root = asset("n0", null, { name: "【架空】みなと台清掃工場", level: 1, parentKey: null });
  const boiler = asset("n1", null, { name: "ボイラ設備", level: 2, parentKey: "n0" });
  const pumpA = asset("n11", null, { name: "ボイラ給水ポンプ A", level: 3, parentKey: "n1" });
  const blower = asset("n13", null, { name: "スートブロワ A", level: 3, parentKey: "n1" });
  const draft = asset("n2", null, { name: "通風設備", level: 2, parentKey: "n0" });
  const fan = asset("n21", null, { name: "二次押込送風機", level: 3, parentKey: "n2" });
  const p = plan({
    assets: [root, boiler, pumpA, blower, draft, fan],
    works: [
      work("w1", "OVERHAUL", ["n11"], { kind: "ボイラ給水ポンプの分解整備" }),
      work("w2", "OVERHAUL", ["n13"], { kind: "スートブロワの分解整備" }),
      work("w3", "INSPECT", ["n21"], { kind: "通風補機の点検" }),
      // 計画の年度の無い作業は書かない
      work("w4", "INSPECT", ["n21"], { kind: "実績だけの作業" }),
    ],
    details: [
      detail("d1", "w1", 2027, { planOrActual: "plan" }),
      detail("d2", "w1", 2031, { planOrActual: "plan" }),
      detail("d3", "w2", 2027, { planOrActual: "plan" }),
      detail("d4", "w3", 2026, { planOrActual: "plan" }),
      detail("d5", "w3", 2027, { planOrActual: "plan" }),
      detail("d6", "w4", 2024),
    ],
  });
  return { ...p, planId: "plan-connect" };
}
const latestOf = (): LatestSigned => ({ version: 1, plan: signedPlan() });

function service(o: { on?: boolean; backend?: ConnectBackend | null } = {}) {
  const sd = temp();
  writeSettings(sd, { v: 1, root: null, ledger: null, name: null, ...(o.on === false ? {} : { connect: true as const }) });
  return { sd, svc: new ConnectService({ stateDir: sd, now: () => Date.parse("2026-11-16T03:00:00Z"), backend: o.backend === undefined ? createFakeConnect().backend : o.backend }) };
}

describe("約束の型：突合と書き込みの案", () => {
  it("版の保全計画とつなぎ先を突き合わせ、足す・変えるだけを案にする（消さない）", () => {
    const w = planWrite(planLinesOfPlan(signedPlan()), planLinesOfRecords(fakeSeed()));
    const by = (work: string) => w.rows.find((r) => r.work === work && r.assetPath.endsWith("A"))!;
    expect(by("ボイラ給水ポンプの分解整備")).toMatchObject({ result: "diff", moyai: [2027, 2031], target: [2028] });
    expect(by("スートブロワの分解整備")).toMatchObject({ result: "one", onlyIn: "moyai", target: null });
    expect(w.rows.find((r) => r.work === "通風補機の点検")).toMatchObject({ result: "ok" });
    // つなぎ先だけの計画（ボイラ給水ポンプ B）は片方だけとして見せ、案には入れない
    expect(w.rows.filter((r) => r.onlyIn === "target")).toHaveLength(1);
    expect(w.counts).toEqual({ ok: 1, one: 2, diff: 1, add: 1, change: 1 });
    expect(w.changes.map((c) => c.op).sort()).toEqual(["add", "change"]);
    expect(w.rows.some((r) => r.work === "実績だけの作業")).toBe(false);
  });

  it("つなぎ先の型にキーの欄は無い（形に無い欄は断る）", () => {
    for (const t of FAKE_TARGETS) expect(connectTargetSchema.safeParse(t).success).toBe(true);
    expect(connectTargetSchema.safeParse({ ...FAKE_TARGETS[0], apiKey: "x" }).success).toBe(false);
  });

  it("作業の実績を、日報と同じ並びの CSV にする。式に見えるセルは字にする", () => {
    const r = fakeSeed();
    r.results.push({ ref: "Rx", assetRef: "A11", work: "=HYPERLINK(1)", date: null, manDays: null });
    const csv = resultsCsv(r, "【架空】表題");
    expect(csv.startsWith("﻿【架空】表題")).toBe(true);
    expect(csv).toContain("日付,工事名,機器,号炉,作業内容,工数,備考");
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv.split("\r\n").filter((l) => /^\d{4}\//.test(l))).toHaveLength(5);
  });
});

describe("設定の連携がオフなら、何もしない", () => {
  it("読む・書き込みの案・送るを断り、状態はオフを返す（つなぎ先は出る）", async () => {
    const { svc } = service({ on: false });
    expect((await svc.state()).enabled).toBe(false);
    expect(await svc.read("fake-test")).toEqual({ ok: false, reason: "connectOff" });
    expect(await svc.plan("fake-test", latestOf())).toEqual({ ok: false, reason: "connectOff" });
    expect(await svc.send("fake-test", latestOf(), "0".repeat(64))).toEqual({ ok: false, reason: "connectOff" });
  });

  it("連携の裏（部品か偽の連携）が無ければ、つなぎ先を出さない", async () => {
    const { svc } = service({ backend: null });
    expect(await svc.state()).toEqual({ ok: true, enabled: true, available: false, fake: false, targets: [] });
    expect(await svc.read("fake-test")).toEqual({ ok: false, reason: "connectUnavailable" });
  });

  it("部品が無く、偽の連携の環境変数も無ければ、裏は無い（部品へのつなぎは未実装）", async () => {
    const sd = temp();
    writeSettings(sd, { v: 1, root: null, ledger: null, name: null, connect: true });
    const svc = new ConnectService({ stateDir: sd, now: Date.now, env: {} });
    expect((await svc.state()).available).toBe(false);
    const fake = new ConnectService({ stateDir: sd, now: Date.now, env: { MOYAI_CONNECT_FAKE: "1", MOYAI_CONNECT_FAKE_LICENSE: "maximo.fake.invalid" } });
    const s = await fake.state();
    expect(s.fake).toBe(true);
    expect(s.targets.find((t) => t.env === "production")?.write).toEqual({ needed: true, ok: true });
  });
});

describe("読む", () => {
  it("作業の実績を【架空】の資料（CSV）にし、数だけを添える", async () => {
    const { svc } = service();
    const r = await svc.read("fake-test");
    if (!r.ok) throw new Error(r.reason);
    expect(r.counts).toEqual({ assets: 7, plans: 3, results: 5 });
    expect(r.name).toMatch(/^連携_.+_作業の実績_2026-11-16\.csv$/);
    expect(Buffer.from(r.base64, "base64").toString("utf8")).toContain("【架空】");
    expect(await svc.read("無い")).toEqual({ ok: false, reason: "connectTargetUnknown" });
  });
});

describe("送る：鍵の確かめ・人が見た差分との照らし・カナリア（橋渡しの側）", () => {
  it("テスト環境は鍵なしで送れる。送ったあとは差分が 0 になる", async () => {
    const fake = createFakeConnect();
    const { svc } = service({ backend: fake.backend });
    const p = await svc.plan("fake-test", latestOf());
    if (!p.ok) throw new Error(p.reason);
    expect(p.write).toEqual({ needed: false });
    expect(await svc.send("fake-test", latestOf(), p.hash)).toMatchObject({ ok: true, applied: 2 });
    expect(fake.writes("fake-test")).toBe(2);
    const again = await svc.plan("fake-test", latestOf());
    if (!again.ok) throw new Error(again.reason);
    expect(again.counts.add + again.counts.change).toBe(0);
    expect(await svc.send("fake-test", latestOf(), again.hash)).toEqual({ ok: false, reason: "connectNothing" });
    // 本番には何も書いていない
    expect(fake.writes("fake-production")).toBe(0);
  });

  it("本番は、その host の有効な鍵が無ければ送らない（画面を飛ばして正しいハッシュで呼んでも）", async () => {
    const fake = createFakeConnect();
    const { svc } = service({ backend: fake.backend });
    const p = await svc.plan("fake-production", latestOf());
    if (!p.ok) throw new Error(p.reason);
    expect(p.write).toEqual({ needed: true, ok: false, reason: "noKey" });
    expect(await svc.send("fake-production", latestOf(), p.hash)).toEqual({ ok: false, reason: "connectLicense.noKey" });
    expect(fake.writes("fake-production")).toBe(0);
  });

  it("本番は、試験用の鍵の確かめに差し替えると送れる（ほかの host の鍵では送れない）", async () => {
    const other = createFakeConnect({ licensedHosts: ["other.example"] });
    const o = service({ backend: other.backend });
    const po = await o.svc.plan("fake-production", latestOf());
    if (!po.ok) throw new Error(po.reason);
    expect((await o.svc.send("fake-production", latestOf(), po.hash)).ok).toBe(false);
    const fake = createFakeConnect({ licensedHosts: ["maximo.fake.invalid"] });
    const { svc } = service({ backend: fake.backend });
    const p = await svc.plan("fake-production", latestOf());
    if (!p.ok) throw new Error(p.reason);
    expect(p.write).toEqual({ needed: true, ok: true });
    expect(await svc.send("fake-production", latestOf(), p.hash)).toMatchObject({ ok: true, applied: 2 });
  });

  it("人が見たあとに、つなぎ先か版が変わっていれば送らない", async () => {
    const fake = createFakeConnect();
    const { svc } = service({ backend: fake.backend });
    const p = await svc.plan("fake-test", latestOf());
    if (!p.ok) throw new Error(p.reason);
    expect(await svc.send("fake-test", latestOf(), "f".repeat(64))).toEqual({ ok: false, reason: "connectStale" });
    const changed = { ...latestOf(), version: 2 };
    expect(await svc.send("fake-test", changed, p.hash)).toEqual({ ok: false, reason: "connectStale" });
    expect(fake.writes("fake-test")).toBe(0);
  });

  it("カナリア：1 件目を送って読み直し、届いていなければ残りを送らない", async () => {
    const fake = createFakeConnect();
    const base = fake.backend.connectors.fake!;
    let batches = 0;
    // 書いたと言うが、何も書かない業務システム
    const liar: EamConnector = { ...base, executeCommit: async (_t, _s, changes) => ((batches += 1), { applied: changes.length }) };
    const { svc } = service({ backend: { ...fake.backend, connectors: { fake: liar } } });
    const p = await svc.plan("fake-test", latestOf());
    if (!p.ok) throw new Error(p.reason);
    expect(await svc.send("fake-test", latestOf(), p.hash)).toEqual({ ok: false, reason: "connectCanaryFailed", applied: 1 });
    expect(batches).toBe(1);
  });

  it("2 件目から書けなければ、書けた数を添えて断る", async () => {
    const fake = createFakeConnect({ failAfter: 1 });
    const { svc } = service({ backend: fake.backend });
    const p = await svc.plan("fake-test", latestOf());
    if (!p.ok) throw new Error(p.reason);
    expect(await svc.send("fake-test", latestOf(), p.hash)).toEqual({ ok: false, reason: "connectWriteFailed", applied: 1 });
  });
});

describe("API キーは、どの答えにも出ない", () => {
  it("つなぎ先の秘密は、状態・読む・案・送るの答えに出ない", async () => {
    const KEY = "MAXIMO-APIKEY-0123456789abcdef";
    const fake = createFakeConnect({ licensedHosts: ["maximo.fake.invalid"] });
    const store = { list: () => fake.backend.store.list(), open: (id: string) => { const o = fake.backend.store.open(id); return o ? { ...o, secret: { opaque: { apikey: KEY } } } : null; } };
    const { svc } = service({ backend: { ...fake.backend, store } });
    const outs: unknown[] = [await svc.state(), await svc.read("fake-test")];
    const p = await svc.plan("fake-production", latestOf());
    outs.push(p);
    if (p.ok) outs.push(await svc.send("fake-production", latestOf(), p.hash));
    for (const o of outs) expect(JSON.stringify(o)).not.toContain(KEY);
  });
});

describe("人だけの経路 connect_send と設定（橋渡しの HumanService）", () => {
  async function human(o: { licensed?: string[] } = {}) {
    const dir = temp();
    const root = join(dir, "保管先");
    const sd = join(dir, "状態");
    writeSettings(sd, { v: 1, root, ledger: null, name: null });
    const fake = createFakeConnect({ licensedHosts: o.licensed ?? [] });
    const h = new HumanService({ stateDir: sd, packsDir: "packs", now: () => Date.parse("2026-11-16T03:00:00Z"), connect: fake.backend });
    return { h, root, sd, fake };
  }
  const call = (h: HumanService, action: "settings_read" | "settings_save" | "connect_send", payload: unknown) => h.handle({ action, payload: JSON.stringify(payload), session: "s" });

  it("設定の連携は、人が保存したときだけ変わり、ほかの保存では消えない。読むときはつなぎ先（キーなし）を返す", async () => {
    const { h, sd, root } = await human();
    const r0 = (await call(h, "settings_read", {})) as any;
    expect(r0.connect).toMatchObject({ available: true, enabled: false, fake: true });
    expect(r0.connect.targets.map((t: any) => t.id)).toEqual(["fake-test", "fake-production"]);
    expect((await call(h, "settings_save", { root, connect: true })).ok).toBe(true);
    expect(readSettings(sd).connect).toBe(true);
    // 保存先だけの保存では、連携は変わらない
    expect((await call(h, "settings_save", { root })).ok).toBe(true);
    expect(readSettings(sd).connect).toBe(true);
    expect((await call(h, "settings_save", { root, connect: false })).ok).toBe(true);
    expect(readSettings(sd).connect).toBeUndefined();
  });

  it("確定・署名した版が無ければ送らない。版があれば、その版から作り直して送る（本番は鍵が要る）", async () => {
    const { h, root, sd, fake } = await human();
    writeSettings(sd, { ...readSettings(sd), connect: true });
    const none = await call(h, "connect_send", { targetId: "fake-test", planId: "plan-connect", version: 1, hash: "0".repeat(64) });
    expect(none).toEqual({ ok: false, reason: "connectNoSigned" });
    const v1 = await commitPlan({ root, plan: signedPlan(), reason: "第 1 版", acceptances: [], basedOn: null, signer: SIGNER, role: "edit", client: "t" });
    if (!v1.ok) throw new Error(v1.reason);
    const latest = await h.latestSigned("plan-connect");
    if ("reason" in latest) throw new Error(latest.reason);
    const svc = h.connect()!;
    const prod = await svc.plan("fake-production", latest);
    if (!prod.ok) throw new Error(prod.reason);
    expect(await call(h, "connect_send", { targetId: "fake-production", planId: "plan-connect", version: latest.version, hash: prod.hash })).toEqual({ ok: false, reason: "connectLicense.noKey" });
    expect(fake.writes("fake-production")).toBe(0);
    // 違う版を名乗っても送らない
    const test = await svc.plan("fake-test", latest);
    if (!test.ok) throw new Error(test.reason);
    expect(await call(h, "connect_send", { targetId: "fake-test", planId: "plan-connect", version: latest.version + 1, hash: test.hash })).toEqual({ ok: false, reason: "connectStale" });
    expect(await call(h, "connect_send", { targetId: "fake-test", planId: "plan-connect", version: latest.version, hash: test.hash })).toMatchObject({ ok: true, applied: 2 });
    expect(fake.writes("fake-test")).toBe(2);
  });
});

describe("橋渡しの道：オフなら、作業画面の道も AI の道具も断る", () => {
  it("作業画面の道（状態・読む・案）と、中継の経路の連携の道具", async () => {
    const fake = createFakeConnect();
    const tb = await startTestBridge({ human: { connect: fake.backend } });
    cleanups.push(() => void tb.close());
    const ws = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
    await ws.opened;
    ws.send("tab.hello", { secret: SECRET_A, build: "test" });
    await ws.next("bridge.welcome");
    cleanups.push(() => ws.ws.close());
    const good = { "content-type": "application/json", origin: tb.origin, "sec-fetch-site": "same-origin", [HEADER_TAB_SECRET]: SECRET_A };
    const post = (path: string, body: unknown, headers: Record<string, string> = good) => http(tb.bridge.port, "POST", path, headers, JSON.stringify(body));
    const relay = (name: string) => http(tb.bridge.port, "POST", ROUTES.relayTool.path, { "content-type": "application/json", [HEADER_RELAY_KEY]: tb.bridge.relayKey }, JSON.stringify({ name, args: {} }));
    // タブの秘密が無ければ、どの道も断る
    expect((await post(ROUTES.tabConnectRead.path, { targetId: "fake-test" }, { "content-type": "application/json", origin: tb.origin })).body.error.code).toBe("secret_missing");
    // オフ（既定）
    expect((await post(ROUTES.tabConnectState.path, {})).body).toMatchObject({ ok: true, enabled: false, available: true });
    expect((await post(ROUTES.tabConnectRead.path, { targetId: "fake-test" })).body).toEqual({ ok: false, reason: "connectOff" });
    expect((await post(ROUTES.tabConnectPlan.path, { targetId: "fake-test", planId: "plan-connect" })).body).toEqual({ ok: false, reason: "connectOff" });
    for (const n of ["connect_read", "connect_plan"]) expect((await relay(n)).body.error.code, n).toBe("connect_off");
    // オン
    writeSettings(tb.stateDir, { v: 1, root: null, ledger: null, name: null, connect: true });
    const st = (await post(ROUTES.tabConnectState.path, {})).body;
    expect(st.enabled).toBe(true);
    const read = (await post(ROUTES.tabConnectRead.path, { targetId: "fake-test" })).body;
    expect(read).toMatchObject({ ok: true, counts: { assets: 7, plans: 3, results: 5 } });
    // AI の道具は作業画面を通る（作業画面がつながっていなければ、そう返す）
    ws.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect((await relay("connect_read")).body.error.code).toBe("work_screen_not_open");
  });
});
