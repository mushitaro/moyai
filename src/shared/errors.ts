// 誤りの型の一覧。どの誤りにも送り手（from）と受け手（to）を書く。
// tests/contract/ が、送り手のコードがその誤りを出し、受け手がその誤りを人に見せることを数える。
// 受け手が tab のものは、画面の言葉（src/app/text/）に文がある。ai と terminal のものは、ここの text をそのまま返す。
import { z } from "zod";

export type ErrorSide = "bridge" | "relay" | "cli" | "tab";
export type ErrorReceiver = "ai" | "tab" | "terminal";

interface ErrorDef {
  from: ErrorSide;
  to: ErrorReceiver;
  /** HTTP で返すときの状態の番号 */
  http?: number;
  /** ai と terminal に返す文。tab の文は src/app/text/ にある */
  text: string;
}

export const ERRORS = {
  // 中継 → AI
  bridge_not_running: {
    from: "relay",
    to: "ai",
    text: "MOYAI の橋渡しが起きていません。先に、利用者の端末で `moyai start`（node dist/cli.js start）を走らせてもらってください。",
  },
  bridge_timeout: {
    from: "relay",
    to: "ai",
    text: "作業画面からの答えが時間内に来ませんでした（1 回送り直しました）。作業画面が開いているかを利用者に確かめてください。",
  },
  bridge_connection_lost: {
    from: "relay",
    to: "ai",
    text: "橋渡しとの通信が途中で切れました（1 回送り直しました）。作業画面と橋渡しが動いているかを利用者に確かめてください。",
  },
  result_unknown: {
    from: "relay",
    to: "ai",
    text: "時間内に答えが来なかったので、結果は不明です。書き込みは自動で送り直しません。作業画面で結果を確かめてもらってください。",
  },
  // 橋渡し → AI（中継を通る）
  not_implemented: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "このツールは名前と型だけがあり、まだ動きません（未実装）。",
  },
  invalid_input: {
    from: "bridge",
    to: "ai",
    http: 400,
    text: "引数が型に合いません。直さずに、型を読み直してから呼び直してください。",
  },
  unknown_tool: { from: "bridge", to: "ai", http: 404, text: "そのツールはありません。" },
  relay_key_mismatch: {
    from: "bridge",
    to: "ai",
    http: 401,
    text: "中継の鍵が橋渡しと合いません。橋渡しを起こし直してから、AI クライアントをつなぎ直してください。",
  },
  // 橋渡し → AI（作業画面へ渡すツール。待ちの上限は src/shared/tools.ts の TOOL_TIMEOUTS）
  work_screen_not_open: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "作業画面が開いていません。利用者に、moyai start が出した URL を Chrome か Edge で開いてもらってください。",
  },
  tab_no_answer: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "作業画面から答えが来ませんでした（時間切れか、途中で閉じた）。",
  },
  tab_bad_result: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "作業画面の答えが型に合わなかったので、渡しません。作業画面の状態を利用者に確かめてもらってください。",
  },
  rows_limit_reached: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "この会話で読める星取表の行の上限（2,000 行）に達しました。行を写さず、規則で案を置いてください。",
  },
  photo_permission_mismatch: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "作業画面が渡そうとした画像が、人が画面で許した画像と合わないので、渡しません。利用者に、取り込みの画面の写真の欄で、もう一度［AI クライアントに渡して読む］を押してもらってください。",
  },
  // 作業画面 → AI（橋渡しと中継を通る。作業画面は誤りの名前だけを返し、文はここから作る）
  reading_when_ignored: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "同じ機器・決まった答え・計画ルールの規則には when が効きません（どの資料にも当たります）。when を外して置き直すか、効く資料を利用者に確かめてください。規則は置いていません。when が効くのは、見出しの行・列の役目・日付の書き方・工数の単位・行の役割・印の意味です。",
  },
  no_reading_draft: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "その名前の読み方の下書きが、作業画面にありません。先に reading_rules_propose で規則を置き、利用者に読み直した結果を見てもらってください。",
  },
  pack_basis_unknown: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "根拠に指したパックの基準（検査の ID）が、この計画のパックの checks.json にありません。案は置いていません。check_results で検査の ID を読み直してから指してください。",
  },
  plan_rule_unknown: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "根拠に指した計画ルール（名前と id）が、作業画面が当てているルール（承認済みと、作業中の版の下書き）にありません。案は置いていません。reading_skills_list か reading_rules_propose の答えで名前と id を確かめてください。",
  },
  no_reading_root: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "保管先が決まっていないので、読み方を書けません。利用者に、設定で保管先を選んでもらってください。",
  },
  no_ledger: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "公開の台帳の clone の場所が、設定にありません。利用者に、設定で台帳の clone の場所を選んでもらってください（clone と git pull は利用者が端末でします）。",
  },
  ledger_basis_unchecked: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "台帳を根拠にした周期の案を、橋渡しが照らせませんでした。台帳の版が今の clone と違うか、この会話の peer_reference（place: ledger）で、その項目と作業の類似施設が 5 に届いていません（中央値が出ていません）。peer_reference（place: ledger）で読み直し、中央値が出た行だけを根拠にしてください。案は置いていません。",
  },
  ledger_basis_mismatch: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "台帳を根拠にした周期の案の年数が、照らした集計の四分位の外か、規則が当たった作業に、その項目と作業分類の作業がありません。案は置いていません。peer_reference（place: ledger）の集計の項目・作業分類・四分位に合う作業と年数で置き直してください。",
  },
  ledger_pack_not_ready: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "この計画のパックには、共有に使う部品（公開語彙・見え方の軸・全国の表）がありません。公開の台帳と比べられません。",
  },
  no_peer_view: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "類似施設との比べを、利用者がまだ星取表の画面で開いていません。利用者に、星取表の共通の設備項目の行で［類似施設と並べる］を開いてもらってください（どの場を、どの見え方で比べるかは人が画面で選びます）。",
  },
  no_working_plan: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "作業中の計画がまだありません。intake_compose で作り始め、intake_survey の compose で結果を確かめてください。",
  },
  unknown_question: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "その質問の番号は今の作業画面にありません。どの決定も置いていません。intake_survey で質問を読み直してください。",
  },
  answer_not_offered: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "答えが、その質問の出している選択肢（options の id。valueKind が number の質問は正の数）に入っていません。どの決定も置いていません。intake_survey で選択肢を読み直してください。",
  },
  human_decided: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "その質問には人が画面で答えています。どの決定も置いていません。変えるときは、利用者に画面で直してもらってください。",
  },
  stale_version: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "もとにした版（basedOnVersion）が、作業画面の今の計画の版と違います。どの案も置いていません。intake_survey（part: crosswalk）の version を読み直してから置き直してください。",
  },
  code_not_in_pack: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "置く第 1 階層の項目のコードが、この計画のパックの一覧にありません（型に合いません）。どの案も置いていません。intake_survey（part: crosswalk）の items のコードから選んでください。",
  },
  tool_failed: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "作業画面でツールを動かせませんでした。作業画面の状態を利用者に確かめてもらってください。",
  },
  // 写真（photo_transcribe）。許すのは人だけで、許すツールは無い
  photo_not_allowed: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "人がまだ画面で、その写真を AI クライアントに渡すことを許していません（許しは 1 枚ごとで、1 回渡すと使い終わります）。画像は渡していません。利用者に、取り込みの画面の写真の欄で［AI クライアントに渡して読む］を押してもらってください。AI のツールでは許せません。",
  },
  photo_not_received: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "その写真（imageRef）は作業画面に無いか、まだ photo_transcribe の receive で受け取っていません。どのセルも置いていません。先に receive で受け取り、その画像を読んでから置いてください。",
  },
  photo_grid_invalid: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "置いた格子が、受け取った画像に合いません（位置が画像の外にある）。どのセルも置いていません。直さずに、受け取った画像の画素（左上が原点）で読み直して、置き直してください。",
  },
  photo_human_reviewed: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "その写真の格子は、人が画面で直したか確かめています。どのセルも置いていません。変えるときは、利用者に画面で直してもらってください。",
  },
  // 橋渡し → タブ（WebSocket）
  tab_already_open: { from: "bridge", to: "tab", text: "作業画面はほかのタブで開いています。" },
  hello_invalid: { from: "bridge", to: "tab", text: "最初の握手の形が違います。" },
  hello_timeout: { from: "bridge", to: "tab", text: "最初の握手が時間内に来ませんでした。" },
  // 橋渡し → タブ（HTTP。正しいタブだけがこれらの経路を呼ぶ）
  host_not_allowed: { from: "bridge", to: "tab", http: 421, text: "宛先の名前が違います。" },
  origin_missing: { from: "bridge", to: "tab", http: 403, text: "要求の出どころ（Origin）がありません。" },
  origin_not_allowed: { from: "bridge", to: "tab", http: 403, text: "要求の出どころ（Origin）が違います。" },
  fetch_site_not_allowed: { from: "bridge", to: "tab", http: 403, text: "ほかのサイトからの要求は受けません。" },
  route_not_allowed: { from: "bridge", to: "tab", http: 404, text: "許可の一覧に無い経路です。" },
  method_not_allowed: { from: "bridge", to: "tab", http: 405, text: "この経路では受けない呼び方です。" },
  content_type_not_allowed: { from: "bridge", to: "tab", http: 415, text: "中身の形が JSON ではありません。" },
  body_too_large: { from: "bridge", to: "tab", http: 413, text: "中身が大きすぎます。" },
  bad_json: { from: "bridge", to: "tab", http: 400, text: "中身を読めません。" },
  internal: { from: "bridge", to: "tab", http: 500, text: "橋渡しの中で誤りが起きました。" },
  tab_not_open: { from: "bridge", to: "tab", http: 409, text: "作業画面が橋渡しにつながっていません。" },
  secret_missing: { from: "bridge", to: "tab", http: 403, text: "タブの秘密がありません。" },
  secret_mismatch: { from: "bridge", to: "tab", http: 403, text: "タブの秘密が違います。" },
  token_missing: { from: "bridge", to: "tab", http: 403, text: "1 回きりの印がありません。" },
  token_unknown: { from: "bridge", to: "tab", http: 403, text: "1 回きりの印が無効です（使い終えたか、出していないもの）。" },
  token_expired: { from: "bridge", to: "tab", http: 403, text: "1 回きりの印が切れました。" },
  token_mismatch: { from: "bridge", to: "tab", http: 403, text: "1 回きりの印が、この操作か中身と結ばれていません。" },
  // CLI → 端末
  port_in_use: {
    from: "cli",
    to: "terminal",
    text: "ポート {port} はほかのプログラムが使っています。起動を止めました。ほかの moyai start が動いていないか確かめるか、`--port 43111` のように別のポートを指定してください。",
  },
  port_denied: {
    from: "cli",
    to: "terminal",
    text: "ポート {port} で待ち受けることを OS に断られました（権限）。起動を止めました。`--port 43111` のように別のポートを指定してください。",
  },
  bad_args: { from: "cli", to: "terminal", text: "コマンドの形が違います。`moyai --help` を見てください。" },
  app_missing: {
    from: "cli",
    to: "terminal",
    text: "画面のファイル（dist/app）がありません。先に `npm run build` を走らせてください。",
  },
} as const satisfies Record<string, ErrorDef>;

export type ErrorCode = keyof typeof ERRORS;
export const ERROR_CODES = Object.keys(ERRORS) as ErrorCode[];

export type TabErrorCode = { [K in ErrorCode]: (typeof ERRORS)[K]["to"] extends "tab" ? K : never }[ErrorCode];
export const TAB_ERROR_CODES = ERROR_CODES.filter((c) => ERRORS[c].to === "tab") as TabErrorCode[];

/** 作業画面がツールの結果として返す誤り（送り手が tab のもの） */
export type TabSentCode = { [K in ErrorCode]: (typeof ERRORS)[K]["from"] extends "tab" ? K : never }[ErrorCode];
export const TAB_SENT_CODES = ERROR_CODES.filter((c) => ERRORS[c].from === "tab") as TabSentCode[];

/** 誤りの中身。HTTP の答え、WebSocket の断り、ツールの結果（isError）で同じ形を使う。 */
export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

export function errorBody(code: ErrorCode, vars: Record<string, string | number> = {}): ErrorBody {
  let message: string = ERRORS[code].text;
  for (const [k, v] of Object.entries(vars)) message = message.replaceAll(`{${k}}`, String(v));
  return { error: { code, message } };
}

export function httpStatus(code: ErrorCode): number {
  const def: ErrorDef = ERRORS[code];
  return def.http ?? 400;
}
