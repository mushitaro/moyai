# MOYAI

English ・ [日本語](README.ja.md)

**MOYAI lines up the inspection and repair records of waste incineration plants on a single star chart, so a plant can compare itself with similar plants across Japan: how many years between repairs, how many person-days, and how many days each takes.**

- **Who made it**: an engineer who spent 10 years at a waste incineration plant maker working on plant maintenance (planning and recording inspections and repairs).
- **The problem**: Japanese municipalities spent about ¥2.45 trillion on waste management in fiscal year 2024 (Reiwa 6). The Ministry of the Environment's guide points out that the buying side lacks specialist expertise, and encourages using other municipalities' contract examples and sharing knowledge (sources and how they were counted: [docs/impact.md](docs/impact.md), in Japanese).
- **What MOYAI does**:
  1. It reads each plant's Excel, PDF and photo records, whatever their format, on your own PC, and lines them up on one star chart per facility. Even for a single plant, the history and cycle of maintenance fit on one sheet, and the signed, confirmed versions pile up for the next person in charge.
  2. With plant names and amounts hidden, it compares maintenance cycles, person-days and days with similar plants nationwide (only when five or more plants of the same class are available). The aim is to give more material for thinking about maintenance plans and the content of estimates.

A star chart puts equipment in rows and fiscal years in columns, with ● in the years an inspection or repair was done and ○ in the years one is planned. Rows are aligned to the government guide's equipment list × the kind of work (inspection, overhaul, replacement, major upgrade). Other kinds of facilities are added by adding a Skill pack (data).

- Video: [MOYAI — Built with Claude: Japan 2026](https://youtu.be/Qn6WKnjlH6s) (the submitted version; it does not include the "Changes after submission" below). The video is in Japanese.
- Theme: what should reach everyone.
- All documents, facilities and sites are fictional (marked 【架空】).

### Languages

- The app's AI-facing text (tool descriptions, MCP instructions and the Skill files) is in English, and Claude replies to the user in the user's language (Japanese if they write in Japanese). Tool names, argument names and returned values are the same in every language.
- Skill packs carry an English name and description next to the Japanese one (`packs/*/pack.json` → `en`).
- The reader also understands English column headings in documents (for example "Equipment", "Work description", "Man-days", "Status: Done / Planned", "FY2026"). Japanese documents are read exactly as before.
- Screen text in English and Japanese is being added in a separate change.

## Try it

You need no MOYAI account and no login.

| You need | |
|---|---|
| PC | Windows or macOS (checked on Windows 11; macOS is unchecked) |
| Node.js | 22 or later (if missing, Claude asks first and installs the official one — nodejs.org or winget's OpenJS.NodeJS.LTS) |
| AI client | Claude Desktop (the Code tab or Chat) or Claude Code |

1. Give the chat this repository's URL (<https://github.com/mushitaro/moyai>) and ask "Install MOYAI". Claude checks Node, then runs clone → `npm ci` → `npm run build` → `setup`. `setup` asks for the sender's name, shows in the chat what it will write and where, and writes only after you say yes. If Claude Desktop is open, it waits for it to close before adding to its settings, so you reopen Desktop once. For Claude Desktop, the clone's current version (the committed content — work in progress is not included; if the clone's current commit is not on main, the latest main of mushitaro/moyai) is installed separately into a per-version folder (`setup` prints the path), and the settings point to a launch script (`launch.cjs`) outside the version folders. The clone itself stays as it is (people who develop MOYAI point to the clone directly with `setup --dev`).
2. Ask "Run the demo". Claude puts the waste incineration Skill pack's fictional documents (`packs/waste-incineration/demo/`: facility register, star chart, daily work reports) into the screen, asks the confirmations one at a time, and builds the star chart. Each reply advances one step only, so you can follow the changes on the screen. A person confirms on the Decisions sheet of HOSHITORI.
3. Ask "Update MOYAI" and Claude uses `moyai_update` to check whether mushitaro/moyai's main has a new version, asks you, and prepares it in a separate folder (fetch → `npm ci` → build → self-check; on failure it is discarded and the current version stays; one previous version is kept). The running MOYAI is not stopped; the switch happens at the next start. When it is ready, the build label at the bottom right of the work screen turns vermilion. It refuses when there are local changes or it cannot fast-forward.
4. Ask "Uninstall MOYAI". Claude asks whether to delete the storage too (plan versions, the facility signing key, documents; kept by default), shows what `uninstall` will do (it also removes the version folders `setup` installed), deletes, and finally asks before deleting the repository folder, showing the path.

People only answer in the chat and confirm, sign, send and approve on the screen (the two exceptions are in item 5 of "How it works"). Nobody is asked to use a terminal, download, or drag files. The signing key is created at the first confirmation and has no password. The source of truth for the steps is `skills/moyai/SKILL.md` ("Install, demo and uninstall from the chat") and `packs/waste-incineration/demo/README.md`.

## The problem: similar plants cannot be compared

I worked for 10 years at a waste incineration plant maker (5 years as a maintenance engineer, 5 years developing star-chart systems and migrating data). Ten years ago, a municipality's maintenance officer asked me: "I want to compare with the rest of the country. Your company can do that, right?" To explain their budget, they wanted to check whether their plant's maintenance was reasonable against similar plants nationwide. I could not answer.

Maintenance of waste incineration plants runs between these four parties.

| Party | Role |
|---|---|
| Owner (municipality) | Owns the plant and orders maintenance with tax money. There are 844 incineration plants (the plant table of the Ministry of the Environment's "General Waste Treatment Survey (FY2024)", counting plants whose "closure/change" column is empty, excluding plants marked suspended, closed or new. This differs from the count the report publishes. `packs/waste-incineration/sources.json`) |
| Plant maker | Builds the plant |
| Maker-affiliated maintenance company | Takes maintenance work as an affiliate of the maker that built the plant. Life-extension works on core equipment are often contracted by (sole-source) negotiated contract (Ministry of the Environment, "Guide to Tendering and Contracts for Waste Treatment Facility Construction", revised March 2025, p. 6). How yearly maintenance contracts are awarded has not been counted |
| O&M operator | Takes on operation and maintenance together for many years |

I could not answer, not because anyone was at fault, but because of this structure.

- The companies that take maintenance work are the ones that see histories nationwide. Showing other plants' histories would give material for comparing maintenance costs. As a company, we could not share.
- I at least tried to put that municipality's plan in order with our own records. But the data was not in order. One plant has about 1,000–2,000 pieces of equipment, maintenance is every year, and documents follow each client's format. Daily work reports, work completion reports and the next year's maintenance plan are connected, yet they were split up in different formats (from my experience). Putting the data in order cost too much, and nobody built a system for it.
- When I moved to an equipment maintenance software company, and when I went independent, I ended up in the same place. The data could only be made by people.

Now there is Claude. It can read documents in any format and put the data in order. But Japanese companies dislike handing documents to AI and having them used for training. So MOYAI runs almost entirely on your own PC. What goes to Claude is only the shape of the tables and the small part that could not be read. What is shared nationwide is only information from documents that municipalities and operators already share; cost prices and plant names are not sent.

Maintenance histories are split by plant and by contractor, and each plant writes them differently. Municipalities want to compare their own plant's cycles, person-days and days; maintenance companies want to compare plants other makers built; O&M operators want to compare plants similar to the one they are bidding for (from my experience).

Government documents describe this structure too. The Ministry of the Environment's guide (revised March 2025) says that technology and know-how gather at plant makers, and that ordering municipalities "lack the specialist ability to negotiate technology, prices and so on with plant makers as equals" (p. 1). It asks municipalities to share knowledge with each other (p. 5), and to build target prices from other municipalities' contract examples rather than relying only on the maker's quote (p. 10). The four cost items for intermediate waste treatment — construction, treatment, outsourcing and personnel — totalled about ¥1.3 trillion in FY2024 (a figure this repository selected and summed; it is not the amount for repair and maintenance alone. [docs/impact.md](docs/impact.md)).

In the municipal plans collected by the Ministry of the Environment, incineration plants bear inspection and repair costs about equal to their construction cost over roughly 30 years of operation. When that happens differs widely between plants: for fully continuous plants with power generation, it ranges from a little over 10 years to about 40 years (Ministry of the Environment, "Guide for Preparing Comprehensive Life-Extension Plans for Waste Treatment Facilities (Waste Incineration Edition)", pp. 119–120).

Public cost information and plans exist. On top of them, MOYAI builds the yardstick and the place for comparing each piece of equipment's maintenance cycle, person-days and days across plants on equal terms.

## How it works

### What MOYAI does

1. **Intake**: put in Excel, CSV, PDF and photos as they are. Claude reads the shape of the documents (headings, columns, counts, small samples) and asks only about what is undecided. Row data is not given to Claude.
2. **Star chart**: records are linked to the common ledger and arranged in fiscal-year columns. The common ledger is the common equipment items (Ministry of the Environment, "Guide for Preparing Comprehensive Life-Extension Plans for Waste Treatment Facilities (Waste Incineration Edition)", Table II-4) × work categories (inspection, overhaul, replacement, major upgrade). Proposed cycles carry their basis (the plant's own records, the Skill pack's criteria, the public ledger, plan rules).
3. **Review**: pure functions flag what falls outside the Skill pack's criteria (with sources). It is a self-check, not a judgement by an authority.
4. **Sharing**: only values cut into classes (for example, interval 6–7 years) of cycles, person-days and days are signed with the facility signing key and sent to a shared folder or the public ledger. Nothing is sent unless there are five plants of the same class. Costs, plant names and dates are not sent.
5. **Only people confirm**: confirming, signing, sending and approving exist only as buttons on the screen, not as Claude's tools (`docs/security.md`). Two exceptions: after a person presses "Sign and hand over", Claude sends the handover email word for word when the user asks (the one-time token in the link also reaches the AI provider); and Claude writes drafts of unapproved rules to the storage. Both are approved by a person's signature.

### The three tiers of Skills (`docs/plan.md` §2.17)

| Tier | Content | Where |
|---|---|---|
| Tier 1 | The standard reader and the operating steps (install, intake, asking for confirmation, what to do when the reading gets stuck) | `skills/moyai/SKILL.md`, `src/import/`, `packs/_cues/` |
| Tier 2 | The industry's Skill pack (common equipment items, review, data names, rules for industry words) | `packs/<industry>/`. For waste incineration, rules are in `packs/waste-incineration/reading.json` |
| Tier 3 | Rules made in conversation (per facility, person or company). Approved when a person signs a version | `skills/` in the user's storage |

Rules apply in the order tier 3 → tier 2 → tier 1. Reading the shape of documents (tables, headings, merged cells, etc.) is tier 1, industry words are tier 2, and fine-grained readings for one facility are tier 3. A new facility is worked out with tier-3 rules through repeated conversation between Claude and the user. Something is added to tiers 1 and 2 only when it is shown to be a shape that appears in every facility's documents.

## Changes after submission (2026-11-10 to 11-11)

The submitted version (tag `submission`, branch `hackathon-release`) is unchanged. Below are the changes merged into main. Logs: `docs/progress/2026-11-10.md`, `2026-11-11.md`.

| What | Content | What was checked |
|---|---|---|
| The star chart's "time map" (mushitaro/moyai#37–#40) | Selecting a star or a row joins the row's stars with a thin line and shows the cycle as "n years" (no good/bad judgement). Future plan-only ○ marks can be dragged, or moved with Alt+← / →, to other years to try things out (Ctrl+Z undoes; the version is not changed, and confirming and signing are by people as before). Aggregated rows of similar plants show their statistics in a side panel. When the plan is rebuilt after answers, only newly added stars quietly appear | Tests and screenshots in Chrome on Linux. Windows hardware is unchecked |
| Export and sharing as HOSHITORI sheets (mushitaro/moyai#28, #35) | EXPORT and SHARE, which were separate screens, became the "Export" and "Share" sheets of HOSHITORI (shown only when a confirmed version exists). Choices and explanations were trimmed so you see the result and press one main button. Template exports are for confirmed versions only | Same as above |
| Conditions that stop the confirm button (mushitaro/moyai#41) | While accepted decisions cannot be read (loading, no storage, unreadable), "Sign and confirm" is stopped and the reason is shown in the bottom band | Same as above. The bridge already refused the confirmation itself |
| The public ledger's location as one setting (mushitaro/moyai#41) | `config/ledger.json` holds the ledger repository and root, and paths derive from it. The design for splitting the ledger into another repository is `docs/ledger-split.md`. On 11-12 MOYAI's side was switched to mushitaro/moyai-ledger (mushitaro/moyai#20) | The ledger side (fixing the moyai-ledger validation workflow) and deploying the intake wait for the operator |
| Skill pack yardstick (`scripts/bench/pack-bench.mjs`) | Measures all the fictional facilities in `samples/<pack>/` with the same tools as the unseen formats. No AI or API is used. CI fails if the numbers differ from the recorded ones | "Numbers" below |
| Rule in the waste incineration Skill pack | Reads "共" (shared) in the furnace column of daily work reports as no furnace/line (tier 2) | 7,299 unresolved cells disappeared across 3 facilities |
| Review of the ledger intake | Fixed what the review found, such as limits on the number of PRs (20 in total, 1 per key) | The intake is not deployed yet |
| Size of the problem (`docs/impact.md`) | Checked the costs and the guide's statements against public government documents | Sources, pages, cells and SHA-256 are written down |

## Numbers (when measured, and at which commit)

| What | Result | When / source |
|---|---|---|
| Taking in, one by one, the 295 test documents I checked and approved (4 fictional facilities) and answering with default answers | Cells read 28% → 52%; unresolved cells without a question 254,872 → 2,087; documents that reach a plan on their own 9 → 69 | Reading map version 4 (`fabb4de`, 11-08 11:07). Before: `47e6c4a`. [docs/reading-map/index.html](docs/reading-map/index.html) |
| Putting in the 9 documents of the fictional "Hokubu CC" together and answering the confirmations that have no default answer | A plan is built (514 equipment nodes, 1,001 works, 2,798 work details) | `a460e13` (same numbers as after `bd80939`). Recorded in the `a460e13` commit message. The test script answered the confirmations with the first option (not a person's answers) |
| Repeated conversation (the fictional "Aobadai", a facility the reader was not tuned to, 86 documents) | Times the user was asked: 3 in round 1 (47 documents), 1 in round 2 (39 more). Both reached a plan | `50a3428`, 11-08 14:30. Numbers from a Claude that knew the answers, not from a first-time Claude. [docs/progress/conversation-loop-2026-11-08.md](docs/progress/conversation-loop-2026-11-08.md) |
| 17 expected prompts (install, demo, documents, templates, sharing, approval email, settings, etc.) | All 17 progressed. "Export Excel in this template" timed out the first time (the screen's tab was suspended) and passed after the fix | `fabb4de`, morning of 11-08. [docs/progress/prompt-test-2026-11-08.md](docs/progress/prompt-test-2026-11-08.md) |
| Unseen formats (5 sets with a frozen reader) | No set reached a plan; ⑥ recovery rate 0% | Reader of 11-05 (`reader-freeze-1` to `6`). [docs/trend.md](docs/trend.md) |
| Development documents (factory fictional-1, fictional-2) | Excel, CSV and PDF all at ① source leaks 0, ② unresolved 0, ③ reading accuracy 100% | Run on 11-05. [docs/trend.md](docs/trend.md) |
| Skill pack yardstick (11 fictional waste incineration facilities, no rules made in conversation; the test script answered confirmations) | Facilities that reached a plan 4/11, ② unresolved 1,433, open questions 92, ⑥ recovery rate 17.9% | 11-10 (`eval/bench/waste-incineration/README.md`). Neither people's answers nor a first-time Claude's numbers |
| Number of tests (after submission) | node:test 185 and vitest 1,838 passed (7 skipped). None failed | Log of 11-11. e2e was run only in part (the log's "five-way report") |
| Number of tests (submitted version) | vitest 1,806, node:test 177, e2e 72 (2 skipped), demo walkthrough 39 (1 skipped) passed. None failed | Run at `d483e36` (11-08). Between that and the submitted version (tag `submission`, branch `hackathon-release`), only this README and a fix to the audit script were added (the 9 audit tests passed) |

## Showcase: see results quickly

| What | Where |
|---|---|
| Public ledger (shared files of 10 fictional facilities) | [mushitaro/moyai-ledger](https://github.com/mushitaro/moyai-ledger) (a ledger-only repository). From 11-07 to 11-12 it lived in this repository's `ledger/` (moved in `bca1ddb`, moved back on 11-12; byte-for-byte the same). PR validation on mushitaro/moyai-ledger before 11-07 (the `ledger-validate` Action): the 10-facility PR [#1](https://github.com/mushitaro/moyai-ledger/pull/1) is ✓; the deliberately broken PRs [#2](https://github.com/mushitaro/moyai-ledger/pull/2) (fewer than 5 plants of the same class), [#3](https://github.com/mushitaro/moyai-ledger/pull/3) (a cost field) and [#4](https://github.com/mushitaro/moyai-ledger/pull/4) (a plant name) are ✗ |
| A PR to the public ledger (from the app) | At 19:44 on 11-08 I pressed "Sign and send to the public ledger" in SHARE and MOYAI opened a PR on GitHub: [mushitaro/moyai#8](https://github.com/mushitaro/moyai/pull/8) (one shared file of the fictional demo plant; the ledger validation `ledger-validate` runs). The GitHub OAuth App was registered on 11-08 (`f01c57b`) |
| Public ledger site (similar plants' star charts, and the median, quartiles and range of the statistics rows) | moyai has no Pages. The old ledger mushitaro/moyai-ledger's site (<https://mushitaro.github.io/moyai-ledger/>) remains as it was when moved on 11-07. You can also build it locally from a clone of the ledger: `node dist/cli.js ledger site <clone of moyai-ledger> <output folder>` → `index.html` |
| Reading map (for the 295 documents: cells read, unresolved, reaching a plan, by writing style) | [docs/reading-map/index.html](docs/reading-map/index.html) (clone and open) |
| Acceptance test table (generated from test runs) | [docs/acceptance.md](docs/acceptance.md) (11-08 18:56, `4ca6d0d`: 18 passed, 5 partial, 0 failed, 4 without tests, 2 not measured, 29 in all) |
| Test counts and intake yardstick over time; results of unseen formats | [docs/trend.md](docs/trend.md) |
| Skill scoring table | The table below. Sources: `report.json`, `report.html` in [eval/runs/](eval/runs/) |
| How Claude was used and how this was built | [docs/how-built.md](docs/how-built.md) |

### Skill scoring (F3, 2026-11-05, 3 runs per question)

`moyai eval` has the same questions solved for each version of a Skill pack's Skill and grades them with code. The author of the version-2 draft is AI; only people save and promote (`eval/drafts/README.md`).

| Skill pack | Skill version | Questions | Graded | Pass rate | Spread (max − min of 3 runs) | Cost (USD) |
|---|---|---|---:|---:|---:|---:|
| Waste incineration | Version 1 (baseline, question set version 2) | All | 300 | 95.0% | 5.0% | 2.57 |
| Waste incineration | Version 2 draft (AI) | Test | 150 | 100% | 0% | 1.36 |
| Night-soil treatment | Version 1 (baseline, question set version 2) | All | 285 | 90.5% | 8.4% | 2.33 |
| Night-soil treatment | Version 2 draft (AI) | Test | 150 | 100% | 0% | 1.19 |

Both comparisons came out "no difference". Waste incineration went 96.0% → 100% on the test questions (a 4.0% difference, within the previous version's spread of 4.0%); night-soil treatment went 91.3% → 100% (8.7%, within a spread of 10.0%).

## Run and verify by hand

Steps for running without the chat. You need Node.js 22.13 or later, npm 11 or later, and Chrome or Edge.

```bash
git clone https://github.com/mushitaro/moyai
```

```bash
cd moyai
```

```bash
npm ci
```

```bash
npm run build
```

```bash
node dist/cli.js start
```

For Claude Code, the repository's `.mcp.json` registers `moyai` (`node dist/cli.js mcp`). The guard hook and deny rules (`.claude/settings.json`) also apply in the same folder. The hook runs on every Claude Code tool call. Claude Code first asks whether you trust this folder. For Claude Desktop, `node dist/cli.js setup --target desktop --name "<name>"` installs into a per-version folder and adds it to the settings; add `--dev` to point directly at a development clone.

```bash
node dist/cli.js verify demo-ring
```

Verifies the shared folder of 7 fictional sites (`demo-ring/`) with the same functions the receiving side uses. Exit code 0 when everyone is ✓ and the deliberately broken shared files are ✗ with reasons. No private keys are in the repository (`demo-ring/README.md`).

```bash
git clone https://github.com/mushitaro/moyai-ledger.git ../moyai-ledger
node dist/cli.js verify ledger ../moyai-ledger
```

Verifies the public ledger's rules and shared files (`ledger/` of mushitaro/moyai-ledger) with the same functions as the PR validation (Actions). Exit code 0 when everything is ✓.

At 15:04 JST on 2026-11-08, `1acbd6a` (`d483e36` plus README fixes) was built and run on this PC (Windows 11): `verify demo-ring` exited 0; `verify ledger ledger` (the ledger's location at the time) showed all 10 shared files ✓ (exit 0); `ledger site` wrote `index.html` with 10 ✓ and 0 ✗.

```bash
npm test
```

`npm test` runs node:test and vitest and prints the counts at the end. In a shallow clone (`git clone --depth`, or a container's default clone), tests that look at the freeze tags and history fail. Fetch history and tags first with `git fetch --unshallow origin && git fetch origin --tags` (`npm test` also tells you this for a shallow clone; tests are not skipped). `npm run acceptance` runs the tests and rebuilds `docs/acceptance.md`.

## Who keeps using it, and when

| Who | When | Where |
|---|---|---|
| Municipal maintenance officers | When reviewing the life-extension plan, compare the plant's cycles, person-days and days with similar plants nationwide. Leave the reasons for changing a cycle to successors in the version signatures and diffs | Public ledger |
| Maker-affiliated maintenance companies | Compare maintenance plans across the plants they built. Use similar plants' histories for O&M proposals and new plants' 10-year plans (no costs) | Company shared folder + public ledger |
| O&M operators | Before a tender, look at the median and quartiles of person-days and days for plants similar to the target | Public ledger + company shared folder |
| Study groups of officers in the same industry | Compare each other's cycles in a shared folder | Shared folder |
| Less experienced successors | Read why the previous officer set a cycle, from the version history and plan rules | The facility's version history |

## Where it spreads next (the facility map, A → H)

There are 2 Skill packs with content (waste incineration and night-soil treatment) and 35 with only names and candidate sources (`packs/`, `docs/industries.md`). A test (`pack.second`) checks that the commit adding the night-soil Skill pack has no change in `src/`, and that it runs from intake to the star chart. Night-soil treatment is thin (40 pieces of equipment, 292 works); its national table, public-ledger vocabulary and review are not implemented.

| Order | Group | Facilities |
|---|---|---|
| A | Municipal environment | Waste incineration (the starting point), night-soil treatment and sludge recycling centres, recycling facilities, transfer stations, final disposal sites, crematoria |
| B | Water | Sewerage, rural community sewerage, water supply, industrial water supply |
| C | Rivers and land | Drainage pump stations, floodgates and sluices; dam management equipment; coast, port and fishing-port facilities |
| D | Roads | Road bridges, tunnels, road ancillary structures, tunnel mechanical equipment, pavement |
| E | Public buildings and facilities | Building services of public buildings, park playground equipment |
| F | Energy | Thermal power, biomass and waste-to-energy power, substations, city gas plants, district heating and cooling, solar and wind |
| G | Industrial plants | Chemical, oil refining and petrochemical; steel; paper; food and pharmaceuticals; semiconductors and electronics |
| H | Transport and mobility | Railways, buses and trucks, ships, aircraft, elevators |

Nuclear power will not be built (name and reason only). It spreads first to facilities closest to A, where owners and contractors overlap. Rows for comparing across industries are the kinds of equipment (20 kinds such as pumps and fans, `packs/_kinds/`). Sources for B–H are candidates and have not been checked against primary documents (unchecked).

## Built during the event

### Period

- Event: 2026-11-02 12:00 to 11-10 14:00 JST (the Claude hackathon "Built with Claude: Japan 2026"). Submission deadline: 11-08 20:00 JST.
- This repository was created at 13:00 JST on 2026-11-03 (GitHub's `created_at` is 2026-11-03T04:00:06Z). The first commit `f830f16` is only the declaration README.
- Built by me alone with Claude Code.

### Previous products

I built two maintenance products before: [MX Stage](https://github.com/mxstage/mxstage) and [HOSHUTARO](https://github.com/woodygaragelab/hoshutaro) on top of it. MOYAI inherits their ideas but uses none of their code. The rule is not to read, clone, fetch, depend on or use as tools the previous products' repositories and distributions (`AGENTS.md`). The deny rules in `.claude/settings.json` and the guard hook (`scripts/guard-hook.mjs`) stop fetching them, and `scripts/check-publish.mjs` fails if the previous products' names appear in `src/`, `packs/`, `skills/` or `samples/`.

| Inherited idea (in words only) | Newly built during the event |
|---|---|
| AI proposes, people decide. Changes carry an author and a basis | 43 human-only routes (tab secrets and one-time tokens), 17 Claude tools (15 working; there are no tools to confirm or send), refusal tests (`human-only`) |
| Show on screen what AI reads and changes | Screens (MOYAI, HOSHITORI including the Export and Share sheets, Settings), the Decisions sheet, unconfirmed proposal stars |
| Don't fill in by guessing. Count a destination for every cell | Intake layers (Excel, CSV, PDF, photos), intake confirmations and unanswered items, yardsticks ①–⑥, the tools for unseen-format tests, the reading map |
| Code judges, AI explains | 7 waste incineration review checks (with sources and verification state), pure functions and tests |
| No database. Versions are only added | Versions and signatures (personal keys, facility signing keys), diffs, Excel export |
| Compare while keeping secrets | Linking to the common ledger, counting plants of the same class (from the national table), shared files that send cycles, person-days and days as classes, shared folders, the public ledger and PR validation, similar plants' star charts |
| Two tracks: Skills and code the screen runs | Three tiers of Skills (standard, industry Skill packs, rules made in conversation), 37 Skill packs, install/demo/uninstall from the chat, Skill scoring (`moyai eval`) |

### What existed before

- My career: 10 years at a waste incineration plant maker (5 as a maintenance engineer, 5 developing star-chart systems and migrating data), 3 years at an equipment maintenance software company (deployment and research), 3 years freelance.
- Public standards and statistics: Table II-4 of the Ministry of the Environment's guides (waste incineration and night-soil treatment editions), the plant tables of the General Waste Treatment Survey, and the text of laws on e-Gov. The original tables (with plant names) are not committed; only tables of extracted numbers are (`packs/*/sources.json`).
- Dependencies and fonts: versions are pinned and listed in `THIRD_PARTY_NOTICES.md`.
- Design documents I wrote (not in the repository).

### How to check

1. Server-side timestamps: `gh api repos/mushitaro/moyai --jq .created_at`, and the push and Actions history.
2. Screens of the first day: `docs/progress/shots/2026-11-03/` (with build date and commit shown).
3. Logs: daily from `docs/progress/2026-11-03.md`.
4. Test history: `docs/trend.md`, `ops/trend.jsonl`. API spend: `ops/api-spend.jsonl`.
5. Unseen formats: the hash commits precede publishing the contents (`samples/heldout/hashes/`, tags `reader-freeze-1` to `6`; `tests/heldout/heldout.test.ts` checks the order).
6. How Claude was used, and how sessions divided the work: `docs/how-built.md`.
7. The submitted version: tag `submission` and branch `hackathon-release` (the same commit; the version with this README).
8. Commits: 594 up to `d483e36` (11-03: 126, 11-04: 105, 11-05: 128, 11-06: 106, 11-07: 86, 11-08: 43. `git log --format=%ad --date=short | sort | uniq -c`).

## What cannot be guaranteed

### Sharing (`docs/plan.md` §2.8, `docs/sharing.md`)

1. Members of a shared folder can tell whose shared file it is.
2. Recipients can copy it.
3. Matching against knowledge outside the national table cannot be prevented.
4. Linking mistakes cannot be detected.
5. Whether the content is true cannot be shown.
6. Sharing services (OneDrive, GitHub, etc.) keep records of who placed a file, when, and its changes.
7. The fiscal years of a shared file are visible to the other side.
8. Something hidden by a sharing service's administrator can only be noticed later, from the signed chain of sequence numbers.
9. There is no differential privacy.
10. The route to the AI provider is separate (next section).
11. Processes of the same user on the same PC cannot be fully stopped.
12. Whether something may be shared (contracts, antitrust law, trade secrets) cannot be decided by the app.
13. Shared files on the public ledger can be opened by anyone, and the GitHub account name of a PR is public.
14. Whether the ledger repository's PR validation (`ledger-validate`) is a required check is unchecked (11-12). Whether to publish is decided by the administrator (me) by merging, after looking at the validation result and the shared file.

### What reaches the AI, and inside the PC (`docs/security.md`)

1. The per-call limit can be exceeded by calling repeatedly (there is a limit on the conversation total; the total resets when the bridge stops).
2. If you attach an Excel file to the chat, the whole file reaches the AI provider.
3. An AI that can read files can read the confirmed plan's files directly.
4. If Documents is under a sync folder (OneDrive, etc.), the confirmed plan goes up to the company cloud (checked and reported at every start).
5. "Nothing is sent out" is about the app's own communication, not a guarantee about where data ends up. As an exception, an installed MOYAI asks github.com, via git, whether mushitaro/moyai's main has a new version at start and every 6 hours (only the query is sent — no facility, rows, keys or settings. Setting "Check for updates" to "Don't check" stops all queries).
6. When reading photos, the image a person allowed reaches the AI provider.
7. AI tools that can operate the screen (browser or desktop control) can press the human-only buttons.
8. People and AI who can read the plan folder can copy the facility signing key (whoever copies it can send as that facility). If the storage is a sync folder, the facility signing key also goes up to the company cloud.
9. An AI with a shell can get past the guard hook (by writing and running scripts, `git apply`, `git reset`, etc.). The hook only looks at the text of tool calls.
10. If the facility signing key file is lost, its revocation cannot be signed, and together with a reissued key the same facility may be counted twice.
11. Cost values are hidden in Claude's samples only in the columns the intake recognised as cost columns. Values under other headings (such as "estimated amount", "budget", "unit price") may appear in samples.
12. The bridge cannot check that the `intake_add_files` folder is the one the user named in the chat. If the AI points to another folder (outside the state folder and the repository), the documents directly in it enter the screen and reach the AI as summary samples (the screen's activity list shows that the AI added documents). Network paths (`\\server\share`, `//server/share`) are refused (`7987f48`).
13. Shared files published to the public ledger cannot currently be withdrawn from the screen. Even when withdrawn, the published file does not disappear, and recipients' copies remain.

## Unfinished (as of 2026-11-11)

- The public ledger's intake (the route for people without a GitHub account; not deployed). The route for people with a GitHub account works (PR #8 in the Showcase).
- Total rows and rows without lines in process charts.
- Plan ○ and actual ● marks that split into different equipment rows (between documents that differ in how unit numbers are written and whether the parent equipment is present).
- Tables in report PDFs that wrap over many lines; one-equipment-per-page diagnosis cards.
- Moving the words for writing furnace numbers from tier-1 reader code to the tier-2 Skill pack.
- Waiting time at the step that places answers for large numbers of documents (216 seconds for the 86 documents of the fictional "Aobadai"; the screen does not freeze).
- Unseen formats: with the 11-05 reader, none of the 5 sets reached a plan (⑥ 0%). In the Skill pack yardstick, 4 of the 11 fictional facilities reached a plan (11-10).
- The acceptance test table (`docs/acceptance.md`) is as of 11-08.
- The rest of the time map: listing the history of decisions on the Decisions sheet in detail, a way to try out reasons Claude asked about in conversation, showing who changed what and why in the side panel, a way to choose versions to compare.
- The rest of splitting the public ledger into another repository: fixing the ledger repository's validation workflow and deploying the intake (`docs/ledger-split.md`, `docs/ledger-deploy.md`).
- Interviews with municipalities and a survey of existing material to show that comparison is hard today (`docs/impact.md` §4).
- The MCP tool `note_for_human` has only a name and types (calling it returns "not implemented"). `skill_eval` is not shown to Claude until the Skill scoring screen exists. Skill scoring is CLI-only (`moyai eval`).
- The local model (F4) is a concept only.
- The list to work on after judging: "To do after judging" at the end of `docs/progress/2026-11-08.md`.

## What comes after the event

- Accepting real facilities on the public ledger (only fictional ones during the event). An intake for staff who don't use GitHub (it only runs the same validation and opens a PR; no database).
- Integration with maintenance systems (via MCP).
- Other forms besides the star chart (process charts, daily work reports, work completion reports).
- Adding Skill pack content in the order A → H.
- Distribution formats (`.mcpb`, automatic updates) and reusing rules across facilities.
- Linking on a local model, without sending data out (F4).

## Mechanisms not used

- **Differential privacy and secure computation**: only values in fixed classes are sent; raw values never leave the PC. Adding noise would make the values unreadable as a basis for cycles, and secure computation would need the same mechanism on the municipalities' side too.
- **P2P**: the app has no networking of its own. Syncing shared folders is left to OneDrive, Syncthing, etc.
- **Consensus mechanisms (blockchain, etc.)**: each facility only adds to its own place, and the order is chained by signatures and the hash of the previous shared file. Whether something is published to the public ledger is decided by the administrator (a person) by merging the PR.

## Documents

Most documents are in Japanese.

- Rules: `AGENTS.md`. Plan: `docs/plan.md`. Logs: `docs/progress/`.
- Protection: `docs/security.md` (generated from the tool definitions). Sharing: `docs/sharing.md`. Industries: `docs/industries.md`. Screens: `docs/screens.md`. Words: `docs/words.md`. Data names: `docs/data-names.md`. Samples: `docs/samples.md`.

License: Apache-2.0
