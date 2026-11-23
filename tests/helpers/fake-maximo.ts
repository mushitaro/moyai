// 試験の中だけの偽の Maximo（部品 @mxstage/eam-connectors の /testing の createFakeMaximo）を、一時のポートの HTTPS で立てる。
// 本物の部品は https のつなぎ先しか受けない（部品の normalizeConnectionUrl）ので、一時のフォルダに自分で署名した証明書を作り、
// 橋渡しのプロセスには NODE_EXTRA_CA_CERTS でその証明書だけを足す（橋渡しのほかの通信の確かめは変えない）。
// 127.0.0.1 に HTTP を受けるのは、この偽の Maximo だけ（試験の中。本物の Maximo にはつながない。docs/security.md）。
// 中身は差し替えられる（use）：現場の Maximo には施設の資産の木がもうあるので、試験は確定した版の資産の木を、送る前に偽の Maximo に入れる。
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 部品の /testing（無ければ null）。名前を変数に置いて読む（部品が無くても型の確かめが通るように） */
export async function eamTesting(): Promise<Any | null> {
  const name = "@mxstage/eam-connectors/testing";
  return import(/* @vite-ignore */ name).catch(() => null);
}

/** openssl の場所（Windows は Git for Windows のものも探す。CI の windows の仕事は Git Bash で走る） */
function openssl(): string {
  const cands = ["openssl", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe", "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe", "C:\\Program Files\\OpenSSL\\bin\\openssl.exe"];
  for (const c of cands) {
    if (c !== "openssl" && !existsSync(c)) continue;
    try {
      execFileSync(c, ["version"], { stdio: "ignore", windowsHide: true });
      return c;
    } catch {
      /* 次の候補 */
    }
  }
  throw new Error("偽の Maximo の証明書を作る openssl が見つからない");
}

/** 127.0.0.1 の、自分で署名した証明書と鍵（一時のフォルダ。1 日だけ有効）。設定はファイルで渡す（引数の / を書き換える道を通さない） */
function selfSigned(dir: string): { cert: string; key: string } {
  const cnf = join(dir, "req.cnf");
  writeFileSync(
    cnf,
    [
      "[req]",
      "prompt = no",
      "distinguished_name = dn",
      "x509_extensions = ext",
      "[dn]",
      "CN = 127.0.0.1",
      "[ext]",
      "basicConstraints = critical, CA:TRUE",
      "keyUsage = critical, digitalSignature, keyCertSign",
      "extendedKeyUsage = serverAuth",
      "subjectAltName = IP:127.0.0.1",
      "",
    ].join("\n"),
  );
  const cert = join(dir, "cert.pem");
  const key = join(dir, "key.pem");
  execFileSync(
    openssl(),
    ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1", "-config", cnf, "-keyout", key, "-out", cert],
    { stdio: "ignore", windowsHide: true },
  );
  return { cert, key };
}

export interface FakeMaximoServer {
  /** https://127.0.0.1:<ポート>（つなぎ先の URL に人が入れるもの） */
  origin: string;
  /** 橋渡しの NODE_EXTRA_CA_CERTS に渡す証明書のファイル */
  caFile: string;
  /** 偽の Maximo の API キー（人がつなぎ先を足すときに入れる） */
  apiKey: string;
  /** 今の偽の Maximo（部品の FakeMaximo） */
  fake(): Any;
  /** 中身を差し替える（seed は部品の FakeSeed。baseUrl と apiKey はこちらで置く） */
  use(seed: Any): void;
  /** 受けた要求の数（API キーが URL に載っていないかを見るため、道も残す） */
  requests: { method: string; path: string }[];
  stop(): Promise<void>;
}

/** 偽の Maximo を一時のポートで立てる */
export async function startFakeMaximo(testing: Any, seed: Any, apiKey = "e2e-maximo-key-not-real-0123456789"): Promise<FakeMaximoServer> {
  const dir = mkdtempSync(join(tmpdir(), "moyai-fake-maximo-"));
  const { cert, key } = selfSigned(dir);
  let origin = "";
  let fake: Any = null;
  const requests: { method: string; path: string }[] = [];
  const server: Server = createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        try {
          requests.push({ method: req.method ?? "", path: req.url ?? "" });
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && k !== "content-length" && k !== "transfer-encoding") headers.set(k, v);
          // 部品の偽の Maximo は、本体を字（string）でしか読まない（Buffer だと書き込みを 400 で断る）
          const body = chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined;
          const r: Response = await fake.fetch(`${origin}${req.url ?? "/"}`, { method: req.method, headers, ...(body && req.method !== "GET" ? { body } : {}) });
          const out = Buffer.from(await r.arrayBuffer());
          const h: Record<string, string> = {};
          r.headers.forEach((v, k) => (h[k] = v));
          delete h["content-length"];
          delete h["content-encoding"];
          res.writeHead(r.status, h);
          res.end(out);
        } catch {
          res.writeHead(500);
          res.end();
        }
      })();
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const a = server.address();
  origin = `https://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const use = (s: Any) => {
    fake = testing.createFakeMaximo({ ...s, baseUrl: origin, apiKey });
  };
  use(seed);
  return {
    origin,
    caFile: cert,
    apiKey,
    fake: () => fake,
    use,
    requests,
    stop: async () => {
      await new Promise<void>((done) => server.close(() => done()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const s = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, t]) => [k, { type: t }]));

/** 部品が読む 4 つの構造（資産・場所・PM・作業指示）の形。中身は渡す */
export function maximoSeed(o: { assets?: Any[]; locations?: Any[]; pms?: Any[]; wos?: Any[] }): Any {
  return {
    objectStructures: {
      MXAPIASSET: {
        keyAttrs: ["assetnum", "siteid"],
        attrs: s({ assetnum: "string", siteid: "string", description: "string", status: "string", parent: "string", location: "string", assettype: "string" }),
        records: (o.assets ?? []).map((attrs) => ({ attrs })),
      },
      MXAPIOPERLOC: {
        keyAttrs: ["location", "siteid"],
        attrs: s({ location: "string", siteid: "string", description: "string", status: "string", type: "string" }),
        children: { lochierarchy: { idAttr: "systemid", attrs: s({ parent: "string", systemid: "string" }) } },
        records: (o.locations ?? []).map((attrs) => ({ attrs })),
      },
      MXAPIPM: {
        keyAttrs: ["pmnum", "siteid"],
        attrs: { ...s({ pmnum: "string", siteid: "string", description: "string", status: "string", assetnum: "string", location: "string", jpnum: "string", frequnit: "string" }), frequency: { type: "integer" }, nextdate: { type: "datetime" } },
        records: (o.pms ?? []).map((attrs) => ({ attrs })),
      },
      MXAPIWODETAIL: {
        keyAttrs: ["wonum", "siteid"],
        attrs: {
          ...s({ wonum: "string", siteid: "string", description: "string", status: "string", worktype: "string", assetnum: "string", location: "string", pmnum: "string", jpnum: "string" }),
          schedstart: { type: "datetime" },
          actstart: { type: "datetime" },
          actfinish: { type: "datetime" },
          actlabhrs: { type: "number" },
        },
        records: (o.wos ?? []).map((attrs) => ({ attrs })),
      },
    },
  };
}

/**
 * 資産の道（上から「 › 」でつないだ名前）の一覧から、同じ形の資産の木を作る（道ごとに 1 つの資産。番号は E0001 から）。
 * 返すのは資産の行と、道 → 資産の番号
 */
export function assetTreeOf(paths: readonly string[], siteid: string, sep = " › "): { assets: Any[]; numOf: Map<string, string> } {
  const numOf = new Map<string, string>();
  const assets: Any[] = [];
  for (const p of paths) {
    const names = p.split(sep);
    for (let i = 1; i <= names.length; i++) {
      const path = names.slice(0, i).join(sep);
      if (numOf.has(path)) continue;
      const num = `E${String(numOf.size + 1).padStart(4, "0")}`;
      numOf.set(path, num);
      const parent = i > 1 ? numOf.get(names.slice(0, i - 1).join(sep)) : undefined;
      assets.push({ assetnum: num, siteid, description: names[i - 1], ...(parent ? { parent } : {}) });
    }
  }
  return { assets, numOf };
}
