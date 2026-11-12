// 読み方のフィードバックの書き出し（S-C3）：形と数だけ・固有名詞の網 2 で止める・保存は人だけの経路（AI のツールに無い）・
// Issue に貼れば C1 の台本（scripts/skill-loop/feedback.mjs）の同じ道に乗る
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { HumanService } from "../../../src/bridge/human";
import { writeSettings } from "../../../src/bridge/places";
import { ReadingSkill, type LoadedReading } from "../../../src/import/reading";
import { ROUTES } from "../../../src/shared/routes";
import { EXPOSED_TOOL_NAMES, TOOL_NAMES } from "../../../src/shared/tools";
import { buildReadingFeedback, localHits, parseReadingFeedback, READING_FEEDBACK_SCHEMA } from "../../../src/share/reading-feedback";
// @ts-expect-error 型の無い .mjs（台本）
import { buildCandidate, screen } from "../../../scripts/skill-loop/feedback.mjs";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const loaded = (rules: unknown[], scope: "facility" | "company" = "facility"): LoadedReading => ({
  skill: ReadingSkill.parse({ schema: "moyai.reading/0", name: "施設の読み方", scope, rules }),
  version: "v",
  path: null,
  approved: false,
  draft: true,
});
const RULES = [
  { id: "drain", kind: "answer", question: "assetLinkOne", match: "「排水処理設備」に当たる機器が先の資料に 1 つある", answer: "c0", text: "機器台帳の「排水処理設備」を同じ機器として読む", author: "human", by: "担当のだれか", reason: "とても長い自由記述の理由。施設の事情が書いてある", when: { file: "*機器台帳*", headers: ["機器名称"] } },
  { id: "unit", kind: "columnRole", column: "号炉", role: "unit", text: "「号炉」の列を号炉として読む", author: "ai", reason: "理由" },
];
const build = (over: Partial<Parameters<typeof buildReadingFeedback>[0]> = {}) => buildReadingFeedback({ pack: "waste-incineration", readings: [loaded(RULES)], cellsOf: (id) => (id === "drain" ? 2 : 40), localWords: [], ...over });

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("読み方のフィードバックの書き出し", () => {
  it("形と数だけを書き出す：文・理由・人・資料の名前・id・範囲を入れない", () => {
    const r = build({ localWords: ["ひかり台クリーンプラザ"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.schema).toBe(READING_FEEDBACK_SCHEMA);
    expect(r.file.rules).toEqual([
      { kind: "answer", question: "assetLinkOne", match: "「排水処理設備」に当たる機器が先の資料に 1 つある", answer: "c0", when: { headers: ["機器名称"] }, cells: 2 },
      { kind: "columnRole", column: "号炉", role: "unit", cells: 40 },
    ]);
    for (const v of ["担当のだれか", "自由記述", "機器台帳*", "drain", "facility", "同じ機器として読む"]) expect(r.text).not.toContain(v);
    expect(parseReadingFeedback(r.text)).not.toBeNull();
  });

  it("同じ形の規則は 1 つにまとめ、規則が無ければ作らない", () => {
    const r = buildReadingFeedback({ pack: "p", readings: [loaded([RULES[1]]), loaded([{ ...RULES[1], id: "unit2" }], "company")], cellsOf: () => 1, localWords: [] });
    expect(r.ok && r.file.rules.length).toBe(1);
    expect(buildReadingFeedback({ pack: "p", readings: [loaded([])], cellsOf: () => 0, localWords: [] })).toEqual({ ok: false, reason: "noRules" });
  });

  it("その PC の語（施設名・業者など）が形の欄に入っていれば作らない。当たった語は返さない", () => {
    const rules = [{ id: "s", kind: "sameAsset", names: ["ひかり台の1号クレーン", "ごみクレーン"], text: "同じ機器", author: "human", reason: "理由" }];
    const r = buildReadingFeedback({ pack: "p", readings: [loaded(rules)], cellsOf: () => 3, localWords: ["ひかり台", "1"] });
    expect(r).toEqual({ ok: false, reason: "properNoun", hits: 1 });
    expect(JSON.stringify(r)).not.toContain("ひかり台");
    expect(localHits("ＨＩＫＡＲＩ", ["hikari"])).toBe(1);
  });

  it("保存の経路が受けるのは形の欄と cells だけ：文・理由・人・資料の名前・id の欄があれば受けない", () => {
    const r = build();
    if (!r.ok) throw new Error("作れない");
    const f = JSON.parse(r.text);
    for (const extra of [{ text: "文" }, { reason: "理由" }, { by: "人" }, { id: "x" }, { when: { file: "*.xlsx" } }]) {
      const bad = { ...f, rules: [{ ...f.rules[0], ...extra }] };
      expect(parseReadingFeedback(JSON.stringify(bad)), JSON.stringify(extra)).toBeNull();
    }
    expect(parseReadingFeedback(JSON.stringify({ ...f, rules: [{ kind: "runShell", cells: 1 }] }))).toBeNull();
    expect(parseReadingFeedback(JSON.stringify({ ...f, rules: [{ kind: "columnRole", column: "号炉", role: "どれでもない", cells: 1 }] }))).toBeNull();
    expect(parseReadingFeedback(JSON.stringify({ ...f, extra: 1 }))).toBeNull();
    expect(parseReadingFeedback("読めない")).toBeNull();
  });

  it("保存は人だけの経路 reading_feedback_save：AI のツールに無く、保管先の feedback/ に置く。形の外れ・固有名詞は置かない", async () => {
    const route = ROUTES.readingFeedbackSave;
    expect(route.kind).toBe("human");
    expect(route.requires).toEqual({ tabSecret: true, oneTimeToken: true });
    for (const n of [...TOOL_NAMES, ...EXPOSED_TOOL_NAMES]) expect(n).not.toContain("feedback");

    dir = mkdtempSync(join(tmpdir(), "moyai-feedback-save-"));
    const sd = join(dir, "state");
    mkdirSync(sd, { recursive: true });
    const storage = join(dir, "保管先");
    writeSettings(sd, { v: 1, root: storage, ledger: null, name: "【架空】試験の台本" });
    const human = new HumanService({ stateDir: sd, packsDir: join(REPO, "packs"), now: () => Date.parse("2026-11-12T15:30:00Z") });
    const call = (payload: unknown) => human.handle({ action: "reading_feedback_save", payload: JSON.stringify(payload), session: "s" });
    const r = build();
    if (!r.ok) throw new Error("作れない");

    const saved = await call({ text: r.text, words: ["ひかり台"] });
    expect(saved.ok).toBe(true);
    expect(saved.file).toMatch(/^ルール_2026-11-13_[0-9a-f]{8}\.json$/);
    expect(readFileSync(join(storage, "feedback", saved.file as string), "utf8")).toBe(r.text);

    const withReason = JSON.parse(r.text);
    withReason.rules[0].reason = "理由";
    expect(await call({ text: JSON.stringify(withReason), words: [] })).toMatchObject({ ok: false, reason: "feedbackShape" });
    expect(await call({ text: r.text, words: ["号炉"] })).toMatchObject({ ok: false, reason: "properNoun", hits: 1 });
    expect(await call({ text: r.text })).toMatchObject({ ok: false, reason: "payloadInvalid" });
    expect(readdirSync(join(storage, "feedback"))).toHaveLength(1);
    expect(existsSync(join(sd, "feedback"))).toBe(false);
  });

  it("書き出したファイルを Issue に貼ると、C1 の台本の同じ道に乗り、案は moyai.reading/0 として読める", () => {
    const r = build();
    if (!r.ok) throw new Error("作れない");
    const body = ["### 業種（Skillパック）", "", "ごみ焼却（waste-incineration）", "", "### 資料の種類", "", "機器台帳", "", "### どう読まれて、どう読まれるべきだったか", "", "アプリから書き出した。", "", "### 会話で作ったルール（あれば）", "", "```json", r.text.trim(), "```", "", "### 確かめ", "", "- [X] 資料の中身（行の値・金額・固有名詞）を書いていない", ""].join("\n");
    const s = screen({ number: 9100, title: "書き出したルール", body, labels: ["feedback"] });
    expect(s.ok).toBe(true);
    const cand = buildCandidate(9100, s.pack, s.rules);
    const parsed = ReadingSkill.parse({ scope: "company", ...cand });
    expect(parsed.rules.map((x) => x.id)).toEqual(["fb9100-app1", "fb9100-app2"]);
    expect(parsed.rules.every((x) => x.author === "ai")).toBe(true);
  });
});
