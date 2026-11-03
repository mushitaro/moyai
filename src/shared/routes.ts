// 橋渡しの HTTP の経路の許可の一覧。一覧に無いものは拒む。
// 人だけの経路（kind: "human"）は、タブの秘密と 1 回きりの印の両方を求める。拒む試験は消さない。

export type RouteKind =
  /** ビルドした画面のファイル */
  | "static"
  /** 誰でも読めてよい、秘密を含まない GET */
  | "public"
  /** タブとの WebSocket（Origin の一致が必須） */
  | "ws"
  /** 中継（moyai mcp）だけが呼ぶ。状態フォルダの鍵ファイルで確かめる */
  | "relay"
  /** 人だけの操作。タブの秘密と 1 回きりの印が要る */
  | "human";

/** 人だけの操作の名前。1 回きりの印はこの名前と中身のハッシュに結ぶ。 */
export const HUMAN_ACTIONS = ["commit_trial"] as const;
export type HumanAction = (typeof HUMAN_ACTIONS)[number];

export interface RouteDef {
  method: "GET" | "POST";
  /** path は完全一致。prefix は前方一致（静的ファイルだけ） */
  path?: string;
  prefix?: string;
  kind: RouteKind;
  /** 人だけの経路の守り。kind が human なら両方 true でなければならない */
  requires?: { tabSecret: true; oneTimeToken: true };
  action?: HumanAction;
  /** 受ける中身の上限（バイト） */
  maxBody?: number;
  note: string;
}

export const ROUTES = {
  app: { method: "GET", path: "/", kind: "static", note: "画面の入口（index.html）" },
  assets: { method: "GET", prefix: "/assets/", kind: "static", note: "ビルドした JS・CSS・書体" },
  selftestEd25519: {
    method: "GET",
    path: "/selftest/ed25519",
    kind: "public",
    note: "Node の crypto で作った Ed25519 の署名の見本（試験のページが WebCrypto で検証する）",
  },
  ws: { method: "GET", path: "/ws", kind: "ws", note: "タブとの往復" },
  relayTool: { method: "POST", path: "/relay/tool", kind: "relay", maxBody: 1024 * 1024, note: "中継からのツールの呼び出し" },
  commitTrial: {
    method: "POST",
    path: "/human/commit-trial",
    kind: "human",
    requires: { tabSecret: true, oneTimeToken: true },
    action: "commit_trial",
    maxBody: 64 * 1024,
    note: "確定の試しの経路（v0。中身は何もしない。守りの形を試験するためのもの）",
  },
} as const satisfies Record<string, RouteDef>;

export type RouteId = keyof typeof ROUTES;
/** 人だけの経路の ID */
export type HumanRouteId = { [K in RouteId]: (typeof ROUTES)[K]["kind"] extends "human" ? K : never }[RouteId];
export const ROUTE_IDS = Object.keys(ROUTES) as RouteId[];

/** 方法と道から経路を引く。無ければ、道があるが方法が違うかどうかも返す。 */
export function matchRoute(method: string, pathname: string): { id: RouteId } | { id: null; pathKnown: boolean } {
  let pathKnown = false;
  for (const id of ROUTE_IDS) {
    const r: RouteDef = ROUTES[id];
    const hit = r.path !== undefined ? pathname === r.path : r.prefix !== undefined && pathname.startsWith(r.prefix);
    if (!hit) continue;
    pathKnown = true;
    if (r.method === method) return { id };
  }
  return { id: null, pathKnown };
}

/** 画面の中の道（HashRouter を使わず、#/selftest のように hash で分ける）。サーバーの経路は増やさない。 */
export const APP_PAGES = { home: "#/", selftest: "#/selftest", intake: "#/intake" } as const;

/** 橋渡しとタブの間で使う HTTP の見出しの名前 */
export const HEADER_TAB_SECRET = "x-moyai-tab-secret";
export const HEADER_RELAY_KEY = "x-moyai-relay-key";
