// 公開の台帳の受け口（services/ledger-intake。運営者の決定 2026-11-07）：ハンドラを関数として呼び、GitHub への fetch をメモリの台に差し替えて試す。
// 確かめること：形が違う・署名が違う・k < 5・費用の欄・施設名で断る（台帳の検証と同じ理由のコード）、同じハッシュなら前の PR を返す、
// 大きさと件数の上限で断る、トークンと IP を答え・ログ・KV に出さない。本物の Cloudflare と GitHub では未確認。
import { afterEach, describe, expect, it, vi } from "vitest";
import { reasonText } from "../../src/app/text/reasons";
import { loadSharePack, resolvePacksDir } from "../../src/share/pack";
import { LEDGER_JSON_PATH, verifyLedgerFiles, type LedgerFile } from "../../src/share/ledger";
import { handleRequest, INTAKE_LIMITS, intakeBranch, type IntakeDeps, type IntakeEnv } from "../../services/ledger-intake/src/handler";
import { clientBucket } from "../../services/ledger-intake/src/limit";
import { PACK_IDS, packOf } from "../../services/ledger-intake/src/packs";
import worker from "../../services/ledger-intake/src/index";
import { fakeLedgerGitHub, memoryKv } from "../helpers/intake-github";
import { smallPlan, table, vocab } from "./share/fixtures";
import { forge, makeLedger, makeSigner, sealLedger, type Sealed } from "./share/ledger-fixtures";

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
  "ledger/TERMS.md": "【架空】試験の利用条件\n",
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
  body: { ok: boolean; pr?: { number: number; url: string }; reasons?: string[]; reasonsText?: string[] };
}

function setup(onMain: readonly Sealed[] = [], envPatch: Partial<IntakeEnv> = {}) {
  const gh = fakeLedgerGitHub({ token: TOKEN, files: ledgerFiles(onMain) });
  const kv = memoryKv();
  let now = Date.UTC(2026, 10, 7, 3, 0, 0);
  const env: IntakeEnv = { GITHUB_TOKEN: TOKEN, LEDGER_REPO: "ledger-owner/moyai-ledger", INTAKE_KV: kv, ...envPatch };
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
    expect(r.body).toEqual({ ok: true, pr: { number: 1, url: "https://github.com/ledger-owner/moyai-ledger/pull/1" } });
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
    expect(s.gh.calls.every((c) => c.url.startsWith("https://api.github.com/repos/ledger-owner/moyai-ledger"))).toBe(true);
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
    s.gh.failOn.add("POST /repos/ledger-owner/moyai-ledger/pulls");
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
    s.gh.failOn.add("GET /repos/ledger-owner/moyai-ledger/pulls");
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
