// アプリの困りごとの形（src/share/app-feedback.ts。運営者 2026-11-18）：送る全文は人の一言と決まった付き物だけ。
// 厳しく読む（余計な欄・重複したキー・形の外れ・見せた字と違う字を断る）。一言の中の行の値・ファイルの道・鍵・URL を数える（値は返さない）。
import { describe, expect, it } from "vitest";
import {
  APP_FEEDBACK_NOTE_MAX,
  APP_FEEDBACK_SCHEMA,
  appFeedbackCounts,
  appFeedbackText,
  buildAppFeedback,
  normalizeNote,
  osOf,
  parseAppFeedback,
} from "../../../src/share/app-feedback";
import { appScreenOf } from "../../../src/app/state/app-screen";

const base = { version: "d247938", screen: "hoshitori.files", os: "windows", lang: "ja" } as const;

describe("送る全文を作る", () => {
  it("一言と付き物の 6 つの欄だけ。全文は JSON（2 字の字下げ）と改行", () => {
    const b = buildAppFeedback({ ...base, note: "  取り込んだ資料を消せない\r\n入れ間違えた資料を外したい  " });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.file).toEqual({ schema: APP_FEEDBACK_SCHEMA, note: "取り込んだ資料を消せない\n入れ間違えた資料を外したい", ...base });
    expect(Object.keys(JSON.parse(b.text))).toEqual(["schema", "note", "version", "screen", "os", "lang"]);
    expect(b.text.endsWith("}\n")).toBe(true);
    expect(parseAppFeedback(b.text, { canonical: true })).toEqual(b.file);
  });

  it("空・長すぎ・行が多すぎ・見えない字は作らない。版の形が違えば unknown", () => {
    expect(buildAppFeedback({ ...base, note: "   " })).toEqual({ ok: false, reason: "empty" });
    expect(buildAppFeedback({ ...base, note: "あ".repeat(APP_FEEDBACK_NOTE_MAX + 1) })).toEqual({ ok: false, reason: "tooLong" });
    expect(buildAppFeedback({ ...base, note: "あ".repeat(APP_FEEDBACK_NOTE_MAX) }).ok).toBe(true);
    expect(buildAppFeedback({ ...base, note: Array(21).fill("あ").join("\n") })).toEqual({ ok: false, reason: "tooManyLines" });
    expect(buildAppFeedback({ ...base, note: "消せない\u202e" })).toEqual({ ok: false, reason: "control" });
    expect(buildAppFeedback({ ...base, note: "消せない\u0007" })).toEqual({ ok: false, reason: "control" });
    const v = buildAppFeedback({ ...base, version: "test", note: "消せない" });
    expect(v.ok && v.file.version).toBe("unknown");
    expect(normalizeNote("ｶ\u3099")).toBe("ｶ\u3099".normalize("NFC"));
  });
});

describe("全文を厳しく読む", () => {
  const good = appFeedbackText({ schema: APP_FEEDBACK_SCHEMA, note: "資料を消せない", ...base });
  const obj = JSON.parse(good) as Record<string, unknown>;
  it("余計な欄・欠けた欄・重複したキー・違う形・決まっていない語は読まない", () => {
    expect(parseAppFeedback(good)).not.toBeNull();
    expect(parseAppFeedback(JSON.stringify({ ...obj, facility: "【架空】みなと台清掃工場" }))).toBeNull();
    expect(parseAppFeedback(JSON.stringify({ ...obj, path: "C:\\Users\\a" }))).toBeNull();
    const { lang: _lang, ...noLang } = obj;
    expect(parseAppFeedback(JSON.stringify(noLang))).toBeNull();
    expect(parseAppFeedback(good.replace('"lang": "ja"', '"lang": "ja",\n  "lang": "en"'))).toBeNull();
    expect(parseAppFeedback(JSON.stringify({ ...obj, schema: "moyai.reading-feedback/0" }))).toBeNull();
    expect(parseAppFeedback(JSON.stringify({ ...obj, screen: "hoshitori.chart/【架空】" }))).toBeNull();
    expect(parseAppFeedback(JSON.stringify({ ...obj, os: "Windows 11 Pro 23H2" }))).toBeNull();
    expect(parseAppFeedback(JSON.stringify({ ...obj, version: "../../x" }))).toBeNull();
    expect(parseAppFeedback(JSON.stringify({ ...obj, note: " 前に空白" }))).toBeNull();
    expect(parseAppFeedback(JSON.stringify({ ...obj, note: 3 }))).toBeNull();
    expect(parseAppFeedback("[]")).toBeNull();
    expect(parseAppFeedback(`\ufeff${good}`)).toBeNull();
    expect(parseAppFeedback('{"__proto__": {}}')).toBeNull();
  });
  it("canonical：画面が見せた字（appFeedbackText）と 1 字でも違えば読まない", () => {
    expect(parseAppFeedback(JSON.stringify(obj), { canonical: true })).toBeNull();
    expect(parseAppFeedback(good.trimEnd(), { canonical: true })).toBeNull();
    expect(parseAppFeedback(good, { canonical: true })).not.toBeNull();
  });
});

describe("一言の中の、送らないものらしき字を数える（値は返さない）", () => {
  it.each([
    ["見積は 1,200,000 円だった", ["groupedNumber", "money"]],
    ["2026/11/18 に止まった", ["exactDate"]],
    ["P-1023 のポンプが出ない", ["code"]],
    ["株式会社ほげの資料", ["company"]],
    ["みなと台清掃工場で使っている", ["facility"]],
    ["a@b.example に連絡して", ["contact"]],
    ["C:\\Users\\taro\\Documents が開けない", ["path"]],
    ["/Users/taro/Documents が開けない", ["path"]],
    ["\\\\server\\share\\ が見えない", ["path"]],
    ["github_pat_abcdefghij を入れた", ["secret"]],
    ["https://example.com を見て", ["url"]],
  ])("%s", (note, kinds) => {
    const c = appFeedbackCounts(note);
    for (const k of kinds) expect(c[k], k).toBeGreaterThan(0);
    expect(JSON.stringify(c)).not.toMatch(/taro|1023|ほげ|example/);
  });
  it("ふつうの一言は 0（種類を返さない）", () => {
    expect(appFeedbackCounts("取り込んだ資料を消せない。AI が確定版を読めない。デモの資料が古い")).toEqual({});
    expect(appFeedbackCounts("ごみ焼却の星取表で、号炉を入れ替えたい")).toEqual({});
  });
});

describe("付き物の語", () => {
  it("OS の種類は決まった 4 つ", () => {
    expect(["Win32", "Windows", "darwin", "MacIntel", "macOS", "Linux x86_64", "linux", "", "FreeBSD"].map(osOf)).toEqual(["windows", "windows", "mac", "mac", "mac", "linux", "linux", "other", "other"]);
  });
  it("画面の名前は決まった語（道のほかの字は入れない）", () => {
    expect(appScreenOf("#/")).toBe("top");
    expect(appScreenOf("")).toBe("top");
    expect(appScreenOf("#/settings")).toBe("settings");
    expect(appScreenOf("#/settings/industries")).toBe("industries");
    expect(appScreenOf("#/merge/files")).toBe("hoshitori.files");
    expect(appScreenOf("#/merge/readings")).toBe("hoshitori.readings");
    expect(appScreenOf("#/merge")).toBe("hoshitori");
  });
});
