// Ed25519 の試験の見本：Node の crypto で鍵を作って署名し、公開鍵・文・署名を返す。
// 試験のページが、ブラウザの WebCrypto で同じ署名を検証する（正しい文は ✓、1 文字変えた文は ✗ になるはず）。
// 鍵は毎回作り直し、どこにも残さない。
import { generateKeyPairSync, sign } from "node:crypto";

export interface Ed25519Sample {
  made: "node:crypto";
  nodeVersion: string;
  publicKeyJwk: { kty: "OKP"; crv: "Ed25519"; x: string };
  /** 署名した文（UTF-8 を base64url） */
  message: string;
  /** 1 文字変えた文（検証が ✗ になるはず） */
  tamperedMessage: string;
  signature: string;
}

export function makeEd25519Sample(text = "MOYAI の Ed25519 の試験：署名は Node、検証はブラウザ"): Ed25519Sample {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  const msg = Buffer.from(text, "utf8");
  const tampered = Buffer.from(text.replace("署名", "書名"), "utf8");
  const sig = sign(null, msg, privateKey);
  return {
    made: "node:crypto",
    nodeVersion: process.version,
    publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: String(jwk.x) },
    message: msg.toString("base64url"),
    tamperedMessage: tampered.toString("base64url"),
    signature: sig.toString("base64url"),
  };
}
