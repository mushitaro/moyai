// 受け手の場を読む（橋渡しの側。ファイルを読む）。どの場も、送る側と同じ受け手の関数で確かめ、✓ の束（鍵ごとに最新の 1 つ）だけを渡す。
// 公開の台帳：人が設定で選んだ台帳の clone を readLedgerDir と verifyLedgerFiles で読む（ネットには出ない。clone を新しくするのは人）。
// 輪：状態フォルダの rings.json にある、このパックの輪を loadRing で読む（確認済みの仲間の ✓ の最新の束だけ）。
// 自分の束は、保管先の計画がその場へ出す施設の鍵（plans/<計画ID>/share/keys/。docs/plan.md §2.19）で見分け、似た施設に数えない。
// 読めない場は黙って捨てず、理由をつけて返す。束の中身・鍵・道は記録に出さない。
import { latestPerKey } from "./aggregate";
import { ownKeysAt } from "./facility";
import { loadRing } from "./checkpoint";
import { readLedgerDir, verifyLedgerFiles } from "./ledger";
import type { SharePack } from "./pack";
import type { Place, PlaceKind } from "./receive";
import { readRings } from "../bridge/places";

/** 場ごとの読めた数（画面の「場の状態」に出す） */
export interface PlaceStatus {
  kind: PlaceKind;
  id: string | null;
  /** 読めたか。読めなければ理由 */
  ok: boolean;
  reason: string | null;
  /** ✓ の束を出した鍵の数（集計に入る数。自分を含む） */
  peers: number;
  /** ✗ の束か仲間の数（集計に入れない） */
  ng: number;
}

export interface LoadedPlaces {
  places: Place[];
  status: PlaceStatus[];
}

/** 公開の台帳の clone を読む。root が null（まだ選んでいない）なら場は無い */
export async function loadLedgerPlace(root: string | null, pack: SharePack, storage: string | null = null): Promise<{ place: Place | null; status: PlaceStatus }> {
  if (root === null) return { place: null, status: { kind: "ledger", id: null, ok: false, reason: "ledger.notChosen", peers: 0, ng: 0 } };
  const dir = await readLedgerDir(root);
  if (!dir.ok) return { place: null, status: { kind: "ledger", id: null, ok: false, reason: `ledger.${dir.reason}`, peers: 0, ng: 0 } };
  const read = verifyLedgerFiles(dir.files, pack);
  const L = read.ledger;
  if (L.status !== "ok" || L.id === null || L.rules === null) {
    return { place: null, status: { kind: "ledger", id: L.id, ok: false, reason: L.status === "missing" ? "ledger.missing" : "ledger.rules", peers: 0, ng: 0 } };
  }
  if (L.rules.pack !== pack.id) return { place: null, status: { kind: "ledger", id: L.id, ok: false, reason: "ledger.otherPack", peers: 0, ng: 0 } };
  const peers = latestPerKey(read.bundles.filter((b) => b.status === "ok"));
  const ng = read.bundles.filter((b) => b.status !== "ok").length;
  return {
    place: { kind: "ledger", id: L.id, peers, self: storage ? ownKeysAt(storage, L.id) : [], bands: L.rules.bands },
    status: { kind: "ledger", id: L.id, ok: true, reason: null, peers: peers.length, ng },
  };
}

/** 自分の輪（このパックのもの）を読む。storage は保管先（施設の鍵を自分の鍵として数える） */
export async function loadRingPlaces(stateDir: string, pack: SharePack, storage: string | null = null): Promise<LoadedPlaces> {
  const out: LoadedPlaces = { places: [], status: [] };
  for (const e of readRings(stateDir).rings.filter((r) => r.pack === pack.id).sort((a, b) => (a.ringId < b.ringId ? -1 : 1))) {
    const own = storage ? ownKeysAt(storage, e.ringId) : [];
    const r = await loadRing(stateDir, e.ringId, pack, own);
    if (!r.ok) {
      out.status.push({ kind: "ring", id: e.ringId, ok: false, reason: `ring.${r.reason}`, peers: 0, ng: 0 });
      continue;
    }
    if (r.read.circle.status !== "ok") {
      out.status.push({ kind: "ring", id: e.ringId, ok: false, reason: "ring.circle", peers: 0, ng: 0 });
      continue;
    }
    const peers = r.read.latestBundles;
    out.places.push({ kind: "ring", id: e.ringId, peers, self: own, bands: r.rules.bands });
    out.status.push({ kind: "ring", id: e.ringId, ok: true, reason: null, peers: peers.length, ng: r.read.members.filter((m) => m.status !== "ok").length });
  }
  return out;
}

/** 台帳と輪をまとめて読む */
export async function loadPlaces(i: { stateDir: string; ledgerRoot: string | null; pack: SharePack; storage?: string | null }): Promise<LoadedPlaces> {
  const l = await loadLedgerPlace(i.ledgerRoot, i.pack, i.storage ?? null);
  const r = await loadRingPlaces(i.stateDir, i.pack, i.storage ?? null);
  return { places: [...(l.place ? [l.place] : []), ...r.places], status: [l.status, ...r.status] };
}
