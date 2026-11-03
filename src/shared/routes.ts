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
export const HUMAN_ACTIONS = [
  "commit_trial",
  // 確定と版（docs/plan.md §2.9）
  "plan_status",
  "plan_commit",
  "plan_revert",
  // 設定（置き場所・輪のフォルダ・鍵。§2.12、§2.14）
  "settings_read",
  "settings_save",
  "ring_create",
  // 検問所（§2.8）
  "checkpoint_preview",
  "checkpoint_open_text",
  "checkpoint_send",
  "ring_verify",
] as const;
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

/** 人だけの経路の定義（守りの形は 1 つ） */
function human<A extends HumanAction, P extends string>(path: P, action: A, maxBody: number, note: string) {
  return { method: "POST", path, kind: "human", requires: { tabSecret: true, oneTimeToken: true }, action, maxBody, note } as const;
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
  // ─── 人だけの経路（確定・設定・鍵・検問所）。処理は src/bridge/human.ts ───
  planStatus: human("/human/plan-status", "plan_status", 64 * 1024, "確定した版の一覧と、いちばん新しい版（確定のダイアログを開いたとき）"),
  planCommit: human("/human/plan-commit", "plan_commit", 32 * 1024 * 1024, "計画を確定する（版のファイルを足し、差分レポートと人が見る様式の星取表の Excel を書く）"),
  planRevert: human("/human/plan-revert", "plan_revert", 64 * 1024, "前の版に戻す（前の版を指す記録を足す）"),
  settingsRead: human("/human/settings-read", "settings_read", 64 * 1024, "置き場所・Documents の場所・輪の一覧を読む"),
  settingsSave: human("/human/settings-save", "settings_save", 64 * 1024, "置き場所を保存する"),
  ringCreate: human("/human/ring-create", "ring_create", 64 * 1024, "輪を作り、その輪の鍵の対を合言葉で包んで状態フォルダに置く"),
  checkpointPreview: human("/human/checkpoint-preview", "checkpoint_preview", 64 * 1024, "検問所：出ていく束のバイト列とハッシュと数（送る処理と同じ関数）"),
  checkpointOpenText: human("/human/checkpoint-open-text", "checkpoint_open_text", 64 * 1024, "検問所：出ていく束を同期されない一時フォルダに写し、OS のテキストエディタで開く"),
  checkpointSend: human("/human/checkpoint-send", "checkpoint_send", 64 * 1024, "検問所：合言葉で署名し、束を輪のフォルダに置く"),
  ringVerify: human("/human/ring-verify", "ring_verify", 64 * 1024, "輪を受け手と同じ関数で確かめる"),
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
export const APP_PAGES = { home: "#/", selftest: "#/selftest", intake: "#/intake", checkpoint: "#/checkpoint", settings: "#/settings" } as const;

/** 橋渡しとタブの間で使う HTTP の見出しの名前 */
export const HEADER_TAB_SECRET = "x-moyai-tab-secret";
export const HEADER_RELAY_KEY = "x-moyai-relay-key";
