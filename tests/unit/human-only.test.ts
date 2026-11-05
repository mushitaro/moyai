// human-only（docs/plan.md §5.1）：人だけの経路は、素の HTTP・Origin の無い POST・偽った Origin で秘密なし・
// 使い終えた印・切れた印を、すべて拒む。拒む試験は消さない。
// あわせて、Host の違う要求、2 つ目のタブ、Origin の無い WebSocket、生存確認、中継の経路の守りを試す。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeStartError, startBridge } from "../../src/bridge/server";
import { readKeyFile } from "../../src/bridge/state";
import { HEADER_RELAY_KEY, HEADER_TAB_SECRET, ROUTES } from "../../src/shared/routes";
import { FakeTab, SECRET_A, SECRET_B, http, startTestBridge, type TestBridge } from "../helpers/bridge";

const PATH = ROUTES.commitTrial.path;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

let tb: TestBridge | null = null;
afterEach(async () => {
  await tb?.close();
  tb = null;
});

/** タブとしてつなぎ、握手して、印を 1 つもらう。 */
async function tabWithToken(t: TestBridge, payload = '{"x":1}') {
  const tab = new FakeTab(`ws://${t.host}/ws`, t.origin);
  await tab.opened;
  tab.send("tab.hello", { secret: SECRET_A, build: "test" });
  await tab.next("bridge.welcome");
  tab.send("tab.token_request", { requestId: "r1", action: "commit_trial", payloadHash: sha(payload) });
  const tok = await tab.next("bridge.token");
  return { tab, token: tok.token as string, payload };
}

function post(t: TestBridge, headers: Record<string, string>, body: unknown) {
  return http(t.bridge.port, "POST", PATH, { "content-type": "application/json", ...headers }, JSON.stringify(body));
}

const goodHeaders = (t: TestBridge) => ({ origin: t.origin, "sec-fetch-site": "same-origin", [HEADER_TAB_SECRET]: SECRET_A });

describe("人だけの経路（確定の試し）", () => {
  it("正しいタブの秘密と印がそろえば通る（守りの形が通すことも確かめる）", async () => {
    tb = await startTestBridge();
    const { token, payload } = await tabWithToken(tb);
    const r = await post(tb, goodHeaders(tb), { token, payload });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, action: "commit_trial", changed: false });
  });

  it("素の HTTP（Origin なしの GET）は拒む", async () => {
    tb = await startTestBridge();
    const r = await http(tb.bridge.port, "GET", PATH);
    expect(r.status).toBe(405);
    expect(r.body.error.code).toBe("method_not_allowed");
  });

  it("Origin の無い POST は、秘密と印がそろっていても拒む", async () => {
    tb = await startTestBridge();
    const { token, payload } = await tabWithToken(tb);
    const r = await post(tb, { [HEADER_TAB_SECRET]: SECRET_A }, { token, payload });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("origin_missing");
  });

  it("偽った Origin で秘密なしの POST は拒む", async () => {
    tb = await startTestBridge();
    const { token, payload } = await tabWithToken(tb);
    const r = await post(tb, { origin: "http://evil.example" }, { token, payload });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("origin_not_allowed");
  });

  it("正しい Origin でも、秘密が無い・違う POST は拒む", async () => {
    tb = await startTestBridge();
    const { token, payload } = await tabWithToken(tb);
    const none = await post(tb, { origin: tb.origin }, { token, payload });
    expect(none.body.error.code).toBe("secret_missing");
    const wrong = await post(tb, { origin: tb.origin, [HEADER_TAB_SECRET]: SECRET_B }, { token, payload });
    expect(wrong.body.error.code).toBe("secret_mismatch");
  });

  it("ほかのサイトからの要求（Sec-Fetch-Site: cross-site）は拒む", async () => {
    tb = await startTestBridge();
    const { token, payload } = await tabWithToken(tb);
    const r = await post(tb, { ...goodHeaders(tb), "sec-fetch-site": "cross-site" }, { token, payload });
    expect(r.body.error.code).toBe("fetch_site_not_allowed");
  });

  it("使い終えた印は拒む", async () => {
    tb = await startTestBridge();
    const { token, payload } = await tabWithToken(tb);
    expect((await post(tb, goodHeaders(tb), { token, payload })).status).toBe(200);
    const again = await post(tb, goodHeaders(tb), { token, payload });
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe("token_unknown");
  });

  it("切れた印は拒む（120 秒）", async () => {
    let now = 1_000_000;
    tb = await startTestBridge({ now: () => now });
    const { token, payload } = await tabWithToken(tb);
    now += 120_001;
    const r = await post(tb, goodHeaders(tb), { token, payload });
    expect(r.body.error.code).toBe("token_expired");
  });

  it("印が無い・中身が違う（ハッシュに結ばれていない）ものは拒む", async () => {
    tb = await startTestBridge();
    const { token } = await tabWithToken(tb);
    expect((await post(tb, goodHeaders(tb), { payload: "{}" })).body.error.code).toBe("token_missing");
    expect((await post(tb, goodHeaders(tb), { token, payload: '{"x":2}' })).body.error.code).toBe("token_mismatch");
    // 違っていても印は消える
    expect((await post(tb, goodHeaders(tb), { token, payload: '{"x":1}' })).body.error.code).toBe("token_unknown");
  });

  it("タブがつながっていなければ拒む", async () => {
    tb = await startTestBridge();
    const r = await post(tb, { origin: tb.origin, [HEADER_TAB_SECRET]: SECRET_A }, { token: "x", payload: "{}" });
    expect(r.body.error.code).toBe("tab_not_open");
  });

  it("JSON でない中身は拒む", async () => {
    tb = await startTestBridge();
    await tabWithToken(tb);
    const r = await http(tb.bridge.port, "POST", PATH, { ...goodHeaders(tb), "content-type": "text/plain" }, "a=1");
    expect(r.body.error.code).toBe("content_type_not_allowed");
  });

  it("人だけの経路のすべてで、秘密なし・印なしを拒む（経路ごとに書かず、共通の守りを通る）", async () => {
    tb = await startTestBridge();
    await tabWithToken(tb);
    const human = Object.values(ROUTES).filter((r) => r.kind === "human");
    expect(human.length).toBeGreaterThan(0);
    const body = JSON.stringify({ payload: "{}" });
    for (const r of human) {
      const noSecret = await http(tb.bridge.port, "POST", r.path, { "content-type": "application/json", origin: tb.origin }, body);
      expect(noSecret.body.error.code, r.path).toBe("secret_missing");
      const noToken = await http(tb.bridge.port, "POST", r.path, { "content-type": "application/json", ...goodHeaders(tb) }, body);
      expect(noToken.body.error.code, r.path).toBe("token_missing");
    }
  });

  it(".claude/settings.json に、127.0.0.1 への HTTP と状態フォルダの deny がある", () => {
    const deny: string[] = JSON.parse(readFileSync(".claude/settings.json", "utf8")).permissions.deny;
    expect(deny).toContain("Bash(curl http://127.0.0.1:*)");
    expect(deny).toContain("Bash(curl -X POST http://127.0.0.1:*)");
    expect(deny.some((d) => d.startsWith("Read(~/AppData/Local/MOYAI"))).toBe(true);
  });
});

describe("網の外側（Host・経路の許可の一覧・静的ファイル）", () => {
  it("Host の違う要求は断る（DNS リバインディング）", async () => {
    tb = await startTestBridge();
    const r = await http(tb.bridge.port, "GET", "/", { host: `evil.example:${tb.bridge.port}` });
    expect(r.status).toBe(421);
    expect(r.body.error.code).toBe("host_not_allowed");
    const p = await http(tb.bridge.port, "GET", "/", { host: "127.0.0.1:1" });
    expect(p.body.error.code).toBe("host_not_allowed");
  });

  it("許可の一覧の経路だけを受け、画面を返す", async () => {
    tb = await startTestBridge();
    const ok = await http(tb.bridge.port, "GET", "/");
    expect(ok.status).toBe(200);
    expect(String(ok.headers["content-security-policy"])).toContain("frame-ancestors 'none'");
    expect((await http(tb.bridge.port, "GET", "/assets/a.js")).status).toBe(200);
    expect((await http(tb.bridge.port, "GET", "/index.html")).body.error.code).toBe("route_not_allowed");
    expect((await http(tb.bridge.port, "GET", "/api/anything")).body.error.code).toBe("route_not_allowed");
    expect((await http(tb.bridge.port, "DELETE", "/")).body.error.code).toBe("method_not_allowed");
  });

  it("画面のフォルダの外へは出ない", async () => {
    tb = await startTestBridge();
    for (const p of ["/assets/../../secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/assets/..%5c..%5csecret.txt"]) {
      const r = await http(tb.bridge.port, "GET", p);
      expect(r.status, p).not.toBe(200);
    }
  });

  it("ほかのサイトから静的ファイルを読ませない。ただし人がリンクで開いたページ（メールのリンク）は受ける（台帳の中-16）", async () => {
    tb = await startTestBridge();
    const r = await http(tb.bridge.port, "GET", "/", { "sec-fetch-site": "cross-site" });
    expect(r.body.error.code).toBe("fetch_site_not_allowed");
    // スクリプトや画像として読ませるのは断る
    expect((await http(tb.bridge.port, "GET", "/assets/a.js", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" })).body.error.code).toBe("fetch_site_not_allowed");
    // 人がほかのサイト（Web メール）のリンクを押して開いたページは受ける
    const nav = await http(tb.bridge.port, "GET", "/?plan=x#/merge", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" });
    expect(nav.status).toBe(200);
    // 人だけの経路は、navigate を名乗っても受けない
    const human = await http(tb.bridge.port, "POST", ROUTES.planStatus.path!, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", origin: tb.origin, "content-type": "application/json" }, JSON.stringify({ token: "x", payload: "{}" }));
    expect(human.status).toBe(403);
  });

  it("使われているポートでは起動を止める", async () => {
    tb = await startTestBridge();
    const err = await startBridge({ port: tb.bridge.port, staticDir: tb.dir, stateDir: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeStartError);
    expect((err as BridgeStartError).code).toBe("port_in_use");
  });

  it("鍵ファイルを状態フォルダ（一時のフォルダ）に書き、止めると消す", async () => {
    const t = await startTestBridge();
    const k = readKeyFile(t.stateDir);
    expect(k?.port).toBe(t.bridge.port);
    expect(k?.key).toBe(t.bridge.relayKey);
    await t.bridge.close();
    expect(readKeyFile(t.stateDir)).toBeNull();
    tb = { ...t, close: async () => {} };
  });
});

describe("タブとの WebSocket", () => {
  it("Origin の無い・違う WebSocket は断る", async () => {
    tb = await startTestBridge();
    await expect(new FakeTab(`ws://${tb.host}/ws`, undefined).opened).rejects.toThrow(/refused 403/);
    await expect(new FakeTab(`ws://${tb.host}/ws`, "http://evil.example").opened).rejects.toThrow(/refused 403/);
    await expect(new FakeTab(`ws://${tb.host}/ws`, `http://localhost:${tb.bridge.port}`).opened).rejects.toThrow(/refused 403/);
  });

  it("Host の違う WebSocket は断る", async () => {
    tb = await startTestBridge();
    const t = new FakeTab(`ws://${tb.host}/ws`, "http://evil.example", { host: "evil.example" });
    await expect(t.opened).rejects.toThrow(/refused 421/);
  });

  it("2 つ目のタブは断り、理由を出す", async () => {
    tb = await startTestBridge();
    const a = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
    await a.opened;
    a.send("tab.hello", { secret: SECRET_A, build: "t" });
    await a.next("bridge.welcome");
    const b = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
    await b.opened;
    b.send("tab.hello", { secret: SECRET_B, build: "t" });
    const refused = await b.next("bridge.refused");
    expect(refused.code).toBe("tab_already_open");
    expect(refused.message.length).toBeGreaterThan(0);
    expect(await b.closed).toBe(4001);
    // 1 つ目は生きたまま。2 つ目の秘密では人だけの経路を通れない
    expect(tb.bridge.tabs.checkSecret(SECRET_B)).toBe("secret_mismatch");
    expect(tb.bridge.tabs.checkSecret(SECRET_A)).toHaveProperty("session");
  });

  it("1 つ目が閉じたら、次のタブを受ける", async () => {
    tb = await startTestBridge();
    const a = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
    await a.opened;
    a.send("tab.hello", { secret: SECRET_A, build: "t" });
    await a.next("bridge.welcome");
    a.ws.close();
    await a.closed;
    await new Promise((r) => setTimeout(r, 50));
    const b = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
    await b.opened;
    b.send("tab.hello", { secret: SECRET_B, build: "t" });
    await b.next("bridge.welcome");
  });

  it("握手のあとの読めない通信は、切らずに飛ばして数える", async () => {
    tb = await startTestBridge();
    const a = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
    await a.opened;
    a.send("tab.hello", { secret: SECRET_A, build: "t" });
    await a.next("bridge.welcome");
    a.ws.send("not json");
    a.ws.send(Buffer.from([1, 2, 3]));
    a.ws.send(JSON.stringify({ type: "bridge.ping", data: { at: 1 } }));
    a.send("tab.token_request", { requestId: "r9", action: "commit_trial", payloadHash: sha("{}") });
    await a.next("bridge.token");
    expect(tb.bridge.tabs.dropped).toBe(3);
    expect(tb.bridge.tabs.connected).toBe(true);
  });

  it("握手の形が違えば断る", async () => {
    tb = await startTestBridge();
    const a = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
    await a.opened;
    a.ws.send(JSON.stringify({ type: "tab.hello", data: { secret: "short", build: "t" } }));
    expect((await a.next("bridge.refused")).code).toBe("hello_invalid");
  });

  it("生存確認に答えないタブは切れたと見なし、印も消す", async () => {
    tb = await startTestBridge({ heartbeatMs: 100, deadMs: 600 });
    const { tab } = await tabWithToken(tb);
    expect(tb.bridge.tokens.size).toBe(1);
    tab.autoPong = false;
    expect(await tab.closed).toBe(4002);
    expect(tb.bridge.tabs.connected).toBe(false);
    expect(tb.bridge.tokens.size).toBe(0);
  });

  it("答えるタブは生きたまま", async () => {
    tb = await startTestBridge({ heartbeatMs: 100, deadMs: 600 });
    const tab = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
    await tab.opened;
    tab.send("tab.hello", { secret: SECRET_A, build: "t" });
    const w = await tab.next("bridge.welcome");
    expect(w).toEqual({ heartbeatMs: 100, deadMs: 600, tokenTtlMs: 120_000 });
    await new Promise((r) => setTimeout(r, 1500));
    expect(tb.bridge.tabs.connected).toBe(true);
  });
});

describe("中継の経路", () => {
  const call = (t: TestBridge, headers: Record<string, string>, body: unknown) =>
    http(t.bridge.port, "POST", ROUTES.relayTool.path, { "content-type": "application/json", ...headers }, JSON.stringify(body));

  it("鍵が無い・違えば断る", async () => {
    tb = await startTestBridge();
    expect((await call(tb, {}, { name: "chart_rows", args: {} })).body.error.code).toBe("relay_key_mismatch");
    expect((await call(tb, { [HEADER_RELAY_KEY]: "x" }, { name: "chart_rows", args: {} })).body.error.code).toBe("relay_key_mismatch");
  });

  it("ブラウザのページからの要求（Origin がある）は、鍵があっても断る", async () => {
    tb = await startTestBridge();
    const r = await call(tb, { origin: tb.origin, [HEADER_RELAY_KEY]: tb.bridge.relayKey }, { name: "chart_rows", args: {} });
    expect(r.body.error.code).toBe("origin_not_allowed");
  });

  it("鍵が合えば受ける：作業画面へ渡すものはタブが無ければ「開いていません」、ほかは型どおりに「未実装」", async () => {
    tb = await startTestBridge();
    const r = await call(tb, { [HEADER_RELAY_KEY]: tb.bridge.relayKey }, { name: "chart_rows", args: { limit: 10 } });
    expect(r.body.error.code).toBe("work_screen_not_open");
    const ni = await call(tb, { [HEADER_RELAY_KEY]: tb.bridge.relayKey }, { name: "note_for_human", args: { before: "confirm", text: "見てください" } });
    expect(ni.body.error.code).toBe("not_implemented");
    expect((await call(tb, { [HEADER_RELAY_KEY]: tb.bridge.relayKey }, { name: "nope", args: {} })).body.error.code).toBe("unknown_tool");
    const bad = await call(tb, { [HEADER_RELAY_KEY]: tb.bridge.relayKey }, { name: "chart_rows", args: { limit: 201 } });
    expect(bad.body.error.code).toBe("invalid_input");
    // F3 の画面を待つツールは、まだ受けない
    const gated = await call(tb, { [HEADER_RELAY_KEY]: tb.bridge.relayKey }, { name: "skill_eval", args: { action: "list" } });
    expect(gated.body.error.code).toBe("unknown_tool");
  });
});
