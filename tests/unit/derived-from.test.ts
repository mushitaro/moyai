// 加工したファイルの出どころ（mushitaro/moyai#47）：intake_add_files の derivedFrom（folder だけ）。作業画面は、読めた資料に
// 元の資料の名前と作り方を持ち、資料の詳細に 1 行で出す（行の値は持たない）。作業中（#82）にも写り、戻すと付け直す。
import { describe, expect, it } from "vitest";
import { addFilesFromBridge } from "../../src/app/intake/tab-tools";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { workFileSchema } from "../../src/bridge/work";
import { TOOLS, intakeAddFilesToTabSchema } from "../../src/shared/tools";

const CSV = new TextEncoder().encode("日付,作業,機器\n2024-04-01,【架空】点検,【架空】送水ポンプ\n");
const DERIVED = { files: ["【架空】台帳_2024.xlsx", "【架空】台帳_2025.xlsx"], how: "列「機器名」を 1 列にまとめた" };
const args = (name: string, derivedFrom?: unknown) => ({
  source: "folder",
  pack: "waste-incineration",
  facilityName: "【架空】出どころの試験",
  files: [{ fileId: name.padEnd(22, "x").slice(0, 22).replace(/[^A-Za-z0-9_-]/g, "x"), name, size: CSV.length }],
  ...(derivedFrom ? { derivedFrom } : {}),
});

describe("intake_add_files の derivedFrom", () => {
  it("folder だけで受ける。元の資料は 1〜20、作り方は 1〜200 字。ほかの欄は受けない", () => {
    const input = TOOLS.intake_add_files.input;
    expect(input.safeParse({ source: "folder", path: "/x", derivedFrom: DERIVED }).success).toBe(true);
    expect(input.safeParse({ source: "demo", derivedFrom: DERIVED }).success).toBe(false);
    expect(input.safeParse({ source: "folder", path: "/x", derivedFrom: { files: [], how: "x" } }).success).toBe(false);
    expect(input.safeParse({ source: "folder", path: "/x", derivedFrom: { ...DERIVED, how: "" } }).success).toBe(false);
    expect(input.safeParse({ source: "folder", path: "/x", derivedFrom: { ...DERIVED, rows: 3 } }).success).toBe(false);
    expect(intakeAddFilesToTabSchema.safeParse(args("a.csv", DERIVED)).success).toBe(true);
    expect(workFileSchema.safeParse({ name: "a.csv", sha256: "a".repeat(64), size: 1, derivedFrom: DERIVED }).success).toBe(true);
  });

  it("作業画面は、読めた資料に出どころを持つ。添えなければ持たない。版から戻すと消え、作業中から戻すと付け直す", async () => {
    const DERIVED = { files: ["b.csv"], how: "列「機器名」を 1 列にまとめた" };
    const ws = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    const plain = await addFilesFromBridge(ws, args("b.csv"), async () => CSV);
    if (!plain.ok) throw new Error(plain.code);
    expect(ws.derivedOf("b.csv")).toBeNull();
    const r = await addFilesFromBridge(ws, args("加工_a.csv", DERIVED), async () => CSV);
    if (!r.ok) throw new Error(r.code);
    expect(ws.derivedOf("加工_a.csv")).toEqual(DERIVED);
    await ws.restoreVersion(1, [{ name: "加工_a.csv", bytes: CSV }, { name: "b.csv", bytes: CSV }], []);
    expect(ws.derivedOf("加工_a.csv")).toBeNull();
    await ws.restoreWork(null, [{ name: "加工_a.csv", bytes: CSV }, { name: "b.csv", bytes: CSV }], [], [], false, [{ name: "加工_a.csv", derivedFrom: DERIVED }]);
    expect(ws.derivedOf("加工_a.csv")).toEqual(DERIVED);
  });
});

describe("出どころの見直し", () => {
  it("元の資料の名前は、作業場にある資料のものだけ（無い名前は出さない。自分自身は外す）。どれも無ければ付けない", async () => {
    const ws = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    await addFilesFromBridge(ws, args("元.csv"), async () => CSV);
    const r = await addFilesFromBridge(ws, args("元_加工.csv", { files: ["元.csv", "無い.xlsx", "元.csv", "元_加工.csv"], how: "x" }), async () => CSV);
    if (!r.ok) throw new Error(r.code);
    expect(ws.derivedOf("元_加工.csv")).toEqual({ files: ["元.csv"], how: "x" });
    await addFilesFromBridge(ws, args("ほか.csv", { files: ["無い.xlsx"], how: "x" }), async () => CSV);
    expect(ws.derivedOf("ほか.csv")).toBeNull();
  });

  it("印が変わると marksVersion が進む（作業中の写しが、出どころを書き直す）", async () => {
    const ws = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    await addFilesFromBridge(ws, args("元.csv"), async () => CSV);
    await addFilesFromBridge(ws, args("元_加工.csv"), async () => CSV);
    const v = ws.marksVersion;
    ws.markDerived(["元_加工.csv"], { files: ["元.csv"], how: "x" });
    expect(ws.marksVersion).toBe(v + 1);
  });
});
