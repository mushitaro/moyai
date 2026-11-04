// 人の鍵と覚えた鍵（docs/plan.md §2.18.2）：自分の鍵は包まずに状態フォルダに置き（合言葉はやめた。§2.19）、作った PC では確認済み。
// 前の形（合言葉で包んだ鍵）は署名に使わず、人だけの CLI `moyai keys unwrap` が前の合言葉で 1 度だけ開いて移す。
// ほかの人の鍵は初めて見たとき未確認として覚え、指紋を読み合わせて人が確認済みにするまで承認に数えない。確認済みの呼び名に知らない鍵が出たら「替わった」。
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { confirmKey, countsForApproval, createOwnKey, openOwnKey, ownKeys, trustOf } from "../../src/bridge/people";
import { unwrapCli } from "../../src/cli/human";
import { generateKeyPair, keyIdOf, wrapPrivateKey } from "../../src/share/sign";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const state = () => {
  const d = mkdtempSync(join(tmpdir(), "moyai-people-"));
  dirs.push(d);
  return d;
};
const now = new Date("2026-11-04T06:00:00.000Z");
const OLD_PASS = "架空の前の合言葉 人の鍵";

describe("自分の鍵", () => {
  it("作ると包まずに置き、合言葉なしで開ける。無い呼び名は開かない。同じ呼び名の鍵は 2 つ作らない", () => {
    const sd = state();
    expect(createOwnKey(sd, "山田/課長", now)).toEqual({ ok: false, reason: "nameInvalid" });
    const r = createOwnKey(sd, "【架空】山田", now);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fingerprint).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(createOwnKey(sd, "【架空】山田", now)).toEqual({ ok: false, reason: "personKeyExists" });
    const file = JSON.parse(readFileSync(join(sd, "people", "keys", `${r.key}.json`), "utf8"));
    expect(file.v).toBe("moyai.own-key/1");
    expect(file.key.v).toBe("moyai.key/1");
    expect(ownKeys(sd).map((k) => [k.by, k.key, k.old])).toEqual([["【架空】山田", r.key, false]]);
    const ok = openOwnKey(sd, "【架空】山田");
    expect(ok.ok && keyIdOf(ok.pair.pub)).toBe(r.key);
    expect(openOwnKey(sd, "【架空】佐藤")).toEqual({ ok: false, reason: "personKeyMissing" });
    expect(readdirSync(join(sd, "people"))).toEqual(["keys", "trust.json"]);
  });

  it("前の形（合言葉で包んだ鍵）は署名に使わず oldKey。keys unwrap が前の合言葉で 1 度だけ開いて、同じ鍵の包まない形に置き換える", async () => {
    const sd = state();
    const pair = generateKeyPair();
    const key = keyIdOf(pair.pub);
    mkdirSync(join(sd, "people", "keys"), { recursive: true });
    writeFileSync(join(sd, "people", "keys", `${key}.json`), JSON.stringify({ v: "moyai.own-key/0", by: "【架空】山田", wrapped: wrapPrivateKey(pair, OLD_PASS) }));
    expect(ownKeys(sd).map((k) => [k.key, k.old])).toEqual([[key, true]]);
    expect(openOwnKey(sd, "【架空】山田")).toEqual({ ok: false, reason: "oldKey" });
    // 端末でなければ断る
    expect(await unwrapCli({ stdin: { isTTY: false }, stateDir: sd, ask: async () => OLD_PASS })).toBe(3);
    // 違う合言葉のあと、正しい合言葉
    const answers = ["違う合言葉", OLD_PASS];
    expect(await unwrapCli({ stdin: { isTTY: true }, stateDir: sd, ask: async () => answers.shift() ?? null })).toBe(0);
    expect(ownKeys(sd).map((k) => [k.key, k.old])).toEqual([[key, false]]);
    const ok = openOwnKey(sd, "【架空】山田");
    expect(ok.ok && ok.pair.pub).toBe(pair.pub);
    // 移したあとは、前の形の鍵は無い
    expect(await unwrapCli({ stdin: { isTTY: true }, stateDir: sd, ask: async () => null })).toBe(0);
  });
});

describe("覚えた鍵", () => {
  it("自分の鍵は own。ほかの人の鍵は初めて見たとき未確認で、確認済みにすると数える。確認済みの呼び名に知らない鍵は「替わった」", () => {
    const sd = state();
    const mine = createOwnKey(sd, "【架空】山田", now);
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
