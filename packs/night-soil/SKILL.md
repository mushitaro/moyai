---
name: moyai-pack-night-soil
description: The night-soil treatment Skill pack (MOYAI's tier-2 Skill; standard, users cannot edit it). Read it when reading maintenance plans (star charts) of night-soil treatment plants and sludge recycling centres in MOYAI and mapping them to the common equipment items.
---

# Night-soil treatment Skill pack (tier-2 Skill)

One of MOYAI's standard industry Skill packs. Its content is the data in `packs/night-soil/` (`common.json`, `sources.json`); this text explains how to use it. It is a Skill pack that was "only added", and is not as thick as the waste incineration Skill pack. It does not override the tier-1 basic operating rules.

Reply to the user in the user's language (Japanese if they write in Japanese). The documents are usually in Japanese, so the document words below are kept in Japanese exactly as they are written in documents and in `common.json`; English glosses are in parentheses.

## Verification level

- Common equipment items (`common.json`): checked against the original. Table II-4 "Example list of main equipment and devices" (printed page 27, PDF page 35) of the Ministry of the Environment's "Guide for Preparing Comprehensive Life-Extension Plans for Waste Treatment Facilities (Night-Soil Treatment Facilities and Sludge Recycling Centres Edition)" (revised March 2021) was checked against the original.
- "Mapping auxiliary equipment", "Common names" and "Reading work names" below: unchecked (the authors decided them from common industry names; they are not in Table II-4).
- National table, public sharing vocabulary and review: not implemented. So sharing (shared folders, the public ledger) is turned off and `check_results` has no review. Tell the user plainly that comparison with similar plants is not available.

## Hierarchy and common equipment items

- The default level names are 設備 (system) › 機器 (equipment) › 部位 (part).
- The first level of the common equipment items is the 8 systems of Table II-4: 受入貯留設備 (receiving and storage), 主処理設備 (main treatment), 高度処理設備 (advanced treatment), 脱臭設備 (deodorising), 給水設備 (water supply), 配管設備 (piping), ダクト設備 (ducts), 電気計装設備 (electrical and instrumentation). Below them are Table II-4's device names (for example 投入槽 (input tank), 沈砂槽 (grit tank), 受入槽 (receiving tank), 破砕機 (crusher)).
- Rows of Table II-4 hidden behind a band and unreadable are not made into items (`common.json` notes). Do not make an unreadable name into an item by guessing.
- Tanks with the same name (脱窒素槽 (denitrification tank), 硝化槽 (nitrification tank), 沈殿槽 (settling tank), etc.) are often in two trains. Decide which train a piece of equipment belongs to from the register's equipment number and order; if undecided, ask the user.
- For linking (node → item code), choose only from the codes in `items` of `intake_survey` (part: crosswalk). A proposal is not decided until a person accepts it on the Decisions sheet of HOSHITORI.

### Mapping auxiliary equipment

- Table II-4's items are fine-grained by device, but registers also list the auxiliaries attached to them (pumps, valves, instruments, small tanks, panels, etc.). Do not leave an auxiliary unmapped because it has no item of its own; map it to the item of the device it serves.
- How to decide:
  1. Decide the Table II-4 system from the name at the system level above.
  2. If that system has only one item below it (配管設備 (piping), ダクト設備 (ducts)), the auxiliaries at that level go to that item.
  3. If it has two or more, decide by the device that appears in the auxiliary's name (for "〇〇槽の撹拌機" (agitator of tank X), tank X).
  4. Ask the user only about auxiliaries that cannot be decided as one.
- Map only the equipment level. Do not map the system level or the part level (電動機 (motor), 軸受 (bearing), etc.).

### Common names

- If a document's wording is in the table below, treat it as that item's wording (do not decide by whether names look alike; only what is in this table is treated as the same).

| Wording in documents | Item wording |
|---|---|
| ブロア | ブロワ（曝気ブロワ・ガス撹拌ブロワ） (blower: aeration blower, gas agitation blower) |
| ばっ気・エアレーション | 曝気（曝気ブロワ・再曝気槽） (aeration: aeration blower, re-aeration tank) |
| 沈砂池 | 沈砂槽 (grit tank) |
| スクリーン・し渣除去装置 | 夾雑物除去装置 (screenings removal device) |
| し渣脱水機・スクリュープレス | 夾雑物脱水装置 (screenings dewatering device) |
| 汚泥掻き寄せ機・掻寄せ機 | 沈殿槽汚泥掻寄機 (settling tank sludge scraper) |
| 非常用発電装置 | 非常用発電機 (emergency generator) |

## Work categories

- There are 4 codes: INSPECT (inspection), OVERHAUL (overhaul), REPLACE (replacement), UPGRADE (major upgrade). After-the-fact repairs are not given an attribute.

### Reading work names

| Words contained in the work name | Attribute |
|---|---|
| 点検・検査・定期検査・精密機能検査・校正・試験・測定 (inspection, examination, periodic inspection, precision function inspection, calibration, test, measurement) | INSPECT |
| 分解・分解整備・分解点検・オーバーホール (disassembly, overhaul, disassembly inspection) | OVERHAUL |
| 取替・更新・交換 (replacement, renewal, exchange) | REPLACE |
| 基幹改良・延命化 (major upgrade, life extension) | UPGRADE |

- 「分解点検」 (disassembly inspection) is OVERHAUL. Names that are only 「開放点検」 (open inspection), 「定期整備」 (periodic maintenance), 「整備」 (maintenance) or 「補修」 (repair) differ in content from plant to plant, so do not map them; ask. But if a name contains a word from the table above, as in 「定期整備（分解）」 (periodic maintenance (disassembly)), give it that attribute. A name that would collide with the 「点検」 (inspection) rule under a rule written as "contains the word" (contains) should be written as a rule with a list of names (in), or be excluded from the 「点検」 rule.
- For works without a name (star marks only), ask once per group of equipment: "Are the marks of these n pieces of equipment inspection, overhaul or replacement?" Make the answer into a rule whose conditions are the list of that group's equipment names (assetNode.name in) and works without a name (work.kind equals the empty string) (up to 20 values per rule).

## Sources

- Ministry of the Environment, "Guide for Preparing Comprehensive Life-Extension Plans for Waste Treatment Facilities (Night-Soil Treatment Facilities and Sludge Recycling Centres Edition)", revised March 2021 (https://www.env.go.jp/recycle/waste/3r_network/7_misc/gl-ple_hw.pdf )
- General Waste Treatment Survey, FY2024 results, facility status (night-soil treatment facilities) (https://www.env.go.jp/recycle/waste_tech/ippan/r6/data/seibi/facility/08.xlsx ; not used yet)
