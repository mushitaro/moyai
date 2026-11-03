// 公開の台帳の CLI（docs/plan.md §2.8 場 2・docs/sharing.md）。
// - `moyai verify ledger <台帳のリポジトリの根>`：輪の受け手と同じ関数で、決まり（ledger.json）と束ごとに ✓ か理由つきの ✗ を出す。
// 人への知らせは標準エラーへ出す（標準出力は MCP だけに使う）。終わりの値：すべて ✓ なら 0、どれかが ✗ なら 1、引数や読めない台帳は 2。
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { reasonText } from "../app/text/reasons";
import { LEDGER_DIR, LEDGER_FILE, LEDGER_JSON_PATH, ledgerRulesOf, readLedgerDir, verifyLedgerFiles, type LedgerFile, type LedgerRead } from "../share/ledger";
import { loadSharePack, resolvePacksDir, type SharePack } from "../share/pack";

export const LEDGER_CLI_TEXT = {
  verifyUsage: "使い方：moyai verify ledger <台帳のリポジトリの根>（その下に ledger/ledger.json と ledger/bundles/ がある）",
  noLedger: (p: string) => `台帳が見つかりません：${p}（ledger/ledger.json のあるリポジトリの根を指してください）`,
  dirSymlink: "ledger/ が symlink です。たどらずに止めました。",
  tooMany: "ledger/ の下のファイルが多すぎます（上限を越えたので止めました）。",
  rulesUnreadable: "台帳の決まり（ledger/ledger.json）を読めません。",
  packNotReady: (pack: string, reason: string) => `パック ${pack} の共有の部品を読めません（${reason}）`,
  head: (id: string | null, version: number | null, hash: string | null) =>
    `台帳 ${id ?? "（ID 不明）"}${version !== null ? `（決まり 版 ${version}` : "（決まり"}、SHA-256 ${hash ? hash.slice(0, 16) : "不明"}…）`,
  rules: "決まり（ledger/ledger.json）",
  bundle: (p: string) => `束 ${p}`,
  other: (p: string) => `許した形の外 ${p}`,
  noBundles: "束は 0 件です。",
  summaryOk: (n: number) => `すべて ✓ です（束 ${n} 件）。`,
  summaryNg: (n: number) => `✗ が ${n} 件あります。`,
};

const say = (m: string) => process.stderr.write(`${m}\n`);

/** 指した道から、台帳のリポジトリの根を決める（根か、その下の ledger/ を受ける）。見つからなければ null */
export function ledgerRootOf(folder: string): string | null {
  const abs = resolve(folder);
  if (existsSync(join(abs, LEDGER_DIR, LEDGER_FILE))) return abs;
  if (basename(abs) === LEDGER_DIR && existsSync(join(abs, LEDGER_FILE))) return dirname(abs);
  return null;
}

export type LedgerLoad =
  | { ok: true; files: LedgerFile[]; pack: SharePack; read: LedgerRead }
  | { ok: false; code: 2; message: string };

/** 台帳を読み、決まりのパックで確かめる（verify ledger とサイトが同じこの関数を使う） */
export async function loadLedger(root: string, o: { packsDir?: string } = {}): Promise<LedgerLoad> {
  const d = await readLedgerDir(root);
  if (!d.ok) {
    return { ok: false, code: 2, message: d.reason === "ledgerDirSymlink" ? LEDGER_CLI_TEXT.dirSymlink : d.reason === "tooManyFiles" ? LEDGER_CLI_TEXT.tooMany : LEDGER_CLI_TEXT.noLedger(root) };
  }
  const lf = d.files.find((f) => f.path === LEDGER_JSON_PATH);
  if (!lf) return { ok: false, code: 2, message: LEDGER_CLI_TEXT.noLedger(root) };
  const rules = lf.kind === "file" ? ledgerRulesOf(lf.bytes) : null;
  if (!rules) return { ok: false, code: 2, message: LEDGER_CLI_TEXT.rulesUnreadable };
  const pack = loadSharePack(o.packsDir ?? resolvePacksDir(), rules.pack);
  if (!pack.ok) return { ok: false, code: 2, message: LEDGER_CLI_TEXT.packNotReady(rules.pack, pack.reason) };
  return { ok: true, files: d.files, pack: pack.pack, read: verifyLedgerFiles(d.files, pack.pack) };
}

const reasonsText = (rs: readonly string[]) => [...new Set(rs.map(reasonText))].join("、");

/** 台帳の確かめの結果を行にする（✓／✗ と理由） */
export function formatLedger(r: LedgerRead): string[] {
  const lines = [LEDGER_CLI_TEXT.head(r.ledger.id, r.ledger.version, r.ledger.hash)];
  lines.push(r.ledger.status === "ok" ? `  ✓ ${LEDGER_CLI_TEXT.rules}` : `  ✗ ${LEDGER_CLI_TEXT.rules}：${reasonsText(r.ledger.reasons.length ? r.ledger.reasons : ["ledger.unreadable"])}`);
  for (const b of r.bundles) lines.push(b.status === "ok" ? `  ✓ ${LEDGER_CLI_TEXT.bundle(b.path)}` : `  ✗ ${LEDGER_CLI_TEXT.bundle(b.path)}：${reasonsText(b.reasons)}`);
  for (const o of r.others) lines.push(`  ✗ ${LEDGER_CLI_TEXT.other(o.path)}：${reasonsText(o.reasons)}`);
  if (r.bundles.length === 0) lines.push(`  ${LEDGER_CLI_TEXT.noBundles}`);
  const ng = (r.ledger.status === "ok" ? 0 : 1) + r.bundles.filter((b) => b.status !== "ok").length + r.others.length;
  lines.push(ng === 0 ? LEDGER_CLI_TEXT.summaryOk(r.bundles.length) : LEDGER_CLI_TEXT.summaryNg(ng));
  return lines;
}

/** verify ledger。argv は verify のあと（["ledger", <道>]）。すべて ✓ なら 0、✗ があれば 1、引数や読めない台帳は 2 */
export async function verifyLedgerCli(argv: string[], o: { packsDir?: string } = {}): Promise<number> {
  const [what, folder, ...rest] = argv;
  if (what !== "ledger" || !folder || rest.length > 0) {
    say(LEDGER_CLI_TEXT.verifyUsage);
    return 2;
  }
  const root = ledgerRootOf(folder);
  if (!root) {
    say(LEDGER_CLI_TEXT.noLedger(folder));
    return 2;
  }
  const l = await loadLedger(root, o);
  if (!l.ok) {
    say(l.message);
    return l.code;
  }
  for (const line of formatLedger(l.read)) say(line);
  return l.read.ok ? 0 : 1;
}

export const LEDGER_USAGE = `使い方：
  moyai ledger validate-pr --base <SHA> --head <SHA> [--repo <道>] [--json <道>] [--markdown <道>]
  moyai ledger site <台帳のリポジトリの根> <出すフォルダ>
  moyai ledger submit --bundle <束> --repo <台帳の clone>（人だけ。端末から）`;

/** ledger の下のコマンド。argv は ledger のあと */
export async function ledgerCli(argv: string[], o: { packsDir?: string } = {}): Promise<number> {
  const [sub] = argv;
  void o;
  if (sub === undefined) {
    say(LEDGER_USAGE);
    return 2;
  }
  say(LEDGER_USAGE);
  return 2;
}
