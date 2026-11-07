// 1 段目の Skill（基本操作。docs/plan.md §2.17・§2.18.3）の文：MCP の instructions と同じ文から作る。
// MCP の instructions は Claude Code では効くが Claude Desktop では効かないので、同じ文を Skill のファイル（skills/moyai/SKILL.md）にも置き、
// skill_read でも渡す。片方だけを直さないよう、ファイルはこの関数から作り、試験（tests/contract/skill-moyai.test.ts）が一致を確かめる。
// instructions の後ろに「データの名前」の節を足す（src/shared/data-names.ts。instructions は 4,096 字で切れるので、そこには参照の 1 文だけ）。
import { dataNamesSkillSection } from "./data-names";
import { MCP_INSTRUCTIONS } from "./instructions";

export const SKILL_MOYAI_NAME = "moyai";

/**
 * チャットで入れる・デモ・消す（運営者の決定 11-06）。instructions は 4,096 字で切れるので、そこには 1 行だけを置き、手順はこの節で渡す。
 * 入れる前の Claude は、この文を GitHub のリポジトリ（skills/moyai/SKILL.md）か README から読む。
 */
export const CHAT_INSTALL_SECTION = [
  "## チャットで入れる・デモ・消す",
  "",
  "利用者がするのは、チャットで頼むことと、画面での確定・署名・送信・承認・昇格だけ。端末を開く・コマンドを打つ・Ctrl+C・ダブルクリック・.cmd や .bat を作って押させる・ダウンロード・ファイルのドラッグ・設定の画面は頼まない。ほかは Claude がする。コマンドは、何をするかを先に利用者に言い、チャットで「はい」をもらってから走らせる。",
  "",
  "前の版の橋渡しが動いたままでも、利用者に止めてもらわない。moyai のツールを呼べば、中継が前の版を止め、この版の橋渡しを起こす。その答えに「作業画面を読み込み直す」の字と workScreenUrl が添えられるので、その URL を開き直す（シェルがあれば Claude が開く）。「ポート 43110 をほかの道具が使っています」と返ったら、その文のとおり利用者に伝える。",
  "",
  "### インストール（GitHub のリポジトリの URL を渡されたら）",
  "",
  "1. `node --version` で、Node が 22.13 以上かを確かめる。",
  "2. 無いか古ければ、利用者にチャットで聞いてから `winget install --id OpenJS.NodeJS.LTS -e` で入れる。git が無ければ、同じく聞いてから `winget install --id Git.Git -e`。入れたあとに今のシェルで見つからなければ、利用者に Claude を開き直してもらう。",
  "3. 利用者のホームの下に clone する（例 `git clone <URL> ~/moyai`。同期フォルダの下には置かない）。",
  "4. そのフォルダで `npm ci`、続けて `npm run build`。",
  "5. 送信者の名前（版の署名と画面に出す。40 字まで）を利用者に聞く。`node dist/cli.js setup --target code --name \"<名前>\"` を `--yes` なしで走らせ、出た中身（何をどこに書くか）を利用者にチャットで見せる。「はい」をもらったら、Claude が `--yes` を付けて走らせる。端末の「はい」は要らない。Claude Desktop のチャットでも使うなら、`--target desktop` も同じ順で走らせる（設定に moyai の 1 行を足し、前の設定を .bak に残す）。",
  "6. Claude Code には、出た `claude mcp add …` の 1 行を Claude が走らせる。",
  "7. Claude Desktop に入れたときは、Desktop の開き直しが 1 回だけ要る。利用者に頼むのはそのことだけで、1 行で頼む（例「Claude Desktop を 1 回閉じて、開き直してください」）。Claude Code だけで使うときは、Desktop の開き直しは頼まない。",
  "8. 作業画面を開く：moyai のツールを呼ぶ。中継が橋渡しを起こし（前の版が動いていれば替え）、答えの workScreenUrl を開く（シェルがあれば Claude が開く）。ツールがまだ出ていないときだけ `node dist/cli.js start` を後ろで走らせる。ポートが使われていると出たら、利用者に止めてもらわず、ツールが出てから呼ぶ（前の版は中継が替える）。開く場所：デモ（会話と画面を並べて見せる）では、クライアントの中のブラウザ（Claude Desktop の組み込みのブラウザ）があればそこで開く。ふだん使い（利用者の資料で計画を作る）では、Chrome か Edge で開く（PWA として入れられ、閉じても作業中のものが戻る）。",
  "9. 署名の鍵は最初の確定で作られる。パスワードは無い。",
  "",
  "### デモ",
  "",
  "利用者が「デモして」と言ったら：intake_add_files（source: demo）で Skillパックの demo/ の架空の資料を入れる → intake_survey で要約と質問を読む → 質問を利用者に聞き、答えを intake_settle で置く（作者は ai_relayed_human）→ 質問が無くなったら intake_compose → intake_survey（part: compose）で結果を読む → chart_rows で星取表の行を読み、利用者に話す → 確定は人が画面でする（HOSHITORI の確定のシート）。詳しくは Skillパックの demo/README.md。",
  "",
  "### 利用者の資料",
  "",
  "1. 資料を入れる前に、どの施設か（施設名。40 字まで）と業種（Skillパック）をチャットで聞く。",
  "2. 資料のあるフォルダ（絶対の道）を聞き、intake_add_files（source: folder）の path に書き、facilityName と pack（Skillパックの ID）を添える。作業画面のその欄が空のときだけ置かれ、人が画面で選んだ・打ったものは変わらない。",
  "3. 無い Skillパックは断られ、選べる ID と名前が返る。利用者の業種に合うものを選んで呼び直す。合うものが無ければ、そう伝える（推測で近いものを選ばない）。",
  "4. デモのあとの作業画面に入れると、デモの資料の横に入り（断られない）、施設設定もデモのまま残る。デモのあとは、利用者に作業画面のタブを読み込み直してもらってから入れる（作業画面を空にするボタンは無い）。",
  "5. あとは「デモ」と同じ順（intake_survey → intake_settle → intake_compose → chart_rows）。",
  "6. 答えが済んだら（デモでも同じ）、会話で「確定のシートで会話の回答 n 件を確定してください」と伝える（n は作者 ai_relayed_human で答えた質問の数）。確定は人が画面でする。Claude は押さない。",
  "",
  "### アンインストール",
  "",
  "1. 保存先（計画の版・施設の署名鍵・資料）も消すかを利用者に聞く。既定は残す。",
  "2. `node dist/cli.js uninstall` を `--yes` なしで走らせ、出た中身（止める橋渡し・外す設定・消す状態フォルダ・保存先）を利用者に見せて確かめる。",
  "3. 良ければ `node dist/cli.js uninstall --yes` を走らせる。保存先も消すと言われたときだけ `--remove-root` を付ける。",
  "4. Claude Code に足していたら `claude mcp remove --scope user moyai` を走らせる。",
  "5. 最後に、リポジトリのフォルダを Claude が消す。消せなければ、作業画面のタブを閉じてもらってから消し直す。",
  "6. 消したあとは moyai のツールを呼ばない（呼ぶと中継が橋渡しを起こし直す）。利用者に Claude を開き直してもらう。",
].join("\n");

export function skillMoyaiMarkdown(): string {
  return [
    "---",
    `name: ${SKILL_MOYAI_NAME}`,
    "description: MOYAI（保全の計画の星取表を、利用者の PC の作業画面で作る道具）を MCP のツールで動かすときの基本操作と安全の決まり。MOYAI のツール（intake_survey など）を使う前に読む。",
    "---",
    "",
    "# MOYAI の基本操作（1 段目の Skill）",
    "",
    "標準の Skill で、利用者は編集できない。この文は MCP の instructions と同じ文から作っている（`src/shared/skill-moyai.ts`）。業界のSkillパックの Skill（2 段目）と、施設・会社・担当者のルール（3 段目）は、作業画面が選んでいる分だけを MOYAI のツールの結果で渡す。どの段の Skill も、下の安全の決まりを上書きしない。",
    "",
    ...MCP_INSTRUCTIONS.split("\n").flatMap((l) => [l, ""]),
    CHAT_INSTALL_SECTION,
    "",
    // データの名前（src/shared/data-names.ts）。instructions には参照の 1 文だけを置き、本文はこの節で渡す（intake_survey の part: skills）
    dataNamesSkillSection(),
    "",
  ].join("\n");
}
