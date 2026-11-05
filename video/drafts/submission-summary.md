<!-- 下書き（Video）。提出の要約（日英）。○ は提出の前にリポジトリから数える。施設 C の文は、11-06 18:00 の結果で 2 つのどちらかにする -->

## 日本語

**MOYAI ― 知恵は出し合う。秘密は出さない。**

全国 844 のごみ焼却施設は、それぞれ自分の様式で整備の履歴を持っています。持ち主の市町村、メーカー系列の保全子会社（随意契約で整備する）、O&M 事業者（入札で運転する）は、似たプラントの履歴と比べたくても、履歴は系列と施設の中に閉じていて比べられません。

MOYAI は、施設の資料（星取表・作業日報・発注台帳・報告書の PDF・写真）を利用者の PC で読み、国の手引きの機器リスト × 作業の属性にそろえた星取表にします。分からない所だけ Claude が選択肢つきで聞き、決めるのは人の署名です。外へ出すのは周期・工数・日数だけで、金額も施設の名前も出しません。5 施設に満たない比べは出さず、公開の台帳の検証は誰でも回せます。

デモでは、形の違う 3 つの施設（1 つは星取表が無く、作業日報と発注台帳だけ）の資料が、同じ星取表に整い、同じ帯の中に並びます。
（緑のとき）…同じ星取表に整い、同じ帯の中に並びます。
（届かないとき）…2 つは同じ星取表に整い、星取表の無い 1 つは詰まりました。その値も、測ったまま出しています。

作り手は、整備の履歴を分かち合う仕組みに 5 回挑んで越えられなかった保全の技術者です。6 度目の今回は、会期中に Claude Code でゼロから作りました。前の製品 MX Stage と HOSHUTARO の考え方を受け継ぎ、コードは使っていません。見たことのない様式の試験は、詰まった結果も含めて測った値のまま公開しています。

## English

**MOYAI — Share the know-how. Keep the secrets.**

Japan has 844 municipal waste incineration plants, and each keeps its maintenance history in its own format. The municipalities that own them, the makers' maintenance subsidiaries (hired without tender), and the O&M operators (hired by tender) all want to compare against similar plants, but that history stays locked inside each maker group and each plant.

MOYAI reads a plant's documents (maintenance charts, daily work reports, purchase ledgers, PDF reports, photos) on the user's own PC and lines them up on the national equipment list × work type. Claude asks only about what it cannot settle, with choices, and a person decides by signature. Only cycles, crew-days and days leave the PC: no amounts, no plant names. Comparisons over fewer than five plants are never shown, and anyone can run the public ledger's checks.

In the demo, three plants with different documents (one has no maintenance chart, only daily reports and a purchase ledger) end up on the same chart and inside the same band.
(If green) …end up on the same chart and inside the same band.
(If not) …two end up on the same chart; the one without a chart got stuck, and we show that result as measured.

The maker is a maintenance engineer who tried five times to build a way to share maintenance history and could not get past the walls. This sixth attempt was built from scratch during the hackathon with Claude Code. It carries over ideas from the earlier products MX Stage and HOSHUTARO, but none of their code. Tests on formats the reader had never seen are published as measured, including the ones that got stuck.
