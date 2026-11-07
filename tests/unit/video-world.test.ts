// 動画の撮り直し用の世界（docs/plan.md §2.19 の版の履歴と署名。video/world/）：
// 版の履歴の台本が、空の保管先に 3 つの版と 1 本の枝を作ること。本物の保管先を指すと断ること。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { checkStore } from "../../video/world/guard.mjs";
import { HOTARU_ID, SATO, SHIRAKABA_ID, SKILL, YAMADA, makeHistory } from "../../video/world/history-core";
import { readHistory, readPlanVersion } from "../../src/plan/store";
import { readTurn } from "../../src/plan/turn";
import { listReadings, approvedReadingVersions } from "../../src/bridge/readings";

const REPO = process.cwd();
const NOW = new Date("2026-11-08T00:00:00Z");
const made: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

/** 保管先の下の全ファイルの文字（JSON と文字のファイルだけ） */
function allText(dir: string): string {
  let s = "";
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) s += allText(p);
    else if (/\.(json|md)$/.test(n)) s += readFileSync(p, "utf8");
  }
  return s;
}

describe("資料", () => {
  test("3 つの資料と正解の世界が video/world/hotarugawa/ にあり、packs/ のデモの資料と別", () => {
    for (const n of ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv", "world.truth.json"]) {
      expect(statSync(join(REPO, "video/world/hotarugawa", n)).size, n).toBeGreaterThan(1000);
    }
    expect(existsSync(join(REPO, "packs/waste-incineration/demo/equipment-ledger.xlsx"))).toBe(true);
    const w = JSON.parse(readFileSync(join(REPO, "video/world/hotarugawa/world.truth.json"), "utf8"));
    expect(w.facility.name).toBe("【架空】ほたる川クリーンセンター");
    expect(w.fiscal_years).toEqual([2024, 2025, 2026]);
  });
});

describe("版の履歴の台本", () => {
  test("空の保管先に、令和 6・7 年度版（署名・承認済み）、令和 8 年度版（承認待ち）、しらかば野への枝 1 本を作る", async () => {
    const store = join(tmp("moyai-vw-"), "保管先");
    expect(checkStore(store)).toEqual({ ok: true, path: store });
    const mailOut = join(tmp("moyai-vw-mail-"), "mail.txt");
    const r = await makeHistory({ repo: REPO, store, now: NOW, mailOut });

    const h = await readHistory(store, HOTARU_ID);
    expect(h.versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(h.versions.every((v) => v.problem === null && !v.legacy)).toBe(true);
    const roles = (n: number) => h.versions[n - 1]!.signatures.map((s) => `${s.role}:${s.by}`).sort();
    expect(roles(1)).toEqual([`approve:${YAMADA}`, `edit:${SATO}`]);
    expect(roles(2)).toEqual([`approve:${YAMADA}`, `edit:${SATO}`]);
    expect(roles(3)).toEqual([`edit:${SATO}`]);
    expect((await readTurn(store, HOTARU_ID))?.state).toBe("awaitingApproval");
    expect((await readTurn(store, HOTARU_ID))?.to).toBe("yamada@example.jp");
    expect(r.hotaru.versions.map((v) => v.state)).toEqual(["approved", "approved", "awaiting"]);
    // 版ごとに中身が違う（令和 6・7・8 年度の分が積まれる）
    const fys = [];
    for (const n of [1, 2, 3]) {
      const pv = await readPlanVersion(store, HOTARU_ID, n);
      if (!pv.ok) throw new Error(pv.reason);
      fys.push(Math.max(...pv.record.plan.details.map((d) => d.fiscalYear)));
    }
    expect(fys).toEqual([2024, 2025, 2026]);

    // 枝：しらかば野は、ほたる川の第 2 版から派生した第 1 版
    const b = await readHistory(store, SHIRAKABA_ID);
    expect(b.versions.map((v) => v.version)).toEqual([1]);
    expect(b.versions[0]!.problem).toBeNull();
    expect(b.derivedFrom).toEqual({ planId: HOTARU_ID, version: 2, contentHash: h.versions[1]!.contentHash });
    expect(b.latest?.plan.displayName).toBe("【架空】しらかば野クリーンセンター");
    expect(b.latest?.plan.facility.name).toContain("しらかば野");

    // 3 段目の Skill：会社の読み方として置かれ、ほたる川の第 2 版としらかば野の第 1 版が使う。承認済み（署名した版が使った）
    expect(h.latest?.readingSkills ?? []).toEqual([]);
    const v2 = JSON.parse(readFileSync(join(store, "plans", HOTARU_ID, "versions", "000002.json"), "utf8"));
    expect(v2.readingSkills).toHaveLength(1);
    expect(b.latest?.readingSkills).toEqual(v2.readingSkills);
    expect(v2.readingSkills[0].name).toBe(SKILL.name);
    const list = await listReadings(store, await approvedReadingVersions(store, () => true));
    expect(list.map((x) => [x.name, x.scope, x.approved])).toEqual([[SKILL.name, "company", true]]);

    // 承認待ちのメールの文（宛先は example.jp の架空）
    const mail = readFileSync(mailOut, "utf8");
    expect(mail).toContain("宛先：yamada@example.jp");
    expect(mail).toContain("&v=3&");

    // この世界に、前のコピーの名前を出さない
    const text = allText(store);
    for (const w of ["みどり台", "東山", "kacho@", "fictional-1"]) expect(text).not.toContain(w);
    // 鍵は走らせるたびに作る架空の鍵だけ。秘密鍵は書かない
    expect(text).not.toMatch(/PRIVATE KEY/);
    expect(readdirSync(join(store, "people"))).toHaveLength(2);
  }, 120_000);

  test("もう一度走らせると別の鍵になる（鍵を固定の値にしない）", async () => {
    const a = join(tmp("moyai-vw-"), "a");
    const b = join(tmp("moyai-vw-"), "b");
    await makeHistory({ repo: REPO, store: a, now: NOW });
    await makeHistory({ repo: REPO, store: b, now: NOW });
    expect(readdirSync(join(a, "people")).sort()).not.toEqual(readdirSync(join(b, "people")).sort());
  }, 120_000);
});

describe("本物の保管先を指すと断る", () => {
  function realStore() {
    const state = tmp("moyai-vw-state-");
    const real = join(tmp("moyai-vw-real-"), "運営者の保管先");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(state, "settings.json"), JSON.stringify({ v: 1, root: real, ledger: null, name: null }));
    return { state, real };
  }
  const env = (state: string) => ({ ...process.env, MOYAI_STATE_DIR: state });

  test("状態フォルダの設定の保管先（同じ・中・外）", () => {
    const { state, real } = realStore();
    for (const p of [real, join(real, "新しい"), join(real, "..")]) {
      const r = checkStore(p, { env: env(state) });
      expect(r.ok, p).toBe(false);
    }
  });

  test("MOYAI という名前のフォルダの下（既定の保管先の形）", () => {
    const state = tmp("moyai-vw-state-");
    const p = join(tmp("moyai-vw-docs-"), "OneDrive", "ドキュメント", "MOYAI");
    expect(checkStore(p, { env: env(state) }).ok).toBe(false);
    expect(checkStore(join(p, "plans"), { env: env(state) }).ok).toBe(false);
  });

  test("空でない・状態フォルダ・相対の道は断る。空のフォルダと無いフォルダは通す", () => {
    const state = tmp("moyai-vw-state-");
    const full = tmp("moyai-vw-full-");
    writeFileSync(join(full, "x.txt"), "x");
    expect(checkStore(full, { env: env(state) }).ok).toBe(false);
    expect(checkStore(state, { env: env(state) }).ok).toBe(false);
    expect(checkStore(join(state, "store"), { env: env(state) }).ok).toBe(false);
    expect(checkStore("相対/道", { env: env(state) }).ok).toBe(false);
    expect(checkStore(undefined, { env: env(state) }).ok).toBe(false);
    const empty = tmp("moyai-vw-empty-");
    expect(checkStore(empty, { env: env(state) }).ok).toBe(true);
    expect(checkStore(join(empty, "まだ無い"), { env: env(state) }).ok).toBe(true);
  });

  test("台本そのもの：本物の保管先を渡すと、終了コード 3 で何も書かずに断る。上書きの旗は無い", () => {
    const { state, real } = realStore();
    const run = (args: string[]) => spawnSync(process.execPath, ["video/world/make-history.mjs", ...args], { cwd: REPO, env: env(state), encoding: "utf8" });
    const r = run(["--store", real]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("断った");
    expect(readdirSync(real)).toEqual([]);
    const r2 = run(["--store", join(real, "新しい")]);
    expect(r2.status).toBe(3);
    expect(existsSync(join(real, "新しい"))).toBe(false);
    // 断る旗は無い：知らない旗は使い方を出して 2 で終わる
    const r3 = run(["--store", real, "--force", "1"]);
    expect(r3.status).toBe(2);
    expect(readdirSync(real)).toEqual([]);
    // 保管先を渡さない
    expect(run([]).status).toBe(3);
  });

  test("台本そのもの：空の保管先なら通って作る（本体の Vite の SSR を通る入口）", () => {
    const state = tmp("moyai-vw-state-");
    const store = join(tmp("moyai-vw-cli-"), "store");
    const r = spawnSync(process.execPath, ["video/world/make-history.mjs", "--store", store, "--now", NOW.toISOString()], { cwd: REPO, env: env(state), encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(join(store, "plans")).sort()).toEqual([HOTARU_ID, SHIRAKABA_ID]);
    // 二度目は、空でないので断る
    const again = spawnSync(process.execPath, ["video/world/make-history.mjs", "--store", store], { cwd: REPO, env: env(state), encoding: "utf8" });
    expect(again.status).toBe(3);
  }, 180_000);
});
