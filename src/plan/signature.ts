// 版の署名（docs/plan.md §2.18.2）：確定・承認・差し戻しは、人が合言葉で開く自分の鍵の署名でする。AI に鍵も合言葉も渡らない。
// 署名する文は { schema, planId, version, contentHash, role, by, key, at, reason } の JCS。役目と理由も署名の中に入れ、書き換えに気づけるようにする。
// 署名は版ごとに別のファイル（保管先の plans/<計画ID>/signatures/<版>-<役目>-<鍵ID>.json、wx）に置き、版の記録は書き直さない。
// 人の公開鍵と呼び名は保管先の people/<鍵ID>.json に置くが、そこは書ける人なら誰でも置けるので、信じる元にはしない（信じるのは各 PC が覚えた鍵。橋渡しの people-trust）。
import { canonicalize } from "../share/jcs";
import { HEX64, HEX128, keyIdOf, sha256Hex, signBody, verifyBody, type KeyPair } from "../share/sign";

export const SIGNATURE_SCHEMA = "moyai.signature/0";
export const PERSON_SCHEMA = "moyai.person/0";

/** 署名の役目：自分で確定・編集を頼んで渡す・承認・差し戻し（理由は必須）・前の版に戻す */
export const SIGN_ROLES = ["confirm", "edit", "approve", "return", "revert"] as const;
export type SignRole = (typeof SIGN_ROLES)[number];

/** 呼び名：画面と署名に出す名前（40 文字まで。前後の空白と、道の区切り・制御の文字は使えない） */
export const PERSON_NAME = /^[^\s\\/:*?"<>|\x00-\x1f][^\\/:*?"<>|\x00-\x1f]{0,39}$/u;
export const validName = (s: string) => PERSON_NAME.test(s) && s.trim() === s;

export interface Statement {
  schema: typeof SIGNATURE_SCHEMA;
  planId: string;
  version: number;
  /** 版の記録の JCS の SHA-256 */
  contentHash: string;
  role: SignRole;
  /** 署名した人の呼び名 */
  by: string;
  /** 鍵 ID（公開鍵の SHA-256 の先頭 16 文字） */
  key: string;
  at: string;
  reason: string;
}

export interface SignatureFile {
  statement: Statement;
  /** 公開鍵（16 進 64 文字）。鍵 ID と合うことを確かめる */
  pub: string;
  sig: string;
}

/** 保管先の people/<鍵ID>.json：呼び名と公開鍵を、その鍵で自分に署名したもの（呼び名の取り違えに気づくため。信じる元ではない） */
export interface PersonFile {
  schema: typeof PERSON_SCHEMA;
  by: string;
  pub: string;
  at: string;
  sig: string;
}

/** 版の記録の中身のハッシュ（JCS の SHA-256）。画面の「4 文字 × 2 組を 4 つ」はこれ */
export function contentHash(record: unknown): string {
  return sha256Hex(canonicalize(record));
}

/** 中身のハッシュの見せ方：4 文字 × 2 組を 4 つ（先頭 32 文字） */
export function showContentHash(h: string): string {
  const s = h.slice(0, 32);
  const groups: string[] = [];
  for (let i = 0; i < 32; i += 8) groups.push(`${s.slice(i, i + 4)} ${s.slice(i + 4, i + 8)}`);
  return groups.join("  ");
}

export function signStatement(s: Omit<Statement, "schema" | "key">, pair: KeyPair): SignatureFile {
  if (!validName(s.by)) throw new Error("呼び名の形でない");
  if (s.role === "return" && s.reason.trim().length === 0) throw new Error("差し戻しの理由が空");
  const statement: Statement = { schema: SIGNATURE_SCHEMA, ...s, key: keyIdOf(pair.pub) };
  return { statement, pub: pair.pub, sig: signBody(statement, pair.privateKey) };
}

/** 署名のファイルの形と、署名そのものを確かめる（鍵を信じるかは別。呼ぶ側が覚えた鍵と照らす） */
export function verifySignatureFile(f: unknown): f is SignatureFile {
  if (!f || typeof f !== "object") return false;
  const { statement: s, pub, sig } = f as Partial<SignatureFile>;
  if (!s || typeof pub !== "string" || typeof sig !== "string" || !HEX64.test(pub) || !HEX128.test(sig)) return false;
  const keys = Object.keys(s).sort().join(",");
  if (keys !== "at,by,contentHash,key,planId,reason,role,schema,version") return false;
  if (s.schema !== SIGNATURE_SCHEMA || !SIGN_ROLES.includes(s.role as SignRole) || typeof s.by !== "string" || !validName(s.by)) return false;
  if (typeof s.contentHash !== "string" || !HEX64.test(s.contentHash) || !Number.isInteger(s.version) || typeof s.reason !== "string") return false;
  if (s.key !== keyIdOf(pub)) return false;
  if (s.role === "return" && s.reason.trim().length === 0) return false;
  return verifyBody(s, sig, pub);
}

export function personFile(by: string, pair: KeyPair, at: string): PersonFile {
  if (!validName(by)) throw new Error("呼び名の形でない");
  const body = { schema: PERSON_SCHEMA as typeof PERSON_SCHEMA, by, pub: pair.pub, at };
  return { ...body, sig: signBody(body, pair.privateKey) };
}

export function verifyPersonFile(f: unknown): f is PersonFile {
  if (!f || typeof f !== "object") return false;
  const p = f as Partial<PersonFile>;
  if (p.schema !== PERSON_SCHEMA || typeof p.by !== "string" || !validName(p.by) || typeof p.pub !== "string" || !HEX64.test(p.pub) || typeof p.at !== "string" || typeof p.sig !== "string") return false;
  if (Object.keys(p).sort().join(",") !== "at,by,pub,schema,sig") return false;
  return verifyBody({ schema: p.schema, by: p.by, pub: p.pub, at: p.at }, p.sig, p.pub);
}

/** 署名のファイルの名前：<版 6 桁>-<役目>-<鍵ID>.json */
export function signatureFileName(version: number, role: SignRole, keyId: string): string {
  return `${String(version).padStart(6, "0")}-${role}-${keyId}.json`;
}
export const SIGNATURE_FILE = /^(\d{6})-(confirm|edit|approve|return|revert)-([0-9a-f]{16})\.json$/;
