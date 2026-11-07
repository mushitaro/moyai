// 試験の中だけで動く GitHub の代わり（127.0.0.1）。公開の台帳へ PR を出す流れ（src/bridge/github.ts）が使う呼び出しだけを受ける：
// デバイスフロー（コード → 人が許すまで待ち → トークン）、/user、台帳のリポジトリ・既定のブランチの先、フォーク、枝、ファイル、PR、PR の行方。
// 本物の GitHub では確かめていない（報告では「GitHub の本物では未確認」と分けて書く）。届いた束のファイルは試験が受け手の関数で確かめる。
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface StubPr {
  number: number;
  /** 出した人のアカウントと枝 */
  head: string;
  base: string;
  title: string;
  body: string;
  /** 枝に足されたファイル（道 → 中身） */
  files: Record<string, Buffer>;
  state: "open" | "closed";
  merged: boolean;
  check: { status: "queued" | "in_progress" | "completed"; conclusion: "success" | "failure" | null } | null;
  comments: { user: { login: string; type: string }; body: string }[];
}

export interface GitHubStub {
  web: string;
  api: string;
  clientId: string;
  login: string;
  upstream: { owner: string; name: string };
  /** 人が github.com でコードを入れたことにする（試験の台本が押した） */
  approve(): void;
  /** 人が断ったことにする */
  deny(): void;
  prs: StubPr[];
  /** 届いた呼び出し（方法と道。トークンは記録しない） */
  calls: string[];
  /** 届いたトークン（試験がトークンの扱いを確かめる） */
  tokensSeen: Set<string>;
  close(): Promise<void>;
}

const TOKEN = "gho_stub0123456789abcdefTOKEN";
const BASE_SHA = "a".repeat(40);

export async function startGitHubStub(o: { login?: string; owner?: string; name?: string } = {}): Promise<GitHubStub> {
  const login = o.login ?? "moyai-test";
  const upstream = { owner: o.owner ?? "ledger-owner", name: o.name ?? "moyai" };
  let approved = false;
  let denied = false;
  const forks = new Set<string>();
  const branches = new Map<string, Record<string, Buffer>>();
  const prs: StubPr[] = [];
  const calls: string[] = [];
  const tokensSeen = new Set<string>();
  let base = "";

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const read = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          resolve(chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {});
        } catch {
          resolve({});
        }
      });
    });

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const path = decodeURIComponent(url.pathname);
    const method = req.method ?? "GET";
    calls.push(`${method} ${path}`);
    const auth = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1] ?? null;
    if (auth) tokensSeen.add(auth);
    const authed = auth === TOKEN;
    const body = method === "GET" ? {} : await read(req);
    const up = `${upstream.owner}/${upstream.name}`;
    const fork = `${login}/${upstream.name}`;

    if (method === "POST" && path === "/login/device/code") {
      if (body.client_id !== "stub-client-id" || body.scope !== "public_repo") return send(res, 400, { error: "bad" });
      return send(res, 200, { device_code: "dev-code-1", user_code: "WDJB-MJHT", verification_uri: `${base}/login/device`, expires_in: 900, interval: 1 });
    }
    if (method === "POST" && path === "/login/oauth/access_token") {
      if (denied) return send(res, 200, { error: "access_denied" });
      if (!approved) return send(res, 200, { error: "authorization_pending" });
      return send(res, 200, { access_token: TOKEN, token_type: "bearer", scope: "public_repo" });
    }
    if (method === "GET" && path === "/user") return authed ? send(res, 200, { login }) : send(res, 401, { message: "Bad credentials" });

    const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(path);
    if (!m) return send(res, 404, { message: "Not Found" });
    const repo = m[1]!;
    const rest = m[2] ?? "";
    if (method === "GET" && rest === "") {
      if (repo === up || (repo === fork && forks.has(fork))) return send(res, 200, { full_name: repo, default_branch: "main" });
      return send(res, 404, { message: "Not Found" });
    }
    if (method === "GET" && rest === "/git/ref/heads/main" && repo === up) return send(res, 200, { object: { sha: BASE_SHA } });
    if (method === "POST" && rest === "/forks" && repo === up) {
      if (!authed) return send(res, 401, {});
      forks.add(fork);
      return send(res, 202, { full_name: fork });
    }
    if (method === "POST" && rest === "/git/refs" && repo === fork) {
      if (!authed || body.sha !== BASE_SHA) return send(res, 422, {});
      const ref = String(body.ref ?? "").replace(/^refs\/heads\//, "");
      if (branches.has(ref)) return send(res, 422, { message: "Reference already exists" });
      branches.set(ref, {});
      return send(res, 201, { ref: `refs/heads/${ref}` });
    }
    const put = /^\/contents\/(.+)$/.exec(rest);
    if (method === "PUT" && put && repo === fork) {
      const files = branches.get(String(body.branch ?? ""));
      if (!authed || !files) return send(res, 422, {});
      files[put[1]!] = Buffer.from(String(body.content ?? ""), "base64");
      return send(res, 201, { content: { path: put[1] } });
    }
    if (method === "POST" && rest === "/pulls" && repo === up) {
      const head = String(body.head ?? "");
      const files = branches.get(head.replace(`${login}:`, ""));
      if (!authed || !head.startsWith(`${login}:`) || !files) return send(res, 422, {});
      const pr: StubPr = {
        number: prs.length + 1,
        head,
        base: String(body.base ?? ""),
        title: String(body.title ?? ""),
        body: String(body.body ?? ""),
        files,
        state: "open",
        merged: false,
        check: { status: "in_progress", conclusion: null },
        comments: [],
      };
      prs.push(pr);
      return send(res, 201, { number: pr.number, html_url: `https://github.com/${up}/pull/${pr.number}` });
    }
    const pull = /^\/pulls\/(\d+)$/.exec(rest);
    if (method === "GET" && pull && repo === up) {
      const pr = prs.find((p) => p.number === Number(pull[1]));
      if (!pr) return send(res, 404, {});
      return send(res, 200, { html_url: `https://github.com/${up}/pull/${pr.number}`, state: pr.state, merged: pr.merged, head: { sha: "b".repeat(39) + String(pr.number % 10) } });
    }
    const checks = /^\/commits\/([0-9a-f]{40})\/check-runs$/.exec(rest);
    if (method === "GET" && checks && repo === up) {
      const pr = prs.find((p) => "b".repeat(39) + String(p.number % 10) === checks[1]);
      return send(res, 200, { check_runs: pr?.check ? [{ name: "ledger-validate", ...pr.check }] : [] });
    }
    const comments = /^\/issues\/(\d+)\/comments$/.exec(rest);
    if (method === "GET" && comments && repo === up) return send(res, 200, prs.find((p) => p.number === Number(comments[1]))?.comments ?? []);
    return send(res, 404, { message: "Not Found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    web: base,
    api: base,
    clientId: "stub-client-id",
    login,
    upstream,
    approve: () => {
      approved = true;
    },
    deny: () => {
      denied = true;
    },
    prs,
    calls,
    tokensSeen,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export const STUB_TOKEN = TOKEN;
