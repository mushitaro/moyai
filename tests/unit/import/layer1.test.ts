// layer1.*（docs/plan.md §5.1）：和暦の書式、数式があって値の無いセル、.xls、Shift_JIS の CSV、区切りと文字コード、読まない物の台帳。
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { READABLE, readSource } from "../../../src/import/read";
import { readCsv, detectDelimiter } from "../../../src/import/csv";
import { formatValue } from "../../../src/import/numfmt";
import { parseDateText, parseYearLabel, parseYearOnly } from "../../../src/import/era";
import { patchesInEffect } from "../../../src/import/exceljs-setup";
import { readZip, writeZip } from "../../../src/import/zip";
import { acceptDefaults, human, session, xlsxOf } from "./helpers";

const enc = new TextEncoder();

describe("exceljs の直し", () => {
  test("版が 4.4.0 で、3 つの直しが効いている（版が変わったら落ちる）", () => {
    const pkg = JSON.parse(readFileSync("node_modules/exceljs/package.json", "utf8")) as { version: string };
    expect(pkg.version).toBe("4.4.0");
    expect(patchesInEffect()).toEqual({ rawNumFmt: true, noDates: true, jaBuiltins: true });
  });
});

describe("表示の文字（ssf と元号の表）", () => {
  test("和暦の書式と組み込みの番号", () => {
    expect(formatValue('[$-411]ggge"年"m"月"d"日"', 45383)).toBe("令和6年4月1日");
    expect(formatValue('[$-411]ggge"年"m"月"d"日"', 43586)).toBe("令和1年5月1日");
    expect(formatValue('[$-ja-JP-x-gannen]ggge"年"m"月"d"日"', 43586)).toBe("令和元年5月1日");
    expect(formatValue("[$-411]ge.m.d", 43585)).toBe("H31.4.30");
    expect(formatValue('[$-411]gge"年"', 32515)).toBe("昭64年");
    expect(formatValue(14, 45383)).toBe("2024/4/1");
    expect(formatValue(28, 45383)).toBe("令和6年4月1日");
    expect(formatValue("aaa", 45383)).toBe("月");
    expect(formatValue("yyyy/m/d", 0, { date1904: true })).toBe("1904/1/1");
    expect(formatValue('#,##0"人・日"', 1234)).toBe("1,234人・日");
  });
  test("日付と年の書き方を読む。日に決まらない書き方は日付にしない", () => {
    expect(parseDateText("R4.4.6")).toEqual({ y: 2022, m: 4, d: 6 });
    expect(parseDateText("令和元年5月1日")).toEqual({ y: 2019, m: 5, d: 1 });
    expect(parseDateText("２０２２／０４／０７")).toEqual({ y: 2022, m: 4, d: 7 });
    expect(parseDateText("H31.2.30")).toBeNull();
    expect(parseDateText("昭和63年度末")).toBeNull();
    expect(parseDateText("4月上旬")).toBeNull();
    // 後ろの曜日の括弧は、年月日の曜日と合うときだけ読む（2026-04-06 は月曜日）
    expect(parseDateText("令和8年4月6日（月）")).toEqual({ y: 2026, m: 4, d: 6 });
    expect(parseDateText("2026/4/6(月曜日)")).toEqual({ y: 2026, m: 4, d: 6 });
    expect(parseDateText("令和8年4月6日（火）")).toBeNull();
    expect(parseDateText("2026/4/6（雨）")).toBeNull();
    expect(parseYearLabel("H31")).toEqual({ year: 2019, fiscal: null, era: "H" });
    expect(parseYearLabel("令和3年度")).toEqual({ year: 2021, fiscal: true, era: "令和" });
    expect(parseYearLabel("2028年度")?.year).toBe(2028);
    expect(parseYearOnly("平成10年")).toBe(1998);
    expect(parseYearOnly(2002)).toBe(2002);
    expect(parseYearOnly("昭和63年度末")).toBeNull();
    expect(parseYearOnly("令和2年度")).toBeNull();
  });
});

describe("Excel の読み手", () => {
  test("値・表示・数式・結合・字下げ・太字・グループ・非表示・メモを、出どころつきの格子にする", async () => {
    const bytes = await xlsxOf((ws) => {
      ws.getCell("A1").value = "【架空】題";
      ws.getCell("A1").font = { bold: true };
      ws.getCell("A2").value = "名前";
      ws.getCell("A3").value = "子";
      ws.getCell("A3").alignment = { indent: 2 };
      ws.getCell("B3").value = 45383;
      ws.getCell("B3").numFmt = '[$-411]ggge"年"m"月"d"日"';
      ws.getCell("C3").value = { formula: "SUM(1,2)" } as never;
      ws.getCell("D3").value = { formula: "SUM(1,2)", result: 3 } as never;
      ws.getCell("A4").value = "　全角の空白";
      ws.mergeCells("B5:C6");
      ws.getCell("B5").value = "結合";
      ws.getRow(7).hidden = true;
      ws.getCell("A7").value = "隠した行";
      ws.getRow(8).outlineLevel = 1;
      ws.getCell("A8").value = "グループ";
      ws.getCell("E3").note = "メモの文";
    });
    const r = await readSource({ name: "t.xlsx", bytes });
    expect(r.rejected).toBeNull();
    const g = r.source?.sheets[0];
    if (!g) throw new Error("シートが無い");
    const at = (ref: string) => g.cells.find((c) => c.ref === ref);
    expect(at("A1")?.bold).toBe(true);
    expect(at("A3")?.indent).toBe(2);
    expect(at("B3")?.value).toBe(45383);
    expect(at("B3")?.text).toBe("令和6年4月1日");
    expect(at("C3")?.formulaNoCache).toBe(true);
    expect(at("C3")?.value).toBeNull();
    expect(at("D3")?.value).toBe(3);
    expect(at("D3")?.formula).toBe("SUM(1,2)");
    expect(at("A4")?.leadingSpaces).toBe(2);
    expect(at("C5")).toBeUndefined();
    expect(g.merges.map((m) => m.ref)).toEqual(["B5:C6"]);
    expect(g.rows[7]?.hidden).toBe(true);
    expect(g.rows[8]?.outline).toBe(1);
    expect(at("E3")?.note).toBe("メモの文");
    expect(r.source?.ledger.some((e) => e.what === "formulaNoCache" && e.count === 1)).toBe(true);
  });

  test("数式があって計算済みの値が無いセルは未解決に数え、計画を作らない", async () => {
    const bytes = await xlsxOf((ws) => {
      ws.getCell("A1").value = "名称";
      ws.getCell("B1").value = "仕様";
      ws.getCell("A2").value = "機器甲";
      ws.getCell("B2").value = { formula: "1+1" } as never;
      ws.getCell("A3").value = "機器乙";
      ws.getCell("B3").value = "文";
    });
    const s = session();
    await s.add([{ name: "f.xlsx", bytes }]);
    const an = s.analyze();
    expect(an.open.some((q) => q.kind === "formulaNoCache")).toBe(true);
    expect([...an.composition.status.values()].filter((x) => x.s === "unresolved").length).toBeGreaterThan(0);
    expect(s.compose().plan).toBeNull();
    const q = an.open.find((x) => x.kind === "formulaNoCache");
    s.settle([human(q?.questionId ?? "", "exclude")]);
    acceptDefaults(s);
    const c = s.compose();
    expect(c.plan).not.toBeNull();
    expect([...c.status.values()].some((x) => x.s === "excluded" && x.reason.includes("計算済みの値が無い"))).toBe(true);
  });

  test("読まない物（入力の規則・改ページ・印刷範囲）を数えて台帳に残し、他の書き手の絶対の行き先をそろえて読む", async () => {
    const bytes = await xlsxOf((ws) => {
      ws.getCell("A1").value = "名称";
      ws.getCell("A2").value = "機器甲";
      ws.getCell("A2").dataValidation = { type: "list", allowBlank: true, formulae: ['"甲,乙"'] };
      ws.getRow(2).addPageBreak();
      ws.pageSetup.printArea = "A1:B5";
    });
    // openpyxl のように、ブックからシートへの行き先を絶対の道にする
    const entries = await readZip(bytes);
    const rels = entries.find((e) => e.name === "xl/_rels/workbook.xml.rels");
    if (rels) rels.data = enc.encode(new TextDecoder().decode(rels.data).replace(/Target="worksheets\//g, 'Target="/xl/worksheets/'));
    const r = await readSource({ name: "o.xlsx", bytes: writeZip(entries) });
    expect(r.rejected).toBeNull();
    const what = new Set(r.source?.ledger.map((e) => e.what));
    expect(what.has("dataValidation")).toBe(true);
    expect(what.has("pageBreak")).toBe(true);
    expect(what.has("printArea")).toBe(true);
    expect(what.has("zipParts")).toBe(true);
    expect(r.source?.sheets[0]?.cells.find((c) => c.ref === "A2")?.value).toBe("機器甲");
  });

  test(".xls と .doc は保存し直しを求め、案内には今読める形式をすべて出す", async () => {
    for (const name of ["古い.xls", "文書.doc"]) {
      const r = await readSource({ name, bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) });
      expect(r.source).toBeNull();
      expect(r.rejected?.reason).toContain("保存し直してください");
      for (const ext of Object.keys(READABLE)) expect(r.rejected?.reason).toContain(`.${ext}`);
    }
  });
});

describe("CSV・TSV の読み手", () => {
  test("Shift_JIS（cp932）の CSV を化けずに読み、判定を台帳に残す", () => {
    const bytes = new Uint8Array(readFileSync("samples/out/waste-incineration/fictional-1/daily-report.csv"));
    const r = readCsv("daily-report.csv", bytes);
    expect(r.source?.sheets[0]?.cells[0]?.text).toContain("【架空】");
    const led = r.source?.ledger.map((e) => e.detail).join("\n") ?? "";
    expect(led).toContain("Shift_JIS");
    expect(led).toContain("区切り「,」");
    expect(led).toContain("CRLF");
  });
  test("BOM 付きの UTF-8、囲みの中の改行と区切り、TSV", () => {
    const text = '名前,仕様\r\n"甲, 乙","1行目\r\n2行目"\r\n丙,丁\r\n';
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode(text)]);
    const r = readCsv("a.csv", bom);
    const cells = r.source?.sheets[0]?.cells ?? [];
    expect(r.source?.ledger.some((e) => e.detail.includes("BOM"))).toBe(true);
    expect(cells.find((c) => c.ref === "A2")?.text).toBe("甲, 乙");
    expect(cells.find((c) => c.ref === "B2")?.text).toBe("1行目\r\n2行目");
    // 囲みの中の改行があっても、次の記録の行の番号は元の行（4 行目）
    expect(cells.find((c) => c.text === "丙")?.r).toBe(4);
    const tsv = readCsv("b.tsv", enc.encode("名前\t仕様\n甲\t乙\n丙\t丁\n"));
    expect(tsv.source?.format).toBe("tsv");
    expect(tsv.source?.sheets[0]?.cells.find((c) => c.ref === "B3")?.text).toBe("丁");
  });
  test("区切りが決まらなければ決めずに候補を返し、セッションでは質問になる", async () => {
    const text = "a;b,c\nd;e,f\n";
    expect(detectDelimiter(text, "csv").delimiter).toBeNull();
    const s = session();
    await s.add([{ name: "x.csv", bytes: enc.encode(text) }]);
    const q = s.analyze().open.find((x) => x.kind === "delimiter");
    expect(q).toBeDefined();
    expect(s.compose().plan).toBeNull();
  });
  test("UTF-8 でも Shift_JIS でも EUC-JP でも壊れずに読めないバイト列は、文字コードを質問にし、黙って落とさない", async () => {
    const s = session();
    await s.add([{ name: "bad.csv", bytes: new Uint8Array([0x82, 0xa0, 0xff, 0xfe, 0x0a, 0x80, 0x0a]) }]);
    const q = s.analyze().open.find((x) => x.kind === "encoding");
    expect(q?.options.map((o) => o.id)).toContain("reject");
    const c = s.compose();
    expect(c.plan).toBeNull();
    expect(c.blockers.join("")).toContain("読めなかった資料 1");
    s.settle([human(q?.questionId ?? "", "reject")]);
    const an = s.analyze();
    expect(an.rejected.map((r) => r.file)).toEqual(["bad.csv"]);
    expect(an.composition.blockers.join("")).not.toContain("読めなかった資料");
  });
  test("区切りの候補がどの行にも無い CSV は、決めずに聞く（既定は 1 列の表）", async () => {
    const bytes = enc.encode("名称\n機器甲\n機器乙\n");
    expect(readCsv("one.csv", bytes).source).toBeNull();
    const s = session();
    await s.add([{ name: "one.csv", bytes }]);
    const q = s.analyze().open.find((x) => x.kind === "delimiter");
    expect(q?.defaultAnswer).toBe("single");
    s.settle([human(q?.questionId ?? "", "single")]);
    const src = s.analyze().sources[0];
    expect(src?.sheets[0]?.cells.map((c) => c.text)).toEqual(["名称", "機器甲", "機器乙"]);
    expect(src?.ledger.some((e) => e.detail.includes("1 列の表として読んだ（人が決めた）"))).toBe(true);
    // 1 列と決めたのに区切りの候補がある読み方には、候補を出して聞き直す
    const r2 = readCsv("one.csv", enc.encode("a,b\nc,d\n"), { singleColumn: true });
    expect(r2.source).toBeNull();
    expect(r2.ambiguity[0]?.candidates).toEqual([","]);
  });
  test("同じ名前でも中身の違う CSV には、前の答えを当てずに聞き直す（質問の鍵に中身の SHA-256）", async () => {
    const idOf = async (text: string) => {
      const s = session();
      await s.add([{ name: "x.csv", bytes: enc.encode(text) }]);
      return s.analyze().open.find((x) => x.kind === "delimiter")?.questionId;
    };
    const a = await idOf("a;b,c\nd;e,f\n");
    expect(a).toBeDefined();
    expect(await idOf("a;b,c\nd;e,f\n")).toBe(a);
    // 長さが同じで中身の違うファイル
    expect(await idOf("a;b,c\nd;e,g\n")).not.toBe(a);
  });
});

