// 橋渡しの HTTP の経路の許可の一覧。一覧に無いものは拒む。
// 人だけの経路（kind: "human"）は、タブの秘密と 1 回きりの印の両方を求める。拒む試験は消さない。

export type RouteKind =
  /** ビルドした画面のファイル */
  | "static"
  /** 誰でも読めてよい、秘密を含まない GET */
  | "public"
  /** タブとの WebSocket（Origin の一致が必須） */
  | "ws"
  /** 中継（moyai mcp）と moyai uninstall だけが呼ぶ。状態フォルダの鍵ファイルで確かめる */
  | "relay"
  /** 作業画面のタブだけが呼ぶ。Origin とタブの秘密が要る（人だけの操作ではないので、1 回きりの印は要らない） */
  | "tab"
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
  // 写し方の案（template-layout-v1）：保存先の様式のファイルを読み、EXPORT が案のとおりに書いた見本を様式の見た目のまま描く
  "template_file_read",
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
  // 輪の仲間の鍵を、鍵番号を照合して確認済みにする・変わった輪の決まりを受け入れる（受け取った束の行で。監査 D1）
  "ring_member_confirm",
  "ring_rules_accept",
  "facility_key_rotate",
  // 公開の台帳へ出す（§2.8。運営者の決定 2026-11-04「MOYAI が出す」）：PR を出すのは人がボタンを押したときだけ。通信は §2.12 の例外
  "ledger_preview",
  "ledger_send",
  // GitHub のアカウントなしで出す（運営者の決定 2026-11-07）：受け口が運営者の GitHub のアカウントで PR を出す。通信は §2.12 の例外（受け口の 1 つだけ）
  "ledger_intake_send",
  "ledger_rules_accept",
  "ledger_prs",
  "github_connect_start",
  "github_connect_state",
  "github_disconnect",
  // 受け手：似た施設と並べる（§2.8 受け取りと 3 つの立場。台帳の clone と自分の輪を受け手の関数で読む）
  "peers_compare",
  "readings_read",
  // ルールの詳細の適用先（docs/screens.md 3.2）：保存先の版の記録から、ルールを載せた版を読む
  "readings_lineage",
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
  /** 守り。kind が human なら両方 true でなければならない。kind が tab ならタブの秘密だけ */
  requires?: { tabSecret: true; oneTimeToken?: true };
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
  // PWA（pwa-v0）：manifest・Service Worker・アイコン 2 つ。どれも完全一致の道だけ
  manifest: { method: "GET", path: "/manifest.webmanifest", kind: "static", note: "PWA の manifest" },
  serviceWorker: { method: "GET", path: "/sw.js", kind: "static", note: "Service Worker（画面の殻だけを覚える）" },
  icon192: { method: "GET", path: "/brand/png/icon-192.png", kind: "static", note: "PWA のアイコン（192px）" },
  icon512: { method: "GET", path: "/brand/png/icon-512.png", kind: "static", note: "PWA のアイコン（512px）" },
  selftestEd25519: {
    method: "GET",
    path: "/selftest/ed25519",
    kind: "public",
    note: "Node の crypto で作った Ed25519 の署名の見本（試験のページが WebCrypto で検証する）",
  },
  ws: { method: "GET", path: "/ws", kind: "ws", note: "タブとの往復" },
  relayTool: { method: "POST", path: "/relay/tool", kind: "relay", maxBody: 1024 * 1024, note: "中継からのツールの呼び出し" },
  relayStop: { method: "POST", path: "/relay/stop", kind: "relay", maxBody: 1024, note: "橋渡しを止める（moyai uninstall と、古い版の橋渡しを替える中継が、鍵ファイルの鍵を添えて送る）" },
  tabIntakeFile: {
    method: "POST",
    path: "/tab/intake-file",
    kind: "tab",
    requires: { tabSecret: true },
    maxBody: 1024,
    note: "AI が intake_add_files で入れる資料の中身を、作業画面が 1 つずつ取りに来る（橋渡しが資料ごとに渡したワンタイムトークンと、そのタブの回だけ）",
  },
  // ヘッダの「Claude と並べる」（docs/screens.md §1）。体は無し（maxBody 0。体があれば断る）。処理は src/bridge/window-arrange.ts
  tabWindowArrange: {
    method: "POST",
    path: "/tab/window-arrange",
    kind: "tab",
    requires: { tabSecret: true },
    maxBody: 0,
    note: "ヘッダの「Claude と並べる」：Windows で、Claude Desktop の窓を左、MOYAI の窓（押した直後の前面の窓）を右に並べる（体は無し。PowerShell の決まった台本だけを走らせ、利用者の値を渡さない）",
  },
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
  commentsList: human("/human/comments-list", "comments_list", 16 * 1024, "計画のコメントを古い順に読む（HOSHITORI の横の板の「コメント」）"),
  planVersionRead: human("/human/plan-version-read", "plan_version_read", 16 * 1024, "確かめで合う版の計画を 1 つ読む（トップの版のメニュー：開く・この版から次の版・この版から別の施設をつくる）"),
  planSign: human("/human/plan-sign", "plan_sign", 16 * 1024, "いちばん新しい版に、自分の鍵で承認か差し戻しの署名を足し、編集の番を替える（頼みを受け取った鍵だけ）"),
  requestReceive: human("/human/request-receive", "request_receive", 16 * 1024, "メールのリンクの使い捨ての合言葉を頼みと照らし、自分の鍵で受け取りに署名して置く（最初の 1 つだけ）"),
  requestRenew: human("/human/request-renew", "request_renew", 16 * 1024, "頼み直す：新しい頼みに署名して置き、前のリンクを使えなくする。渡すメールの文を用意する"),
  planFileRead: human("/human/plan-file-read", "plan_file_read", 16 * 1024, "確定した版の Excel（人が見る様式の星取表か差分レポート）を読んで、画面がブラウザに落とす"),
  planSourcePut: human("/human/plan-source-put", "plan_source_put", 90 * 1024 * 1024, "次の版に重ねるため、版を組んだ資料を 1 つ、保存先の計画のフォルダに中身のアドレス（SHA-256）で置く（確定では SHA-256 だけを送る）"),
  planSourceRead: human("/human/plan-source-read", "plan_source_read", 16 * 1024, "確かめで合う版を組んだ資料を 1 つ読む（版の記録の SHA-256 と照らす。次の版に重ねるため、画面に戻す）"),
  templatesRead: human("/human/templates-read", "templates_read", 16 * 1024, "保存先の様式と写し方（列の役目）の一覧と、承認済みか下書きか、その版で書き出したか"),
  templateSave: human("/human/template-save", "template_save", 12 * 1024 * 1024, "利用者が落とした様式と、直した写し方（列の役目）を、保存先に下書きとして置く"),
  templateFileRead: human("/human/template-file-read", "template_file_read", 16 * 1024, "保存先の様式のファイルを 1 つ読む（EXPORT が写し方の案のとおりに書いた見本を、様式の見た目のまま描くため。版のハッシュと照らす）"),
  exportSign: human("/human/export-sign", "export_sign", 16 * 1024, "いちばん新しい版を保存先の様式で書き出し、書き出した Excel に自分の鍵で署名して版に足す（版の中身は変えない。その写し方の承認になる）"),
  exportFileRead: human("/human/export-file-read", "export_file_read", 16 * 1024, "署名した書き出しの Excel を読み、署名のハッシュと照らしてから、画面がブラウザに落とす"),
  personKeyCreate: human("/human/person-key-create", "person_key_create", 16 * 1024, "自分の鍵（版に署名する）を作り、状態フォルダに置く"),
  personKeyConfirm: human("/human/person-key-confirm", "person_key_confirm", 16 * 1024, "ほかの人の鍵を、鍵番号を照合して確認済みにする（それまでの署名では読み方を承認しない）"),
  settingsRead: human("/human/settings-read", "settings_read", 64 * 1024, "置き場所・Documents の場所・共有フォルダの一覧を読む"),
  settingsSave: human("/human/settings-save", "settings_save", 64 * 1024, "置き場所・公開の台帳の clone の場所・自分の呼び名を保存する"),
  ringCreate: human("/human/ring-create", "ring_create", 64 * 1024, "共有フォルダを作り、その鍵の対を状態フォルダに置く"),
  checkpointPreview: human("/human/checkpoint-preview", "checkpoint_preview", 64 * 1024, "検問所：出ていく共有ファイルのバイト列とハッシュと数（送る処理と同じ関数）"),
  checkpointOpenText: human("/human/checkpoint-open-text", "checkpoint_open_text", 64 * 1024, "検問所：出ていく共有ファイルを同期されない一時フォルダに写し、OS のテキストエディタで開く"),
  checkpointSend: human("/human/checkpoint-send", "checkpoint_send", 64 * 1024, "検問所：署名し、共有ファイルを共有フォルダに置く"),
  ringVerify: human("/human/ring-verify", "ring_verify", 64 * 1024, "共有フォルダを受け手と同じ関数で確かめる"),
  ringMemberConfirm: human("/human/ring-member-confirm", "ring_member_confirm", 16 * 1024, "共有フォルダのメンバーの鍵を、鍵番号を照合して確認済みにする（確認済みのメンバーの共有ファイルだけを数える）"),
  facilityKeyRotate: human(
    "/human/facility-key-rotate",
    "facility_key_rotate",
    16 * 1024,
    "共有フォルダへ出す施設の署名鍵を作り直す：今の鍵ごとに、その鍵自身の署名の引退の記録（鍵 ID・最後の連番・月だけ）を共有フォルダに置き、保管先の鍵を引退させる。新しい鍵は次に送るときに作る",
  ),
  ringRulesAccept: human("/human/ring-rules-accept", "ring_rules_accept", 16 * 1024, "変わった共有フォルダの決まり（circle.json）を受け入れる（受け入れるまで送らない。緩くした決まりは受け入れない）"),
  ledgerPreview: human("/human/ledger-preview", "ledger_preview", 64 * 1024, "公開の台帳へ出す共有ファイルのバイト列とハッシュと数（共有フォルダと同じ関数。行き先は台帳の clone の決まり）"),
  ledgerSend: human(
    "/human/ledger-send",
    "ledger_send",
    64 * 1024,
    "共有ファイルに署名し、台帳の clone に足したときに受け手と同じ関数で ✓ になるかを確かめてから、GitHub で台帳をフォークして共有ファイル 1 つの PR を出す（通信の例外。行き先は github.com と api.github.com だけ）",
  ),
  ledgerIntakeSend: human(
    "/human/ledger-intake-send",
    "ledger_intake_send",
    64 * 1024,
    "共有ファイルに署名し、台帳の clone に足したときに受け手と同じ関数で ✓ になるかを確かめてから、公開の台帳の受け口に共有ファイル 1 つを送る。受け口が運営者の GitHub のアカウントで PR を出す（GitHub のアカウントなしの道。通信の例外。行き先は受け口の 1 つだけ）",
  ),
  ledgerRulesAccept: human("/human/ledger-rules-accept", "ledger_rules_accept", 16 * 1024, "変わった公開の台帳の決まりを、人が差を見て受け入れる（見た決まりのハッシュと同じで、緩くした決まりでないときだけ）"),
  ledgerPrs: human("/human/ledger-prs", "ledger_prs", 16 * 1024, "出した共有ファイルの PR の行方（審査中・台帳の検証・載った・差し戻しの理由）を、公開の PR からトークン無しで読む（SHARE を開いたときだけ）"),
  githubConnectStart: human(
    "/human/github-connect-start",
    "github_connect_start",
    16 * 1024,
    "GitHub につなぐ：OAuth のデバイスフローを始める（人が github.com でコードを入れる。scope は public_repo だけ）。台帳に共有ファイルを出す施設の鍵は、送ったときに保管先の計画のフォルダに書く",
  ),
  githubConnectState: human("/human/github-connect-state", "github_connect_state", 16 * 1024, "GitHub につなぐ途中の様子（待っている・つながった・断られた・時間切れ）。つながったら、トークンを状態フォルダに置く（包まない。見張りのフックが AI の読み取りを止める）"),
  githubDisconnect: human("/human/github-disconnect", "github_disconnect", 16 * 1024, "GitHub との接続を切る（状態フォルダのトークンのファイルを消す）"),
  readingsRead: human("/human/readings-read", "readings_read", 16 * 1024, "保管先の承認済みの読み方（3 段目の Skill）を、作業画面に読み込む"),
  readingsLineage: human("/human/readings-lineage", "readings_lineage", 16 * 1024, "ルールの詳細の適用先：保管先の版の記録から、ルールの版を載せた版（施設・版・時刻・編集の番）とルールの置き場所を読む（読むだけ）"),
  peersCompare: human("/human/peers-compare", "peers_compare", 64 * 1024, "受け手：立場ごとに、台帳の clone と自分の共有フォルダの ✓ の共有ファイルから、類似施設の行と統計の行を作る"),
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
