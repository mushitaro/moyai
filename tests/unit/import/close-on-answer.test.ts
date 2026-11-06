// 答えた質問は閉じる（Architect の 51）：選択肢が「外す」だけの質問（名前の欄が空の行・名前の列の無い表）に答えても、
// セルが保留のまま残ると計画を作れない。保留のセルが残るのに開いた質問が 0 なら、利用者は先へ進めない（どの質問にも答えようがない）。
import { describe, expect, test } from "vitest";
import type { IntakeSession } from "../../../src/import/session";
import { human, rows, session, xlsxOf } from "./helpers";

/** 開いた質問に、選択肢の最初の答えで全部答える */
function answerAll(s: IntakeSession, rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    const open = s.analyze().open.filter((q) => !q.decision);
    if (!open.length) return;
    s.settle(open.map((q) => human(q.questionId, q.defaultAnswer ?? q.options[0]?.id ?? "")));
  }
}

/** 保留のセルが残るのに、開いた質問が 0 なら落とす */
function expectNoStuck(s: IntakeSession) {
  const sv = s.survey();
  const open = s.analyze().open.filter((q) => !q.decision);
  expect(typeof sv.unresolvedCells).toBe("number");
  if (open.length === 0) expect(sv.unresolvedCells, JSON.stringify(sv.stuck)).toBe(0);
}

describe("答えた質問は閉じる", () => {
  test("名前の欄が空の行：「外す」と答えると、その行のセルは外した数に入り、保留が残らない", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["名称", "設置年"]]);
      rows(ws, 2, [["甲設備", 2001], [null, 2002], ["乙設備", 2003]]);
    });
    const s = session();
    await s.add([{ name: "台帳.xlsx", bytes }]);
    const q = s.analyze().open.find((x) => x.kind === "stray");
    expect(q?.options.map((o) => o.id)).toEqual(["exclude"]);
    answerAll(s);
    expectNoStuck(s);
    expect(s.compose().plan).not.toBeNull();
  });

  test("名前の列の無い表：「この表を外す」と答えると、表のセルは外した数に入る", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["設置年", "台数"]]);
      rows(ws, 2, [[2001, 2], [2002, 3]]);
    });
    const s = session();
    await s.add([{ name: "数.xlsx", bytes }]);
    answerAll(s);
    expectNoStuck(s);
  });
});
