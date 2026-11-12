# 2026-11-12 作業役：設定の見出しを分かる言葉に（mushitaro/moyai#83）

統括から頼まれた作業役。枝 `settings-words`。

## したこと
- **絵を先に**：Artifact「MOYAI Wire Frame」に、今の「設定」の絵を消さずに、右に「設定 ― 見出しの言葉（#83）」（`SettingsWords.dc.html`）を並べた。見出しの言葉だけを変えた絵。
- **コード**：`src/app/text/human.ts` の設定の見出しを、絵と同じ言葉にした（下の表。`docs/words.md` の「設定の見出し」にも書いた）。行は増やしていない。説明の文・注・ツールチップは足していない。
- 道の値（保存先・台帳の手元の複製・共有フォルダの場所）：1 行に収め、長ければ途中を省いて末尾 24 字（フォルダの名前）を残す。押すと全部を折り返して出す。字は要素の中に全部ある（試験と読み上げで道が欠けない）。「| 変更」と「既定・同期フォルダ」は縮めない。
- 試験：`tests/e2e/checkpoint.spec.ts` の設定の段に、見出しが新しい言葉であることと、見出し・小さな見出しに clone・ring・鍵 ID が無いことを足した（前はこの見出しを確かめる試験が無かった）。

| 前 | 後 |
|---|---|
| 保存先 | 計画と資料のフォルダ |
| 送信者 | 署名に入る名前 |
| 署名鍵（表：送信者・状態） | 署名の鍵（あなたと相手）（表：名前・照合） |
| 共有フォルダ（表：自分の鍵番号） | 他施設との共有フォルダ（表：あなたの鍵番号） |
| 公開台帳（clone・GitHub） | 類似施設を見る公開台帳（手元の複製・GitHub） |
| 明暗 | 画面の明るさ |
| 最新の確かめ | 新しい版を自動で入れる |
| 表示（階層・並び・最終年度） | 星取表の見せ方（階層の順・行の並び・最終年度） |
| Skillパック | 業種の Skillパック |
| AI への提供範囲 | Claude に見せるもの |
| Skill の採点 | Skill の採点の結果 |

前と後の写し：`docs/progress/shots/2026-11-12/settings-words/`（before・before-bottom は main、after・after-bottom はこの枝。どちらも Linux の Chrome、`checkpoint.spec` の設定の段）。

## 5 つの分け方
- 試験とビルドが通った：`npm run typecheck`・`npm test`（vitest 1,940 件が通り 9 件は走らず、node:test 198 件）・`npm run check-publish`（当たり 0）・`npm run build`。e2e（Linux の Chrome、HOME に Documents のある一時のフォルダ）：`checkpoint`・`chart`・`peers`・`ledger-intake`・`shots-export-share` の 13 件が通る。Edge は走らせていない（この入れ物に無い）。
- 画面で動いた：Linux の Chrome の写しで見た（上の写し）。長い道の途中が省かれ、「| 変更」が 1 行に残る。押して全部を出すのは写しでは見ていない。
- Claude Code で端から端まで通った：未確認。
- Windows の実機で動いた：未確認。
- Excel で開いて見やすかった：未確認（関わる変更なし）。
- 見出しの言葉が説明なしで分かるか：未確認（統括と運営者の目で確かめる。#83 の終わったと言える条件）。

## 気づいたこと
- main の `checkpoint.spec` は、HOME の下に Documents の無い Linux では設定の段で落ちる（`documents-path` が出ない）。chart.spec と同じく、HOME に Documents があれば通る。CI（#74 の e2e）では未確認。

## 使用量
- 残りは測っていない。子のエージェントは出していない。API のキーを使う仕事はしていない。

## 次の一手
1. 統括と運営者が、見出しの言葉を絵（Wire Frame の右の板）と写しで確かめる。直す言葉があれば絵から直す。
2. 共有フォルダの表の 1 列目は、今は内部の ID（ringId）を出している。見出しではなく値の問題なので、この PR では触っていない（別の Issue にするかは統括）。
