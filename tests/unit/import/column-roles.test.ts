// 列の役目の一覧は 1 つ（Architect の 46 の残り）：読み手の役目・質問の選択肢・ルールの役目が同じ一覧を引き、
// 周期・計画実績・作業量・作業内容の列を、人の答えでも Claude のルールでも当てられる。ルールで費用にした列は費用の元のセルになり、AI の見本に値が出ない。
import { describe, expect, test } from "vitest";
import { READING_SCHEMA, ReadingRule, type LoadedReading } from "../../../src/import/reading";
import { COL_ROLES, COLUMN_ROLES, COLUMN_ROLE_OPTIONS } from "../../../src/import/roles";
import { COLUMN_ROLE_OPTIONS as FROM_STRUCTURE } from "../../../src/import/structure";
import type { IntakeSession } from "../../../src/import";
import { acceptDefaults, human, session } from "./helpers";

// 見出しが手がかりの語でない列（内容・間隔・資材・状況・金）を持つ、架空の作業の一覧
const CSV = new TextEncoder().encode(
  [
    "日付,機器,内容,間隔,資材,状況,金",
    "2024/5/10,送水ポンプ,分解整備,年4回,ボルト10本,実績,12345円",
    "2025/6/11,送水ポンプ,分解整備,年4回,ボルト8本,予定,9876円",
    "2024/7/12,配水ポンプ,点検,年2回,－,－,3210円",
  ].join("\r\n") + "\r\n",
);
const FILE = "【架空】作業一覧.csv";
const WANT = { 内容: "workName", 間隔: "cycle", 資材: "quantity", 状況: "planActual", 金: "cost" } as const;

function reading(rules: ReadingRule[]): LoadedReading {
  return { skill: { schema: READING_SCHEMA, name: "【架空】乙浄水場の読み方", scope: "facility", rules }, version: "a1b2c3d4e5f6", path: null, approved: false, draft: true };
}

/** 残る質問（金額の単位など）に答えて計画を作る */
function finish(s: IntakeSession) {
  for (let i = 0; i < 6; i++) {
    const open = s.analyze().open.filter((q) => !q.decision && q.defaultAnswer === null);
    // 金額の単位は円、「－」の行は実績、台帳の無い機器はこの資料の名前のまま入れる（人がそう答えた）
    const pick = (q: (typeof open)[number]) => (q.kind === "costUnit" ? "1" : (["actual", "new"].find((id) => q.options.some((o) => o.id === id)) ?? null));
    s.settle(open.flatMap((q) => (pick(q) ? [human(q.questionId, pick(q)!)] : [])));
    acceptDefaults(s);
  }
  const c = s.compose();
  expect(c.plan, JSON.stringify([c.blockers, s.analyze().open.map((q) => q.text)])).not.toBeNull();
  return c.plan!;
}

function check(s: IntakeSession) {
  const p = finish(s);
  const works = new Map(p.works.map((w) => [w.workKey, w]));
  // 作業内容：その列の字が作業の名前
  expect([...new Set(p.works.map((w) => w.kind))].sort()).toEqual(["分解整備", "点検"]);
  // 周期：その行の作業のきっかけ（年 4 回 → 3 か月、年 2 回 → 6 か月）
  expect(p.works.every((w) => w.trigger !== null), JSON.stringify(p.works.map((w) => w.trigger))).toBe(true);
  // 計画実績：「予定」の行は計画、「実績」の行は実績
  const byMonth = (m: string) => p.details.find((d) => (d.lines ?? []).some((l) => l.date?.startsWith(m)) || d.startDate?.startsWith(m));
  expect(byMonth("2024-05")?.planOrActual).toBe("actual");
  expect(byMonth("2025-06")?.planOrActual).toBe("plan");
  // 作業量：作業明細の作業量
  expect(p.details.flatMap((d) => (d.lines ?? []).map((l) => l.quantity)).filter(Boolean)).toContain("ボルト10本");
  // 費用：その列のセルが費用の元のセル。値は円
  const d5 = byMonth("2024-05")!;
  expect(d5.cost).toBe(12345);
  expect(d5.costSource).toMatchObject({ file: FILE, ref: "G2" });
  expect(works.get(d5.workKey)?.kind).toBe("分解整備");
  // その列の値は、AI に渡す要約（見本・詰まっている所・質問・注記）に出ない
  const survey = JSON.stringify(s.survey());
  for (const v of ["12345", "9876", "3210", "12,345"]) expect(survey.includes(v), v).toBe(false);
  return p;
}

describe("列の役目の一覧は 1 つ", () => {
  test("質問の選択肢とルールの役目は同じ一覧で、どれも読み手の役目（外すを除く）", () => {
    expect(COLUMN_ROLE_OPTIONS.map((o) => o.id)).toEqual(COLUMN_ROLES);
    expect(FROM_STRUCTURE).toBe(COLUMN_ROLE_OPTIONS);
    const roleOf = (role: string) => ReadingRule.safeParse({ id: "r", text: "x", kind: "columnRole", column: "x", role, author: "ai", reason: "x" }).success;
    expect(COLUMN_ROLES.every(roleOf)).toBe(true);
    expect(roleOf("nope")).toBe(false);
    for (const r of COLUMN_ROLES) if (r !== "exclude") expect(COL_ROLES as readonly string[]).toContain(r);
    for (const r of Object.values(WANT)) expect(COLUMN_ROLES).toContain(r);
  });

  test("人の答えで、周期・計画実績・作業量・作業内容・費用の列を当てられる", async () => {
    const s = session();
    await s.add([{ name: FILE, bytes: CSV }]);
    const qs = s.analyze().open.filter((q) => q.kind === "columnRole");
    const ds = Object.entries(WANT).map(([h, role]) => {
      const q = qs.find((x) => x.text.includes(`見出し「${h}」`));
      expect(q, `${h}：${qs.map((x) => x.text).join(" / ")}`).toBeDefined();
      expect(q!.options.map((o) => o.id)).toContain(role);
      return human(q!.questionId, role);
    });
    // 金額らしい列の質問は、見本の字を伏せる
    expect(qs.find((x) => x.text.includes("見出し「金」"))!.text).not.toContain("12345");
    s.settle(ds);
    check(s);
  });

  test("Claude のルールで同じ役目を当てられ、ルールで費用にした列が費用の元のセルになって、見本に値が出ない", async () => {
    const s = session();
    await s.add([{ name: FILE, bytes: CSV }]);
    s.setReadings([
      reading(
        Object.entries(WANT).map(([h, role], i) => ({ id: `c${i}`, text: `「${h}」の列は${role}として読む`, kind: "columnRole" as const, column: h, role, author: "ai" as const, reason: "利用者が会話で決めた" })),
      ),
    ]);
    const an = s.analyze();
    // ルールで決めた列は聞かない
    for (const h of Object.keys(WANT)) expect(an.open.some((q) => q.kind === "columnRole" && q.text.includes(`見出し「${h}」`)), h).toBe(false);
    for (let i = 0; i < Object.keys(WANT).length; i++) expect(an.ruleHits.count(`c${i}`)).toBeGreaterThan(0);
    check(s);
  });
});
