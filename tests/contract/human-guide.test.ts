// 人だけの操作を足したら、AI 向けの文（MCP の instructions と 1 段目の Skill）に、その道の案内があるか（運営者の指摘 2026-11-18）。
// 設定の「困りごと」（app_feedback_send、#140）を AI 向けの文に書いておらず、Chat の AI が GitHub に直接送ろうとした。
// 人だけの経路（src/shared/routes.ts の HUMAN_ACTIONS）は、どれも次のどれか 1 つに入れる。入っていない経路を足すと、この試験が落ちる：
//   GUIDE    ：利用者が Chat で頼みそうな操作。AI 向けの文の 1 行（Skill の箇条書き 1 つ・instructions の 1 文）に、
//              画面のどこで・人が何を押すか（AI はしない・道具が無い）が書いてある。行ごとに、決めた語が全部そろうかを見る。
//   NO_GUIDE ：案内の要らない経路（画面が自分で読む・ほかの操作の途中の段・Chat を通らない）。理由を書く。
//   PENDING  ：案内が要るのに、まだ書いていない経路（一時）。書いたら PENDING から GUIDE に移す（移さないと、この試験が落ちる）。
// Skill の文を変えるときは、docs/autonomy.md「Skill の文を変える PR」の採点の記録も要る。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HUMAN_ACTIONS, type HumanAction } from "../../src/shared/routes";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";

/** 1 行に、全部がそろう語（大文字と小文字は分けない） */
type Line = readonly RegExp[];

/** 案内のある経路：AI 向けの文のどれかの 1 行に、行ごとの語が全部ある（行が 2 つあれば、2 行とも要る） */
const GUIDE: Partial<Record<HumanAction, { what: string; lines: readonly Line[] }>> = {
  plan_commit: { what: "確定（署名して確定）", lines: [[/HOSHITORI/, /Confirm on the Decisions sheet/, /sign and confirm/]] },
  plan_sign: { what: "承認・差し戻しの署名", lines: [[/HOSHITORI/, /approve and sign/, /send back/]] },
  plan_version_read: { what: "次の版を開く", lines: [[/"\+ Next version"/, /MOYAI top screen/, /the AI cannot open it/]] },
  plan_file_read: { what: "確定した版の Excel を落とす", lines: [[/on Export a person downloads the Excel/]] },
  export_file_read: { what: "書き出した Excel を落とす", lines: [[/on Export a person downloads the Excel/]] },
  checkpoint_send: { what: "共有フォルダに出す", lines: [[/On Share/, /shared folder/, /only a person sends/]] },
  ledger_send: { what: "公開の台帳に出す", lines: [[/On Share/, /public ledger/, /only a person sends/]] },
  ledger_intake_send: { what: "公開の台帳に出す（MOYAI 経由）", lines: [[/On Share/, /public ledger/, /only a person sends/]] },
  connect_send: { what: "連携のつなぎ先に送る", lines: [[/Integration sheet/, /press Send/, /there is no tool for it/]] },
  photo_allow: { what: "写真を AI に渡す許し", lines: [[/allowed one by one on the intake screen/, /There are no tools to allow/]] },
  settings_save: {
    what: "設定（置き場所・送信者・連携のオン）",
    lines: [
      [/Settings:/, /storage location/, /sender/],
      [/turned Integration on in MOYAI's Settings/, /when it is off, do not offer them/],
    ],
  },
  ring_create: { what: "共有フォルダを作る", lines: [[/Settings:/, /shared folder/]] },
  person_key_create: { what: "署名の鍵を作る", lines: [[/signing key is created at the first confirmation/]] },
};

/** 案内の要らない経路と理由 */
const NO_GUIDE: Partial<Record<HumanAction, string>> = {
  commit_trial: "開発の道具（DevTools）だけが押す。利用者の画面に無い",
  plan_status: "確定のダイアログを開いたとき、画面が自分で読む",
  plans_list: "トップを開いたとき、画面が自分で読む",
  comments_list: "横の板を開いたとき、画面が自分で読む",
  plan_source_put: "「＋ 次の版」（plan_version_read）の途中の段。画面が資料を置く",
  plan_source_read: "「＋ 次の版」（plan_version_read）の途中の段。画面が資料を戻す",
  templates_read: "EXPORT を開いたとき、画面が自分で読む",
  template_file_read: "EXPORT の見本を描くとき、画面が自分で読む",
  settings_read: "設定を開いたとき、画面が自分で読む",
  checkpoint_preview: "SHARE の検問所を開いたとき、画面が自分で読む（出すのは checkpoint_send）",
  checkpoint_open_text: "検問所で人が中身をエディタで開く（出す前の人の確かめ。AI は代われない）",
  ring_verify: "SHARE を開いたとき、画面が共有フォルダを確かめる",
  ledger_preview: "SHARE の検問所を開いたとき、画面が自分で読む（出すのは ledger_send）",
  ledger_prs: "SHARE を開いたとき、画面が PR の行方を読む",
  github_connect_start: "公開の台帳に出す（ledger_send。SHARE の行）の途中の段。SHARE の画面が案内する",
  github_connect_state: "GitHub につなぐ途中の様子を、画面が自分で読む",
  github_disconnect: "公開の台帳に出す（ledger_send）の途中の段。SHARE の画面が案内する",
  peers_compare: "星取表で人が似た施設を開いたとき、画面が読む。AI の道は peer_reference（Skill の Similar facilities の行）",
  readings_read: "HOSHITORI を開いたとき、画面が承認済みの読み方を読む",
  readings_lineage: "ルールのシートで詳細を開いたとき、画面が読む",
  request_receive: "頼まれた人がメールのリンクを開き、開いた画面で押す。Chat を通らない",
  person_key_confirm: "相手の鍵番号を、人が声や別の道で照らして押す。照らすこと自体が人の確かめで、AI は代われない",
  ring_member_confirm: "相手の鍵番号を、人が声や別の道で照らして押す。照らすこと自体が人の確かめで、AI は代われない",
  ring_rules_accept: "共有フォルダの決まりが変わったときだけ、SHARE の画面が差を見せて聞く",
  ledger_rules_accept: "公開の台帳の決まりが変わったときだけ、SHARE の画面が差を見せて聞く",
  facility_key_rotate: "施設の鍵の取り替え。SHARE の画面が理由を見せて聞く",
};

/**
 * 案内が要るのに、まだ AI 向けの文に無い経路（一時）。書いたら、ここから GUIDE に移す。
 * - app_feedback_send（困りごと）：別の作業の PR が AI 向けの文に書いている（docs/progress/2026-11-18-acceptance.md）。その PR で外す
 * - ほか：mushitaro/moyai#146。Skill の文を変えるには採点の記録が要るので、まとめて書く
 */
const PENDING: Partial<Record<HumanAction, { what: string; lines: readonly Line[] }>> = {
  app_feedback_send: { what: "設定の「困りごと」から送る", lines: [[/Settings/, /(feedback|trouble|problem)/i, /Send/i]] },
  connect_add: { what: "設定の「連携」でつなぎ先を足す", lines: [[/Settings/, /Integration/, /\bAdd\b/]] },
  plan_revert: { what: "前の版に戻す", lines: [[/(revert|back to (a|the) previous version)/i, /(top screen|HOSHITORI)/]] },
  work_discard: { what: "施設の作業中を消す", lines: [[/(discard|delete) (the |a )?working (plan|copy)/i, /top screen/]] },
  request_renew: { what: "頼み直す", lines: [[/(ask again|re-?send the request|renew)/i, /HOSHITORI/]] },
  export_sign: { what: "保存先の様式で書き出して署名する", lines: [[/(template|form)/i, /on Export/i, /sign/]] },
  template_save: { what: "様式を保存先に置く", lines: [[/(template|form)/i, /on Export/i, /(save|drop)/i]] },
  reading_feedback_save: { what: "ルールを書き出す（保存）", lines: [[/Rules sheet/, /(write out|export) the rules/i]] },
  reading_feedback_send: { what: "書き出したルールを送る", lines: [[/Rules sheet/, /(write out|export) the rules/i, /Send/i]] },
  comment_add: { what: "コメントを足す", lines: [[/comment/i, /HOSHITORI/]] },
};

/** AI 向けの文の行：instructions の 1 文ずつと、1 段目の Skill の 1 行ずつ */
const aiLines = [...MCP_INSTRUCTIONS.split("\n"), ...readFileSync("skills/moyai/SKILL.md", "utf8").replace(/\r\n/g, "\n").split("\n")].filter((l) => l.trim() !== "");
const hasLine = (line: Line): boolean => aiLines.some((l) => line.every((re) => new RegExp(re.source, re.flags.includes("i") ? "i" : "").test(l)));

describe("人だけの操作の案内（AI 向けの文）", () => {
  it("人だけの経路は、どれも 案内あり・案内の要らない理由・一時の抜け のどれか 1 つに入っている", () => {
    const kinds = (a: HumanAction) => [a in GUIDE, a in NO_GUIDE, a in PENDING].filter(Boolean).length;
    const missing = HUMAN_ACTIONS.filter((a) => kinds(a) === 0);
    const twice = HUMAN_ACTIONS.filter((a) => kinds(a) > 1);
    expect(missing, `人だけの経路を足したら、AI 向けの文（src/shared/skill-moyai.ts → skills/moyai/SKILL.md）に、画面のどこで人が何を押すかを書き、ここ（GUIDE）に足す。案内の要らない経路なら理由を NO_GUIDE に書く`).toEqual([]);
    expect(twice).toEqual([]);
    // 一覧にある名前は、どれも今ある経路
    for (const a of [...Object.keys(GUIDE), ...Object.keys(NO_GUIDE), ...Object.keys(PENDING)]) expect(HUMAN_ACTIONS).toContain(a);
    for (const [a, why] of Object.entries(NO_GUIDE)) expect(why!.length, a).toBeGreaterThan(8);
  });

  it("案内のある経路は、AI 向けの文の 1 行に、画面の場所と人が押すことが書いてある", () => {
    const bad = Object.entries(GUIDE).flatMap(([a, g]) => g!.lines.filter((l) => !hasLine(l)).map((l) => `${a}（${g!.what}）: ${l.map(String).join(" ")}`));
    expect(bad, "AI 向けの文から案内が消えた（文を直したなら、ここの語も合わせる）").toEqual([]);
  });

  it("人だけの操作をする道具は無いと、AI 向けの文の決まりの 1 番に書いてある", () => {
    expect(hasLine([/Only a person confirms, sends, promotes and saves, on the screen/, /there are no tools for these/])).toBe(true);
  });

  it("一時の抜け（PENDING）は増やさない（今の 10 から減るだけ）。新しい経路は GUIDE か NO_GUIDE に入れる", () => {
    expect(Object.keys(PENDING).length, "新しい人だけの経路は、案内を書いて GUIDE に入れる（PENDING に足さない）").toBeLessThanOrEqual(10);
  });

  it("一時の抜け（PENDING）は、まだ案内が無いものだけ。書いたら GUIDE に移す", () => {
    const written = Object.entries(PENDING)
      .filter(([, g]) => g!.lines.every(hasLine))
      .map(([a]) => a);
    expect(written, "AI 向けの文に案内を書いた経路は、PENDING から GUIDE に移す（語が合わなければ、書いた文に合わせて直す）").toEqual([]);
  });
});
