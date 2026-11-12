// 試験の中だけで動く GitHub の代わり（メモリの中。網は使わない）。受け口（services/ledger-intake）が使う呼び出しと、
// アプリが PR の行方を読む呼び出し（src/bridge/github.ts の prStatus）だけを受ける：
// 台帳のリポジトリ・既定のブランチの先・木・blob・枝の PR の一覧・枝・ファイル・PR・PR の行方。
// 取り下げ（Architect の 72）のために、開いた PR の一覧・PR のファイル・PR への書き込み・PR を閉じる、も受ける。
// 名前の既定は架空の ledger-owner/moyai（試験が置き場所を渡すときは config/ledger.json の台帳の名前）。
// 本物の GitHub では確かめていない（報告では「GitHub の本物では未確認」と分けて書く）。届いた束のファイルは試験が受け手の関数で確かめる。
import { createHash } from "node:crypto";

export interface FakePr {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  files: Record<string, Buffer>;
  state: "open" | "closed";
  merged: boolean;
  /** PR に書かれた文（受け口が書いたもの） */
  comments: string[];
}

export interface FakeCall {
  method: string;
  url: string;
  /** authorization の見出し（無ければ null） */
  auth: string | null;
  body: string | null;
}

export interface FakeLedgerGitHub {
  owner: string;
  name: string;
  /** 既定のブランチ（main）のファイル（道 → 中身） */
  main: Map<string, Buffer>;
  /** main の木の項目の mode（既定は 100644） */
  modes: Map<string, string>;
  branches: Map<string, Map<string, Buffer>>;
  prs: FakePr[];
  calls: FakeCall[];
  /** この道（方法と道の頭）に来た呼び出しを 500 で断る（試験が GitHub の止まりを作る） */
  failOn: Set<string>;
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;
}

export const MAIN_SHA = "c".repeat(40);

function blobSha(b: Buffer): string {
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest("hex");
}

export function fakeLedgerGitHub(o: { token: string; owner?: string; name?: string; files: Record<string, string | Uint8Array> }): FakeLedgerGitHub {
  const owner = o.owner ?? "ledger-owner";
  const name = o.name ?? "moyai";
  const main = new Map<string, Buffer>(Object.entries(o.files).map(([p, c]) => [p, Buffer.from(c)]));
  const modes = new Map<string, string>();
  const branches = new Map<string, Map<string, Buffer>>();
  const prs: FakePr[] = [];
  const calls: FakeCall[] = [];
  const failOn = new Set<string>();
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const htmlUrl = (n: number) => `https://github.com/${owner}/${name}/pull/${n}`;
  const headSha = (n: number) => "b".repeat(39) + String(n % 10);

  const fetchFn: FakeLedgerGitHub["fetch"] = async (url, init) => {
    const method = init.method;
    const auth = init.headers.authorization ?? init.headers.Authorization ?? null;
    calls.push({ method, url, auth, body: init.body ?? null });
    const u = new URL(url);
    // 行き先は api.github.com だけ（ほかは網の誤りにする）
    if (u.origin !== "https://api.github.com") throw new TypeError("fetch failed");
    const path = decodeURIComponent(u.pathname);
    for (const f of failOn) if (`${method} ${path}`.startsWith(f)) return json(500, { message: "Server Error" });
    const authed = auth === `Bearer ${o.token}`;
    const prefix = `/repos/${owner}/${name}`;
    if (!path.startsWith(prefix)) return json(404, { message: "Not Found" });
    const rest = path.slice(prefix.length);
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    // 行方を読む（トークン無しでも読める公開の PR）
    const pull = /^\/pulls\/(\d+)$/.exec(rest);
    if (method === "GET" && pull) {
      const pr = prs.find((p) => p.number === Number(pull[1]));
      return pr ? json(200, { number: pr.number, html_url: htmlUrl(pr.number), state: pr.state, merged: pr.merged, head: { sha: headSha(pr.number), ref: pr.head } }) : json(404, {});
    }
    const pullFiles = /^\/pulls\/(\d+)\/files$/.exec(rest);
    if (method === "GET" && pullFiles) {
      const pr = prs.find((p) => p.number === Number(pullFiles[1]));
      return pr ? json(200, Object.keys(pr.files).map((filename) => ({ filename, status: "added" }))) : json(404, {});
    }
    if (method === "GET" && /^\/commits\/[0-9a-f]{40}\/check-runs$/.test(rest)) return json(200, { check_runs: [{ name: "ledger-validate", status: "in_progress", conclusion: null }] });
    if (method === "GET" && /^\/issues\/\d+\/comments$/.test(rest)) return json(200, []);

    // ここから先は受け口の呼び出し（運営者のトークンが要る）
    if (!authed) return json(401, { message: "Bad credentials" });
    if (method === "GET" && rest === "") return json(200, { full_name: `${owner}/${name}`, default_branch: "main" });
    if (method === "GET" && rest === "/git/ref/heads/main") return json(200, { object: { sha: MAIN_SHA } });
    const ref = /^\/git\/ref\/heads\/(.+)$/.exec(rest);
    if (method === "GET" && ref) return branches.has(ref[1]!) ? json(200, { object: { sha: "d".repeat(40) } }) : json(404, {});
    if (method === "GET" && rest === `/git/trees/${MAIN_SHA}` && u.searchParams.get("recursive") === "1") {
      const dirs = new Set<string>();
      for (const p of main.keys()) {
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
      }
      const tree = [
        ...[...dirs].map((d) => ({ path: d, mode: "040000", type: "tree", sha: "e".repeat(40) })),
        ...[...main].map(([p, c]) => {
          const mode = modes.get(p) ?? "100644";
          return { path: p, mode, type: mode === "160000" ? "commit" : "blob", sha: blobSha(c), size: c.length };
        }),
      ].sort((a, b) => (a.path < b.path ? -1 : 1));
      return json(200, { sha: MAIN_SHA, tree, truncated: false });
    }
    const blob = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest);
    if (method === "GET" && blob) {
      const hit = [...main.values()].find((c) => blobSha(c) === blob[1]);
      return hit ? json(200, { sha: blob[1], size: hit.length, encoding: "base64", content: hit.toString("base64").replace(/(.{60})/g, "$1\n") }) : json(404, {});
    }
    if (method === "GET" && rest === "/pulls") {
      const head = u.searchParams.get("head");
      const state = u.searchParams.get("state") ?? "open";
      const page = Number(u.searchParams.get("page") ?? "1");
      const per = Number(u.searchParams.get("per_page") ?? "30");
      const list = prs
        .filter((p) => (head === null ? true : `${owner}:${p.head}` === head || p.head === head))
        .filter((p) => state === "all" || p.state === state)
        .map((p) => ({
          number: p.number,
          html_url: htmlUrl(p.number),
          state: p.state,
          title: p.title,
          // フォーク（"持ち主:枝"）の PR は、head のリポジトリがフォークになる
          head: { ref: p.head.replace(/^[^:]+:/, ""), repo: { full_name: p.head.includes(":") ? `${p.head.split(":")[0]}/${name}` : `${owner}/${name}` } },
        }))
        .slice((page - 1) * per, page * per);
      return json(200, list);
    }
    const patch = /^\/pulls\/(\d+)$/.exec(rest);
    if (method === "PATCH" && patch) {
      const pr = prs.find((p) => p.number === Number(patch[1]));
      if (!pr) return json(404, {});
      if (body.state === "closed") pr.state = "closed";
      return json(200, { number: pr.number, html_url: htmlUrl(pr.number), state: pr.state });
    }
    const comment = /^\/issues\/(\d+)\/comments$/.exec(rest);
    if (method === "POST" && comment) {
      const pr = prs.find((p) => p.number === Number(comment[1]));
      if (!pr) return json(404, {});
      pr.comments.push(String(body.body ?? ""));
      return json(201, { id: pr.comments.length });
    }
    if (method === "POST" && rest === "/git/refs") {
      const b = String(body.ref ?? "").replace(/^refs\/heads\//, "");
      if (body.sha !== MAIN_SHA || !b) return json(422, { message: "Invalid request" });
      if (branches.has(b)) return json(422, { message: "Reference already exists" });
      branches.set(b, new Map());
      return json(201, { ref: `refs/heads/${b}` });
    }
    // 既定のブランチと枝の差（枝に置いたファイル）
    const compare = /^\/compare\/([0-9a-f]{40})\.\.\.(.+)$/.exec(rest);
    if (method === "GET" && compare) {
      const files = branches.get(compare[2]!);
      return files && compare[1] === MAIN_SHA ? json(200, { status: "ahead", files: [...files.keys()].map((filename) => ({ filename, status: "added" })) }) : json(404, {});
    }
    const contents = /^\/contents\/(.+)$/.exec(rest);
    if (method === "PUT" && contents) {
      const files = branches.get(String(body.branch ?? ""));
      if (!files) return json(422, { message: "Branch not found" });
      if (files.has(contents[1]!) || main.has(contents[1]!)) return json(422, { message: "sha wasn't supplied" });
      files.set(contents[1]!, Buffer.from(String(body.content ?? ""), "base64"));
      return json(201, { content: { path: contents[1] } });
    }
    if (method === "GET" && contents) {
      const files = branches.get(u.searchParams.get("ref") ?? "");
      const c = files?.get(contents[1]!) ?? null;
      return c ? json(200, { encoding: "base64", content: c.toString("base64") }) : json(404, {});
    }
    if (method === "POST" && rest === "/pulls") {
      const head = String(body.head ?? "");
      const files = branches.get(head);
      if (!files || files.size === 0) return json(422, { message: "No commits between main and head" });
      if (prs.some((p) => p.head === head)) return json(422, { message: "A pull request already exists" });
      const pr: FakePr = { number: prs.length + 1, head, base: String(body.base ?? ""), title: String(body.title ?? ""), body: String(body.body ?? ""), files: Object.fromEntries(files), state: "open", merged: false, comments: [] };
      prs.push(pr);
      return json(201, { number: pr.number, html_url: htmlUrl(pr.number) });
    }
    return json(404, { message: "Not Found" });
  };
  return { owner, name, main, modes, branches, prs, calls, failOn, fetch: fetchFn };
}

/** メモリの KV（Workers の KVNamespace の get・put だけ。expirationTtl は記録するが、時刻で消すのは試験がする） */
export function memoryKv(): { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>; data: Map<string, { value: string; ttl: number | null }> } {
  const data = new Map<string, { value: string; ttl: number | null }>();
  return {
    data,
    get: async (k) => data.get(k)?.value ?? null,
    put: async (k, v, opt) => {
      data.set(k, { value: v, ttl: opt?.expirationTtl ?? null });
    },
  };
}
