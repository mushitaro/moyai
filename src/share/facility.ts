// 施設の署名鍵と持ち出し簿（docs/plan.md §2.19、運営者の決定 2026-11-04）：保管先の計画のフォルダ plans/<計画ID>/share/ に置く。
//   share/keys/<場ID>.json   その計画（施設）がその場（輪か公開の台帳）へ出す鍵。包まない（合言葉はやめた）。計画のフォルダを開ける人なら、その施設として出せる
//   share/sent/<場ID>.json   持ち出し簿：出した束の連番とハッシュ（中身は残さない）。公開の台帳なら PR の番号と行方も。どの PC も、前の連番・ハッシュと、まだ載っていない PR を読める
// 鍵の単位は施設 × 場（運営者の決定 2026-11-04「分ける」：社内の共有フォルダ〔輪〕に出す鍵と、公開の台帳に出す鍵を分ける）。
// 鍵のファイルを書くのは、人が送ったときだけ（人だけの経路）。まだ無ければ、橋渡しがメモリで鍵を作ってプレビューに使う。
// 同期の遅れで 2 台がそれぞれ鍵を作ると、同期フォルダは衝突の写し（<場ID>-<PC 名>.json など）を残す。その場の鍵が 2 つ以上あるか、
// 持ち出し簿にほかの鍵の記録があれば、送らずに知らせる（同じ施設を 2 施設に数えないため。直し方は人が選ぶ。作り直しは未実装）。
// 鍵の中身は MCP のどの結果にも入れず、保管先を読むほかの処理は share/keys/ を読まない。見張りのフックが AI の読み取りを止める。
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeSharedJson as writeJson } from "../bridge/places";
import { planDir } from "../plan/paths";
import { HEX16, generateKeyPair, isPlainKey, keyIdOf, openPlainKey, toPlainKey, type KeyPair } from "./sign";

/** 送る施設：保管先と計画 */
export interface Facility {
  root: string;
  planId: string;
}

export const SHARE_DIR = "share";
export const KEYS_DIR = "keys";
export const SENT_DIR = "sent";

export function shareDir(f: Facility): string {
  return join(planDir(f.root, f.planId), SHARE_DIR);
}

function placeIdOk(placeId: string): void {
  if (!HEX16.test(placeId)) throw new Error("場 ID の形でない");
}

/** その場のファイル（<場ID>.json と、同期の衝突の写し <場ID>….json）の名前 */
function filesOf(dir: string, placeId: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.startsWith(placeId) && n.endsWith(".json") && !n.endsWith(".tmp"))
    .sort();
}

/** その場の鍵：share/keys/ にある、その場の鍵の公開鍵（衝突の写しも数える） */
export function storedKeys(f: Facility, placeId: string): { file: string; pub: string; pair: KeyPair | null }[] {
  placeIdOk(placeId);
  const dir = join(shareDir(f), KEYS_DIR);
  return filesOf(dir, placeId).flatMap((n) => {
    const k = readJson<unknown>(join(dir, n));
    return isPlainKey(k) ? [{ file: n, pub: k.pub, pair: openPlainKey(k) }] : [];
  });
}

/** 持ち出し簿を読む（<場ID>.json だけ。衝突の写しは forkedSent で数える） */
export function readPlanSent<T>(f: Facility, placeId: string): T[] {
  placeIdOk(placeId);
  const s = readJson<{ entries?: T[] }>(join(shareDir(f), SENT_DIR, `${placeId}.json`));
  return Array.isArray(s?.entries) ? s.entries : [];
}

export function writePlanSent<T>(f: Facility, placeId: string, entries: readonly T[]): void {
  placeIdOk(placeId);
  writeJson(shareDir(f), join(SENT_DIR, `${placeId}.json`), { entries });
}

export function appendPlanSent<T>(f: Facility, placeId: string, e: T): void {
  writePlanSent(f, placeId, [...readPlanSent<T>(f, placeId), e]);
}

/** 引退させた鍵の一覧（share/sent/<場ID>.retired.json。足すだけ。衝突の写しは数えない） */
const retiredFile = (placeId: string) => join(SENT_DIR, `${placeId}.retired.json`);

/** 引退させた鍵 ID（作り直した鍵の古い方。持ち出し簿にその記録があっても、ほかの鍵とは数えない） */
export function retiredKeys(f: Facility, placeId: string): Set<string> {
  placeIdOk(placeId);
  const r = readJson<{ keys?: unknown }>(join(shareDir(f), retiredFile(placeId)));
  return new Set(Array.isArray(r?.keys) ? r.keys.filter((k): k is string => typeof k === "string" && HEX16.test(k)) : []);
}

/** 持ち出し簿（衝突の写しを含む）に出てくる鍵 ID。引退させた鍵は除く */
export function sentKeys(f: Facility, placeId: string): Set<string> {
  placeIdOk(placeId);
  const dir = join(shareDir(f), SENT_DIR);
  const retired = retiredKeys(f, placeId);
  const out = new Set<string>();
  for (const n of filesOf(dir, placeId)) {
    if (n.endsWith(".retired.json")) continue;
    const s = readJson<{ entries?: { key?: unknown }[] }>(join(dir, n));
    for (const e of Array.isArray(s?.entries) ? s.entries : []) if (typeof e?.key === "string" && HEX16.test(e.key) && !retired.has(e.key)) out.add(e.key);
  }
  return out;
}

/** 持ち出し簿（衝突の写しを含む）にある、その鍵の連番 */
export function sentSeqs(f: Facility, placeId: string, key: string): number[] {
  return sentOf(f, placeId, key).map((e) => e.seq);
}

/** 持ち出し簿（衝突の写しを含む）にある、その鍵の束の連番とハッシュ */
export function sentOf(f: Facility, placeId: string, key: string): { seq: number; hash: string | null }[] {
  placeIdOk(placeId);
  const dir = join(shareDir(f), SENT_DIR);
  const out: { seq: number; hash: string | null }[] = [];
  for (const n of filesOf(dir, placeId)) {
    if (n.endsWith(".retired.json")) continue;
    const s = readJson<{ entries?: { key?: unknown; seq?: unknown; hash?: unknown }[] }>(join(dir, n));
    for (const e of Array.isArray(s?.entries) ? s.entries : []) if (e?.key === key && typeof e.seq === "number") out.push({ seq: e.seq, hash: typeof e.hash === "string" ? e.hash : null });
  }
  return out;
}

/** share/keys/retired/ に移した鍵（作り直しで引退させた鍵。輪に印が無ければ、作り直しで印を置き直す） */
export function retiredKeyFiles(f: Facility, placeId: string): { key: string; pair: KeyPair }[] {
  placeIdOk(placeId);
  const dir = join(shareDir(f), KEYS_DIR, "retired");
  if (!existsSync(dir)) return [];
  const out: { key: string; pair: KeyPair }[] = [];
  for (const n of readdirSync(dir).sort()) {
    // 名前は <鍵ID>-<場ID>….json
    const m = /^([0-9a-f]{16})-(.+).json$/.exec(n);
    if (!m || !m[2]!.startsWith(placeId)) continue;
    const k = readJson<unknown>(join(dir, n));
    const pair = isPlainKey(k) ? openPlainKey(k) : null;
    if (pair && keyIdOf(pair.pub) === m[1] && !out.some((x) => x.key === m[1])) out.push({ key: m[1]!, pair });
  }
  return out;
}

/**
 * 施設の鍵を引退させる（作り直し。人だけの経路）：その場の鍵のファイル（衝突の写しも）を share/keys/retired/ へ移し、
 * 引退させた鍵 ID を share/sent/<場ID>.retired.json に足す。鍵は消さない（引退の印に署名するのに使い、あとで確かめられるように）。
 * 次に送るときは新しい鍵になる（橋渡しがメモリで作り、人が送ったときに書く）。返すのは、引退させた鍵（鍵の対が読めたもの）と、
 * 持ち出し簿にだけあって鍵の対の無い鍵 ID（引退の印に署名できない）
 */
export function retireFacilityKeys(f: Facility, placeId: string): { retired: { key: string; pair: KeyPair }[]; unsigned: string[] } {
  const stored = storedKeys(f, placeId);
  const dir = join(shareDir(f), KEYS_DIR);
  const retired: { key: string; pair: KeyPair }[] = [];
  for (const k of stored) {
    const key = keyIdOf(k.pub);
    if (k.pair && !retired.some((x) => x.key === key)) retired.push({ key, pair: k.pair });
    mkdirSync(join(dir, "retired"), { recursive: true });
    renameSync(join(dir, k.file), join(dir, "retired", `${key}-${k.file}`));
  }
  const logged = sentKeys(f, placeId);
  const keys = new Set([...retiredKeys(f, placeId), ...retired.map((r) => r.key), ...logged]);
  writeJson(shareDir(f), retiredFile(placeId), { keys: [...keys].sort() });
  return { retired, unsigned: [...logged].filter((k) => !retired.some((r) => r.key === k)).sort() };
}

export type FacilityKey =
  /** stored：保管先にもうある鍵か（無ければメモリの鍵。送ったときに書く） */
  | { ok: true; pair: KeyPair; stored: boolean }
  /** keysForked：その場の鍵が 2 つ以上ある（同期の衝突の写しを含む）か、持ち出し簿にほかの鍵の記録がある */
  | { ok: false; reason: "keysForked"; keys: string[] };

/**
 * 送るときの鍵。保管先にあればそれ、無ければメモリの鍵（pending。同じ計画と場なら、橋渡しが動いている間は同じ鍵を返す）。
 * その場の鍵が 2 つ以上あるか、持ち出し簿にほかの鍵の記録があれば keysForked（送らない）。
 */
export function facilityKey(f: Facility, placeId: string, pending: Map<string, KeyPair>): FacilityKey {
  const stored = storedKeys(f, placeId);
  const pubs = [...new Set(stored.map((k) => k.pub))];
  const logged = sentKeys(f, placeId);
  const keyIds = new Set([...pubs.map(keyIdOf), ...logged]);
  if (pubs.length > 1) return { ok: false, reason: "keysForked", keys: [...keyIds].sort() };
  if (pubs.length === 1) {
    const pair = stored.find((k) => k.pair)?.pair ?? null;
    if (!pair) return { ok: false, reason: "keysForked", keys: [...keyIds].sort() };
    if ([...logged].some((k) => k !== keyIdOf(pair.pub))) return { ok: false, reason: "keysForked", keys: [...keyIds].sort() };
    return { ok: true, pair, stored: true };
  }
  // 保管先に鍵が無いのに、持ち出し簿に記録がある（鍵のファイルだけが消えた）：新しい鍵で出すと別の施設に数えられる
  if (logged.size > 0) return { ok: false, reason: "keysForked", keys: [...logged].sort() };
  const slot = `${f.root}|${f.planId}|${placeId}`;
  let pair = pending.get(slot);
  if (!pair) {
    pair = generateKeyPair();
    pending.set(slot, pair);
  }
  return { ok: true, pair, stored: false };
}

/** 送ったときに鍵を書く（人だけの経路）。もう同じ鍵があれば何もしない。ほかの鍵があれば書かずに "differs" */
export function storeFacilityKey(f: Facility, placeId: string, pair: KeyPair, pending?: Map<string, KeyPair>): "ok" | "differs" {
  const stored = storedKeys(f, placeId);
  if (stored.some((k) => k.pub !== pair.pub)) return "differs";
  if (!stored.some((k) => k.file === `${placeId}.json`)) writeJson(shareDir(f), join(KEYS_DIR, `${placeId}.json`), toPlainKey(pair));
  pending?.delete(`${f.root}|${f.planId}|${placeId}`);
  return "ok";
}

/** 保管先のどの計画かが、その場へ出す鍵の鍵 ID（自分の束として数えない・自分の鍵として確認済みにする） */
export function ownKeysAt(root: string, placeId: string): string[] {
  placeIdOk(placeId);
  const plans = join(root, "plans");
  if (!existsSync(plans)) return [];
  const out = new Set<string>();
  for (const planId of readdirSync(plans)) {
    try {
      for (const k of storedKeys({ root, planId }, placeId)) out.add(keyIdOf(k.pub));
    } catch {
      /* 計画 ID の形でないフォルダ */
    }
  }
  return [...out].sort();
}

/** 保管先のどの計画かが、その場へ出した束の持ち出し簿（計画ごと） */
export function allPlanSent<T>(root: string, placeId: string): { facility: Facility; entries: T[] }[] {
  placeIdOk(placeId);
  const plans = join(root, "plans");
  if (!existsSync(plans)) return [];
  const out: { facility: Facility; entries: T[] }[] = [];
  for (const planId of readdirSync(plans).sort()) {
    try {
      const f = { root, planId };
      const entries = readPlanSent<T>(f, placeId);
      if (entries.length > 0) out.push({ facility: f, entries });
    } catch {
      /* 計画 ID の形でないフォルダ */
    }
  }
  return out;
}
