// 中長期の計画表を作り手の正解で測る（planbook.ts）。資料はリポジトリに置かないので、道を渡したときだけ走る。
// MOYAI_PLANBOOK_FILES：資料のフォルダ。MOYAI_PLANBOOK_ANSWER：answer のフォルダ。MOYAI_PLANBOOK_STEM：answer/files の名前（拡張子なし）。
// MOYAI_PLANBOOK_OUT：結果の JSON を書く道。
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runPlanbook } from "./planbook";

describe("中長期の計画表を作り手の正解で測る", () => {
  const files = process.env.MOYAI_PLANBOOK_FILES;
  it.runIf(!!files)("取り込み、資料のとおりに入る割合を測る", async () => {
    const r = await runPlanbook(files!, process.env.MOYAI_PLANBOOK_ANSWER!, process.env.MOYAI_PLANBOOK_STEM!);
    if (process.env.MOYAI_PLANBOOK_OUT) writeFileSync(process.env.MOYAI_PLANBOOK_OUT, `${JSON.stringify(r, null, 1)}\n`, "utf8");
    expect(r.file).toBeTruthy();
  }, 900_000);
});
