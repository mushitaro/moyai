// 想定のプロンプトの試験（docs/progress/prompt-test-2026-11-07.md）で見つかった小さな穴を、橋渡し・ツール・Skill の文で直したもの（仕事 chat-prompts-v1）。
// 1. デモの混ざり（「デモして」）：利用者の資料（人が落とした・フォルダから入れた資料。【架空】とあっても）が入っている作業画面に、デモの資料を入れない
// 2. 開いた印（「立ち上げて」「画面を出して」）：intake_survey（show: true）の答えに screen { opened, connected }、つながっていなければ note に 1 文
// 3. 入っているかの確かめ（「MOYAIをインストールして」）：1 段目の Skill の「インストール」の頭の手順
// 4. reading_rules_propose の説明に、kind ごとのルールの形の見本（型に通る）
// 中継と橋渡しは本物、作業画面のタブはふり（作業画面の側の試験は IntakeWorkspace を直に使う）。施設名はどれも架空。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { addFilesFromBridge, runTabTool } from "../../src/app/intake/tab-tools";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { activeSkills } from "../../src/app/skills";
import { TEXT } from "../../src/app/text";
import { collectIntake, type IntakeCollection } from "../../src/bridge/intake-files";
import { resolvePacksDir } from "../../src/share/pack";
import { createRelayServer } from "../../src/cli/relay";
import { ReadingRule } from "../../src/import/reading";
import { fnv64 } from "../../src/plan/diff";
import { ERRORS } from "../../src/shared/errors";
import { encodeEvent } from "../../src/shared/events";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { CHAT_INSTALL_SECTION, skillMoyaiMarkdown } from "../../src/shared/skill-moyai";
import {
  DEMO_MIXED_NOTE,
  INTAKE_ADD_NOTE,
  READING_RULE_COMMON_EXAMPLE,
  READING_RULE_EXAMPLES,
  SCREEN_NOT_CONNECTED_NOTE,
  TOOLS,
  readingRuleExamplesText,
} from "../../src/shared/tools";
import { FakeTab, SECRET_A, SECRET_B, startTestBridge, type TestBridge } from "../helpers/bridge";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const PACKS = resolvePacksDir();
const DEMO_FILES = ["daily-report.csv", "equipment-ledger.xlsx", "plan-hoshitori.xlsx"];
const SHORT = { read: 2000, propose: 2000, start: 2000 };

/** 中継（本物）を MCP のクライアントでつなぐ */
async function relayClient(tb: TestBridge): Promise<Client> {
  const server = createRelayServer({ stateDir: tb.stateDir });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), c.connect(b)]);
  cleanups.push(() => c.close());
  await c.listTools();
  return c;
}

type Call = { requestId: string; name: string; args: any };

/** つながったタブのふり。answer の答えを返す（null なら答えない） */
async function fakeTab(tb: TestBridge, secret: string, answer: (call: Call) => Promise<unknown> | unknown): Promise<{ calls: Call[]; tab: FakeTab }> {
  const tab = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
  await tab.opened;
  tab.send("tab.hello", { secret, build: "test" });
  await tab.next("bridge.welcome");
  cleanups.push(() => tab.ws.close());
  const calls: Call[] = [];
  tab.ws.on("message", (raw) => {
    const ev = JSON.parse(raw.toString("utf8"));
    if (ev.type !== "bridge.tool_call") return;
    calls.push(ev.data);
    void Promise.resolve(answer(ev.data)).then((result) => {
      if (result !== null) tab.ws.send(encodeEvent("tab.tool_result", { requestId: ev.data.requestId, result: result as never }));
    });
  });
  return { calls, tab };
}

// ─── 1. デモの混ざり ─────────────────────────────────────────────

/** デモの資料を、橋渡しが渡すのと同じ形で（中身は packs/ の demo/ から読む） */
function demoArgs() {
  const c = collectIntake({ source: "demo", pack: "waste-incineration" }, { packsDir: PACKS, stateDir: null, repoRoot: join(PACKS, "..") }) as IntakeCollection;
  const byId = new Map<string, string>();
  const files = c.files.map((f, i) => {
    const fileId = `${"d".repeat(21)}${i}`;
    byId.set(fileId, f.path);
    return { fileId, name: f.name, size: f.size };
  });
  const fetch = async (id: string) => (byId.has(id) ? new Uint8Array(readFileSync(byId.get(id)!)) : null);
  return { args: { source: "demo", pack: c.pack, facilityName: c.facilityName, files }, fetch };
}

/** 利用者がフォルダで入れた資料のふり（【架空】とある CSV。試験の資料はどれも架空なので、利用者の資料も【架空】） */
const USER_CSV = new TextEncoder().encode("日付,作業,機器\n2024-04-01,【架空】点検,【架空】送水ポンプ\n2024-05-01,【架空】交換,【架空】送水ポンプ\n");
const userArgs = (name = "north-daily.csv") => ({
  source: "folder",
  pack: "waste-incineration",
  facilityName: "【架空】北の試験",
  files: [{ fileId: "u".repeat(22), name, size: USER_CSV.length }],
});

const allMixed = (names: string[]) => ({ ok: true, data: { added: [], refused: names.map((name) => ({ name, reason: "mixed" })) } });

describe("デモの混ざり：作業画面の側", () => {
  it("【架空】とある利用者の資料が入っていても（作業画面は架空になる）、デモの資料を入れずに、どれも mixed で断る", async () => {
    const ws = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    const first = await addFilesFromBridge(ws, userArgs(), async () => USER_CSV);
    if (!first.ok) throw new Error(first.code);
    expect(first.data.added).toEqual([expect.objectContaining({ name: "north-daily.csv" })]);
    // 【架空】とあるので、作業画面は架空になる（前は、これでデモの資料が横に入った。想定のプロンプトの試験の 5）
    expect(ws.settings.fictional).toBe(true);
    const { args, fetch } = demoArgs();
    expect(await addFilesFromBridge(ws, args, fetch)).toEqual(allMixed(DEMO_FILES));
    expect(ws.fileCount).toBe(1);
    expect(ws.fileNames).toEqual(["north-daily.csv"]);
    expect(ws.settings.facilityName).toBe("【架空】北の試験");
    expect(ws.notices.some((n) => n.kind === "ai" && n.text === TEXT.intake.ai.demoMixed)).toBe(true);
  });

  it("読込の途中の資料があれば（名前がまだ分からない）、デモの資料を入れない", async () => {
    const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】北の試験", fiscalYearStartMonth: 4, fictional: true });
    const reading = ws.addFiles([{ name: "north-daily.csv", size: USER_CSV.length, bytes: async () => USER_CSV }]);
    const { args, fetch } = demoArgs();
    expect(await addFilesFromBridge(ws, args, fetch)).toEqual(allMixed(DEMO_FILES));
    await reading;
    expect(ws.fileNames).toEqual(["north-daily.csv"]);
  });

  it("資料の名前がデモの資料と同じでも、人が落とした資料は利用者の資料（ほかの架空の施設の資料と名前が重なる。fictional-2 の equipment-ledger.xlsx）", async () => {
    const ws = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    const other = new Uint8Array(readFileSync("samples/out/waste-incineration/fictional-2/equipment-ledger.xlsx"));
    await ws.addFiles([{ name: "equipment-ledger.xlsx", size: other.length, bytes: async () => other }]);
    // 画面が人の落とした資料に【架空】とあるのを見て架空にするのと同じ（pages/Merge.tsx）
    await ws.fresh();
    expect(ws.sourcesMarkedFictional()).toBe(true);
    ws.setFacility({ fictional: true });
    const { args, fetch } = demoArgs();
    expect(args.files.map((f) => f.name)).toContain("equipment-ledger.xlsx");
    // 名前で見ると、デモの資料の 2 つ（日報と星取表）がこの施設の台帳の横に入ってしまう。入れたのが人なので、どれも断る
    expect(await addFilesFromBridge(ws, args, fetch)).toEqual(allMixed(DEMO_FILES));
    expect(ws.fileNames).toEqual(["equipment-ledger.xlsx"]);
    expect(ws.userFileNames).toEqual(["equipment-ledger.xlsx"]);
  });

  it("デモのあとにデモの資料を入れても mixed にはならない（同じ名前の断り）。ほかの Skillパックは今どおり誤りで返す", async () => {
    const ws = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    const { args, fetch } = demoArgs();
    expect((await addFilesFromBridge(ws, args, fetch)).ok).toBe(true);
    // デモで入れた資料は利用者の資料に数えない
    expect(ws.fileCount).toBe(3);
    expect(ws.userFileNames).toEqual([]);
    const again = await addFilesFromBridge(ws, args, fetch);
    if (!again.ok) throw new Error(again.code);
    expect((again.data.refused as { reason: string }[]).map((x) => x.reason)).toEqual(["same_name", "same_name", "same_name"]);
    const other = new IntakeWorkspace({ packId: "night-soil", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    expect(await addFilesFromBridge(other, args, fetch)).toEqual({ ok: false, code: "intake_demo_mixed" });
  });

  it("版から戻した資料は利用者の資料（デモで入れた印は消える）", async () => {
    const ws = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    const { args, fetch } = demoArgs();
    expect((await addFilesFromBridge(ws, args, fetch)).ok).toBe(true);
    const one = args.files[0]!;
    await ws.restoreVersion(1, [{ name: one.name, bytes: (await fetch(one.fileId))! }], []);
    expect(ws.userFileNames).toEqual([one.name]);
    expect(await addFilesFromBridge(ws, args, fetch)).toEqual(allMixed(DEMO_FILES));
  });
});

describe("デモの混ざり：中継 → 橋渡し → 作業画面", () => {
  async function chain(answer: (call: Call) => unknown) {
    const tb = await startTestBridge({ toolTimeouts: SHORT });
    cleanups.push(() => tb.close());
    const { calls } = await fakeTab(tb, SECRET_A, answer);
    return { tb, calls, client: await relayClient(tb) };
  }
  const names = (call: Call) => call.args.files.map((f: { name: string }) => f.name) as string[];

  it("作業画面が mixed で断ったら、AI には added が空・refused がどれも mixed・note に次の手（混ぜない。空の作業画面で始める）を返す", async () => {
    const { client, tb } = await chain((call) => allMixed(names(call)));
    const r: any = await client.callTool({ name: "intake_add_files", arguments: { source: "demo" } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ source: "demo", pack: "waste-incineration", added: [], refusedTotal: 3, others: 0, note: DEMO_MIXED_NOTE });
    expect(r.structuredContent.refused).toEqual(DEMO_FILES.map((name) => ({ name, reason: "mixed" })));
    expect(DEMO_MIXED_NOTE).toContain("利用者の資料と架空の資料を混ぜない");
    expect(TOOLS.intake_add_files.output.safeParse(r.structuredContent).success).toBe(true);
    expect(tb.bridge.tools.stagedCount()).toBe(0);
  });

  it("mixed は demo で、渡した資料をどれも断ったときだけ。folder の答えに付いていたら・入れたものと混ざっていたら型違い", async () => {
    let answer: (call: Call) => unknown = (call) => allMixed(names(call));
    const { client } = await chain((call) => answer(call));
    const dir = mkdtempSync(join(tmpdir(), "moyai-chat-prompts-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "a.csv"), "日付,作業\n");
    // folder：作業画面が mixed を返すことは無い
    const f: any = await client.callTool({ name: "intake_add_files", arguments: { source: "folder", path: dir } });
    expect(f.isError).toBe(true);
    expect(f.content[0].text).toBe(ERRORS.tab_bad_result.text);
    // demo：入れたものと mixed が混ざっている
    answer = (call) => ({ ok: true, data: { added: [{ name: names(call)[0], sheets: 1, rows: 1 }], refused: names(call).slice(1).map((name) => ({ name, reason: "mixed" })) } });
    const d: any = await client.callTool({ name: "intake_add_files", arguments: { source: "demo" } });
    expect(d.isError).toBe(true);
    expect(d.content[0].text).toBe(ERRORS.tab_bad_result.text);
    // ふつうに入れたときの note は今どおり
    answer = (call) => ({ ok: true, data: { added: names(call).map((name) => ({ name, sheets: 1, rows: 1 })), refused: [] } });
    const ok: any = await client.callTool({ name: "intake_add_files", arguments: { source: "demo" } });
    expect(ok.structuredContent.note).toBe(INTAKE_ADD_NOTE);
  });
});

// ─── 2. 開いた印 ─────────────────────────────────────────────────

const SURVEY = (who: string) => ({
  files: [],
  samples: [],
  legends: [],
  notes: [who],
  questions: [],
  unresolvedCells: 0,
  stuck: [],
  compose: { state: "idle", message: null },
  crosswalk: null,
});

/**
 * 橋渡し（本物）。open：開く手が新しいタブを開いてつなぐ（new_tab）・開くが何もつながらない（nothing）・開く手が無い（null）。
 * 開いたタブは SECRET_B で握手し、前のタブを引き継ぐ。どのタブが答えたかは survey の notes で分かる
 */
async function showBridge(open: "new_tab" | "nothing" | null) {
  const opened: string[] = [];
  let tb: TestBridge | null = null;
  // 時計をずらすと、つながっているタブが眠った（ping に答えない）ことになる
  let skew = 0;
  const openUrl = (url: string) => {
    opened.push(url);
    if (open === "new_tab") setTimeout(() => void fakeTab(tb!, SECRET_B, () => ({ ok: true, data: SURVEY("new") })), 50);
  };
  tb = await startTestBridge({ toolTimeouts: SHORT, screenOpenWaitMs: 1500, now: () => Date.now() + skew, ...(open ? { openUrl } : {}) });
  cleanups.push(() => tb!.close());
  return { tb, opened, client: await relayClient(tb), sleep: () => (skew = 60_000) };
}

describe("開いた印：intake_survey（show: true）", () => {
  it("つながって返事をしているタブがあれば、新しいタブを開かない（前のタブの資料と下書きのルールが消えない。11-08）", async () => {
    const { tb, opened, client } = await showBridge("new_tab");
    await fakeTab(tb, SECRET_A, () => ({ ok: true, data: SURVEY("old") }));
    const r: any = await client.callTool({ name: "intake_survey", arguments: { show: true } });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(r.structuredContent.screen).toEqual({ opened: false, connected: true });
    expect(r.structuredContent.notes).toEqual(["old"]);
    expect(opened).toEqual([]);
  });

  it("眠ったタブ（ping に答えない）のとき、橋渡しが開いた新しいタブが引き継いだ：screen は opened・connected とも true、note は無い。開くのは 1 回", async () => {
    const { tb, opened, client, sleep } = await showBridge("new_tab");
    await fakeTab(tb, SECRET_A, () => ({ ok: true, data: SURVEY("old") }));
    sleep();
    const r: any = await client.callTool({ name: "intake_survey", arguments: { show: true } });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(r.structuredContent.screen).toEqual({ opened: true, connected: true });
    expect(r.structuredContent.notes).toEqual(["new"]);
    expect("note" in r.structuredContent).toBe(false);
    expect(opened).toEqual([`${tb.origin}/`]);
    expect(TOOLS.intake_survey.output.safeParse(r.structuredContent).success).toBe(true);
  });

  it("眠ったタブのとき、開いたのに新しいタブがつながらない（前のタブが答えた）：connected は false で、note に利用者に言う 1 文", async () => {
    const { tb, opened, client, sleep } = await showBridge("nothing");
    await fakeTab(tb, SECRET_A, () => ({ ok: true, data: SURVEY("old") }));
    sleep();
    const r: any = await client.callTool({ name: "intake_survey", arguments: { show: true, part: "skills" } });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(r.structuredContent.screen).toEqual({ opened: true, connected: false });
    expect(r.structuredContent.note).toBe(SCREEN_NOT_CONNECTED_NOTE);
    expect(SCREEN_NOT_CONNECTED_NOTE).toBe("作業画面がまだつながっていません。開いたタブを見てください。");
    expect(r.structuredContent.notes).toEqual(["old"]);
    expect(opened).toHaveLength(1);
  });

  it("開く手が無い橋渡し（試験・MOYAI_NO_AUTO_OPEN）で、タブがつながっている：opened は false、connected は true", async () => {
    const { tb, client } = await showBridge(null);
    await fakeTab(tb, SECRET_A, () => ({ ok: true, data: SURVEY("old") }));
    const r: any = await client.callTool({ name: "intake_survey", arguments: { show: true } });
    expect(r.structuredContent.screen).toEqual({ opened: false, connected: true });
    expect("note" in r.structuredContent).toBe(false);
  });

  it("開いたのにタブが 1 つもつながらない：誤り「まだつながっていません」（利用者に言う 1 文と作業画面の URL を添える）。もう 1 つは開かない", async () => {
    const { tb, opened, client } = await showBridge("nothing");
    const r: any = await client.callTool({ name: "intake_survey", arguments: { show: true } });
    expect(r.isError).toBe(true);
    expect(r.content[0]).toEqual({ type: "text", text: ERRORS.work_screen_not_connected.text });
    expect(ERRORS.work_screen_not_connected.text).toContain(SCREEN_NOT_CONNECTED_NOTE);
    expect(r.content.slice(1).some((x: any) => x.type === "text" && JSON.parse(x.text).workScreenUrl === `${tb.origin}/`)).toBe(true);
    expect(opened).toHaveLength(1);
  });

  it("show が無ければ screen と note は付けない（作業画面の答えに付いていても捨てる）", async () => {
    const { tb, opened, client } = await showBridge("new_tab");
    await fakeTab(tb, SECRET_A, () => ({ ok: true, data: { ...SURVEY("old"), screen: { opened: true, connected: true }, note: "作業画面の字" } }));
    const r: any = await client.callTool({ name: "intake_survey", arguments: {} });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect("screen" in r.structuredContent).toBe(false);
    expect("note" in r.structuredContent).toBe(false);
    expect(opened).toEqual([]);
  });

  it("ツールの説明に、screen の読み方と、つながっていなければ note を利用者に言うことを書く", () => {
    const d = TOOLS.intake_survey.description;
    expect(d).toContain("screen");
    expect(d).toContain("connected が false なら、note の 1 文を利用者に言う");
  });
});

// ─── 3. 入っているかの確かめ ──────────────────────────────────────

describe("入っているかの確かめ：1 段目の Skill", () => {
  const CHECK = "もう入っているか：moyai のツールが呼べれば、入れ直さず、下の「最新にする」の手順で進める";

  it("「インストール」の手順の頭（手順 1 の前）に、もう入っているかの確かめがある。題は「MOYAI をインストールして」にも当たる", () => {
    const s = CHAT_INSTALL_SECTION;
    const head = s.indexOf("### インストール");
    const check = s.indexOf(CHECK, head);
    const step1 = s.indexOf("1. `node --version`", head);
    expect(head).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThan(head);
    expect(check).toBeLessThan(step1);
    expect(s.slice(head, s.indexOf("\n", head))).toContain("「MOYAI をインストールして」");
    // Skill のファイル（MOYAI_WRITE_DOCS=1 で作り直したもの）にも同じ文がある
    const file = readFileSync("skills/moyai/SKILL.md", "utf8").replace(/\r\n/g, "\n");
    expect(file).toContain(CHECK);
    // instructions（4,096 字で切れる）には足していない
    expect(MCP_INSTRUCTIONS).not.toContain(CHECK);
    expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });

  it("「最新にする」の節（#43）：版はビルドの版で見て、moyai update を --yes なしで先に走らせ、開き直しは出たときだけ頼む", () => {
    const s = CHAT_INSTALL_SECTION;
    const sec = s.slice(s.indexOf("### 最新にする"), s.indexOf("### デモ"));
    expect(sec).toContain("「MOYAI を最新にして」");
    expect(sec).toContain("`node dist/cli.js update` を `--yes` なしで走らせる");
    expect(sec).toContain("「開き直してください」と出たときだけ");
    expect(sec).not.toContain("SKILL.md");
    // 入っている MOYAI（#65）：moyai_update の check を先に読み、prepare は利用者の「はい」のあと。切り替えは次の起動
    expect(sec).toContain("moyai_update（action: check）を呼ぶ");
    expect(sec).toContain("「はい」をもらったら moyai_update（action: prepare）");
    expect(sec).toContain("切り替えは次の起動");
  });

  it("「本文がリポジトリの skills/moyai/SKILL.md と同じなら新しい版」は本当：part: skills の 1 段目の本文はそのファイルと同じで、版は本文から決まる", () => {
    const file = readFileSync("skills/moyai/SKILL.md", "utf8").replace(/\r\n/g, "\n");
    const tier1 = activeSkills(null, []).find((s) => s.tier === 1)!;
    expect(tier1.text).toBe(file);
    expect(tier1.version).toBe(fnv64(file));
    expect(skillMoyaiMarkdown()).toBe(file);
  });

  it("デモの節に、利用者の資料とは混ぜない（refused の mixed と note）ことを書く", () => {
    const demo = CHAT_INSTALL_SECTION.slice(CHAT_INSTALL_SECTION.indexOf("### デモ"), CHAT_INSTALL_SECTION.indexOf("### 利用者の資料"));
    expect(demo).toContain("架空でない資料とは混ぜない");
    expect(demo).toContain("mixed");
    expect(TOOLS.intake_add_files.description).toContain("refused（理由 mixed）");
  });
});

// ─── 4. ルールの形の見本 ───────────────────────────────────────────

describe("reading_rules_propose の説明：kind ごとのルールの形の見本", () => {
  const kinds = ReadingRule.options.map((o) => o.shape.kind.value);
  /** ( ) の値（ほかの答えから写すもの）のうち、形の決まった欄に、Skillパックにあるコードを入れる */
  const code = (JSON.parse(readFileSync("packs/waste-incineration/common.json", "utf8")) as { systems: { code: string }[] }).systems[0]!.code;
  const filled = (k: string, i: number) => {
    const fields: Record<string, unknown> = { ...READING_RULE_EXAMPLES[k as keyof typeof READING_RULE_EXAMPLES] };
    if (k === "planCycle") fields.commonItem = code;
    return { ...READING_RULE_COMMON_EXAMPLE, id: `r${i + 1}`, kind: k, ...fields };
  };

  it("kind ごとに 1 つずつ見本があり、共通の欄を足すと型に通る。全部の欄の例もそのまま型に通る", () => {
    expect(Object.keys(READING_RULE_EXAMPLES).sort()).toEqual([...kinds].sort());
    kinds.forEach((k, i) => expect(ReadingRule.safeParse(filled(k, i)).success, k).toBe(true));
    const text = readingRuleExamplesText();
    const full = /全部の欄の例 (\{.*\})。kind ごと/.exec(text)?.[1];
    expect(ReadingRule.safeParse(JSON.parse(full!)).success).toBe(true);
  });

  it("説明に見本の文があり、kind の名前と欄がどれも出る。instructions は 4,096 字の内", () => {
    const d = TOOLS.reading_rules_propose.description;
    expect(d).toContain(readingRuleExamplesText());
    for (const k of kinds) expect(d, k).toContain(`${k} ${JSON.stringify(READING_RULE_EXAMPLES[k])}`);
    expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });

  it("見本どおりのルールを作業画面に置ける（作業画面が読み直し、ルールごとの数を返す）", () => {
    const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】見本の試験", fiscalYearStartMonth: 4, fictional: true });
    const rules = kinds.map((k, i) => filled(k, i));
    const r = runTabTool(ws, "reading_rules_propose", { name: "【架空】見本の読み方", scope: "facility", rules }, { conversation: "c", rowsRemaining: 2000 });
    if (!r.ok) throw new Error(r.code);
    expect((r.data.rules as { id: string }[]).map((x) => x.id)).toEqual(rules.map((x) => x.id));
    expect(TOOLS.reading_rules_propose.output.safeParse(r.data).success).toBe(true);
  });
});
