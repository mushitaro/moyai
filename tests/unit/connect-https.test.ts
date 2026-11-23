// 本物の部品（@mxstage/eam-connectors）を、利用者の橋渡しと同じ道で通す：別のプロセスで、部品の ConnectionStore に保存し（Windows は DPAPI、
// macOS はキーチェーン、ほかはファイル）、開いた API キーで部品の MaximoClient が HTTPS の偽の Maximo を読む。
// connect-package.test.ts は fetch を差し込むので、TLS・本物の fetch・OS の鍵の守りは通らない（2026-11-18、CI では見えず運営者の Windows で落ちた類い）。
// 偽の Maximo は試験の中だけ（tests/helpers/fake-maximo.ts）。保存の置き場所・HOME は一時のフォルダ（利用者の ~/.config/mxstage は読まない・書かない）。
// 部品の中身が無い環境では飛ばす（CI の test の仕事は、部品が入っていなければ前の段で落ちる）。
import { execFile } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectService } from "../../src/bridge/connect";
import { importEamPackage, loadPackageBackend } from "../../src/bridge/connect/package";
import { writeSettings } from "../../src/bridge/places";
import { planLinesOfPlan } from "../../src/shared/connect";
import { assetTreeOf, eamTesting, maximoSeed, startFakeMaximo, type FakeMaximoServer } from "../helpers/fake-maximo";
import { asset, detail, plan, work } from "./share/fixtures";

const testing = await eamTesting();
// CI では部品が入っている前提（test の仕事が先に確かめる）。/testing が無ければ、黙って飛ばさずに落とす
if (!testing && process.env.CI) throw new Error("連携の部品の /testing が読めない");
// macOS は、部品の SecretBox が利用者のキーチェーンの項目（"MX Stage"）に鍵を置く。一時のフォルダでは分けられないので走らせない（利用者の本物の鍵に触れない）
const onMac = process.platform === "darwin";
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** 子のプロセスの台本（ESM）。保存 → 開く → 読む。数と形だけを標準出力に返す（キーは返さない） */
const CHILD = `
const { ConnectionStore } = await import("@mxstage/eam-connectors/node");
const { MaximoClient, loadRecords } = await import("@mxstage/eam-connectors");
const { maximoLoadOptions } = await import("@mxstage/eam-connectors/eam");
const [dir, origin, apiKey] = process.argv.slice(1);
const store = new ConnectionStore({ dir });
const saved = await store.save({ name: "【架空】Maximo（テスト）", baseUrl: origin, environment: "test", apiKey });
if (!saved.ok) { console.log(JSON.stringify({ saved: saved.problem })); process.exit(0); }
const r = await new ConnectionStore({ dir }).resolve(saved.connection.id);
if (!r.ok) { console.log(JSON.stringify({ resolved: false })); process.exit(0); }
const key = r.apiKey;
const client = new MaximoClient({ baseUrl: r.origin, apiKey: () => key, via: "direct" });
const assets = await loadRecords(client, maximoLoadOptions("asset", { maxRows: 100 }));
console.log(JSON.stringify({ protection: store.list().protection, keyBack: key === apiKey, assets: assets.records.length, names: assets.records.map((x) => x.attrs.DESCRIPTION) }));
`;

function child(cwd: string, env: NodeJS.ProcessEnv, args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((done) => {
    execFile(process.execPath, ["--input-type=module", "-e", CHILD, ...args], { cwd, env, encoding: "utf8", timeout: 90_000, windowsHide: true }, (err, stdout, stderr) =>
      done({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: String(stdout), err: String(stderr) }),
    );
  });
}

describe.skipIf(!testing || onMac)("本物の部品で、HTTPS の偽の Maximo を読む（別のプロセス・OS の鍵の守り）", () => {
  it("保存したつなぎ先のキーを開き、自分で署名した証明書の偽の Maximo を読む。キーは保存のファイルに平文で出ない", async () => {
    const home = mkdtempSync(join(tmpdir(), "moyai-connect-https-"));
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    const seed = maximoSeed({
      assets: [
        { assetnum: "BOILER", siteid: "MINATO", description: "ボイラ設備" },
        { assetnum: "P11", siteid: "MINATO", description: "ボイラ給水ポンプ A", parent: "BOILER" },
      ],
    });
    const srv: FakeMaximoServer = await startFakeMaximo(testing, seed);
    cleanups.push(() => srv.stop());
    const dir = join(home, ".config", "mxstage");
    // 子は利用者の橋渡しと同じ：部品をリポジトリの node_modules から読み、HOME は一時のフォルダ、証明書は NODE_EXTRA_CA_CERTS で足す
    const env = { ...process.env, HOME: home, USERPROFILE: home, NODE_EXTRA_CA_CERTS: srv.caFile };
    const r = await child(process.cwd(), env, [dir, srv.origin, srv.apiKey]);
    expect(r.code).toBe(0);
    const got = JSON.parse(r.out.trim().split("\n").at(-1)!);
    expect(got).toEqual({
      protection: process.platform === "win32" ? "dpapi" : process.platform === "darwin" ? "keychain" : "file",
      keyBack: true,
      assets: 2,
      names: ["ボイラ設備", "ボイラ給水ポンプ A"],
    });
    // 偽の Maximo に届いた（API キーは URL に載らない）
    expect(srv.requests.length).toBeGreaterThan(0);
    expect(srv.requests.some((q) => q.path.includes(srv.apiKey))).toBe(false);
    // 保存のファイルに平文のキーは無い
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), "utf8")).not.toContain(srv.apiKey);
  });

  it("証明書を足さなければ、部品は自分で署名した証明書の偽の Maximo を読まない（TLS の確かめは緩めていない）", async () => {
    const home = mkdtempSync(join(tmpdir(), "moyai-connect-https-"));
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    const srv = await startFakeMaximo(testing, maximoSeed({ assets: [{ assetnum: "A", siteid: "S", description: "機器" }] }));
    cleanups.push(() => srv.stop());
    const { NODE_EXTRA_CA_CERTS: _drop, NODE_TLS_REJECT_UNAUTHORIZED: _drop2, ...base } = process.env;
    const r = await child(process.cwd(), { ...base, HOME: home, USERPROFILE: home }, [join(home, ".config", "mxstage"), srv.origin, srv.apiKey]);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain('"assets"');
    // 落ちた理由は通信（部品は TLS の誤りを MaximoNetworkError に包む。読み込みの誤りではない）で、偽の Maximo には HTTP の要求が 1 つも届いていない（TLS の握手で断った）
    expect(r.err).toContain("MaximoNetworkError");
    expect(srv.requests).toEqual([]);
  });

  it("HTTPS の偽の Maximo の包みを通して、突合 → 差分 → 送る（書き込み）まで通る（e2e の connect-maximo と同じ道。本体は字で渡す）", async () => {
    const srv = await startFakeMaximo(testing, maximoSeed({}));
    cleanups.push(() => srv.stop());
    const ca = readFileSync(srv.caFile);
    // 本物の fetch の代わりに、その証明書だけを信じる https で送る（このプロセスの TLS の確かめは緩めない）
    const fetchImpl = (url: string, init: RequestInit): Promise<Response> =>
      new Promise((done, fail) => {
        const h: Record<string, string> = {};
        new Headers(init.headers).forEach((v, k) => (h[k] = v));
        const req = httpsRequest(url, { method: init.method ?? "GET", headers: h, ca }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const rh = new Headers();
            for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") rh.set(k, v);
            done(new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode ?? 0, headers: rh }));
          });
        });
        req.on("error", fail);
        if (typeof init.body === "string") req.write(init.body);
        req.end();
      });
    const pkg = await importEamPackage();
    const nodeMod: any = await import(/* @vite-ignore */ "@mxstage/eam-connectors/node" as string); // eslint-disable-line @typescript-eslint/no-explicit-any
    const N = 12;
    const assets = [asset("g", null, { name: "【架空】灰出し設備", level: 1, parentKey: null }), ...Array.from({ length: N }, (_, i) => asset(`a${i}`, null, { name: `機器 ${i}`, level: 2, parentKey: "g" }))];
    const works = Array.from({ length: N }, (_, i) => work(`w${i}`, "INSPECT", [`a${i}`], { kind: "点検" }));
    const details = Array.from({ length: N }, (_, i) => [detail(`d${i}a`, `w${i}`, 2027, { planOrActual: "plan" }), detail(`d${i}b`, `w${i}`, 2028, { planOrActual: "plan" })]).flat();
    const p = { ...plan({ assets, works, details }), planId: "plan-connect-https" };
    const lines = planLinesOfPlan(p);
    const { assets: tree, numOf } = assetTreeOf(lines.map((l) => l.assetPath), "E2E");
    const d0 = lines[0]!;
    srv.use(maximoSeed({ assets: tree, pms: [{ pmnum: "PMD1", siteid: "E2E", description: d0.work, assetnum: numOf.get(d0.assetPath), nextdate: "2030-04-01T00:00:00+09:00" }] }));
    const dir = mkdtempSync(join(tmpdir(), "moyai-connect-https-"));
    const sd = mkdtempSync(join(tmpdir(), "moyai-connect-https-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }), () => rmSync(sd, { recursive: true, force: true }));
    writeSettings(sd, { v: 1, root: null, ledger: null, name: null, connect: true });
    const saved = await new nodeMod.ConnectionStore({ dir }).save({ name: "【架空】Maximo（テスト）", baseUrl: srv.origin, environment: "test", apiKey: srv.apiKey });
    const svc = new ConnectService({ stateDir: sd, now: () => Date.now(), backend: await loadPackageBackend({ pkg, dir, fetchImpl }) });
    const latest = { version: 1, plan: p };
    const pl = await svc.plan(saved.connection.id, latest);
    if (!pl.ok) throw new Error(pl.reason);
    expect(pl.counts).toMatchObject({ ok: 0, diff: 1, add: N - 1, change: 1 });
    const sent = await svc.send(saved.connection.id, latest, pl.hash);
    expect(sent).toMatchObject({ ok: true, applied: N });
    expect(srv.fake().writeCount()).toBeGreaterThan(0);
    const after = await svc.plan(saved.connection.id, latest);
    if (!after.ok) throw new Error(after.reason);
    expect(after.counts).toMatchObject({ ok: N, add: 0, change: 0 });
    expect(srv.requests.some((q) => q.path.includes(srv.apiKey))).toBe(false);
  });
});
