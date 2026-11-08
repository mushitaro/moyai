// 作業日報の人数の欄：職種の語と略の 1 字（11-07、運営者の試験の資料で読めなかった書き方）。
// どの業種の日報にもある職種の語は標準（packs/_cues の effort.trades）。業種の語（「築炉工」）は Skillパックの読み方（packs/waste-incineration/reading.json）。
import { describe, expect, it } from "vitest";
import { packReadingRules } from "../../../src/import/pack-reading";
import { tradeWordsOf } from "../../../src/import/reading";
import { IntakeSession } from "../../../src/import/session";
import { parsePersons } from "../../../src/import/text";
import { session } from "./helpers";

const waste = tradeWordsOf(packReadingRules("waste-incineration"));

describe("人数の欄の職種の語と略（標準）", () => {
  it.each([
    ["計装工2 技術員1", 3],
    ["機械工1 検査員2", 3],
    ["作業員1 保温工2 塗装工2", 5],
    ["機1・検2", 3],
    ["電2・配1", 3],
    ["作2・保1・塗1", 4],
    ["計2・技1", 3],
    ["計4名（機械工3）", 4],
  ])("%s は %i 人", (s, n) => {
    expect(parsePersons(s)?.n).toBe(n);
  });
  it("職種の語に無い語は読まない", () => {
    expect(parsePersons("職員2 業者3")).toBeNull();
  });
});

describe("業種の職種の語は Skillパックの読み方から足す（2 段目）", () => {
  it("ごみ焼却の Skillパックの読み方に「築炉工」がある", () => {
    expect(waste).toContain("築炉工");
  });
  it.each([
    ["築炉工3 作業員2", 5],
    ["築2・作4", 6],
  ])("Skillパックの語を足すと %s は %i 人", (s, n) => {
    expect(parsePersons(s, waste)?.n).toBe(n);
  });
  it("標準だけでは「築炉工」を読まない（業種の語は標準に置かない）", () => {
    expect(parsePersons("築炉工3 作業員2")).toBeNull();
  });
  it("取り込みのセッションは、そのセッションの Skillパックの読み方を当てる（ごみ焼却なら築炉工を読み、ほかの Skillパックでは問いが残る）", async () => {
    const enc = new TextEncoder();
    const bytes = enc.encode(
      ["日付,号炉,機器,作業内容,作業人員,作業時間", "2026/04/01,1号炉,【架空】機器1,点検,築炉工2 作業員1,9:00～12:00", "2026/04/02,2号炉,【架空】機器2,点検,築2,13:00～17:00"].join("\r\n") + "\r\n",
    );
    const effortQs = async (packId: string) => {
      const base = session();
      const s = new IntakeSession({ ...base.options, packId });
      await s.add([{ name: "日報.csv", bytes }]);
      return s.analyze().questions.filter((q) => q.kind === "effortUnknown" && !q.options.some((o) => o.id === "noon")).length;
    };
    expect(packReadingRules("waste-incineration").every((a) => a.from.scope === "pack" && a.from.approved)).toBe(true);
    expect(await effortQs("waste-incineration")).toBe(0);
    expect(await effortQs("test")).toBeGreaterThan(0);
  });
});
