// データの名前（src/shared/data-names.ts）の「画面の言葉」が、画面の字（src/app/text/ と、次回の字の src/plan/due-view.ts）と合うか（Architect の 49）。
// 運営者が用語集で決めた名前（11-06：「段」→「階層」、「計量値」→「稼働」）と、Wire の言葉（docs/words.md）を縛る。
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { HUMAN_TEXT, REVIEW_TEXT, TEXT } from "../../src/app/text";
import { SITE_TEXT } from "../../src/app/text/site";
import { reasonText } from "../../src/app/text/reasons";
import { DUE_TEXT } from "../../src/plan/due-view";
import { DATA_NAMES } from "../../src/shared/data-names";
import { ENTITIES } from "../../src/shared/fields";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const nameOf = (id: string) => DATA_NAMES.find((n) => n.id === id)!;
/** 画面の言葉の「」の中身 */
const quoted = (s: string) => [...s.matchAll(/「([^「」]+)」/g)].map((m) => m[1]!);

/** 画面の字の文字列の葉（関数は呼ばない） */
function leaves(o: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof o === "string") out.add(o);
  else if (Array.isArray(o)) o.forEach((x) => leaves(x, out));
  else if (o && typeof o === "object") Object.values(o).forEach((x) => leaves(x, out));
  return out;
}

/** 画面の字の源（コメントを除いた本文） */
const SCREEN_FILES = [...readdirSync("src/app/text").filter((f) => f.endsWith(".ts")).map((f) => `src/app/text/${f}`), "src/plan/due-view.ts"];
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("データの名前の画面の言葉と、画面の字", () => {
  test("画面の字の源を読めている", () => {
    expect(SCREEN_FILES.length).toBeGreaterThan(5);
  });

  test("階層：名前の無い階層の見出しは「第 n 階層」。正本の画面の言葉と同じ形", () => {
    const level = nameOf("level");
    expect(level.name).toBe("階層");
    expect(quoted(level.screen)).toContain("第 n 階層");
    expect(level.screen).toContain("階層の列の見出し");
    for (const n of [1, 2, 3]) expect(TEXT.chart.levelFallback(n)).toBe(`第 ${n} 階層`);
    expect(ENTITIES.assetNode.fields.level.label).toBe("階層");
    // 質問の種類と欄の名前（Wire、11-06）
    expect(TEXT.intake.questionKind.levelSplit).toBe("階層の割れ");
    expect(TEXT.intake.questionKind.levelJump).toBe("階層の飛び");
    expect(TEXT.intake.ai.rowPath).toBe("階層");
    expect(REVIEW_TEXT.exampleCols.node).toBe("機器（階層）");
    expect(TEXT.chart.foldHint).toContain("この階層で畳む");
    expect(reasonText("path.tooDeep")).toBe("階層が深すぎる");
  });

  test("稼働：正本の画面の言葉の「」は、どれも画面の字にある", () => {
    const meter = nameOf("meter");
    expect(meter.name).toBe("稼働");
    const screen = leaves([TEXT, HUMAN_TEXT, REVIEW_TEXT, SITE_TEXT, DUE_TEXT]);
    screen.add(DUE_TEXT.projected("運転時間"));
    screen.add(DUE_TEXT.projected(""));
    const words = quoted(meter.screen);
    expect(words).toEqual(expect.arrayContaining(["運転時間（見込み）", "稼働（見込み）", "暦のみ（稼働記録なし）", "稼働記録なし", "稼働記録不足"]));
    for (const w of words) expect(screen.has(w), `画面の字に「${w}」が無い`).toBe(true);
    for (const a of meter.avoid) for (const w of quoted(a)) expect(screen.has(w), `当ててはいけない例の「${w}」が画面の字に無い`).toBe(true);
  });

  test("稼働：次回の備考と根拠、確定のシート、規則の欄の字（Wire、11-06）", () => {
    expect(DUE_TEXT.notes.calendarOnly).toBe("暦のみ（稼働記録なし）");
    expect(DUE_TEXT.undecided).toMatchObject({
      noTrigger: "周期なし",
      triggerInvalid: "周期不正",
      noOrigin: "起点なし",
      meterNone: "稼働記録なし",
      meterInsufficient: "稼働記録不足",
      meterDecreasing: "稼働記録の減少",
      meterNotGrowing: "稼働記録の変化なし",
    });
    // 無いと足りないを分ける。周期が無いと起点が無いを分ける
    expect(DUE_TEXT.undecided.meterNone).not.toBe(DUE_TEXT.undecided.meterInsufficient);
    expect(DUE_TEXT.undecided.noTrigger).not.toBe(DUE_TEXT.undecided.noOrigin);
    expect(DUE_TEXT.projected("起動回数")).toBe("起動回数（見込み）");
    expect(DUE_TEXT.projected("  ")).toBe("稼働（見込み）");
    expect(HUMAN_TEXT.decisions.cycleKept(HUMAN_TEXT.decisions.keptMeter)).toBe("反映なし（稼働の枝）");
    expect(ENTITIES.meter.label).toBe("稼働");
    expect(ENTITIES.meter.fields.meter.label).toBe("稼働の種類");
  });

  test("共有の見え方のまとめた度合いは「集約度」（階層の「段」と取り違えない）", () => {
    expect(HUMAN_TEXT.checkpoint.tried).toBe("数えた集約度");
    expect(HUMAN_TEXT.checkpoint.triedRow(2, true, 7)).toMatch(/^集約度 2（帯を粗くした）：/);
    expect(SITE_TEXT.stage(1)).toBe("集約度 1");
    expect(reasonText("k.stageMismatch")).toBe("見え方の集約度が合わない");
  });

  test("前の言葉（段の道・段の割れ・段の飛び・n 段目・計量値・使用量）が画面の字に残っていない。「段」は Skill の段（n 段目の Skill）だけ", () => {
    for (const f of SCREEN_FILES) {
      const body = stripComments(read(f));
      for (const w of ["段の道", "段の割れ", "段の飛び", "計量値", "使用量", "起点不正"]) expect(body.includes(w), `${f} に「${w}」`).toBe(false);
      const rest = body.replace(/[1-3](〜[1-3])? 段目の Skill/g, "");
      expect(rest.includes("段"), `${f} に「段」（Skill の段のほか）`).toBe(false);
    }
  });
});
