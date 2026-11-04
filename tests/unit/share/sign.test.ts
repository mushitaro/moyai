// 署名：鍵の対・署名・検証・包まない鍵のファイル・前の形（合言葉で包んだ鍵。移すときにだけ開く）・指紋。
import { createHash, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../../../src/share/jcs";
import {
  WrongPassphrase,
  fingerprint,
  generateKeyPair,
  keyIdOf,
  openKeyFile,
  openPlainKey,
  publicKeyFromHex,
  signBody,
  toPlainKey,
  unwrapPrivateKey,
  verifyBody,
  wrapPrivateKey,
} from "../../../src/share/sign";

describe("sign", () => {
  const pair = generateKeyPair();
  const body = { b: 2, a: [1, "x"] };

  it("正規化した body の SHA-256 に Ed25519 で署名する", () => {
    const sig = signBody(body, pair.privateKey);
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyBody(body, sig, pair.pub)).toBe(true);
    // キーの順が違っても同じ body
    expect(verifyBody({ a: [1, "x"], b: 2 }, sig, pair.pub)).toBe(true);
    // 署名したのは SHA-256 の 32 バイト
    const digest = createHash("sha256").update(canonicalize(body), "utf8").digest();
    expect(verify(null, digest, publicKeyFromHex(pair.pub), Buffer.from(sig, "hex"))).toBe(true);
  });

  it("中身・署名・鍵が違えば ✗", () => {
    const sig = signBody(body, pair.privateKey);
    expect(verifyBody({ ...body, b: 3 }, sig, pair.pub)).toBe(false);
    const flipped = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    expect(verifyBody(body, flipped, pair.pub)).toBe(false);
    expect(verifyBody(body, sig, generateKeyPair().pub)).toBe(false);
    expect(verifyBody(body, "xyz", pair.pub)).toBe(false);
  });

  it("包まない鍵のファイル：開くと同じ鍵。添えた公開鍵と違えば・壊れていれば開かない。前の形は old", () => {
    const k = toPlainKey(pair);
    expect(k.v).toBe("moyai.key/1");
    const back = openPlainKey(k);
    expect(back?.pub).toBe(pair.pub);
    expect(verifyBody(body, signBody(body, back!.privateKey), pair.pub)).toBe(true);
    expect(openPlainKey({ ...k, pub: generateKeyPair().pub })).toBeNull();
    expect(openPlainKey({ ...k, pkcs8: "00" })).toBeNull();
    expect(openKeyFile(k)?.toString()).not.toBe("old");
    expect(openKeyFile(wrapPrivateKey(pair, "架空の前の合言葉"))).toBe("old");
  });

  it("前の形：合言葉で包み、同じ合言葉で開ける。違う合言葉と書き換えは WrongPassphrase（keys unwrap が移すときにだけ使う）", () => {
    const w = wrapPrivateKey(pair, "架空の合言葉");
    expect(JSON.stringify(w)).not.toContain("架空の合言葉");
    const back = unwrapPrivateKey(w, "架空の合言葉");
    expect(back.pub).toBe(pair.pub);
    expect(verifyBody(body, signBody(body, back.privateKey), pair.pub)).toBe(true);
    expect(() => unwrapPrivateKey(w, "ちがう合言葉")).toThrow(WrongPassphrase);
    const ct = w.ct;
    const tampered = { ...w, ct: (ct[0] === "0" ? "1" : "0") + ct.slice(1) };
    expect(() => unwrapPrivateKey(tampered, "架空の合言葉")).toThrow(WrongPassphrase);
    expect(() => unwrapPrivateKey({ ...w, pub: generateKeyPair().pub }, "架空の合言葉")).toThrow(WrongPassphrase);
  });

  it("指紋は 16 文字（4 文字 × 4 組）で、同じ鍵なら同じ。鍵 ID は 16 進 16 文字", () => {
    const fp = fingerprint(pair.pub);
    expect(fp).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(fingerprint(pair.pub)).toBe(fp);
    expect(fingerprint(generateKeyPair().pub)).not.toBe(fp);
    expect(keyIdOf(pair.pub)).toMatch(/^[0-9a-f]{16}$/);
  });
});
