// docs/security.md の中身を、ツール定義と経路の許可の一覧（この 1 か所）から作る（docs/plan.md §2.12・§5.2 の 6）。
// 手で書いた文は「決まりの説明」と「保証できないこと」だけで、ツール・上限・人だけの経路の表はコードの値から作る。
// 画面の［AI に渡るもの］も、同じ関数から作る（未実装）。tests/contract/security-doc.test.ts が、docs/security.md と同じかを確かめる。
import { HUMAN_ACTIONS, ROUTES, type RouteDef } from "./routes";
import { EXAMPLES_MAX, ROWS_PER_CALL, ROWS_PER_CONVERSATION, SURVEY_TEXT_MAX, SURVEY_TOP_VALUES, TOOL_NAMES, TOOL_TIMEOUTS, TOOLS, type ToolKind, type ToolName } from "./tools";

const KIND: Record<ToolKind, string> = { read: "読む", propose: "案を置く", start: "始める" };

/** 説明の最初の文（「。」まで） */
function firstSentence(s: string): string {
  const i = s.indexOf("。");
  return i < 0 ? s : s.slice(0, i + 1);
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export interface SecurityDocInput {
  /** ツールごとの、橋渡しの受け手（作業画面へ渡すか「未実装」）。src/bridge/tools.ts の BRIDGE_TOOL_RECEIVERS */
  receivers: Record<ToolName, string>;
  /** 1 回きりの印の有効な時間（ミリ秒）。src/bridge/tokens.ts */
  tokenTtlMs: number;
  /** 1 ファイルの上限（バイト）。src/app/intake/workspace.ts */
  maxFileBytes: number;
}

/** docs/security.md の本文 */
export function securityMarkdown(i: SecurityDocInput): string {
  const L: string[] = [];
  L.push("# MOYAI の守り");
  L.push("");
  L.push("このファイルは `src/shared/security.ts` が、ツール定義と経路の許可の一覧から作ります。手で直さないでください（`MOYAI_WRITE_DOCS=1 npx vitest run tests/contract/security-doc.test.ts` で作り直します）。");
  L.push("");
  L.push("決めるのは人です。確定・送る・昇格・保存は、AI のツールにありません。AI クライアントが使えるのは下の表のツールだけで、人だけの操作は作業画面のボタンと、端末の人だけのコマンドにあります。");
  L.push("");
  L.push("## AI に渡る範囲（ツールごと）");
  L.push("");
  L.push("AI クライアント（Claude Code・Claude Desktop）は、標準入出力の MCP の中継（`moyai mcp`）からこのツールを呼びます。結果は AI クライアントに渡り、その先の AI の提供者にも渡ります。");
  L.push("");
  L.push("| ツール | 種類 | 今 | 渡るもの・置くもの | 待ちの上限 |");
  L.push("|---|---|---|---|---|");
  for (const n of TOOL_NAMES) {
    const t = TOOLS[n];
    const now = t.waitsFor !== null ? "まだ見せない" : i.receivers[n] === "not_implemented" ? "未実装" : "動く";
    const to = TOOL_TIMEOUTS[t.kind];
    const wait = `${to.ms / 1000} 秒${to.retries ? `、${to.retries} 回だけ送り直す` : "、送り直さない（来なければ「結果不明」）"}`;
    L.push(`| \`${n}\` | ${KIND[t.kind]} | ${now} | ${cell(firstSentence(t.description))} | ${wait} |`);
  }
  L.push("");
  L.push("## 上限");
  L.push("");
  L.push(`- 星取表の行は、1 回 ${ROWS_PER_CALL} 行まで、会話（中継の 1 つの接続）で ${ROWS_PER_CONVERSATION.toLocaleString("ja-JP")} 行まで。数えるのは橋渡しで、タブを読み込み直しても数は戻りません。`);
  L.push(`- 要約の欄ごとの多い値は ${SURVEY_TOP_VALUES} まで、文字は ${SURVEY_TEXT_MAX} 字まで。行の参照の例は ${EXAMPLES_MAX} 件まで。`);
  L.push(`- 資料は 1 ファイル ${Math.round(i.maxFileBytes / 1024 / 1024)} MB まで（作業画面のタブのメモリに読みます）。`);
  L.push("- 外へ出た台帳：橋渡しは、AI に返した結果ごとに、ツールの名前・大きさ（バイト）・行の数と、会話ごとの合計を残します。中身は残しません（画面に出すのは未実装）。");
  L.push("");
  L.push("## 人だけの操作（AI のツールに無い）");
  L.push("");
  L.push(`次の経路は、タブの秘密（作業画面のタブが作り、HTML にもどの GET にも入れない）と、1 回きりの印（操作と中身のハッシュに結び、${i.tokenTtlMs / 1000} 秒で切れ、1 回使うと消える）の両方を求めます。一覧に無い経路は断ります。`);
  L.push("");
  L.push("| 経路 | 操作 | 説明 |");
  L.push("|---|---|---|");
  for (const [id, r] of Object.entries(ROUTES) as [string, RouteDef][]) {
    if (r.kind !== "human") continue;
    L.push(`| \`${r.method} ${r.path}\` | \`${r.action}\` | ${cell(r.note)} |`);
    void id;
  }
  L.push("");
  L.push(`人だけの操作の名前は ${HUMAN_ACTIONS.length} 個です。ツールの名前と重ならないことを試験で確かめています。`);
  L.push("");
  L.push("## 網の外側");
  L.push("");
  L.push("- 橋渡しは 127.0.0.1 の 1 つのポートだけで待ち受け、Host・Origin・Sec-Fetch-Site を確かめます。これは Web ページからの呼び出しへの守りで、同じ PC の同じ利用者のプロセスは止めきれません（curl も Node も Origin を偽れます）。");
  L.push("- 中継と橋渡しの間は、状態フォルダの鍵ファイル（利用者だけが読める既定の権限）で確かめます。同じ利用者のプロセスには読めます。");
  L.push("- シェルを持つ AI（Claude Code）には、リポジトリの `.claude/settings.json` の deny と PreToolUse のフック（`scripts/guard-hook.mjs`）の二重で、127.0.0.1 への HTTP・状態フォルダの読み取り・輪のフォルダへの書き込み・人だけのコマンドを止めます。悪意のある同じ利用者のプロセスは止めきれません。");
  L.push("- 人だけのコマンド（鍵を作る、送る、台帳に出す）は、標準入力が端末でなければ断ります。");
  L.push("- API のキーは環境変数だけで、使うのは Skill の採点（`moyai eval`）だけです。チャットでもツールでも受け取りません。");
  L.push("");
  L.push("## 保証できないこと");
  L.push("");
  L.push("1. 1 回の上限は、繰り返し呼べば越えられます（だから会話の合計に上限を置き、外へ出た台帳に合計を残します）。");
  L.push("2. チャットに Excel を添付すれば、ファイル全体が AI の提供者に渡ります。");
  L.push("3. ファイルを読める AI は、確定した計画のファイルを直接読めます。");
  L.push("4. Documents が同期フォルダ（OneDrive など）の下なら、確定した計画は会社のクラウドに上がります（だから最初に調べて知らせます）。");
  L.push("5. 「外へは送らない」はアプリの通信の話で、データの行き先の保証ではありません。");
  L.push("6. 写真とスキャンの読み取りでは、人が許したその画像が AI の提供者に渡ります。");
  L.push("7. 画面を操作できる AI の道具（ブラウザやデスクトップの操作）は、人だけのボタンを押せます。");
  L.push("");
  return L.join("\n");
}
