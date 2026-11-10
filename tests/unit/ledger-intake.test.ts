// 公開の台帳の受け口（services/ledger-intake。運営者の決定 2026-11-07）：ハンドラを関数として呼び、GitHub への fetch をメモリの台に差し替えて試す。
// 確かめること：形が違う・署名が違う・k < 5・費用の欄・施設名で断る（台帳の検証と同じ理由のコード）、同じハッシュなら前の PR を返す、
// 大きさと件数の上限で断る、トークンと IP を答え・ログ・KV に出さない。本物の Cloudflare と GitHub では未確認。
import { afterEach, describe, expect, it, vi } from "vitest";
import { reasonText } from "../../src/app/text/reasons";
import { loadSharePack, resolvePacksDir } from "../../src/share/pack";
import { LEDGER_JSON_PATH, verifyLedgerFiles, type LedgerFile } from "../../src/share/ledger";
import { handleRequest, INTAKE_LIMITS, intakeBranch, type IntakeDeps, type IntakeEnv } from "../../services/ledger-intake/src/handler";
import { findPr } from "../../services/ledger-intake/src/github";
import { clientBucket, networkBucket } from "../../services/ledger-intake/src/limit";
import { PACK_IDS, packOf } from "../../services/ledger-intake/src/packs";
import worker from "../../services/ledger-intake/src/index";
import { fakeLedgerGitHub, memoryKv } from "../helpers/intake-github";
import { sendToIntake } from "../../src/bridge/ledger-intake";
import { smallPlan, table, vocab } from "./share/fixtures";
import { forge, makeLedger, makeSigner, sealLedger, sealRetired, type Sealed } from "./share/ledger-fixtures";

/** 試験だけのトークン（fine-grained の形。本物ではない） */
const TOKEN = `github_pat_${"T3st".repeat(6)}_${"x".repeat(40)}`;
/** 文書のための IP（RFC 5737・RFC 3849 の範囲） */
const IP = "203.0.113.7";
const IP2 = "198.51.100.23";
const IP6 = "2001:db8:1:2::1";

const pack = { table, vocab };
const L = makeLedger();
const A = makeSigner();
const B = makeSigner();
const a1 = sealLedger(L, A, smallPlan());
const a2 = sealLedger(L, A, smallPlan(), { seq: 2, prev: a1.hash });
const b1 = sealLedger(L, B, smallPlan());

const ledgerFiles = (bundles: readonly Sealed[]): Record<string, string> => ({
  [LEDGER_JSON_PATH]: L.text,
  "ledger/ledger/TERMS.md": "【架空】試験の利用条件\n",
  ...Object.fromEntries(bundles.map((b) => [b.path, b.text])),
});

/** 台帳の Actions と同じ関数で、台帳の木に束を足したときの理由 */
function actionsReasons(onMain: readonly Sealed[], x: Sealed): string[] {
  const files: LedgerFile[] = Object.entries(ledgerFiles(onMain)).map(([path, text]) => ({ path, kind: "file", bytes: Buffer.from(text) }));
  const r = verifyLedgerFiles([...files, { path: x.path, kind: "file", bytes: Buffer.from(x.text) }], pack);
  return r.bundles.find((b) => b.path === x.path)!.reasons;
}

interface Reply {
  status: number;
  headers: Headers;
  text: string;
  body: { ok: boolean; pr?: { number: number; url: string } | null; closed?: { number: number; url: string }[]; reasons?: string[]; reasonsText?: string[] };
}

function setup(onMain: readonly Sealed[] = [], envPatch: Partial<IntakeEnv> = {}) {
  const gh = fakeLedgerGitHub({ token: TOKEN, files: ledgerFiles(onMain) });
  const kv = memoryKv();
  let now = Date.UTC(2026, 10, 7, 3, 0, 0);
  const env: IntakeEnv = { GITHUB_TOKEN: TOKEN, LEDGER_REPO: "ledger-owner/moyai", INTAKE_KV: kv, ...envPatch };
  const deps: IntakeDeps = { fetch: gh.fetch, now: () => now, packOf: (id) => (id === vocab.pack ? pack : null) };
  const replies: Reply[] = [];
  const submit = async (body: string | Uint8Array<ArrayBuffer> | null, o: { ip?: string | null; type?: string; method?: string; path?: string } = {}): Promise<Reply> => {
    const headers: Record<string, string> = { "content-type": o.type ?? "application/json" };
    if (o.ip !== null) headers["cf-connecting-ip"] = o.ip ?? IP;
    const req = new Request(`https://intake.example${o.path ?? "/submit"}`, { method: o.method ?? "POST", headers, ...(body !== null ? { body } : {}) });
    const res = await handleRequest(req, env, deps);
    const text = await res.text();
    const r = { status: res.status, headers: res.headers, text, body: JSON.parse(text) };
    replies.push(r);
    return r;
  };
  const writes = () => gh.calls.filter((c) => c.method !== "GET");
  return { gh, kv, env, deps, submit, replies, writes, tick: (ms: number) => (now += ms) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("受け口：束を受けて PR を出す", () => {
  it("正しい束：枝 intake/<ハッシュの頭 16 字> に束のファイル 1 つを置き、PR を出す。本文に「受け口から（GitHub のアカウントなし）」と鍵 ID", async () => {
    const s = setup();
    const r = await s.submit(a1.text);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, pr: { number: 1, url: "https://github.com/ledger-owner/moyai/pull/1" } });
    const pr = s.gh.prs[0]!;
    expect(pr.head).toBe(intakeBranch(a1.hash));
    expect(pr.head).toBe(`intake/${a1.hash.slice(0, 16)}`);
    expect(pr.base).toBe("main");
    expect(Object.keys(pr.files)).toEqual([a1.path]);
    expect(pr.files[a1.path]!.toString("utf8")).toBe(a1.text);
    expect(pr.body.split("\n")[0]).toBe("受け口から（GitHub のアカウントなし）");
    expect(pr.body).toContain(A.key);
    expect(pr.body).toContain(L.id);
    expect(pr.body).not.toContain("架空の機器");
    // 届いた束は、台帳の Actions と同じ関数で ✓
    expect(actionsReasons([], a1)).toEqual([]);
    // 呼んだのは api.github.com だけ。書き込みは枝・ファイル・PR の 3 つ
    expect(s.gh.calls.every((c) => c.url.startsWith("https://api.github.com/repos/ledger-owner/moyai"))).toBe(true);
    expect(s.writes().map((c) => `${c.method} ${new URL(c.url).pathname.split("/").slice(4, 6).join("/")}`)).toEqual(["POST git/refs", "PUT contents/ledger", "POST pulls"]);
  });

  it("鎖：台帳に載った束の次（連番 2）は受け、前の束が台帳に無い連番 2 は台帳の検証の理由で断る", async () => {
    const ok = setup([a1]);
    expect((await ok.submit(a2.text)).status).toBe(200);
    expect(Object.keys(ok.gh.prs[0]!.files)).toEqual([a2.path]);
    const ng = setup([]);
    const r = await ng.submit(a2.text);
    expect(r.status).toBe(400);
    expect(r.body.reasons).toEqual(actionsReasons([], a2));
    expect(r.body.reasons!.some((x) => x.startsWith("chain."))).toBe(true);
    expect(ng.gh.prs).toHaveLength(0);
  });

  it("ほかの鍵の束は、その鍵のフォルダだけを読んで確かめる", async () => {
    const s = setup([a1, a2]);
    expect((await s.submit(b1.text)).status).toBe(200);
    const blobs = s.gh.calls.filter((c) => c.url.includes("/git/blobs/"));
    // 読んだ blob は ledger.json だけ（A の束は読まない）
    expect(blobs).toHaveLength(1);
  });
});

describe("受け口：断る", () => {
  it("形が違う：JSON でない・途中で切れている・深すぎる・正規形でない・束の形でない → 400 と理由。GitHub は呼ばない", async () => {
    const s = setup();
    const deep = `${"[".repeat(9)}1${"]".repeat(9)}`;
    const pretty = JSON.stringify(JSON.parse(a1.text), null, 2);
    const cases: [string, string][] = [
      ["束ではない文", "shape.syntax"],
      ['{"body":{', "shape.truncated"],
      [deep, "file.tooDeep"],
      [pretty, "shape.notCanonical"],
      ['{"a":1}', "file.notBundle"],
    ];
    for (const [body, reason] of cases) {
      const r = await s.submit(body);
      expect(r.status, reason).toBe(400);
      expect(r.body.ok).toBe(false);
      expect(r.body.reasons, reason).toContain(reason);
      expect(r.body.reasonsText).toEqual([...new Set(r.body.reasons!.map(reasonText))]);
    }
    expect(s.gh.calls).toHaveLength(0);
  });

  it("署名が違う：1 文字書き換えた束・ほかの鍵で署名した束 → 400 chain.badSignature。GitHub は呼ばない", async () => {
    const s = setup();
    const tampered = a1.text.replace('"month":"2026-11"', '"month":"2026-12"');
    expect(tampered).not.toBe(a1.text);
    const r1 = await s.submit(tampered);
    expect(r1.status).toBe(400);
    expect(r1.body.reasons).toEqual(["chain.badSignature"]);
    expect(r1.body.reasonsText).toEqual([reasonText("chain.badSignature")]);
    // B の鍵で署名し、A の公開鍵を名乗る
    const other = forge(a1, B, () => undefined);
    const r2 = await s.submit(other.text);
    expect(r2.status).toBe(400);
    expect(r2.body.reasons).toContain("chain.badSignature");
    expect(s.gh.calls).toHaveLength(0);
    // 台帳の Actions も同じ束を同じ理由で ✗ にする
    expect(actionsReasons([], other)).toContain("chain.badSignature");
  });

  it("k < 5・費用の欄・施設名 → 400。理由は台帳の Actions（verifyLedgerFiles）の字のまま。PR は出さない", async () => {
    const kShort = forge(a1, A, (body) => {
      (body.profile as Record<string, unknown>).axes = { furnace: "OTHER", capacity_t_per_day: "C400P", turbine: "YES", ash: "MELT", contract: "OM" };
      (body.counts as Record<string, unknown>).k = 0;
    });
    const cost = forge(a1, A, (body) => {
      (body.chunks as Record<string, unknown>[])[0]!.cost = "1,200,000円";
    });
    const name = forge(a1, A, (body) => {
      body.facility = "【架空】みどり台クリーンセンター";
    });
    const want: [Sealed, string[]][] = [
      [kShort, ["k.belowMin"]],
      [cost, ["shape.type", "freeText", "money"]],
      [name, ["shape.type", "freeText"]],
    ];
    for (const [x, must] of want) {
      const s = setup();
      const r = await s.submit(x.text);
      expect(r.status).toBe(400);
      expect(r.body.reasons).toEqual(actionsReasons([], x));
      expect(r.body.reasons).toEqual(expect.arrayContaining(must));
      expect(r.body.reasonsText).toEqual([...new Set(actionsReasons([], x).map(reasonText))]);
      expect(s.gh.prs).toHaveLength(0);
      expect(s.writes()).toHaveLength(0);
    }
  });

  it("台帳に同じ束がもう載っていれば、台帳の検証の理由で断る", async () => {
    const s = setup([a1]);
    const r = await s.submit(a1.text);
    expect(r.status).toBe(400);
    expect(r.body.reasons).toEqual(["ledger.exists"]);
    expect(s.writes()).toHaveLength(0);
  });

  it("台帳の決まり（ledger.json）が ✓ でなければ、出した人には直せないので 503", async () => {
    const s = setup();
    s.gh.main.set(LEDGER_JSON_PATH, Buffer.from(L.text.replace('"minK":5', '"minK":3')));
    const r = await s.submit(a1.text);
    expect(r.status).toBe(503);
    expect(r.body.reasons).toContain("ledger");
    expect(s.writes()).toHaveLength(0);
  });
});

describe("受け口：取り下げの印（retired.json。Architect の 72 の 4・5）", () => {
  const prUrl = (n: number) => `https://github.com/ledger-owner/moyai/pull/${n}`;

  it("その鍵の束の PR がまだマージされていなければ、PR を閉じて「本人が取り下げた」と書き、取り下げの PR は出さない", async () => {
    const s = setup();
    expect((await s.submit(a1.text)).body.pr).toEqual({ number: 1, url: prUrl(1) });
    // ほかの鍵（B）の束の PR は閉じない
    expect((await s.submit(b1.text)).body.pr).toEqual({ number: 2, url: prUrl(2) });
    const before = s.writes().length;
    const r = await s.submit(sealRetired(L, A, 1).text);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, pr: null, closed: [{ number: 1, url: prUrl(1) }] });
    expect(s.gh.prs.map((p) => [p.number, p.state])).toEqual([
      [1, "closed"],
      [2, "open"],
    ]);
    expect(s.gh.prs[0]!.comments).toHaveLength(1);
    expect(s.gh.prs[0]!.comments[0]).toContain("本人が取り下げました");
    expect(s.gh.prs[0]!.comments[0]).toContain(A.key);
    expect(s.gh.prs[1]!.comments).toEqual([]);
    // 書いたのは、文と閉じる 2 つだけ（枝もファイルも PR も作らない）
    expect(s.writes().slice(before).map((c) => `${c.method} ${new URL(c.url).pathname.split("/").slice(4).join("/")}`)).toEqual(["POST issues/1/comments", "PATCH pulls/1"]);
  });

  it("マージ済み（台帳に載った束がある）なら、取り下げの PR を出す。開いた次の束の PR は閉じる。届いた印は台帳の Actions と同じ関数で ✓", async () => {
    const s = setup([a1]);
    expect((await s.submit(a2.text)).body.pr).toEqual({ number: 1, url: prUrl(1) });
    const own = sealRetired(L, A, 2);
    const r = await s.submit(own.text);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, pr: { number: 2, url: prUrl(2) }, closed: [{ number: 1, url: prUrl(1) }] });
    const pr = s.gh.prs[1]!;
    expect(pr.head).toBe(intakeBranch(own.hash));
    expect(Object.keys(pr.files)).toEqual([`ledger/ledger/bundles/${A.key}/retired.json`]);
    expect(pr.files[own.path]!.toString("utf8")).toBe(own.text);
    expect(pr.title).toContain(A.key);
    expect(pr.body.split("\n")[0]).toBe("受け口から（GitHub のアカウントなし）");
    expect(pr.body).toContain("#1");
    // 台帳に印が載ると、A の束は ✓ のまま数えない
    const files: LedgerFile[] = Object.entries(ledgerFiles([a1])).map(([path, text]) => ({ path, kind: "file", bytes: Buffer.from(text) }));
    const read = verifyLedgerFiles([...files, { path: own.path, kind: "file", bytes: pr.files[own.path]! }], pack);
    expect(read.ok).toBe(true);
    expect(read.retired.map((x) => [x.key, x.status, x.last])).toEqual([[A.key, "ok", 2]]);
    expect(read.bundles.find((b) => b.path === a1.path)).toMatchObject({ status: "ok", retired: true, body: null });
    // 同じ印をもう一度：前の PR を返し、新しく出さない
    const writes = s.writes().length;
    const again = await s.submit(own.text);
    expect(again.body).toEqual({ ok: true, pr: { number: 2, url: prUrl(2) }, closed: [] });
    expect(s.writes()).toHaveLength(writes);
  });

  it("利用者のフォークから出た、その鍵の束の PR（GitHub の道）も閉じる。題に鍵 ID があっても、ほかの鍵のフォルダのファイルを持つ PR は閉じない", async () => {
    const s = setup([a1]);
    s.gh.prs.push(
      { number: 1, head: "someone:moyai/bundle-x", base: "main", title: `共有ファイルを足す：鍵 ${A.key}・連番 2`, body: "", files: { [a2.path]: Buffer.from(a2.text) }, state: "open", merged: false, comments: [] },
      { number: 2, head: "other:moyai/bundle-y", base: "main", title: `共有ファイルを足す：鍵 ${A.key}`, body: "", files: { [b1.path]: Buffer.from(b1.text) }, state: "open", merged: false, comments: [] },
    );
    const r = await s.submit(sealRetired(L, A, 2).text);
    expect(r.body.closed).toEqual([{ number: 1, url: prUrl(1) }]);
    expect(s.gh.prs.map((p) => p.state)).toEqual(["closed", "open", "open"]);
    expect(r.body.pr).toEqual({ number: 3, url: prUrl(3) });
  });

  it("他人の鍵の署名の印・形の外れは 400（GitHub に書かない）。載った束より小さい最後の連番も 400", async () => {
    const s = setup([a1, a2]);
    const forged = await s.submit(sealRetired(L, A, 2, { by: B }).text);
    expect(forged.status).toBe(400);
    expect(forged.body.reasons).toContain("chain.badSignature");
    const otherPub = await s.submit(sealRetired(L, A, 2, { by: B, pub: B.pair.pub }).text);
    expect(otherPub.status).toBe(400);
    expect(otherPub.body.reasons).toContain("chain.keyMismatch");
    const otherLedger = await s.submit(sealRetired(L, A, 2, { ledger: "00000000000000aa" }).text);
    expect(otherLedger.status).toBe(400);
    expect(otherLedger.body.reasons).toContain("chain.otherDestination");
    const below = await s.submit(sealRetired(L, A, 1).text);
    expect(below.status).toBe(400);
    expect(below.body.reasons).toEqual(["chain.retiredBelowKnown"]);
    expect(below.body.reasonsText).toEqual([reasonText("chain.retiredBelowKnown")]);
    expect(s.writes()).toHaveLength(0);
    expect(s.gh.prs).toHaveLength(0);
  });

  it("束と同じ口・同じ IP の上限で数える", async () => {
    const s = setup([a1]);
    for (let i = 0; i < INTAKE_LIMITS.perHour; i++) expect((await s.submit("x")).status).toBe(400);
    const r = await s.submit(sealRetired(L, A, 1).text);
    expect(r.status).toBe(429);
    expect(s.gh.calls).toHaveLength(0);
  });

  it("取り下げた鍵の束は、印が載ったあとは受けない（印の最後の連番より大きければ chain.afterRetired）", async () => {
    const s = setup([a1, sealRetired(L, A, 1)]);
    const r = await s.submit(a2.text);
    expect(r.status).toBe(400);
    expect(r.body.reasons).toContain("chain.afterRetired");
    expect(s.gh.prs).toHaveLength(0);
  });
});

describe("受け口：同じハッシュの束", () => {
  it("同じ中身の束は、前の PR を返して新しく出さない（PR が閉じていても）", async () => {
    const s = setup();
    const first = await s.submit(a1.text);
    const writes = s.writes().length;
    const again = await s.submit(a1.text);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(s.gh.prs).toHaveLength(1);
    expect(s.writes()).toHaveLength(writes);
    s.gh.prs[0]!.state = "closed";
    const closed = await s.submit(a1.text);
    expect(closed.body).toEqual(first.body);
    expect(s.gh.prs).toHaveLength(1);
  });

  it("前の試みが枝とファイルまで置いて止まっていたら、続きから PR を出す", async () => {
    const s = setup();
    s.gh.failOn.add("POST /repos/ledger-owner/moyai/pulls");
    const r1 = await s.submit(a1.text);
    expect(r1.status).toBe(502);
    expect(r1.body.reasons).toEqual(["intake.github"]);
    expect(s.gh.branches.get(intakeBranch(a1.hash))?.size).toBe(1);
    s.gh.failOn.clear();
    const r2 = await s.submit(a1.text);
    expect(r2.status).toBe(200);
    expect(s.gh.prs).toHaveLength(1);
    expect(Object.keys(s.gh.prs[0]!.files)).toEqual([a1.path]);
  });
});

describe("受け口：上限", () => {
  it(`大きさ：${INTAKE_LIMITS.bodyBytes / 1024} KB を越える体は 413（その先は読まない）。GitHub は呼ばない`, async () => {
    const s = setup();
    const over = await s.submit(new Uint8Array(INTAKE_LIMITS.bodyBytes + 1).fill(0x20));
    expect(over.status).toBe(413);
    expect(over.body.reasons).toEqual(["file.tooLarge"]);
    // ちょうど上限なら読む（JSON として読めないので 400）
    const just = await s.submit(new Uint8Array(INTAKE_LIMITS.bodyBytes).fill(0x20));
    expect(just.status).toBe(400);
    expect(s.gh.calls).toHaveLength(0);
  });

  it(`件数：同じ IP から 1 時間に ${INTAKE_LIMITS.perHour} 件まで。次は 429。ほかの IP は通り、1 時間たつと通る。IPv6 は /64 で数える`, async () => {
    const s = setup();
    for (let i = 0; i < INTAKE_LIMITS.perHour; i++) {
      expect((await s.submit("x")).status).toBe(400);
      s.tick(60_000);
    }
    const over = await s.submit("x");
    expect(over.status).toBe(429);
    expect(over.body.reasons).toEqual(["intake.rateLimited"]);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    // 体にも同じ秒を入れる（アプリは「送信の上限（1 時間）　14:20 以降」をこの値から出す）
    expect((over.body as { retryAfter?: number }).retryAfter).toBe(Number(over.headers.get("retry-after")));
    const viaApp = await sendToIntake({ url: "https://intake.example", fetch: async (u, i) => handleRequest(new Request(u, { method: i.method, headers: { ...i.headers, "cf-connecting-ip": IP }, body: i.body ?? null }), s.env, s.deps) }, a1.text);
    expect(viaApp).toMatchObject({ ok: false, reason: "rateLimited", reasons: ["intake.rateLimited"] });
    expect(viaApp.ok === false && viaApp.retryAfter).toBeGreaterThan(0);
    expect(viaApp.ok === false && viaApp.retryAfter).toBeLessThanOrEqual(3600);
    // 断った件も数えるので、正しい束でも断る
    expect((await s.submit(a1.text)).status).toBe(429);
    expect(s.gh.calls).toHaveLength(0);
    expect((await s.submit("x", { ip: IP2 })).status).toBe(400);
    s.tick(60 * 60 * 1000);
    expect((await s.submit(a1.text)).status).toBe(200);
    for (let i = 0; i < INTAKE_LIMITS.perHour; i++) expect((await s.submit("x", { ip: IP6 })).status).toBe(400);
    expect((await s.submit("x", { ip: "2001:db8:1:2:ffff::9" })).status).toBe(429);
    expect((await s.submit("x", { ip: "2001:db8:1:3::1" })).status).toBe(400);
    // KV に IP は残らない（鍵つきのハッシュの名前と時刻だけ。1 時間で消える）
    for (const [k, v] of s.kv.data) {
      expect(k).toMatch(/^ip:[0-9a-f]{32}$/);
      for (const ip of [IP, IP2, IP6, "2001:db8:1:2", "2001:0db8"]) {
        expect(k).not.toContain(ip);
        expect(v.value).not.toContain(ip);
      }
      expect(v.value).toMatch(/^\[[0-9,]+\]$/);
      expect(v.ttl).toBe(3600);
    }
  });

  it("送り手の単位：IPv4 はそのまま、IPv6 は /64、読めなければ受けない", async () => {
    expect(clientBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(clientBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(clientBucket("2001:DB8:1:2::1")).toBe("2001:0db8:0001:0002::/64");
    expect(clientBucket("2001:db8:1:2:3:4:5:6")).toBe("2001:0db8:0001:0002::/64");
    for (const bad of [null, "", "999.1.1.1", "x", "1::2::3", "2001:db8:1:2:3:4:5:6:7"]) expect(clientBucket(bad)).toBeNull();
    const s = setup();
    const r = await s.submit(a1.text, { ip: null });
    expect(r.status).toBe(400);
    expect(r.body.reasons).toEqual(["intake.noClient"]);
  });
});

describe("受け口：トークンと IP を出さない", () => {
  it("答え・console・GitHub への呼び出しの道と体にトークンも IP も無い。トークンは api.github.com への authorization の見出しにだけ入る", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const s = setup([], {});
    await s.submit(a1.text); // 受ける
    await s.submit(a1.text); // 同じハッシュ
    await s.submit("x"); // 形の外れ
    await s.submit(forge(a1, A, (b) => void ((b.chunks as Record<string, unknown>[])[0]!.cost = "1円")).text); // 台帳の検証で ✗
    s.gh.failOn.add("GET /repos/ledger-owner/moyai/pulls");
    await s.submit(b1.text); // GitHub が止まった
    expect(s.replies.map((r) => r.status)).toEqual([200, 200, 400, 400, 502]);
    for (const r of s.replies) {
      expect(r.text).not.toContain(TOKEN);
      expect(r.text).not.toContain(IP);
      expect([...r.headers.values()].join("\n")).not.toContain(TOKEN);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(s.gh.calls.length).toBeGreaterThan(0);
    for (const c of s.gh.calls) {
      expect(c.url.startsWith("https://api.github.com/")).toBe(true);
      expect(c.url).not.toContain(TOKEN);
      expect(c.body ?? "").not.toContain(TOKEN);
      expect(c.url).not.toContain(IP);
      expect(c.body ?? "").not.toContain(IP);
      expect(c.auth).toBe(`Bearer ${TOKEN}`);
    }
    for (const pr of s.gh.prs) expect(`${pr.title}\n${pr.body}`).not.toContain(IP);
  });

  it("思わぬ誤りでも、中身もトークンも出さずに 500", async () => {
    const s = setup();
    const r = await handleRequest(new Request("https://intake.example/submit", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": IP }, body: a1.text }), s.env, {
      ...s.deps,
      packOf: () => {
        throw new Error(`壊れた ${TOKEN}`);
      },
    });
    expect(r.status).toBe(500);
    const text = await r.text();
    expect(JSON.parse(text)).toMatchObject({ ok: false, reasons: ["intake.failed"] });
    expect(text).not.toContain(TOKEN);
  });
});

describe("受け口：道・設定・入口", () => {
  it("道と方法の外は 404・405、Content-Type が JSON でなければ 415", async () => {
    const s = setup();
    expect((await s.submit(null, { method: "GET", path: "/" })).status).toBe(404);
    const get = await s.submit(null, { method: "GET" });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect((await s.submit(a1.text, { type: "text/plain" })).status).toBe(415);
    expect((await s.submit(a1.text, { type: "application/json; charset=utf-8" })).status).toBe(200);
  });

  it("設定が無ければ受けない（503）：トークン・台帳のリポジトリ・KV", async () => {
    for (const patch of [{ GITHUB_TOKEN: undefined }, { GITHUB_TOKEN: "短い" }, { LEDGER_REPO: undefined }, { LEDGER_REPO: "owner-only" }, { INTAKE_KV: undefined }] as Partial<IntakeEnv>[]) {
      const s = setup([], patch);
      const r = await s.submit(a1.text);
      expect(r.status).toBe(503);
      expect(r.body.reasons).toEqual(["intake.notConfigured"]);
      expect(s.gh.calls).toHaveLength(0);
    }
  });

  it("台帳の決まりが名指すパックが受け口に無ければ 503", async () => {
    const s = setup();
    const r = await handleRequest(new Request("https://intake.example/submit", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": IP }, body: a1.text }), s.env, { ...s.deps, packOf: () => null });
    expect(r.status).toBe(503);
    expect((await r.json()).reasons).toEqual(["intake.packMissing"]);
  });

  it("Workers の入口：入れたパックの部品は packs/ と同じバイト列（ハッシュが同じ）。packs/ を変えたら gen-packs.mjs で作り直す", async () => {
    const dir = resolvePacksDir({});
    expect(PACK_IDS.length).toBeGreaterThan(0);
    for (const id of PACK_IDS) {
      const p = loadSharePack(dir, id);
      if (!p.ok) throw new Error(`${id}: ${p.reason}`);
      expect(packOf(id)?.vocab.hash, id).toBe(p.pack.vocab.hash);
      expect(packOf(id)?.table.hash, id).toBe(p.pack.table.hash);
    }
    // 共有に使えるパックは、どれも入っている
    const { readdirSync } = await import("node:fs");
    for (const id of readdirSync(dir)) if (loadSharePack(dir, id).ok) expect(PACK_IDS).toContain(id);
    expect(packOf("知らない")).toBeNull();
    // 入口：道の外は 404、設定が無ければ 503
    expect((await worker.fetch(new Request("https://intake.example/"), {})).status).toBe(404);
    expect((await worker.fetch(new Request("https://intake.example/submit", { method: "POST", body: "{}" }), {})).status).toBe(503);
  });
});

describe("受け口：Security の点検（11-10）で足した守り", () => {
  const prUrl = (n: number) => `https://github.com/ledger-owner/moyai/pull/${n}`;
  const fakePr = (number: number, head: string, title: string, files: Record<string, Buffer> = {}) =>
    ({ number, head, base: "main", title, body: "", files, state: "open" as const, merged: false, comments: [] });

  it("PR の洪水（中 1）：同じ鍵の受け口の PR が開いていれば、中身の違う束でも新しく出さない（400 intake.keyPending）。閉じれば出せる", async () => {
    const s = setup();
    expect((await s.submit(a1.text)).status).toBe(200);
    const other = sealLedger(L, A, smallPlan(), { month: "2026-10" });
    expect(other.hash).not.toBe(a1.hash);
    const writes = s.writes().length;
    const r = await s.submit(other.text);
    expect(r.status).toBe(400);
    expect(r.body.reasons).toEqual(["intake.keyPending"]);
    expect(r.body.reasonsText).toEqual([reasonText("intake.keyPending")]);
    expect(s.writes()).toHaveLength(writes);
    expect(s.gh.prs).toHaveLength(1);
    // 同じ中身の束は、前の PR を返す（上限より前に）
    expect((await s.submit(a1.text)).body.pr).toEqual({ number: 1, url: prUrl(1) });
    s.gh.prs[0]!.state = "closed";
    expect((await s.submit(other.text)).status).toBe(200);
  });

  it(`PR の洪水（中 1）：開いた受け口の PR が全部で ${INTAKE_LIMITS.openPrs} あれば、新しく出さない（503 intake.busy）。フォークの同じ名前の枝の PR は数えない`, async () => {
    const s = setup();
    for (let i = 0; i < INTAKE_LIMITS.openPrs; i++) s.gh.prs.push(fakePr(i + 1, `evil:intake/${String(i).padStart(16, "0")}`, "共有ファイルを足す"));
    // フォークの PR は数えないので受ける
    expect((await s.submit(b1.text)).status).toBe(200);
    const t = setup();
    for (let i = 0; i < INTAKE_LIMITS.openPrs; i++) t.gh.prs.push(fakePr(i + 1, `intake/${String(i).padStart(16, "0")}`, "共有ファイルを足す"));
    const r = await t.submit(b1.text);
    expect(r.status).toBe(503);
    expect(r.body.reasons).toEqual(["intake.busy"]);
    expect(t.writes()).toHaveLength(0);
  });

  it(`件数（中 2）：まわりの網（IPv6 の /48・IPv4 の /24）からは 1 時間に ${INTAKE_LIMITS.perHourNetwork} 件まで。/64 を替えてもすり抜けない`, async () => {
    expect(networkBucket("2001:db8:1:2::1")).toBe("2001:0db8:0001::/48");
    expect(networkBucket("203.0.113.7")).toBe("203.0.113.0/24");
    expect(networkBucket("::ffff:203.0.113.7")).toBe("203.0.113.0/24");
    for (const bad of [null, "", "x", "1::2::3"]) expect(networkBucket(bad)).toBeNull();
    const s = setup();
    let n = 0;
    for (let net = 0; n < INTAKE_LIMITS.perHourNetwork; net++) {
      for (let i = 0; i < INTAKE_LIMITS.perHour && n < INTAKE_LIMITS.perHourNetwork; i++, n++) expect((await s.submit("x", { ip: `2001:db8:1:${net.toString(16)}::${i + 1}` })).status).toBe(400);
    }
    const over = await s.submit("x", { ip: "2001:db8:1:ff::1" });
    expect(over.status).toBe(429);
    expect(over.body.reasons).toEqual(["intake.rateLimited"]);
    // ほかの /48 は通る
    expect((await s.submit("x", { ip: "2001:db8:2:ff::1" })).status).toBe(400);
    const v4 = setup();
    for (let i = 0; i < INTAKE_LIMITS.perHourNetwork; i++) expect((await v4.submit("x", { ip: `198.51.100.${(i % 200) + 1}` })).status).toBe(400);
    expect((await v4.submit("x", { ip: "198.51.100.250" })).status).toBe(429);
    expect((await v4.submit("x", { ip: "198.51.101.1" })).status).toBe(400);
    // 断った 429 は数えないので、KV の項目の時刻の並びは上限より長くならない
    for (const [, v] of v4.kv.data) expect((JSON.parse(v.value) as number[]).length).toBeLessThanOrEqual(INTAKE_LIMITS.perHourNetwork);
  });

  it("前の試みの枝（低 4）：既定のブランチとの差が束のファイル 1 つでない枝は、受け口の PR にしない（502）", async () => {
    const s = setup();
    s.gh.branches.set(intakeBranch(a1.hash), new Map([[".github/workflows/x.yml", Buffer.from("on: push\n")]]));
    const r = await s.submit(a1.text);
    expect(r.status).toBe(502);
    expect(r.body.reasons).toEqual(["intake.github"]);
    expect(s.gh.prs).toHaveLength(0);
    expect(s.writes().map((c) => c.method)).toEqual(["POST"]);
  });

  it("枝の PR（低 3）：GitHub が返した PR の head が、台帳のリポジトリのその枝でなければ、前の PR として返さない", async () => {
    const list = (head: unknown) => async () => ({ status: 200, json: async () => [{ number: 9, html_url: prUrl(9), head }] });
    const gh = (fetch: Parameters<typeof findPr>[0]["fetch"]) => ({ fetch, token: TOKEN, repo: { owner: "ledger-owner", name: "moyai" } });
    expect(await findPr(gh(list({ ref: "intake/0000000000000000", repo: { full_name: "ledger-owner/moyai" } })), "intake/0000000000000000")).toEqual({ number: 9, url: prUrl(9) });
    expect(await findPr(gh(list({ ref: "intake/1111111111111111", repo: { full_name: "ledger-owner/moyai" } })), "intake/0000000000000000")).toBe("error");
    expect(await findPr(gh(list({ ref: "intake/0000000000000000", repo: { full_name: "evil/moyai" } })), "intake/0000000000000000")).toBe("error");
    expect(await findPr(gh(list({ ref: "intake/0000000000000000", repo: null })), "intake/0000000000000000")).toBe("error");
  });

  it("取り下げ（低 5）：ファイルが 1 頁（100 件）に収まらない PR は、残りを見ていないので閉じない", async () => {
    const s = setup([a1]);
    const files = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`ledger/ledger/bundles/${A.key}/${String(i + 2).padStart(6, "0")}-${"0".repeat(16)}.json`, Buffer.from("{}")]));
    s.gh.prs.push(fakePr(1, "someone:big", `鍵 ${A.key}`, files));
    const r = await s.submit(sealRetired(L, A, 1).text);
    expect(r.status).toBe(200);
    expect(r.body.closed).toEqual([]);
    expect(s.gh.prs[0]!.state).toBe("open");
  });

  it("転送（低 6）：GitHub への呼び出しは転送をたどらない（redirect: manual）。アプリから受け口への送信も転送をたどらない（redirect: error）", async () => {
    const s = setup();
    const seen: (string | undefined)[] = [];
    const deps: IntakeDeps = { ...s.deps, fetch: (u, i) => (seen.push(i.redirect), s.deps.fetch(u, i)) };
    const res = await handleRequest(new Request("https://intake.example/submit", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": IP }, body: a1.text }), s.env, deps);
    expect(res.status).toBe(200);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r === "manual")).toBe(true);
    const app: (string | undefined)[] = [];
    await sendToIntake({ url: "https://intake.example", fetch: async (_u, i) => (app.push(i.redirect), { status: 503, json: async () => ({}) }) }, a1.text);
    expect(app).toEqual(["error"]);
  });
});
