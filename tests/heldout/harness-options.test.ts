// 物差しの数え方のうち、選んだときだけ効くもの（Skillパックの物差しだけが選ぶ。mushitaro/moyai#14）：
// 数えない印（measure: false）・読みすぎを明細ごとに数える（extraByDetail）・⑥ の場所は実績として書いた印だけ（actualMarksOnly）・
// 飾りを除いた名前の正解（name_cleaned）・正解の知らない行に答えない（truthKnows）。選ばないときの数え方が変わらないことも見る。
// 資料は読まない（小さな格子と計画を、この試験の中で作る）。
import { describe, expect, it } from "vitest";
import type { SourceFile } from "../../src/import/grid";
import type { Plan } from "../../src/shared/plan";
import { HeldoutTruth, type HeldoutWorld } from "./contract";
import { Index, measureAssets, measureMarkWorkCount, measureMarks, measureRecovery, truthKnows } from "./harness";

const FILE = "【架空】星取表.xlsx";
const SHEET = "計画";
const cell = (ref: string, text: string) => ({ ref, r: Number(/\d+$/.exec(ref)![0]), c: ref.charCodeAt(0) - 64, text });
// 5 行目：機器 P-1（名前の飾りつき）・作業の名前・2024 年度の実績 ●・2025 年度の予定 ○（世界では済んだ作業。実績を書かずに予定のまま）
// 6 行目：2 台をまとめた行・2024 年度の実績 ●
const source = {
  file: FILE,
  format: "xlsx",
  date1904: false,
  ledger: [],
  sheets: [{ name: SHEET, cells: [cell("A5", "１．給水ポンプ"), cell("B5", "分解整備"), cell("C5", "●"), cell("D5", "○"), cell("A6", "送風機（2 台）"), cell("B6", "点検"), cell("C6", "●")] }],
} as unknown as SourceFile;

const world = {
  schema: "moyai.heldout.world/0",
  facility: { id: "f", name: "【架空】試験の施設", furnace_type: "", furnaces: [] },
  fiscal_years: [2024, 2025],
  today: "2025-12-12",
  man_day_hours: 8,
  equipment: [
    { id: "P-1", name: "給水ポンプ", base_name: "給水ポンプ", tag: "", system: "", path: ["給水ポンプ"], parts: [], furnace: null, furnace_label: "", install_year: 0, spec: [] },
    { id: "F-1", name: "送風機", base_name: "送風機", tag: "", system: "", path: ["送風機"], parts: [], furnace: 1, furnace_label: "1", install_year: 0, spec: [] },
  ],
  works: [
    { id: "w1", equipment_id: "P-1", fiscal_year: 2024, status: "actual", label: "分解整備", attr: "", start: null, end: null, man_days: null, duration_days: null, precision: false },
    { id: "w2", equipment_id: "P-1", fiscal_year: 2025, status: "actual", label: "分解整備", attr: "", start: null, end: null, man_days: null, duration_days: null, precision: false },
    { id: "w3", equipment_id: "F-1", fiscal_year: 2024, status: "actual", label: "点検", attr: "", start: null, end: null, man_days: null, duration_days: null, precision: false },
  ],
} as unknown as HeldoutWorld;

const truthOf = (o: { cleaned: boolean }) =>
  HeldoutTruth.parse({
    schema: "moyai.heldout.truth/0",
    set: "options",
    world: "world.json",
    files: [{ file: FILE, format: "xlsx", kind: "star" }],
    assets: [{ file: FILE, at: { row: 5, sheet: SHEET, text: "給水ポンプ" }, kind: "equipment", level: null, equipment_id: "P-1", name_text: "給水ポンプ", ...(o.cleaned ? { name_cleaned: true } : {}) }],
    marks: [
      { file: FILE, at: { row: 5, sheet: SHEET, text: "●" }, fiscal_year: 2024, status: "actual", equipment_id: "P-1", work_ids: ["w1"], symbol: "●" },
      { file: FILE, at: { row: 5, sheet: SHEET, text: "○" }, fiscal_year: 2025, status: "planned", equipment_id: "P-1", work_ids: ["w2"], symbol: "○" },
      { file: FILE, at: { row: 6, sheet: SHEET, text: "●" }, fiscal_year: 2024, status: "actual", equipment_id: "F-1", work_ids: ["w3"], symbol: "●", measure: false },
    ],
    events: [],
  });

const src = (c: string) => ({ file: FILE, sheet: SHEET, cell: c });
// 読み手の計画：飾りつきの名前のままの節、印のセルと作業の名前のセルを出どころに持つ明細
const plan = {
  assets: [
    { nodeKey: "n1", parentKey: null, level: 1, name: "１．給水ポンプ", tag: null, installedOn: null, specs: [], sources: [src("A5")] },
    { nodeKey: "n2", parentKey: null, level: 1, name: "送風機（2 台）", tag: null, installedOn: null, specs: [], sources: [src("A6")] },
  ],
  works: [
    { workKey: "k1", targets: ["n1"], kind: "分解整備" },
    { workKey: "k2", targets: ["n2"], kind: "点検" },
  ],
  details: [
    { workKey: "k1", planOrActual: "actual", fiscalYear: 2024, manDays: null, days: null, sources: [src("C5"), src("B5")] },
    { workKey: "k1", planOrActual: "plan", fiscalYear: 2025, manDays: null, days: null, sources: [src("D5"), src("B5")] },
    { workKey: "k2", planOrActual: "actual", fiscalYear: 2024, manDays: null, days: null, sources: [src("C6"), src("B6")] },
  ],
} as unknown as Plan;

describe("物差しの数え方：選んだときだけ効くもの", () => {
  const ix = new Index(truthOf({ cleaned: true }), world, [source]);

  it("正解は、どれも格子のセルに引き当たる", () => {
    expect([...ix.assets, ...ix.marks].filter((p) => !p.at)).toEqual([]);
  });

  it("数えない印（measure: false）：③ の分母に入れず、読んだ明細を読みすぎにも数えない", () => {
    const m = measureMarks(plan, ix, { extraByDetail: true })[FILE]!;
    expect([m.correct, m.total, m.extra]).toEqual([2, 2, 0]);
    const n = measureMarkWorkCount(plan, ix);
    expect([n.correct, n.total]).toEqual([2, 2]);
  });

  it("読みすぎ：選ばなければセルごと（作業の名前のセルも数える。前からの数え方）、選べば正解の印に 1 つも結ばない明細だけ", () => {
    // 前からの数え方：作業の名前のセル B5・B6 が読みすぎに数わる
    expect(measureMarks(plan, ix)[FILE]!.extra).toBe(2);
    // 正解に無いセル（E5）だけを出どころに持つ明細を足すと、明細ごとの数え方で 1
    const over = { ...plan, details: [...plan.details, { workKey: "k1", planOrActual: "plan", fiscalYear: 2026, manDays: null, days: null, sources: [src("E5"), src("B5")] }] } as unknown as Plan;
    expect(measureMarks(over, ix, { extraByDetail: true })[FILE]!.extra).toBe(1);
    // 同じ計画を前からの数え方で数えると、セルごとに B5・B6・E5 の 3
    expect(measureMarks(over, ix)[FILE]!.extra).toBe(3);
    // 明細ごと：出どころの組が違えば別に数える（作業の名前のセル B5 が同じでも）。同じ組の明細は 1 つ
    const more = (cells: string[]) => ({ workKey: "k1", planOrActual: "plan", fiscalYear: 2026, manDays: null, days: null, sources: cells.map(src) });
    const two = { ...plan, details: [...plan.details, more(["E5", "B5"]), more(["F5", "B5"]), more(["B5", "E5"])] } as unknown as Plan;
    expect(measureMarks(two, ix, { extraByDetail: true })[FILE]!.extra).toBe(2);
  });

  it("⑥ の場所：選べば、実績として書いた印だけ（数えない印も場所には使う）。予定のまま残した印しか無い済んだ作業（w2）は、どの資料にも書いていないに数える", () => {
    const read = new Set([FILE]);
    const asWritten = measureRecovery(plan, ix, read, { actualMarksOnly: true });
    expect([asWritten.denominator, asWritten.together]).toEqual([2, 2]);
    expect(asWritten.notCounted["この組のどの資料にも書いていない"]).toBe(1);
    // 選ばなければ（前からの数え方）：予定の印も場所に数え、実績の明細がそのセルを持たないので取り戻せない
    const before = measureRecovery(plan, ix, read);
    expect([before.denominator, before.together]).toEqual([3, 2]);
    expect(before.notCounted).toEqual({});
  });

  it("名前：飾りを除いた名前の正解（name_cleaned）は、セルに書いた字そのものの名前も正しい。印が無ければ、前からの数え方で名前の違い", () => {
    expect(measureAssets(plan, ix)[FILE]).toMatchObject({ correct: 1, total: 1 });
    const strict = new Index(truthOf({ cleaned: false }), world, [source]);
    const a = measureAssets(plan, strict)[FILE]!;
    expect([a.correct, a.total]).toEqual([0, 1]);
    expect(a.misses[0]).toContain("名前");
  });

  it("台本：機器を結ぶ問いは、問いの行と相手の行の機器を、どちらも正解が知っているときだけ答える。「共」の意味は、飾りを除いた名前の正解では答えない", () => {
    const item = (c: string, target?: string) => ({ file: FILE, sheet: SHEET, cells: [c], ...(target ? { target: [{ file: FILE, sheet: SHEET, cells: [target] }] } : {}) });
    const q = (kind: string, items: unknown[]) => ({ kind, items }) as never;
    // A5 は正解の機器のセル。A6（まとめた行）は正解に機器が無い
    expect(truthKnows(q("assetLink", [item("A5", "A5")]), ix)).toBe(true);
    expect(truthKnows(q("assetLink", [item("A5", "A6")]), ix)).toBe(false);
    expect(truthKnows(q("assetLinkOne", [item("A6", "A5")]), ix)).toBe(false);
    expect(truthKnows(q("assetLinkOne", []), ix)).toBe(false);
    // 相手の無い行は、問いの行の機器を知っていればよい。いくつもの行は、どれも知っているときだけ
    expect(truthKnows(q("assetLink", [item("A5")]), ix)).toBe(true);
    expect(truthKnows(q("assetLink", [item("A5", "A5"), item("A6", "A5")]), ix)).toBe(false);
    expect(truthKnows(q("assetLink", [item("A5", "A5"), item("A5")]), ix)).toBe(true);
    expect(truthKnows(q("commonMeaning", [item("A5")]), ix)).toBe(false);
    expect(truthKnows(q("commonMeaning", [item("A5")]), new Index(truthOf({ cleaned: false }), world, [source]))).toBe(true);
    expect(truthKnows(q("tagSplit", [item("A6")]), ix)).toBe(true);
  });
});
