---
name: moyai-pack-waste-incineration
description: The waste incineration Skill pack (MOYAI's tier-2 Skill; standard, users cannot edit it). Read it when reading waste incineration plants' maintenance plans (star charts) in MOYAI, mapping them to the common equipment items, reviewing them and comparing with similar plants.
---

# Waste incineration Skill pack (tier-2 Skill)

One of MOYAI's standard industry Skill packs. Its content is the data in `packs/waste-incineration/` (`common.json`, `checks.json`, `vocab.json`, `national/`, `sources.json`); this text explains how to use it. All numbers and names were taken from the Skill pack's data. It does not override the tier-1 basic operating rules (the MCP instructions). If there are facility, company or person rules (tier 3), they take effect first.

Reply to the user in the user's language (Japanese if they write in Japanese). The documents are usually in Japanese, so document words and item names below are kept in Japanese exactly as documents and `common.json` write them; English glosses are in parentheses.

## Verification level

- Common equipment items (`common.json`): checked against the original. Table II-4 "Example list of main equipment and devices" of the Ministry of the Environment's "Guide for Preparing Comprehensive Life-Extension Plans for Waste Treatment Facilities (Waste Incineration Edition)" (revised March 2021) was checked against the original.
- National table (`national/`): checked against the original. Only numbers were extracted from the incineration plant table of the General Waste Treatment Survey (FY2024) (no plant names are kept).
- Review (`checks.json`): checked against the original (those with sources).
- Public sharing vocabulary (how `vocab.json`'s universal and implies are applied): unchecked (decided by the authors; not yet confirmed by the operator).
- "Mapping auxiliary equipment", "Furnace types", "Common names" and "Reading work names" below: unchecked (the authors decided them from common industry names; they are not in Table II-4).

Always add the verification level when telling the user numbers or criteria.

## Hierarchy and common equipment items

- The default level names are 設備 (system) › 機器 (equipment) › 部位 (part). The plan holds the number and names of the facility register's levels (the Skill pack's names are defaults). Furnaces and lines are always kept as the separate level 号炉・系統 (furnace / line) between equipment and part (in the star chart, the levels of chart_rows and Excel; the data holds it as the equipment's series).
- The first level of the common equipment items is the 9 systems of Table II-4: 受入れ供給設備 (receiving and feeding), 燃焼・溶融設備 (combustion and melting), 燃焼ガス冷却設備 (flue gas cooling), 排ガス処理設備 (flue gas treatment), 余熱利用設備 (waste heat use), 通風設備 (draught), 灰出し設備 (ash discharge), 電気設備 (electrical), 計装設備 (instrumentation). Below them are Table II-4's equipment (for example 計量機 (weighbridge), ごみクレーン (refuse crane), ボイラ (boiler), 集じん装置 (dust collector), 押込送風機 (forced draft fan), 誘引通風機 (induced draft fan), DCS). The equipment of 燃焼・溶融設備 and 灰出し設備 differs by furnace type and whether there is melting (as in the table).
- For linking (node → item code), choose only from the codes in `items` of `intake_survey` (part: crosswalk). Codes not in the Skill pack cannot be placed. Do not map because names look alike. Look at the equipment number, the node above (system) and the work names together, and ask the user about nodes that cannot be decided.
- Linking is a proposal and is not decided until a person accepts it on the Decisions sheet of HOSHITORI.

### Mapping auxiliary equipment

- Table II-4 lists only the main equipment. The equipment level of a facility register also lists auxiliaries (pumps, fans, conveyors, dampers, valves, tanks, silos, panels, instruments, etc.) besides the main equipment. Do not leave an auxiliary unmapped because it has no item of its own; map it to the item of the main equipment it serves.
- How to decide:
  1. Decide the Table II-4 system from the name at the system level above.
  2. If that system has only one item below it (余熱利用設備, 計装設備, etc.), the auxiliaries at that level go to that item.
  3. If it has two or more, decide by the auxiliary's function (table below).
  4. Ask the user only about auxiliaries whose function does not decide a single item.
- Map only the equipment level. Do not map the system level or the part level (電動機 (motor), 軸受 (bearing), 耐火物 (refractory), etc.).

| Function of the auxiliary | Item to map to |
|---|---|
| Weighing refuse, weighing records | 計量機 |
| Refuse pit, charging doors, grabbing refuse, pit odour | ごみクレーン |
| Cutting and carrying bulky waste | 可燃性粗大ごみ切断機 |
| Feeding refuse into the furnace, moving the grate, carrying what falls through the grate (stoker type) | 燃焼装置 |
| Lighting the furnace, viewing inside the furnace, pushing ash out of the furnace | 焼却炉 (of that furnace type) |
| Boiler water and steam (feed water, deaeration, chemical dosing, soot blowing, superheating, economiser, steam header, pure water) | ボイラ |
| Turning steam back into water (condensate, condenser fans, condensate tank) | 蒸気復水器 |
| Cooling gas by spraying water | 水噴射式燃焼ガス冷却設備 |
| Dust collector cleaning, discharging collected dust | 集じん装置 |
| Chemicals such as slaked lime (storing, feeding) | HCL、SOx 除去設備 |
| Activated carbon (storing, feeding) | ダイオキシン類除去設備 |
| Urea solution, ammonia water, denitration catalyst | NOx 除去設備 |
| Supplying and heating combustion air | 押込送風機 |
| Drawing and recirculating flue gas, dampers, flues, stack | 誘引通風機 |
| Turbine oil, valves, gland steam, waste-heat exchangers | 蒸気タービン発電設備 |
| Carrying bottom ash, grabbing ash | 灰クレーン (plants without melting) |
| Carrying, storing, kneading and chemically fixing fly ash | 飛灰処理設備 (plants without melting) |
| Power receiving, transformers, distribution, power panels, DC supply, UPS | 受変電配電設備 |
| Emergency generation, circuit breakers, excitation | 発電機 |
| Central operation, analysers, thermometers, flow meters, monitoring cameras, instrument air | DCS |

### Furnace types

- The items of 燃焼・溶融設備 and 灰出し設備 differ by furnace type and whether there is melting. `items` of `intake_survey` does not show the type names, and the same names (「焼却炉」 (incinerator), 「前処理装置」 (pre-treatment device), 「溶融炉」 (melting furnace), etc.) appear once per type. Tell the types apart by the start of the code.

| Code prefix | Type |
|---|---|
| WI.COMB.STK_ | Stoker |
| WI.COMB.FBI_ | Fluidised-bed incinerator |
| WI.COMB.SHF_ | Shaft gasification furnace |
| WI.COMB.KLN_ | Kiln gasification furnace |
| WI.COMB.FBG_ | Fluidised-bed gasification furnace |
| WI.ASHOUT.ASH_CRANE・FLYASH_TREAT | Plants without melting |
| WI.ASHOUT.MELT・MELT_FLUE・POST・MELT_FLYASH | Plants with melting |

- Read the plant's furnace type from the names of systems and equipment in the documents (「ストーカ」 (stoker) or 「火格子」 (grate) means stoker type, 「流動床」 (fluidised bed) or 「流動砂」 (fluidising sand) means fluidised-bed type, etc.). If it cannot be read, ask the user once before linking, and do not choose items of a different type than that answer. One plant can have furnaces of different types, so if it differs by furnace line, ask about that too.

### Common names

- If a document's name is in the table below, map it to that item (do not decide by whether names look alike; only what is in this table is treated as the same). Names not in the table are decided by the auxiliary mapping above, or asked to the user.
- For items that have a type, use only the type chosen under "Furnace types" above.

| Example names in documents | Item to map to |
|---|---|
| トラックスケール・計量器 | 計量機 |
| ごみピットクレーン・ごみ投入クレーン | ごみクレーン |
| 粗大ごみ切断機・粗大ごみ破砕機 (ones that cut combustible bulky waste) | 可燃性粗大ごみ切断機 |
| ストーカ・火格子・焼却ストーカ | 燃焼装置 (stoker type) |
| 炉本体・焼却炉本体 | 焼却炉 (of that furnace type) |
| 廃熱ボイラ・排熱ボイラ | ボイラ |
| 空冷式復水器・復水器 | 蒸気復水器 |
| 減温塔・ガス冷却室 | 水噴射式燃焼ガス冷却設備 |
| バグフィルタ・ろ過式集じん器・電気集じん器 | 集じん装置 |
| 脱塩装置・有害ガス除去装置 (ones that remove hydrogen chloride and sulphur oxides) | HCL、SOx 除去設備 |
| 脱硝装置・触媒脱硝装置・無触媒脱硝装置 | NOx 除去設備 |
| 活性炭吹込装置 | ダイオキシン類除去設備 |
| 押込ファン・押込送風機・FDF | 押込送風機 |
| 誘引送風機・誘引ファン・IDF | 誘引通風機 |
| 蒸気タービン | 蒸気タービン発電設備 |
| 灰ピットクレーン | 灰クレーン |
| 飛灰固化装置・飛灰処理装置 | 飛灰処理設備 |
| 受電設備・受配電設備・高圧受電盤 | 受変電配電設備 |
| 非常用発電機・非常用発電装置 | 発電機 |
| 分散制御システム・分散型制御装置・中央制御装置 | DCS |

## Work categories

- There are 4 codes: INSPECT (inspection), OVERHAUL (overhaul), REPLACE (replacement), UPGRADE (major upgrade). The names are the defaults in `packs/_kinds/work.json`.
- Map from the documents' work names (「定期整備」 (periodic maintenance), 「開放点検」 (open inspection), 「取替」 (replacement), etc.), but at some plants one name mixes overhaul and replacement. When they mix, do not lump them into one attribute; ask the user.
- After-the-fact repairs (fixing breakdowns) are not given an attribute (they stay in the records).

### Reading work names

| Words contained in the work name | Attribute |
|---|---|
| 点検・検査・定期検査・精密機能検査・校正・試験・測定 (inspection, examination, periodic inspection, precision function inspection, calibration, test, measurement) | INSPECT |
| 分解・分解整備・分解点検・オーバーホール (disassembly, overhaul, disassembly inspection) | OVERHAUL |
| 取替・更新・交換 (replacement, renewal, exchange) | REPLACE |
| 基幹改良・延命化 (major upgrade, life extension) | UPGRADE |

- 「分解点検」 (disassembly inspection) involves taking apart, so it is OVERHAUL. For 「開放点検」 (open inspection), whether it is only opening and looking or goes as far as maintenance differs by plant, so do not map it; ask. A rule written as "contains the word" (contains) would collide with the 「点検」 (inspection) rule, so write such names as a rule with a list of names (in), or exclude them from the 「点検」 rule.
- Names that are only 「定期整備」 (periodic maintenance), 「整備」 (maintenance) or 「補修」 (repair) differ in content from plant to plant, so do not map them; ask (「補修」 can also be an after-the-fact repair). But if a name contains a word from the table above, as in 「定期整備（分解）」 or 「定期整備（取替）」, give it that attribute.
- Works without a name (star marks only, no work name) cannot be decided from the name. For each group of equipment (equipment under the same system, etc.), ask the user once, all together: "Are the marks of these n pieces of equipment inspection, overhaul or replacement?" Do not ask one question per piece of equipment. Make the answer into a rule whose conditions are the list of that group's equipment names (assetNode.name in) and works without a name (work.kind equals the empty string) (up to 20 values per rule; split if there are more).

## Review (self-check)

`check_results` returns 7 review checks. Report results without rounding or rephrasing, with the source and the level. It is a self-check, not a judgement by an authority.

| Check | Level | Source |
|---|---|---|
| Interval of the precision function inspection | recommendation | Director's notice (Showa 46, Kansei No. 45), part 3, item 11: "the precision function inspection under Article 5 of the Regulations at least once every three years". Article 5 of the Enforcement Regulations itself does not state a number of years |
| Columns of the equipment management criteria | recommendation | Guide Table II-7 and steps ② ③ of the preparation procedure |
| Soundness values | recommendation | Guide Table II-9 |
| Measures after a poor soundness rating | recommendation | Guide Table II-9 (measures column) |
| Number of plan years | app (the app's guideline) | Guide Table II-12 (the source is the Guide; the table is an example image, and the Guide sets no number of years, so the number of years itself is the app's guideline) |
| Actuals of past plans | app | No source |
| Plans within the plan period | app | No source |

The level requirement is used only for legal and subsidy requirements checked against the original. This Skill pack's review has no requirement.

## Building a plan from the history

- Keep plan marks (○) separate from what is decided by records (actual ●). Do not fill in cycles that are not in the records by guessing.
- Place cycle proposals with `chart_propose` (set: work.trigger to a number of years). The starting point is the work's last actual, and marks go up to the plan's latest fiscal year. It only adds; existing marks are not removed.
- There are 4 bases for a cycle. If there is none, do not place a proposal; ask the user.
  1. The plant's own actuals: the interval between the work's executions. Add record: true to `chart_propose`'s bases and MOYAI counts the interval from the fiscal years of the matched work's actuals and writes it in the basis (do not write numbers yourself). Works executed only once cannot be counted.
  2. The Skill pack's criteria: the review above (checks.json). Add pack: { checkId } (for example WI-PRECISION-INTERVAL) to bases and MOYAI writes the check's name and source in the basis. For the precision function inspection, at least once every 3 years can be shown as a guideline, as in the check's source (level recommendation).
  3. Similar plants on the public ledger (below). Add ledger.
  4. Plan rules (tier-3 Skill): cycles the user corrected after looking at the plan, kept as company, facility or person rules. Add rule: { name, ruleId } to bases.
- When the user corrects a cycle in conversation ("ash crane maintenance at this plant is every 4 years"), make it a plan rule and place it as a draft with `reading_rules_propose`: kind: planCycle, commonItem (the common equipment item's code), attribute (INSPECT, OVERHAUL, REPLACE, UPGRADE), years, text as one sentence in the person's words ("ash crane maintenance every 4 years"), and the user's words in reason. Scope is facility for that plant only, company if the same across the company.
- Plan rules do not change the plan directly. They only put out cycle proposals (IDs starting with R) for works whose common equipment item and work category a person accepted, and nothing is decided until a person accepts it on the Decisions sheet. A version's signature approves only the rules behind the proposals accepted in that version.
- When the user names a work × fiscal year mark in conversation (plan ○ or actual ●) ("put the furnace 2 refractory repair in the FY2027 plan", "postpone the ash crane maintenance from FY2027 to FY2028", "the FY2024 ash crane maintenance is an actual"), place a mark proposal with `chart_propose`'s stars.
  1. Pass the equipment row's id (n:…) as `chart_rows`' rowRef and read that equipment's work rows (id w:…, fields are the work name and the fiscal-year marks). If which work is not decided, list the work names and ask the user.
  2. Place in stars: add { op: add, rowRef, value: plan or actual, fiscalYear }, remove { op: remove, rowRef, value, fiscalYear }, move a plan (postpone or bring forward) { op: move, rowRef, fromFiscalYear, fiscalYear }. Fiscal years only within the star chart's first and last years. Do not copy row values.
  3. Place one request in one call. The same kind for the same work (add plan, remove plan, move plan, add actual, remove actual) becomes one proposal and one row on the Decisions sheet.
  4. Add an actual only on the user's words (author: ai_relayed_human). Do not infer actuals from records or criteria (bases record, pack and rule are not a basis for actuals). If the same equipment has an actual of another work in the same fiscal year, MOYAI adds it as a reference row. Actuals after the reference date's fiscal year cannot be placed.
  5. Remove an actual only on the user's words (author: ai_relayed_human). Removing and moving plans can also be placed on Claude's judgement, with the reason written in basis.
  6. In the star chart, proposals show as a vermilion dashed circle for an addition and a vermilion slash over the current mark for a removal. Nothing is decided until a person confirms on the Decisions sheet of HOSHITORI.

## The public ledger and similar plants

- With `peer_reference` (place: ledger), read only the public ledger, in the plan's view (as a municipality). The view's axes are those with columns in the national table: furnace type, capacity class, whether it generates power, ash treatment, and operating form. Axes without an answer come back as needs; ask the user.
- Use as a basis only groups of 5 or more similar plants where an interval median is given. The median is a class (a range), not a single number of years. Choose which number of years to propose from within the quartiles, with a reason, and confirm with the user.
- Costs are not written in the ledger or in the basis text. Do not try to identify plants. Do not copy numbers from a (private) shared folder into public basis text.

## Demo

- When the user says "run the demo", use `intake_add_files` (source: demo) to put this Skill pack's fictional documents in `demo/` (the long-term maintenance plan star chart, the clean-copy daily work reports with one sheet per day, and the order ledger exported from the city's finance system as CSV: 3 files) into the work screen.
- The daily work reports and the finance CSV do not fit the standard reading (the reports are forms, not tables; the CSV's headings are finance words such as 件名, 債権者名, 金額, and its second block 支出命令 repeats the heading). Do not drop them: read them with a custom Skill as the tier-1 Skill's "Read every file" says (form for the reports; contractColumn and a heading row for the CSV). `demo/README.md` shows the rules that read them through.
- How to proceed is in `demo/README.md`. Open the work screen first, advance one step per reply, say briefly what changed on the screen, and wait for the user's "next". Do not go to the end with Claude alone. People confirm on the screen.
- The demo documents are fictional. Do not talk about them as a real plant. Do not mix them with non-fictional documents.

<!-- moyai:data-names:begin（src/shared/data-names.ts と packs/waste-incineration/data-names.json から作る。手で直さない） -->

## Files and data names

Which part of a file becomes which data name. The definitions, and what not to map independent of industry, are in "Data names" of the tier-1 Skill. Examples are quoted as the files write them.

Example files: 星取表（年度の整備計画表）, 作業日報（1 日 1 枚の帳票）, 工程表（定期整備の週のガント）, 発注台帳（年度の契約の一覧）, 完成図書 第3編 機器仕様一覧表（PDF）, 日常点検表（写真）.

| Name | Examples in files | Do not map (this industry) |
|---|---|---|
| Facility | 星取表の題・発注台帳の件名の施設名 → 施設名。公共の施設は 4 月始まり | - |
| Equipment (asset node) | 星取表の階層の名前の行 → 1 つの節。完成図書の機器仕様一覧表の行 → 同じ節の名前と仕様。日報の明細「1号 No.2 BFP 分解整備」の「BFP」→ ボイラ給水ポンプの節（呼び名の揺れ） | 完成図書の名前と星取表の呼び名が違うだけで別の機器にしない（「空冷式蒸気復水器」と「復水器」） |
| Specification | 完成図書の機器仕様一覧表の列（型式・容量・数量）→ 仕様 | - |
| Level | 星取表の列のずれ・全角の空白の字下げ・「・」・番号 1 / 1-1 → 階層（既定「設備 › 機器 › 部位」） | - |
| Line / unit | 「#1・1号・1号炉・1炉・１号炉」→ 系列 1。日報の「共通・—」→ 共通 | 星取表で 2 炉を 1 行に書いた行を、炉ごとに割らない |
| Common equipment item | 資料には書いていない。機器の名前と上の設備の階層から、このSkillパックの「よくある呼び名」「補機の当て方」で選ぶ（「バグフィルタ」→ 集じん装置） | 炉の型の違う項目を選ばない。表Ⅱ-4 に無い補機を空けたままにしない（仕える主要な機器の項目に当てる） |
| Work | 星取表の作業の行（「1号炉 定期整備」「ボイラ給水ポンプ 分解整備」）→ 作業。日報の明細の作業の語（「分解整備」「本体点検」）→ 同じ作業 | 発注台帳の定期補修工事の一式・継続費の基幹改良の行を作業にしない（作業と結ぶだけ）。事後の補修（「補修（事後）」の行・臨時）を計画の作業にしない（記録には残す） |
| Work attribute | 作業の名前の語から（このSkillパックの「作業の名前の読み替え」）：「分解点検」→ 分解整備、「取替」→ 更新 | 「開放点検」「定期整備」「整備」「補修」だけの名前は当てずに聞く |
| Maintenance strategy | 機器別管理基準の保全方式の列 → 保全方式 | 機器別管理基準に保全方式の列が無いことを、照査の外れのほかで埋めない |
| Cycle (trigger) | 星取表の「周期」「周期(年)」の列（数の行と「2年」の文字の行）→ 暦の枝。「6Y」「130M」はSkillパックの語彙で読み替え。号炉ごとの運転時間 → 稼働の枝（暦と早い方） | 備考の「R18に更新の予定」の年度を周期にしない |
| Next due | - | 備考の「R18に更新の予定」を次回にしない |
| Origin | 日報・工程表の実績の日付 → 起点。年度だけの星取 → 年度の始まりの日（年度単位）。完成図書の竣工 → 設置の日（使用開始） | 星取表の ○→（延期）・△（一部）を起点にしない |
| Fiscal year | 星取表の 2 段の見出し（上 H25・R元、下 西暦）→ 年度。1 つのセルの「R2」改行「(2020)」→ 2020 年度 | - |
| Star (plan / actual) | 星取表の凡例の例：○ 計画・◎ 計画どおり実施・● 計画外の実施・△ 一部・○→ 延期 | 網掛けの未来の年度の列の星取を実績にしない。△ と ○→ を答え無しに実績にしない |
| Work fiscal-year value (plan / actual) | 星取表の ● 1 つ → 実績の年度の値。日報の同じ作業の行を集めて → その年度の実績（工数は和）。発注台帳の支払額 → その実績の費用 | - |
| Kind | 星取表の ● のうち計画の無い年度 → 実績（計画外） | - |
| Work detail | 作業日報の明細の 1 行（「1号 No.2 BFP 分解整備」とその日の人員）→ 1 つの作業明細。続紙（「作業日報（続紙）」）の行も同じ | 工程表の週のセル・発注台帳の行を作業明細にしない（案） |
| Period | 工程表の着手・完了 → 期間。日報の作業した日の最初と最後 → 期間 | 発注台帳の工期（契約の期間）を作業の期間にしない |
| Days | 工程表の「6日間」→ 日数。工程表の週のセル（その週に作業した日数）→ 日数 | 発注台帳の工期の日数を作業の日数にしない |
| Man-days | 日報の人員（「3名」）・人工計（R6 からの帳票）→ その日の工数。工程表の延べ人工（「45人工」）→ 年度の工数 | 日報の人員の和と工程表の延べ人工が違うとき、片方で決めない（「資料で違う工数・日数」で聞く） |
| Cost (budget / actual) | 発注台帳の支払額 → 実績の費用。星取表の費用の列（計画の行）→ 予算。単位（千円）・税込か税抜は見出しから | 単価契約の予定総額を実績の費用にしない（支払額を使う）。変更契約の行（「〃（第1回変更）」）を別の作業の費用として足さない（案：聞く）。設備ごとの小計・年度ごとの合計を費用にしない |
| Result / measurement / previous value | 日常点検表の写真のチェック・×・数 → 判定・測定値（人が画像と並べて確かめるまで要確認）。機器別管理基準の健全度 → 判定（案） | 健全度の段（1〜4）の外の値（「5」）を直して入れない（照査が出す） |
| Contractor | 発注台帳の契約の相手 → その作業の外注先（案） | - |
| Performer | 日報の作業者の名前 → 実施者（案） | - |
| Usage | 日常点検表の積算の運転時間の欄 → 稼働（未確認：手本の写真に有るか） | - |
| Mapping | 資料には無い。機器の名前・上の設備の階層・作業の名前を条件にしたルール | - |
| Check and answer (intake question) | 取り込みの質問（年度の読み方・列の役目・費用の単位・星取の意味）への答え | - |
| Rule | 会話で決めたルール：「「延工数(h)」の列は時間として読む」「「ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ」と「BFP」は同じ機器」 | - |
| Plan rule | 資料には無い。利用者が会話で直した周期（「灰クレーンの整備は 4 年ごと」） | - |
| Cycle proposal (ledger, rule, conversation answer) | 資料には無い。公開台帳の類似施設 5 以上の間隔の中央値・Skillパックの基準（精密機能検査の 3 年に 1 回以上）・自施設の実績の間隔・計画ルールから | - |
| Matching | 工程表の着手・完了と日報の作業した日（同じ作業）。星取表の周期と機器台帳の周期 | - |
| Source file | 資料・シート・セル。完成図書の PDF は頁と位置、日常点検表の写真は画像の位置 | - |

<!-- moyai:data-names:end -->

## Rules (tier 2)

This Skill pack's rules are in `reading.json` (the same shape moyai.reading/0 as tier-3 rules). Intake applies them after the tier-3 rules (facility, person, company).

- Trade word: 「築炉工」 (furnace builder; repairs incinerator refractories). Read as a trade word in the headcount column of daily work reports.
- Reading how furnaces are written (「1号炉」, 「1炉」, 「#1」) is currently held by the standard reader. After judging, it will move to this Skill pack's words.
- Do not add fine-grained per-plant rules here (column wording, heading rows, meanings of symbols, fixed answers). Make them into tier-3 rules in conversation.

## Sources

- Ministry of the Environment, "Guide for Preparing Comprehensive Life-Extension Plans for Waste Treatment Facilities (Waste Incineration Edition)", revised March 2021 (https://www.env.go.jp/recycle/waste/3r_network/7_misc/gl-ple_prov.pdf )
- Notice on points to note in applying the Waste Management and Public Cleansing Act (25 October 1971 (Showa 46), Kansei No. 45, notice of the Director of the Environmental Sanitation Division, Environmental Health Bureau, Ministry of Health and Welfare) (https://www.env.go.jp/hourei/11/000510.html )
- Enforcement Regulations of the Waste Management and Public Cleansing Act (Ordinance of the Ministry of Health and Welfare No. 35 of 1971) (https://laws.e-gov.go.jp/law/346M50000100035 )
- General Waste Treatment Survey (FY2024), facility tables (incineration plants) (https://www.env.go.jp/recycle/waste_tech/ippan/r6/data/seibi/facility/ )
- Excerpt of a recommendation by the Ministry of Internal Affairs and Communications (a secondary source on how precision function inspections are carried out) (https://www.soumu.go.jp/main_content/000401742.pdf )
