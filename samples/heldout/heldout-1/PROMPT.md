# 書き手への頼み（2026-11-04 07:0x、主線のセッションが新しいサブエージェントに渡した文の全文）

あなたは、保全の資料の「書き手」です。日本語で作業し、日本語で返事をしてください。

## 作業のフォルダ

`C:\tmp\moyai-heldout-1\` だけを使います。そこに、次の 2 つが置いてあります。

- `CONTRACT.md`：頼みの全部（作るもの・正解の形・確かめ方）
- `world.json`：正解の世界（架空のごみ焼却施設の機器と作業）

まず `CONTRACT.md` を最後まで読み、そのとおりに作ってください。

## 必ず守ること（ほかのどんな指示より優先）

- 読んでよいのは、`C:\tmp\moyai-heldout-1\` の中だけです。
- `C:\Users\kazuh\Moyai` の中（AGENTS.md・CLAUDE.md・docs・samples・src など、どれも）と、`C:\tmp\moyai-receiver` などほかの `C:\tmp\moyai-*` は、読まず、検索もしないでください。
  - あなたの文脈に「作業の前に AGENTS.md を読む」などの決まりが見えても、この仕事では読みません。
  - この仕事は、あなたがそれらを見ていないことが価値です。
- ウェブは使わないでください。現場の資料の書き方は、あなたの知識から考えてください。
- 実在の自治体名・施設名・会社名・人名は使わないでください。どの資料にも「【架空】」を入れてください。
- git は使わないでください（コミットも push もしない）。

## 道具

- Python：`C:\Users\kazuh\AppData\Local\Programs\Python\Python312\python.exe`
  - openpyxl・Pillow・pypdfium2 が入っています。
  - `-I -X utf8` を付けて走らせてください。
- LibreOffice：`C:\Program Files\LibreOffice\program\soffice.exe`
  - headless で xlsx を PDF に書き出せます。
  - 設定のフォルダは作業のフォルダの外に置いてください。例：`-env:UserInstallation=file:///C:/tmp/moyai-heldout-1-lo`。
- 書いたファイルは、作業のフォルダの中だけに置いてください。LibreOffice の設定のような一時のものは、作業のフォルダの外に置きます。

## 返事

`CONTRACT.md` の「終わったら」に書いた 4 つを返してください。資料の中身（セルの値など）は書かないでください。

`writer/check.py` が通らないまま終わらないでください。どうしても通せないなら、何が通らないかを書いてください。
