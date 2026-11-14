# 2026-11-14 日誌：windows の e2e の赤（walkthrough「署名して承認を頼む」・work-resume）（作業役）

統括から頼まれた分。main の 22f7d04 と PR #119 で `e2e (windows-latest)` が落ちた。

- 落ちたのは `tests/demo/walkthrough.spec.ts:314`：「署名して」を押しても `confirm-done` が出ない。
- 22f7d04 では `tests/e2e/work-resume.spec.ts:102` も落ちた：作業中の写しに 4 つ目の資料が入らない。
- 枝は `claude/e2e-walkthrough-win`。

## #115 が原因か

違う。同じ落ち方（walkthrough の 314 行・`confirm-done` が出ない）が、#115 が入る前にも windows で起きていた。

- 2026-11-12 18:44 の 46e0433（run 43281288059）。
- work-resume の windows の赤も、#115 の前の 6453290（run 43285398638）にある。
- `key={left}` は、hash の移動の行き先が版の画面の外のときだけ変わる。walkthrough の 4 の段までの移動は、版の画面の中のシートだけ。

## 根の原因

橋渡しの `putSource`（`src/bridge/sources.ts`）。資料を同時に置くと落ちる。

- 資料は、作業中の写し（`/api/work` の資料）と、確定の前の置き（`plan_source_put`）の 2 つの道から置かれる。同じ資料を同時に置くことがある。
- 一時のファイルの名前が `<SHA-256>.tmp-<pid>` で、呼び出しごとに同じだった。
  - 片方が置き換えると、一時のファイルが消える。もう片方の置き換えは `ENOENT` で落ちる。
  - Windows では、ほかが開いているファイルへの書き込み・置き換えも断られる。
- 手元で同じ資料を 8 つ同時に置くと、7 つが `ENOENT` で落ちた。
- 確定の前の置きが落ちると、署名のダイアログは `confirm-done` でなく理由を出す（walkthrough の赤）。
- 作業中の写しの置きが落ちると、その資料が写しに入らない（work-resume の赤）。

## したこと

- `putSource`：一時の名前を呼び出しごとに別にした（`randomUUID`）。
- 置き換えが断られても、同じ中身がもう置いてあれば成功にする。置き場所は SHA-256 で決まるので、同じ名前なら同じ中身。それ以外は今までどおり落とす。
- 試験：`tests/unit/work-store.test.ts` に、同じ資料を 8 つ同時に置いて、どれも落ちず、一時のファイルが残らない試験を足した。
  - 直す前のコードでは落ち、直したあとは通る。
  - 確かめは弱めていない。

## 5 つの分け方

- 試験とビルドが通った：手元（Linux）で `npm test`（vitest 1,988 通過・飛ばし 9）・型の検査・walkthrough・work-resume.spec。windows は CI で見る。
- 画面で動いた：Linux の Chrome（headless）で walkthrough と work-resume。
- Claude Code で端から端まで通った：関わる変更なし。
- Windows の実機で動いた：未確認（windows の CI で見る）。
- Excel で開いて見やすかった：関わる変更なし。

## 使用量

- 子のエージェントは出していない。残りの数は測っていない。

## 次の一手

- PR の windows の e2e を見る。
- 間欠の赤なので、1 回の緑では確かとは言えない。main で windows の walkthrough と work-resume が続けて緑かを見る。
