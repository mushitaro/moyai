# MOYAI のしるし

5 列 × 4 行の星取の印で M を組む。左の柱と左の斜めは ○（計画）、右の柱と右の斜めは ●（実績）、谷の ◎ は計画と実績の結び目（もやい）。朱は結び目の輪の一点だけに置く。

## 色

| 地 | 印 | 結び目の輪 |
|---|---|---|
| 墨 `#0a0a0a` | `#e0e0e0` | 朱 `#bb4a34`（shu-500） |
| 和紙 `#fbfaf6` | `#171512` | 朱 `#a63e2a`（shu-600） |

朱が刷れない所（白黒の印刷、刻印、透かし）は `mark-mono-black.svg`・`mark-mono-white.svg`。

## どれを使うか

| 使う所 | ファイル |
|---|---|
| ブラウザのタブ | `favicon.svg`（暗・明は読み手の設定に従う）、`favicon.ico`（16・32・48） |
| ホーム画面（iOS） | `png/apple-touch-icon.png`（180） |
| PWA | `site.webmanifest`、`png/icon-192.png`・`png/icon-512.png`（any）、`png/icon-maskable-*.png`（maskable） |
| SNS の共有の絵（OGP） | `png/og-dark.png`・`png/og-light.png`（1200×630） |
| SNS の顔 | `png/avatar-400.png` |
| 文書・スライド・画面のヘッダ | `lockup-horizontal-*.svg`、縦に積むときは `lockup-vertical-*.svg` |
| しるしを M として読ませる字の組み | `wordmark-*.svg`、`png/wordmark-*.png`（高さ 240） |
| しるしだけ | `mark-dark.svg`（暗い地）・`mark-light.svg`（明るい地）、画像が要る所は `png/mark-*-1024.png` |

`-dark` は暗い地に置くもの、`-light` は明るい地に置くもの。

## 決まり

- 周りの空きは、少なくとも柱の印 1 つの径（しるしの高さのおよそ 1/4）。
- しるしの幅は 24px 以上。それより小さい所は `favicon.*`（○ と輪の線を太くした小さい寸法の形）を使う。
- 印の数と並び、○ と ● の左右、朱の位置を変えない。朱を塗りにしない、朱を二点にしない。
- 傾けない、伸ばさない、影・縁取り・グラデーションを付けない。
- 横組みの字の高さは印 3 行分（しるしの高さの 72%）で、しるしの上下の中央に置く。しるしと字の間はしるしの高さの半分。
- 字の組み（wordmark）は、しるしを M として「OYAI」の前に置く。しるしの高さは OYAI の大文字の高さの 1.06 倍（丸の並びが小さく見える分を補う）、しるしと O の間は Krona One の M と O の間と同じ。
- 組みの「MOYAI」は Krona One、字間 0.18em。組みの SVG は書体を中に持っている（OFL-1.1）。

## 作り直し

形と色を変えたら、`scripts/brand.mjs` を直して `node scripts/brand.mjs` で全部のファイルを書き出し直す。手で一部だけ直さない。PNG は入っている Edge で描くので、描き直すと画素が少し揺れることがある（形は同じ）。この README は生成しない。
