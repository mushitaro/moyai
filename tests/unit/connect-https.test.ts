// 本物の部品（@mxstage/eam-connectors）を、利用者の橋渡しと同じ道で通す：別のプロセスで、部品の ConnectionStore に保存し（Windows は DPAPI、
// macOS はキーチェーン、ほかはファイル）、開いた API キーで部品の MaximoClient が HTTPS の偽の Maximo を読む。
// connect-package.test.ts は fetch を差し込むので、TLS・本物の fetch・OS の鍵の守りは通らない（2026-11-18、CI では見えず運営者の Windows で落ちた類い）。
// 偽の Maximo は試験の中だけ（tests/helpers/fake-maximo.ts）。保存の置き場所・HOME は一時のフォルダ（利用者の ~/.config/mxstage は読まない・書かない）。
// 部品の中身が無い環境では飛ばす（CI の test の仕事は、部品が入っていなければ前の段で落ちる）。
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eamTesting, maximoSeed, startFakeMaximo, type FakeMaximoServer } from "../helpers/fake-maximo";

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
});
