---
id: receive-press-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 15
timeoutMin: 150
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# メールのリンクの受け取りは、人が押したときだけ（Security の点検 11-08 の中6）

## 今の動き
- `src/app/pages/Merge.tsx:230-236`：URL の hash に `t`（ワンタイムトークン）があると、作業画面を開いただけで `request_receive` を呼ぶ。
- `src/bridge/human.ts:750-755`：鍵がまだ無ければ `createOwnKey` で鍵を作り、その PC の鍵で受け取りに署名する。

## 何が起きるか
- 静的ファイルは、ほかのサイトからの移動も受ける。新しいタブは前のタブを引き継ぐ。
- そのため、リンクを知る者（メールを読める人、悪いページ）が `window.open` するだけで、その PC の鍵で受け取りの署名が置かれる。鍵が無ければ、鍵も勝手に作られる。
- 受け取れるのは最初の 1 つだけなので、本当の承認者が締め出される（takenByOther）。
- `Merge.tsx:221`：`h=` が空だと `startsWith("")` が真になり、ハッシュの照らし合わせが効かない。

## 直すこと
1. **押したときだけ受け取る**：リンクで開いたときは、版を見るだけにする。
   - 画面に「受け取る」を 1 つ置く。置き場所は、承認を頼まれた版の帯（今の「承認して署名する」「理由を添えて差し戻す」と同じ所）の前の段階。
   - 押したときだけ `request_receive` を呼ぶ。
   - 字は `docs/words.md` の言葉を使い、新しい語を作らない。
   - 動きは `docs/screens.md` の承認の節に 3 行で書き足す（Wire があとで見直す）。
2. **鍵を自動で作らない**：`request_receive` で `personKeyMissing` のときは、作らずに断る。画面は「設定で送信者の名前を入れてから」と、今の鍵の無いときの知らせを使う。
3. **頼んだ人の鍵では受け取らない**：受け取りの署名の鍵が、頼みの署名の鍵と同じなら断る（理由は自分の頼みは受け取れない）。
4. **h が空なら断る**：`open.get("h")` が無いか 16 字に満たなければ、`fail("hash")`。

## 試験
- vitest（human.ts）：
  - 鍵が無いと受け取らず、鍵も作らない。
  - 頼んだ人の鍵では受け取らない。
- e2e（`tests/e2e/` の、承認を頼むメールのリンクの試験を直す）：
  - リンクを開いただけでは受け取りの署名が置かれない。
  - 「受け取る」を押すと置かれ、承認と差し戻しへ進める。
  - `h=` が空のリンクは開けない。
- 関わるデモの通しも直す。

## 触らないもの
`src/import/`、署名される字の形（受け取りの署名の本文の形は変えない）、`packs/`。

## 済んだと言える条件
verify が通る。report.md に、直したもの・画面の字・試験の数・未確認のことを書く。
