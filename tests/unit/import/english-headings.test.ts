// 英語の見出しの資料（グローバル対応の段 1b、2026-11-16）：packs/_cues/cues.json の en の語で、英語の見出しの列の役目・予定と実績・
// 合計の行・工数の単位を読む。日本語の見出しで同じ形の資料と、同じ質問・同じ計画になることを、性質の違う 2 つの資料（作業の記録の CSV と
// 星取表の Excel）で確かめる。英語の語は日本語の手がかりで決まらないときだけ見る（日本語の資料の読みは変わらない。物差しは pack-bench）。
import { describe, expect, test } from "vitest";
import { cue, enTokens } from "../../../src/import/cues";
import { parseDateText } from "../../../src/import/era";
import type { IntakeSession } from "../../../src/import";
import { human, rows, session, xlsxOf } from "./helpers";

const enc = new TextEncoder();

/** 開いた質問に、既定か選択肢の最初の答えで答える（試験の台本）。聞いた質問の種類を返す */
function answerAll(s: IntakeSession): string[] {
  const kinds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const open = s.analyze().open.filter((q) => !q.decision);
    if (!open.length) break;
    kinds.push(...open.map((q) => q.kind));
    s.settle(open.map((q) => human(q.questionId, q.defaultAnswer ?? q.options[0]?.id ?? "")));
  }
  return kinds.sort();
}

async function readPlan(files: { name: string; bytes: Uint8Array }[]) {
  const s = session();
  await s.add(files);
  const asked = answerAll(s);
  const plan = s.compose().plan;
  return { asked, plan };
}

const shape = (plan: NonNullable<Awaited<ReturnType<typeof readPlan>>["plan"]>) => ({
  assets: plan.assets.length,
  works: plan.works.length,
  details: plan.details.map((d) => `${d.fiscalYear}/${d.planOrActual}/${d.manDays ?? "-"}`).sort(),
});

describe("英語の見出しの手がかり", () => {
  test("列の役目：語ごとに比べ、語の途中には当てない", () => {
    expect(cue.column("Date")).toBe("date");
    expect(cue.column("Work date")).toBe("date");
    expect(cue.column("Equipment")).toBe("assetRef");
    expect(cue.column("Equipment name")).toBe("name");
    expect(cue.column("Work description")).toBe("workName");
    expect(cue.column("Man-days")).toBe("effort");
    expect(cue.column("Labor (man-hours)")).toBe("effort");
    expect(cue.column("Remarks")).toBe("remark");
    expect(cue.column("Status")).toBe("planActual");
    expect(cue.column("Tag No.")).toBe("tag");
    // 「No」は「Notes」の頭の字だが、語が違うので番号にしない
    expect(cue.column("Notes")).toBe("remark");
    expect(cue.column("Nozzle")).toBeNull();
    // 日本語の見出しは今のまま
    expect(cue.column("作業内容")).toBe("workName");
    expect(cue.column("工数(人日)")).toBe("effort");
  });

  test("予定と実績・合計の行・工数の単位", () => {
    expect(cue.planActual("Done")).toBe("actual");
    expect(cue.planActual("Completed")).toBe("actual");
    expect(cue.planActual("Planned")).toBe("plan");
    expect(cue.planActual("Plan / Done")).toBeNull();
    expect(cue.planActual("Planet")).toBeNull();
    expect(cue.isTotal("Total")).toBe(true);
    expect(cue.isTotal("Grand total")).toBe(true);
    expect(cue.isTotal("Totally enclosed fan")).toBe(false);
    expect(cue.isSubtotal("Sub-total")).toBe(true);
    expect(cue.isLegendTitle("Legend")).toBe(true);
    expect(cue.headerUnit("Labor (man-hours)")).toBe("hours");
    expect(cue.headerUnit("Effort (MD)")).toBe("manDays");
    expect(cue.headerUnit("Man-days")).toBe("manDays");
    expect(cue.headerUnit("工数(人日)")).toBe("manDays");
    expect(enTokens("Tag No. (ID)")).toEqual(["tag", "no", "id"]);
  });

  test("月の名前で書いた日付を読み、月を数で書いた日・月の並びは読まない", () => {
    expect(parseDateText("6 Apr 2022")).toEqual({ y: 2022, m: 4, d: 6 });
    expect(parseDateText("06-Apr-2022")).toEqual({ y: 2022, m: 4, d: 6 });
    expect(parseDateText("April 6, 2022")).toEqual({ y: 2022, m: 4, d: 6 });
    expect(parseDateText("Sept 30th, 2023")).toEqual({ y: 2023, m: 9, d: 30 });
    expect(parseDateText("31 Feb 2022")).toBeNull();
    expect(parseDateText("05/10/2022")).toBeNull();
    expect(parseDateText("2022-04-06")).toEqual({ y: 2022, m: 4, d: 6 });
  });
});

describe("英語の見出しの資料は、日本語の見出しの同じ資料と同じに読む", () => {
  test("作業の記録の CSV（予定と実績の列・工数の単位つき）", async () => {
    const ja = ["日付,機器,作業内容,状態,工数(人日),備考", "2022-05-10,押込送風機,分解整備,完了,3,軸受", "2026-12-01,押込送風機,分解整備,予定,4,"].join("\r\n");
    const en = ["Date,Equipment,Work description,Status,Man-days,Remarks", "10 May 2022,FD fan,Overhaul,Done,3,bearing", "2026-12-01,FD fan,Overhaul,Planned,4,"].join("\r\n");
    const a = await readPlan([{ name: "log.csv", bytes: enc.encode(ja) }]);
    const b = await readPlan([{ name: "log.csv", bytes: enc.encode(en) }]);
    expect(a.plan).not.toBeNull();
    expect(b.plan, JSON.stringify(b.asked)).not.toBeNull();
    expect(b.asked).toEqual(a.asked);
    expect(shape(b.plan!)).toEqual(shape(a.plan!));
    expect(b.plan!.details.find((d) => d.planOrActual === "actual")?.fiscalYear).toBe(2022);
  });

  test("星取表の Excel（階層・作業・年度の列）", async () => {
    const ja = await xlsxOf((ws) =>
      rows(ws, 1, [["【架空】星取表"], ["設備", "機器", "作業", "2022年度", "2023年度", "2024年度"], ["燃焼設備", "火格子", "分解整備", "●", null, "○"], [null, "押込送風機", "点検", "●", "●", "○"], ["合計", null, null, 2, 1, 2]]),
    );
    const en = await xlsxOf(
      (ws) => rows(ws, 1, [["[FICTIONAL] Maintenance plan"], ["System", "Equipment", "Work", "FY2022", "FY2023", "FY2024"], ["Combustion", "Grate", "Overhaul", "●", null, "○"], [null, "FD fan", "Inspection", "●", "●", "○"], ["Total", null, null, 2, 1, 2]]),
      "Plan",
    );
    const a = await readPlan([{ name: "chart.xlsx", bytes: ja }]);
    const b = await readPlan([{ name: "chart.xlsx", bytes: en }]);
    expect(a.plan).not.toBeNull();
    expect(b.plan, JSON.stringify(b.asked)).not.toBeNull();
    expect(b.asked).toEqual(a.asked);
    expect(shape(b.plan!)).toEqual(shape(a.plan!));
  });
});
