// 試験の中だけで動く GitHub の Issues の代わり（メモリの中。網は使わない）。受け口の POST /feedback が使う呼び出しだけを受ける：
// ラベルで Issue の一覧・Issue を出す・ラベルを付ける・閉じる。権限の無いトークン（403・404）・ラベルが黙って落ちる・転送（3xx）を作れる。
// 本物の GitHub では確かめていない（報告では「GitHub の本物では未確認」と分けて書く）。
export interface FakeIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
}

export interface FakeIssuesGitHub {
  owner: string;
  name: string;
  issues: FakeIssue[];
  calls: { method: string; url: string; auth: string | null; body: string | null; redirect: string | null }[];
  /** ok：受ける。forbidden：403（トークンに Issues の権限が無い）。notFound：404（トークンにリポジトリが無い）。redirect：302 */
  mode: "ok" | "forbidden" | "notFound" | "redirect";
  /** 出すときのラベルを黙って落とす（GitHub の文書のとおり、権限によって起きる）。labelsFail なら付け直しも 403 */
  dropLabels: boolean;
  labelsFail: boolean;
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: string }) => Promise<Response>;
}

export function fakeIssuesGitHub(o: { token: string; owner?: string; name?: string }): FakeIssuesGitHub {
  const owner = o.owner ?? "moyai-owner";
  const name = o.name ?? "moyai";
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const htmlUrl = (n: number) => `https://github.com/${owner}/${name}/issues/${n}`;
  const view = (i: FakeIssue) => ({ number: i.number, html_url: htmlUrl(i.number), title: i.title, body: i.body, state: i.state, labels: i.labels.map((l) => ({ name: l })) });
  const gh: FakeIssuesGitHub = {
    owner,
    name,
    issues: [],
    calls: [],
    mode: "ok",
    dropLabels: false,
    labelsFail: false,
    async fetch(url, init) {
      gh.calls.push({ method: init.method, url, auth: init.headers.authorization ?? null, body: init.body ?? null, redirect: init.redirect ?? null });
      const u = new URL(url);
      if (u.origin !== "https://api.github.com") throw new TypeError("fetch failed");
      const prefix = `/repos/${owner}/${name}`;
      if (!u.pathname.startsWith(prefix)) return json(404, { message: "Not Found" });
      if (init.headers.authorization !== `Bearer ${o.token}`) return json(401, { message: "Bad credentials" });
      if (gh.mode === "redirect") return json(302, {}, { location: "https://elsewhere.example/" });
      if (gh.mode === "forbidden") return json(403, { message: "Resource not accessible by personal access token" });
      if (gh.mode === "notFound") return json(404, { message: "Not Found" });
      const rest = u.pathname.slice(prefix.length);
      const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      if (init.method === "GET" && rest === "/issues") {
        const label = u.searchParams.get("labels");
        const page = Number(u.searchParams.get("page") ?? "1");
        const per = Number(u.searchParams.get("per_page") ?? "30");
        const hit = gh.issues.filter((i) => (u.searchParams.get("state") === "all" || i.state === "open") && (!label || i.labels.includes(label)));
        return json(200, hit.slice((page - 1) * per, page * per).map(view));
      }
      if (init.method === "POST" && rest === "/issues") {
        const i: FakeIssue = { number: gh.issues.length + 1, title: String(body.title), body: String(body.body), labels: gh.dropLabels ? [] : ((body.labels as string[]) ?? []), state: "open" };
        gh.issues.push(i);
        return json(201, view(i));
      }
      const one = /^\/issues\/(\d+)$/.exec(rest);
      if (init.method === "PATCH" && one) {
        const i = gh.issues.find((x) => x.number === Number(one[1]));
        if (!i) return json(404, {});
        if (body.state === "closed") i.state = "closed";
        return json(200, view(i));
      }
      const lab = /^\/issues\/(\d+)\/labels$/.exec(rest);
      if (init.method === "POST" && lab) {
        if (gh.labelsFail) return json(403, { message: "Resource not accessible by personal access token" });
        const i = gh.issues.find((x) => x.number === Number(lab[1]));
        if (!i) return json(404, {});
        i.labels = [...new Set([...i.labels, ...((body.labels as string[]) ?? [])])];
        return json(200, i.labels.map((l) => ({ name: l })));
      }
      return json(404, { message: "Not Found" });
    },
  };
  return gh;
}
