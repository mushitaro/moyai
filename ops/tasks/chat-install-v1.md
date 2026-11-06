---
id: chat-install-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 20
timeoutMin: 150
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# 古い版の橋渡しを中継が自分で替える。Claude が利用者に端末の操作を頼まない

困りごと（運営者、11-07「こういうのを全部自動でやってくれないと」）：
- 前の版の `moyai start` が 43110 で動いたままだと、新しい版の中継は橋渡しを起こせない。Claude は利用者に「Ctrl+C で止めて」「start-moyai.cmd をダブルクリックして」と頼んだ。
- Claude Desktop のチャットは「setup は端末で『はい』と答える仕組みなので、私は代わりにできません。端末で node dist/cli.js setup を」と頼んだ。`setup --yes` があるのに使わなかった。

先に読む：`AGENTS.md`、`src/cli/relay.ts`（橋渡しを起こす所、`bridge.starting` の鍵）、`src/cli/main.ts`（`launchBridge`・`start`・`mcp`）、`src/cli/uninstall.ts`（鍵ファイルの居場所に止める合図を送る `relayStop` の道）、`src/bridge/server.ts`（止める合図と、版を返す所）、`src/cli/setup.ts`、`src/shared/skill-moyai.ts`（`skills/moyai/SKILL.md` はここから作る）、`tests/node/` の relay の試験。

1. **古い版の橋渡しを替える**：中継が橋渡しにつないだとき、橋渡しの版（ビルドの commit）が中継の版と違えば、鍵ファイルの鍵を添えて止める合図を送り、鍵ファイルが消えるのを待って（上限を置く）、新しい版の橋渡しを起こす。結果に workScreenUrl を添えるのは今どおり。作業画面のタブは開き直しが要るので、結果の字で「作業画面を読み込み直す」を Claude に知らせる（Claude がシェルで開ければ開く）。
   - 鍵ファイルが無い・鍵が合わない・止まらない（ほかの道具が 43110 を使っている）ときは、止めずに今の誤りを返す。字は「43110 をほかの道具が使っています」の形にし、Ctrl+C や端末を利用者に頼む字にしない。
   - 版の比べは、両方が分かるときだけ。分からなければ替えない。
2. **Claude に渡す字**（`skill-moyai.ts` と、そこから作る `skills/moyai/SKILL.md`。MCP の instructions は 4,096 字の上限に近いので、足すなら 1 文まで）：
   - 利用者に、端末を開く・コマンドを打つ・Ctrl+C・ダブルクリック・.cmd や .bat を作って押させる、を頼まない。古い橋渡しは中継が替える。
   - setup は、何をどこに書くかを利用者にチャットで見せ、「はい」をもらったら Claude が `--yes` を付けて走らせる。端末の「はい」は要らない。
   - Claude Desktop に入れたあと、Desktop の開き直しが 1 回だけ要る。そのことだけを 1 行で頼む（Claude Code なら要らない）。
3. **setup の字**：`src/cli/setup.ts` の注記と字から「端末で『はい』をもらう」を、Claude が読んで「端末が要る」と取らない形にする（端末でなく --yes も無いときの字は「利用者にチャットで見せ、良ければ --yes を付けて Claude が走らせる」）。拒む試験は残す。
4. **試験**：node:test で、古い版の橋渡しが動いているとき中継が止めて新しく起こす・鍵が合わないときは止めない・版が分からないときは替えない。字の試験で、Claude に渡す字に「Ctrl+C」「ダブルクリック」「端末で」の頼みが無い。

触らないもの：`src/import/`、`src/app/`、`packs/`、署名される字。

済んだと言える条件：verify が通る。report.md に、替える手順、足した字、試験の数、未確認のこと（Windows の実機で古い橋渡しを替えること）を書く。
