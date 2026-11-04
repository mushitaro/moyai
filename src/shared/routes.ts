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
  // トップ：保管先の施設と版の一覧（もやいの星取表。docs/screens.md 3.1）
  "plans_list",
  // 承認：いちばん新しい版に、承認か差し戻しの署名を足す（docs/screens.md 3.2 の下の帯）
  "plan_sign",
  // EXPORT：確定した版の Excel（人が見る様式・差分レポート）を、人が画面で落とす（docs/screens.md 3.5）
  "plan_file_read",
  // 人の鍵（版の署名。§2.18.2）：自分の鍵を作る・ほかの人の鍵を確認済みにする
  "person_key_create",
  "person_key_confirm",
  // 設定（置き場所・輪のフォルダ・鍵。§2.12、§2.14）
  "settings_read",
  "settings_save",
  "ring_create",
  // 検問所（§2.8）
  "checkpoint_preview",
  "checkpoint_open_text",
  "checkpoint_send",
  "ring_verify",
  // 受け手：似た施設と並べる（§2.8 受け取りと 3 つの立場。台帳の clone と自分の輪を受け手の関数で読む）
  "peers_compare",
  "readings_read",
  // 写真を AI クライアントに渡す許し（§2.3・§2.12。1 枚ごと、その画像のハッシュに結ぶ）
  "photo_allow",
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
  planCommit: human("/human/plan-commit", "plan_commit", 32 * 1024 * 1024, "計画を確定する（合言葉で開いた自分の鍵で版に署名し、版のファイルと署名を足し、差分レポートと人が見る様式の星取表の Excel を書く）"),
  planRevert: human("/human/plan-revert", "plan_revert", 64 * 1024, "前の版に戻す（前の版を指す記録を足し、自分の鍵で署名する）"),
  plansList: human("/human/plans-list", "plans_list", 16 * 1024, "保管先の施設と版の一覧（版の番号・時刻・署名の役目・確かめの結果・編集の番）を、トップのもやいの星取表に読む"),
  planSign: human("/human/plan-sign", "plan_sign", 16 * 1024, "いちばん新しい版に、合言葉で開いた自分の鍵で承認か差し戻しの署名を足し、編集の番を替える"),
  planFileRead: human("/human/plan-file-read", "plan_file_read", 16 * 1024, "確定した版の Excel（人が見る様式の星取表か差分レポート）を読んで、画面がブラウザに落とす"),
  personKeyCreate: human("/human/person-key-create", "person_key_create", 16 * 1024, "自分の鍵（版に署名する）を作り、合言葉で包んで状態フォルダに置く"),
  personKeyConfirm: human("/human/person-key-confirm", "person_key_confirm", 16 * 1024, "ほかの人の鍵を、指紋を読み合わせて確認済みにする（それまでの署名では読み方を承認しない）"),
  settingsRead: human("/human/settings-read", "settings_read", 64 * 1024, "置き場所・Documents の場所・輪の一覧を読む"),
  settingsSave: human("/human/settings-save", "settings_save", 64 * 1024, "置き場所・公開の台帳の clone の場所・自分の呼び名を保存する"),
  ringCreate: human("/human/ring-create", "ring_create", 64 * 1024, "輪を作り、その輪の鍵の対を合言葉で包んで状態フォルダに置く"),
  checkpointPreview: human("/human/checkpoint-preview", "checkpoint_preview", 64 * 1024, "検問所：出ていく束のバイト列とハッシュと数（送る処理と同じ関数）"),
  checkpointOpenText: human("/human/checkpoint-open-text", "checkpoint_open_text", 64 * 1024, "検問所：出ていく束を同期されない一時フォルダに写し、OS のテキストエディタで開く"),
  checkpointSend: human("/human/checkpoint-send", "checkpoint_send", 64 * 1024, "検問所：合言葉で署名し、束を輪のフォルダに置く"),
  ringVerify: human("/human/ring-verify", "ring_verify", 64 * 1024, "輪を受け手と同じ関数で確かめる"),
  readingsRead: human("/human/readings-read", "readings_read", 16 * 1024, "保管先の承認済みの読み方（3 段目の Skill）を、作業画面に読み込む"),
  peersCompare: human("/human/peers-compare", "peers_compare", 64 * 1024, "受け手：立場ごとに、台帳の clone と自分の輪の ✓ の束から、似た施設の行と統計の行を作る"),
  // 写真（処理は src/bridge/tools.ts の ToolRelay。許しはタブの回のメモリだけに置き、AI に渡すときに画像のハッシュと照らす）
  photoAllow: human("/human/photo-allow", "photo_allow", 64 * 1024, "写真を 1 枚、AI クライアントに渡すことを許す（渡す画像のハッシュに結ぶ。1 回渡すと使い終わる）"),
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
export const APP_PAGES = { home: "#/", selftest: "#/selftest", intake: "#/intake", checkpoint: "#/checkpoint", settings: "#/settings", review: "#/review" } as const;

/** 橋渡しとタブの間で使う HTTP の見出しの名前 */
export const HEADER_TAB_SECRET = "x-moyai-tab-secret";
export const HEADER_RELAY_KEY = "x-moyai-relay-key";
