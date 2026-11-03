#!/usr/bin/env node
// PreToolUse のフック。シェルを持つ AI（Claude Code など）から、人だけの操作と状態フォルダを外す。
// .claude/settings.json の deny と二重にする。判定は decide() の純粋な関数で、tests/scripts で試験する。
// 悪意のある同じ利用者のプロセスは止めきれない（docs/security.md）。
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const LOOPBACK = /(\b127(?:\.\d{1,3}){3}\b|\blocalhost\b|\[::1\]|(?<![\w:])::1(?![\w:])|\b0\.0\.0\.0\b)/i;
const HTTP_CLIENT =
  /(\bcurl\b|\bwget\b|\bInvoke-WebRequest\b|\bInvoke-RestMethod\b|\biwr\b|\birm\b|\bhttpie\b|\bhttp\s+(?:get|post|put)\b|\bfetch\s*\(|\bNet\.WebClient\b|\bHttpClient\b|\bXMLHttpRequest\b|\baxios\b|\bundici\b|\bhttp\.request\b|\bhttp\.get\b|\bnc\b|\bncat\b|\btelnet\b|\bwebsocat\b|\bWebSocket\s*\()/i;
const PREVIOUS_PRODUCT = /(mxstage|hoshutaro)/i;
const FETCH_VERB =
  /(\bclone\b|\bfetch\b|\bpull\b|\bsubmodule\b|\binstall\b|\bnpm\s+i\b|\bnpm\s+view\b|\bnpx\b|\bpnpm\b|\byarn\b|\bcurl\b|\bwget\b|\biwr\b|\birm\b|\bInvoke-WebRequest\b|\bInvoke-RestMethod\b|\bgh\s+(?:api|repo|release)\b|\bdownload\b)/i;
const HUMAN_ONLY_CLI =
  /(?:cli\.(?:m?js|ts)|\bmoyai)\s+(?:ledger\s+submit|keys?\s+(?:create|new|unwrap)|send|confirm|promote|accept-rules)\b/i;
const WRITE_VERB =
  /(>>?|\bcp\b|\bmv\b|\brm\b|\bdel\b|\btee\b|\btouch\b|\bmkdir\b|\bCopy-Item\b|\bMove-Item\b|\bRemove-Item\b|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\bNew-Item\b|\brobocopy\b|\bxcopy\b|\brename\b|\bren\b|writeFile|appendFile)/i;
const PREVIOUS_PRODUCT_URL = [
  /^https?:\/\/(?:www\.)?github\.com\/mxstage(?:\/|$)/i,
  /^https?:\/\/(?:www\.)?github\.com\/woodygaragelab\/hoshutaro(?:\/|$|\.git)/i,
  /^https?:\/\/raw\.githubusercontent\.com\/(?:mxstage|woodygaragelab\/hoshutaro)(?:\/|$)/i,
  /^https?:\/\/(?:[\w-]+\.)*mxstage\.tsunagi\.app(?:\/|$)/i,
];

/** 文字列の中のパスを比べやすい形にする（小文字、/ 区切り）。 */
function norm(s) {
  return String(s ?? "").replace(/\\/g, "/").toLowerCase();
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
    if (LOOPBACK.test(cmd) && HTTP_CLIENT.test(cmd)) {
      return deny("127.0.0.1 の橋渡しへの HTTP は人だけの経路を越えうるので、AI からは送りません。画面で操作してください。");
    }
    if (mentionsStateDir(cmd, env)) {
      return deny("状態フォルダ（鍵・持ち出し簿・対応表）には AI から触れません。");
    }
    if (PREVIOUS_PRODUCT.test(cmd) && FETCH_VERB.test(cmd)) {
      return deny("前の製品のリポジトリと配布物は取得しない決まりです。");
    }
    if (HUMAN_ONLY_CLI.test(cmd)) {
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
    // 入力が読めないときは通す（deny の設定が二重目の守り）。黙らずに標準エラーへ出す。
    process.stderr.write("guard-hook: 入力を読めなかったので判定していません\n");
    return;
  }
  const r = decide(input);
  if (r.deny) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: r.reason },
      }),
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    process.stderr.write(`guard-hook: ${e?.message ?? e}\n`);
  });
}
