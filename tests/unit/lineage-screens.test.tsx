// 古い版の署名と適用 Skill、古い版のルールのシート、ルールの詳細の適用先（docs/screens.md 3.2、Wire、11-07 夜。動画 C14。仕事 lineage-screens-v1）。
// - 古い版を開くと、横の板の「署名 n」はその版の署名と、その版の記録の適用 Skill（いちばん新しい版のものは出さない）
// - 記録の無い版は「適用 Skill の記録なし」「適用ルールの記録なし」
// - 古い版のルールのシートは見るだけ（「第 n 版で適用」。切り替え「下書き n ／ 全件 n」と操作のボタンを置かない）
// - 適用先は MOYAI が読める版（保管先の版の記録）だけを新しい順に並べ、読めない施設は数えない
// - 署名される字と版の記録の形は変えない（版の記録の readingSkills を読むだけ）
// 施設・人・ルールの名前はすべて架空。画面は react-dom/server で描く（試験は node で走る）。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readingLineage, recordedReadings, registerReading, type AppliedVersion, type ReadingPlace } from "../../src/bridge/readings";
import { READING_SCHEMA, type ReadingSkill } from "../../src/import/reading";
import { commitPlan, readHistory, readPlanVersion } from "../../src/plan/store";
import { contentHash } from "../../src/plan/signature";
import { writeTurn, TURN_SCHEMA } from "../../src/plan/turn";
import { ReadingsSheet, RuleLineageDetail } from "../../src/app/components/ReadingsSheet";
import { SignaturesPanel, type PanelVersion } from "../../src/app/components/SignaturesPanel";
import type { IntakeWorkspace } from "../../src/app/intake/workspace";
import { appliedTo, placeFor, placeOf, ruleVersionNo, ruleVersions, signaturesVersion, type Lineage, type LineageVersion } from "../../src/app/state/rule-lineage";
import { HUMAN_TEXT } from "../../src/app/text";
import { SIGNER, otherSigner } from "../helpers/signer";
import { asset, detail, plan, work } from "./share/fixtures";

const render = (node: ReactNode) => renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);
const text = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const RULE = "【架空】みどり台の取り込み";
const skill = (n: number): ReadingSkill => ({
  schema: READING_SCHEMA,
  name: RULE,
  scope: "company",
  rules: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, text: `${i + 1} 行目を見出しとして読む`, kind: "headerRow" as const, row: i + 1, author: "ai" as const, reason: "会話で決めた" })),
});
const basePlan = () => plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "INSPECT", ["a1"])], details: [detail("d1", "w1", 2020)] });

/** 画面の部品が読む、ブラウザにだけあるもの（場所の hash と、橋渡しへの WebSocket。つながない） */
const saved = { location: (globalThis as { location?: unknown }).location, WebSocket: (globalThis as { WebSocket?: unknown }).WebSocket };
class NoSocket {
  addEventListener(): void {}
  send(): void {}
  close(): void {}
}
const at = (hash: string) => ((globalThis as { location?: unknown }).location = { hash, search: "", protocol: "http:", host: "127.0.0.1:1" });

let root = "";
let lineage: Lineage = { places: [], applied: [] };
let v1Ref = { name: RULE, path: "", version: "" };
let v2Ref = { name: RULE, path: "", version: "" };

beforeAll(async () => {
  (globalThis as { WebSocket?: unknown }).WebSocket = NoSocket;
  at("#/merge/readings");
  root = mkdtempSync(join(tmpdir(), "moyai-lineage-"));
  // ルールの v1（決まり 1 つ）で、みどり台の第 1 版（2026-05）
  const r1 = await registerReading(root, skill(1), null, null);
  if (!r1.ok) throw new Error(r1.reason);
  v1Ref = { name: RULE, path: r1.path, version: r1.version };
  const a = { ...basePlan(), planId: "plan-midoridai", displayName: "【架空】みどり台クリーンセンター" };
  const a1 = await commitPlan({ root, plan: a, reason: "確定", acceptances: [], basedOn: null, signer: SIGNER, client: "t", readingSkills: [v1Ref], now: new Date("2026-05-12T01:00:00Z") });
  if (!a1.ok) throw new Error(a1.reason);
  // ルールの v2（決まり 2 つ）で、みどり台の第 2 版（2026-09）
  const r2 = await registerReading(root, skill(2), null, null);
  if (!r2.ok) throw new Error(r2.reason);
  v2Ref = { name: RULE, path: r2.path, version: r2.version };
  const a2 = await commitPlan({ root, plan: a1.record.plan, reason: "2 版目", acceptances: [], basedOn: 1, signer: SIGNER, client: "t", readingSkills: [v2Ref], now: new Date("2026-09-03T02:00:00Z") });
  if (!a2.ok) throw new Error(a2.reason);
  // みどり台の第 3 版はルールを使っていない（版の記録に readingSkills が無い）
  const a3 = await commitPlan({ root, plan: a2.record.plan, reason: "3 版目", acceptances: [], basedOn: 2, signer: SIGNER, client: "t", now: new Date("2026-10-20T02:00:00Z") });
  if (!a3.ok) throw new Error(a3.reason);
  // しらかば野の第 1 版は v2 で、編集を頼んで渡したまま（編集中）
  const b = { ...basePlan(), planId: "plan-shirakabano", displayName: "【架空】しらかば野清掃センター" };
  const b1 = await commitPlan({ root, plan: b, reason: "渡す", acceptances: [], basedOn: null, signer: otherSigner("【架空】佐藤"), role: "edit", client: "t", readingSkills: [v2Ref], now: new Date("2026-10-01T03:00:00Z") });
  if (!b1.ok) throw new Error(b1.reason);
  await writeTurn(root, { schema: TURN_SCHEMA, planId: "plan-shirakabano", version: 1, state: "editing", holder: null, to: "edit@example.invalid", from: "【架空】佐藤", note: "", at: "2026-10-01T03:00:00Z" });
  // 読めない施設：版のファイルが壊れている（数えない。「ほか n」とも言わない）
  mkdirSync(join(root, "plans", "plan-kowareta", "versions"), { recursive: true });
  writeFileSync(join(root, "plans", "plan-kowareta", "versions", "000001.json"), "{ not json");
  lineage = (await readingLineage(root)) as { places: ReadingPlace[]; applied: AppliedVersion[] };
});
afterAll(() => {
  (globalThis as { location?: unknown }).location = saved.location;
  (globalThis as { WebSocket?: unknown }).WebSocket = saved.WebSocket;
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("版の記録を読むだけ（形は変えない）", () => {
  it("版の一覧に、その版の記録の読み方。記録の無い版は null。版の記録のファイルには何も足さない", async () => {
    const before = readFileSync(join(root, "plans", "plan-midoridai", "versions", "000001.json"), "utf8");
    const h = await readHistory(root, "plan-midoridai");
    expect(h.versions.map((v) => v.readingSkills?.map((x) => x.version) ?? null)).toEqual([[v1Ref.version], [v2Ref.version], null]);
    // 読んでも版の記録は書き換わらず、中身のハッシュも合う
    expect(readFileSync(join(root, "plans", "plan-midoridai", "versions", "000001.json"), "utf8")).toBe(before);
    expect(h.versions.every((v) => v.problem === null)).toBe(true);
    const r = await readPlanVersion(root, "plan-midoridai", 1);
    expect(r.ok && contentHash(r.record)).toBe(h.versions[0]!.contentHash);
  });

  it("古い版の記録の読み方を、保管先の中身（versions/ に残した前の版も）と照らす。見つからなければ中身は null", async () => {
    const got = await recordedReadings(root, [v1Ref, v2Ref, { name: "【架空】消えたルール", path: "skills/会社/【架空】消えたルール", version: "0".repeat(64) }]);
    expect(got.map((x) => [x.name, x.scope, x.skill?.rules.length ?? null])).toEqual([
      [RULE, "company", 1],
      [RULE, "company", 2],
      ["【架空】消えたルール", null, null],
    ]);
  });
});

describe("ルールの詳細の適用先（MOYAI が読める版だけ、新しい順）", () => {
  it("読めない施設は数えない。確かめで合う版で、読み方を載せた版だけ", () => {
    expect(lineage.applied.map((v) => `${v.planId}#${v.version}`).sort()).toEqual(["plan-midoridai#1", "plan-midoridai#2", "plan-shirakabano#1"]);
    expect(lineage.applied.some((v) => v.planId === "plan-kowareta")).toBe(false);
    expect(lineage.places.map((p) => [p.path, p.scope])).toEqual([[v1Ref.path, "company"]]);
  });

  it("適用先が 2 以上なら新しい順。ルールの版は初めて載せた順に v1・v2", () => {
    const place = placeOf(v2Ref.path);
    const rows = appliedTo(lineage, place);
    expect(rows.map(({ v, ruleNo }) => [v.planId, v.version, ruleNo])).toEqual([
      ["plan-shirakabano", 1, 2],
      ["plan-midoridai", 2, 2],
      ["plan-midoridai", 1, 1],
    ]);
    expect(ruleVersions(lineage, place).map((x) => [x.n, x.version])).toEqual([
      [1, v1Ref.version],
      [2, v2Ref.version],
    ]);
    expect(ruleVersionNo(lineage, place, v2Ref.version)).toBe(2);
    // 版の記録に載せていない版（下書き）は数えない
    expect(ruleVersionNo(lineage, place, "f".repeat(64))).toBeNull();
    // 編集を頼んで渡したままの版は「編集中」、確定した版は署名の時刻
    expect(rows[0]!.v.held).toBe("editing");
    expect(rows[1]!.v.held).toBeNull();
    expect(rows[1]!.v.signedAt).toBe("2026-09-03T02:00:00.000Z");
  });

  it("詳細：名前と版、範囲、置き場、「適用先 n」と版の行（新しい順・開ける版だけ「| 開く」）、ルールの版ごとの行", () => {
    const html = render(<RuleLineageDetail name={RULE} scope="company" place={placeOf(v2Ref.path)} stored version={v2Ref.version} lineage={lineage} />);
    const t = text(html);
    expect(t).toContain(`${RULE}v2`);
    expect(t).toContain("範囲会社");
    expect(t).toContain("置き場保存先");
    expect(t).toContain("適用先 3");
    const rows = [...html.matchAll(/data-testid="rule-applied" data-plan="([^"]+)" data-version="(\d+)"/g)].map((m) => `${m[1]}#${m[2]}`);
    expect(rows).toEqual(["plan-shirakabano#1", "plan-midoridai#2", "plan-midoridai#1"]);
    expect(t).toMatch(/【架空】しらかば野清掃センター　第 1 版　編集中　v2開く/);
    expect(t).toMatch(/【架空】みどり台クリーンセンター　令和 8 年度版（第 2 版）　v2開く/);
    expect(t).toMatch(/【架空】みどり台クリーンセンター　令和 8 年度版（第 1 版）　v1開く/);
    expect(html).toContain(`href="#/merge?open=plan-midoridai&amp;v=1&amp;h=`);
    // ルールの版ごとの行（月は日本時間）
    expect([...html.matchAll(/data-testid="rule-version" data-n="(\d+)"/g)].map((m) => m[1])).toEqual(["1", "2"]);
    expect(t).toContain("v1　2026-05");
    expect(t).toContain("v2　2026-09");
    // 読めない施設は出さず、「ほか n」とも言わない
    expect(t).not.toContain("plan-kowareta");
    expect(t).not.toMatch(/ほか \d/);
  });

  it("開ける版だけ「| 開く」。下書き（保管先にまだ無い）は置き場と版を出さない", () => {
    const one = lineage.applied.find((v) => v.planId === "plan-midoridai" && v.version === 1)!;
    const closed: LineageVersion = { ...one, planId: "plan-hokano", openable: false };
    const l: Lineage = { places: lineage.places, applied: [...lineage.applied, closed] };
    const html = render(<RuleLineageDetail name={RULE} scope="company" place={placeOf(v1Ref.path)} stored version={v1Ref.version} lineage={l} />);
    expect((html.match(/data-testid="rule-applied"/g) ?? []).length).toBe(4);
    expect((html.match(/data-testid="rule-applied-open"/g) ?? []).length).toBe(3);
    const draft = render(<RuleLineageDetail name="【架空】まだ置いていない" scope="facility" place={null} stored={false} version={null} lineage={lineage} />);
    expect(text(draft)).not.toContain("置き場");
    expect(text(draft)).not.toMatch(/v\d/);
    // 下書きの置き場所は、同じ名前・範囲の置き場所（施設の範囲は今の施設のもの）
    expect(placeFor(lineage, { name: RULE, scope: "company", path: null }, null)).toBe(v1Ref.path);
    expect(placeFor(lineage, { name: RULE, scope: "facility", path: null }, "fac-x")).toBeNull();
    expect(placeFor(lineage, { name: RULE, scope: "company", path: `${v1Ref.path}/versions/${v1Ref.version}` }, null)).toBe(v1Ref.path);
  });
});

const sig = (role: string, by: string, at: string, trust: string) => ({ role: role as "confirm", by, pub: "a".repeat(64), fingerprint: "ABCD EFGH IJKL MNOP", trust: trust as "confirmed", previous: null, at });
const versionOf = (version: number, signatures: ReturnType<typeof sig>[]): PanelVersion => ({ version, contentHash: "1".repeat(64), problem: null, legacy: false, signatures });

describe("古い版の署名と適用 Skill", () => {
  const versions = [
    versionOf(4, [sig("confirm", "【架空】田中", "2026-04-01T01:00:00Z", "confirmed")]),
    versionOf(5, [sig("confirm", "【架空】山田", "2026-06-12T05:20:00Z", "confirmed"), sig("approve", "【架空】佐藤", "2026-06-13T00:10:00Z", "confirmed")]),
    versionOf(6, [sig("confirm", "【架空】最新の人", "2026-10-01T00:00:00Z", "own")]),
  ];

  it("古い版を開くと「署名 n」はその版（いちばん新しい版の署名は出さない）。いちばん新しい版・開いていないときは今のまま", () => {
    const o = signaturesVersion(versions, 5);
    expect(o.old).toBe(true);
    expect(o.info?.version).toBe(5);
    expect(o.info?.signatures.map((s) => s.by)).toEqual(["【架空】山田", "【架空】佐藤"]);
    expect(signaturesVersion(versions, 6)).toEqual({ info: versions[2], old: false });
    expect(signaturesVersion(versions, null)).toEqual({ info: versions[2], old: false });
  });

  it("版の名前、署名ごとに 1 行（時刻と鍵の状態）、その下に適用 Skill（基本操作・Skillパック・ルールを 1 つ 1 行）", () => {
    const o = signaturesVersion(versions, 5).info!;
    const paths: string[] = [];
    const html = render(
      <SignaturesPanel
        v={o}
        readings={[]}
        old={{ name: "令和 8 年度版（第 5 版）", pack: "ごみ焼却施設", skills: [{ ...v2Ref, no: 2 }, { name: "【架空】日報の書き方", path: "fac-x/skills/【架空】日報の書き方", version: "2".repeat(64), no: 1 }], onRule: (p) => paths.push(p) }}
      />,
    );
    const t = text(html);
    expect(html).toContain('data-old="true"');
    expect(t).toContain("令和 8 年度版（第 5 版）");
    expect(t).toContain("確定　【架空】山田　2026-06-12 14:20　✓ 照合済み");
    expect(t).toContain("承認　【架空】佐藤　2026-06-13 09:10　✓ 照合済み");
    // いちばん新しい版の署名と見出しは出さない
    expect(t).not.toContain("【架空】最新の人");
    expect(t).not.toContain(HUMAN_TEXT.signatures.version(6));
    expect(t).toContain("適用 Skill");
    expect([...html.matchAll(/data-testid="applied-skill" data-tier="(\w+)"/g)].map((m) => m[1])).toEqual(["base", "pack", "rule", "rule"]);
    expect(t).toContain("基本操作　版の記録なし");
    expect(t).toContain("Skillパック　ごみ焼却施設　版の記録なし");
    expect(t).toContain(`ルール　${RULE}v2`);
    expect(t).toContain("ルール　【架空】日報の書き方v1");
    // 今の作業の「使用ルール」は出さない
    expect(t).not.toContain(HUMAN_TEXT.signatures.readings);
  });

  it("記録の無い版は「適用 Skill の記録なし」（行は出さない）", () => {
    const html = render(<SignaturesPanel v={signaturesVersion(versions, 4).info!} readings={[]} old={{ name: "第 4 版", pack: "ごみ焼却施設", skills: null, onRule: () => undefined }} />);
    expect(text(html)).toContain("適用 Skill の記録なし");
    expect(html).not.toContain('data-testid="applied-skill"');
  });
});

describe("古い版のルールのシート（見るだけ）", () => {
  const ws = {} as IntakeWorkspace;

  it("その版で当てていたルールを同じ表で。状態は「第 n 版で適用」、切り替え「下書き n ／ 全件 n」と操作のボタンを置かない", async () => {
    const skills = await recordedReadings(root, [v2Ref]);
    const html = render(<ReadingsSheet ws={ws} old={{ version: 5, skills, plan: basePlan() }} lineage={lineage} />);
    const t = text(html);
    expect(html).toContain('data-old="true"');
    expect(t).toContain(RULE);
    expect(t).toContain("第 5 版で適用");
    expect((html.match(/data-testid="reading-rule"/g) ?? []).length).toBe(2);
    expect(t).toContain("1 行目を見出しとして読む");
    expect(html).not.toContain('data-testid="readings-filter"');
    expect(t).not.toContain(HUMAN_TEXT.readings.filterDraft);
    expect(t).not.toContain(HUMAN_TEXT.readings.filterAll);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("moyai-inline-act");
    // 状態の字は朱にしない
    expect(html).not.toMatch(/data-testid="reading-skill-status"[^>]*shu/);
    // 読み方の決まりの効いたセルは版の記録に無いので、件数の列を出さない（測っていない数を出さない）
    expect(t).not.toContain("セル 0");
  });

  it("記録の無い版は「適用ルールの記録なし」の 1 行（「当てているルールはありません」は使わない）", () => {
    const html = render(<ReadingsSheet ws={ws} old={{ version: 4, skills: null, plan: basePlan() }} lineage={null} />);
    const t = text(html);
    expect(t).toBe("適用ルールの記録なし");
    expect(t).not.toContain(HUMAN_TEXT.readings.none);
  });

  it("中身が保管先に見つからないルールは、見出しと「保存先に中身なし」", () => {
    const html = render(<ReadingsSheet ws={ws} old={{ version: 5, skills: [{ name: "【架空】消えたルール", path: "skills/会社/【架空】消えたルール", version: "0".repeat(64), scope: null, skill: null }], plan: null }} lineage={null} />);
    expect(text(html)).toContain("【架空】消えたルール第 5 版で適用保存先に中身なし");
  });
});
