// docs/security.md の中身を、ツール定義と経路の許可の一覧（この 1 か所）から作る（docs/plan.md §2.12・§5.2 の 6）。
// 手で書いた文は「決まりの説明」と「保証できないこと」だけで、ツール・上限・人だけの経路の表はコードの値から作る。
// 画面の［AI に渡るもの］も、同じ関数から作る（未実装）。tests/contract/security-doc.test.ts が、docs/security.md と同じかを確かめる。
import { HUMAN_ACTIONS, ROUTES, type RouteDef } from "./routes";
import { EXAMPLES_MAX, INTAKE_ADD_EXTENSIONS, INTAKE_ADD_MAX_BYTES, INTAKE_ADD_MAX_FILES, PHOTO_SEND, ROWS_PER_CALL, ROWS_PER_CONVERSATION, SURVEY_TEXT_MAX, SURVEY_TOP_VALUES, TOOL_NAMES, TOOL_TIMEOUTS, TOOLS, type ToolKind, type ToolName } from "./tools";

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
  /** 外へ出た台帳の行の数の上限（橋渡しのメモリ）。src/bridge/tools.ts の OUTBOUND_MAX */
  outboundMax: number;
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
  L.push("例外は 2 つです（MCP の instructions の安全の決まり 1 と同じ）。どちらも、承認は人の署名です。");
  L.push("");
  L.push("1. 引き渡しのメールを送ること。人が HOSHITORI で「署名して渡す」を押すと、`intake_survey` の handoff に MOYAI が用意したメールの文（宛先・件名・本文）が入ります。利用者が送ってと言ったら、Claude が利用者の連携したメールから、その文のまま送ります。中身は版の場所とハッシュと、リンクの中の使い捨ての合言葉（受け取りに使う）です。合言葉は、文を読んだ AI の提供者にも渡ります。受け取れるのは最初の 1 回だけです。計画の中身は運びません。MOYAI にメールを送るツールはありません。");
  L.push("2. 未承認のルール（読み方と計画の規則）の下書きを保管先に書くこと（`reading_skill_register`）。保管先の決まった場所に、未承認の 3 段目の Skill として書きます。書けるのは未承認の下書きの場所だけで、消去・範囲の変更はしません（承認済みの中身はハッシュのまま versions/ に残り、当て続けられる。今の下書きのファイルは書き直すことがある。範囲は置き場所で決まる）。承認は、そのルールを使った版への人の署名です。計画の規則は、その版で人が受けた周期の案のもとになったものだけを、版の記録に載せます。");
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
  L.push(
    "- 作業中の計画と、確定のシートで確定した行は、閉じたあとに戻せるよう、作業画面がこの PC のブラウザの保存領域（IndexedDB）にも 1 つだけ写します。資料は写しません。写しは確定・署名・「捨てる」で消します。" +
      "Service Worker がブラウザに覚えるのは画面の殻（index.html・JS・CSS・書体）だけで、人だけの経路とツールの道は覚えません。",
  );
  L.push(
    `- \`intake_add_files\` は、Skillパックの demo/ の架空の資料か、利用者がチャットで言ったフォルダの直下の ${INTAKE_ADD_EXTENSIONS.join("・")} だけを、1 回 ${INTAKE_ADD_MAX_FILES} 個まで、1 つ ${INTAKE_ADD_MAX_BYTES / 1024 / 1024} MB まで読みます。` +
      "状態フォルダとリポジトリの中・`..` を含む道・シンボリックリンクは読みません。中身は橋渡しが資料ごとのワンタイムトークンで作業画面のタブに渡し、AI に返すのは名前・大きさ・件数（シートと行の数）・断った理由だけです。ほかの種類のファイルと下のフォルダは、名前を返さずに数だけを返します。" +
      "`source: template`（利用者が言った様式の .xlsx 1 つ、8 MB まで。道の確かめは同じ）は、作業画面の出力の様式の欄に入れるだけで保存しません。AI には様式の形（シートの名前、字のあるセルの位置と字、結合、式の位置と年度の参照の式）と計画の階層の名前を返します。値の入ったデータの行は、字も値も返さずに範囲と数だけを返します。",
  );
  L.push(
    `- 写真は、人が作業画面で 1 枚ずつ許したものだけを、1 回に 1 枚渡します。作業画面が長辺 ${PHOTO_SEND.longSideMin.toLocaleString("ja-JP")}〜${PHOTO_SEND.longSideMax.toLocaleString("ja-JP")} px・JPEG で約 ${PHOTO_SEND.targetBytes / 1024} KB 以下に描き直し（切り抜かず、位置などの付け足しの情報は落とす）、` +
      `橋渡しは、許した画像のハッシュと合うものだけを渡します（${PHOTO_SEND.maxBytes / 1024} KB を越えるものは渡しません）。許しは 1 回渡すと使い終わります。`,
  );
  L.push(
    "- `screen_set` は作業画面の見せ方（明暗・開く画面・星取表の階層の並び・機器の並び・計画の最大年度）だけを変えます。見せ方は施設ごとにブラウザに覚え、作業中の計画と版の記録には入れません。" +
      "保存先は変えません。橋渡しが設定と同じ確かめ（絶対の道）を通した道を、設定の画面の保存先の欄に入れて開くだけで、保存は人が押します。答えには今の保存先の道を添えます。" +
      "`templateLayout`（様式の写し方の案）は、作業画面が様式に照らして下書きとして置くだけです。答えは書いたときの数（行・年度・数えた明細）で、金額などの値は返しません。写し方と様式の保存と出力は、人が出力の画面で見本を見て「この写し方で出力」を押したときだけです。",
  );
  L.push(
    "- `share_preview` は、SHARE の画面と同じ関数で作った共有ファイルの、形と数（共有先の種類・版の番号と年度とハッシュの頭・写る機器と作業と作業の年度の値の数・伏せる欄・同区分の施設の数・塊の数）だけを返します。" +
      "機器・作業・施設の名前、年度、階級、分類のコード、費用と、共有ファイルのバイト列は返しません。施設の札（見え方の 1 行）は、軸のコードの名前で返します。作業画面を SHARE に切り替えます。署名して送るのは、人が SHARE の主ボタンを押したときだけです。",
  );
  L.push(
    `- 外へ出た台帳：橋渡しは、AI に返した結果ごとに、ツールの名前・大きさ（バイト）・行の数・添えた画像の大きさを、橋渡しのメモリに新しい ${i.outboundMax.toLocaleString("ja-JP")} 行まで持ち、会話ごとの合計も持ちます。` +
      "返した中身は持ちません。ファイルには書かず、橋渡しを止めると消えます（画面に出すのは未実装）。",
  );
  L.push("");
  L.push("## 人だけの操作（AI のツールに無い）");
  L.push("");
  L.push(`次の経路は、タブの秘密（作業画面のタブが作り、HTML にもどの GET にも入れない）と、ワンタイムトークン（操作と中身のハッシュに結び、${i.tokenTtlMs / 1000} 秒で切れ、1 回使うと消える）の両方を求めます。一覧に無い経路は断ります。`);
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
  L.push("## 作業画面だけが呼ぶ経路と、中継の経路");
  L.push("");
  L.push("作業画面だけが呼ぶ経路は、Origin・Sec-Fetch-Site とタブの秘密を求めます（人だけの操作ではないので、ワンタイムトークンは求めません）。中継の経路は、状態フォルダの鍵ファイルの鍵を求め、ブラウザからの要求（Origin・Sec-Fetch-Site のあるもの）を断ります。");
  L.push("");
  L.push("| 経路 | 求めるもの | 説明 |");
  L.push("|---|---|---|");
  for (const r of Object.values(ROUTES) as RouteDef[]) {
    if (r.kind !== "tab" && r.kind !== "relay") continue;
    L.push(`| \`${r.method} ${r.path}\` | ${r.kind === "tab" ? "タブの秘密" : "鍵ファイルの鍵"} | ${cell(r.note)} |`);
  }
  L.push("");
  L.push("## 網の外側");
  L.push("");
  L.push("- 橋渡しは 127.0.0.1 の 1 つのポートだけで待ち受け、Host・Origin・Sec-Fetch-Site を確かめます。これは Web ページからの呼び出しへの守りで、同じ PC の同じ利用者のプロセスは止めきれません（curl も Node も Origin を偽れます）。");
  L.push("- 中継と橋渡しの間は、状態フォルダの鍵ファイル（利用者だけが読める既定の権限）で確かめます。同じ利用者のプロセスには読めます。");
  L.push("- シェルを持つ AI（Claude Code）には、リポジトリの `.claude/settings.json` の deny と PreToolUse のフック（`scripts/guard-hook.mjs`）の二重で、127.0.0.1 への HTTP・状態フォルダの読み取り・保管先の計画のフォルダの施設の署名鍵（share/keys/）の読み書き・輪のフォルダへの書き込み・人だけのコマンド・見張りのフックと `.claude/settings.json`・`.claude/settings.local.json` の書き換えを止めます。悪意のある同じ利用者のプロセスは止めきれません。");
  L.push("- 通信の例外は公開の台帳だけです。GitHub の道は、行き先が github.com と api.github.com だけです。");
  L.push("- 公開の台帳は、MOYAI のリポジトリ（mushitaro/moyai）の `ledger/` です（2026-11-07 に別のリポジトリ mushitaro/moyai-ledger から移した。運営者の決定）。GitHub の道は mushitaro/moyai をフォークして PR を出します。台帳の PR の検証（`.github/workflows/ledger-validate.yml`）は、`ledger/` が変わった PR だけで走り、`ledger/` の外も変える PR に台帳のファイルが混ざっていれば ✗ にします。");
  L.push("- MOYAI 経由の道（運営者の決定 2026-11-07）は、行き先が公開の台帳の受け口の 1 つだけです。送るのは、公開の台帳に載せるのと同じ共有ファイル（と、その鍵自身の署名の失効記録）だけです。受け口は送り手の IP を数えるのに使い、残しません。受け口が運営者（tsunagi）の GitHub のアカウントで PR を出します。受け口のトークンは mushitaro/moyai の Contents と Pull requests に書けるので、MOYAI のコードの枝にも書けます（main は ruleset で守る）。");
  L.push("- 鍵と GitHub のトークンは合言葉で包みません（運営者の決定 2026-11-04）。人の鍵とトークンは同期されない状態フォルダに、束に署名する施設の鍵は保管先の計画のフォルダ（share/keys/）に置きます。MCP のどのツールの結果にも、鍵とトークンの中身は入れません。");
  L.push("- 人だけのコマンド（鍵を作る、送る、台帳に出す）は、標準入力が端末でなければ断ります。");
  L.push("- `moyai setup`（AI クライアントにつなぐ・送信者の名前）と `moyai uninstall`（消す）は、何をどこに書くか・消すかを先に出し、`--yes` が無ければ端末で「はい」をもらいます。`--yes` は、利用者がチャットで確かめたあとに Claude が付けます（運営者の決定 11-06「チャットだけで入れる・デモする・消す」）。保存先（計画の版）を消すのは `--remove-root` のときだけです。");
  L.push("- API のキーを読むのは、Skill の採点の CLI（`moyai eval`、`src/eval/`）だけで、環境変数 `ANTHROPIC_API_KEY` から読みます。写真の読み取りと MCP のツールはキーを読みません。チャットでもツールでもキーを受け取らず、値を画面・記録・ログに出しません。");
  L.push("");
  L.push("## 保証できないこと");
  L.push("");
  L.push("1. 1 回の上限は、繰り返し呼べば越えられます（だから会話の合計に上限を置き、外へ出た台帳で会話ごとの合計を数えます。合計は橋渡しを止めると消えます）。");
  L.push("2. チャットに Excel を添付すれば、ファイル全体が AI の提供者に渡ります。");
  L.push("3. ファイルを読める AI は、確定した計画のファイルを直接読めます。");
  L.push("4. Documents が同期フォルダ（OneDrive など）の下なら、確定した計画は会社のクラウドに上がります（だから最初に調べて知らせます）。");
  L.push("5. 「外へは送らない」はアプリの通信の話で、データの行き先の保証ではありません。");
  L.push("6. 写真とスキャンの読み取りでは、人が許したその画像が AI の提供者に渡ります。");
  L.push("7. 画面を操作できる AI の道具（ブラウザやデスクトップの操作）は、人だけのボタンを押せます。");
  L.push("8. 計画のフォルダを読める人と AI は、施設の署名鍵を写せます（写した人は、その施設として束を出せます）。保管先が同期フォルダなら、施設の署名鍵も会社のクラウドに上がります。");
  L.push("9. シェルを持つ AI は、見張りのフックを越えられます（スクリプトを書いて走らせる・差分のファイルを git apply する・git reset や git checkout で枝ごと戻す・道に ./ を挟んだシェルの書き込み）。フックが見るのは、AI の道具の呼び出しの字だけです。");
  L.push("10. 施設の署名鍵のファイルを失くすと、その鍵の失効の記録に署名できません。受け手はその鍵を数え続けるので、再発行した新しい鍵が照合されると、同じ施設を 2 つに数えます（長く出していないメンバーを数えから外す決まりは、まだありません）。");
  L.push("11. 費用のセルを AI の見本で伏せるのは、取り込みが費用の列と見分けた列（括弧の外の見出しが「費用」「金額」「工事費」「修繕費」「予定価格」「支払額」「契約額」「請負額」「見積額」「概算額」で始まるか終わるもの。例「概算費用」「契約金額」）だけです。ほかの言い方の見出し（「見込額」「予算額」「単価」など）の列の値は、見本にそのまま出ることがあります。");
  L.push("12. `intake_add_files` のフォルダが、利用者がチャットで言ったものかを、橋渡しは確かめられません。AI が別のフォルダ（状態フォルダとリポジトリの外）を指せば、その直下の資料が作業画面に入り、要約の見本として AI に渡ります。作業画面の作業の一覧に、AI が資料を入れたことが出ます。");
  L.push("13. 公開台帳に載せた束は、今は画面から取り下げられない（印の形は決めた）。失効記録（`ledger/ledger/bundles/<鍵ID>/retired.json`、その鍵自身の署名）は、CLI の `ledger submit` か受け口に送れば受けますが、作る画面のボタンはまだありません。取り下げても、載った束のファイルは消えず、受け取った人の複製も残ります。");
  L.push("");
  return L.join("\n");
}
