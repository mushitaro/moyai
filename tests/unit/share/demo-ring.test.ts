// verify demo-ring（docs/plan.md §5.1）：デモの輪の全員の束を確かめる。全員 ✓、入れた ✗ の束は理由つきで ✗。
// 1. コミットしたデモの輪（demo-ring/）を、verify ring と同じ関数で確かめる。
// 2. 道具（scripts/demo-ring/demo-ring-core.ts）が、一時のフォルダに同じ形の輪を作り直せる。秘密鍵は状態のフォルダにだけある。
// 3. 1 バイトの書き換え・約束の ✗ の束を抜く・約束に無い ✗ は、verify demo-ring が外れにする。
// 4. 束のファイルが改行の変換から外れている（.gitattributes）。
// 書き換えの試験は、コミットしたデモの輪を一時のフォルダに写して行う。
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_RING_REJECT_WORLD, DEMO_RING_WORLDS, buildDemoRing, type DemoRingResult } from "../../../scripts/demo-ring/demo-ring-core";
import { resolveDemoRingDir, verifyDemoRingCli, verifyRingCli } from "../../../src/cli/human";
import { verifyRing } from "../../../src/share/checkpoint";
import { DEMO_RING_FILE, DEMO_RING_ID, judgeDemoRing, parseDemoRingManifest, type DemoRingManifest } from "../../../src/share/demo-ring";
import { loadSharePack } from "../../../src/share/pack";
import { ROOT } from "./fixtures";

const DEMO = join(ROOT, "demo-ring");
const packsDir = join(ROOT, "packs");
const pack = (() => {
  const p = loadSharePack(packsDir, "waste-incineration");
  if (!p.ok) throw new Error(p.reason);
  return p.pack;
})();
const manifestOf = (dir: string): DemoRingManifest => {
  const m = parseDemoRingManifest(readFileSync(join(dir, DEMO_RING_FILE), "utf8"));
  if (!m) throw new Error("demo-ring.json を読めない");
  return m;
};
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

let tmp = "";
let built: DemoRingResult;
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "moyai-demo-ring-test-"));
  built = await buildDemoRing({ repo: ROOT, out: join(tmp, "out"), state: join(tmp, "state"), month: "2026-11" });
}, 60_000);
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("verify demo-ring：コミットしたデモの輪", () => {
  it("全員 ✓（拠点 7）、わざと入れた ✗ の束は理由つきで ✗。CLI の終了コードは 0", async () => {
    const m = manifestOf(DEMO);
    expect(m.ring).toBe(DEMO_RING_ID);
    expect(m.confirmed.filter((c) => c.role === "site")).toHaveLength(7);
    const rep = await verifyRing(DEMO, m.ring, pack, new Set(m.confirmed.map((c) => c.key)));
    const j = judgeDemoRing(rep, m);
    expect(j).toMatchObject({ ok: true, unexpected: [], unmet: [], sitesOk: 7, sites: 7 });
    expect(rep.lines.filter((l) => l.kind === "member")).toHaveLength(8);
    const bundles = rep.lines.filter((l) => l.kind === "bundle");
    expect(bundles.filter((l) => l.status === "ok")).toHaveLength(7);
    const ng = bundles.filter((l) => l.status !== "ok");
    expect(ng).toHaveLength(1);
    expect([...new Set(ng[0]!.reasons)].sort()).toEqual(["freeText", "money", "shape.type"]);
    expect(await verifyDemoRingCli(["demo-ring"], { packsDir })).toBe(0);
    expect(await verifyDemoRingCli(["demo-ring", DEMO], { packsDir })).toBe(0);
  });

  it("リポジトリのデモの輪のフォルダを見つける", () => {
    expect(relative(ROOT, resolveDemoRingDir()).replace(/\\/g, "/")).toBe("demo-ring");
  });

  it("verify ring で確かめると、読み合わせていない仲間は未確認の ✗（デモの約束は verify demo-ring だけが使う）", async () => {
    expect(await verifyRingCli(["ring", DEMO], { packsDir, stateDir: join(tmp, "空の状態"), root: join(tmp, "空の保管先") })).toBe(1);
  });

  it("秘密鍵も、架空の施設の名前も、拠点と世界の対応も、コミットしたデモの輪に無い", () => {
    const all = walk(DEMO)
      .map((p) => readFileSync(p, "utf8").normalize("NFKC"))
      .join("\n");
    expect(all).not.toContain("PRIVATE KEY");
    for (const id of [...DEMO_RING_WORLDS, DEMO_RING_REJECT_WORLD]) {
      const w = JSON.parse(readFileSync(join(ROOT, "samples", "truth", "waste-incineration", id, "world.json"), "utf8"));
      expect(all).not.toContain(w.facility.name.normalize("NFKC"));
    }
    const ringFiles = walk(join(DEMO, manifestOf(DEMO).ring)).map((p) => readFileSync(p, "utf8"));
    for (const t of ringFiles) expect(t).not.toMatch(/ledger-\d{2}/);
  });

  it("束のファイルは改行の変換から外れている（.gitattributes の -text）", () => {
    const files = walk(DEMO).map((p) => relative(ROOT, p).replace(/\\/g, "/"));
    const r = spawnSync("git", ["check-attr", "text", "--", ...files], { cwd: ROOT, encoding: "utf8" });
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(files.length);
    for (const l of lines) expect(l).toMatch(/: text: unset$/);
  });
});

describe("verify demo-ring：外れを見つける（写したデモの輪で）", () => {
  const copy = (name: string) => {
    const d = join(tmp, name);
    cpSync(DEMO, d, { recursive: true });
    return d;
  };

  it("✓ の束を 1 バイト書き換えると、約束に無い ✗ になり終了コード 1", async () => {
    const d = copy("tamper");
    const m = manifestOf(d);
    const site = m.confirmed.find((c) => c.role === "site")!.key;
    const dir = join(d, m.ring, "bundles", site);
    const f = join(dir, readdirSync(dir)[0]!);
    const t = readFileSync(f, "utf8");
    writeFileSync(f, t.replace('"FY20', '"FY19'));
    expect(readFileSync(f, "utf8")).not.toBe(t);
    const rep = await verifyRing(d, m.ring, pack, new Set(m.confirmed.map((c) => c.key)));
    const j = judgeDemoRing(rep, m);
    expect(j.ok).toBe(false);
    expect(j.unexpected.map((l) => l.name)).toEqual(expect.arrayContaining([site]));
    expect(await verifyDemoRingCli(["demo-ring", d], { packsDir })).toBe(1);
  });

  it("わざと入れた ✗ の束を抜くと、約束の ✗ にならず終了コード 1", async () => {
    const d = copy("removed");
    const m = manifestOf(d);
    const reject = m.confirmed.find((c) => c.role === "reject")!.key;
    rmSync(join(d, m.ring, "bundles", reject), { recursive: true, force: true });
    const rep = await verifyRing(d, m.ring, pack, new Set(m.confirmed.map((c) => c.key)));
    const j = judgeDemoRing(rep, m);
    expect(j.ok).toBe(false);
    expect(j.unmet.some((u) => u.expect.kind === "bundle" && u.got === null)).toBe(true);
    expect(await verifyDemoRingCli(["demo-ring", d], { packsDir })).toBe(1);
  });

  it("ほかの輪に demo-ring.json を置いても受けない（輪がリポジトリのデモの輪でなければ 2）", async () => {
    const d = copy("other");
    const m = manifestOf(d);
    const fake = "0123456789abcdef";
    cpSync(join(d, m.ring), join(d, fake), { recursive: true });
    rmSync(join(d, m.ring), { recursive: true, force: true });
    writeFileSync(join(d, DEMO_RING_FILE), JSON.stringify({ ...m, ring: fake }));
    expect(await verifyDemoRingCli(["demo-ring", d], { packsDir })).toBe(2);
  });

  it("約束のファイルが無いか形が違えば 1、引数が違えば 2", async () => {
    const d = copy("nomanifest");
    rmSync(join(d, DEMO_RING_FILE));
    expect(await verifyDemoRingCli(["demo-ring", d], { packsDir })).toBe(1);
    writeFileSync(join(d, DEMO_RING_FILE), JSON.stringify({ v: "moyai.demo-ring/0", ring: "x" }));
    expect(await verifyDemoRingCli(["demo-ring", d], { packsDir })).toBe(1);
    expect(await verifyDemoRingCli(["demo-ring", d, "余分"], { packsDir })).toBe(2);
  });
});

describe("デモの輪を作る道具", () => {
  it("一時のフォルダに、拠点 7・わざと外れた束 1 の輪を作り、受け手と同じ関数で約束どおり", async () => {
    expect(built.sites.map((s) => s.world)).toEqual([...DEMO_RING_WORLDS]);
    for (const s of built.sites) expect(s.k).toBeGreaterThanOrEqual(5);
    expect(judgeDemoRing(built.report, built.manifest).ok).toBe(true);
    // 作り直した輪は鍵が変わるので輪 ID も変わる。端末からは受けず（2）、試験だけが ID を渡して確かめる
    expect(built.ringId).not.toBe(DEMO_RING_ID);
    expect(await verifyDemoRingCli(["demo-ring", join(tmp, "out")], { packsDir })).toBe(2);
    expect(await verifyDemoRingCli(["demo-ring", join(tmp, "out")], { packsDir, ringId: built.ringId })).toBe(0);
  });

  it("仲間が 5 に届いた拠点（6 つめ・7 つめ）だけ、輪だけに出す UPGRADE の塊が入りうる。前の 5 拠点には入らない", () => {
    const m = built.manifest;
    const texts = built.sites.map((s) => {
      const dir = join(tmp, "out", m.ring, "bundles", s.key);
      return readFileSync(join(dir, readdirSync(dir)[0]!), "utf8");
    });
    for (const t of texts.slice(0, 5)) expect(t).not.toContain("UPGRADE");
  });

  it("秘密鍵は状態のフォルダにだけある（拠点 7・外れた束 1）", () => {
    const keys = readdirSync(join(tmp, "state", "keys"));
    expect(keys.filter((k) => k.endsWith(".pem"))).toHaveLength(8);
    const out = walk(join(tmp, "out")).map((p) => readFileSync(p, "utf8")).join("\n");
    expect(out).not.toContain("PRIVATE KEY");
  });

  it("出す先にもう輪があれば作らない（足すだけの輪を上書きしない）", async () => {
    await expect(buildDemoRing({ repo: ROOT, out: join(tmp, "out"), state: join(tmp, "state2"), month: "2026-11" })).rejects.toThrow();
  });
});
