// 文字のある PDF の読み手（層 1）と、頁をまたぐ表（層 2）の性質の試験。資料は試験の道具が手で書いた小さな PDF。
// 文字はどれも埋め込みの無い日本語の書体で書くので、どの試験も同梱の cMap で読めることを通る。
import { describe, expect, test } from "vitest";
import { readSource } from "../../../src/import";
import { layoutFile } from "../../../src/import/structure";
import { acceptDefaults, human, rows, session, xlsxOf } from "./helpers";
import { pdfOf, ruledTable, type PdfPage } from "./pdf-helpers";

const enc = new TextEncoder();
const XS = [40, 80, 260, 380, 460];
const HEAD = ["No.", "名称", "型式", "設置年"];
const row = (n: number) => [String(n), `【架空】ポンプ${"甲乙丙丁戊"[n - 1] ?? n}`, `P-${100 + n}`, String(2000 + n)];

/** 機器台帳の 2 頁。2 頁目の頭の書き方を変える：見出しをくり返す／「（続き）」の題だけ */
function ledgerPages(page2: "repeat" | "continued"): PdfPage[] {
  const p1 = ruledTable({ xs: XS, top: 60, rowHeight: 16, rows: [HEAD, row(1), row(2), row(3)] });
  const p2 = ruledTable({ xs: XS, top: 60, rowHeight: 16, rows: page2 === "repeat" ? [HEAD, row(4), row(5)] : [row(4), row(5)] });
  return [
    { texts: [{ x: 40, y: 40, text: "【架空】機器台帳", size: 12 }, ...p1.texts], lines: p1.lines },
    { texts: [{ x: 40, y: 40, text: "【架空】機器台帳（続き）", size: 12 }, ...p2.texts], lines: p2.lines },
  ];
}

describe("文字のある PDF の読み手", () => {
  test("埋め込みの無い日本語の書体でも、同梱の cMap で文字を読む（cMap が無ければ同じには読めない書体であることも確かめる）", async () => {
    const want = "【架空】定期整備の報告書（第１号炉）";
    const bytes = pdfOf([{ texts: [{ x: 50, y: 60, text: want, size: 12 }] }]);
    const r = await readSource({ name: "jp.pdf", bytes });
    expect(r.rejected).toBeNull();
    expect(r.source?.format).toBe("pdf");
    expect(r.source?.sheets[0]?.cells.map((c) => c.text)).toEqual([want]);
    // 対照：cMap と標準の書体を渡さない pdf.js では、この書体の文字を同じには読めない（試験が cMap を通っている証）
    const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    class NoFiles {
      constructor(_opts: unknown) {}
      async fetch(): Promise<Uint8Array> {
        throw new Error("同梱のファイルを渡さない");
      }
    }
    const task = lib.getDocument({ data: bytes.slice(), BinaryDataFactory: NoFiles, verbosity: 0, disableFontFace: true, useSystemFonts: false });
    let text = "";
    try {
      const doc = await task.promise;
      const tc = await (await doc.getPage(1)).getTextContent();
      text = tc.items.map((i) => ("str" in i ? i.str : "")).join("");
    } catch {
      text = "";
    } finally {
      await task.destroy();
    }
    expect(text).not.toBe(want);
  });

  test("埋め込みの無い標準の 14 書体（Helvetica）は、配らない書体のデータ（Liberation）が無くても、内蔵の字の幅で読む", async () => {
    const r = await readSource({ name: "latin.pdf", bytes: pdfOf([{ texts: [{ x: 50, y: 60, text: "Report No.12 (FY2024)", font: "latin" }, { x: 50, y: 80, text: "定期整備" }] }]) });
    expect(r.source?.sheets[0]?.cells.map((c) => c.text)).toEqual(["Report No.12 (FY2024)", "定期整備"]);
  });

  test("行は基準線、列は罫線の間。出どころは頁と頁の上の位置を持ち、どの文字の並びもちょうど 1 つのセルに入る", async () => {
    const t = ruledTable({ xs: XS, top: 60, rowHeight: 16, rows: [HEAD, row(1), row(2)] });
    const r = await readSource({ name: "a.pdf", bytes: pdfOf([{ texts: t.texts, lines: t.lines }]) });
    const g = r.source?.sheets[0];
    const at = (ref: string) => g?.cells.find((c) => c.ref === ref);
    expect(at("A1")?.text).toBe("No.");
    expect(at("B2")?.text).toBe("【架空】ポンプ甲");
    expect(at("D3")?.text).toBe("2002");
    expect(at("B2")?.page).toBe(1);
    const box = at("B2")?.box ?? [0, 0, 0, 0];
    expect(box[0]).toBeGreaterThan(80);
    expect(box[0]).toBeLessThan(260);
    const p = r.source?.pages?.[0];
    expect(p?.placed).toBe(p?.runs);
    expect(r.source?.ledger.find((e) => e.what === "pdfGrid")?.detail).toContain("縦の罫線 5 本");
  });

  test("頁の中身を cm で縮めても、罫線と文字を同じ座標に直して列を決める", async () => {
    const t = ruledTable({ xs: XS, top: 60, rowHeight: 16, rows: [HEAD, row(1)] });
    const r = await readSource({ name: "cm.pdf", bytes: pdfOf([{ texts: t.texts, lines: t.lines, cm: [0.7, 0, 0, 0.7, 30, 20] }]) });
    const g = r.source?.sheets[0];
    expect(g?.cells.map((c) => `${c.ref}=${c.text}`)).toEqual(["A1=No.", "B1=名称", "C1=型式", "D1=設置年", "A2=1", "B2=【架空】ポンプ甲", "C2=P-101", "D2=2001"]);
  });

  test("罫線の無い表は、文字の左端の位置で列を決める", async () => {
    const texts = [HEAD, row(1), row(2)].flatMap((rw, i) => rw.map((text, j) => ({ x: (XS[j] ?? 0) + 2, y: 80 + i * 16, text, size: 9 })));
    const r = await readSource({ name: "plain.pdf", bytes: pdfOf([{ texts }]) });
    const g = r.source?.sheets[0];
    expect(g?.cells.filter((c) => c.r === 2).map((c) => `${c.ref}=${c.text}`)).toEqual(["A2=1", "B2=【架空】ポンプ甲", "C2=P-101", "D2=2001"]);
    expect(r.source?.ledger.find((e) => e.what === "pdfGrid")?.detail).toContain("縦の罫線が無い");
  });

  test("回した文字は格子に置かず、読まなかった物として理由つきで数える（黙って捨てない）", async () => {
    const r = await readSource({
      name: "rot.pdf",
      bytes: pdfOf([{ texts: [{ x: 50, y: 60, text: "表の題" }, { x: 300, y: 300, text: "【架空】縦の注記", rotate: 90 }] }]),
    });
    const src = r.source;
    expect(src?.sheets[0]?.cells.map((c) => c.text)).toEqual(["表の題"]);
    const rot = src?.ledger.find((e) => e.what === "pdfRotatedText");
    expect(rot?.kind).toBe("unread");
    expect(rot?.count).toBe(1);
    expect(src?.ledger.some((e) => e.what === "pdfRunsUncounted")).toBe(false);
  });

  test("壊れた PDF は、理由つきで受け付けない", async () => {
    const r = await readSource({ name: "bad.pdf", bytes: enc.encode("%PDF-1.4\nこわれた") });
    expect(r.source).toBeNull();
    expect(r.rejected?.reason).toContain("読めませんでした");
  });
});

describe("頁をまたぐ表（層 2 のくり返す領域）", () => {
  test("頁ごとに見出しをくり返す PDF の表は、1 つの表になる（くり返した見出しは理由つきで外す）", async () => {
    const bytes = pdfOf(ledgerPages("repeat"));
    const s = session();
    await s.add([{ name: "ledger.pdf", bytes }]);
    const an = s.analyze();
    const lay = an.layouts[0];
    expect(lay?.tables).toHaveLength(1);
    const t = lay?.tables[0];
    expect(t?.rows.filter((r) => r.role === "data").length).toBe(5);
    const reasons = [...(lay?.rowReasons.values() ?? [])];
    expect(reasons.filter((x) => x.includes("くり返す見出し")).length).toBe(2); // 2 頁目の題と見出し
    acceptDefaults(s);
    const plan = s.compose().plan;
    expect(plan?.assets.map((a) => a.name)).toEqual(["【架空】ポンプ甲", "【架空】ポンプ乙", "【架空】ポンプ丙", "【架空】ポンプ丁", "【架空】ポンプ戊"]);
    expect(new Set(plan?.assets.flatMap((a) => a.sources.map((x) => x.page)))).toEqual(new Set([1, 2]));
    expect(plan?.assets.every((a) => a.sources.every((x) => x.box !== null))).toBe(true);
  });

  test("「（続き）」の頁は、見出しが無くても前の表の続きになる", async () => {
    const s = session();
    await s.add([{ name: "ledger2.pdf", bytes: pdfOf(ledgerPages("continued")) }]);
    const an = s.analyze();
    const lay = an.layouts[0];
    expect(lay?.tables).toHaveLength(1);
    expect(lay?.tables[0]?.rows.filter((r) => r.role === "data").length).toBe(5);
    expect([...(lay?.rowReasons.values() ?? [])]).toContain("続きの表記（前の表の続き）");
    acceptDefaults(s);
    expect(s.compose().plan?.assets).toHaveLength(5);
  });

  test("同じ表を Excel のシートに印刷の形で書いても（頁の切れ目なしに積む）、同じく 1 つの表になる（層 2 は形式を知らない）", () => {
    // PDF の格子と同じ形を、頁の情報なしで作る：題・見出し・中身・題（続き）・見出し・中身
    const cells = [
      ["【架空】機器台帳"],
      HEAD,
      row(1),
      row(2),
      ["【架空】機器台帳（続き）"],
      HEAD,
      row(3),
    ].flatMap((rw, i) =>
      rw.map((text, j) => ({ r: i + 1, c: j + 1, ref: `${"ABCD"[j]}${i + 1}`, value: text, text, type: "string" as const, numFmt: "General", formula: null, formulaNoCache: false, error: null, bold: false, indent: 0, leadingSpaces: 0, note: null })),
    );
    const lay = layoutFile({ file: "x.csv", format: "csv", ledger: [], date1904: false, sheets: [{ name: null, index: 0, state: "visible", cells, merges: [], rows: {}, cols: {}, maxRow: 7, maxCol: 4 }] })[0];
    expect(lay?.tables).toHaveLength(1);
    expect(lay?.tables[0]?.rows.filter((r) => r.role === "data").map((r) => r.r)).toEqual([3, 4, 7]);
  });
});

describe("文字の無い頁（スキャン）", () => {
  test("推し量って読まず、頁を画像にして写真の一覧に並べる（人が許すか外すまで計画を作らない）。外すと決めれば計画を作る", async () => {
    const pages = [...ledgerPages("repeat").slice(0, 1), { image: true }];
    const bytes = pdfOf(pages);
    const s = session();
    expect(await s.add([{ name: "scan.pdf", bytes }])).toEqual([]);
    const an = s.analyze();
    const src = an.sources[0];
    expect(src?.pages?.map((p) => p.scanned)).toEqual([false, true]);
    const led = src?.ledger.find((e) => e.what === "scannedPage");
    expect(led?.kind).toBe("unread");
    expect(led?.detail).toContain("写真の道に回す");
    expect(s.scannedPages()).toEqual([{ file: "scan.pdf", page: 2 }]);
    // 頁の画像（PNG）が写真の一覧に並ぶ。名前は「資料#p頁」、出どころは PDF の頁
    const e = s.photos.get("scan.pdf#p2");
    expect(e).toBeDefined();
    expect(e?.input.origin).toEqual({ kind: "pdf_page", file: "scan.pdf", page: 2 });
    expect([...e!.input.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // 描けた頁には「写真の道に渡せない」の質問を出さない
    acceptDefaults(s);
    expect(s.analyze().open.find((x) => x.kind === "photoRoute")).toBeUndefined();
    const c = s.compose();
    expect(c.plan).toBeNull();
    expect(c.blockers.join("")).toContain("読んでいない写真 1");
    // 人が読まずに外すと、計画を作る（外した頁は理由つきで数える）
    expect(s.photos.exclude("scan.pdf#p2", new Date().toISOString())).toBe("ok");
    expect(s.compose().plan?.assets).toHaveLength(3);
    expect(s.analyze().rejected.map((r) => r.file)).toContain("scan.pdf#p2");
  });
});

describe("資料をまたぐ同じ作業（台帳の Excel・日報の CSV・報告書の PDF）", () => {
  const ledger = () =>
    xlsxOf((ws) =>
      rows(ws, 1, [
        ["No.", "名称", "型式"],
        [1, "【架空】ポンプ甲（PMP-1）", "X-1"],
        [2, "【架空】ポンプ乙（PMP-2）", "X-2"],
      ]),
    );
  const daily = enc.encode("日付,機器,作業内容,工数\n2024/04/01,【架空】ポンプ甲,点検,3人・日\n2024/04/02,【架空】ポンプ甲,点検,3人・日\n");
  const report = (effort: string) => {
    const t = ruledTable({
      xs: [40, 70, 210, 300, 420, 460, 520],
      top: 60,
      rowHeight: 16,
      rows: [
        ["No.", "機器", "作業内容", "工期", "日数", "工数"],
        ["1", "【架空】ポンプ甲（PMP-1）", "点検整備", "2024/04/01〜2024/04/02", "2", effort],
      ],
      size: 8,
    });
    return pdfOf([{ texts: [{ x: 40, y: 40, text: "【架空】作業報告書", size: 12 }, ...t.texts], lines: t.lines, width: 595 }]);
  };

  test("同じ機器・同じ年度で日付の重なる作業は、出どころを 3 つの資料に持つ 1 つの記録になり、報告書の日数が入る", async () => {
    const s = session();
    expect(await s.add([{ name: "ledger.xlsx", bytes: await ledger() }, { name: "daily.csv", bytes: daily }, { name: "report.pdf", bytes: report("6人・日") }])).toEqual([]);
    acceptDefaults(s);
    const an = s.analyze();
    expect(an.questions.some((q) => q.kind === "workJoin")).toBe(true);
    const plan = s.compose().plan;
    expect(plan).not.toBeNull();
    const ds = plan?.details.filter((d) => d.sources.some((x) => x.file === "report.pdf")) ?? [];
    expect(ds).toHaveLength(1);
    const d = ds[0];
    expect(new Set(d?.sources.map((x) => x.file))).toEqual(new Set(["daily.csv", "report.pdf"]));
    expect(d?.manDays).toBe(6);
    expect(d?.days).toBe(2);
    expect([d?.startDate, d?.endDate]).toEqual(["2024-04-01", "2024-04-02"]);
    const w = plan?.works.find((x) => x.workKey === d?.workKey);
    expect(plan?.assets.find((a) => a.nodeKey === w?.targets[0])?.tag).toBe("PMP-1");
  });

  test("資料で工数が違えば、黙ってどちらかを選ばずに聞く（既定の答えなし）。答えるまで計画を作らない", async () => {
    const s = session();
    await s.add([{ name: "ledger.xlsx", bytes: await ledger() }, { name: "daily.csv", bytes: daily }, { name: "report.pdf", bytes: report("5人・日") }]);
    acceptDefaults(s);
    const q = s.analyze().open.find((x) => x.kind === "effortConflict");
    expect(q?.defaultAnswer).toBeNull();
    expect(q?.options.map((o) => o.label)).toEqual(["6", "5", "工数（人・日）を空にする"]);
    expect(s.compose().plan).toBeNull();
    s.settle([human(q?.questionId ?? "", "v1")]);
    const plan = s.compose().plan;
    expect(plan?.details.find((d) => d.sources.some((x) => x.file === "report.pdf"))?.manDays).toBe(5);
  });

  test("結ぶ問いに「いいえ」と答えれば、資料ごとの別の記録として入れる", async () => {
    const s = session();
    await s.add([{ name: "ledger.xlsx", bytes: await ledger() }, { name: "daily.csv", bytes: daily }, { name: "report.pdf", bytes: report("6人・日") }]);
    const join = () => s.analyze().open.find((x) => x.kind === "workJoin");
    for (let i = 0; i < 5 && !join(); i++) acceptDefaults(s, 1);
    const q = join();
    expect(q?.defaultAnswer).toBe("yes");
    s.settle([human(q?.questionId ?? "", "no")]);
    acceptDefaults(s);
    const plan = s.compose().plan;
    const byFile = (f: string) => plan?.details.filter((d) => d.sources.some((x) => x.file === f)) ?? [];
    expect(byFile("report.pdf")).toHaveLength(1);
    expect(byFile("daily.csv")).toHaveLength(1);
    expect(byFile("report.pdf")[0]).not.toBe(byFile("daily.csv")[0]);
  });
});

describe("日数の列の手がかりの語（packs/_cues の「日数」。性質の違う 2 つの資料で、役目を聞く問いが減る）", () => {
  const columnRoleQuestions = async (name: string, bytes: Uint8Array) => {
    const s = session();
    await s.add([{ name, bytes }]);
    return s.analyze().questions.filter((q) => q.kind === "columnRole").length;
  };
  const csv = (head: string) => enc.encode(`日付,機器,作業内容,${head}\n2024/04/01〜2024/04/03,【架空】ポンプ甲,点検,3\n2024/05/10〜2024/05/11,【架空】ポンプ乙,点検,2\n`);
  const pdf = (head: string) => {
    const t = ruledTable({
      xs: [40, 160, 280, 380, 440],
      top: 60,
      rowHeight: 16,
      rows: [
        ["工期", "機器", "作業内容", head],
        ["2024/04/01〜2024/04/03", "【架空】ポンプ甲", "点検", "3"],
        ["2024/05/10〜2024/05/11", "【架空】ポンプ乙", "点検", "2"],
      ],
    });
    return pdfOf([{ texts: t.texts, lines: t.lines }]);
  };
  test("CSV（日報の形）", async () => {
    expect(await columnRoleQuestions("a.csv", csv("所要"))).toBe(1);
    expect(await columnRoleQuestions("a.csv", csv("日数"))).toBe(0);
  });
  test("PDF（報告書の形、期間の列）", async () => {
    expect(await columnRoleQuestions("a.pdf", pdf("所要"))).toBe(1);
    expect(await columnRoleQuestions("a.pdf", pdf("日数"))).toBe(0);
  });
});
