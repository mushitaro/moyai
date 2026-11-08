// 北部CC の 9 本で計画まで作れなかった 2 つの形（11-08）。資料はどれも試験の中で組む架空のもの。
// 1. 2 段の見出しの上の段に頁の頭書きの字が入った表：列の役目を下の段の語で決める（「完成図書 第3編 機器仕様一覧表 / 機器名称」は名前の列）
// 2. 星取表の節の行（名前だけの行）のすぐ下の、作業だけを書いた行：その節の機器の作業として読む（問いの無い未解決にしない）
import { describe, expect, test } from "vitest";
import type { Analysis } from "../../../src/import";
import { acceptDefaults, rows, session, xlsxOf } from "./helpers";

const silent = (an: Analysis) => [...an.composition.status.values()].filter((v) => v.s === "unresolved" && !v.questionId).length;

describe("節の行のすぐ下の作業だけの行", () => {
  test("「　特別高圧受変電設備」の下の「年次点検」は、その節の機器の作業。問いの無い未解決が残らない", async () => {
    const bytes = await xlsxOf((ws) => {
      ws.getCell("A1").value = "【架空】若葉センター　星取表";
      ws.getCell("A2").value = "凡例　○：計画　●：実施";
      rows(ws, 4, [
        ["機器・装置名", "点検・整備内容", "周期(年)", "R5", "R6", "R7", "R8"],
        ["■電気設備", null, null, null, null, null, null],
        ["　特別高圧受変電設備", null, null, null, null, null, null],
        [null, "年次点検（全停電）", 1, "●", "●", "○", "○"],
        [null, "月次点検（保安規程）", 1, "●", "●", "○", "○"],
        ["　・受電用遮断器", "精密点検", 6, "●", null, null, null],
        ["　非常用発電機", null, null, null, null, null, null],
        [null, "定期点検・負荷運転", 1, "●", "●", "○", "○"],
      ]);
    });
    const s = session();
    await s.add([{ name: "星取表.xlsx", bytes }]);
    acceptDefaults(s, 15);
    const an = s.analyze();
    const left = [...an.composition.status.entries()].filter(([, v]) => v.s === "unresolved" && !v.questionId).map(([k]) => k.split(String.fromCharCode(0)).pop());
    expect(left).toEqual([]);
    const names = an.records.assets.map((a) => a.name);
    expect(names).toContain("特別高圧受変電設備");
    expect(names).toContain("非常用発電機");
  });
});

describe("2 段の見出しの上の段に頁の頭書きが入った表", () => {
  test("上の段で役目の決まらない列は、下の段の語（機器名称）で名前の列にする。製作者の列を名前にしない", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [
        ["若葉センター（架空）", null, "完成図書 第3編 機器仕様一覧表", null, "【架空のデータ】", null, "3-2"],
        ["No.", "機器番号", "機器名称", "数量", "形式", "製作者", "備考"],
        [1, "W-101", "計量機", "2 基", "ロードセル式", "架空計器", null],
        [2, "W-102", "計量機データ処理装置", "1 式", "パソコン式", "架空計器", null],
        [3, "H-201", "ごみホッパ", "2 基", "鋼板溶接製", "架空重工", null],
      ]);
    });
    const s = session();
    await s.add([{ name: "機器仕様一覧.xlsx", bytes }]);
    acceptDefaults(s, 15);
    const an = s.analyze();
    const byTag = new Map(an.records.assets.filter((a) => a.tag).map((a) => [a.tag, a.name]));
    // 頭書きの行が見出しの上の段に入るかは読み手が決める。どちらでも名前は機器名称の列
    expect(byTag.get("W-101")).toBe("計量機");
    expect(byTag.get("H-201")).toBe("ごみホッパ");
  });
});

describe("機器仕様一覧の番号つきの節の行", () => {
  test("名前の列より左に「１．受入・供給設備」だけを書いた行は、下の機器の親（設備の段）。問いにしない", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [
        ["No.", "機器番号", "機器名称", "数量", "形式", "製作者"],
        ["１．受入・供給設備", null, null, null, null, null],
        [1, "W-101", "計量機", "2 基", "ロードセル式", "架空計器"],
        [2, "W-102", "計量機データ処理装置", "1 式", "パソコン式", "架空計器"],
        ["２．燃焼設備", null, null, null, null, null],
        [3, "H-201", "ごみホッパ", "2 基", "鋼板溶接製", "架空重工"],
      ]);
    });
    const s = session();
    await s.add([{ name: "機器仕様一覧.xlsx", bytes }]);
    acceptDefaults(s, 15);
    const an = s.analyze();
    const byId = new Map(an.records.assets.map((a) => [a.id, a]));
    const parentName = (tag: string) => {
      const a = an.records.assets.find((x) => x.tag === tag);
      return a?.parentId ? byId.get(a.parentId)?.name : null;
    };
    expect(parentName("W-101")).toBe("受入・供給設備");
    expect(parentName("H-201")).toBe("燃焼設備");
    expect(an.open.filter((q) => q.kind === "stray")).toEqual([]);
  });
});
