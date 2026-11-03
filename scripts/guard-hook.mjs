#!/usr/bin/env node
// PreToolUse のフック。シェルを持つ AI（Claude Code など）から、人だけの操作と状態フォルダを外す。
// .claude/settings.json の deny と二重にする。判定は decide() の純粋な関数で、tests/scripts で試験する。
// 悪意のある同じ利用者のプロセスは止めきれない（docs/security.md）。
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// 127 の短い書き方（127.1）・10 進（2130706433 から）・16 進（0x7f000001）・IPv6 の写し（::ffff:127.0.0.1）も含める
const LOOPBACK =
  /(\b127(?:\.\d{1,3}){1,3}\b|\blocalhost\b|\[::1\]|(?<![\w:])::1(?![\w:])|\b0\.0\.0\.0\b|\b0x7f[0-9a-f]{6}\b|\b21307064\d\d\b|::ffff:127\.)/i;
const HTTP_CLIENT =
  /(\bcurl\b|\bwget\b|\bInvoke-WebRequest\b|\bInvoke-RestMethod\b|\biwr\b|\birm\b|\bhttpie\b|\bhttp\s+(?:get|post|put)\b|\bfetch\s*\(|\bNet\.WebClient\b|\bHttpClient\b|\bXMLHttpRequest\b|\baxios\b|\bundici\b|\bhttp\.request\b|\bhttp\.get\b|\bnc\b|\bncat\b|\btelnet\b|\bwebsocat\b|\bWebSocket\s*\(|\burllib\b|\brequests\.|\bhttp\.client\b|\bhttpx\b|\baiohttp\b|\bNet\.Sockets\b|\bTcpClient\b|\bsocket\.(?:create_connection|socket)\b|\bnet\.connect\b|\bTest-NetConnection\b)/i;
const PREVIOUS_PRODUCT = /(mxstage|hoshutaro)/i;
const FETCH_VERB =
  /(\bclone\b|\bfetch\b|\bpull\b|\bsubmodule\b|\binstall\b|\bnpm\s+i\b|\bnpm\s+view\b|\bnpx\b|\bpnpm\b|\byarn\b|\bcurl\b|\bwget\b|\biwr\b|\birm\b|\bInvoke-WebRequest\b|\bInvoke-RestMethod\b|\bgh\s+(?:api|repo|release)\b|\bdownload\b|\bls-remote\b|\barchive\b|\bsvn\b)/i;
// MOYAI の CLI を呼ぶ形（node dist/cli.js、npm run cli、moyai）のあと、同じコマンドの中（; & | 改行の手前）に
// 人だけの動詞が来たら当てる。間に別の引数があっても当てる。フォルダ名の Moyai だけでは当てない。
const HUMAN_ONLY_VERBS = String.raw`(?:ledger\s+submit|keys?\s+(?:create|new|unwrap)|send|confirm|promote|accept-rules)\b`;
// cli（拡張子は省いてもよい）・npm run cli・moyai のあと、同じコマンドの中に動詞が来たら当てる。引用符は外してから見る
const HUMAN_ONLY_CLI = new RegExp(
  String.raw`(?:\bcli(?:\.(?:m?js|ts))?\b|\bnpm\s+run\s+cli\b|(?:^|[\s;&|(])moyai(?:\.cmd|\.exe)?\s)[^;&|\n]*?\b` + HUMAN_ONLY_VERBS,
  "i",
);
const unquote = (s) => String(s ?? "").replace(/["'`]/g, " ");
const WRITE_VERB =
  /(>>?|\bcp\b|\bmv\b|\brm\b|\bdel\b|\btee\b|\btouch\b|\bmkdir\b|\bCopy-Item\b|\bMove-Item\b|\bRemove-Item\b|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\bNew-Item\b|\brobocopy\b|\bxcopy\b|\brename\b|\bren\b|writeFile|appendFile)/i;
const PREVIOUS_PRODUCT_URL = [
  /^https?:\/\/(?:www\.)?github\.com\/mxstage(?:\/|$)/i,
  /^https?:\/\/(?:www\.)?github\.com\/woodygaragelab\/hoshutaro(?:\/|$|\.git)/i,
  /^https?:\/\/raw\.githubusercontent\.com\/(?:mxstage|woodygaragelab\/hoshutaro)(?:\/|$)/i,
  /^https?:\/\/(?:[\w-]+\.)*mxstage\.tsunagi\.app(?:\/|$)/i,
  /^https?:\/\/api\.github\.com\/(?:repos\/)?(?:mxstage|woodygaragelab\/hoshutaro)(?:\/|$)/i,
  /^https?:\/\/codeload\.github\.com\/(?:mxstage|woodygaragelab\/hoshutaro)(?:\/|$)/i,
  /^https?:\/\/(?:www\.)?npmjs\.(?:com|org)\/package\/\S*(?:mxstage|hoshutaro)/i,
  /^https?:\/\/registry\.npmjs\.org\/\S*(?:mxstage|hoshutaro)/i,
];

/** ホストの名前が自分の PC（127.0.0.0/8・::1・IPv4 の写しの ::ffff:7f..・localhost・0.0.0.0）か。 */
export function isLoopbackHost(hostname) {
  const h = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0") return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (/^::ffff:(?:127\.|7f[0-9a-f]{2}:)/.test(h)) return true;
  return false;
}

/**
 * コマンドの中の URL やホスト:ポートを拾い、WHATWG の URL で読み直して自分の PC を指すかを見る。
 * 8 進（0177.0.0.1）・10 進（2130706433）・16 進（0x7f000001）・短い形（127.1）・IPv6 の長い形も、読み直すと 127.0.0.1 や ::1 になる。
 */
export function mentionsLoopback(cmd) {
  const s = String(cmd ?? "").replace(/["'`]/g, " ");
  const candidates = [];
  for (const m of s.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>()]+/gi)) candidates.push(m[0]);
  // スキームの無いホスト:ポート（curl 127.1:43110 など）と、角かっこの IPv6
  for (const m of s.matchAll(/(?:^|[\s=@])(\[[0-9a-f:.]+\]|[0-9a-z.]+):\d{1,5}\b/gi)) candidates.push(`http://${m[1]}:1`);
  for (const c of candidates) {
    try {
      if (isLoopbackHost(new URL(c).hostname)) return true;
    } catch {
      /* URL として読めないものは下の文字の判定に任せる */
    }
  }
  return LOOPBACK.test(s);
}

/** 文字列の中のパスを比べやすい形にする（小文字、/ 区切り、Git Bash の /d/ を d:/ に）。 */
function norm(s) {
  return String(s ?? "")
    .replace(/\\/g, "/")
    .toLowerCase()
    .replace(/(^|[\s"'=(])\/([a-z])\//g, "$1$2:/");
}

/** 状態フォルダの候補（環境変数の書き方も含む）。 */
export function stateDirPatterns(env = process.env) {
  const out = [
    "appdata/local/moyai",
    "%localappdata%/moyai",
    "$env:localappdata/moyai",
    "${env:localappdata}/moyai",
    ".local/state/moyai",
    "library/application support/moyai",
  ];
  if (env.MOYAI_STATE_DIR) out.push(norm(env.MOYAI_STATE_DIR).replace(/\/+$/, ""));
  return out;
}

function mentionsStateDir(text, env) {
  const t = norm(text).replace(/["'`]/g, "").replace(/\s*\/\s*/g, "/");
  if (stateDirPatterns(env).some((p) => t.includes(p))) return true;
  // $env:LOCALAPPDATA と MOYAI を別々に組み立てる書き方（Join-Path など）
  return /(\$env:localappdata|%localappdata%|\blocalappdata\b)/.test(t) && /\bmoyai\b/.test(t);
}

/** 状態フォルダの設定から輪のフォルダを読む。無ければ空。 */
export function ringFolders(env = process.env) {
  const base =
    env.MOYAI_STATE_DIR ||
    (process.platform === "win32"
      ? join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "MOYAI", "state")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support", "MOYAI", "state")
        : join(homedir(), ".local", "state", "moyai"));
  const file = join(base, "rings.json");
  try {
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed?.folders) ? parsed.folders.filter((f) => typeof f === "string" && f) : [];
  } catch {
    return [];
  }
}

function underAny(path, folders) {
  const p = norm(path);
  return folders.some((f) => {
    const n = norm(f).replace(/\/+$/, "");
    return n && (p === n || p.startsWith(n + "/"));
  });
}

/**
 * 判定。戻り値は止めるときだけ { deny: true, reason }。通すときは { deny: false }。
 * @param {{ tool_name?: string, tool_input?: Record<string, unknown> }} input
 * @param {{ env?: NodeJS.ProcessEnv, rings?: string[] }} [ctx]
 */
export function decide(input, ctx = {}) {
  const env = ctx.env ?? process.env;
  const rings = ctx.rings ?? ringFolders(env);
  const tool = String(input?.tool_name ?? "");
  const ti = input?.tool_input ?? {};
  const deny = (reason) => ({ deny: true, reason: `MOYAI の見張り：${reason}` });

  if (tool === "Bash" || tool === "PowerShell") {
    const cmd = String(ti.command ?? "");
    if (mentionsLoopback(cmd) && HTTP_CLIENT.test(cmd)) {
      return deny("127.0.0.1 の橋渡しへの HTTP は人だけの経路を越えうるので、AI からは送りません。画面で操作してください。");
    }
    if (mentionsStateDir(cmd, env)) {
      return deny("状態フォルダ（鍵・持ち出し簿・対応表）には AI から触れません。");
    }
    if (PREVIOUS_PRODUCT.test(cmd) && FETCH_VERB.test(cmd)) {
      return deny("前の製品のリポジトリと配布物は取得しない決まりです。");
    }
    if (HUMAN_ONLY_CLI.test(unquote(cmd))) {
      return deny("このコマンドは人だけの操作です。端末で人が打ってください。");
    }
    if (rings.length && WRITE_VERB.test(cmd) && rings.some((r) => norm(cmd).includes(norm(r).replace(/\/+$/, "")))) {
      return deny("輪のフォルダには、検問所を通した束を橋渡しだけが書きます。");
    }
    return { deny: false };
  }

  if (tool === "Read" || tool === "Grep" || tool === "Glob" || tool === "NotebookRead") {
    const paths = [ti.file_path, ti.path, ti.pattern, ti.notebook_path].filter((v) => typeof v === "string");
    if (paths.some((p) => mentionsStateDir(p, env))) {
      return deny("状態フォルダ（鍵・持ち出し簿・対応表）は AI から読みません。");
    }
    return { deny: false };
  }

  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const p = String(ti.file_path ?? ti.notebook_path ?? "");
    if (mentionsStateDir(p, env)) return deny("状態フォルダには AI から書きません。");
    if (underAny(p, rings)) return deny("輪のフォルダには、検問所を通した束を橋渡しだけが書きます。");
    return { deny: false };
  }

  if (tool === "WebFetch") {
    const url = String(ti.url ?? "").trim();
    if (PREVIOUS_PRODUCT_URL.some((re) => re.test(url))) {
      return deny("前の製品のリポジトリと配り先は取得しない決まりです。");
    }
    return { deny: false };
  }

  return { deny: false };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // 判定できないときは止める（壊れたときに開く守りにしない）。
    writeDeny("MOYAI の見張り：入力を読めず、判定できなかったので止めました。");
    return;
  }
  const r = decide(input);
  if (r.deny) writeDeny(r.reason);
}

function writeDeny(reason) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    writeDeny("MOYAI の見張り：判定の途中で誤りが起きたので止めました。");
  });
}
