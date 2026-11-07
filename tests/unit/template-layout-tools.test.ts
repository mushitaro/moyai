// 「この様式で Excel を出して」の道（仕事 template-layout-v1）：送り手（中継 → 橋渡し）と受け手（作業画面のタブ）の契約。
// - intake_add_files の source: template：橋渡しが道を確かめて様式を読み、AI には様式の形だけを返す（値の入ったデータの行は字も値も返さない）。
//   作業画面は様式を EXPORT の様式の欄に入れる（保存はしない）。
// - screen_set の templateLayout：作業画面が様式に照らして写し方の案を下書きとして置く。合わなければ置かずに理由を返す。
//   出力と保存は人が「この写し方で出力」を押したときだけ（ツールには道が無い）。
// 様式と計画はどれも架空。ファイルは一時のフォルダに置く。
import { closeSync, existsSync, ftruncateSync, mkdtempSync, openSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addFilesFromBridge, runTabTool } from "../../src/app/intake/tab-tools";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { clearWorkingPlan, setWorkingPlan } from "../../src/app/state/plan-store";
import { GO_HASH, resetScreenForTest } from "../../src/app/state/screen";
import { knownTemplate, layoutDraft, pendingTemplates, resetTemplateDraftsForTest, useTemplateDrafts } from "../../src/app/state/template-draft";
import { buildPreview } from "../../src/app/components/TemplateLayoutPreview";
import { layoutColumns } from "../../src/app/pages/Export";
import { checkTemplateFile, collectIntake } from "../../src/bridge/intake-files";
import { writeSettings } from "../../src/bridge/places";
import { listTemplates, readTemplateVersion, saveTemplate } from "../../src/bridge/templates";
import { createRelayServer } from "../../src/cli/relay";
import { writeTemplate } from "../../src/plan/template-layout";
import { resolvePacksDir } from "../../src/share/pack";
import { ERRORS } from "../../src/shared/errors";
import { encodeEvent } from "../../src/shared/events";
import { HEADER_TAB_SECRET, ROUTES } from "../../src/shared/routes";
import { TOOLS } from "../../src/shared/tools";
import { FakeTab, SECRET_A, startTestBridge, type TestBridge } from "../helpers/bridge";
import { SHEET_FIRST, SHEET_INFO, SHEET_LATER, catalog, layoutFor, layoutPlan, templateBytes } from "../helpers/template-layout";

const cleanups: (() => Promise<void> | void)[] = [];
const fakeLocation = { hash: "#/" };
beforeEach(() => {
  resetScreenForTest();
  resetTemplateDraftsForTest();
  fakeLocation.hash = "#/";
  (globalThis as { location?: unknown }).location = fakeLocation;
});
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  clearWorkingPlan();
  resetTemplateDraftsForTest();
  delete (globalThis as { location?: unknown }).location;
});

const PACKS = resolvePacksDir();
const REPO = dirname(PACKS);
const NAME = "架空の様式";
const CTX = { conversation: "c-layout", rowsRemaining: 2000 };

function temp(prefix = "moyai-layout-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}
async function templateFile(o: { filled?: boolean } = {}): Promise<string> {
  const p = join(temp(), `${NAME}.xlsx`);
  writeFileSync(p, await templateBytes(o));
  return p;
}
const ws = () => new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】様式の試験", fiscalYearStartMonth: 4, fictional: true });

/** 作業画面のふりが、資料のワンタイムトークンで中身を取りに行く */
function fetchFile(tb: TestBridge, fileId: string): Promise<Uint8Array | null> {
  return new Promise((res, rej) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: tb.bridge.port,
        method: "POST",
        path: ROUTES.tabIntakeFile.path,
        headers: { "content-type": "application/json", origin: tb.origin, "sec-fetch-site": "same-origin", [HEADER_TAB_SECRET]: SECRET_A },
      },
      (r) => {
        const chunks: Buffer[] = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => res(r.statusCode === 200 ? new Uint8Array(Buffer.concat(chunks)) : null));
      },
    );
    req.on("error", rej);
    req.end(JSON.stringify({ fileId }));
  });
}

/** 中継（本物）→ 橋渡し（本物）→ タブ（本物の受け手を、このスレッドで動かす） */
async function chain() {
  const tb = await startTestBridge({ toolTimeouts: { read: 10_000, propose: 10_000, start: 10_000 } });
  cleanups.push(() => tb.close());
  const tab = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
  await tab.opened;
  tab.send("tab.hello", { secret: SECRET_A, build: "test" });
  await tab.next("bridge.welcome");
  cleanups.push(() => tab.ws.close());
  const w = ws();
  const calls: { name: string; args: any }[] = [];
  tab.ws.on("message", (raw) => {
    const ev = JSON.parse(raw.toString("utf8"));
    if (ev.type !== "bridge.tool_call") return;
    calls.push(ev.data);
    const answer = ev.data.name === "intake_add_files" ? addFilesFromBridge(w, ev.data.args, (id) => fetchFile(tb, id)) : Promise.resolve(runTabTool(w, ev.data.name, ev.data.args, CTX));
    void answer.then((result) => tab.ws.send(encodeEvent("tab.tool_result", { requestId: ev.data.requestId, result: result as never })));
  });
  const server = createRelayServer({ stateDir: tb.stateDir });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  cleanups.push(() => client.close());
  await client.listTools();
  return { tb, client, calls, w };
}

describe("ツールの型と説明", () => {
  it("intake_add_files の template は path が要り、pack と facilityName を渡さない。screen_set は templateLayout を受ける（ツールは増やさない）", () => {
    const input = TOOLS.intake_add_files.input;
    expect(input.safeParse({ source: "template" }).success).toBe(false);
    expect(input.safeParse({ source: "template", path: "/x/a.xlsx", pack: "waste-incineration" }).success).toBe(false);
    expect(input.safeParse({ source: "template", path: "/x/a.xlsx", facilityName: "【架空】甲" }).success).toBe(false);
    expect(input.safeParse({ source: "template", path: "/x/a.xlsx" }).success).toBe(true);
    const ss = TOOLS.screen_set.input;
    expect(ss.safeParse({ templateLayout: { ...layoutFor(), template: NAME } }).success).toBe(true);
    expect(ss.safeParse({ templateLayout: layoutFor() }).success).toBe(false);
    expect(ss.safeParse({ templateLayout: { ...layoutFor(), template: NAME, save: true } }).success).toBe(false);
  });

  it("説明に「この様式で Excel を出して」の順（入れる → 案を置く → 見本を見てもらう → 出力と保存は人）がある", () => {
    for (const d of [TOOLS.intake_add_files.description, TOOLS.screen_set.description]) {
      expect(d).toContain("「この様式で Excel を出して」");
      expect(d).toContain("templateLayout");
      expect(d).toContain("見本");
      expect(d).toContain("「この写し方で出力」");
    }
    expect(TOOLS.intake_add_files.description).toContain("source: template");
  });
});

describe("橋渡し：様式のファイルを確かめる", () => {
  const env = (stateDir: string | null) => ({ packsDir: PACKS, stateDir, repoRoot: REPO });

  it(".xlsx 1 つだけ。相対の道・`..`・状態フォルダとリポジトリの中・シンボリックリンクは断る。無い・.xlsx でない・8 MB を越えるものは断る", async () => {
    const state = temp("moyai-state-");
    const p = await templateFile();
    const ok = checkTemplateFile(p, env(state));
    expect(typeof ok === "string" ? ok : ok.name).toBe(`${NAME}.xlsx`);
    expect(checkTemplateFile("相対/様式.xlsx", env(state))).toBe("intake_path_not_allowed");
    expect(checkTemplateFile(`${dirname(p)}/../x/様式.xlsx`, env(state))).toBe("intake_path_not_allowed");
    writeFileSync(join(state, "中.xlsx"), await templateBytes());
    expect(checkTemplateFile(join(state, "中.xlsx"), env(state))).toBe("intake_path_not_allowed");
    expect(checkTemplateFile(join(REPO, "package.json"), env(state))).toBe("intake_path_not_allowed");
    expect(checkTemplateFile(join(dirname(p), "無い.xlsx"), env(state))).toBe("intake_template_missing");
    const csv = join(dirname(p), "a.csv");
    writeFileSync(csv, "x");
    expect(checkTemplateFile(csv, env(state))).toBe("intake_template_missing");
    expect(checkTemplateFile(dirname(p), env(state))).toBe("intake_template_missing");
    const big = join(dirname(p), "big.xlsx");
    const fd = openSync(big, "w");
    ftruncateSync(fd, 8 * 1024 * 1024 + 1);
    closeSync(fd);
    expect(checkTemplateFile(big, env(state))).toBe("intake_template_missing");
    let linked = true;
    try {
      symlinkSync(p, join(dirname(p), "link.xlsx"), "file");
    } catch {
      linked = false;
      console.log("シンボリックリンクを作る権限が無いので、リンクの確かめは飛ばした");
    }
    if (linked) expect(checkTemplateFile(join(dirname(p), "link.xlsx"), env(state))).toBe("intake_path_not_allowed");
    expect(collectIntake({ source: "template", path: p }, env(state))).toMatchObject({ source: "template", pack: null, facilityName: null, refused: [], others: 0 });
  });
});

describe("送り手と受け手：中継 → 橋渡し → 作業画面", () => {
  it("様式を入れる：作業画面は EXPORT の様式の欄に入れ（保存しない）、AI には様式の形と計画の階層の名前だけを返す", async () => {
    setWorkingPlan(layoutPlan(), "intake");
    const { tb, client, calls } = await chain();
    const p = await templateFile();
    const r: any = await client.callTool({ name: "intake_add_files", arguments: { source: "template", path: p } });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    const out = r.structuredContent;
    expect(TOOLS.intake_add_files.output.safeParse(out).success).toBe(true);
    expect(out).toMatchObject({ source: "template", pack: null, added: [{ name: `${NAME}.xlsx`, sheets: 3, rows: null }], refused: [], refusedTotal: 0, others: 0 });
    expect(out.template.name).toBe(NAME);
    expect(out.template.sheets.map((s: { name: string }) => s.name)).toEqual([SHEET_INFO, SHEET_FIRST, SHEET_LATER]);
    expect(out.template.sheets[1].texts).toContainEqual({ cell: "F7", text: "記入区分" });
    expect(out.template.sheets[1].formulas).toContainEqual({ cell: "G8", yearRef: { sheet: null, cell: "C6", add: 0 } });
    expect(out.planLevels).toHaveLength(4);
    expect(out.note).toContain("templateLayout");
    // 作業画面へは道を渡さない。様式は画面の中の置き場に入り、EXPORT が開く。保存先には何も書いていない
    expect(JSON.stringify(calls[0]!.args)).not.toContain(dirname(p));
    expect(knownTemplate(NAME)).toMatchObject({ name: NAME, saved: null });
    expect(fakeLocation.hash).toBe(GO_HASH.export);
    expect(tb.bridge.tools.stagedCount()).toBe(0);
  });

  it("値の入ったデータの行がある様式は、その行の字と値を AI に返さない（形と数だけ）", async () => {
    const { client } = await chain();
    const r: any = await client.callTool({ name: "intake_add_files", arguments: { source: "template", path: await templateFile({ filled: true }) } });
    expect(r.isError).toBeFalsy();
    const text = JSON.stringify(r);
    for (const v of ["架空の秘密の設備", "架空の秘密の部位", "架空の秘密の作業", "1234.5"]) expect(text).not.toContain(v);
    expect(r.structuredContent.template.sheets[1].dataRows).toMatchObject({ from: 9, to: 11 });
    // 計画が無ければ階層の名前は null
    expect(r.structuredContent.planLevels).toBeNull();
  });

  it("道の外れ・無いファイル・読めないファイルは、作業画面に渡さずに誤りの文で返す", async () => {
    const { tb, client, calls } = await chain();
    const d = temp();
    const broken = join(d, "壊れた.xlsx");
    writeFileSync(broken, "PK これは xlsx ではない");
    for (const [path, code] of [
      ["相対/様式.xlsx", "intake_path_not_allowed"],
      [join(tb.stateDir, "x.xlsx"), "intake_path_not_allowed"],
      [join(d, "無い.xlsx"), "intake_template_missing"],
      [broken, "intake_template_unreadable"],
    ] as const) {
      const e: any = await client.callTool({ name: "intake_add_files", arguments: { source: "template", path } });
      expect(e.isError, path).toBe(true);
      expect(e.content).toEqual([{ type: "text", text: ERRORS[code].text }]);
    }
    expect(calls).toHaveLength(0);
  });

  it("写し方の案を置く：様式に照らして下書きとして置き、数だけを返す。合わない案・無い様式は置かずに理由を返す。保存はしない", async () => {
    setWorkingPlan(layoutPlan(), "intake");
    const { tb, client } = await chain();
    const storage = temp("moyai-root-");
    writeSettings(tb.stateDir, { v: 1, root: storage, ledger: null, name: null });
    await client.callTool({ name: "intake_add_files", arguments: { source: "template", path: await templateFile() } });
    fakeLocation.hash = "#/";
    const run = async (args: Record<string, unknown>) => {
      const r: any = await client.callTool({ name: "screen_set", arguments: args });
      expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
      return r.structuredContent;
    };
    const placed = await run({ templateLayout: { ...layoutFor(), template: NAME } });
    expect(placed.changed).toEqual(["templateLayout"]);
    expect(placed.refused).toEqual([]);
    expect(placed.current.templateLayout).toMatchObject({
      template: NAME,
      draft: true,
      summary: { startYear: 2000, details: 8, outOfRange: 1, amountMissing: 1, taxMismatch: 1, taxUnknown: 1, orphans: 0, facility: { written: 2, missing: [] } },
    });
    expect(placed.current.templateLayout.summary.sheets).toEqual([
      { sheet: SHEET_FIRST, rows: 17, inserted: 6, firstYear: 2000, lastYear: 2008, totalRow: 26 },
      { sheet: SHEET_LATER, rows: 17, inserted: 6, firstYear: 2009, lastYear: 2017, totalRow: 26 },
    ]);
    // 金額の値は返さない
    expect(JSON.stringify(placed)).not.toContain("1734.567");
    expect(layoutDraft(NAME)).toMatchObject({ template: NAME, author: "ai", layout: layoutFor() });
    expect(fakeLocation.hash).toBe(GO_HASH.export);

    const bad = await run({ templateLayout: { ...layoutFor({ sheets: [{ ...layoutFor().sheets[0]!, sheet: "無いシート" }] }), template: NAME } });
    expect(bad.changed).toEqual([]);
    expect(bad.refused).toEqual([expect.objectContaining({ item: "templateLayout", reason: "layout_invalid" })]);
    expect(bad.refused[0].text).toContain("シート「無いシート」が様式に無い");
    // 前の案はそのまま
    expect(layoutDraft(NAME)?.layout).toEqual(layoutFor());
    const unknown = await run({ templateLayout: { ...layoutFor(), template: "無い様式" } });
    expect(unknown.refused).toEqual([expect.objectContaining({ item: "templateLayout", reason: "template_unknown" })]);
    // ツールの道では、保存先に様式も写し方も置かない（出力と保存は人が押す）
    expect(existsSync(join(storage, "様式"))).toBe(false);
    expect(readdirSync(storage)).toEqual([]);
  });
});

describe("人が「この写し方で出力」を押す道（画面の関数）", () => {
  it("見本は出力と同じ関数で書く。保存する写し方には案が入り、保存先から読み直しても同じ Excel になる", async () => {
    setWorkingPlan(layoutPlan(), "intake");
    const w = ws();
    const bytes = await templateBytes();
    const fileId = "t".repeat(22);
    const r = await addFilesFromBridge(w, { source: "template", pack: null, facilityName: null, files: [{ fileId, name: `${NAME}.xlsx`, size: bytes.length }] }, async () => bytes);
    expect(r.ok).toBe(true);
    const placed = runTabTool(w, "screen_set", { templateLayout: { ...layoutFor(), template: NAME } }, CTX);
    expect(placed.ok).toBe(true);
    const k = knownTemplate(NAME)!;
    const layout = layoutDraft(NAME)!.layout;
    const input = { plan: layoutPlan(), catalog: catalog(), asOf: "2026-11-07" };
    // 見本：計画の表は明細の最初の 20 行と合計の行、基本情報のシートも
    const preview = await buildPreview(k.bytes, layout, input);
    if (preview.kind !== "ready") throw new Error(preview.kind === "error" ? preview.message : "reading");
    expect(preview.grids.map((g) => g.sheet)).toEqual([SHEET_INFO, SHEET_FIRST, SHEET_LATER]);
    expect(preview.grids[1]!.rows.find((x) => x.n === 12)!.cells[3]).toMatchObject({ text: "架空のバケット", written: true });
    // 保存する写し方（columns.json）：案が入り、保存先の形の確かめを通る
    const columns = layoutColumns(k.probe as never, layout);
    expect(columns).toMatchObject({ schema: "moyai.columns/0", headerRow: 8, layout });
    const root = temp("moyai-root-");
    const saved = await saveTemplate(root, NAME, k.bytes, columns);
    if (!saved.ok) throw new Error(saved.reason);
    const listed = await listTemplates(root, new Map());
    expect(listed).toEqual([expect.objectContaining({ name: NAME, current: true, approval: null, columns })]);
    // 画面で書いた Excel と、保存先から読み直して書いた Excel（署名して書き出すときの道）は同じ中身
    const a = await writeTemplate(new ExcelJS.Workbook(), k.bytes, columns, input);
    const back = (await readTemplateVersion(root, NAME, saved.version))!;
    const b = await writeTemplate(new ExcelJS.Workbook(), back.bytes, back.columns, input);
    const [wa, wb] = [new ExcelJS.Workbook(), new ExcelJS.Workbook()];
    await wa.xlsx.load(a.bytes as unknown as ArrayBuffer);
    await wb.xlsx.load(b.bytes as unknown as ArrayBuffer);
    for (const n of [SHEET_INFO, SHEET_FIRST, SHEET_LATER]) expect(wa.getWorksheet(n)!.getSheetValues()).toEqual(wb.getWorksheet(n)!.getSheetValues());
    expect(a.summary).toEqual(b.summary);
    // 置き場の様式は、出力するまで「未保存」
    expect(pendingTemplates({ known: [k], drafts: new Map() })).toHaveLength(1);
    expect(existsSync(join(root, "様式", NAME, "columns.json"))).toBe(true);
    expect(typeof useTemplateDrafts).toBe("function");
  });
});
