// 公開の台帳へ出す側（docs/plan.md §2.8。運営者の決定、2026-11-04「MOYAI が出す」）。
// - 台帳の clone（人が設定で選んだもの）を受け手と同じ関数で読み、送る先（SendPlace）を作る。束は検問所と同じ関数で作って署名する。
// - 鍵は台帳ごとに 1 つ。人が SHARE で GitHub につなぐときに作る（包まない。合言葉はやめた、docs/plan.md §2.19）。
// - 出す前に、台帳の clone の木に束を足したときに受け手と同じ関数（verifyLedgerFiles）で ✓ になるかを確かめる。✗ なら出さない。
// - 前に出した束が clone にまだ無く、PR が閉じてもいなければ、次の束は出さない（鎖が抜けて、台帳の検証で ✗ になるため）。
// 束の中身・鍵・トークンをログに出さない。
import { addLedger, readKeyFile, readLedgers, readLedgerSent, writeKeyFile, type LedgerEntry, type LedgerSentEntry } from "../bridge/places";
import { bundleFileName, type ShareContext } from "./bundle";
import { LEDGER_DIR, LEDGER_JSON_PATH, ledgerContext, readLedgerDir, verifyLedgerFiles, type LedgerFile, type LedgerRead } from "./ledger";
import type { SharePack } from "./pack";
import type { Rules } from "./rules";
import type { SendPlace } from "./checkpoint";
import { fingerprint, generateKeyPair, keyIdOf, sha256Hex, toPlainKey } from "./sign";
import { profileText } from "./site";

export type LedgerLoad =
  | { ok: true; id: string; root: string; rules: Rules; ledgerBytes: Uint8Array; ctx: ShareContext; files: LedgerFile[]; read: LedgerRead }
  | { ok: false; reason: "notChosen" | "noLedgerDir" | "ledgerDirSymlink" | "tooManyFiles" | "missing" | "rules" | "otherPack" };

/** 台帳の clone を、出す側として読む（受け手と同じ readLedgerDir と verifyLedgerFiles） */
export async function loadLedgerForSend(root: string | null, pack: SharePack): Promise<LedgerLoad> {
  if (root === null) return { ok: false, reason: "notChosen" };
  const dir = await readLedgerDir(root);
  if (!dir.ok) return { ok: false, reason: dir.reason };
  const read = verifyLedgerFiles(dir.files, pack);
  const L = read.ledger;
  if (L.status === "missing") return { ok: false, reason: "missing" };
  const lf = dir.files.find((f) => f.path === LEDGER_JSON_PATH);
  const ctx = lf?.bytes ? ledgerContext(lf.bytes, pack) : null;
  if (L.status !== "ok" || !L.id || !L.rules || !lf?.bytes || !ctx) return { ok: false, reason: "rules" };
  if (L.rules.pack !== pack.id) return { ok: false, reason: "otherPack" };
  return { ok: true, id: L.id, root, rules: L.rules, ledgerBytes: lf.bytes, ctx, files: dir.files, read };
}

export type LedgerKey = { ok: true; entry: LedgerEntry; pub: string; created: boolean } | { ok: false; reason: "keyExists" };

/**
 * この台帳の自分の鍵：あればそれを使い、無ければ作って置く（人が SHARE で GitHub につなぐとき。包まない。docs/plan.md §2.19）。
 * 作るときは、いまの台帳の決まりを受け入れたものとして記録する（あとで決まりが変われば、送る前に止まる）。
 */
export function ensureLedgerKey(stateDir: string, L: Extract<LedgerLoad, { ok: true }>, pack: SharePack, now: Date): LedgerKey {
  const entry = readLedgers(stateDir).find((e) => e.ledgerId === L.id);
  const w = readKeyFile(stateDir, L.id);
  if (entry && w) return { ok: true, entry, pub: w.pub, created: false };
  if (w) return { ok: false, reason: "keyExists" };
  const pair = generateKeyPair();
  if (!writeKeyFile(stateDir, L.id, toPlainKey(pair))) return { ok: false, reason: "keyExists" };
  const made: LedgerEntry = {
    ledgerId: L.id,
    pack: pack.id,
    key: keyIdOf(pair.pub),
    acceptedRulesHash: sha256Hex(L.ledgerBytes),
    acceptedRules: L.rules,
    createdAt: now.toISOString(),
  };
  addLedger(stateDir, made);
  return { ok: true, entry: made, pub: pair.pub, created: true };
}

/** 台帳の自分の鍵（あれば）。無ければ null（GitHub につなぐときに作る） */
export function ledgerKeyOf(stateDir: string, ledgerId: string): { entry: LedgerEntry; pub: string } | null {
  const entry = readLedgers(stateDir).find((e) => e.ledgerId === ledgerId);
  const w = readKeyFile(stateDir, ledgerId);
  return entry && w && keyIdOf(w.pub) === entry.key ? { entry, pub: w.pub } : null;
}

/** 自分の鍵で出した束のうち、PR が閉じていないもの（載ったかどうかは clone で見る） */
function liveSent(stateDir: string, ledgerId: string, key: string): LedgerSentEntry[] {
  return readLedgerSent(stateDir).filter((e) => e.ledgerId === ledgerId && e.key === key && e.state !== "closed");
}

/** 公開の台帳を送る先にする。場の束は clone の ✓ の束、持ち出し簿は出して閉じていない PR の束 */
export function ledgerPlace(stateDir: string, L: Extract<LedgerLoad, { ok: true }>, k: { entry: LedgerEntry; pub: string }): SendPlace {
  const key = k.entry.key;
  return {
    ctx: L.ctx,
    rules: L.rules,
    acceptedRulesHash: k.entry.acceptedRulesHash,
    acceptedRules: k.entry.acceptedRules,
    pub: k.pub,
    placed: L.read.bundles.filter((b) => b.key === key && b.status === "ok" && b.seq !== null).map((b) => ({ seq: b.seq!, hash: b.hash })),
    logged: liveSent(stateDir, L.id, key).map((e) => ({ seq: e.seq, hash: e.hash })),
    folderPath: `${LEDGER_DIR}/bundles/${key}`,
  };
}

/** 前に出した束のうち、clone にまだ無く、PR が閉じてもいないもの（審査中か、clone が古い）。あれば次の束は出さない */
export function pendingSent(stateDir: string, L: Extract<LedgerLoad, { ok: true }>, key: string): LedgerSentEntry | null {
  const inClone = new Set(L.read.bundles.filter((b) => b.key === key && b.status === "ok").map((b) => b.hash));
  return liveSent(stateDir, L.id, key).find((e) => !inClone.has(e.hash)) ?? null;
}

/** 台帳の中の束の道 */
export function ledgerBundlePath(key: string, seq: number, hash: string): string {
  return `${LEDGER_DIR}/bundles/${key}/${bundleFileName(seq, hash)}`;
}

/** 束を clone の木に足したときに、受け手と同じ関数で ✓ になるか。✗ なら理由 */
export function checkAgainstLedger(L: Extract<LedgerLoad, { ok: true }>, pack: SharePack, path: string, bytes: Uint8Array): { ok: true } | { ok: false; reasons: string[] } {
  if (L.files.some((f) => f.path === path)) return { ok: false, reasons: ["ledger.exists"] };
  const read = verifyLedgerFiles([...L.files, { path, kind: "file", bytes }], pack);
  const line = read.bundles.find((b) => b.path === path);
  if (line && line.status === "ok" && read.ledger.status === "ok") return { ok: true };
  return { ok: false, reasons: line?.reasons.length ? line.reasons : read.ledger.reasons.length ? read.ledger.reasons : ["ledger"] };
}

/** PR の題・本文・commit の文（GitHub に出る。施設の名前も人の名前も入れない） */
export const LEDGER_PR_TEXT = {
  title: (key: string, seq: number) => `束を足す：鍵 ${key}・連番 ${seq}`,
  commitMessage: (key: string, seq: number) => `束を足す：鍵 ${key}・連番 ${seq}`,
  body: (o: { key: string; pub: string; seq: number; hash: string; path: string; profile: string; chunks: number; ledgerId: string }) =>
    [
      `台帳 \`${o.ledgerId}\` に、束を 1 つ足します。`,
      "",
      `- 束：\`${o.path}\``,
      `- 鍵 ID \`${o.key}\`（指紋 \`${fingerprint(o.pub)}\`）・連番 ${o.seq}・ファイルの SHA-256 \`${o.hash}\``,
      `- 見え方：${o.profile}`,
      `- 塊：${o.chunks}`,
      "",
      "この束は、MOYAI の SHARE の画面で人が署名し、出す前に受け手と同じ関数（形・署名・鎖・粒度・禁止語・数え直し・紛れる数 k）で確かめて ✓ でした。PR は MOYAI が出しました。",
      "鍵 ID と出した人の結びつきは束の署名で決まり、この PR を出したアカウントの名前は使いません。",
      "",
    ].join("\n"),
};

/** 枝の名前（束ごとに 1 つ。同じ連番を出し直しても重ならないように、ハッシュの頭を入れる） */
export function ledgerBranch(key: string, seq: number, hash: string): string {
  return `moyai/bundle-${key}-${String(seq).padStart(6, "0")}-${hash.slice(0, 8)}`;
}

/** PR の本文に出す見え方の 1 行 */
export function ledgerProfileText(pack: SharePack, body: { profile: Parameters<typeof profileText>[1] }): string {
  return profileText(pack, body.profile);
}
