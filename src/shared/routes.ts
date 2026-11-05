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
  // トップ：保管先の施設と版の一覧（もやいの星取表。docs/screens.md 3.1）と、版の印のメニューで 1 つの版を読む
  "plans_list",
  "plan_version_read",
  // MERGE の横の板のコメント（版・行・呼び名・時刻・文。保管先に置く）
  "comment_add",
  "comments_list",
  // 承認：いちばん新しい版に、承認か差し戻しの署名を足す（docs/screens.md 3.2 の下の帯）
  "plan_sign",
  // 頼みの受け取り（メールのリンクを開いた人の鍵で署名）と、頼み直す（監査 B1。運営者の決定「マジックリンクで鎖をつなぐ」）
  "request_receive",
  "request_renew",
  // EXPORT：確定した版の Excel（人が見る様式・差分レポート）を、人が画面で落とす（docs/screens.md 3.5）
  "plan_file_read",
  // 様式で書き出す（3C：様式と写し方は保存先、書き出した Excel に人が署名する）
  // 次の版に重ねる資料（1C・重-2）：先に置き、版の資料を読む
  "plan_source_put",
  "plan_source_read",
  "templates_read",
  "template_save",
  "export_sign",
  "export_file_read",
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
  // 輪の仲間の鍵を、指紋を読み合わせて確認済みにする・変わった輪の決まりを受け入れる（受け取った束の行で。監査 D1）
  "ring_member_confirm",
  "ring_rules_accept",
  // 公開の台帳へ出す（§2.8。運営者の決定 2026-11-04「MOYAI が出す」）：PR を出すのは人がボタンを押したときだけ。通信は §2.12 の例外
  "ledger_preview",
  "ledger_send",
  "ledger_prs",
  "github_connect_start",
  "github_connect_state",
  "github_disconnect",
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
  planCommit: human("/human/plan-commit", "plan_commit", 32 * 1024 * 1024, "計画を確定する（自分の鍵で版に署名し、版のファイルと署名を足し、差分レポートと人が見る様式の星取表の Excel を書く）"),
  planRevert: human("/human/plan-revert", "plan_revert", 64 * 1024, "前の版に戻す（前の版を指す記録を足し、自分の鍵で署名する）"),
  plansList: human("/human/plans-list", "plans_list", 16 * 1024, "保管先の施設と版の一覧（版の番号・時刻・署名の役目・確かめの結果・編集の番）を、トップのもやいの星取表に読む"),
  commentAdd: human("/human/comment-add", "comment_add", 16 * 1024, "計画にコメントを足す（星取表の行と、この PC の呼び名を添えて、保管先に置く。署名はしない）"),
  commentsList: human("/human/comments-list", "comments_list", 16 * 1024, "計画のコメントを古い順に読む（MERGE の横の板の「コメント」）"),
  planVersionRead: human("/human/plan-version-read", "plan_version_read", 16 * 1024, "確かめで合う版の計画を 1 つ読む（トップの版の印のメニュー：開く・この版から次の版・この版から別の施設をつくる）"),
  planSign: human("/human/plan-sign", "plan_sign", 16 * 1024, "いちばん新しい版に、自分の鍵で承認か差し戻しの署名を足し、編集の番を替える（頼みを受け取った鍵だけ）"),
  requestReceive: human("/human/request-receive", "request_receive", 16 * 1024, "メールのリンクの使い捨ての合言葉を頼みと照らし、自分の鍵で受け取りに署名して置く（最初の 1 つだけ）"),
  requestRenew: human("/human/request-renew", "request_renew", 16 * 1024, "頼み直す：新しい頼みに署名して置き、前のリンクを使えなくする。渡すメールの文を用意する"),
  planFileRead: human("/human/plan-file-read", "plan_file_read", 16 * 1024, "確定した版の Excel（人が見る様式の星取表か差分レポート）を読んで、画面がブラウザに落とす"),
  planSourcePut: human("/human/plan-source-put", "plan_source_put", 24 * 1024 * 1024, "次の版に重ねるため、版を組んだ資料を 1 つ、保存先の計画のフォルダに中身のアドレス（SHA-256）で置く（確定では SHA-256 だけを送る）"),
  planSourceRead: human("/human/plan-source-read", "plan_source_read", 16 * 1024, "確かめで合う版を組んだ資料を 1 つ読む（版の記録の SHA-256 と照らす。次の版に重ねるため、画面に戻す）"),
  templatesRead: human("/human/templates-read", "templates_read", 16 * 1024, "保存先の様式と写し方（列の役目）の一覧と、承認済みか下書きか、その版で書き出したか"),
  templateSave: human("/human/template-save", "template_save", 12 * 1024 * 1024, "利用者が落とした様式と、直した写し方（列の役目）を、保存先に下書きとして置く"),
  exportSign: human("/human/export-sign", "export_sign", 16 * 1024, "いちばん新しい版を保存先の様式で書き出し、書き出した Excel に自分の鍵で署名して版に足す（版の中身は変えない。その写し方の承認になる）"),
  exportFileRead: human("/human/export-file-read", "export_file_read", 16 * 1024, "署名した書き出しの Excel を読み、署名のハッシュと照らしてから、画面がブラウザに落とす"),
  personKeyCreate: human("/human/person-key-create", "person_key_create", 16 * 1024, "自分の鍵（版に署名する）を作り、状態フォルダに置く"),
  personKeyConfirm: human("/human/person-key-confirm", "person_key_confirm", 16 * 1024, "ほかの人の鍵を、指紋を読み合わせて確認済みにする（それまでの署名では読み方を承認しない）"),
  settingsRead: human("/human/settings-read", "settings_read", 64 * 1024, "置き場所・Documents の場所・輪の一覧を読む"),
  settingsSave: human("/human/settings-save", "settings_save", 64 * 1024, "置き場所・公開の台帳の clone の場所・自分の呼び名を保存する"),
  ringCreate: human("/human/ring-create", "ring_create", 64 * 1024, "輪を作り、その輪の鍵の対を状態フォルダに置く"),
  checkpointPreview: human("/human/checkpoint-preview", "checkpoint_preview", 64 * 1024, "検問所：出ていく束のバイト列とハッシュと数（送る処理と同じ関数）"),
  checkpointOpenText: human("/human/checkpoint-open-text", "checkpoint_open_text", 64 * 1024, "検問所：出ていく束を同期されない一時フォルダに写し、OS のテキストエディタで開く"),
  checkpointSend: human("/human/checkpoint-send", "checkpoint_send", 64 * 1024, "検問所：署名し、束を輪のフォルダに置く"),
  ringVerify: human("/human/ring-verify", "ring_verify", 64 * 1024, "輪を受け手と同じ関数で確かめる"),
  ringMemberConfirm: human("/human/ring-member-confirm", "ring_member_confirm", 16 * 1024, "輪の仲間の鍵を、指紋を読み合わせて確認済みにする（確認済みの仲間の束だけを数える）"),
  ringRulesAccept: human("/human/ring-rules-accept", "ring_rules_accept", 16 * 1024, "変わった輪の決まり（circle.json）を受け入れる（受け入れるまで送らない。緩くした決まりは受け入れない）"),
  ledgerPreview: human("/human/ledger-preview", "ledger_preview", 64 * 1024, "公開の台帳へ出す束のバイト列とハッシュと数（輪と同じ関数。行き先は台帳の clone の決まり）"),
  ledgerSend: human(
    "/human/ledger-send",
    "ledger_send",
    64 * 1024,
    "束に署名し、台帳の clone に足したときに受け手と同じ関数で ✓ になるかを確かめてから、GitHub で台帳をフォークして束 1 つの PR を出す（通信の例外。行き先は github.com と api.github.com だけ）",
  ),
  ledgerPrs: human("/human/ledger-prs", "ledger_prs", 16 * 1024, "出した束の PR の行方（審査中・台帳の検証・載った・差し戻しの理由）を、公開の PR からトークン無しで読む（SHARE を開いたときだけ）"),
  githubConnectStart: human(
    "/human/github-connect-start",
    "github_connect_start",
    16 * 1024,
    "GitHub につなぐ：台帳の自分の鍵が無ければ作り、OAuth のデバイスフローを始める（人が github.com でコードを入れる。scope は public_repo だけ）",
  ),
  githubConnectState: human("/human/github-connect-state", "github_connect_state", 16 * 1024, "GitHub につなぐ途中の様子（待っている・つながった・断られた・時間切れ）。つながったら、トークンを状態フォルダに置く（包まない。見張りのフックが AI の読み取りを止める）"),
  githubDisconnect: human("/human/github-disconnect", "github_disconnect", 16 * 1024, "GitHub との接続を切る（包んだトークンのファイルを消す）"),
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
export const APP_PAGES = { home: "#/", selftest: "#/selftest", intake: "#/intake", checkpoint: "#/checkpoint", settings: "#/settings", industries: "#/settings/industries", review: "#/review" } as const;

/** 橋渡しとタブの間で使う HTTP の見出しの名前 */
export const HEADER_TAB_SECRET = "x-moyai-tab-secret";
export const HEADER_RELAY_KEY = "x-moyai-relay-key";
