// 公開の台帳の受け口の POST /app-feedback（アプリの困りごと・要望。運営者 2026-11-18）：ハンドラを関数として呼び、
// GitHub への fetch をメモリの Issues の台（tests/helpers/feedback-github.ts）に差し替えて試す。
// 確かめること：通れば FEEDBACK_REPO にラベル feedback:app の Issue を 1 つ出す（題は機械的、本文は決まった見出しと、一言の引用と付き物だけ）。
// その本文を、毎日の回しの台本（scripts/skill-loop/app-feedback.mjs）がそのまま読める。
// 断ること：形の外れ・余計な欄・行の値やファイルの道や鍵らしきもの・大きさ・数え方（/submit・/feedback と別の枠）。同じ中身は同じ Issue を返す。
// トークンと IP を答え・KV に出さない。本物の Cloudflare と GitHub では未確認。
import { describe, expect, it } from "vitest";
import { handleRequest, type IntakeDeps, type IntakeEnv } from "../../services/ledger-intake/src/handler";
import { APP_FEEDBACK_HEAD, APP_FEEDBACK_LABELS, APP_FEEDBACK_LIMITS, appFeedbackBody, appFeedbackTitle } from "../../services/ledger-intake/src/app-feedback";
import { packOf } from "../../services/ledger-intake/src/packs";
import { APP_HEAD, APP_LABEL, readAppIssue } from "../../scripts/skill-loop/app-feedback.mjs";
import { sendAppFeedbackToIntake } from "../../src/bridge/ledger-intake";
import { APP_FEEDBACK_SCHEMA, appFeedbackText, parseAppFeedback, type AppFeedbackFile } from "../../src/share/app-feedback";
import { fakeIssuesGitHub } from "../helpers/feedback-github";
import { memoryKv } from "../helpers/intake-github";

const TOKEN = `github_pat_${"AppF".repeat(6)}_${"y".repeat(40)}`;
const FB_TOKEN = `github_pat_${"Issu".repeat(6)}_${"q".repeat(40)}`;
const IP = "203.0.113.8";

const fileOf = (note: string, patch: Partial<AppFeedbackFile> = {}): AppFeedbackFile => ({ schema: APP_FEEDBACK_SCHEMA, note, version: "d247938", screen: "hoshitori.files", os: "windows", lang: "ja", ...patch });
const text = (note: string, patch: Partial<AppFeedbackFile> = {}) => appFeedbackText(fileOf(note, patch));
const GOOD = text("取り込んだ資料を消せない。入れ間違えた資料を外したい");

function setup(envPatch: Partial<IntakeEnv> = {}) {
  const gh = fakeIssuesGitHub({ token: envPatch.FEEDBACK_TOKEN || TOKEN });
  const kv = memoryKv();
  let now = Date.UTC(2026, 10, 18, 3, 0, 0);
  const env: IntakeEnv = { GITHUB_TOKEN: TOKEN, LEDGER_REPO: "ledger-owner/moyai-ledger", FEEDBACK_REPO: `${gh.owner}/${gh.name}`, INTAKE_KV: kv, ...envPatch };
  const deps: IntakeDeps = { fetch: gh.fetch, now: () => now, packOf };
  const post = async (path: string, body: string | null, o: { ip?: string | null; type?: string; method?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": o.type ?? "application/json" };
    if (o.ip !== null) headers["cf-connecting-ip"] = o.ip ?? IP;
    const res = await handleRequest(new Request(`https://intake.example${path}`, { method: o.method ?? "POST", headers, ...(body !== null ? { body } : {}) }), env, deps);
    const t = await res.text();
    return { status: res.status, text: t, body: JSON.parse(t) as { ok: boolean; issue?: { number: number; url: string }; reasons?: string[]; counts?: Record<string, number> } };
  };
  const send = (body: string | null, o: { ip?: string | null; type?: string; method?: string } = {}) => post("/app-feedback", body, o);
  return { gh, kv, env, send, post, tick: (ms: number) => (now += ms) };
}

describe("受け口の POST /app-feedback：Issue を出す", () => {
  it("正しい全文：FEEDBACK_REPO にラベル feedback:app の Issue を 1 つ。題は機械的、本文は決まった見出し・一言の引用・付き物・印", async () => {
    const s = setup();
    const r = await s.send(GOOD);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, issue: { number: 1, url: `https://github.com/${s.gh.owner}/${s.gh.name}/issues/1` } });
    expect(s.gh.issues).toHaveLength(1);
    const i = s.gh.issues[0]!;
    expect(i.labels).toEqual(["feedback:app"]);
    expect(i.title).toBe("アプリの困りごと（受け口から・hoshitori.files・windows）");
    expect(i.body).toBe(appFeedbackBody(parseAppFeedback(GOOD)!));
    expect(i.body).toContain("```text\n取り込んだ資料を消せない。入れ間違えた資料を外したい\n```");
    expect(i.body).toContain("- MOYAI の版：`d247938`\n- 画面：`hoshitori.files`\n- OS：`windows`\n- 言語：`ja`");
    expect(i.body).toMatch(/\n<!-- moyai-intake-app-feedback sha256=[0-9a-f]{64} -->\n$/);
    // 読み方のフィードバック（ラベル feedback）とは別：毎日の回しの feedback.mjs は拾わない
    expect(i.labels).not.toContain("feedback");
    // 行き先は FEEDBACK_REPO の Issues だけ。転送はたどらない
    expect(s.gh.calls.every((c) => c.redirect === "manual" && c.url.startsWith(`https://api.github.com/repos/${s.gh.owner}/${s.gh.name}/`))).toBe(true);
    // トークンと IP は答えにも本文にも出ない
    for (const t of [r.text, i.body, i.title]) {
      expect(t).not.toContain(TOKEN);
      expect(t).not.toContain(IP);
    }
  });

  it("毎日の回しの台本（app-feedback.mjs）が、出した Issue をそのまま読める（見出しと受け口の字が同じ）", async () => {
    expect(APP_FEEDBACK_HEAD).toEqual(APP_HEAD);
    expect(APP_FEEDBACK_LABELS).toEqual([APP_LABEL]);
    const s = setup();
    // 印に似せた字（64 字の 16 進）は、鍵らしき字として受け口が断る
    expect((await s.send(text(`<!-- moyai-intake-app-feedback sha256=${"a".repeat(64)} -->`))).body.reasons).toEqual(["appFeedback.values"]);
    const note = "AI が確定版を読めない\n```\n<!-- 偽の印 -->\n@someone #1";
    await s.send(text(note, { screen: "hoshitori.chart", os: "mac", lang: "en", version: "abcdef0+" }));
    const i = s.gh.issues[0]!;
    const d = readAppIssue({ number: 1, title: i.title, body: i.body, labels: i.labels });
    expect(d).toEqual({ action: "fix", note, facts: { version: "abcdef0+", screen: "hoshitori.chart", os: "mac", lang: "en" }, fromIntake: true });
    // 一言の中の ``` は柵より短い（囲みを抜けない）。一言の中の HTML・メンションは囲みの中なので効かない
    expect(i.body).toContain("````text\n");
  });

  it("同じ中身をもう一度送ると、同じ Issue を返して新しく出さない。閉じたあとは新しく出す", async () => {
    const s = setup();
    expect((await s.send(GOOD)).body.issue?.number).toBe(1);
    expect((await s.send(GOOD)).body.issue?.number).toBe(1);
    expect(s.gh.issues).toHaveLength(1);
    expect((await s.send(text("別の困りごと"))).body.issue?.number).toBe(2);
    s.gh.issues[0]!.state = "closed";
    expect((await s.send(GOOD)).body.issue?.number).toBe(3);
  });

  it("FEEDBACK_TOKEN があれば、それを使う（台帳のトークンを MOYAI のリポジトリに使わない）", async () => {
    const s = setup({ FEEDBACK_TOKEN: FB_TOKEN });
    expect((await s.send(GOOD)).status).toBe(200);
    expect(s.gh.calls.every((c) => c.auth === `Bearer ${FB_TOKEN}`)).toBe(true);
  });

  it("出すときにラベルが黙って落ちても、付け直す", async () => {
    const s = setup();
    s.gh.dropLabels = true;
    expect((await s.send(GOOD)).status).toBe(200);
    expect(s.gh.issues[0]!.labels).toEqual(["feedback:app"]);
  });

  it("アプリの送り（sendAppFeedbackToIntake）からハンドラまで、網を使わずにつなぐ", async () => {
    const s = setup();
    const r = await sendAppFeedbackToIntake(
      {
        url: "https://intake.example",
        fetch: async (u, i) => {
          expect(u).toBe("https://intake.example/app-feedback");
          expect(i.redirect).toBe("error");
          return handleRequest(new Request(u, { method: i.method, headers: { ...i.headers, "cf-connecting-ip": IP }, ...(i.body !== undefined ? { body: i.body } : {}) }), s.env, { fetch: s.gh.fetch, now: () => Date.now(), packOf });
        },
      },
      GOOD,
    );
    expect(r).toEqual({ ok: true, number: 1, url: `https://github.com/${s.gh.owner}/${s.gh.name}/issues/1` });
  });
});

describe("受け口の POST /app-feedback：断る（GitHub を呼ばない）", () => {
  it("形の外れ：JSON でない・余計な欄（施設・道・資料の中身）・欠けた欄・知らない画面や OS・キーの重複", async () => {
    const s = setup();
    const o = JSON.parse(GOOD) as Record<string, unknown>;
    for (const bad of [
      "x",
      "[]",
      JSON.stringify({ ...o, facility: "【架空】みなと台清掃工場" }),
      JSON.stringify({ ...o, path: "C:\\x" }),
      JSON.stringify({ ...o, rows: [["P-1", 1]] }),
      JSON.stringify({ ...o, screen: "hoshitori.chart?plan=x" }),
      JSON.stringify({ ...o, os: "Windows 11" }),
      JSON.stringify({ ...o, note: "" }),
      JSON.stringify({ ...o, note: "あ".repeat(401) }),
      GOOD.replace('"lang": "ja"', '"lang": "ja",\n  "lang": "en"'),
      `{"__proto__": {}, ${GOOD.slice(1)}`,
    ]) {
      const r = await s.send(bad, { ip: `198.51.100.${Math.floor(Math.random() * 200) + 1}` });
      expect(r.status, bad).toBe(400);
      expect(r.body.reasons, bad).toEqual(["appFeedback.shape"]);
    }
    expect(s.gh.calls).toHaveLength(0);
  });

  it("一言に行の値・ファイルの道・鍵・URL らしきものがあれば断り、種類ごとの数だけを返す（値は返さない）", async () => {
    const s = setup();
    const r = await s.send(text("見積 120,000 円・2026/11/18・P-1023・株式会社ほげ・C:\\Users\\taro・https://x.example/a"));
    expect(r.status).toBe(400);
    expect(r.body.reasons).toEqual(["appFeedback.values"]);
    for (const k of ["money", "groupedNumber", "exactDate", "code", "company", "path", "url"]) expect(r.body.counts?.[k], k).toBeGreaterThan(0);
    for (const v of ["120,000", "2026/11/18", "P-1023", "株式会社ほげ", "taro", "x.example"]) expect(r.text).not.toContain(v);
    expect(s.gh.calls).toHaveLength(0);
  });

  it("大きさ（8 KB まで）・Content-Type・方法・送り手の IP", async () => {
    const s = setup();
    expect((await s.send("x".repeat(APP_FEEDBACK_LIMITS.bodyBytes + 1))).status).toBe(413);
    expect((await s.send(GOOD, { type: "text/plain" })).status).toBe(415);
    expect((await s.send(null, { method: "GET" })).status).toBe(405);
    expect((await s.send(GOOD, { ip: null })).body.reasons).toEqual(["intake.noClient"]);
  });
});

describe("受け口の POST /app-feedback：上限と設定", () => {
  it("同じ IP から 1 時間に 10 件まで（断った件も数える）。/feedback の枠とは別に数える", async () => {
    const s = setup();
    for (let i = 0; i < 10; i++) expect((await s.send("x")).status).toBe(400);
    const r = await s.send(GOOD);
    expect(r.status).toBe(429);
    expect(r.body.reasons).toEqual(["intake.rateLimited"]);
    // 読み方のフィードバックの道（/feedback）の枠は食っていない
    expect((await s.post("/feedback", "x")).status).toBe(400);
    s.tick(60 * 60 * 1000 + 1);
    expect((await s.send(GOOD)).status).toBe(200);
    for (const k of s.kv.data.keys()) {
      expect(k).not.toContain(IP);
      expect(k).not.toContain(TOKEN);
    }
  });

  it("/feedback の枠を使い切っても、/app-feedback は受ける", async () => {
    const s = setup();
    for (let i = 0; i < 10; i++) await s.post("/feedback", "x");
    expect((await s.post("/feedback", "x")).status).toBe(429);
    expect((await s.send(GOOD)).status).toBe(200);
  });

  it("受け口が出した開いた Issue（印のあるもの）が 20 あれば出さない。手で立てた Issue は数えない", async () => {
    const s = setup();
    for (let i = 0; i < APP_FEEDBACK_LIMITS.openIssues; i++) s.gh.issues.push({ number: s.gh.issues.length + 1, title: "手で立てた", body: "", labels: ["feedback:app"], state: "open" });
    expect((await s.send(GOOD)).status).toBe(200);
    for (let i = 1; i < APP_FEEDBACK_LIMITS.openIssues; i++) expect((await s.send(text(`困りごとその${"あ".repeat(i)}`), { ip: `198.51.100.${i}` })).status).toBe(200);
    const r = await s.send(text("もう 1 つ"), { ip: "192.0.2.1" });
    expect(r.status).toBe(503);
    expect(r.body.reasons).toEqual(["intake.busy"]);
    s.gh.issues.forEach((i) => (i.state = "closed"));
    expect((await s.send(text("もう 1 つ"), { ip: "192.0.2.2" })).status).toBe(200);
  });

  it("同じ中身でも、手で立てた Issue（印が無い）は返さない", async () => {
    const s = setup();
    s.gh.issues.push({ number: 1, title: "手で立てた", body: appFeedbackBody(parseAppFeedback(GOOD)!).replace(/<!-- moyai-intake-app-feedback [^>]*-->/, ""), labels: ["feedback:app"], state: "open" });
    expect((await s.send(GOOD)).body.issue?.number).toBe(2);
  });

  it("トークンに Issues の権限が無い（403・404）・ラベルを付けられない・転送は、理由を分けて返す", async () => {
    for (const mode of ["forbidden", "notFound"] as const) {
      const s = setup();
      s.gh.mode = mode;
      const r = await s.send(GOOD);
      expect(r.status).toBe(503);
      expect(r.body.reasons).toEqual(["intake.feedbackNoPermission"]);
      expect(r.text).not.toContain(TOKEN);
    }
    const l = setup();
    l.gh.dropLabels = true;
    l.gh.labelsFail = true;
    expect((await l.send(GOOD)).body.reasons).toEqual(["intake.feedbackLabel"]);
    expect(l.gh.issues.filter((i) => i.state === "open")).toHaveLength(0);
    const d = setup();
    d.gh.mode = "redirect";
    expect((await d.send(GOOD)).status).toBe(502);
  });

  it("FEEDBACK_REPO が無い・形が違えば、503 intake.notConfigured（台帳の設定は要らない）", async () => {
    for (const FEEDBACK_REPO of [undefined, "no-slash", "a/b/c"]) {
      const s = setup({ FEEDBACK_REPO });
      expect((await s.send(GOOD)).body.reasons).toEqual(["intake.notConfigured"]);
    }
    expect((await setup({ LEDGER_REPO: undefined }).send(GOOD)).status).toBe(200);
    expect((await setup({ INTAKE_KV: undefined }).send(GOOD)).body.reasons).toEqual(["intake.notConfigured"]);
  });

  it("題に送り手の字は入らない（決まった語だけ）", () => {
    expect(appFeedbackTitle(fileOf("@someone 消せない"))).toBe("アプリの困りごと（受け口から・hoshitori.files・windows）");
  });
});

describe("アプリの送り（sendAppFeedbackToIntake）：受け口の答えを確かめる", () => {
  const io = (status: number, body: unknown) => ({ url: "https://intake.example", fetch: async () => ({ status, json: async () => body }) });
  it("Issue の URL の番号が答えの番号と違えば受けない。断り・止まり・配置し直す前を分ける", async () => {
    expect((await sendAppFeedbackToIntake(io(200, { ok: true, issue: { number: 2, url: "https://github.com/o/r/issues/3" } }), GOOD)).ok).toBe(false);
    expect(await sendAppFeedbackToIntake(io(400, { ok: false, reasons: ["appFeedback.values"] }), GOOD)).toEqual({ ok: false, reason: "refused", reasons: ["appFeedback.values"] });
    expect(await sendAppFeedbackToIntake(io(404, { ok: false, reasons: ["intake.notFound"] }), GOOD)).toEqual({ ok: false, reason: "notDeployed", reasons: ["intake.notFound"] });
    expect(await sendAppFeedbackToIntake({ url: "https://intake.example", fetch: async () => Promise.reject(new TypeError("x")) }, GOOD)).toEqual({ ok: false, reason: "network", reasons: [] });
  });
});
