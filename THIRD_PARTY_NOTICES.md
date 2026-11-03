# 第三者のもの（依存・書体・公的データ）

MOYAI のコードは、このリポジトリで会期中に新しく書いたものです。次の第三者のものを、版を固定して使います。第三者のソースを `src/` に写すことはしません。

## npm の依存（package.json と package-lock.json で版を固定）

| 名前 | 版 | ライセンス | 使い道 |
|---|---|---|---|
| zod | 4.6.7 | MIT | 型の検査と、構造化出力の型 |
| @anthropic-ai/sdk（開発用） | 0.135.0 | MIT | 監査のエージェント（`scripts/audit/`）。F3 の採点でも使う予定 |
| react・react-dom | 19.2.9 | MIT | 画面 |
| @mantine/core・@mantine/hooks・@mantine/notifications | 9.7.3 | MIT | 画面の部品 |
| ag-grid-community・ag-grid-react | 36.2.0 | MIT | 表（Community だけ。Enterprise は入れない） |
| @modelcontextprotocol/sdk | 1.32.1 | MIT | 中継（`moyai mcp`）の MCP |
| ws | 8.22.0 | MIT | 橋渡しとタブの WebSocket |
| @fontsource/biz-udpgothic | 5.3.0 | OFL-1.1 | Windows 以外の BIZ UDPゴシック |
| vite（開発用） | 8.3.4 | MIT | 画面のビルドと、`dist/cli.js` の SSR のビルド |
| @vitejs/plugin-react（開発用） | 6.1.2 | MIT | 画面のビルド |
| typescript（開発用） | 7.0.2 | Apache-2.0 | 型の検査（`tsc --noEmit`） |
| vitest（開発用） | 4.1.12 | MIT | 試験 |
| @playwright/test（開発用） | 1.64.1 | Apache-2.0 | 画面の試験（この PC の Chrome と Edge を channel で使う。ブラウザは落とさない） |
| @types/node（開発用） | 22.20.5 | MIT | 型の定義（2026-10-20 より前の公開） |
| @types/ws（開発用） | 8.18.2 | MIT | 型の定義（同上） |
| @types/react（開発用） | 19.2.18 | MIT | 型の定義（同上） |
| @types/react-dom（開発用） | 19.2.7 | MIT | 型の定義（同上） |
| exceljs | 4.4.0 | MIT | 取り込みの Excel の読み手（`src/import/xlsx.ts`。全部を読む読み手だけを使い、版を固定して中の 3 か所に直しを当てる：`src/import/exceljs-setup.ts`）。書き出しにも使う予定 |
| ssf | 0.11.2 | Apache-2.0 | 表示形式から表示の文字を作る（`src/import/numfmt.ts`。和暦・曜日・[DBNum] などは自分で足した） |
| csv-parse | 7.0.3 | MIT | 取り込みの CSV・TSV の読み手（`src/import/csv.ts`。文字コードと区切りの判定は自分で書いた） |

これから足す依存（docs/plan.md §2.16）は、入れたときにこの表に足します。依存の依存は package-lock.json にあります。

## Python の依存（サンプルの工場と、全国の表から数を取り出す道具 scripts/national/。samples/factory/requirements.txt で版を固定）

| 名前 | 版 | ライセンス |
|---|---|---|
| openpyxl | 3.1.5 | MIT |
| Pillow | 13.0.0 | MIT-CMU（HPND） |
| pypdfium2 | 5.14.0 | BSD-3-Clause と Apache-2.0（同梱の PDFium などの依存のライセンスを含む） |

## 道具（配りものには入れない）

- LibreOffice（MPL-2.0）：サンプルの工場で、帳票の PDF の書き出しと数式の再計算に使う。

## 公的なデータと資料（出典。事実として使い、表の文は写さない）

| 資料 | 発行 | 使い方 |
|---|---|---|
| 廃棄物処理施設長寿命化総合計画作成の手引き（ごみ焼却施設編）令和 3 年 3 月改訂、表Ⅱ-4 | 環境省 | 設備と機器の名前を、共通の設備項目の 1 段目にした（`packs/waste-incineration/common.json`） |
| 一般廃棄物処理実態調査結果（令和 6 年度）施設の表（焼却施設） | 環境省 | 施設の数と、見え方の軸ごとの数だけを取り出して使う（加工した）。施設名は持たない。元の表はコミットしない |
| 廃棄物の処理及び清掃に関する法律施行規則（e-Gov 法令検索） | e-Gov | 第五条（精密機能検査）を検査の出典にする。法令の本文は著作権の対象外 |
| 廃棄物の処理及び清掃に関する法律の運用に伴う留意事項について（昭和 46 年 環整第 45 号） | 厚生省（環境省の掲載） | 第三の 11 を検査の出典にする |
| 同じ手引き（ごみ焼却施設編）の本文（印刷頁 14）・表Ⅱ-4・表Ⅱ-6・表 2-19 | 環境省 | 機器の種類の名前の根拠にした（`packs/_kinds/kinds.json`）。名前の語だけを使う |
| 危険物の規制に関する政令・建築基準法・建築基準法施行令・労働安全衛生法施行令・一般高圧ガス保安規則・電気設備に関する技術基準を定める省令・大気汚染防止法施行令・廃棄物の処理及び清掃に関する法律施行令・廃棄物の処理及び清掃に関する法律施行規則（e-Gov 法令検索） | e-Gov | 機器の種類の名前の根拠にした（`packs/_kinds/kinds.json`）。法令の本文は著作権の対象外 |

各資料の URL・取得日・照らした頁と照らした者は、パックの `sources.json` にあります。機器の種類の根拠は `packs/_kinds/kinds.json` の `basis` にあります。
