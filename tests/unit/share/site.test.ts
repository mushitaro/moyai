// 公開の台帳のサイト（docs/plan.md §2.8 Pages）：確かめ直した束から描き、文字はすべてエスケープし、厳しい CSP を付け、
// 外への要求を持たず、生のファイルを写さず、symlink を拒む。集計の数は束から作った値と一致する（§5.1 ledger・share.chart）。
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aggregate, latestPerKey } from "../../../src/share/aggregate";
import { LEDGER_DIR, LEDGER_JSON_PATH, verifyLedgerFiles, type LedgerFile, type LedgerRead } from "../../../src/share/ledger";
import { SITE_CSS, bandShort, escapeHtml, renderLedgerSite, siteCsp, siteModel } from "../../../src/share/site";
import { siteCli } from "../../../src/cli/ledger";
import type { Plan } from "../../../src/shared/plan";
import { SPEC, TABLE_TEXT, VOCAB_TEXT, asset, detail, plan, table, vocab, work } from "./fixtures";
import { forge, makeLedger, makeSigner, sealLedger, sealRetired, writeRepo, type Sealed, type Signer } from "./ledger-fixtures";

const pack = { table, vocab, classNames: { "T.FEED.LIFT": "架空の昇降機", "T.RESIDUE": "架空の残さ", "T.FEED": "架空の供給" }, axes: [] as never[] };
const L = makeLedger();

/** 施設 i の計画：全員に昇降機の分解整備（間隔は i で変える）、3 施設に残さの点検、2 施設に供給の点検 */
function facilityPlan(i: number): Plan {
  const assets = [asset("a1", "T.FEED.LIFT")];
  const works = [work("w1", "OVERHAUL", ["a1"])];
  const step = 1 + (i % 3);
  const details = [detail("d1", "w1", 2016, { manDays: 6 + i, days: 3 }), detail("d2", "w1", 2016 + step, { manDays: 8 + i, days: 4 })];
  if (i < 3) {
    assets.push(asset("a2", "T.RESIDUE"));
    works.push(work("w2", "INSPECT", ["a2"]));
    details.push(detail("d3", "w2", 2017, { manDays: 2, days: 1 }), detail("d4", "w2", 2019, { manDays: 2, days: 1 }));
  }
  if (i >= 5) {
    assets.push(asset("a3", "T.FEED"));
    works.push(work("w3", "INSPECT", ["a3"]));
    details.push(detail("d5", "w3", 2018));
  }
  return plan({ assets, works, details });
}

let tmp = "";
let bundles: Sealed[] = [];
let signers: Signer[] = [];
let read: LedgerRead;
const files = (bs: readonly Sealed[], extra: LedgerFile[] = []): LedgerFile[] => [
  { path: LEDGER_JSON_PATH, kind: "file", bytes: Buffer.from(L.text) },
  ...bs.map((b) => ({ path: b.path, kind: "file" as const, bytes: Buffer.from(b.text) })),
  ...extra,
];

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "moyai-site-"));
  signers = Array.from({ length: 7 }, () => makeSigner());
  bundles = signers.map((s, i) => sealLedger(L, s, facilityPlan(i)));
  read = verifyLedgerFiles(files(bundles), { table, vocab });
});
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const render = (r: LedgerRead = read, p: typeof pack = pack, workNames: Record<string, string> = { INSPECT: "点検", OVERHAUL: "分解整備" }) =>
  renderLedgerSite({ read: r, pack: p, workNames, build: "MOYAI · build 試験" });

describe("サイトの集計", () => {
  it("統計の行は、束から作った集計と一致する（x・幅の帯・中央の帯がどれも出る）", () => {
    expect(read.ok).toBe(true);
    const m = siteModel({ read, pack });
    expect(m.sections).toHaveLength(1);
    const want = aggregate({ table, profile: m.sections[0]!.profile, self: [], peers: latestPerKey(read.bundles) });
    expect(m.sections[0]!.aggregate).toEqual(want);
    const rows = Object.fromEntries(want.rows.map((r) => [r.class, r.stats.interval.shown]));
    expect(rows).toEqual({ "T.FEED": "x", "T.FEED.LIFT": "median", "T.RESIDUE": "range" });
    const html = render();
    const lift = want.rows.find((r) => r.class === "T.FEED.LIFT")!.stats.interval;
    if (lift.shown !== "median") throw new Error("中央の帯でない");
    expect(lift).toEqual({ shown: "median", n: 7, q1: "I1", median: "I2", q3: "I3" });
    expect(html).toContain(escapeHtml(`中央値 ${bandShort(lift.median)}（四分位 1〜3 年）・n 7`));
    expect(html).toContain("範囲 2 年・n 3");
    // 札は鍵ごとに 1 つで、施設の数だけ並ぶ
    expect(new Set(want.similar.map((s) => s.label)).size).toBe(7);
    for (const s of want.similar) expect(html).toContain(escapeHtml(s.label));
  });

  it("✗ の束は集計に入れず、数と理由を出す", () => {
    const t = bundles[0]!.text;
    const bad = { ...bundles[0]!, text: t.replace("FY2016", "FY2015") };
    const r = verifyLedgerFiles(files([bad, ...bundles.slice(1)]), { table, vocab });
    const m = siteModel({ read: r, pack });
    expect(m.ok).toBe(6);
    expect(m.ng).toBe(1);
    expect(m.sections[0]!.aggregate.similar).toHaveLength(6);
    const html = render(r);
    expect(html).toContain("✗ 1 件");
    expect(html).toContain("署名 ✗");
  });
});

describe("取り下げの印（Architect の 72）と集計", () => {
  it("印のある鍵は ✓ のまま、k にも集計にも数えない。似た施設の数が減り、下限を割った塊は帯を出さない", () => {
    const before = siteModel({ read, pack });
    expect(before.keys).toBe(7);
    const rowsOf = (m: ReturnType<typeof siteModel>) => Object.fromEntries(m.sections[0]!.aggregate.rows.map((r) => [r.class, r.stats.interval]));
    expect(rowsOf(before)["T.RESIDUE"]).toMatchObject({ shown: "range", n: 3 });
    // 残さの点検のある施設 0 が取り下げる（その鍵自身の署名の印）
    const r = verifyLedgerFiles(files([...bundles, sealRetired(L, signers[0]!, 1)]), { table, vocab });
    expect(r.ok).toBe(true);
    expect(r.bundles.find((b) => b.path === bundles[0]!.path)).toMatchObject({ status: "ok", retired: true, body: null });
    const m = siteModel({ read: r, pack });
    expect(m).toMatchObject({ ok: 7, ng: 0, keys: 6, retired: 1 });
    expect(m.sections[0]!.aggregate.similar).toHaveLength(6);
    expect(m.sections[0]!.aggregate).toEqual(aggregate({ table, profile: m.sections[0]!.profile, self: [], peers: latestPerKey(r.bundles.filter((b) => b.status === "ok")) }));
    // 残さの点検は 3 → 2 施設になり、帯を出さない（x）。昇降機は 7 → 6 で中央の帯のまま
    expect(rowsOf(m)["T.RESIDUE"]).toMatchObject({ shown: "x" });
    expect(rowsOf(m)["T.FEED.LIFT"]).toMatchObject({ shown: "median", n: 6 });
    expect(render(r)).toContain("取り下げ済みの鍵 1 個（集計対象外）");
    // 他人の鍵の署名の印は受けず、✗ として出し、数は減らない
    const forged = verifyLedgerFiles(files([...bundles, sealRetired(L, signers[0]!, 1, { by: signers[1]! })]), { table, vocab });
    const fm = siteModel({ read: forged, pack });
    expect(fm).toMatchObject({ keys: 7, retired: 0, ng: 1 });
    expect(render(forged)).toContain("署名 ✗");
  });
});

describe("サイトのエスケープと CSP", () => {
  it("名前・道・理由のどれもエスケープする", () => {
    const evilPack = { ...pack, classNames: { ...pack.classNames, "T.FEED.LIFT": `<script>alert("x")</script>&'` } };
    const evilPath = `${LEDGER_DIR}/<img src=x onerror=alert(1)>.json`;
    const r = verifyLedgerFiles(files(bundles, [{ path: evilPath, kind: "file", bytes: Buffer.from("x") }]), { table, vocab });
    const html = render(r, evilPack, { OVERHAUL: `"><svg onload=alert(1)>` });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<svg/i);
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;");
    expect(html).toContain(`${LEDGER_DIR}/&lt;img src=x onerror=alert(1)&gt;.json`);
  });

  it("厳しい CSP：default-src 'none'、スタイルは中の 1 つをハッシュで許し、スクリプト・外への要求・書体のファイルは無い", () => {
    const html = render();
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)![1]!.replace(/&#39;/g, "'");
    expect(csp).toBe(siteCsp());
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    expect(style).toBe(SITE_CSS);
    expect(csp).toContain(`style-src 'sha256-${createHash("sha256").update(style, "utf8").digest("base64")}'`);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).not.toMatch(/<(script|link|img|iframe|object|embed|form|base)\b/i);
    expect(html).not.toMatch(/\b(?:src|href|action)\s*=/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/url\(/);
    expect(html).not.toMatch(/style="/);
    expect(html).toContain("【架空】");
    expect(html).toContain('<html lang="ja">');
    expect(SITE_CSS).toContain("BIZ UDPGothic");
    expect(SITE_CSS).toContain("tabular-nums");
  });

  it("束の中の値も、塊の帯のコードと年度だけが出る（費用・名前は束に無い）", () => {
    const html = render();
    expect(html).not.toContain("架空の機器");
    expect(html).not.toContain("【架空】試験の施設");
  });
});

describe("CLI：ledger site", () => {
  function packsDir(): string {
    const p = join(tmp, "packs");
    const pdir = join(p, "waste-incineration");
    mkdirSync(join(pdir, "national"), { recursive: true });
    mkdirSync(join(p, "_kinds"), { recursive: true });
    writeFileSync(join(pdir, "national", "table.json"), TABLE_TEXT);
    writeFileSync(join(pdir, "vocab.json"), VOCAB_TEXT);
    writeFileSync(join(pdir, "pack.json"), JSON.stringify({ id: "waste-incineration", name: "架空", profile: SPEC }));
    writeFileSync(join(p, "_kinds", "work.json"), JSON.stringify({ work: { INSPECT: { label: "点検" }, OVERHAUL: { label: "分解整備" } } }));
    return p;
  }

  it("index.html だけを書き、すべて ✓ なら 0。出すフォルダは無ければ作る", async () => {
    const repo = join(tmp, "repo-ok");
    writeRepo(repo, L, bundles);
    const out = join(tmp, "site-ok", "deep");
    expect(await siteCli([repo, out], { packsDir: packsDir(), build: "MOYAI · build 試験" })).toBe(0);
    expect(readdirSync(out)).toEqual(["index.html"]);
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html).toContain("分解整備");
    expect(html).toContain("【架空】");
    // 生のファイル（束・決まり・利用条件）は写さない
    expect(html).not.toContain(JSON.parse(bundles[0]!.text).sig);
    expect(html).not.toContain("試験の利用条件");
  });

  it("✗ があっても書き、終わりの値は 1。台帳が無ければ 2", async () => {
    const repo = join(tmp, "repo-ng");
    writeRepo(repo, L, [{ ...bundles[0]!, text: bundles[0]!.text.replace("FY2016", "FY2015") }, ...bundles.slice(1)]);
    const out = join(tmp, "site-ng");
    expect(await siteCli([repo, out], { packsDir: packsDir() })).toBe(1);
    expect(lstatSync(join(out, "index.html")).isFile()).toBe(true);
    expect(await siteCli([join(tmp, "無い"), out], { packsDir: packsDir() })).toBe(2);
    expect(await siteCli([repo], { packsDir: packsDir() })).toBe(2);
  });

  it("出すフォルダ・index.html が symlink（junction）なら書かない", async () => {
    const repo = join(tmp, "repo-link");
    writeRepo(repo, L, bundles);
    const real = join(tmp, "real-out");
    mkdirSync(real);
    const linked = join(tmp, "linked-out");
    symlinkSync(real, linked, process.platform === "win32" ? "junction" : "dir");
    expect(await siteCli([repo, linked], { packsDir: packsDir() })).toBe(2);
    expect(readdirSync(real)).toEqual([]);
    const out = join(tmp, "out-with-link");
    mkdirSync(out);
    symlinkSync(real, join(out, "index.html"), process.platform === "win32" ? "junction" : "dir");
    expect(await siteCli([repo, out], { packsDir: packsDir() })).toBe(2);
    expect(readdirSync(real)).toEqual([]);
  });

  it("台帳の中の symlink の束はたどらず、集計に入れない", async () => {
    const repo = join(tmp, "repo-inner-link");
    writeRepo(repo, L, bundles.slice(0, 6));
    const other = join(tmp, "other-ledger");
    writeRepo(other, L, [bundles[6]!]);
    symlinkSync(join(other, ...LEDGER_DIR.split("/"), "bundles", bundles[6]!.key), join(repo, ...LEDGER_DIR.split("/"), "bundles", bundles[6]!.key), process.platform === "win32" ? "junction" : "dir");
    const out = join(tmp, "site-inner");
    expect(await siteCli([repo, out], { packsDir: packsDir() })).toBe(1);
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html).toContain("類似施設 6");
  });

  it("わざと外れた束（施設名）は集計に入らず、理由が出る", async () => {
    const named = forge(bundles[0]!, makeSigner(), (body) => {
      body.facility = "【架空】みどり台クリーンセンター";
    });
    const r = verifyLedgerFiles(files([...bundles, named]), { table, vocab });
    const html = render(r);
    expect(html).not.toContain("みどり台");
    expect(html).toContain("自由記述");
  });
});
