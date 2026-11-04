// 人の鍵と、覚えた鍵（docs/plan.md §2.18.2）。どちらも状態フォルダ（同期されない場所）に置く。
//   people/keys/<鍵ID>.json   自分の鍵：呼び名と、合言葉で包んだ秘密鍵。1 人の呼び名に鍵を 1 つ以上（PC を替えた・鍵を失ったときに足す）
//   people/trust.json         覚えた鍵：呼び名 → 鍵（公開鍵・初めて見た時刻・確認済みか）。保管先の people/ は書ける人なら誰でも置けるので、信じる元はここだけ
// 自分の鍵はこの PC で作ったので、作ったときから確認済み。ほかの人の鍵は、指紋 16 文字を読み合わせて人が確認済みにするまで「未確認」。
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validName } from "../plan/signature";
import { fingerprint, generateKeyPair, keyIdOf, unwrapPrivateKey, wrapPrivateKey, WrongPassphrase, type KeyPair, type WrappedKey } from "../share/sign";
import { readJson, writeJson } from "./places";

const KEYS = join("people", "keys");
const TRUST = join("people", "trust.json");

interface OwnKeyFile {
  v: "moyai.own-key/0";
  by: string;
  wrapped: WrappedKey;
}

export interface TrustEntry {
  by: string;
  key: string;
  pub: string;
  firstSeen: string;
  confirmed: boolean;
  own: boolean;
}

/** 署名の鍵の信じ方：自分の鍵・確認済み・未確認・覚えた呼び名と違う鍵（替わった） */
export type Trust = "own" | "confirmed" | "unconfirmed" | "changed";

export function ownKeys(stateDir: string): { by: string; key: string; pub: string; fingerprint: string }[] {
  const dir = join(stateDir, KEYS);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^[0-9a-f]{16}\.json$/.test(n))
    .map((n) => readJson<OwnKeyFile>(join(dir, n)))
    .filter((f): f is OwnKeyFile => !!f && f.v === "moyai.own-key/0" && validName(f.by))
    .map((f) => ({ by: f.by, key: keyIdOf(f.wrapped.pub), pub: f.wrapped.pub, fingerprint: fingerprint(f.wrapped.pub) }));
}

function readTrust(stateDir: string): TrustEntry[] {
  const t = readJson<{ v?: number; entries?: TrustEntry[] }>(join(stateDir, TRUST));
  return Array.isArray(t?.entries) ? t!.entries.filter((e) => validName(e.by) && /^[0-9a-f]{16}$/.test(e.key)) : [];
}

function writeTrust(stateDir: string, entries: TrustEntry[]): void {
  writeJson(stateDir, TRUST, { v: 1, entries });
}

export type CreateKey = { ok: true; key: string; fingerprint: string } | { ok: false; reason: "nameInvalid" | "passphraseEmpty" | "personKeyExists" };

/** 自分の鍵を作る（人だけの経路）。この PC に同じ呼び名の鍵があれば作らない（作り直しは鍵を足す道で、会期中は未実装） */
export function createOwnKey(stateDir: string, by: string, passphrase: string, now: Date): CreateKey {
  if (!validName(by)) return { ok: false, reason: "nameInvalid" };
  if (passphrase.length === 0) return { ok: false, reason: "passphraseEmpty" };
  if (ownKeys(stateDir).some((k) => k.by === by)) return { ok: false, reason: "personKeyExists" };
  const pair = generateKeyPair();
  const key = keyIdOf(pair.pub);
  writeJson(stateDir, join(KEYS, `${key}.json`), { v: "moyai.own-key/0", by, wrapped: wrapPrivateKey(pair, passphrase) } satisfies OwnKeyFile);
  writeTrust(stateDir, [...readTrust(stateDir), { by, key, pub: pair.pub, firstSeen: now.toISOString(), confirmed: true, own: true }]);
  return { ok: true, key, fingerprint: fingerprint(pair.pub) };
}

export type OpenKey = { ok: true; pair: KeyPair } | { ok: false; reason: "personKeyMissing" | "wrongPassphrase" };

/** 自分の鍵を合言葉で開く。開いた鍵は署名にだけ使い、すぐ捨てる（呼ぶ側が持ち続けない） */
export function openOwnKey(stateDir: string, by: string, passphrase: string): OpenKey {
  const k = ownKeys(stateDir).find((x) => x.by === by);
  if (!k) return { ok: false, reason: "personKeyMissing" };
  const f = readJson<OwnKeyFile>(join(stateDir, KEYS, `${k.key}.json`));
  if (!f) return { ok: false, reason: "personKeyMissing" };
  try {
    return { ok: true, pair: unwrapPrivateKey(f.wrapped, passphrase) };
  } catch (e) {
    if (e instanceof WrongPassphrase) return { ok: false, reason: "wrongPassphrase" };
    throw e;
  }
}

/** 署名の鍵を、覚えた鍵と照らす。初めて見た鍵は未確認として覚える（信じはしない） */
export function trustOf(stateDir: string, sig: { by: string; key: string; pub: string }, now: Date): Trust {
  const entries = readTrust(stateDir);
  const hit = entries.find((e) => e.key === sig.key && e.pub === sig.pub);
  if (hit) return hit.own ? "own" : hit.by !== sig.by ? "changed" : hit.confirmed ? "confirmed" : "unconfirmed";
  const sameName = entries.some((e) => e.by === sig.by && e.confirmed);
  writeTrust(stateDir, [...entries, { by: sig.by, key: sig.key, pub: sig.pub, firstSeen: now.toISOString(), confirmed: false, own: false }]);
  // 確認済みの呼び名に、知らない鍵が出てきた
  return sameName ? "changed" : "unconfirmed";
}

/** 人が指紋を読み合わせて、鍵を確認済みにする（人だけの経路） */
export function confirmKey(stateDir: string, key: string): boolean {
  const entries = readTrust(stateDir);
  const e = entries.find((x) => x.key === key);
  if (!e) return false;
  e.confirmed = true;
  writeTrust(stateDir, entries);
  return true;
}

/** 承認に数えてよい鍵か（自分の鍵か、確認済みの鍵だけ） */
export const countsForApproval = (t: Trust) => t === "own" || t === "confirmed";

/** 設定の画面に出す、覚えた鍵の一覧（呼び名・鍵 ID・指紋・確認済みか・自分の鍵か・初めて見た時刻） */
export function trustList(stateDir: string): { by: string; key: string; fingerprint: string; confirmed: boolean; own: boolean; firstSeen: string }[] {
  return readTrust(stateDir).map((e) => ({ by: e.by, key: e.key, fingerprint: fingerprint(e.pub), confirmed: e.confirmed, own: e.own, firstSeen: e.firstSeen }));
}
