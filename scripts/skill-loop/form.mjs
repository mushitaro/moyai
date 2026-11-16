// 読み方のフィードバックの Issue の型（.github/ISSUE_TEMPLATE/reading-feedback.yml）の見出しと選択肢。
// 毎日の回し（feedback.mjs）が本文を読むときと、公開の台帳の受け口の POST /feedback（services/ledger-intake）が本文を作るときに、同じものを使う。
// 型の yml と同じかは試験（tests/scripts/skill-loop-feedback.test.mjs）が確かめる。node: のものを使わない（Workers でも動く）。

/** Issue の型の「業種」の選択肢 → パックの id */
export const PACK_OF = { "ごみ焼却（waste-incineration）": "waste-incineration", "し尿処理（night-soil）": "night-soil" };
/** 見出し（型の label） */
export const HEAD = { pack: "業種（Skillパック）", source: "資料の種類", what: "どう読まれて、どう読まれるべきだったか", rule: "会話で作ったルール（あれば）", check: "確かめ" };
/** 確かめの印の文（型の checkboxes の label） */
export const CHECK_LABEL = "資料の中身（行の値・金額・固有名詞）を書いていない";
