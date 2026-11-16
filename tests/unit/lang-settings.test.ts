// 作業画面の言語の設定（2026-11-16、運営者「グローバル対応」）：settings.json の lang・settings_save と settings_read・握手（bridge.welcome）の lang・
// 書き出しの Excel の言語（出力のときの言語）・公開の台帳のページの言語。どれも一時のフォルダで行う。計画は架空。
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { HumanService } from "../../src/bridge/human";
import { readSettings, writeSettings } from "../../src/bridge/places";
import { getLang } from "../../src/app/text/i18n";
import { catalogFromPack } from "../../src/plan/chart";
import { planWorkbook } from "../../src/plan/export";
import { Plan } from "../../src/shared/plan";
import { truthToPlan } from "../fixtures/chart/truth-to-plan.mjs";
import { FakeTab, SECRET_A, startTestBridge, type TestBridge } from "../helpers/bridge";

const dirs: string[] = [];
let tb: TestBridge | null = null;
afterEach(async () => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  await tb?.close();
  tb = null;
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "moyai-lang-"));
  dirs.push(d);
  return d;
};

describe("settings.json の lang", () => {
  it("en と ja だけを読む。ほかの値と無いときは置かない（画面は PC の言語）", () => {
    const sd = temp();
    writeSettings(sd, { v: 1, root: null, ledger: null, name: null, lang: "en" });
    expect(readSettings(sd).lang).toBe("en");
    writeSettings(sd, { v: 1, root: null, ledger: null, name: null, lang: "fr" as never });
    expect(readSettings(sd).lang).toBeUndefined();
    writeSettings(sd, { v: 1, root: null, ledger: null, name: null });
    expect(readSettings(sd).lang).toBeUndefined();
  });

  it("settings_save は送られたときだけ言語を変え（null は消す）、settings_read が返す", async () => {
    const d = temp();
    const stateDir = join(d, "state");
    mkdirSync(stateDir, { recursive: true });
    const human = new HumanService({ stateDir, packsDir: resolve("packs"), now: () => Date.parse("2026-11-16T00:00:00Z"), platform: "linux", env: {} });
    const call = async (action: string, payload: unknown): Promise<any> => human.handle({ action: action as never, payload: JSON.stringify(payload), session: "s1" });
    expect((await call("settings_read", {})).lang).toBeNull();
    expect(await call("settings_save", { root: null, lang: "en" })).toMatchObject({ ok: true });
    expect((await call("settings_read", {})).lang).toBe("en");
    // ほかの欄だけを保存しても、言語は前のまま
    expect(await call("settings_save", { root: null, name: "【架空】試験の人" })).toMatchObject({ ok: true });
    expect(readSettings(stateDir).lang).toBe("en");
    expect(await call("settings_save", { root: null, lang: null })).toMatchObject({ ok: true });
    expect(readSettings(stateDir).lang).toBeUndefined();
    expect(await call("settings_save", { root: null, lang: "de" })).toMatchObject({ ok: false, reason: "payloadInvalid" });
  });
});

describe("握手（bridge.welcome）の lang", () => {
  async function welcome(t: TestBridge) {
    const tab = new FakeTab(`ws://${t.host}/ws`, t.origin);
    await tab.opened;
    tab.send("tab.hello", { secret: SECRET_A, build: "test" });
    const w = await tab.next("bridge.welcome");
    tab.ws.close();
    return w;
  }

  it("設定に言語があれば送り、無ければ送らない（握手のたびに設定を読む）", async () => {
    tb = await startTestBridge();
    expect((await welcome(tb)).lang).toBeUndefined();
    writeSettings(tb.stateDir, { v: 1, root: null, ledger: null, name: null, lang: "en" });
    expect((await welcome(tb)).lang).toBe("en");
  });
});

describe("書き出しの Excel の言語", () => {
  const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  const work = json("packs/_kinds/work.json");
  const catalog = catalogFromPack(json("packs/waste-incineration/common.json"), work);
  const empty = catalogFromPack({ systems: [] }, work);
  const plan = Plan.parse(truthToPlan("fictional-1"));
  const read = async (buf: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return wb;
  };

  it("lang: en はシート名・題・凡例・見出しが英語。無ければ日本語（今までの出力のまま）。画面の言語は変えない", async () => {
    const en = await read(await planWorkbook({ plan, version: 2, at: "2026-11-03T10:00:00.000Z", catalog, emptyCatalog: empty, lang: "en" }));
    expect(en.worksheets.map((w) => w.name)).toEqual(["Hoshitori", "Common equipment items"]);
    const ws = en.getWorksheet("Hoshitori")!;
    expect(String(ws.getCell(1, 1).value)).toContain("Maintenance schedule");
    expect(String(ws.getCell(1, 1).value)).toContain("[Fictional]");
    expect(String(ws.getCell(3, 2).value)).toContain("v2");
    expect(String(ws.getCell(4, 1).value)).toContain("○ Plan");
    const head = (ws.getRow(6).values as unknown[]).map(String);
    expect(head).toContain("FY2026");
    expect(head.slice(-4)).toEqual(["Next", "Due", "Basis", "Notes"]);
    expect(en.creator).toBe("[Fictional]");
    expect(getLang()).toBe("ja");

    const ja = await read(await planWorkbook({ plan, version: 2, at: "2026-11-03T10:00:00.000Z", catalog, emptyCatalog: empty }));
    expect(ja.worksheets.map((w) => w.name)).toEqual(["星取表", "共通の設備項目"]);
    expect((ja.getWorksheet("星取表")!.getRow(6).values as unknown[]).slice(-4)).toEqual(["次回", "期限", "根拠", "備考"]);
  });
});
