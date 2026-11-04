// 人の鍵と、覚えた鍵（docs/plan.md §2.18.2）。どちらも状態フォルダ（同期されない場所）に置く。
//   people/keys/<鍵ID>.json   自分の鍵：呼び名と、包まない秘密鍵。1 人の呼び名に鍵を 1 つ以上（PC を替えた・鍵を失ったときに足す）
//                             合言葉はやめた（運営者の決定 2026-11-04、docs/plan.md §2.18）。署名は、人が画面で署名のボタンを押したときに決まる。
//                             前の形（moyai.own-key/0、合言葉で包んだもの）は、人だけの CLI `moyai keys unwrap` で 1 度だけ移す。
//   people/trust.json         覚えた鍵：呼び名 → 鍵（公開鍵・初めて見た時刻・確認済みか）。保管先の people/ は書ける人なら誰でも置けるので、信じる元はここだけ
// 自分の鍵はこの PC で作ったので、作ったときから確認済み。ほかの人の鍵は、指紋 16 文字を読み合わせて人が確認済みにするまで「未確認」。
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validName } from "../plan/signature";
import { fingerprint, generateKeyPair, isPlainKey, isWrappedKey, keyIdOf, openPlainKey, toPlainKey, type KeyPair, type PlainKey, type WrappedKey } from "../share/sign";
import { readJson, writeJson } from "./places";

const KEYS = join("people", "keys");
const TRUST = join("people", "trust.json");

type OwnKeyFile = { v: "moyai.own-key/1"; by: string; key: PlainKey } | { v: "moyai.own-key/0"; by: string; wrapped: WrappedKey };

function ownPub(f: OwnKeyFile): string {
  return f.v === "moyai.own-key/1" ? f.key.pub : f.wrapped.pub;
}

function validOwn(f: OwnKeyFile | null): f is OwnKeyFile {
  if (!f || !validName(f.by)) return false;
  return f.v === "moyai.own-key/1" ? isPlainKey(f.key) : f.v === "moyai.own-key/0" && isWrappedKey(f.wrapped);
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

/** 自分の鍵の一覧。old は前の形（合言葉で包んだもの。`moyai keys unwrap` で移すまで署名に使わない） */
export function ownKeys(stateDir: string): { by: string; key: string; pub: string; fingerprint: string; old: boolean }[] {
  const dir = join(stateDir, KEYS);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^[0-9a-f]{16}\.json$/.test(n))
    .map((n) => readJson<OwnKeyFile>(join(dir, n)))
    .filter(validOwn)
    .map((f) => ({ by: f.by, key: keyIdOf(ownPub(f)), pub: ownPub(f), fingerprint: fingerprint(ownPub(f)), old: f.v === "moyai.own-key/0" }));
}

function readTrust(stateDir: string): TrustEntry[] {
  const t = readJson<{ v?: number; entries?: TrustEntry[] }>(join(stateDir, TRUST));
  return Array.isArray(t?.entries) ? t!.entries.filter((e) => validName(e.by) && /^[0-9a-f]{16}$/.test(e.key)) : [];
}

function writeTrust(stateDir: string, entries: TrustEntry[]): void {
  writeJson(stateDir, TRUST, { v: 1, entries });
}

export type CreateKey = { ok: true; key: string; fingerprint: string } | { ok: false; reason: "nameInvalid" | "personKeyExists" };

/** 自分の鍵を作る（人だけの経路）。この PC に同じ呼び名の鍵があれば作らない（作り直しは鍵を足す道で、会期中は未実装） */
export function createOwnKey(stateDir: string, by: string, now: Date): CreateKey {
  if (!validName(by)) return { ok: false, reason: "nameInvalid" };
  if (ownKeys(stateDir).some((k) => k.by === by)) return { ok: false, reason: "personKeyExists" };
  const pair = generateKeyPair();
  const key = keyIdOf(pair.pub);
  writeJson(stateDir, join(KEYS, `${key}.json`), { v: "moyai.own-key/1", by, key: toPlainKey(pair) } satisfies OwnKeyFile);
  writeTrust(stateDir, [...readTrust(stateDir), { by, key, pub: pair.pub, firstSeen: now.toISOString(), confirmed: true, own: true }]);
  return { ok: true, key, fingerprint: fingerprint(pair.pub) };
}

export type OpenKey = { ok: true; pair: KeyPair } | { ok: false; reason: "personKeyMissing" | "oldKey" };

/** 自分の鍵を開く。開いた鍵は署名にだけ使い、すぐ捨てる（呼ぶ側が持ち続けない）。前の形の鍵だけなら oldKey */
export function openOwnKey(stateDir: string, by: string): OpenKey {
  const mine = ownKeys(stateDir).filter((x) => x.by === by);
  if (mine.length === 0) return { ok: false, reason: "personKeyMissing" };
  for (const k of mine.filter((x) => !x.old)) {
    const f = readJson<OwnKeyFile>(join(stateDir, KEYS, `${k.key}.json`));
    const pair = validOwn(f) && f.v === "moyai.own-key/1" ? openPlainKey(f.key) : null;
    if (pair) return { ok: true, pair };
  }
  return { ok: false, reason: mine.some((x) => x.old) ? "oldKey" : "personKeyMissing" };
}

/** 前の形の自分の鍵を、同じ鍵の包まない形に置き換える（人だけの CLI `moyai keys unwrap`。開くのは呼ぶ側） */
export function replaceOldOwnKey(stateDir: string, key: string, pair: KeyPair): boolean {
  const f = readJson<OwnKeyFile>(join(stateDir, KEYS, `${key}.json`));
  if (!validOwn(f) || f.v !== "moyai.own-key/0" || f.wrapped.pub !== pair.pub) return false;
  writeJson(stateDir, join(KEYS, `${key}.json`), { v: "moyai.own-key/1", by: f.by, key: toPlainKey(pair) } satisfies OwnKeyFile);
  return true;
}

/** 前の形の自分の鍵のファイル（`moyai keys unwrap` が開いて移す） */
export function oldOwnKeys(stateDir: string): { key: string; by: string; wrapped: WrappedKey }[] {
  return ownKeys(stateDir)
    .filter((k) => k.old)
    .map((k) => readJson<OwnKeyFile>(join(stateDir, KEYS, `${k.key}.json`)))
    .filter((f): f is Extract<OwnKeyFile, { v: "moyai.own-key/0" }> => validOwn(f) && f.v === "moyai.own-key/0")
    .map((f) => ({ key: keyIdOf(f.wrapped.pub), by: f.by, wrapped: f.wrapped }));
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
