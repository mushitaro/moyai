// 署名：Ed25519 の鍵の対・署名・検証（Node の crypto）。署名するのは、正規化した body の SHA-256（32 バイト）。
// 秘密鍵は包まずにファイルに置く（運営者の決定 2026-11-04「パスワードは絶対いやです」、docs/plan.md §2.19）。守りは置き場所と見張りのフックに頼る。
// 前の形（パスワードから scrypt で作った鍵で包んだもの）は、人だけの CLI `moyai keys unwrap` が 1 度だけ開いて移すためにだけ読む。
// 指紋は 16 文字（4 文字 × 4 組）。鍵・署名する文をログに出さない。
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import { canonicalize } from "./jcs";

export const HEX64 = /^[0-9a-f]{64}$/;
export const HEX128 = /^[0-9a-f]{128}$/;
export const HEX16 = /^[0-9a-f]{16}$/;

export interface KeyPair {
  /** 公開鍵の生の 32 バイトを 16 進（64 文字） */
  pub: string;
  privateKey: KeyObject;
}

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pub: publicKeyHex(publicKey), privateKey };
}

export function publicKeyHex(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" });
  return Buffer.from(String(jwk.x), "base64url").toString("hex");
}

export function publicKeyFromHex(pub: string): KeyObject {
  if (!HEX64.test(pub)) throw new Error("公開鍵の形でない");
  const x = Buffer.from(pub, "hex").toString("base64url");
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(typeof data === "string" ? Buffer.from(data, "utf8") : data).digest("hex");
}

/** 正規化した body の SHA-256（32 バイト） */
export function bodyDigest(body: unknown): Buffer {
  return createHash("sha256").update(Buffer.from(canonicalize(body), "utf8")).digest();
}

/** body に署名し、署名を 16 進（128 文字）で返す。 */
export function signBody(body: unknown, privateKey: KeyObject): string {
  return edSign(null, bodyDigest(body), privateKey).toString("hex");
}

/** 署名を確かめる。形が違えば false。 */
export function verifyBody(body: unknown, sig: string, pub: string): boolean {
  if (!HEX128.test(sig) || !HEX64.test(pub)) return false;
  try {
    return edVerify(null, bodyDigest(body), publicKeyFromHex(pub), Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}

/** 鍵 ID：公開鍵の SHA-256 の先頭 16 文字（16 進）。フォルダの名前に使う。 */
export function keyIdOf(pub: string): string {
  return sha256Hex(Buffer.from(pub, "hex")).slice(0, 16);
}

// 読み違えやすい I・L・O・U を除いた 32 文字
const FP_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 指紋：公開鍵の SHA-256 の先頭 80 ビットを 32 文字で 16 文字にし、4 文字 × 4 組で返す（電話で読み合わせる）。 */
export function fingerprint(pub: string): string {
  const d = createHash("sha256").update(Buffer.from(pub, "hex")).digest();
  let bits = 0;
  let acc = 0;
  let out = "";
  for (let i = 0; i < 10; i++) {
    acc = (acc << 8) | d[i]!;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += FP_ALPHABET[(acc >> bits) & 31]!;
    }
    acc &= (1 << bits) - 1;
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

// ─── 秘密鍵のファイル ──────────────────────────────────────

/** 包まない秘密鍵（PKCS#8 の DER を 16 進）。公開鍵を添え、開くと照らし合わせる */
export interface PlainKey {
  v: "moyai.key/1";
  pub: string;
  pkcs8: string;
}

export function toPlainKey(pair: KeyPair): PlainKey {
  return { v: "moyai.key/1", pub: pair.pub, pkcs8: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("hex") };
}

export function isPlainKey(x: unknown): x is PlainKey {
  const k = x as PlainKey | null;
  return !!k && k.v === "moyai.key/1" && HEX64.test(k.pub) && typeof k.pkcs8 === "string" && /^[0-9a-f]+$/.test(k.pkcs8);
}

/** 包まない秘密鍵を開く。形が違うか、添えた公開鍵と合わなければ null */
export function openPlainKey(k: PlainKey): KeyPair | null {
  if (!isPlainKey(k)) return null;
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(k.pkcs8, "hex"), format: "der", type: "pkcs8" });
    const pub = publicKeyHex(createPublicKey(privateKey));
    return pub === k.pub ? { pub, privateKey } : null;
  } catch {
    return null;
  }
}

/** 鍵のファイルの中身：包まない鍵か、前の形（パスワードで包んだ鍵） */
export type KeyFile = PlainKey | WrappedKey;

export function isWrappedKey(x: unknown): x is WrappedKey {
  const w = x as WrappedKey | null;
  return !!w && w.v === "moyai.wrapped-key/0" && HEX64.test(w.pub);
}

/** 署名に使えるように開く。前の形なら "old"（人が `moyai keys unwrap` で移すまで使わない）、壊れていれば null */
export function openKeyFile(f: KeyFile): KeyPair | "old" | null {
  if (isWrappedKey(f)) return "old";
  return openPlainKey(f);
}

// ─── 前の形：パスワードで包んだ秘密鍵（移すときにだけ開く） ──────────────

/** scrypt の重さは固定（ファイルの値で軽くさせない）。N=2^15・r=8・p=1、鍵は 32 バイト。 */
export const SCRYPT = { N: 32768, r: 8, p: 1, keyLen: 32, maxmem: 64 * 1024 * 1024 } as const;

export interface WrappedKey {
  v: "moyai.wrapped-key/0";
  pub: string;
  salt: string;
  iv: string;
  ct: string;
  tag: string;
}

export class WrongPassphrase extends Error {
  constructor() {
    super("パスワードが合わない");
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length === 0) throw new Error("パスワードが空");
  return scryptSync(passphrase.normalize("NFC"), salt, SCRYPT.keyLen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
}

/** 秘密鍵をパスワードで包む。公開鍵は包まずに添える（開くと照らし合わせる）。 */
export function wrapPrivateKey(pair: KeyPair, passphrase: string): WrappedKey {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const der = pair.privateKey.export({ format: "der", type: "pkcs8" });
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(pair.pub, "utf8"));
  const ct = Buffer.concat([c.update(der), c.final()]);
  return {
    v: "moyai.wrapped-key/0",
    pub: pair.pub,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    ct: ct.toString("hex"),
    tag: c.getAuthTag().toString("hex"),
  };
}

/** 包んだ秘密鍵を開く。パスワードが違うか、ファイルが変わっていれば WrongPassphrase。 */
export function unwrapPrivateKey(w: WrappedKey, passphrase: string): KeyPair {
  if (w.v !== "moyai.wrapped-key/0" || !HEX64.test(w.pub)) throw new Error("包んだ鍵の形でない");
  const key = deriveKey(passphrase, Buffer.from(w.salt, "hex"));
  let der: Buffer;
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(w.iv, "hex"));
    d.setAAD(Buffer.from(w.pub, "utf8"));
    d.setAuthTag(Buffer.from(w.tag, "hex"));
    der = Buffer.concat([d.update(Buffer.from(w.ct, "hex")), d.final()]);
  } catch {
    throw new WrongPassphrase();
  }
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const pub = publicKeyHex(createPublicKey(privateKey));
  if (pub !== w.pub) throw new WrongPassphrase();
  return { pub, privateKey };
}
