// 号・系列の書き方（一般の性質。手がかりの語は packs/_cues/cues.json）と、日報の系列の欄が読めないときに黙って未解決にしないこと。
import { describe, expect, test } from "vitest";
import { parseUnit } from "../../../src/import/text";
import { human, session } from "./helpers";

const enc = new TextEncoder();

describe("号・系列の書き方を読む", () => {
  test("「1号炉」「No.2」「1系」「1系列」「第2系列」を数として読み、書き方の形を返す", () => {
    expect(parseUnit("1号炉")).toEqual({ kind: "number", n: 1, spelling: "{n}号炉" });
    expect(parseUnit("No.2")).toEqual({ kind: "number", n: 2, spelling: "No.{n}" });
    expect(parseUnit("1系")).toEqual({ kind: "number", n: 1, spelling: "{n}系" });
    expect(parseUnit("1系列")).toEqual({ kind: "number", n: 1, spelling: "{n}系列" });
    expect(parseUnit("第2系列")).toEqual({ kind: "number", n: 2, spelling: "第{n}系列" });
    expect(parseUnit("２系列")).toEqual({ kind: "number", n: 2, spelling: "{n}系列" });
  });
  test("字が 3 つ以上・数の無いもの・ほかの頭は読まない（推測しない）", () => {
    expect(parseUnit("1系列目")).toBeNull();
    expect(parseUnit("系列")).toBeNull();
    expect(parseUnit("A系列")).toBeNull();
    expect(parseUnit("共通")).toEqual({ kind: "common" });
  });
});

describe("日報の系列の欄が読めない行", () => {
  test("書き方ごとに 1 回聞き、答えるまで未解決。「外す」と答えればその行だけを外す", async () => {
    const lines = [
      "日付,工事名,機器,系列,作業内容,工数,備考",
      "2022/05/11,点検,甲ポンプ,1系,点検,1人・日,",
      "2022/05/12,点検,甲ポンプ,2系,点検,1人・日,",
      "2022/05/13,点検,甲ポンプ,1系,点検,1人・日,",
      "2022/05/14,点検,甲ポンプ,西の系,点検,1人・日,",
      "2022/05/15,点検,甲ポンプ,西の系,点検,1人・日,",
    ];
    const s = session();
    await s.add([{ name: "日報.csv", bytes: enc.encode(lines.join("\n") + "\n") }]);
    const qs = s.analyze().open.filter((q) => q.kind === "unitMissing");
    expect(qs.map((q) => q.text)).toEqual(["「系列」の列の「西の系」（2 行）は、号・系列として読めない"]);
    expect(qs[0]!.options.map((o) => o.id)).toEqual(["none", "exclude"]);
    const key = (ref: string) => ["日報.csv", "0", ref].join(String.fromCharCode(0));
    const st = () => s.analyze().composition.status;
    // 答える前：その行は未解決（質問がある）
    expect(st().get(key("D5"))?.s).toBe("unresolved");
    s.settle([human(qs[0]!.questionId, "exclude")]);
    expect(st().get(key("A5"))?.s).toBe("excluded");
    expect(st().get(key("A6"))?.s).toBe("excluded");
    expect(st().get(key("A2"))?.s).not.toBe("excluded");
  });
});
