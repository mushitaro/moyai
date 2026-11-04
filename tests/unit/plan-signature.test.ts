// 版の署名（docs/plan.md §2.18.2）：署名する文に役目と理由まで入る。書き換え・鍵の差し替え・形の外れは確かめで落ちる。
import { describe, expect, it } from "vitest";
import { contentHash, personFile, showContentHash, signStatement, signatureFileName, SIGNATURE_FILE, verifyPersonFile, verifySignatureFile, validName } from "../../src/plan/signature";
import { generateKeyPair } from "../../src/share/sign";

const pair = generateKeyPair();
const other = generateKeyPair();
const base = { planId: "p-1", version: 3, contentHash: contentHash({ a: 1 }), role: "confirm" as const, by: "【架空】山田", at: "2026-11-04T03:00:00.000Z", reason: "第 3 版を確定する" };

describe("版の署名", () => {
  it("署名して確かめられる。中身のハッシュは JCS の SHA-256 で、キーの順に依らない", () => {
    expect(contentHash({ b: 2, a: 1 })).toBe(contentHash({ a: 1, b: 2 }));
    expect(showContentHash("0123456789abcdef".repeat(4))).toBe("0123 4567  89ab cdef  0123 4567  89ab cdef");
    const f = signStatement(base, pair);
    expect(verifySignatureFile(f)).toBe(true);
    expect(f.statement.key).toMatch(/^[0-9a-f]{16}$/);
  });

  it("役目・理由・呼び名・中身のハッシュのどれを書き換えても、確かめで落ちる", () => {
    const f = signStatement(base, pair);
    for (const patch of [{ role: "approve" }, { reason: "別の理由" }, { by: "【架空】佐藤" }, { contentHash: contentHash({ a: 2 }) }, { version: 4 }]) {
      expect(verifySignatureFile({ ...f, statement: { ...f.statement, ...patch } }), JSON.stringify(patch)).toBe(false);
    }
  });

  it("ほかの鍵に差し替える・知らない欄を足す・形の外れは落ちる", () => {
    const f = signStatement(base, pair);
    expect(verifySignatureFile({ ...f, pub: other.pub })).toBe(false);
    expect(verifySignatureFile({ ...f, statement: { ...f.statement, extra: 1 } })).toBe(false);
    expect(verifySignatureFile({ ...f, sig: "00" })).toBe(false);
    expect(verifySignatureFile(null)).toBe(false);
  });

  it("差し戻しは理由が空なら署名しない", () => {
    expect(() => signStatement({ ...base, role: "return", reason: " " }, pair)).toThrow();
    expect(verifySignatureFile(signStatement({ ...base, role: "return", reason: "工数の欄を見直して" }, pair))).toBe(true);
  });

  it("人のファイルは自分の鍵で署名し、呼び名を書き換えると落ちる。呼び名の形", () => {
    const p = personFile("【架空】山田", pair, base.at);
    expect(verifyPersonFile(p)).toBe(true);
    expect(verifyPersonFile({ ...p, by: "【架空】佐藤" })).toBe(false);
    expect(verifyPersonFile({ ...p, pub: other.pub })).toBe(false);
    for (const bad of ["", " 山田", "山田/課長", "a".repeat(41)]) expect(validName(bad), bad).toBe(false);
  });

  it("署名のファイルの名前", () => {
    const n = signatureFileName(3, "approve", "0123456789abcdef");
    expect(n).toBe("000003-approve-0123456789abcdef.json");
    expect(SIGNATURE_FILE.exec(n)?.slice(1)).toEqual(["000003", "approve", "0123456789abcdef"]);
  });
});
