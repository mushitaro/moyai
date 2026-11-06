// PWA（pwa-v0）：Service Worker（src/app/public/sw.js）が覚える道と覚えない道、古い覚えを捨てること、ビルドの印を埋めること、
// manifest、橋渡しが manifest・sw.js・アイコンを正しい型で出すこと。
// sw.js は手書きの素の JS なので、そのファイルを vm で読み、判定の関数と fetch の受け手を直に試す。
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { SW_STAMP_TOKEN, stampServiceWorker } from "../../scripts/build-stamp.mjs";
import { ROUTES } from "../../src/shared/routes";
import { http, startTestBridge, type TestBridge } from "../helpers/bridge";

const ORIGIN = "http://127.0.0.1:43110";
const SW_PATH = "src/app/public/sw.js";
const MANIFEST_PATH = "src/app/public/manifest.webmanifest";

type Kind = "page" | "asset" | null;
interface SwScope {
  shellKind: (r: { url: string; method: string; mode: string }, origin: string) => Kind;
  staleCaches: (keys: string[], current: string) => string[];
  entryAssets: (html: string) => string[];
}

/** sw.js を読み、受け手と、上に置いた関数を返す（覚えと網はメモリの偽物） */
function loadSw(source = readFileSync(SW_PATH, "utf8")) {
  const listeners = new Map<string, (e: unknown) => void>();
  const fetched: string[] = [];
  const ctx: Record<string, unknown> = {
    self: {
      addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, f),
      location: { origin: ORIGIN },
      skipWaiting: async () => {},
    },
    caches: {
      open: async () => ({ match: async () => undefined, put: async () => {} }),
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async (u: unknown) => {
      fetched.push(String(typeof u === "object" && u && "url" in u ? (u as { url: string }).url : u));
      return new Response("x", { status: 200 });
    },
    URL,
    Response,
  };
  runInNewContext(source, ctx);
  return { sw: ctx as unknown as SwScope, listeners, fetched };
}

const req = (path: string, method = "GET", mode = "cors") => ({ url: path.startsWith("http") ? path : `${ORIGIN}${path}`, method, mode });

describe("Service Worker の道の判定", () => {
  const { sw } = loadSw();

  it("画面の殻（入口の index.html・ビルドした JS・CSS・書体）だけを覚える", () => {
    expect(sw.shellKind(req("/", "GET", "navigate"), ORIGIN)).toBe("page");
    expect(sw.shellKind(req("/?plan=fictional-1", "GET", "navigate"), ORIGIN)).toBe("page");
    for (const p of ["/assets/index-BYlMKaOe.js", "/assets/pdf.worker.min-CjEcRF4W.mjs", "/assets/index-DmfA1Nei.css", "/assets/ibm-plex-sans-jp-japanese-400-normal-abc.woff2", "/assets/krona-one-latin-400-normal-x.woff"]) {
      expect(sw.shellKind(req(p), ORIGIN), p).toBe("asset");
    }
  });

  it("ツールの道・人だけの経路・WebSocket・/api・開発の見本・殻でないファイルは覚えない", () => {
    const paths = [
      "/relay/tool",
      "/human/plan-commit",
      "/human/plan-status",
      "/ws",
      "/selftest/ed25519",
      "/api/anything",
      "/api",
      "/assets/dev-plans/fictional-1.json",
      "/assets/Adobe-Japan1-UCS2-x.bcmap",
      "/assets/FoxitSerif-x.pfb",
      "/sw.js",
      "/manifest.webmanifest",
      "/brand/png/icon-192.png",
      "/index.html",
    ];
    for (const p of paths) expect(sw.shellKind(req(p), ORIGIN), p).toBeNull();
    // 入口でも、ページを開くのでない読み込みは横取りしない
    expect(sw.shellKind(req("/", "GET", "cors"), ORIGIN)).toBeNull();
  });

  it("GET でない呼び出し・ほかの出どころ・道に問いの付いたファイルは覚えない", () => {
    expect(sw.shellKind(req("/human/commit-trial", "POST"), ORIGIN)).toBeNull();
    expect(sw.shellKind(req("/assets/index-a.js", "POST"), ORIGIN)).toBeNull();
    expect(sw.shellKind(req("http://localhost:43110/assets/index-a.js"), ORIGIN)).toBeNull();
    expect(sw.shellKind(req("http://127.0.0.1:43111/assets/index-a.js"), ORIGIN)).toBeNull();
    expect(sw.shellKind(req("https://example.invalid/assets/index-a.js"), ORIGIN)).toBeNull();
    expect(sw.shellKind(req("/assets/index-a.js?v=1"), ORIGIN)).toBeNull();
    expect(sw.shellKind({ url: "not a url", method: "GET", mode: "cors" }, ORIGIN)).toBeNull();
  });

  it("覚えの名前に印が入り、版が変わったら MOYAI の古い覚えだけを捨てる", () => {
    const { sw: built } = loadSw(stampServiceWorker(readFileSync(SW_PATH, "utf8"), { time: "2026-11-07 10:00", commit: "abc1234" }));
    const now = "moyai-shell-2026-11-07 10:00 abc1234";
    expect(built.staleCaches(["moyai-shell-2026-11-06 09:00 0000000", now, "ほかの覚え"], now)).toEqual(["moyai-shell-2026-11-06 09:00 0000000"]);
    expect(built.staleCaches([now], now)).toEqual([]);
  });

  it("入れたときに一緒に覚えるのは、index.html が読み込む /assets/ のファイル", () => {
    const html = readFileSync("src/app/index.html", "utf8").replace("</head>", '<script type="module" crossorigin src="/assets/index-a.js"></script><link rel="stylesheet" crossorigin href="/assets/index-b.css"></head>');
    expect(sw.entryAssets(html)).toEqual(["/assets/index-a.js", "/assets/index-b.css"]);
  });
});

describe("Service Worker の受け手", () => {
  /** fetch の出来事を渡し、横取りしたかを返す */
  function dispatch(listeners: Map<string, (e: unknown) => void>, r: { url: string; method: string; mode: string }) {
    let took: Promise<unknown> | null = null;
    listeners.get("fetch")!({ request: r, respondWith: (p: Promise<unknown>) => (took = p) });
    return took as Promise<unknown> | null;
  }

  it("覚えない道は横取りしない（respondWith を呼ばない）", () => {
    const { listeners } = loadSw();
    expect([...listeners.keys()].sort()).toEqual(["activate", "fetch", "install"]);
    for (const r of [req("/relay/tool", "POST"), req("/human/plan-commit", "POST"), req("/ws"), req("/api/x"), req("/assets/dev-plans/a.json"), req("/selftest/ed25519")]) {
      expect(dispatch(listeners, r), r.url).toBeNull();
    }
  });

  it("殻の道は横取りして返す（入口は網を先に見る）", async () => {
    const { listeners, fetched } = loadSw();
    const page = dispatch(listeners, req("/?plan=x", "GET", "navigate"));
    expect(page).not.toBeNull();
    expect(((await page) as Response).status).toBe(200);
    expect(fetched).toContain(`${ORIGIN}/?plan=x`);
    const asset = dispatch(listeners, req("/assets/index-a.js"));
    expect(((await asset) as Response).status).toBe(200);
  });
});

describe("ビルドの印", () => {
  it("sw.js に印の置き場所がちょうど 1 つあり、ビルドで印に置き換わる", () => {
    const src = readFileSync(SW_PATH, "utf8");
    expect(src.split(SW_STAMP_TOKEN).length - 1).toBe(1);
    const out = stampServiceWorker(src, { time: "2026-11-07 10:00", commit: "abc1234+" });
    expect(out).not.toContain(SW_STAMP_TOKEN);
    expect(out).toContain('const BUILD = "2026-11-07 10:00 abc1234+";');
  });

  it("置き場所が無い・2 つあれば止める（印の無い Service Worker を出さない）", () => {
    expect(() => stampServiceWorker("const BUILD = 1;", { time: "t", commit: "c" })).toThrow();
    expect(() => stampServiceWorker(`${SW_STAMP_TOKEN};${SW_STAMP_TOKEN}`, { time: "t", commit: "c" })).toThrow();
  });
});

describe("manifest", () => {
  const m = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { name: string; display: string; start_url: string; icons: { src: string; sizes: string; type: string }[] };

  it("名前は MOYAI、standalone、入口は /", () => {
    expect(m.name).toBe("MOYAI");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
  });

  it("アイコンは 192 と 512 の PNG で、ファイルの大きさが書いたとおり。道は橋渡しの許可の一覧にある", () => {
    expect(m.icons.map((i) => i.sizes).sort()).toEqual(["192x192", "512x512"]);
    const allowed = Object.values(ROUTES).map((r) => ("path" in r ? r.path : null));
    for (const i of m.icons) {
      expect(i.type).toBe("image/png");
      expect(allowed).toContain(i.src);
      const png = readFileSync(join("src/app/public", i.src));
      expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
      const [w, h] = i.sizes.split("x").map(Number);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([w, h]);
    }
  });

  it("index.html が manifest を指す", () => {
    expect(readFileSync("src/app/index.html", "utf8")).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  });
});

describe("橋渡しが PWA のファイルを出す", () => {
  let tb: TestBridge | null = null;
  afterEach(async () => {
    await tb?.close();
    tb = null;
  });

  it("manifest・sw.js・アイコンを正しい型で出す。sw.js は覚えさせない（版が変われば読み直す）", async () => {
    tb = await startTestBridge();
    const app = join(tb.dir, "app");
    writeFileSync(join(app, "sw.js"), readFileSync(SW_PATH));
    writeFileSync(join(app, "manifest.webmanifest"), readFileSync(MANIFEST_PATH));
    mkdirSync(join(app, "brand", "png"), { recursive: true });
    for (const n of ["icon-192.png", "icon-512.png", "favicon-16.png"]) writeFileSync(join(app, "brand", "png", n), readFileSync(join("src/app/public/brand/png", n)));

    const sw = await http(tb.bridge.port, "GET", "/sw.js", { "sec-fetch-site": "same-origin", "sec-fetch-mode": "same-origin", "sec-fetch-dest": "serviceworker", "service-worker": "script" });
    expect(sw.status).toBe(200);
    expect(sw.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(sw.headers["cache-control"]).toBe("no-store");

    const mf = await http(tb.bridge.port, "GET", "/manifest.webmanifest", { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "manifest" });
    expect(mf.status).toBe(200);
    expect(mf.headers["content-type"]).toBe("application/manifest+json; charset=utf-8");

    for (const p of ["/brand/png/icon-192.png", "/brand/png/icon-512.png"]) {
      const r = await http(tb.bridge.port, "GET", p, { "sec-fetch-site": "same-origin" });
      expect(r.status, p).toBe(200);
      expect(r.headers["content-type"], p).toBe("image/png");
    }
    // 許可の一覧に無いブランドのファイルは出さない
    expect((await http(tb.bridge.port, "GET", "/brand/png/favicon-16.png")).body.error.code).toBe("route_not_allowed");
    expect((await http(tb.bridge.port, "GET", "/brand/README.md")).body.error.code).toBe("route_not_allowed");
    // ほかのサイトから Service Worker と manifest を読ませない
    expect((await http(tb.bridge.port, "GET", "/sw.js", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" })).body.error.code).toBe("fetch_site_not_allowed");
    expect((await http(tb.bridge.port, "GET", "/manifest.webmanifest", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "manifest" })).body.error.code).toBe("fetch_site_not_allowed");
    // GET でなければ断る
    expect((await http(tb.bridge.port, "POST", "/sw.js")).body.error.code).toBe("method_not_allowed");
  });
});
