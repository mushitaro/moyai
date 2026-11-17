// 業務システムとの連携の、本物の部品（@mxstage/eam-connectors）の道の単体の試験。
// - 部品が無いとき（optional が落ちた・中身の dist が無い）：つなぎ先を出さない。これはいつも走る。
// - 部品があるとき：部品の /testing の createFakeMaximo（メモリの中の偽の Maximo。どこにも通信しない）を、部品の MaximoClient の fetch に差し込み、
//   部品の ConnectionStore・LicenseStore（一時のフォルダ）で「読む → 突合 → 差分 → 人の送り（テスト環境は鍵なし・本番は鍵が要る）」を通す。
//   部品の中身が無い環境では、この組は飛ばす（MOYAI の芯は部品なしで動く約束）。
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectService, type LatestSigned } from "../../src/bridge/connect";
import { fiscalYearOf, fiscalYearStart, importEamPackage, loadPackageBackend } from "../../src/bridge/connect/package";
import { writeSettings } from "../../src/bridge/places";
import { asset, detail, plan, work } from "./share/fixtures";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "moyai-connect-pkg-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}
const NOW = Date.parse("2026-11-17T03:00:00Z");

describe("部品が無いとき", () => {
  it("部品を読み込めなければ null（つなぎ先を出さない）", async () => {
    expect(await importEamPackage("@moyai/no-such-package")).toBeNull();
    expect(await loadPackageBackend({ pkg: null })).toBeNull();
  });

  it("連携の裏が無ければ、オンでもつなぎ先は出ず、読む・送るは断る", async () => {
    const sd = temp();
    writeSettings(sd, { v: 1, root: null, ledger: null, name: null, connect: true });
    const svc = new ConnectService({ stateDir: sd, now: () => NOW, backend: await loadPackageBackend({ pkg: null }) });
    expect(await svc.state()).toEqual({ ok: true, enabled: true, available: false, fake: false, targets: [] });
    expect(await svc.read("c_0000000000000000")).toEqual({ ok: false, reason: "connectUnavailable" });
  });

  it("年度は 4 月始まり（PM の次の予定日から）", () => {
    expect(fiscalYearOf("2028-04-01T00:00:00+09:00")).toBe(2028);
    expect(fiscalYearOf("2028-03-31T00:00:00+09:00")).toBe(2027);
    expect(fiscalYearOf(null)).toBeNull();
    expect(fiscalYearOf("あいう")).toBeNull();
    expect(fiscalYearOf(fiscalYearStart(2031))).toBe(2031);
  });
});

// ─── 本物の部品の道（部品の中身があるときだけ）───────────────────

const pkg = await importEamPackage();
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
// 名前を変数に置いて読む（部品が無くても型の確かめが通るように）
const sub = (name: string): Promise<Any> => import(/* @vite-ignore */ `@mxstage/eam-connectors/${name}`).catch(() => null);
const testing: Any = pkg ? await sub("testing") : null;
const licenseMod: Any = pkg ? await sub("license") : null;
const nodeMod: Any = pkg ? await sub("node") : null;
const ready = !!(pkg && testing && licenseMod && nodeMod);

const TEST_BASE = "https://maximo-test.example";
const PROD_BASE = "https://maximo.example";
const API_KEY = "test-api-key-not-real-0123456789";

const s = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, t]) => [k, { type: t }]));
/** 【架空】の Maximo：場所 1・資産 6・PM 4・作業指示 2（どの値も架空） */
function seed(baseUrl: string) {
  return {
    baseUrl,
    apiKey: API_KEY,
    objectStructures: {
      MXAPIASSET: {
        keyAttrs: ["assetnum", "siteid"],
        attrs: s({ assetnum: "string", siteid: "string", description: "string", status: "string", parent: "string", location: "string", assettype: "string" }),
        records: [
          { attrs: { assetnum: "BOILER", siteid: "MINATO", description: "ボイラ設備", location: "PLANT" } },
          { attrs: { assetnum: "P11", siteid: "MINATO", description: "ボイラ給水ポンプ A", parent: "BOILER" } },
          { attrs: { assetnum: "P12", siteid: "MINATO", description: "ボイラ給水ポンプ B", parent: "BOILER" } },
          { attrs: { assetnum: "SB13", siteid: "MINATO", description: "スートブロワ A", parent: "BOILER" } },
          { attrs: { assetnum: "DRAFT", siteid: "MINATO", description: "通風設備", location: "PLANT" } },
          { attrs: { assetnum: "FAN21", siteid: "MINATO", description: "二次押込送風機", parent: "DRAFT" } },
        ],
      },
      MXAPIOPERLOC: {
        keyAttrs: ["location", "siteid"],
        attrs: s({ location: "string", siteid: "string", description: "string", status: "string", type: "string" }),
        children: { lochierarchy: { idAttr: "systemid", attrs: s({ parent: "string", systemid: "string" }) } },
        records: [{ attrs: { location: "PLANT", siteid: "MINATO", description: "【架空】みなと台清掃工場", type: "OPERATING" } }],
      },
      MXAPIPM: {
        keyAttrs: ["pmnum", "siteid"],
        attrs: { ...s({ pmnum: "string", siteid: "string", description: "string", status: "string", assetnum: "string", location: "string", jpnum: "string", frequnit: "string" }), frequency: { type: "integer" }, nextdate: { type: "datetime" } },
        records: [
          { attrs: { pmnum: "PM1", siteid: "MINATO", description: "ボイラ給水ポンプの分解整備", assetnum: "P11", nextdate: "2028-05-01T00:00:00+09:00" } },
          { attrs: { pmnum: "PM2", siteid: "MINATO", description: "ボイラ給水ポンプの分解整備", assetnum: "P12", nextdate: "2028-05-01T00:00:00+09:00" } },
          { attrs: { pmnum: "PM3", siteid: "MINATO", description: "通風補機の点検", assetnum: "FAN21", nextdate: "2026-06-01T00:00:00+09:00" } },
          { attrs: { pmnum: "PM4", siteid: "MINATO", description: "通風補機の点検", assetnum: "FAN21", nextdate: "2027-06-01T00:00:00+09:00" } },
        ],
      },
      MXAPIWODETAIL: {
        keyAttrs: ["wonum", "siteid"],
        attrs: {
          ...s({ wonum: "string", siteid: "string", description: "string", status: "string", worktype: "string", assetnum: "string", location: "string", pmnum: "string", jpnum: "string" }),
          schedstart: { type: "datetime" },
          actstart: { type: "datetime" },
          actfinish: { type: "datetime" },
          actlabhrs: { type: "number" },
        },
        records: [
          { attrs: { wonum: "W1", siteid: "MINATO", description: "ボイラ給水ポンプの分解整備", assetnum: "P11", actfinish: "2024-04-06T17:00:00+09:00", actlabhrs: 32 } },
          { attrs: { wonum: "W2", siteid: "MINATO", description: "通風補機の点検", assetnum: "FAN21", actfinish: "2025-05-12T17:00:00+09:00", actlabhrs: 16 } },
        ],
      },
    },
  };
}

/** 偽の Maximo の資産の木に合わせた【架空】の計画：1 つ食い違い（年度を 1 つ減らして 2 つ足す）・1 つ足す・1 つ一致 */
function signedPlan(extra = false) {
  const root = asset("n0", null, { name: "【架空】みなと台清掃工場", level: 1, parentKey: null });
  const boiler = asset("n1", null, { name: "ボイラ設備", level: 2, parentKey: "n0" });
  const pumpA = asset("n11", null, { name: "ボイラ給水ポンプ A", level: 3, parentKey: "n1" });
  const blower = asset("n13", null, { name: "スートブロワ A", level: 3, parentKey: "n1" });
  const draft = asset("n2", null, { name: "通風設備", level: 2, parentKey: "n0" });
  const fan = asset("n21", null, { name: "二次押込送風機", level: 3, parentKey: "n2" });
  const ghost = asset("n9", null, { name: "つなぎ先に無い機器", level: 3, parentKey: "n2" });
  const p = plan({
    assets: [root, boiler, pumpA, blower, draft, fan, ...(extra ? [ghost] : [])],
    works: [
      work("w1", "OVERHAUL", ["n11"], { kind: "ボイラ給水ポンプの分解整備" }),
      work("w2", "OVERHAUL", ["n13"], { kind: "スートブロワの分解整備" }),
      work("w3", "INSPECT", ["n21"], { kind: "通風補機の点検" }),
      ...(extra ? [work("w9", "INSPECT", ["n9"], { kind: "点検" })] : []),
    ],
    details: [
      detail("d1", "w1", 2027, { planOrActual: "plan" }),
      detail("d2", "w1", 2031, { planOrActual: "plan" }),
      detail("d3", "w2", 2027, { planOrActual: "plan" }),
      detail("d4", "w3", 2026, { planOrActual: "plan" }),
      detail("d5", "w3", 2027, { planOrActual: "plan" }),
      ...(extra ? [detail("d9", "w9", 2029, { planOrActual: "plan" })] : []),
    ],
  });
  return { ...p, planId: "plan-connect-pkg" };
}
const latestOf = (extra = false): LatestSigned => ({ version: 1, plan: signedPlan(extra) });

async function world() {
  const dir = temp();
  const sd = temp();
  writeSettings(sd, { v: 1, root: null, ledger: null, name: null, connect: true });
  const fakes: Record<string, Any> = { [TEST_BASE]: testing.createFakeMaximo(seed(TEST_BASE)), [PROD_BASE]: testing.createFakeMaximo(seed(PROD_BASE)) };
  const fetchImpl = (input: string, init: RequestInit) => fakes[new URL(input).origin]!.fetch(input, init);
  // ライセンス：試験のたびに作る鍵（本物の秘密鍵は使わない）
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const licenses = new nodeMod.LicenseStore({ dir, keys: { p1: { x: publicKey.export({ format: "jwk" }).x, test: false } }, now: () => NOW, revoked: new Set() });
  const issueFor = (host: string) =>
    licenseMod.encodeLicenseKey(
      { v: 1, kid: "p1", lic: "lic_moyai_test", org: "【架空】組合", email: "buyer@example.invalid", hosts: [host], iat: Math.floor(NOW / 1000) - 60, exp: Math.floor(NOW / 1000) + 3600 },
      (input: Uint8Array) => new Uint8Array(sign(null, input, privateKey)),
    );
  const connections = new nodeMod.ConnectionStore({ dir });
  const t = await connections.save({ name: "【架空】Maximo（テスト）", baseUrl: TEST_BASE, environment: "test", apiKey: API_KEY });
  const p = await connections.save({ name: "【架空】Maximo（本番）", baseUrl: PROD_BASE, environment: "production", apiKey: API_KEY });
  const backend = await loadPackageBackend({ pkg, dir, fetchImpl, licenses });
  const svc = new ConnectService({ stateDir: sd, now: () => NOW, backend });
  return { svc, fakes, licenses, issueFor, testId: t.connection.id as string, prodId: p.connection.id as string };
}

describe.skipIf(!ready)("本物の部品の道（偽の Maximo）", () => {
  it("つなぎ先は部品の接続の保存から出る（キーは出ない）。テスト環境は鍵なし、本番は鍵が要る", async () => {
    const w = await world();
    const st = await w.svc.state();
    expect(st).toMatchObject({ enabled: true, available: true, fake: false });
    expect(st.targets.map((t) => [t.id, t.kind, t.host, t.env, t.write])).toEqual([
      [w.testId, "maximo", "maximo-test.example", "test", { needed: false }],
      [w.prodId, "maximo", "maximo.example", "production", { needed: true, ok: false, reason: "noKey" }],
    ]);
    expect(JSON.stringify(st)).not.toContain(API_KEY);
  });

  it("読む：資産の木・PM・作業指示を中間形にして、作業の実績を取り込みの資料にする", async () => {
    const w = await world();
    const r = await w.svc.read(w.testId);
    if (!r.ok) throw new Error(r.reason);
    expect(r.counts).toEqual({ assets: 7, plans: 4, results: 2 });
    const csv = Buffer.from(r.base64, "base64").toString("utf8");
    expect(csv).toContain("2024/04/06");
    expect(csv).toContain("ボイラ給水ポンプの分解整備");
    expect(JSON.stringify(r)).not.toContain(API_KEY);
    expect(w.fakes[TEST_BASE]!.writeCount()).toBe(0);
  });

  it("突合 → 差分 → 人の送り（テスト環境）：足す・変えるを書き、読み直すと差分が無くなる", async () => {
    const w = await world();
    const p = await w.svc.plan(w.testId, latestOf());
    if (!p.ok) throw new Error(p.reason);
    expect(p.counts).toMatchObject({ ok: 1, diff: 1, add: 1, change: 1 });
    expect(p.write).toEqual({ needed: false });
    const sent = await w.svc.send(w.testId, latestOf(), p.hash);
    expect(sent).toMatchObject({ ok: true, applied: 2 });
    const again = await w.svc.plan(w.testId, latestOf());
    if (!again.ok) throw new Error(again.reason);
    expect(again.counts).toMatchObject({ diff: 0, add: 0, change: 0 });
    // 減らす年度の PM（PM1 の 2028）は、足す年度に書き換えて使う（消さない）。つなぎ先だけの PM2 は残る
    const pms = w.fakes[TEST_BASE]!.records("MXAPIPM").map((x: Any) => x.attrs.pmnum);
    expect(pms).toEqual(expect.arrayContaining(["PM1", "PM2", "PM3", "PM4"]));
    expect(pms).toHaveLength(6);
  });

  it("本番：鍵が無ければ送らない（Maximo への書き込みは 0 件）。その host の鍵を置けば送れる", async () => {
    const w = await world();
    const p = await w.svc.plan(w.prodId, latestOf());
    if (!p.ok) throw new Error(p.reason);
    expect(p.write).toEqual({ needed: true, ok: false, reason: "noKey" });
    expect(await w.svc.send(w.prodId, latestOf(), p.hash)).toEqual({ ok: false, reason: "connectLicense.noKey" });
    expect(w.fakes[PROD_BASE]!.writeCount()).toBe(0);
    expect(w.licenses.save(await w.issueFor(PROD_BASE)).ok).toBe(true);
    const p2 = await w.svc.plan(w.prodId, latestOf());
    if (!p2.ok) throw new Error(p2.reason);
    expect(p2.write).toEqual({ needed: true, ok: true });
    expect(await w.svc.send(w.prodId, latestOf(), p2.hash)).toMatchObject({ ok: true, applied: 2 });
  });

  it("つなぎ先の資産の木に無い資産の計画があれば、差分ごと止めて人に返す（黙って一部だけを送らない）", async () => {
    const w = await world();
    expect(await w.svc.plan(w.testId, latestOf(true))).toEqual({ ok: false, reason: "connectUnwritable" });
    expect(await w.svc.send(w.testId, latestOf(true), "x")).toEqual({ ok: false, reason: "connectUnwritable" });
    expect(w.fakes[TEST_BASE]!.writeCount()).toBe(0);
  });

  it("設定で足す：部品の ConnectionStore に保存し、キーは暗号化して置く（答え・保存のファイルに平文で出ない）。部品の problem を理由の名前に写す", async () => {
    const dir = temp();
    const sd = temp();
    writeSettings(sd, { v: 1, root: null, ledger: null, name: null, connect: true });
    const svc = new ConnectService({ stateDir: sd, now: () => NOW, backend: await loadPackageBackend({ pkg, dir }) });
    const key = "added-key-never-shown-9876543210";
    const r = await svc.add({ label: "【架空】Maximo（本番 2）", url: "https://maximo2.example", env: "production", apiKey: key });
    if (!r.ok) throw new Error(r.reason);
    expect(r.target).toMatchObject({ kind: "maximo", host: "maximo2.example", env: "production" });
    expect(JSON.stringify(r)).not.toContain(key);
    expect((await svc.state()).targets.map((t) => t.id)).toEqual([r.target.id]);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(dir, "connections.json"), "utf8")).not.toContain(key);
    // 同じ置き場所を部品の ConnectionStore で開くと、同じキーが戻る（MX Stage と共有できる形）
    expect(await new nodeMod.ConnectionStore({ dir }).resolve(r.target.id)).toMatchObject({ ok: true, apiKey: key, origin: "https://maximo2.example" });
    expect(await svc.add({ label: "x", url: "https://maximo2.example/maximo", env: "test", apiKey: key })).toEqual({ ok: false, reason: "connectAdd.url" });
    expect(await svc.add({ label: "x", url: "https://maximo3.example", env: "test", apiKey: "with space" })).toEqual({ ok: false, reason: "connectAdd.key" });
    expect(await svc.add({ label: "   ", url: "https://maximo3.example", env: "test", apiKey: key })).toEqual({ ok: false, reason: "connectAdd.name" });
  });

  it("API キーは Maximo への要求のヘッダだけに載り、URL には載らない", async () => {
    const w = await world();
    await w.svc.read(w.testId);
    const reqs = w.fakes[TEST_BASE]!.state.requests as Any[];
    expect(reqs.length).toBeGreaterThan(0);
    expect(reqs.every((q) => !q.url.includes(API_KEY))).toBe(true);
  });
});
