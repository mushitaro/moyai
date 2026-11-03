---
id: share-core-v0
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 25
timeoutMin: 120
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs"]
---
# 共有の芯 v0（`src/share/`）

`docs/plan.md` §2.8 を全部、§2.4、`src/shared/plan.ts`（計画の書類の型。変えない）、`packs/waste-incineration/national/`（table.json・columns.json）を読んでから作る。`src/share/` と `tests/unit/share/`（vitest）だけに足す。`src/shared/` の既存のファイルは変えない（足すのはよい）。画面と橋渡しには触れない。

1. `jcs.ts`：RFC 8785 の正規化（自作）。RFC の例で試験。
2. `sign.ts`：Node の crypto で Ed25519 の鍵の対・署名・検証（正規化した body の SHA-256 に署名）。合言葉から scrypt で作った鍵で秘密鍵を包む・開く。指紋 16 文字（4 文字 × 4 組）。
3. `bands.ts`：帯の境目はコードの定数（§2.8 の初めの値。境目は後で決めるので 1 か所に）。間隔は号炉・系統ごとに数えてから中央、N1 は間隔なし。工数・日数は 1 回ごとの中央の帯、まとめ工事・直せない書き方は出さない。ageAtWork は最初の作業のときの 5 年帯（UPGRADE は 10 年帯）。
4. `copyout.ts`：Plan → 塊の並び。許可リストの表に無い欄は構造上写らない。写すのは `commonItemAccepted` が true の当てはめだけ。費用・人・日付・備考は出さない。写さなかった行を理由ごとに数える。
5. `k.ts`：見え方＋推せる属性で、national/table.json から k を数える。段の順は 1 本だけ（後ろの軸から外す、推せる分類も同じ段で上へ、能力の帯を粗く、下の段へ。最初に k ≥ 5 の段で止め、段 3 でも足りなければ送らない）。下限は送る側 5・受ける側 3 をコードに固定。
6. `bundle.ts`：`{body, sig}` の形、型（列挙・上下限つきの整数・決まった形のハッシュ）、`seq`・`prev` の鎖、行き先（輪か台帳の ID）を body に入れる。
7. `recount.ts`：送る側と受ける側の同じ関数。引数で緩められない。ファイル全体の文字列で、形の外れ・自由記述（公開語彙）・金額・正確な日付・k・署名と鎖を数える。固有名詞は送る側だけの別の関数（網 2・網 3）。
8. `ring.ts`：輪のフォルダへの書き込み（一時の名前 → 更新時刻を月の 1 日 0 時に → rename）と読み取り（届きかけを ✗ と分ける）。試験は一時のフォルダで。
- 試験（vitest）：§5.1 の share.leak・share.k・share.stable・share.grain・share.tamper（body の外のキー、重複キー、members や circle に施設名、1 バイトの書き換え、抜き・入れ替え、他人のフォルダ、改行の変換、書きかけ、ほかの行き先）・share.rules の形。計画の書類は、試験の中で小さく作る（架空）。

済んだと言える条件：verify が通る。report.md に、作った関数、試験の数、帯と段の順で決めたこと、未確認のことを書く。
