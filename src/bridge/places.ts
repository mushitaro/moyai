// 置き場所と、状態フォルダの設定（docs/plan.md §2.9・§2.12）。
// - Documents の場所は `powershell -NoProfile` で [Environment]::GetFolderPath('MyDocuments') を取り、UTF-8 で受ける（日本語のフォルダ名を化けさせない）。
// - 同期フォルダ：環境変数 OneDrive・OneDriveCommercial・OneDriveConsumer の指すフォルダと、OneDrive が同期している場所（SharePoint のライブラリを含む）の下か。
// - 状態フォルダの設定：settings.json（置き場所）、rings.json（輪のフォルダ。scripts/guard-hook.mjs の ringFolders() が folders を読む）、
//   keys/<輪ID>.json（合言葉で包んだ秘密鍵）、sent.json（持ち出し簿）。書くのは人だけの経路だけ。
import { validName } from "../plan/signature";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { HEX16, type WrappedKey } from "../share/sign";
import type { Rules } from "../share/rules";

// ─── Documents と同期フォルダ ─────────────────────────────

export type SyncKind = "onedrive" | "sharepoint";

export interface Synced {
  kind: SyncKind;
  /** 同期しているフォルダ（この下にある） */
  base: string;
}

export interface DocumentsInfo {
  /** Documents の場所。調べられなければ null */
  documents: string | null;
  /** Documents が同期フォルダの下か */
  synced: Synced | null;
  /** OneDrive が同期している場所（環境変数と、OneDrive の設定から） */
  syncRoots: { kind: SyncKind; path: string }[];
}

/** 道を比べる形にする（区切りを / に、末尾の / を外し、Windows は大文字小文字を区別しない） */
export function normPath(p: string, platform: NodeJS.Platform = process.platform): string {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "").normalize("NFC");
  return platform === "win32" ? s.toLowerCase() : s;
}

export function isUnder(path: string, base: string, platform: NodeJS.Platform = process.platform): boolean {
  const p = normPath(path, platform);
  const b = normPath(base, platform);
  return b.length > 0 && (p === b || p.startsWith(`${b}/`));
}

/** 同期している場所の一覧：環境変数（OneDrive は個人と会社）と、OneDrive の設定にある場所（SharePoint のライブラリも入る）。 */
export function syncRootsOf(env: NodeJS.ProcessEnv, mounts: readonly string[]): { kind: SyncKind; path: string }[] {
  const out: { kind: SyncKind; path: string }[] = [];
  for (const k of ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"]) {
    const v = env[k];
    if (v && !out.some((o) => normPath(o.path, "win32") === normPath(v, "win32"))) out.push({ kind: "onedrive", path: v });
  }
  for (const m of mounts) {
    if (!m || out.some((o) => isUnder(m, o.path, "win32"))) continue;
    out.push({ kind: "sharepoint", path: m });
  }
  return out;
}

/** その道が同期フォルダの下か。いちばん深い同期の場所を返す。 */
export function syncedOf(path: string, roots: readonly { kind: SyncKind; path: string }[], platform: NodeJS.Platform = process.platform): Synced | null {
  let best: Synced | null = null;
  for (const r of roots) {
    if (isUnder(path, r.path, platform) && (!best || normPath(r.path, platform).length > normPath(best.base, platform).length)) best = { kind: r.kind, base: r.path };
  }
  return best;
}

/** PowerShell の出力（UTF-8 の JSON）を読む。documents は文字列、mounts は文字列か配列。 */
export function parseShellOutput(out: Buffer | string): { documents: string | null; mounts: string[] } {
  const text = (typeof out === "string" ? out : out.toString("utf8")).replace(/^﻿/, "").trim();
  try {
    const v = JSON.parse(text) as { documents?: unknown; mounts?: unknown };
    const documents = typeof v.documents === "string" && v.documents.length > 0 ? v.documents : null;
    const mounts = (Array.isArray(v.mounts) ? v.mounts : typeof v.mounts === "string" ? [v.mounts] : []).filter((m): m is string => typeof m === "string" && m.length > 0);
    return { documents, mounts };
  } catch {
    return { documents: null, mounts: [] };
  }
}

const PS_SCRIPT = [
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$d = [Environment]::GetFolderPath('MyDocuments')",
  "$m = @(Get-ChildItem 'HKCU:\\Software\\SyncEngines\\Providers\\OneDrive' -ErrorAction SilentlyContinue | ForEach-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).MountPoint } | Where-Object { $_ })",
  "ConvertTo-Json -Compress @{ documents = $d; mounts = $m }",
].join("; ");

export type ShellRunner = () => Promise<{ documents: string | null; mounts: string[] }>;

/** Windows の調べ方（読むだけ。何も変えない） */
export const windowsShell: ShellRunner = () =>
  new Promise((res) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS_SCRIPT],
      { encoding: "buffer", windowsHide: true, timeout: 15_000 },
      (err, stdout) => res(err ? { documents: null, mounts: [] } : parseShellOutput(stdout)),
    );
  });

/** Documents の場所と、同期フォルダの下かを調べる（起動のたびと、設定の画面を開いたとき）。 */
export async function detectDocuments(
  o: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; shell?: ShellRunner } = {},
): Promise<DocumentsInfo> {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  let documents: string | null = null;
  let mounts: string[] = [];
  if (platform === "win32") {
    const r = await (o.shell ?? windowsShell)();
    documents = r.documents;
    mounts = r.mounts;
  } else {
    const d = join(homedir(), "Documents");
    documents = existsSync(d) ? d : null;
  }
  const syncRoots = syncRootsOf(platform === "win32" ? env : {}, mounts);
  return { documents, synced: documents ? syncedOf(documents, syncRoots, platform) : null, syncRoots };
}

export const ROOT_NAME = "MOYAI";

/** 既定の置き場所：Documents の下の MOYAI/ */
export function defaultRoot(info: DocumentsInfo): string | null {
  return info.documents ? join(info.documents, ROOT_NAME) : null;
}

// ─── 状態フォルダのファイル ──────────────────────────────────

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJson(stateDir: string, rel: string, data: unknown): void {
  const file = join(stateDir, rel);
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

export interface Settings {
  v: 1;
  /** 人が選んだ置き場所。null は既定（Documents の下の MOYAI/） */
  root: string | null;
  /** 人が選んだ公開の台帳の clone の場所（受け手が読む）。null はまだ選んでいない */
  ledger: string | null;
  /** 自分の呼び名（版の署名と、画面の「編集の番」に出す）。null はまだ決めていない */
  name: string | null;
}

export function readSettings(stateDir: string): Settings {
  const s = readJson<Partial<Settings>>(join(stateDir, "settings.json"));
  const abs = (x: unknown) => (typeof x === "string" && isAbsolute(x) ? x : null);
  return { v: 1, root: abs(s?.root), ledger: abs(s?.ledger), name: typeof s?.name === "string" && validName(s.name) ? s.name : null };
}

export function writeSettings(stateDir: string, s: Settings): void {
  writeJson(stateDir, "settings.json", s);
}

/** 置き場所の道を確かめる：絶対の道だけ。 */
export function validRoot(p: unknown): string | null {
  if (typeof p !== "string") return null;
  const t = p.trim();
  if (t.length === 0 || t.length > 1000 || !isAbsolute(t) || t.includes("\u0000")) return null;
  return resolve(t);
}

export interface RingEntry {
  ringId: string;
  /** 輪のフォルダ（<輪のフォルダ>/<輪ID>/ の上） */
  root: string;
  pack: string;
  /** この輪の自分の鍵 ID */
  key: string;
  /** 人が受け入れた決まり（circle.json のバイト列の SHA-256 と、その決まり） */
  acceptedRulesHash: string;
  acceptedRules: Rules;
  createdAt: string;
}

export interface RingsFile {
  /** 輪のフォルダ。scripts/guard-hook.mjs がこの一覧を読み、AI のツールの書き込みを止める */
  folders: string[];
  rings: RingEntry[];
  /** 電話で指紋を読み合わせた仲間の鍵 ID（読み合わせの画面は未実装。自分の鍵は数えなくても確認済み） */
  confirmed: string[];
}

export function readRings(stateDir: string): RingsFile {
  const r = readJson<Partial<RingsFile>>(join(stateDir, "rings.json"));
  return {
    folders: Array.isArray(r?.folders) ? r.folders.filter((f): f is string => typeof f === "string") : [],
    rings: Array.isArray(r?.rings) ? r.rings.filter((x) => x && typeof x.ringId === "string" && HEX16.test(x.ringId)) : [],
    confirmed: Array.isArray(r?.confirmed) ? r.confirmed.filter((k): k is string => typeof k === "string" && HEX16.test(k)) : [],
  };
}

export function writeRings(stateDir: string, r: RingsFile): void {
  writeJson(stateDir, "rings.json", r);
}

export function addRing(stateDir: string, e: RingEntry): RingsFile {
  const cur = readRings(stateDir);
  const folders = cur.folders.some((f) => normPath(f) === normPath(e.root)) ? cur.folders : [...cur.folders, e.root];
  const next: RingsFile = { folders, rings: [...cur.rings.filter((x) => x.ringId !== e.ringId), e], confirmed: cur.confirmed };
  writeRings(stateDir, next);
  return next;
}

export function keyFile(stateDir: string, ringId: string): string {
  if (!HEX16.test(ringId)) throw new Error("輪 ID の形でない");
  return join(stateDir, "keys", `${ringId}.json`);
}

export function readWrappedKey(stateDir: string, ringId: string): WrappedKey | null {
  const w = readJson<WrappedKey>(keyFile(stateDir, ringId));
  return w && w.v === "moyai.wrapped-key/0" ? w : null;
}

/** 包んだ秘密鍵を置く。同じ輪の鍵があれば上書きしない（鍵を作り直すのは未実装）。 */
export function writeWrappedKey(stateDir: string, ringId: string, w: WrappedKey): boolean {
  if (existsSync(keyFile(stateDir, ringId))) return false;
  writeJson(stateDir, join("keys", `${ringId}.json`), w);
  return true;
}

export interface SentEntry {
  ringId: string;
  key: string;
  seq: number;
  hash: string;
  fileName: string;
  month: string;
  at: string;
}

/** 持ち出し簿：検問所を通して置いた束のハッシュ（中身は残さない） */
export function readSent(stateDir: string): SentEntry[] {
  const s = readJson<{ entries?: SentEntry[] }>(join(stateDir, "sent.json"));
  return Array.isArray(s?.entries) ? s.entries : [];
}

export function appendSent(stateDir: string, e: SentEntry): void {
  writeJson(stateDir, "sent.json", { entries: [...readSent(stateDir), e] });
}
