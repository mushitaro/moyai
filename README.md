# MOYAI

保全の履歴を、国の手引きが示す設備・機器のリスト × 作業の属性にそろえ、星取表で似た施設と比べるアプリ。ごみ焼却プラントから作り、ほかの設備へはパック（データ）を足して広げます。

Claude ハッカソン「Built with Claude: Japan 2026」（2026-11-02〜11-10）の会期中に、このリポジトリでゼロから作ります。作るのは人 1 人（このリポジトリの持ち主）と Claude Code です。持ち主の前の製品 [MX Stage](https://github.com/mxstage/mxstage) と [HOSHUTARO](https://github.com/woodygaragelab/hoshutaro) の考え方は受け継ぎますが、コードは使いません。

知恵は出し合う。秘密は出さない。

## 確かめ方

- `npm ci` → `npm run build` → `node dist/cli.js verify demo-ring`：架空の 7 拠点のデモの輪（`demo-ring/`）を、受け手と同じ関数で確かめます。全員 ✓、わざと入れた ✗ の束は理由つきで ✗ です。秘密鍵はリポジトリにありません（`demo-ring/README.md`）。
- `npm run acceptance`：試験を走らせ、計画の受け入れの表（`docs/plan.md` §5.1）を `docs/acceptance.md` に作ります。結果は「通った／落ちた／試験が無い／測っていない」の 4 つで、試験の無いものは「試験が無い」と書きます。

ライセンス：Apache-2.0
