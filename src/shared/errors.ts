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
    text: "The MOYAI bridge is not running. If you have a shell, run `moyai start` (node dist/cli.js start) in the background in the repository folder, and tell the user the reason it prints.",
  },
  bridge_port_taken: {
    from: "relay",
    to: "ai",
    text: "Another tool is using port {port}. The MOYAI bridge could not be started. Even if it is a previous version's MOYAI bridge, the relay does not stop it when the key file is missing, the key does not match, or it does not stop. Tell the user this, and ask them to close the tool using {port} or restart the PC, then ask again.",
  },
  bridge_timeout: {
    from: "relay",
    to: "ai",
    text: "No answer came from the work screen in time (sent again once). Ask the user to check that the work screen is open.",
  },
  bridge_connection_lost: {
    from: "relay",
    to: "ai",
    text: "The connection to the bridge broke off (sent again once). Ask the user to check that the work screen and the bridge are running.",
  },
  result_unknown: {
    from: "relay",
    to: "ai",
    text: "No answer came in time, so the result is unknown. Writes are not sent again automatically. The work screen tab may be asleep in the background. Call intake_survey with show: true to bring the work screen to the front, check the result, and only if it did not go in, call once more.",
  },
  // 橋渡し → AI（中継を通る）
  not_implemented: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "This tool has only its name and schema and does not work yet (not implemented).",
  },
  invalid_input: {
    from: "bridge",
    to: "ai",
    http: 400,
    text: "The arguments do not fit the schema. Do not patch them; reread the schema and call again.",
  },
  unknown_tool: { from: "bridge", to: "ai", http: 404, text: "There is no such tool." },
  relay_key_mismatch: {
    from: "bridge",
    to: "ai",
    http: 401,
    text: "The relay key does not match the bridge. Restart the bridge, then reconnect the AI client.",
  },
  // 橋渡し → AI（作業画面へ渡すツール。待ちの上限は src/shared/tools.ts の TOOL_TIMEOUTS）
  work_screen_not_open: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "The work screen is not open. Open the work screen URL (workScreenUrl in the result right after the bridge started; default http://127.0.0.1:43110/) in Chrome or Edge (open it yourself if you have a shell; otherwise ask the user to open the link).",
  },
  // intake_survey（show: true）で、橋渡しがブラウザを開いたのに、作業画面のタブが時間内につながらなかった（もう 1 つ開かない）
  work_screen_not_connected: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "The work screen was opened in the default browser, but the tab did not connect in time. Tell the user \"The work screen is not connected yet. Please look at the tab that was opened.\" and, once they have looked, call intake_survey again. If the opened tab cannot be found, open the work screen URL (workScreenUrl) in Chrome or Edge (open it yourself if you have a shell; otherwise ask the user to open the link).",
  },
  tab_no_answer: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "No answer came from the work screen (timed out or closed midway).",
  },
  tab_bad_result: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "The work screen's answer did not fit the schema, so it is not passed on. Ask the user to check the state of the work screen.",
  },
  rows_limit_reached: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "The limit of star chart rows readable in this conversation (2,000 rows) was reached. Do not copy rows; place proposals with rules.",
  },
  photo_permission_mismatch: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "The image the work screen tried to pass does not match the image a person allowed on the screen, so it is not passed. Ask the user to press the button that passes the photo to the AI client again, in the photo area of the intake screen.",
  },
  // 作業画面 → AI（橋渡しと中継を通る。作業画面は誤りの名前だけを返し、文はここから作る）
  reading_when_ignored: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "when has no effect on same equipment, fixed answers or plan rules (they apply to every file). Place the rule again without when, or check with the user which files it should apply to. No rule was placed. when works for heading row, column role, date format, effort unit, row role and star meaning. Only fixed answers that drop a whole file (answer reference or reject) can be placed with when.file (a file name pattern) pointing at the file (a headings when has no effect).",
  },
  no_reading_draft: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "There is no draft of rules with that name on the work screen. Place rules with reading_rules_propose first and have the user look at the result read again.",
  },
  facility_name_invalid: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The shape of the proposed facility name is wrong (1 to 40 characters, no leading or trailing spaces). No proposal was placed.",
  },
  facility_name_fictional: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The 【架空】 mark cannot be removed from a fictional facility's name. Place it again with a name that includes 【架空】. No proposal was placed.",
  },
  pack_basis_unknown: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The Skill pack standard (check ID) given as the basis is not in the checks.json of this plan's Skill pack. No proposal was placed. Reread the check IDs with check_results and point again.",
  },
  plan_rule_unknown: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The plan rule (name and id) given as the basis is not among the rules the work screen applies (approved ones and the working version's draft). No proposal was placed. Check the name and id in the answer of reading_skills_list or reading_rules_propose.",
  },
  star_work_unknown: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "rowRef of a star proposal does not point at a work in the working plan. No proposal was placed. Pass an equipment row id (n:...) as rowRef to chart_rows and point again with the returned work row id (w:...).",
  },
  star_out_of_range: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "A star proposal's fiscal year is outside the plan range (the first and last years of the star chart), or tries to place an actual after the fiscal year of the reference date, or a move has the same from and to year. No proposal was placed. Check the years with the user.",
  },
  star_unknown: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The star a removal or move points at (plan or actual for that work x fiscal year) is not in the working plan (an unconfirmed proposal cannot be pointed at for removal; a person rejects it on the Decisions sheet). No proposal was placed. Reread the work rows with chart_rows.",
  },
  star_basis_invalid: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The star proposal lacks grounds. No proposal was placed. An actual can be added only from the user's words (author: ai_relayed_human), not on Claude's own judgment; record, pack and rule in bases are not grounds for an actual. An actual can be removed only from the user's words (author: ai_relayed_human). ledger cannot be used with star proposals.",
  },
  no_reading_root: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "The storage location is not set, so rules cannot be written. Ask the user to choose a storage location in Settings.",
  },
  no_ledger: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "The location of the public ledger clone is not in the settings. Ask the user to choose the ledger clone location in Settings (the user runs clone and git pull in a terminal).",
  },
  ledger_basis_unchecked: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "The bridge could not check the ledger-based cycle proposal. Either the ledger version differs from the current clone, or peer_reference (place: ledger) in this conversation has fewer than 5 similar facilities for that item and work (no median shown). Read again with peer_reference (place: ledger) and use only rows with a median as the basis. No proposal was placed.",
  },
  ledger_basis_mismatch: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The years of the ledger-based cycle proposal are outside the quartiles of the checked aggregate, or the works the rule matched include no work of that item and work attribute. No proposal was placed. Place it again with works and years that fit the item, work attribute and quartiles of the peer_reference (place: ledger) aggregate.",
  },
  // 資料を作業画面に入れる（intake_add_files）。道を確かめるのは橋渡し
  intake_path_not_allowed: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "Files are not read from that folder. Only folders given as an absolute path, without `..`, not a symbolic link, and outside the state folder and the repository are read. Ask the user again where the folder with the files is.",
  },
  intake_folder_missing: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "That folder cannot be found or read. Ask the user to check the folder's location.",
  },
  // source: template の様式（.xlsx 1 つ）。道の確かめは folder と同じ（intake_path_not_allowed）
  intake_template_missing: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "The template file cannot be found, is not .xlsx, or is over 8 MB. No template was added. Ask the user to check the location (absolute path) of the template .xlsx.",
  },
  intake_template_unreadable: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "The template could not be read as Excel (.xlsx). No template was added. Tell the user to open it in Excel, save it again as .xlsx, and use that.",
  },
  intake_demo_missing: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "The demo files (the Skill pack's demo/) cannot be found. Call again with a Skill pack ID in pack, or check that the repository's packs/ has demo/.",
  },
  intake_demo_mixed: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "Another Skill pack is selected on the work screen, so the demo files were not added (never mixed). There is no button to empty the work screen. Ask the user whether to keep the current work; if not, have them reload the work screen tab (the browser reload, F5), then call again. Reloading clears the added files and facility settings. An unconfirmed working plan appears under previous work in the bottom bar, and the user chooses to restore or discard it.",
  },
  // folder の pack：作業画面の Skillパックの欄で選べるものだけ（橋渡しは packs/ を見て、{packs} に ID と名前を並べる）
  intake_pack_unknown: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "There is no such Skill pack. No files were added. pack accepts only the IDs selectable in the Skill pack field of the work screen ({packs}). Call again with one that fits the user's industry in pack. If none fits, tell the user there is no Skill pack for that industry yet and call again without pack (a plan cannot be made while the Skill pack stays empty).",
  },
  intake_pack_not_on_screen: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "That Skill pack is not in the work screen's Skill pack list (the work screen build and packs/ do not match). No files were added. Call again without pack and tell the user about it.",
  },
  ledger_pack_not_ready: {
    from: "bridge",
    to: "ai",
    http: 200,
    text: "This plan's Skill pack lacks the parts used for sharing (public vocabulary, profile axes, national table). It cannot be compared with the public ledger.",
  },
  no_peer_view: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The user has not opened the comparison with similar facilities on the star chart screen yet. Ask the user to open the comparison with similar facilities on a common equipment item row of the star chart (a person chooses on the screen which place and profile to compare).",
  },
  no_working_plan: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "There is no working plan yet. Start making it with intake_compose and check the result in intake_survey compose.",
  },
  unknown_question: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "That question id is not on the current work screen. No decision was placed. Reread the questions with intake_survey.",
  },
  answer_not_offered: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The answer is not among the options the question offers (an options id; a positive number for a question whose valueKind is number). No decision was placed. Reread the options with intake_survey.",
  },
  human_decided: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "A person answered that question on the screen. No decision was placed. To change it, ask the user to correct it on the screen.",
  },
  stale_version: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The base version (basedOnVersion) differs from the version of the plan on the work screen. No proposal was placed. Reread version from intake_survey (part: crosswalk) and place again.",
  },
  code_not_in_pack: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The tier-1 item code to set is not in this plan's Skill pack list (does not fit the schema). No proposal was placed. Choose from the items codes of intake_survey (part: crosswalk).",
  },
  tool_failed: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The tool could not run on the work screen. Ask the user to check the state of the work screen.",
  },
  // 写真（photo_transcribe）。許すのは人だけで、許すツールは無い
  photo_not_allowed: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "A person has not yet allowed passing that photo to the AI client on the screen (allowed one photo at a time, used up once passed). No image was passed. Ask the user to press the button that passes the photo to the AI client, in the photo area of the intake screen. The AI tools cannot allow it.",
  },
  photo_not_received: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "That photo (imageRef) is not on the work screen, or has not been received with photo_transcribe receive yet. No cell was placed. Receive it first, read the image, then place.",
  },
  photo_grid_invalid: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "The placed grid does not fit the received image (a position is outside the image). No cell was placed. Do not patch it; read again in the pixels of the received image (origin at top left) and place again.",
  },
  photo_human_reviewed: {
    from: "tab",
    to: "ai",
    http: 200,
    text: "A person corrected or checked that photo's grid on the screen. No cell was placed. To change it, ask the user to correct it on the screen.",
  },
  // 橋渡し → タブ（WebSocket）
  tab_taken_over: { from: "bridge", to: "tab", text: "作業画面は、あとから開いたタブに移りました。" },
  tab_elsewhere: { from: "bridge", to: "tab", text: "作業画面は別のタブで開いています。" },
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
  intake_file_unavailable: { from: "bridge", to: "tab", http: 404, text: "渡す資料が見つからないか、読む間に変わりました。" },
  secret_missing: { from: "bridge", to: "tab", http: 403, text: "タブの秘密がありません。" },
  secret_mismatch: { from: "bridge", to: "tab", http: 403, text: "タブの秘密が違います。" },
  token_missing: { from: "bridge", to: "tab", http: 403, text: "ワンタイムトークンがありません。" },
  token_unknown: { from: "bridge", to: "tab", http: 403, text: "ワンタイムトークンが無効です（使い終えたか、出していないもの）。" },
  token_expired: { from: "bridge", to: "tab", http: 403, text: "ワンタイムトークンが切れました。" },
  token_mismatch: { from: "bridge", to: "tab", http: 403, text: "ワンタイムトークンが、この操作か中身と結ばれていません。" },
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
