---
id: foundation-v0
role: dev
runner: local-subagent
note: Windows の実機で確かめるので、この PC の Claude Code のサブエージェントが作る（Managed Agents ではない）
---
# TypeScript の土台 v0：依存・型・橋渡し・中継・最小の画面

`AGENTS.md` と `docs/plan.md`（§2.12〜§2.16、§5.1、§6.3 の 11-03）を読んでから作る。日誌（docs/progress/）と packs/ には触れない（メインのセッションが書く）。

## 1. 依存と道具

- npm 11 で入れる（`npx -y npm@11.21.1 install --save-exact ...`）。版は §2.16 のとおり：react・react-dom 19.2.9、vite 8.3.4、@vitejs/plugin-react 6.1.2、@mantine/core・@mantine/hooks・@mantine/notifications 9.7.3、ag-grid-community・ag-grid-react 36.2.0、@modelcontextprotocol/sdk 1.32.1、ws 8.22.0。開発用に typescript 7.0.2、vitest 4.1.12。型の定義（@types/node・@types/ws・@types/react など）は、2026-10-20 より前に出た版を `npm view <名前> time --json` で選んで固定する。
- TypeScript 7 の `tsc --noEmit` で型を検査する。合わなければ 6 系に下げ、理由を報告に書く。変換は Vite（画面）と、Vite の SSR のビルド（`dist/cli.js`）。
- `npm run build`・`npm run typecheck`・`npm test`（node:test の今の試験と vitest の両方が走る。0 件なら失敗）を用意する。CI（`.github/workflows/ci.yml`）にビルドと型の検査と vitest を足す。Action は今の SHA の固定のまま。
- THIRD_PARTY_NOTICES.md の npm の表に、足した依存（名前・版・ライセンス）を足す。check-deps が緑のまま（ag-grid-enterprise を入れない）。

## 2. `src/shared/`（1 か所の型）

- `tool-names.json`：§2.13 の 12 のツール名（今の `tests/scripts/reserved-names.test.mjs` がこれを読み、使わない名前と一致 0・12 以下を確かめる。飛ばしていた試験が走るようになる）。
- `tools.ts`：12 のツールの説明と、入力と出力の zod の型。規則の形（欄 × 比べ方 × 値の組〔20 個まで〕と置く値）も 1 か所に。説明の文には、AI の使い方の要点（§2.13：行を写さず規則を書く、人だけの操作はツールに無い、など）を短く入れる（Claude Desktop では instructions が効かないため）。
- `fields.ts`：欄の名前（計画・作業・作業明細・資産の節など §2.4 の芯のデータの形）を 1 か所に。
- `events.ts`・`errors.ts`：タブと橋渡しの間のイベントと誤りの型の一覧。送り手と受け手の両方を登録する形にし、`contract` の試験（どの型にも送り手と受け手がある）を置く。
- `routes.ts`：HTTP の経路の許可の一覧（人だけの経路には「秘密と 1 回きりの印が要る」の印）。

## 3. 橋渡し（`moyai start`）と中継（`moyai mcp`）

- `src/bridge/`：127.0.0.1 だけで待ち受ける（既定 43110、使われていれば起動を止め、理由と `--port` を出す）。Host・Origin・Sec-Fetch-Site を確かめ、DNS リバインディングを断る。経路は許可の一覧だけ。静的ファイル（ビルドした画面）を返す。
- WebSocket：Origin の一致が必須。最初の握手でページが作ったタブの秘密を登録する（秘密は HTML にもどの GET にも入れない）。タブは 1 つだけ受け、2 つ目は断って理由を出す。15 秒ごとの生存確認、45 秒で切れたと見なす。
- 1 回きりの印：橋渡しが作り、WebSocket で渡し、操作と中身のハッシュに結ぶ。120 秒で切れ、1 回で消える。人だけの経路は秘密と印の両方を求める。v0 では人だけの経路は「確定の試しの経路」1 つでよい（中身は何もしないが、守りの形を試験できるもの）。
- `src/cli/`：`moyai start`・`moyai mcp`。中継は標準入出力の MCP（@modelcontextprotocol/sdk）で、橋渡しが起きていなければ「先に moyai start を」と返す。中継と橋渡しの間は状態フォルダの鍵ファイルで確かめる（Windows は `%LOCALAPPDATA%\MOYAI\state\`。試験では一時のフォルダに向ける環境変数を使い、本物の状態フォルダに触れない）。標準出力は MCP だけに使い、記録は標準エラーへ。v0 のツールは、名前と型だけを持ち、呼ばれたら「未実装」と型どおりに返す。
- 試験（vitest、一時のフォルダ、ポートは空きを使う）：素の HTTP（Origin なし）・Origin の無い POST・偽った Origin で秘密なし・使い終えた印・切れた印 → すべて拒まれる。2 つ目のタブは断られる。Host の違う要求は断られる。

## 4. 最小の画面

- React＋Mantine。画面の言葉は `src/app/text/` の 1 か所。色は CSS 変数の 1 か所（明るい既定と暗）。書体は BIZ UDPゴシック（Windows 以外は @fontsource/biz-udpgothic）。
- 右下にビルドの印（`MOYAI · build <日時> JST · <コミット>`。ビルドのときに埋める）、架空のデータを出すときの「【架空】」の印の部品。
- WebCrypto の Ed25519 の試験のページ：Node の crypto で作った署名を、ブラウザの WebCrypto で検証し、結果を画面に出す。この PC の Chrome（156）と Edge（156）で Playwright（`@playwright/test` 1.64.1、channel `chrome` と `msedge`。ブラウザを新しく落とさない）を使って開き、結果とスクリーンショットを `docs/progress/shots/2026-11-03/` に残す（ここだけは docs/ に書いてよい）。

## 済んだと言える条件

- この PC で `npm run build`・`npm run typecheck`・`npm test`・`node scripts/check-publish.mjs`・`node scripts/check-deps.mjs` が通る。push して CI（ubuntu と windows-latest）が緑。
- `node dist/cli.js start` で画面が開き、ビルドの印が出る（スクリーンショット）。Ed25519 の試験のページの結果（Chrome と Edge）。
- 報告に、§5.3 の 5 つの分け方での結果、決めた値と理由、未確認のことを書く。
