// 公開の台帳の受け口の POST /feedback（読み方のフィードバック。運営者 2026-11-16「早く利用者が使える状態に」）：ハンドラを関数として呼び、
// GitHub への fetch をメモリの Issues の台（tests/helpers/feedback-github.ts）に差し替えて試す。
// 確かめること：通れば FEEDBACK_REPO にラベル feedback の Issue を 1 つ出し、その本文を毎日の回し（scripts/skill-loop/feedback.mjs の screen）がそのまま読める。
// 断ること：形の外れ・文や理由の欄・行の値らしきもの・業種の外・数の上限・大きさ。転送をたどらない。権限が無ければ 503 で理由。
// トークンと IP を答え・KV に出さない。本物の Cloudflare と GitHub では未確認。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleRequest, type IntakeDeps, type IntakeEnv } from "../../services/ledger-intake/src/handler";
import { FEEDBACK_LABELS, FEEDBACK_LIMITS, FEEDBACK_TITLE_HEAD, feedbackBody, feedbackOf, feedbackTitle } from "../../services/ledger-intake/src/feedback";
import { packOf } from "../../services/ledger-intake/src/packs";
import { readForm, screen } from "../../scripts/skill-loop/feedback.mjs";
import { HEAD, PACK_OF } from "../../scripts/skill-loop/form.mjs";
import { sendFeedbackToIntake } from "../../src/bridge/ledger-intake";
import { READING_FEEDBACK_SCHEMA, parseReadingFeedback } from "../../src/share/reading-feedback";
import { fakeIssuesGitHub } from "../helpers/feedback-github";
import { memoryKv } from "../helpers/intake-github";

const TOKEN = `github_pat_${"F33d".repeat(6)}_${"y".repeat(40)}`;
const FB_TOKEN = `github_pat_${"Issu".repeat(6)}_${"q".repeat(40)}`;
const IP = "203.0.113.7";

/** アプリの書き出しと同じ形（JSON.stringify(file, null, 2) + 改行） */
const file = (rules: Record<string, unknown>[], pack = "waste-incineration") => JSON.stringify({ schema: READING_FEEDBACK_SCHEMA, pack, rules }, null, 2) + "\n";
const GOOD = file([
  { kind: "sameAsset", names: ["ブロワー", "ブロワ"], cells: 12 },
  { kind: "markMeaning", symbol: "▲", planOrActual: "actual", cells: 1234 },
]);

function setup(envPatch: Partial<IntakeEnv> = {}) {
  const gh = fakeIssuesGitHub({ token: envPatch.FEEDBACK_TOKEN || TOKEN });
  const kv = memoryKv();
  let now = Date.UTC(2026, 10, 16, 3, 0, 0);
  const env: IntakeEnv = { GITHUB_TOKEN: TOKEN, LEDGER_REPO: "ledger-owner/moyai-ledger", FEEDBACK_REPO: `${gh.owner}/${gh.name}`, INTAKE_KV: kv, ...envPatch };
  const deps: IntakeDeps = { fetch: gh.fetch, now: () => now, packOf };
  const send = async (body: string | Uint8Array<ArrayBuffer> | null, o: { ip?: string | null; type?: string; method?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": o.type ?? "application/json" };
    if (o.ip !== null) headers["cf-connecting-ip"] = o.ip ?? IP;
    const res = await handleRequest(new Request("https://intake.example/feedback", { method: o.method ?? "POST", headers, ...(body !== null ? { body } : {}) }), env, deps);
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as { ok: boolean; issue?: { number: number; url: string }; reasons?: string[]; counts?: Record<string, number> } };
  };
  return { gh, kv, env, send, tick: (ms: number) => (now += ms) };
}

describe("受け口の POST /feedback：Issue を出す", () => {
  it("正しい書き出し：FEEDBACK_REPO にラベル feedback・area:skill-loop の Issue を 1 つ。題は機械的、本文は Issue の型の見出し", async () => {
    const s = setup();
    const r = await s.send(GOOD);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, issue: { number: 1, url: `https://github.com/${s.gh.owner}/${s.gh.name}/issues/1` } });
    expect(s.gh.issues).toHaveLength(1);
    const i = s.gh.issues[0]!;
    // 受け口が出した印（ルールの欄の字の SHA-256）。毎日の回しが数えない「確かめ」の欄の中
    expect(i.body).toMatch(/\n<!-- moyai-intake-feedback sha256=[0-9a-f]{64} -->\n$/);
    expect(i.labels).toEqual([...FEEDBACK_LABELS]);
    expect(i.title).toBe("読み方のフィードバック（受け口から・waste-incineration・ルール 2 件）");
    const f = readForm(i.body);
    expect(Object.keys(f)).toEqual([HEAD.pack, HEAD.source, HEAD.what, HEAD.rule, HEAD.check]);
    expect(PACK_OF[f[HEAD.pack]!]).toBe("waste-incineration");
    // ルールの欄は、受けた形から作り直した字（余計な字を運ばない）
    expect(JSON.parse(/```json\n([\s\S]*)\n```/.exec(f[HEAD.rule]!)![1]!)).toEqual(JSON.parse(GOOD));
    // 書き込みは Issue を出す 1 回だけ。どれも FEEDBACK_REPO へ、転送をたどらない
    expect(s.gh.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([`POST /repos/${s.gh.owner}/${s.gh.name}/issues`]);
    expect(s.gh.calls.every((c) => c.redirect === "manual" && c.url.startsWith(`https://api.github.com/repos/${s.gh.owner}/${s.gh.name}/`))).toBe(true);
  });

  it("毎日の回し（scripts/skill-loop/feedback.mjs の screen）が、出した Issue をそのまま読める（1,000 セル以上でも行の値と数えない）", async () => {
    const s = setup();
    await s.send(GOOD);
    const i = s.gh.issues[0]!;
    const d = screen({ number: 1, title: i.title, body: i.body, labels: i.labels });
    expect(d.ok).toBe(true);
    expect(d.pack).toBe("waste-incineration");
    expect(d.rules.map((r: { kind: string }) => r.kind)).toEqual(["sameAsset", "markMeaning"]);
  });

  it("し尿処理も、型の選択肢の字で出す", async () => {
    const s = setup();
    expect((await s.send(file([{ kind: "headerRow", row: 3, cells: 40 }], "night-soil"))).status).toBe(200);
    expect(readForm(s.gh.issues[0]!.body)[HEAD.pack]).toBe("し尿処理（night-soil）");
  });

  it("同じ中身をもう一度送ると、同じ Issue を返して新しく出さない", async () => {
    const s = setup();
    const a = await s.send(GOOD);
    const b = await s.send(GOOD);
    expect(b.status).toBe(200);
    expect(b.body.issue).toEqual(a.body.issue);
    expect(s.gh.issues).toHaveLength(1);
  });

  it("FEEDBACK_TOKEN があれば、それを使う（台帳のトークンを MOYAI のリポジトリに使わない）", async () => {
    const s = setup({ FEEDBACK_TOKEN: FB_TOKEN });
    expect((await s.send(GOOD)).status).toBe(200);
    expect(s.gh.calls.every((c) => c.auth === `Bearer ${FB_TOKEN}`)).toBe(true);
  });

  it("FEEDBACK_TOKEN が空なら GITHUB_TOKEN を使う", async () => {
    const s = setup({ FEEDBACK_TOKEN: "" });
    s.gh.calls.length = 0;
    expect((await s.send(GOOD)).status).toBe(200);
    expect(s.gh.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("出すときにラベルが黙って落ちても、付け直す", async () => {
    const s = setup();
    s.gh.dropLabels = true;
    expect((await s.send(GOOD)).status).toBe(200);
    expect(s.gh.issues[0]!.labels).toEqual([...FEEDBACK_LABELS]);
  });

  it("アプリの送り（sendFeedbackToIntake）からハンドラまで、網を使わずにつなぐ", async () => {
    const s = setup();
    const r = await sendFeedbackToIntake(
      {
        url: "https://intake.example",
        fetch: async (u, i) => {
          expect(i.redirect).toBe("error");
          return handleRequest(new Request(u, { method: i.method, headers: { ...i.headers, "cf-connecting-ip": IP }, ...(i.body !== undefined ? { body: i.body } : {}) }), s.env, { fetch: s.gh.fetch, now: () => Date.now(), packOf });
        },
      },
      GOOD,
    );
    expect(r).toEqual({ ok: true, number: 1, url: `https://github.com/${s.gh.owner}/${s.gh.name}/issues/1` });
  });
});

describe("受け口の POST /feedback：断る（GitHub を呼ばない）", () => {
  const refused = async (body: string, reason: string) => {
    const s = setup();
    const r = await s.send(body);
    expect(r.status).toBe(400);
    expect(r.body.reasons).toContain(reason);
    expect(s.gh.calls).toHaveLength(0);
    expect(s.gh.issues).toHaveLength(0);
    return r;
  };

  it("形の外れ：JSON でない・型が違う・規則が 0 件・知らない種類", async () => {
    await refused("x", "shape.syntax");
    await refused(JSON.stringify({ schema: "moyai.reading/0", pack: "waste-incineration", rules: [{ kind: "headerRow", row: 1, cells: 1 }] }), "feedback.shape");
    await refused(file([]), "feedback.shape");
    await refused(file([{ kind: "nope", cells: 1 }]), "feedback.shape");
  });

  it("文・理由・人・資料の名前・id の欄があれば断る（書き出しの形にない欄）", async () => {
    for (const extra of [{ text: "ブロワーは同じ" }, { reason: "利用者が決めた" }, { by: "【架空】担当" }, { id: "r1" }, { when: { file: "日報*.xlsx" } }]) {
      await refused(file([{ kind: "sameAsset", names: ["ブロワー", "ブロワ"], cells: 1, ...extra }]), "feedback.shape");
    }
  });

  it("キーの重複・__proto__ は断る", async () => {
    await refused(`{"schema":"${READING_FEEDBACK_SCHEMA}","schema":"${READING_FEEDBACK_SCHEMA}","pack":"waste-incineration","rules":[{"kind":"headerRow","row":1,"cells":1}]}`, "shape.duplicateKey");
    await refused(`{"schema":"${READING_FEEDBACK_SCHEMA}","pack":"waste-incineration","__proto__":{},"rules":[{"kind":"headerRow","row":1,"cells":1}]}`, "shape.protoKey");
  });

  it("行の値らしきもの（金額・日付・番号・会社や施設の名前）があれば断り、種類ごとの数だけを返す（値は返さない）", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ kind: "rowRole", match: "120,000円", role: "total", cells: 1 }, "money"],
      [{ kind: "rowRole", match: "2026/11/16 点検", role: "total", cells: 1 }, "exactDate"],
      [{ kind: "sameAsset", names: ["P-1023", "ポンプ"], cells: 1 }, "code"],
      [{ kind: "sameAsset", names: ["株式会社ほげ", "ほげ"], cells: 1 }, "company"],
      [{ kind: "sameAsset", names: ["みなと台清掃工場", "工場"], cells: 1 }, "facility"],
      [{ kind: "sameAsset", names: ["info@example.jp", "連絡先"], cells: 1 }, "contact"],
    ];
    for (const [rule, kind] of cases) {
      const r = await refused(file([rule]), "feedback.rowValues");
      expect(r.body.counts?.[kind]).toBeGreaterThan(0);
      for (const v of ["120,000", "2026/11/16", "P-1023", "株式会社ほげ", "みなと台", "info@example.jp"]) expect(r.text).not.toContain(v);
    }
  });

  it("業種が型の選択肢に無いパックは断る", async () => {
    await refused(file([{ kind: "headerRow", row: 1, cells: 1 }], "other-pack"), "feedback.packUnknown");
  });

  it("feedbackOf は毎日の回しと同じ字で数える（題・決まった文・ルールの欄）", () => {
    const f = parseReadingFeedback(GOOD)!;
    expect(feedbackOf(new TextEncoder().encode(GOOD)).ok).toBe(true);
    // 題にも本文の決まった文にも、4 桁以上の数が入らない
    expect(/\d{4,}/.test(feedbackTitle(f))).toBe(false);
    expect(screen({ title: feedbackTitle(f), body: feedbackBody(f), labels: ["feedback"] }).ok).toBe(true);
  });
});

describe("受け口の POST /feedback：上限と設定", () => {
  it("同じ IP から 1 時間に 10 件まで（断った件も数える）。台帳の /submit の枠とは別に数える", async () => {
    const s = setup();
    for (let i = 0; i < 10; i++) expect((await s.send("x")).status).toBe(400);
    const r = await s.send(GOOD);
    expect(r.status).toBe(429);
    expect(r.body.reasons).toEqual(["intake.rateLimited"]);
    // 1 時間たてば受ける
    s.tick(60 * 60 * 1000 + 1);
    expect((await s.send(GOOD)).status).toBe(200);
    // KV の名前に IP もトークンも出さない
    for (const k of s.kv.data.keys()) {
      expect(k).not.toContain(IP);
      expect(k).not.toContain(TOKEN);
    }
  });

  it("送り手の IP が無ければ受けない", async () => {
    const s = setup();
    expect((await s.send(GOOD, { ip: null })).body.reasons).toEqual(["intake.noClient"]);
  });

  it("大きさ（64 KB まで）・Content-Type・方法", async () => {
    const s = setup();
    expect((await s.send("x".repeat(FEEDBACK_LIMITS.bodyBytes + 1))).status).toBe(413);
    expect((await s.send(GOOD, { type: "text/plain" })).status).toBe(415);
    expect((await s.send(null, { method: "GET" })).status).toBe(405);
  });

  it("受け口が出した開いた Issue（印のあるもの）が 20 あれば、運営者が読むまで出さない。手で立てた Issue は数えない", async () => {
    const s = setup();
    // 手で立てた（印の無い）Issue は、題が同じでも数えない
    for (let i = 0; i < FEEDBACK_LIMITS.openIssues; i++) s.gh.issues.push({ number: s.gh.issues.length + 1, title: `${FEEDBACK_TITLE_HEAD}・waste-incineration・ルール 1 件）`, body: "", labels: ["feedback"], state: "open" });
    expect((await s.send(GOOD)).status).toBe(200);
    // 受け口が出した開いた Issue が 20 になったら断る
    // 送り手を替えて（1 つの IP の 1 時間 10 件の上限に当てない）
    for (let i = 1; i < FEEDBACK_LIMITS.openIssues; i++) expect((await s.send(file([{ kind: "headerRow", row: i, cells: 1 }]), { ip: `198.51.100.${i}` })).status).toBe(200);
    const r = await s.send(file([{ kind: "headerRow", row: 99, cells: 1 }]), { ip: "192.0.2.1" });
    expect(r.status).toBe(503);
    expect(r.body.reasons).toEqual(["intake.busy"]);
    // 運営者が読んで閉じれば、また受ける
    s.gh.issues.forEach((i) => (i.state = "closed"));
    expect((await s.send(file([{ kind: "headerRow", row: 99, cells: 1 }]), { ip: "192.0.2.2" })).status).toBe(200);
  });

  it("同じ中身でも、手で立てた Issue（印が無い）や閉じた Issue は返さない", async () => {
    const s = setup();
    const f = parseReadingFeedback(GOOD)!;
    // 誰かが同じルールの欄を手で貼った Issue
    s.gh.issues.push({ number: 1, title: "手で立てた", body: feedbackBody(f).replace(/<!-- moyai-intake-feedback [^>]*-->/, ""), labels: ["feedback"], state: "open" });
    const a = await s.send(GOOD);
    expect(a.body.issue?.number).toBe(2);
    s.gh.issues[1]!.state = "closed";
    const b = await s.send(GOOD);
    expect(b.body.issue?.number).toBe(3);
  });

  it("開いたフィードバックの Issue が読み切れないほど多ければ（500 を越える）断る", async () => {
    const s = setup();
    for (let i = 0; i < 500; i++) s.gh.issues.push({ number: i + 1, title: "手で立てた", body: "", labels: ["feedback"], state: "open" });
    const r = await s.send(GOOD);
    expect(r.status).toBe(503);
    expect(r.body.reasons).toEqual(["intake.busy"]);
  });

  it("トークンに Issues の権限が無い（403・404）なら、503 で理由を返す", async () => {
    for (const mode of ["forbidden", "notFound"] as const) {
      const s = setup();
      s.gh.mode = mode;
      const r = await s.send(GOOD);
      expect(r.status).toBe(503);
      expect(r.body.reasons).toEqual(["intake.feedbackNoPermission"]);
      expect(r.text).not.toContain(TOKEN);
    }
  });

  it("ラベルを付けられなければ 503 で理由を返す", async () => {
    const s = setup();
    s.gh.dropLabels = true;
    s.gh.labelsFail = true;
    const r = await s.send(GOOD);
    expect(r.status).toBe(503);
    expect(r.body.reasons).toEqual(["intake.feedbackLabel"]);
    // ラベルの無い Issue は閉じる（送り直すたびに、ラベルの無い公開の Issue が増えない）
    expect(s.gh.issues.map((i) => i.state)).toEqual(["closed"]);
    expect((await s.send(GOOD)).body.reasons).toEqual(["intake.feedbackLabel"]);
    expect(s.gh.issues.filter((i) => i.state === "open")).toHaveLength(0);
  });

  it("GitHub の転送（3xx）をたどらない", async () => {
    const s = setup();
    s.gh.mode = "redirect";
    const r = await s.send(GOOD);
    expect(r.status).toBe(502);
    expect(s.gh.calls.every((c) => c.url.startsWith("https://api.github.com/"))).toBe(true);
  });

  it("FEEDBACK_REPO が無い・形が違えば、503 intake.notConfigured（台帳の設定は要らない）", async () => {
    for (const FEEDBACK_REPO of [undefined, "no-slash", "a/b/c"]) {
      const s = setup({ FEEDBACK_REPO });
      expect((await s.send(GOOD)).body.reasons).toEqual(["intake.notConfigured"]);
    }
    const s = setup({ LEDGER_REPO: undefined });
    expect((await s.send(GOOD)).status).toBe(200);
  });

  it("wrangler.jsonc の FEEDBACK_REPO は mushitaro/moyai（固定）", () => {
    const w = readFileSync("services/ledger-intake/wrangler.jsonc", "utf8");
    expect(/"FEEDBACK_REPO":\s*"mushitaro\/moyai"/.test(w)).toBe(true);
  });
});

describe("アプリの送り（sendFeedbackToIntake）：受け口の答えを確かめる", () => {
  const io = (status: number, body: unknown) => ({ url: "https://intake.example", fetch: async () => ({ status, json: async () => body }) });
  it("Issue の URL の番号が答えの番号と違えば受けない", async () => {
    expect((await sendFeedbackToIntake(io(200, { ok: true, issue: { number: 2, url: "https://github.com/o/r/issues/3" } }), GOOD)).ok).toBe(false);
    expect((await sendFeedbackToIntake(io(200, { ok: true, issue: { number: 2, url: "https://evil.example/o/r/issues/2" } }), GOOD)).ok).toBe(false);
  });
  it("断り・上限・止まりを分ける", async () => {
    expect(await sendFeedbackToIntake(io(400, { ok: false, reasons: ["feedback.rowValues"] }), GOOD)).toEqual({ ok: false, reason: "refused", reasons: ["feedback.rowValues"] });
    expect(await sendFeedbackToIntake(io(429, { ok: false, reasons: ["intake.rateLimited"], retryAfter: 120 }), GOOD)).toEqual({ ok: false, reason: "rateLimited", reasons: ["intake.rateLimited"], retryAfter: 120 });
    expect((await sendFeedbackToIntake(io(503, { ok: false, reasons: ["intake.feedbackNoPermission"] }), GOOD)).ok).toBe(false);
    // /feedback の無い前の版の受け口（配置し直す前）
    expect(await sendFeedbackToIntake(io(404, { ok: false, reasons: ["intake.notFound"] }), GOOD)).toEqual({ ok: false, reason: "notDeployed", reasons: ["intake.notFound"] });
    expect(await sendFeedbackToIntake({ url: "https://intake.example", fetch: async () => Promise.reject(new TypeError("x")) }, GOOD)).toEqual({ ok: false, reason: "network", reasons: [] });
  });
});
