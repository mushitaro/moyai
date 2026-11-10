// 受け口と GitHub のやりとり。行き先は api.github.com だけ。トークンは運営者の fine-grained のもの（台帳のリポジトリだけ、contents と pull requests の書き込み）。
// - 読む：台帳の既定のブランチの先の木から、ledger.json と、出した束と同じ鍵の束だけ（台帳の検証の CLI と同じく、100644 のファイルだけ中身を読む）。
// - 前の PR：枝 intake/<ハッシュの頭 16 字> の PR（閉じたものも）。
// - 出す：台帳のリポジトリに枝を作り、束のファイル 1 つを置き、PR を出す。途中で止まった前の試みが残っていても、同じ枝・同じファイルなら続きから出す。
// - 取り下げ（Architect の 72）：その鍵の束の開いた PR を探し、「本人が取り下げた」と書いて閉じる。
// 台帳は MOYAI のリポジトリの ledger/（2026-11-07 に移した）。木の道はリポジトリの根から（ledger/ledger/…）。
// トークンは authorization の見出しにだけ入れる。答え・ログには出さない。fetch は差し替えられる（試験のため）。
// 転送（3xx）はたどらない（トークンを api.github.com の外へ運ばない。たどらずに誤りにする）。
import { LEDGER_BUNDLE_PATH, LEDGER_JSON_PATH, LEDGER_LIMITS, ledgerKeyFolder, type LedgerFile } from "../../../src/share/ledger";

export const GITHUB_API = "https://api.github.com";
const TIMEOUT_MS = 20_000;
/** 1 つの鍵の束の数の上限（月に 1 つなら何十年分もある）。越えたら読まずに止める */
export const KEY_FILES_MAX = 500;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: "manual" },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface Repo {
  owner: string;
  name: string;
}

export interface Gh {
  fetch: FetchLike;
  token: string;
  repo: Repo;
}

/** 変数 LEDGER_REPO（owner/name）を読む。形が違えば null */
export function repoOf(s: string | undefined | null): Repo | null {
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec((s ?? "").trim());
  if (!m || m[2] === "." || m[2] === "..") return null;
  return { owner: m[1]!, name: m[2]! };
}

const HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "moyai-ledger-intake" };

type Json = Record<string, unknown> | unknown[] | null;

async function call(gh: Gh, method: string, path: string, body?: unknown): Promise<{ status: number; json: Json } | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await gh.fetch(`${GITHUB_API}/repos/${encodeURIComponent(gh.repo.owner)}/${encodeURIComponent(gh.repo.name)}${path}`, {
      method,
      headers: { ...HEADERS, authorization: `Bearer ${gh.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: ctl.signal,
      redirect: "manual",
    });
    let json: Json = null;
    try {
      const j = await r.json();
      json = j && typeof j === "object" ? (j as Json) : null;
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
const SHA = /^[0-9a-f]{40}$/;
const refPath = (ref: string) => ref.split("/").map(encodeURIComponent).join("/");

export interface PrRef {
  number: number;
  url: string;
}

function prOf(j: unknown): PrRef | null {
  const o = obj(j);
  const number = typeof o.number === "number" && Number.isInteger(o.number) && o.number > 0 ? o.number : null;
  const url = str(o.html_url);
  return number !== null && url && url.startsWith("https://github.com/") ? { number, url } : null;
}

/** 台帳の既定のブランチと、その先の commit */
export async function ledgerBase(gh: Gh): Promise<{ base: string; sha: string } | null> {
  const r = await call(gh, "GET", "");
  const base = r && r.status === 200 ? str(obj(r.json).default_branch) : null;
  if (!base) return null;
  const ref = await call(gh, "GET", `/git/ref/heads/${refPath(base)}`);
  const sha = ref && ref.status === 200 ? str(obj(obj(ref.json).object).sha) : null;
  return sha && SHA.test(sha) ? { base, sha } : null;
}

/**
 * 台帳の木から、ledger.json と、その鍵のフォルダ（ledger/ledger/bundles/<鍵ID>/）の下の項目を読む。
 * 100644 の blob だけ中身を読み（上限を越えるものは読まない）、symlink・submodule・ほかの形は中身を読まずに形だけ返す。読めなければ null
 */
export async function readLedgerFiles(gh: Gh, sha: string, key: string): Promise<LedgerFile[] | null> {
  const t = await call(gh, "GET", `/git/trees/${sha}?recursive=1`);
  if (!t || t.status !== 200) return null;
  const tj = obj(t.json);
  // 木が大きすぎて切られていたら、鍵の束を見落とすので受けない
  if (tj.truncated === true || !Array.isArray(tj.tree)) return null;
  const folder = `${ledgerKeyFolder(key)}/`;
  const picked = tj.tree.map(obj).filter((e) => {
    const p = str(e.path);
    return p !== null && e.type !== "tree" && (p === LEDGER_JSON_PATH || p.startsWith(folder));
  });
  if (picked.length > KEY_FILES_MAX + 1) return null;
  const out: LedgerFile[] = [];
  for (const e of picked) {
    const path = str(e.path)!;
    if (e.mode === "120000") out.push({ path, kind: "symlink", bytes: null });
    else if (e.mode === "160000") out.push({ path, kind: "submodule", bytes: null });
    else if (e.mode === "100644" && e.type === "blob") {
      const blob = str(e.sha);
      const size = typeof e.size === "number" ? e.size : null;
      if (!blob || !SHA.test(blob)) return null;
      if (size === null || size > LEDGER_LIMITS.fileBytes) {
        out.push({ path, kind: "file", bytes: null });
        continue;
      }
      const b = await call(gh, "GET", `/git/blobs/${blob}`);
      const bj = obj(b?.json);
      const content = str(bj.content);
      if (!b || b.status !== 200 || bj.encoding !== "base64" || content === null) return null;
      const bytes = new Uint8Array(Buffer.from(content, "base64"));
      out.push({ path, kind: "file", bytes: bytes.length > LEDGER_LIMITS.fileBytes ? null : bytes });
    } else out.push({ path, kind: "other", bytes: null });
  }
  return out;
}

/** PR の head が、台帳のリポジトリの中のこの枝か（フォークの同じ名前の枝を取り違えない） */
function headIs(gh: Gh, j: unknown, branch: string | null): boolean {
  const head = obj(obj(j).head);
  const full = str(obj(head.repo).full_name);
  if (!full || full.toLowerCase() !== `${gh.repo.owner}/${gh.repo.name}`.toLowerCase()) return false;
  return branch === null || head.ref === branch;
}

/** 枝の PR（閉じたものも）。無ければ null、読めなければ "error"。返った PR の head が、台帳のリポジトリのこの枝でなければ "error" */
export async function findPr(gh: Gh, branch: string): Promise<PrRef | null | "error"> {
  const head = encodeURIComponent(`${gh.repo.owner}:${branch}`);
  const r = await call(gh, "GET", `/pulls?head=${head}&state=all&per_page=1`);
  if (!r || r.status !== 200 || !Array.isArray(r.json)) return "error";
  if (r.json.length === 0) return null;
  return headIs(gh, r.json[0], branch) ? (prOf(r.json[0]) ?? "error") : "error";
}

export interface OpenPrInput {
  base: string;
  baseSha: string;
  branch: string;
  path: string;
  bytes: Uint8Array;
  title: string;
  body: string;
  commitMessage: string;
}

export type OpenPrResult = ({ ok: true } & PrRef) | { ok: false; step: "branch" | "file" | "pr" };

/** 枝を作り、束のファイル 1 つを置き、台帳の既定のブランチへ PR を出す。台帳のほかのファイルは変えない */
export async function openPr(gh: Gh, i: OpenPrInput): Promise<OpenPrResult> {
  const b = await call(gh, "POST", "/git/refs", { ref: `refs/heads/${i.branch}`, sha: i.baseSha });
  if (!b || (b.status !== 201 && b.status !== 422)) return { ok: false, step: "branch" };
  if (b.status === 422) {
    // 前の試みが作った枝なら、そのまま使う。ただし、既定のブランチとの差がこの 1 つのファイルだけのときに限る
    // （ほかの変更を持つ枝を、受け口の PR として運営者のアカウントで出さない）
    const g = await call(gh, "GET", `/git/ref/heads/${refPath(i.branch)}`);
    if (!g || g.status !== 200) return { ok: false, step: "branch" };
    const c = await call(gh, "GET", `/compare/${i.baseSha}...${refPath(i.branch)}`);
    const files = c && c.status === 200 ? obj(c.json).files : null;
    if (!Array.isArray(files) || files.length > 1 || !files.every((f) => str(obj(f).filename) === i.path)) return { ok: false, step: "branch" };
  }
  const put = await call(gh, "PUT", `/contents/${refPath(i.path)}`, {
    message: i.commitMessage,
    content: Buffer.from(i.bytes).toString("base64"),
    branch: i.branch,
  });
  if (!put || (put.status !== 201 && put.status !== 422)) return { ok: false, step: "file" };
  if (put.status === 422) {
    // もう置いてあるなら、中身が同じかを確かめる（道の名前は中身のハッシュの頭を持つが、中身そのもので照らす）
    const g = await call(gh, "GET", `/contents/${refPath(i.path)}?ref=${encodeURIComponent(i.branch)}`);
    const content = str(obj(g?.json).content);
    if (!g || g.status !== 200 || content === null || !Buffer.from(content, "base64").equals(Buffer.from(i.bytes))) return { ok: false, step: "file" };
  }
  const pr = await call(gh, "POST", "/pulls", { title: i.title, body: i.body, head: i.branch, base: i.base, maintainer_can_modify: false });
  if (pr && pr.status === 201) {
    const p = prOf(pr.json);
    return p ? { ok: true, ...p } : { ok: false, step: "pr" };
  }
  // 同じ枝の PR がもうあれば、それを返す
  if (pr && pr.status === 422) {
    const found = await findPr(gh, i.branch);
    if (found && found !== "error") return { ok: true, ...found };
  }
  return { ok: false, step: "pr" };
}

/** 開いた PR の一覧を読む頁の上限（1 頁 100 件） */
export const OPEN_PR_PAGES = 5;

/**
 * その鍵の束の、開いた PR（受け口の PR も、利用者のフォークの PR も）。題か枝の名前に鍵 ID がある PR だけを候補にし、
 * PR のファイルがすべてその鍵のフォルダの束（ledger/ledger/bundles/<鍵ID>/<連番>-<ハッシュ>.json）のときだけ、その鍵の束の PR とする。
 * 読めなければ "error"
 */
export async function openPrsOfKey(gh: Gh, key: string): Promise<PrRef[] | "error"> {
  const out: PrRef[] = [];
  const folder = `${ledgerKeyFolder(key)}/`;
  for (let page = 1; page <= OPEN_PR_PAGES; page++) {
    const r = await call(gh, "GET", `/pulls?state=open&per_page=100&page=${page}`);
    if (!r || r.status !== 200 || !Array.isArray(r.json)) return "error";
    for (const j of r.json.map(obj)) {
      const pr = prOf(j);
      const title = str(j.title) ?? "";
      const ref = str(obj(j.head).ref) ?? "";
      if (!pr || (!title.includes(key) && !ref.includes(key))) continue;
      const f = await call(gh, "GET", `/pulls/${pr.number}/files?per_page=100`);
      if (!f || f.status !== 200 || !Array.isArray(f.json)) return "error";
      const names = f.json.map((x) => str(obj(x).filename));
      // 1 頁（100 件）で読み切れない PR は、残りのファイルを見ていないので閉じない
      if (names.length > 0 && names.length < 100 && names.every((n) => n !== null && n.startsWith(folder) && LEDGER_BUNDLE_PATH.test(n))) out.push(pr);
    }
    if (r.json.length < 100) break;
  }
  return out;
}

/**
 * 台帳のリポジトリの中の枝 intake/… から出た、開いた PR（受け口が出したもの）の題。数える上限を越えて読み切れなければ "tooMany"、
 * 読めなければ "error"。フォークの同じ名前の枝は数えない（GitHub のアカウントがあれば誰でも作れるので）
 */
export async function openIntakePrs(gh: Gh): Promise<{ title: string }[] | "tooMany" | "error"> {
  const out: { title: string }[] = [];
  for (let page = 1; page <= OPEN_PR_PAGES; page++) {
    const r = await call(gh, "GET", `/pulls?state=open&per_page=100&page=${page}`);
    if (!r || r.status !== 200 || !Array.isArray(r.json)) return "error";
    for (const j of r.json) {
      const ref = str(obj(obj(j).head).ref) ?? "";
      if (ref.startsWith("intake/") && headIs(gh, j, null)) out.push({ title: str(obj(j).title) ?? "" });
    }
    if (r.json.length < 100) return out;
  }
  return "tooMany";
}

/** PR に文を書いて閉じる（本文はそのまま渡す）。できなければ false */
export async function closePrWithComment(gh: Gh, number: number, comment: string): Promise<boolean> {
  const c = await call(gh, "POST", `/issues/${number}/comments`, { body: comment });
  if (!c || c.status !== 201) return false;
  const p = await call(gh, "PATCH", `/pulls/${number}`, { state: "closed" });
  return !!p && p.status === 200;
}
