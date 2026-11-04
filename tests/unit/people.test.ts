// 人の鍵と覚えた鍵（docs/plan.md §2.18.2）：自分の鍵は合言葉で包んで状態フォルダに置き、作った PC では確認済み。
// ほかの人の鍵は初めて見たとき未確認として覚え、指紋を読み合わせて人が確認済みにするまで承認に数えない。確認済みの呼び名に知らない鍵が出たら「替わった」。
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { confirmKey, countsForApproval, createOwnKey, openOwnKey, ownKeys, trustOf } from "../../src/bridge/people";
import { generateKeyPair, keyIdOf } from "../../src/share/sign";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const state = () => {
  const d = mkdtempSync(join(tmpdir(), "moyai-people-"));
  dirs.push(d);
  return d;
};
const now = new Date("2026-11-04T06:00:00.000Z");
const PASS = "架空の合言葉 人の鍵";

describe("自分の鍵", () => {
  it("作ると合言葉で包んで置き、合言葉で開ける。違う合言葉・無い呼び名は開かない。同じ呼び名の鍵は 2 つ作らない", () => {
    const sd = state();
    expect(createOwnKey(sd, "山田/課長", PASS, now)).toEqual({ ok: false, reason: "nameInvalid" });
    expect(createOwnKey(sd, "【架空】山田", "", now)).toEqual({ ok: false, reason: "passphraseEmpty" });
    const r = createOwnKey(sd, "【架空】山田", PASS, now);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fingerprint).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(createOwnKey(sd, "【架空】山田", PASS, now)).toEqual({ ok: false, reason: "personKeyExists" });
    // 秘密鍵は平文で置かない
    const file = readFileSync(join(sd, "people", "keys", `${r.key}.json`), "utf8");
    expect(file).not.toContain("PRIVATE");
    expect(JSON.parse(file).wrapped.v).toBe("moyai.wrapped-key/0");
    expect(ownKeys(sd).map((k) => [k.by, k.key])).toEqual([["【架空】山田", r.key]]);
    const ok = openOwnKey(sd, "【架空】山田", PASS);
    expect(ok.ok && keyIdOf(ok.pair.pub)).toBe(r.key);
    expect(openOwnKey(sd, "【架空】山田", "違う合言葉")).toEqual({ ok: false, reason: "wrongPassphrase" });
    expect(openOwnKey(sd, "【架空】佐藤", PASS)).toEqual({ ok: false, reason: "personKeyMissing" });
    expect(readdirSync(join(sd, "people"))).toEqual(["keys", "trust.json"]);
  });
});

describe("覚えた鍵", () => {
  it("自分の鍵は own。ほかの人の鍵は初めて見たとき未確認で、確認済みにすると数える。確認済みの呼び名に知らない鍵は「替わった」", () => {
    const sd = state();
    const mine = createOwnKey(sd, "【架空】山田", PASS, now);
    if (!mine.ok) throw new Error(mine.reason);
    const own = ownKeys(sd)[0]!;
    expect(trustOf(sd, { by: own.by, key: own.key, pub: own.pub }, now)).toBe("own");
    const boss = generateKeyPair();
    const sig = { by: "【架空】課長", key: keyIdOf(boss.pub), pub: boss.pub };
    expect(trustOf(sd, sig, now)).toBe("unconfirmed");
    expect(countsForApproval("unconfirmed")).toBe(false);
    expect(confirmKey(sd, sig.key)).toBe(true);
    expect(trustOf(sd, sig, now)).toBe("confirmed");
    expect(countsForApproval("confirmed")).toBe(true);
    // 確認済みの「課長」に、知らない鍵が出てきた
    const fake = generateKeyPair();
    expect(trustOf(sd, { by: "【架空】課長", key: keyIdOf(fake.pub), pub: fake.pub }, now)).toBe("changed");
    expect(countsForApproval("changed")).toBe(false);
    // 覚えた鍵に、別の呼び名で署名してきた
    expect(trustOf(sd, { ...sig, by: "【架空】部長" }, now)).toBe("changed");
    expect(confirmKey(sd, "0".repeat(16))).toBe(false);
  });
});
