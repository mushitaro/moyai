// GitHub とのやりとり：公開の台帳への PR（docs/plan.md §2.8・§2.12 の通信の例外。運営者の決定、2026-11-04「MOYAI が出す」）。
// 行き先は github.com と api.github.com だけ。試験のときだけ、環境変数で 127.0.0.1 の試験の台に向けられる（ほかの行き先は受けない）。
// - つなぐ：OAuth のデバイスフロー（人が github.com でコードを入れる）。scope は public_repo だけ。
// - 出す：人が SHARE で主ボタンを押して束に署名したときだけ。台帳をフォークし、束のファイル 1 つを足す枝を作り、台帳に PR を出す。
// - 行方：SHARE を開いたときだけ、公開の PR をトークン無しで読む（審査中・検証の ✓ ✗・載った・差し戻しの理由）。
// トークンは返り値と、状態フォルダのファイル（包まない。見張りのフックが AI の読み取りを止める）にだけ置く。ログ・画面・AI には出さない。
// fetch と待ちは差し替えられる（試験のため）。どの呼び出しにも時間の上限を付ける。

export interface GitHubHosts {
  /** github.com（デバイスフローの入口） */
  web: string;
  /** api.github.com */
  api: string;
}

/**
 * OAuth App の Client ID（秘密ではない値。Client secret は使わない）。運営者が GitHub に MOYAI の OAuth App を登録し、
 * デバイスフローを許してから入れる。null の間は、SHARE は「GitHub につなぐ」を押せず、理由を出す。
 */
export const GITHUB_CLIENT_ID: string | null = "Ov23litNaRa8MtHyXFGc";

export const GITHUB_HOSTS: GitHubHosts = { web: "https://github.com", api: "https://api.github.com" };
export const GITHUB_SCOPE = "public_repo";
/** 台帳の PR の必須のチェックの名前（MOYAI のリポジトリの .github/workflows/ledger-validate.yml と同じ） */
export const LEDGER_CHECK = "ledger-validate";
const TIMEOUT_MS = 20_000;
const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}$/;

/** 行き先：既定は GitHub。MOYAI_GITHUB_WEB と MOYAI_GITHUB_API が両方 127.0.0.1 の試験の台を指すときだけ、そちらに向ける */
export function githubHostsOf(env: NodeJS.ProcessEnv): GitHubHosts {
  const web = env.MOYAI_GITHUB_WEB?.replace(/\/+$/, "");
  const api = env.MOYAI_GITHUB_API?.replace(/\/+$/, "");
  return web && api && LOOPBACK.test(web) && LOOPBACK.test(api) ? { web, api } : GITHUB_HOSTS;
}

/** OAuth App の Client ID（秘密ではない値）。config/github.json に置く。試験の台に向けたときだけ、環境変数で替えられる */
export function githubClientIdOf(configured: string | null, env: NodeJS.ProcessEnv, hosts: GitHubHosts): string | null {
  if (hosts !== GITHUB_HOSTS && env.MOYAI_GITHUB_CLIENT_ID) return env.MOYAI_GITHUB_CLIENT_ID;
  return configured && /^[A-Za-z0-9._-]{8,64}$/.test(configured) ? configured : null;
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
export interface GitHubIo {
  hosts: GitHubHosts;
  fetch: Fetch;
  sleep: (ms: number) => Promise<void>;
}

export function githubIo(hosts: GitHubHosts): GitHubIo {
  return { hosts, fetch: (u, i) => fetch(u, i), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
}

const HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "moyai" };

async function call(io: GitHubIo, method: string, url: string, token: string | null, body?: unknown, accept?: string): Promise<{ status: number; json: Record<string, unknown> | unknown[] | null } | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await io.fetch(url, {
      method,
      headers: { ...HEADERS, ...(accept ? { accept } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: ctl.signal,
    });
    let json: Record<string, unknown> | unknown[] | null = null;
    try {
      const j = await r.json();
      json = j && typeof j === "object" ? (j as Record<string, unknown> | unknown[]) : null;
    } catch {
      json = null;
    }
    return { status: r.status, json };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const obj = (j: unknown): Record<string, unknown> => (j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

// ─── つなぐ（デバイスフロー） ─────────────────────────────────

export type DeviceStart =
  | { ok: true; deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }
  | { ok: false; reason: "network" | "refused" };

/** デバイスフローを始める：人が github.com で入れるコードと、その場所を受け取る */
export async function startDevice(io: GitHubIo, clientId: string): Promise<DeviceStart> {
  // github.com の入口は、Accept が application/json のときだけ JSON で返す
  const r = await call(io, "POST", `${io.hosts.web}/login/device/code`, null, { client_id: clientId, scope: GITHUB_SCOPE }, "application/json");
  if (!r) return { ok: false, reason: "network" };
  const j = obj(r.json);
  const deviceCode = str(j.device_code);
  const userCode = str(j.user_code);
  const verificationUri = str(j.verification_uri);
  if (r.status !== 200 || !deviceCode || !userCode || !verificationUri || !/^https?:\/\//.test(verificationUri)) return { ok: false, reason: "refused" };
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d);
  return { ok: true, deviceCode, userCode, verificationUri, expiresIn: n(j.expires_in, 900), interval: n(j.interval, 5) };
}

export type DevicePoll = { state: "pending" } | { state: "slowDown" } | { state: "ok"; token: string } | { state: "expired" } | { state: "denied" } | { state: "failed" };

/** 人がコードを入れたかを 1 回だけ聞く（間隔は呼ぶ側が守る） */
export async function pollDevice(io: GitHubIo, clientId: string, deviceCode: string): Promise<DevicePoll> {
  const r = await call(io, "POST", `${io.hosts.web}/login/oauth/access_token`, null, {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  }, "application/json");
  if (!r) return { state: "pending" };
  const j = obj(r.json);
  const token = str(j.access_token);
  if (token) {
    // 頼んだ scope が付いていなければ使わない（public_repo より広くも狭くもしない）
    const scopes = (str(j.scope) ?? "").split(/[,\s]+/).filter(Boolean);
    return scopes.includes(GITHUB_SCOPE) ? { state: "ok", token } : { state: "failed" };
  }
  switch (j.error) {
    case "authorization_pending":
      return { state: "pending" };
    case "slow_down":
      return { state: "slowDown" };
    case "expired_token":
      return { state: "expired" };
    case "access_denied":
      return { state: "denied" };
    default:
      return { state: "failed" };
  }
}

/** トークンの持ち主のアカウント名（画面に出す。PR を出すアカウントは誰にでも見えるため） */
export async function whoAmI(io: GitHubIo, token: string): Promise<string | null> {
  const r = await call(io, "GET", `${io.hosts.api}/user`, token);
  const login = r && r.status === 200 ? str(obj(r.json).login) : null;
  return login && /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : null;
}

// ─── 台帳のリポジトリ ─────────────────────────────────────────

export interface Repo {
  owner: string;
  name: string;
}

const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** 台帳の clone の origin の URL から、GitHub のリポジトリを読む（https と ssh の書き方）。GitHub でなければ null */
export function repoOfRemote(url: string | null): Repo | null {
  if (!url) return null;
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(url.trim());
  return m && NAME.test(m[2]!) ? { owner: m[1]!, name: m[2]! } : null;
}

const repoPath = (r: Repo) => `${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;

// ─── 出す（フォーク → 枝 → 束のファイル → PR） ───────────────────

export interface LedgerPrInput {
  upstream: Repo;
  /** 台帳の中の束の道（MOYAI のリポジトリの根から ledger/ledger/bundles/<鍵ID>/<連番>-<ハッシュ先頭16>.json） */
  path: string;
  bytes: Uint8Array;
  branch: string;
  title: string;
  body: string;
  commitMessage: string;
}

export type LedgerPrResult =
  | { ok: true; number: number; url: string; login: string; fork: string }
  | { ok: false; reason: "network" | "unauthorized" | "noRepo" | "forkFailed" | "branchFailed" | "fileFailed" | "prFailed" };

/**
 * 台帳に PR を出す。台帳は MOYAI のリポジトリの ledger/（2026-11-07 に移した）なので、フォークするのは MOYAI のリポジトリ（mushitaro/moyai）。
 * 利用者のアカウントで台帳のリポジトリをフォークし（もうあればそれを使う）、台帳の既定のブランチの先から枝を作り、
 * 束のファイル 1 つを足して、台帳の既定のブランチへ PR を出す。台帳のファイルはほかに変えない。
 */
export async function openLedgerPr(io: GitHubIo, token: string, i: LedgerPrInput): Promise<LedgerPrResult> {
  const A = io.hosts.api;
  const login = await whoAmI(io, token);
  if (!login) return { ok: false, reason: "unauthorized" };
  const up = await call(io, "GET", `${A}/repos/${repoPath(i.upstream)}`, token);
  if (!up) return { ok: false, reason: "network" };
  const base = up.status === 200 ? str(obj(up.json).default_branch) : null;
  if (!base) return { ok: false, reason: "noRepo" };
  const ref = await call(io, "GET", `${A}/repos/${repoPath(i.upstream)}/git/ref/heads/${encodeURIComponent(base)}`, token);
  const baseSha = ref && ref.status === 200 ? str(obj(obj(ref.json).object).sha) : null;
  if (!baseSha || !/^[0-9a-f]{40}$/.test(baseSha)) return { ok: false, reason: "noRepo" };

  // 台帳の持ち主のアカウント（自分のリポジトリはフォークできない）：フォークせず、台帳のリポジトリに枝を作って PR を出す
  const owner = login.toLowerCase() === i.upstream.owner.toLowerCase();
  let fork: Repo = i.upstream;
  let ready = owner;
  if (!owner) {
    // フォーク（もうあれば、GitHub は同じものを返す）。できあがるまで少し待つ
    const f = await call(io, "POST", `${A}/repos/${repoPath(i.upstream)}/forks`, token, { default_branch_only: true });
    const forkName = f && (f.status === 202 || f.status === 200) ? str(obj(f.json).full_name) : null;
    const forkParts = forkName?.split("/") ?? [];
    if (!forkName || forkParts.length !== 2 || forkParts[0] !== login || !NAME.test(forkParts[1]!)) return { ok: false, reason: f ? "forkFailed" : "network" };
    fork = { owner: login, name: forkParts[1]! };
  }
  for (let n = 0; n < 10 && !ready; n++) {
    const g = await call(io, "GET", `${A}/repos/${repoPath(fork)}`, token);
    ready = !!g && g.status === 200;
    if (!ready) await io.sleep(1500);
  }
  if (!ready) return { ok: false, reason: "forkFailed" };

  // 枝：台帳の既定のブランチの先から（フォークと台帳は中身を共有するので、台帳の commit を指せる）
  const b = await call(io, "POST", `${A}/repos/${repoPath(fork)}/git/refs`, token, { ref: `refs/heads/${i.branch}`, sha: baseSha });
  if (!b || b.status !== 201) return { ok: false, reason: b ? "branchFailed" : "network" };
  const put = await call(io, "PUT", `${A}/repos/${repoPath(fork)}/contents/${i.path.split("/").map(encodeURIComponent).join("/")}`, token, {
    message: i.commitMessage,
    content: Buffer.from(i.bytes).toString("base64"),
    branch: i.branch,
  });
  if (!put || put.status !== 201) return { ok: false, reason: put ? "fileFailed" : "network" };
  const pr = await call(io, "POST", `${A}/repos/${repoPath(i.upstream)}/pulls`, token, {
    title: i.title,
    body: i.body,
    head: `${login}:${i.branch}`,
    base,
    maintainer_can_modify: false,
  });
  const pj = obj(pr?.json);
  const number = typeof pj.number === "number" && Number.isInteger(pj.number) ? pj.number : null;
  const url = str(pj.html_url);
  if (!pr || pr.status !== 201 || number === null || !url) return { ok: false, reason: pr ? "prFailed" : "network" };
  return { ok: true, number, url, login, fork: `${fork.owner}/${fork.name}` };
}

// ─── 行方（公開の PR をトークン無しで読む） ─────────────────────

export interface PrStatus {
  number: number;
  url: string;
  /** 審査中・載った・閉じた（載らなかった） */
  state: "open" | "merged" | "closed";
  /** 台帳の検証（必須のチェック）：走っている・✓・✗・まだ無い */
  check: "pending" | "ok" | "ng" | "none";
  /** 検証が ✗ か、載らずに閉じたときの理由（台帳の検証が PR に書いた文の頭の数行）。無ければ null */
  reason: string | null;
}

const REASON_MAX = 400;

/** PR の行方を読む。読めなければ null（画面は「読めませんでした」と出し、黙って捨てない） */
export async function prStatus(io: GitHubIo, upstream: Repo, number: number): Promise<PrStatus | null> {
  const A = io.hosts.api;
  const r = await call(io, "GET", `${A}/repos/${repoPath(upstream)}/pulls/${number}`, null);
  if (!r || r.status !== 200) return null;
  const j = obj(r.json);
  const url = str(j.html_url);
  const sha = str(obj(j.head).sha);
  if (!url || !sha || !/^[0-9a-f]{40}$/.test(sha)) return null;
  const state: PrStatus["state"] = j.merged === true || str(j.merged_at) ? "merged" : j.state === "closed" ? "closed" : "open";
  const c = await call(io, "GET", `${A}/repos/${repoPath(upstream)}/commits/${sha}/check-runs?check_name=${LEDGER_CHECK}`, null);
  const run = c && c.status === 200 ? obj((obj(c.json).check_runs as unknown[] | undefined)?.[0]) : {};
  const check: PrStatus["check"] = !run.status ? "none" : run.status !== "completed" ? "pending" : run.conclusion === "success" ? "ok" : "ng";
  let reason: string | null = null;
  if (check === "ng" || state === "closed") {
    const cm = await call(io, "GET", `${A}/repos/${repoPath(upstream)}/issues/${number}/comments?per_page=100`, null);
    const list = cm && cm.status === 200 && Array.isArray(cm.json) ? cm.json.map(obj) : [];
    const last = [...list].reverse().find((x) => obj(x.user).type === "Bot" || obj(x.user).login === "github-actions[bot]");
    const text = str(last?.body);
    if (text) {
      reason = text
        .split(/\r?\n/)
        .map((l) => l.replace(/^[#>*\-\s]+/, "").replace(/[`*_]/g, "").trim())
        .filter(Boolean)
        .slice(0, 6)
        .join(" / ")
        .slice(0, REASON_MAX);
    }
  }
  return { number, url, state, check, reason };
}
