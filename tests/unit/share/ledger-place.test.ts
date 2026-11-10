// 台帳の置き場所の設定（config/ledger.json の 1 か所。mushitaro/moyai#20）：道の定数と正規表現は、設定から導く
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEDGER_BUNDLE_PATH, LEDGER_DIR, LEDGER_REPO, LEDGER_ROOT } from "../../../src/share/ledger";
import { LEDGER_PLACE, ledgerPlace } from "../../../src/share/ledger-place";
import { PR_LIMITS } from "../../../src/share/prdiff";

const KEY = "0123456789abcdef";
const NAME = "000001-0123456789abcdef.json";

describe("台帳の置き場所（config/ledger.json）", () => {
  it("台帳の根が MOYAI のリポジトリの ledger/ のとき：決まりと束は ledger/ledger/ の下", () => {
    const p = ledgerPlace({ repo: "ledger-owner/moyai", root: "ledger" });
    expect(p.dir).toBe("ledger/ledger");
    expect(p.pathDepth).toBe(5);
    expect(p.bundlePath.exec(`ledger/ledger/bundles/${KEY}/${NAME}`)?.slice(1)).toEqual([KEY, NAME]);
    expect(p.retiredPath.exec(`ledger/ledger/bundles/${KEY}/retired.json`)?.[1]).toBe(KEY);
    // 別の置き場所の形の道は受けない
    expect(p.bundlePath.test(`ledger/bundles/${KEY}/${NAME}`)).toBe(false);
    expect(p.bundlePath.test(`x/ledger/ledger/bundles/${KEY}/${NAME}`)).toBe(false);
  });

  it("台帳の根がリポジトリの根そのもの（別のリポジトリ）のとき：決まりと束は ledger/ の下", () => {
    const p = ledgerPlace({ repo: "ledger-owner/moyai-ledger", root: "" });
    expect(p.dir).toBe("ledger");
    expect(p.pathDepth).toBe(4);
    expect(p.bundlePath.exec(`ledger/bundles/${KEY}/${NAME}`)?.slice(1)).toEqual([KEY, NAME]);
    expect(p.retiredPath.exec(`ledger/bundles/${KEY}/retired.json`)?.[1]).toBe(KEY);
    expect(p.bundlePath.test(`ledger/ledger/bundles/${KEY}/${NAME}`)).toBe(false);
    expect(p.retiredPath.test(`ledger/bundles/${KEY}/x/retired.json`)).toBe(false);
  });

  it("形の違う設定は投げる（動かす前に止める）", () => {
    for (const repo of ["", "moyai", "a/b/c", "a/..", "-a/b", "a b/c", "https://github.com/a/b"]) expect(() => ledgerPlace({ repo, root: "ledger" }), repo).toThrow();
    for (const root of ["Ledger", "a/b", "../x", ".", "ledger/", "/ledger", "a.b", "a*"]) expect(() => ledgerPlace({ repo: "a/b", root }), root).toThrow();
  });

  it("コードの定数は config/ledger.json から導く。受け口の配置の設定（wrangler.jsonc）のリポジトリも同じ", () => {
    const cfg = JSON.parse(readFileSync("config/ledger.json", "utf8")) as { repo: string; root: string };
    expect(Object.keys(cfg).sort()).toEqual(["repo", "root"]);
    expect([LEDGER_REPO, LEDGER_ROOT, LEDGER_DIR]).toEqual([cfg.repo, cfg.root, ledgerPlace(cfg).dir]);
    expect(LEDGER_BUNDLE_PATH.source).toBe(ledgerPlace(cfg).bundlePath.source);
    expect(PR_LIMITS.pathDepth).toBe(LEDGER_PLACE.pathDepth);
    // wrangler.jsonc は JSON に注釈を足した形。注釈の行を外して読む
    const wrangler = JSON.parse(
      readFileSync("services/ledger-intake/wrangler.jsonc", "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n"),
    ) as { vars: { LEDGER_REPO: string } };
    expect(wrangler.vars.LEDGER_REPO).toBe(cfg.repo);
  });
});
