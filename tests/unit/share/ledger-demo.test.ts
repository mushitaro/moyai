// 公開の台帳のデモの束の道具（scripts/ledger/demo-core.ts。docs/sharing.md §6）。架空の 10 施設の正解の世界から、
// 本物の写し取りと署名で束を作り、受け手と同じ関数ですべて ✓。サイトの集計に x・幅の帯・中央の帯がどれも出る。
// 秘密鍵と施設の名前は出す台帳に無い。わざと外れた 3 つの束は、それぞれの理由だけで ✗。一時のフォルダで行う。
import { LEDGER_BUNDLE_PATH, LEDGER_DIR } from "../../../src/share/ledger";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_FIELDS, buildLedgerDemo, demoWorlds, type DemoResult } from "../../../scripts/ledger/demo-core";
import { kNational } from "../../../src/share/k";
import { loadSharePack } from "../../../src/share/pack";
import { siteModel } from "../../../src/share/site";
import { ROOT } from "./fixtures";

let tmp = "";
let r: DemoResult;
const out = () => join(tmp, "repo");
const state = () => join(tmp, "state");
const rejects = () => join(tmp, "rejects");
const pack = (() => {
  const p = loadSharePack(join(ROOT, "packs"), "waste-incineration");
  if (!p.ok) throw new Error(p.reason);
  return p.pack;
})();

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "moyai-ledger-demo-test-"));
  r = buildLedgerDemo({ repo: ROOT, out: out(), state: state(), month: "2026-11", rejects: rejects() });
}, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("台帳のデモの束", () => {
  it("架空の 10 施設の束を作り、受け手と同じ関数ですべて ✓", () => {
    expect(r.facilities).toHaveLength(10);
    expect(r.read.ledger.status).toBe("ok");
    expect(r.read.ok).toBe(true);
    expect(r.read.bundles.every((b) => b.status === "ok")).toBe(true);
    expect(r.read.ledger.rules!.fields).toEqual(DEMO_FIELDS);
  });

  it("見え方は人の答え（正解の世界の answers）の段 0 で、k は全国の表で数え直した値", () => {
    const worlds = new Map(demoWorlds(ROOT).map((w) => [w.id, w.world]));
    for (const f of r.facilities) {
      const w = worlds.get(f.id)!;
      expect(f.profile).toEqual({ group: "NATIONAL", stage: 0, axes: w.facility.answers });
      expect(f.k).toBeGreaterThanOrEqual(5);
      expect(f.k).toBe(kNational(pack.table, pack.vocab, w.facility.answers, [], 0));
    }
  });

  it("出す台帳には ledger.json と束だけ。秘密鍵・施設の名前・業者の名前・経過年・基幹改良は無い", () => {
    const files = walk(out()).map((p) => relative(out(), p).replace(/\\/g, "/")).sort();
    expect(files.filter((f) => f === `${LEDGER_DIR}/ledger.json`)).toHaveLength(1);
    expect(files.filter((f) => LEDGER_BUNDLE_PATH.test(f))).toHaveLength(10);
    expect(files).toHaveLength(11);
    const all = walk(out()).map((p) => readFileSync(p, "utf8").normalize("NFKC")).join("\n");
    expect(all).not.toContain("PRIVATE KEY");
    expect(all).not.toContain("架空");
    for (const { world } of demoWorlds(ROOT)) {
      const w = world as unknown as { facility: { name: string }; rules: { contractors: { name: string }[] } };
      expect(all).not.toContain(w.facility.name.normalize("NFKC"));
      for (const c of w.rules.contractors) expect(all).not.toContain(c.name.normalize("NFKC"));
    }
    expect(all).not.toContain("ageAtWork");
    expect(all).not.toContain("UPGRADE");
  });

  it("秘密鍵は状態のフォルダにだけある（管理者 1・施設 10・外れた束 3）", () => {
    const keys = readdirSync(join(state(), "keys"));
    expect(keys.filter((k) => k.endsWith(".pem"))).toHaveLength(14);
    for (const k of keys) expect(readFileSync(join(state(), "keys", k), "utf8")).toContain("PRIVATE KEY");
    const m = JSON.parse(readFileSync(join(state(), "manifest.json"), "utf8"));
    expect(m.facilities).toHaveLength(10);
    expect(statSync(join(state(), "manifest.json")).isFile()).toBe(true);
  });

  it("サイトの集計：似た施設 7・2・1 の節に分かれ、x・幅の帯・中央の帯がどれも出る", () => {
    const m = siteModel({ read: r.read, pack });
    expect(m.sections.map((s) => s.aggregate.similar.length)).toEqual([7, 2, 1]);
    const shown = new Set(m.sections.flatMap((s) => s.aggregate.rows.flatMap((row) => Object.values(row.stats).map((c) => c.shown))));
    expect([...shown].sort()).toEqual(["median", "range", "x"]);
    const big = m.sections[0]!.aggregate;
    expect(big.rows.some((row) => row.peers.length >= 3 && row.peers.length <= 4)).toBe(true);
    expect(big.rows.some((row) => row.peers.length <= 2)).toBe(true);
  });

  it("わざと外れた 3 つの束は、それぞれの理由だけで ✗（道と鎖は正しい）", () => {
    const by = Object.fromEntries(r.rejects.map((x) => [x.case, x.reasons]));
    expect(by.kBelow5).toEqual(["k.belowMin"]);
    expect(by.costField).toEqual(expect.arrayContaining(["shape.type", "money", "freeText"]));
    expect(by.facilityName).toEqual(expect.arrayContaining(["shape.type", "freeText"]));
    for (const x of r.rejects) {
      expect(x.reasons.some((y) => y.startsWith("chain.") || y.startsWith("file."))).toBe(false);
      expect(LEDGER_BUNDLE_PATH.exec(x.path)?.[2]).toMatch(/^000001-/);
      const text = readFileSync(join(rejects(), x.case, ...x.path.split("/")), "utf8");
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("出す先にもう台帳があれば作らない（足すだけの台帳を上書きしない）", () => {
    expect(() => buildLedgerDemo({ repo: ROOT, out: out(), state: join(tmp, "state2"), month: "2026-11" })).toThrow();
  });
});
