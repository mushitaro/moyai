// 試験の道具：exceljs で小さな xlsx を書き、取り込みのセッションを作る。
import ExcelJS from "exceljs";
import { IntakeSession } from "../../../src/import";
import type { Decision } from "../../../src/import/questions";

export async function xlsxOf(build: (ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void, sheetName = "表"): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "【架空】試験";
  const ws = wb.addWorksheet(sheetName);
  build(ws, wb);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

export function rows(ws: ExcelJS.Worksheet, top: number, data: (string | number | null)[][]) {
  data.forEach((r, i) => {
    r.forEach((v, j) => {
      if (v !== null) ws.getCell(top + i, j + 1).value = v;
    });
  });
}

export function session(fiscalYearStartMonth = 4): IntakeSession {
  return new IntakeSession({
    planId: "plan-test",
    displayName: "【架空】試験",
    packId: "test",
    facility: {
      facilityKey: "f-test",
      name: "【架空】試験",
      fiscalYearStartMonth,
      scale: null,
      scaleUnit: null,
      legalFlags: [],
      fictional: true,
      inNationalTable: null,
    },
  });
}

export const human = (questionId: string, answer: string): Decision => ({ questionId, answer, author: "human", reason: "試験の台本が押した" });

/** 開いた質問に既定の答えで全部答える（既定の無いものは残す） */
export function acceptDefaults(s: IntakeSession, rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    const open = s.analyze().open.filter((q) => q.defaultAnswer !== null && !q.decision);
    if (!open.length) return;
    s.settle(open.map((q) => human(q.questionId, q.defaultAnswer ?? "")));
  }
}
