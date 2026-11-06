// 暦年として書かれた年の印（Architect の 58）：日付が無いので年度を決められない。年度 Y として読み、年度の値の根拠に「暦年として書かれた」と残す
import { describe, expect, test } from "vitest";
import { acceptDefaults, rows, session, xlsxOf } from "./helpers";

describe("暦年の印", () => {
  test("見出しが「2024年」の印は年度 2024 として読み、根拠に残す。「年度」の見出しには残さない", async () => {
    for (const [h, note] of [["年", true], ["年度", false]] as const) {
      const bytes = await xlsxOf((ws) => {
        rows(ws, 1, [["機器", "作業内容", `2024${h}`, `2025${h}`]]);
        rows(ws, 2, [["ポンプ", "分解整備", "●", "○"]]);
        rows(ws, 4, [[null, "凡例　○：計画　●：実施済"]]);
      });
      const s = session();
      await s.add([{ name: "【架空】星取表.xlsx", bytes }]);
      acceptDefaults(s);
      const p = s.compose().plan;
      expect(p?.details.map((d) => d.fiscalYear).sort(), h).toEqual([2024, 2025]);
      for (const d of p!.details) expect(d.basis?.includes("暦年として書かれた"), `${h} ${d.basis}`).toBe(note);
    }
  });
});
