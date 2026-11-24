// デモの架空の Maximo（運営者の困りごと 2026-11-24「Maximo との連携のデモができない」）の単体の試験。
// - AI の道具 connect_demo が、テスト環境のつなぎ先を 1 つ足す（架空・通信なし・鍵なし）。連携がオフなら足さず、人にオンを頼む文を返す。
// - 中身は Skillパックの demo/maximo.json（【架空】さくら坂焼却場に合う資産・PM・作業の実績）。
// - 読む → 突合と差分 → 人の送り（テスト環境は鍵なし）→ 架空の Maximo に書かれ、差分が 0 になる。
// - 本物の Maximo には一切つながない：橋渡しの網（globalThis.fetch）を呼ばず、部品の道では、要求は予約のオリジンにしか行かない。
// 芯のメモリの架空の Maximo（部品が無いとき）はいつも、部品の偽の Maximo の道は部品の中身があるとき（CI）に走る。
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectService, type LatestSigned } from "../../src/bridge/connect";
import { createDemoMaximo, DEMO_HOST, DEMO_ORIGIN, DEMO_TARGET_ID, demoSeedPacks, isDemoOrigin, readDemoSeed } from "../../src/bridge/connect/demo";
import { importEamPackage } from "../../src/bridge/connect/package";
import { collectIntake } from "../../src/bridge/intake-files";
import { writeSettings } from "../../src/bridge/places";
import { CONNECT_PATH_SEP } from "../../src/shared/connect";
import { TOOLS } from "../../src/shared/tools";
import { FakeTab, SECRET_A, http, startTestBridge } from "../helpers/bridge";
import { HEADER_RELAY_KEY, HEADER_TAB_SECRET, ROUTES } from "../../src/shared/routes";
import { asset, detail, plan, work } from "./share/fixtures";

const PACKS = join(process.cwd(), "packs");
const PACK = "waste-incineration";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  vi.restoreAllMocks();
});
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "moyai-connect-demo-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}
const NOW = Date.parse("2026-11-24T03:00:00Z");

/** 架空の Maximo の中身の道に合う【架空】の確定した版：一致 1・食い違い 1（年度）・足す 1（架空の Maximo に無い資産。資産の木に足してから書く） */
function signedPlan() {
  const f = asset("f1", null, { name: "焼却炉本体", level: 1, parentKey: null });
  const f2 = asset("f2", null, { name: "毎年点検", level: 2, parentKey: "f1" });
  const f3 = asset("f3", null, { name: "R1 定修", level: 3, parentKey: "f2" });
  const b = asset("b1", null, { name: "ボイラー性能検査（2号）", level: 1, parentKey: null });
  const b2 = asset("b2", null, { name: "1年", level: 2, parentKey: "b1" });
  const n = asset("n1", null, { name: "【架空】デモの新しい機器", level: 1, parentKey: null });
  const p = plan({
    assets: [f, f2, f3, b, b2, n],
    works: [work("w1", "INSPECT", ["f3"], { kind: "点検" }), work("w2", "INSPECT", ["b2"], { kind: "法定検査" }), work("w3", "INSPECT", ["n1"], { kind: "点検" })],
    details: [detail("d1", "w1", 2027, { planOrActual: "plan" }), detail("d2", "w2", 2026, { planOrActual: "plan" }), detail("d3", "w3", 2028, { planOrActual: "plan" })],
  });
  return { ...p, planId: "plan-connect-demo" };
}
const latest = (): LatestSigned => ({ version: 1, plan: signedPlan() });

function service(o: { on?: boolean; demoPackage?: ConstructorParameters<typeof ConnectService>[0]["demoPackage"] } = {}) {
  const sd = temp();
  writeSettings(sd, { v: 1, root: null, ledger: null, name: null, ...(o.on === false ? {} : { connect: true as const }) });
  // 本物のつなぎ先の裏は無し（部品の接続の保存 ~/.config/mxstage を読まない）。デモは中身を Skillパックから読む
  return new ConnectService({ stateDir: sd, now: () => NOW, backend: null, packsDir: PACKS, demoPackage: o.demoPackage === undefined ? null : o.demoPackage });
}

describe("中身（Skillパックの demo/maximo.json）", () => {
  it("ごみ焼却のデモにある。【架空】の印があり、形どおり。施設はデモの施設（demo.json）と同じ", () => {
    expect(demoSeedPacks(PACKS)).toEqual([PACK]);
    const seed = readDemoSeed(PACKS, PACK);
    expect(seed).not.toBeNull();
    expect(seed!.label).toContain("【架空】");
    const facility = JSON.parse(readFileSync(join(PACKS, PACK, "demo", "demo.json"), "utf8")).facilityName as string;
    expect(seed!.label).toContain(facility.replace("【架空】", ""));
    // PM と作業の実績の資産は、どれも資産の道（か、その上の節）
    const nodes = new Set(seed!.assets.flatMap((p) => p.split(CONNECT_PATH_SEP).map((_, i, a) => a.slice(0, i + 1).join(CONNECT_PATH_SEP))));
    for (const x of [...seed!.plans, ...seed!.results]) expect(nodes.has(x.asset), x.asset).toBe(true);
    expect(readDemoSeed(PACKS, "night-soil")).toBeNull();
    expect(readDemoSeed(PACKS, "../waste-incineration")).toBeNull();
  });

  it("中身のファイルは、デモの資料（intake_add_files の source: demo）に入らない", () => {
    const r = collectIntake({ source: "demo", pack: PACK }, { packsDir: PACKS, stateDir: null, repoRoot: process.cwd() }) as { files: { name: string }[] };
    expect(r.files.map((f) => f.name)).not.toContain("maximo.json");
    expect(r.files).toHaveLength(3);
  });

  it("予約のオリジンは .invalid（DNS に出ない）。ほかの host・利用者名つきは予約のオリジンではない", () => {
    expect(DEMO_HOST.endsWith(".invalid")).toBe(true);
    expect(isDemoOrigin(`${DEMO_ORIGIN}/maximo/oslc/os/mxapiasset?lean=1`)).toBe(true);
    for (const u of ["https://maximo.example/maximo", "http://demo-maximo.moyai.invalid/", "https://demo-maximo.moyai.invalid.example/", "https://u:p@demo-maximo.moyai.invalid/", "https://127.0.0.1:43110/", "nonsense"]) expect(isDemoOrigin(u), u).toBe(false);
  });
});

describe("connect_demo の道（ConnectService.addDemo）", () => {
  it("連携がオフなら足さない（オンにするのは人だけ）", async () => {
    const svc = service({ on: false });
    expect(await svc.addDemo()).toEqual({ ok: false, reason: "connectOff" });
    // 部品が無くても、デモを足せるので連携の欄は出る（人がオンにできる）。つなぎ先はまだ無い
    expect(await svc.state()).toEqual({ ok: true, enabled: false, available: true, fake: false, targets: [] });
  });

  it("オンなら、テスト環境のつなぎ先を 1 つ足す（鍵なし・予約の host）。2 回目は同じものを返す。状態フォルダにも部品の保存にも書かない", async () => {
    const svc = service();
    const a = await svc.addDemo();
    if (!a.ok) throw new Error(a.reason);
    expect(a.added).toBe(true);
    expect(a.target).toEqual({ id: DEMO_TARGET_ID, label: readDemoSeed(PACKS, PACK)!.label, kind: "maximo", host: DEMO_HOST, env: "test" });
    const st = await svc.state();
    expect(st).toMatchObject({ enabled: true, available: true });
    expect(st.targets).toEqual([{ ...a.target, write: { needed: false } }]);
    const b = await svc.addDemo();
    expect(b).toMatchObject({ ok: true, added: false, target: a.target });
    expect(await svc.addDemo({ pack: "night-soil" })).toMatchObject({ ok: true, added: false });
    expect(await svc.addDemo({ pack: "night-soil", reset: true })).toEqual({ ok: false, reason: "connectDemoMissing" });
  });

  it("引数の型：pack と reset だけ（つなぎ先の URL・鍵・本番を渡す欄は無い）", () => {
    const input = TOOLS.connect_demo.input;
    expect(Object.keys(input.shape).sort()).toEqual(["pack", "reset"]);
    expect(input.safeParse({}).success).toBe(true);
    for (const bad of [{ url: "https://maximo.example" }, { apiKey: "x" }, { env: "production" }, { pack: "../x" }]) expect(input.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(TOOLS.connect_demo.description).toContain("Reply to the user in the user's language");
  });
});

/** 読む → 突合と差分 → 人の送り → 差分 0 を、渡した部品（null なら芯のメモリ）で通す */
async function walk(demoPackage: Parameters<typeof service>[0] extends infer O ? (O extends { demoPackage?: infer P } ? P : never) : never) {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const svc = service({ demoPackage });
  const a = await svc.addDemo();
  if (!a.ok) throw new Error(a.reason);
  const seed = readDemoSeed(PACKS, PACK)!;
  expect(a.counts.plans).toBe(seed.plans.reduce((n, p) => n + p.fiscalYears.length, 0));
  expect(a.counts.results).toBe(seed.results.length);

  // 読む：作業の実績を【架空】の資料にする（デモの印つき）
  const r = await svc.read(DEMO_TARGET_ID);
  if (!r.ok) throw new Error(r.reason);
  expect(r).toMatchObject({ demo: true, fake: true });
  const csv = Buffer.from(r.base64, "base64").toString("utf8");
  expect(csv.split("\r\n")[0]).toContain("【架空】");
  expect(csv).toContain("2025/09/12");
  expect(r.name).toContain("【架空】");

  // 突合と差分：一致 1（焼却炉本体）・食い違い 1（2 号のボイラー性能検査 2027 → 2026）・足す 1（架空の Maximo に無い資産。資産の木に足してから書く）
  const p = await svc.plan(DEMO_TARGET_ID, latest());
  if (!p.ok) throw new Error(p.reason);
  expect(p.write).toEqual({ needed: false });
  expect(p.counts).toMatchObject({ ok: 1, diff: 1, add: 1, change: 1 });
  const before = svc.demoMaximo()!.writes();
  expect(before).toBe(0);

  // 人の送り（テスト環境は鍵なし）→ 架空の Maximo に書かれ、差分が 0 になる
  const sent = await svc.send(DEMO_TARGET_ID, latest(), p.hash);
  expect(sent).toMatchObject({ ok: true, applied: 2 });
  expect(svc.demoMaximo()!.writes()).toBeGreaterThan(0);
  const again = await svc.plan(DEMO_TARGET_ID, latest());
  if (!again.ok) throw new Error(again.reason);
  expect(again.counts).toMatchObject({ add: 0, change: 0, diff: 0 });

  // 人が見た差分と違えば送らない
  expect(await svc.send(DEMO_TARGET_ID, latest(), p.hash)).toEqual({ ok: false, reason: "connectStale" });
  // reset で中身を初めに戻す
  const z = await svc.addDemo({ reset: true });
  expect(z).toMatchObject({ ok: true, added: true });
  expect(svc.demoMaximo()!.writes()).toBe(0);

  // 本物の Maximo には一切つながない：橋渡しの網は呼ばない
  expect(fetchSpy).not.toHaveBeenCalled();
  return svc;
}

describe("芯のメモリの架空の Maximo（部品が無いとき）", () => {
  it("読む → 突合と差分 → 人の送り → 差分 0。通信しない", async () => {
    const svc = await walk(null);
    expect(svc.demoMaximo()!.viaPackage).toBe(false);
    expect(svc.demoMaximo()!.requests()).toEqual([]);
  });
});

// ─── 部品の偽の Maximo の道（部品の中身があるときだけ。CI は部品を入れるので走る）───
const pkg = await importEamPackage();
// 名前を変数に置いて読む（部品が無くても型の確かめが通るように）
const TESTING = "@mxstage/eam-connectors/testing";
const testing: unknown = pkg ? await import(/* @vite-ignore */ TESTING).catch(() => null) : null;
const ready = !!(pkg && testing);

describe.skipIf(!ready)("部品の偽の Maximo（部品の MaximoClient と読み書き）", () => {
  it("読む → 突合と差分 → 人の送り → 差分 0。要求は予約のオリジンにだけ行き、橋渡しの網は呼ばない", async () => {
    const svc = await walk({ pkg: pkg!, testing });
    const d = svc.demoMaximo()!;
    expect(d.viaPackage).toBe(true);
  });

  it("要求の URL はどれも予約のオリジン（本物の Maximo・ほかの host には行かない）", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const svc = service({ demoPackage: { pkg: pkg!, testing } });
    const a = await svc.addDemo();
    if (!a.ok) throw new Error(a.reason);
    await svc.read(DEMO_TARGET_ID);
    const p = await svc.plan(DEMO_TARGET_ID, latest());
    if (!p.ok) throw new Error(p.reason);
    await svc.send(DEMO_TARGET_ID, latest(), p.hash);
    const urls = svc.demoMaximo()!.requests();
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(isDemoOrigin(u), u).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("中身の数は、芯のメモリの架空の Maximo と同じ（同じ中身を、どちらの道でも同じに読む）", async () => {
    const seed = readDemoSeed(PACKS, PACK)!;
    const a = createDemoMaximo(seed, { pkg: pkg!, testing });
    const b = createDemoMaximo(seed, {});
    const ra = await a.connector.loadRecords(a.target, a.secret);
    const rb = await b.connector.loadRecords(b.target, b.secret);
    expect([ra.assets.length, ra.plans.length, ra.results.length]).toEqual([rb.assets.length, rb.plans.length, rb.results.length]);
  });
});

describe("橋渡しの道：AI の道具 connect_demo（中継の経路）", () => {
  it("連携がオフでも一覧に出て、オフなら connect_off とオンを人に頼む文を返す。オンなら足し、作業画面の状態に出る", async () => {
    const tb = await startTestBridge({ packsDir: PACKS, human: { connect: null } });
    cleanups.push(() => tb.close());
    const ws = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
    await ws.opened;
    ws.send("tab.hello", { secret: SECRET_A, build: "test" });
    await ws.next("bridge.welcome");
    cleanups.push(() => ws.ws.close());
    const relay = (args: Record<string, unknown> = {}) =>
      http(tb.bridge.port, "POST", ROUTES.relayTool.path, { "content-type": "application/json", [HEADER_RELAY_KEY]: tb.bridge.relayKey }, JSON.stringify({ name: "connect_demo", args }));
    const off = (await relay()).body;
    expect(off.ok).toBe(true);
    expect(off.data).toMatchObject({ target: null, added: false, refused: "connect_off" });
    expect(off.data.note).toMatch(/only the user turns it on/);
    expect(off.data.note).toContain("Reply to the user in the user's language");
    // 本物のつなぎ先の欄（URL・鍵）は型で断る
    expect((await relay({ url: "https://maximo.example" })).body.error.code).toBe("invalid_input");

    writeSettings(tb.stateDir, { v: 1, root: null, ledger: null, name: null, connect: true });
    const on = (await relay()).body;
    expect(on.data).toMatchObject({ target: { id: DEMO_TARGET_ID, env: "test" }, added: true, refused: null });
    expect(on.data.note).toContain(`connect_read (target: ${DEMO_TARGET_ID})`);
    const good = { "content-type": "application/json", origin: tb.origin, "sec-fetch-site": "same-origin", [HEADER_TAB_SECRET]: SECRET_A };
    const st = (await http(tb.bridge.port, "POST", ROUTES.tabConnectState.path, good, "{}")).body;
    expect(st).toMatchObject({ ok: true, enabled: true, available: true });
    expect(st.targets.map((t: { id: string; host: string }) => [t.id, t.host])).toEqual([[DEMO_TARGET_ID, DEMO_HOST]]);
    // 状態フォルダに、つなぎ先の保存を書かない（橋渡しのメモリだけ）
    expect(existsSync(join(tb.stateDir, "connections.json"))).toBe(false);
  });
});
