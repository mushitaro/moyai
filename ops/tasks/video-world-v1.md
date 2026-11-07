---
id: video-world-v1
role: factory
agent: factory
environment: env-factory
budgetUsd: 30
timeoutMin: 240
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# 動画の撮り直し用の、1 つの架空の世界（ほたる川クリーンセンター）

動画の撮り直し（11-07 の夜〜11-08 の午前）で、デモの世界を 1 つにそろえる（運営者が動画の制作班の推す案に「推す案で進めてみてください。」、11-07 13:30）。今の fictional-1（試験が頼っている）は変えない。動画のための世界を別に作る。

世界（どれも【架空】）：
- 主役の施設：ほたる川クリーンセンター（ストーカ炉、2 炉）
- 整備の担当者：佐藤（Claude のチャットで答える人）。市の担当者：山田（環境課。自分で確定して承認する人）。メールの宛先は example.jp の架空のもの（例 yamada@example.jp）
- 年度：令和 6〜8 年度
- 機器：火格子（ストーカ）・押込送風機・誘引送風機・ボイラ・バグフィルタ・蒸気タービン（ほかは今の fictional-1 と同じ程度に）
- 客先（ほかの施設）：しらかば野・さくら坂
- 今の写しに残っている「みどり台」「東山」「kacho@example.jp」は、この世界には出さない。

先に読む：`AGENTS.md`、`samples/factory/README.md`（作り手。運営者の `sample-maker.md` の決まり：現場の形の資料で、構造化した試験用の資料にしない。作り手は読み手のコードを見ない）、`samples/factory/world/`、`packs/waste-incineration/demo/README.md`、`tests/demo/walkthrough.spec.ts`（デモの通し）、`video/`（撮る側。`video/STORY.md`）、`docs/plan.md` §2.19（版の履歴と署名）、`src/app/components/MoyaiTop.tsx`（来歴のツリー）。

作るもの：
1. **資料**：作り手で、この世界の 3 つの資料（施設台帳・星取表・作業日報。今のデモと同じ種類と形）を作り、`video/world/hotarugawa/` に置く（`packs/` には置かない。デモの Skillパックの資料はこの仕事では変えない）。
2. **版の履歴（来歴のツリー C14）**：撮影の前に、空の保管先にこの世界の版の履歴を作る台本（`video/world/make-history.mjs`。MOYAI の今の関数を使い、画面の経路は使わない）。
   - 令和 6 年度版・令和 7 年度版：署名と承認済み。
   - 令和 8 年度版：承認待ち。
   - しらかば野へ Skill（3 段目のルール）が配られる枝を 1 本。
   - 保管先の場所は引数で受け、運営者の本物の保管先には書かない（既定で断る）。
   - 署名の鍵はこの台本が作った架空の鍵だけを使う。
3. **デモの通し（caps）**：`tests/demo/walkthrough.spec.ts` と同じ道を、この世界で通す台本か設定（`video/` の下に。今の walkthrough は変えない）。
4. **試験**：作った資料が作り手の検算を通る、台本が空の保管先に上の 3 つの版と 1 本の枝を作る、本物の保管先を指すと断る。

触らないもの：`src/`（製品のコード）、`packs/`、`samples/facts/`・`samples/heldout/`（測りの正解）、fictional-1 と今のデモ、署名される字。

済んだと言える条件：verify が通る。report.md に、作ったファイル、台本の使い方（撮る前に Video がする手順）、試験の数、未確認のこと（画面での見え方）を書く。
