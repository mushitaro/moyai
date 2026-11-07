// 読みの地図の残りの原因の一般の形（工数の書き方・資料をまたいで結ぶ機器・同じ様式の問いのまとめ）。架空の小さな資料で 1 つずつ確かめる。
import { describe, expect, test } from "vitest";
import { cue } from "../../../src/import/cues";
import { acceptDefaults, human, rows, session, xlsxOf } from "./helpers";

const csv = (lines: string[]) => new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);

describe("工数の見出しの単位", () => {
  test("人・日の単位の語そのもの（「人工」「人日」）と、単位の語の後ろの計（「人工計」「延べ時間合計」）を読む。単位の無い見出しは読まない", () => {
    expect(cue.headerUnit("人工")).toBe("manDays");
    expect(cue.headerUnit("人日")).toBe("manDays");
    expect(cue.headerUnit("人工計")).toBe("manDays");
    expect(cue.headerUnit("延べ時間合計")).toBe("hours");
    expect(cue.headerUnit("工数計")).toBeNull();
    expect(cue.headerUnit("工数")).toBeNull();
    expect(cue.headerUnit("合計")).toBeNull();
  });

  test("見出し「人工計」の列の数だけの工数は人・日に読み、単位を聞かない", async () => {
    const s = session();
    await s.add([{ name: "日報.csv", bytes: csv(["日付,機器,作業,人工計", "2024/4/6,ポンプ,分解整備,2", "2024/4/7,ブロワ,給油,0.5"]) }]);
    const an = s.analyze();
    expect(an.open.some((q) => q.kind === "effortUnknown")).toBe(false);
    expect(an.records.events.map((e) => e.manDays)).toEqual([2, 0.5]);
  });

  test("工数の見出しの語でも、中身に数が 1 つも無い列は工数の列にせず、役目を聞く（既定は備考）", async () => {
    const s = session();
    await s.add([{ name: "記録.csv", bytes: csv(["日付,機器,作業,立上げまでの時間", "2024/4/6,バーナ,点検,記録を照査した。工事は要らない", "2024/4/7,ブロワ,給油,記録を照査した。工事は要らない"]) }]);
    const an = s.analyze();
    expect(an.open.some((q) => q.kind === "effortUnknown")).toBe(false);
    const role = an.open.find((q) => q.kind === "columnRole");
    expect(role?.defaultAnswer).toBe("remark");
  });
});

describe("同じ様式の表", () => {
  test("日付の見出しだけ違う表（頁・停止ごとの工程表）は同じ様式", async () => {
    const bytes = await xlsxOf((ws, wb) => {
      const sheet = (w: typeof ws, d0: Date) => {
        rows(w, 1, [["号炉", "機器", "作業", null, null, "人工計"]]);
        w.getCell(1, 4).value = d0;
        w.getCell(1, 4).numFmt = "m/d";
        w.getCell(1, 5).value = new Date(d0.getTime() + 86_400_000);
        w.getCell(1, 5).numFmt = "m/d";
        rows(w, 2, [["1号炉", "ポンプ", "点検", null, null, 2], ["1号炉", "ブロワ", "給油", null, null, 1]]);
      };
      sheet(ws, new Date(Date.UTC(2024, 4, 9)));
      sheet(wb.addWorksheet("表2"), new Date(Date.UTC(2024, 5, 20)));
    });
    const s = session();
    await s.add([{ name: "工程表.xlsx", bytes }]);
    const forms = s.analyze().layouts.flatMap((l) => l.tables.map((t) => t.form));
    expect(forms.length).toBe(2);
    expect(new Set(forms).size).toBe(1);
  });
});

describe("資料をまたいで結ぶ機器", () => {
  test("号炉の数がどちらにも書いてあって違う同じ名前の機器は結ばない（1 件ずつ聞かない）。号炉の同じ機器は結ぶ", async () => {
    const s = session();
    await s.add([
      { name: "台帳1.csv", bytes: csv(["号炉,機器名称", "1号炉,給水ポンプ", "1号炉,誘引通風機"]) },
      { name: "台帳2.csv", bytes: csv(["号炉,機器名称", "2号炉,給水ポンプ", "1号炉,誘引通風機"]) },
    ]);
    acceptDefaults(s);
    const an = s.analyze();
    expect(an.open.filter((q) => q.kind === "assetLinkOne" || q.kind === "assetLink")).toEqual([]);
    const pumps = an.linked.clusters.filter((c) => c.name === "給水ポンプ" && !c.excluded);
    expect(pumps.map((c) => c.recs.map((r) => r.file))).toEqual([["台帳1.csv"], ["台帳2.csv"]]);
    const fan = an.linked.clusters.find((c) => c.name === "誘引通風機");
    expect(fan?.recs.map((r) => r.file)).toEqual(["台帳1.csv", "台帳2.csv"]);
  });

  test("同じ様式の資料の「結ぶか」は 1 問にまとめ、1 回の答えが全部の資料に当たる", async () => {
    const s = session();
    const page = (n: number) => ({ name: `点検表${n}.csv`, bytes: csv(["機器名称,仕様", `ポンプ,${n}`, `ブロワ,${n}`]) });
    await s.add([{ name: "台帳.csv", bytes: csv(["名称,機器番号", "ポンプ,PMP", "ブロワ,BLW"]) }, page(1), page(2), page(3)]);
    const links = s.analyze().open.filter((q) => q.kind === "assetLink");
    expect(links.length).toBe(1);
    // 後の資料は先の資料の答えを待ち、答えると同じ問いの答えで結ぶ（資料ごとに聞き直さない）
    s.settle([human(links[0]?.questionId ?? "", "yes")]);
    const an = s.analyze();
    expect(an.open.filter((q) => q.kind === "assetLink" || q.kind === "assetLinkOne")).toEqual([]);
    expect(an.linked.clusters.find((c) => c.name === "ポンプ")?.recs.length).toBe(4);
  });
});
