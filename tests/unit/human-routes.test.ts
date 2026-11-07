// human-only（docs/plan.md §5.1）の続き：確定・版・設定・輪と鍵・検問所の人だけの経路。
// どの経路も、素の HTTP・タブの秘密の無い要求・Origin の無い要求・偽った Origin で秘密なし・使い終えた印・切れた印を拒む。拒む試験は消さない。
// あわせて、正しいタブから、Documents が日本語の OneDrive の下にある PC の形で、確定 → 輪を作る → 検問所 → 送る → 確かめるを通す。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aiDecisions } from "../../src/plan/diff";
import { HEADER_TAB_SECRET, ROUTES, ROUTE_IDS, type HumanAction, type RouteDef } from "../../src/shared/routes";
import { EXPOSED_TOOL_NAMES, TOOL_NAMES } from "../../src/shared/tools";
import { truthToPlan } from "../fixtures/chart/truth-to-plan.mjs";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { exportExcelName, exportSignatureName, signExport } from "../../src/plan/exports";
import { signLatest } from "../../src/plan/store";
import { otherSigner } from "../helpers/signer";
import { buildLedgerDemo } from "../../scripts/ledger/demo-core";
import { FakeTab, SECRET_A, http, startTestBridge, type TestBridge } from "../helpers/bridge";
import { STUB_TOKEN, startGitHubStub } from "../helpers/github-stub";
import type { GitHubIo } from "../../src/bridge/github";
import { CIRCLE_V, envelopeText, makeMemberBody, makeRulesDocBody } from "../../src/share/bundle";
import { generateKeyPair, keyIdOf, openPlainKey, signBody, type PlainKey } from "../../src/share/sign";
import type { IntakeIo } from "../../src/bridge/ledger-intake";
import { readLedgers } from "../../src/bridge/places";
import { readLedgerDir, verifyLedgerFiles } from "../../src/share/ledger";
import { handleRequest } from "../../services/ledger-intake/src/handler";
import { packOf } from "../../services/ledger-intake/src/packs";
import { fakeLedgerGitHub, memoryKv } from "../helpers/intake-github";
import { SHEET_FIRST, layoutFor, templateBytes } from "../helpers/template-layout";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const sha256Of = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const NEW_ROUTES = ROUTE_IDS.filter((id) => ROUTES[id].kind === "human" && id !== "commitTrial");
/** 人だけの経路の道と操作の名前 */
const R = (id: (typeof NEW_ROUTES)[number]) => ROUTES[id] as RouteDef & { path: string; action: HumanAction };

let tb: TestBridge | null = null;
let extra = "";
afterEach(async () => {
  await tb?.close();
  tb = null;
  if (extra) rmSync(extra, { recursive: true, force: true });
  extra = "";
});

async function tab(t: TestBridge) {
  const tb = new FakeTab(`ws://${t.host}/ws`, t.origin);
  await tb.opened;
  tb.send("tab.hello", { secret: SECRET_A, build: "test" });
  await tb.next("bridge.welcome");
  let n = 0;
  return {
    tab: tb,
    async token(action: HumanAction, payload: string): Promise<string> {
      const requestId = `r${++n}`;
      tb.send("tab.token_request", { requestId, action, payloadHash: sha(payload) });
      const tok = await tb.next("bridge.token");
      return tok.token as string;
    },
  };
}

const good = (t: TestBridge) => ({ "content-type": "application/json", origin: t.origin, "sec-fetch-site": "same-origin", [HEADER_TAB_SECRET]: SECRET_A });
const post = (t: TestBridge, path: string, headers: Record<string, string>, body: unknown) => http(t.bridge.port, "POST", path, headers, JSON.stringify(body));

describe("新しい人だけの経路は、どれも守りを越えさせない", () => {
  it("人だけの経路が増えた（確定・版・設定・輪・検問所）。どれも MCP のツールに無い", () => {
    expect(NEW_ROUTES.sort()).toEqual(["planCommit", "planFileRead", "planRevert", "planSign", "requestReceive", "requestRenew", "planStatus", "plansList", "planVersionRead", "commentAdd", "commentsList", "personKeyCreate", "personKeyConfirm", "ringCreate", "ringVerify", "ringMemberConfirm", "ringRulesAccept", "facilityKeyRotate", "settingsRead", "settingsSave", "checkpointOpenText", "checkpointPreview", "checkpointSend", "photoAllow", "peersCompare", "readingsRead", "readingsLineage", "planSourcePut", "planSourceRead", "templatesRead", "templateSave", "templateFileRead", "exportSign", "exportFileRead", "ledgerPreview", "ledgerSend", "ledgerIntakeSend", "ledgerRulesAccept", "ledgerPrs", "githubConnectStart", "githubConnectState", "githubDisconnect"].sort());
    for (const id of NEW_ROUTES) {
      const r: RouteDef = ROUTES[id];
      expect(r.requires).toEqual({ tabSecret: true, oneTimeToken: true });
      for (const n of [...TOOL_NAMES, ...EXPOSED_TOOL_NAMES]) expect(n).not.toBe(r.action);
    }
  });

  it.each(NEW_ROUTES)("%s：素の HTTP（Origin も秘密も無い）を拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const path = R(id).path;
    const t = await token(R(id).action, "{}");
    expect((await http(tb.bridge.port, "GET", path)).body.error.code).toBe("method_not_allowed");
    const r = await post(tb, path, { "content-type": "application/json" }, { token: t, payload: "{}" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("origin_missing");
  });

  it.each(NEW_ROUTES)("%s：タブの秘密が無ければ、正しい Origin と印でも拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    const r = await post(tb, R(id).path, { "content-type": "application/json", origin: tb.origin }, { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("secret_missing");
  });

  it.each(NEW_ROUTES)("%s：Origin の無い要求は、秘密と印がそろっていても拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    const r = await post(tb, R(id).path, { "content-type": "application/json", [HEADER_TAB_SECRET]: SECRET_A }, { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("origin_missing");
  });

  it.each(NEW_ROUTES)("%s：偽った Origin で秘密なしの要求を拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    const r = await post(tb, R(id).path, { "content-type": "application/json", origin: "http://evil.example" }, { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("origin_not_allowed");
  });

  it.each(NEW_ROUTES)("%s：使い終えた印を拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    const first = await post(tb, R(id).path, good(tb), { token: t, payload: "{}" });
    expect(first.status).toBe(200);
    const again = await post(tb, R(id).path, good(tb), { token: t, payload: "{}" });
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe("token_unknown");
  });

  it.each(NEW_ROUTES)("%s：切れた印（120 秒）を拒む", async (id) => {
    let now = 1_000_000;
    tb = await startTestBridge({ now: () => now });
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    now += 120_001;
    const r = await post(tb, R(id).path, good(tb), { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("token_expired");
  });

  it.each(NEW_ROUTES)("%s：ほかの操作に結んだ印では通らない", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const other: HumanAction = R(id).action === "plan_status" ? "settings_read" : "plan_status";
    const t = await token(other, "{}");
    const r = await post(tb, R(id).path, good(tb), { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("token_mismatch");
  });
});

describe("正しいタブから：確定 → 輪を作る → 検問所 → 送る → 確かめる（Documents が日本語の OneDrive の下）", () => {
  it("端まで通る。中身の形が違う・理由が空のものは断る", async () => {
    // 輪のフォルダの道も固有名詞の照らす相手なので、乱数の英字（計画の語と偶然重なる）を入れない名前にする（数だけは照らさない）
    extra = join(tmpdir(), `moyai-human-${process.pid}-${Date.now()}`);
    mkdirSync(extra, { recursive: true });
    const docs = join(extra, "利用者", "OneDrive", "ドキュメント");
    const onedrive = join(extra, "利用者", "OneDrive");
    tb = await startTestBridge({ human: { platform: "win32", env: { OneDrive: onedrive }, shell: async () => ({ documents: docs, mounts: [] }), openText: () => {} } });
    const t = await tab(tb);
    const call = async (id: (typeof NEW_ROUTES)[number], payload: unknown) => {
      const text = JSON.stringify(payload);
      const tok = await t.token(R(id).action, text);
      const r = await post(tb!, R(id).path, good(tb!), { token: tok, payload: text });
      expect(r.status, id).toBe(200);
      return r.body;
    };

    // 設定：Documents は OneDrive の下、既定の置き場所はその下の MOYAI
    const s = await call("settingsRead", {});
    expect(s.documents).toBe(docs);
    expect(s.documentsSynced).toEqual({ kind: "onedrive", base: onedrive });
    expect(s.root).toBe(join(docs, "MOYAI"));
    expect(s.packs.find((p: { id: string }) => p.id === "waste-incineration")?.ready).toBe(true);
    expect((await call("settingsSave", { root: "相対の道" })).reason).toBe("rootInvalid");

    // 確定：人が受けていない決定（AI の当てはめ）を受け、理由つきで
    const plan = truthToPlan("fictional-1");
    const st = await call("planStatus", { planId: plan.planId });
    expect(st).toMatchObject({ ok: true, latest: null, synced: { kind: "onedrive" } });
    const ds = aiDecisions(plan);
    expect(ds.length).toBeGreaterThan(0);
    // 署名：呼び名が無ければ鍵を作れない。呼び名を決め、自分の鍵を作る（合言葉はやめた）
    expect((await call("personKeyCreate", {})).reason).toBe("nameMissing");
    expect((await call("planCommit", { plan, reason: "試験の確定", acceptances: [], basedOn: null })).reason).toBe("nameMissing");
    expect((await call("settingsSave", { root: null, name: "山田/課長" })).reason).toBe("nameInvalid");
    expect(await call("settingsSave", { root: null, name: "【架空】試験の人" })).toMatchObject({ ok: true, name: "【架空】試験の人" });
    expect((await call("planCommit", { plan, reason: "試験の確定", acceptances: [], basedOn: null })).reason).toBe("personKeyMissing");
    const key = await call("personKeyCreate", {});
    expect(key).toMatchObject({ ok: true, name: "【架空】試験の人" });
    expect((await call("personKeyCreate", {})).reason).toBe("personKeyExists");
    // 担当者の範囲の読み方の持ち主は、署名する人だけ（タブから来たほかの呼び名は断る。監査 D2）
    expect((await call("planCommit", { plan, reason: "試験の確定", acceptances: [], basedOn: null, readings: [{ skill: {}, by: "【架空】ほかの人", facilityKey: null }] })).reason).toBe("readingInvalid");
    // 計画ルールは、この署名で人が受けた周期の案（R）のもとになったものだけを載せる。案の無いルールは断る（Architect の 42 の 2）
    const planRuleSkill = {
      schema: "moyai.reading/0",
      name: "【架空】計画ルール",
      scope: "company",
      rules: [{ id: "p1", text: "灰クレーンの整備は 5 年ごと", kind: "planCycle", commonItem: "WI.CRANE.ASH", attribute: "OVERHAUL", years: 5, author: "ai", reason: "会話で直した" }],
    };
    expect((await call("planCommit", { plan, reason: "試験の確定", acceptances: [], basedOn: null, readings: [{ skill: planRuleSkill, by: null, facilityKey: null }] })).reason).toBe("readingInvalid");
    expect(existsSync(join(docs, "MOYAI", "skills", "会社", "【架空】計画ルール"))).toBe(false);
    expect((await call("planCommit", { plan, reason: "", acceptances: [], basedOn: null })).reason).toBe("reasonEmpty");
    expect((await call("planCommit", { plan, reason: "試験の確定", acceptances: [], basedOn: null })).reason).toBe("pendingDecisions");
    const c = await call("planCommit", { plan, reason: "試験の確定", acceptances: ds.map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" })), basedOn: null });
    expect(c).toMatchObject({ ok: true, version: 1 });
    // 版の一覧には、確かめた署名と、この PC の鍵として信じた印（own）と指紋
    const st1 = await call("planStatus", { planId: plan.planId });
    expect(st1.versions[0].signatures).toMatchObject([{ role: "confirm", by: "【架空】試験の人", trust: "own", fingerprint: key.fingerprint }]);
    expect(st1).toMatchObject({ name: "【架空】試験の人", hasKey: true });
    expect(existsSync(c.files.version)).toBe(true);
    expect(existsSync(c.files.report)).toBe(true);
    expect(c.files.version.startsWith(join(docs, "MOYAI", "plans"))).toBe(true);
    // 書き出しと差分レポートのハッシュは署名の中にあり、落とすときに照らす。書き換えたファイルは渡さない（監査 E1）
    const rec = JSON.parse(readFileSync(c.files.version, "utf8"));
    expect(rec.files.report).toBe(createHash("sha256").update(readFileSync(c.files.report)).digest("hex"));
    expect(rec.files.export).toBe(createHash("sha256").update(readFileSync(c.files.export)).digest("hex"));
    const got = await call("planFileRead", { planId: plan.planId, version: 1, kind: "export" });
    expect(Buffer.from(got.base64, "base64").equals(readFileSync(c.files.export))).toBe(true);
    const report = readFileSync(c.files.report);
    writeFileSync(c.files.report, Buffer.concat([report, Buffer.from([0])]));
    expect((await call("planFileRead", { planId: plan.planId, version: 1, kind: "report" })).reason).toBe("fileChanged");
    writeFileSync(c.files.report, report);

    // 様式で書き出す（3C）：落とした様式は共有フォルダに下書きで置き、書き出した Excel に人が署名すると、その写し方が承認になる
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("様式3");
    sheet.getCell("A1").value = "【架空】長寿命化計画 様式 3";
    ["設備名", "作業区分", "周期（年）", "R3", "R4"].forEach((h, i) => (sheet.getCell(3, i + 1).value = h));
    const tplBytes = Buffer.from(await wb.xlsx.writeBuffer());
    const columns = { schema: "moyai.columns/0", headerRow: 3, headers: ["設備名", "作業区分", "周期（年）", "R3", "R4"], roles: [{ kind: "item" }, { kind: "work" }, { kind: "cycle" }, { kind: "year", fiscalYear: 2021 }, { kind: "year", fiscalYear: 2022 }] };
    expect((await call("templateSave", { name: "../外", base64: tplBytes.toString("base64"), columns })).reason).toBe("nameInvalid");
    expect((await call("templateSave", { name: "【架空】様式3", base64: Buffer.from("not xlsx").toString("base64"), columns })).reason).toBe("fileInvalid");
    const saved = await call("templateSave", { name: "【架空】様式3", base64: tplBytes.toString("base64"), columns });
    expect(saved).toMatchObject({ ok: true, name: "【架空】様式3" });
    expect(existsSync(join(docs, "MOYAI", "様式", "【架空】様式3", "template.xlsx"))).toBe(true);
    const t0 = await call("templatesRead", { planId: plan.planId });
    expect(t0.templates).toEqual([expect.objectContaining({ name: "【架空】様式3", version: saved.version, current: true, approval: null, exported: false })]);
    // 写し方だけを直すと、同じ名前の下書き（様式のファイルは共有フォルダのもの）
    const draft2 = await call("templateSave", { name: "【架空】様式3", base64: "", columns: { ...columns, roles: [...columns.roles.slice(0, 4), { kind: "none" }] }, from: saved.version });
    expect(draft2.version).not.toBe(saved.version);
    // 書き出して署名する：Excel を置き、版の書き出しの署名に足す。版の署名（確定・承認）には入らない
    const sx = await call("exportSign", { planId: plan.planId, version: 1, name: "【架空】様式3", templateVersion: saved.version });
    expect(sx).toMatchObject({ ok: true, version: 1 });
    const ex2 = await call("exportSign", { planId: plan.planId, version: 1, name: "【架空】様式3", templateVersion: draft2.version });
    expect(ex2.excel).not.toBe(sx.excel);
    const stx = await call("planStatus", { planId: plan.planId });
    expect(stx.versions[0].signatures.map((x: { role: string }) => x.role)).toEqual(["confirm"]);
    expect(stx.versions[0].exports.map((x: { template: { version: string }; trust: string }) => [x.template.version, x.trust]).sort()).toEqual([[saved.version, "own"], [draft2.version, "own"]].sort());
    // 自分の署名でも、信じる鍵の書き出しなら写し方の承認になる。前の版（承認済み）も消えずに並ぶ
    const t1 = await call("templatesRead", { planId: plan.planId });
    expect(t1.templates.map((t: { version: string; current: boolean; approval: { in: number; by: string } | null; exported: boolean }) => [t.version === saved.version, t.current, t.approval?.in ?? null, t.approval?.by ?? null, t.exported]).sort()).toEqual(
      [
        [true, false, 1, "【架空】試験の人", true],
        [false, true, 1, "【架空】試験の人", true],
      ].sort(),
    );
    // 落とすときは署名の SHA-256 と照らす。書き換えたファイルは渡さない
    const got1 = await call("exportFileRead", { planId: plan.planId, version: 1, name: "【架空】様式3", templateVersion: saved.version });
    expect(createHash("sha256").update(Buffer.from(got1.base64, "base64")).digest("hex")).toBe(sx.excel);
    const xl = join(docs, "MOYAI", "plans", plan.planId, "exports", `000001-${sx.excel.slice(0, 16)}.xlsx`);
    const keep = readFileSync(xl);
    writeFileSync(xl, Buffer.concat([keep, Buffer.from([0])]));
    expect((await call("exportFileRead", { planId: plan.planId, version: 1, name: "【架空】様式3", templateVersion: saved.version })).reason).toBe("fileChanged");
    writeFileSync(xl, keep);
    expect((await call("exportSign", { planId: plan.planId, version: 1, name: "【架空】様式3", templateVersion: "0".repeat(64) })).reason).toBe("templateUnknown");
    // 写し方の案（template-layout-v1）：案を入れた写し方も同じ道で置き、様式のファイルを版で照らして読み、署名して書き出すと案のとおりに書く
    const lb = Buffer.from(await templateBytes());
    const lcols = { schema: "moyai.columns/0", headerRow: 8, headers: ["設備"], roles: [{ kind: "none" }], layout: layoutFor() };
    const ls = await call("templateSave", { name: "【架空】様式L", base64: lb.toString("base64"), columns: lcols });
    expect(ls).toMatchObject({ ok: true, name: "【架空】様式L" });
    expect(JSON.parse(readFileSync(join(docs, "MOYAI", "様式", "【架空】様式L", "columns.json"), "utf8")).layout).toEqual(layoutFor());
    const lf = await call("templateFileRead", { name: "【架空】様式L", version: ls.version });
    expect(Buffer.from(lf.base64, "base64").equals(lb)).toBe(true);
    expect((await call("templateFileRead", { name: "【架空】様式L", version: "0".repeat(64) })).reason).toBe("templateUnknown");
    expect((await call("templateFileRead", { name: "../外", version: ls.version })).reason).toBe("templateUnknown");
    const lx = await call("exportSign", { planId: plan.planId, version: 1, name: "【架空】様式L", templateVersion: ls.version });
    expect(lx).toMatchObject({ ok: true, version: 1 });
    const lgot = await call("exportFileRead", { planId: plan.planId, version: 1, name: "【架空】様式L", templateVersion: ls.version });
    const lwb = new ExcelJS.Workbook();
    await lwb.xlsx.load(Buffer.from(lgot.base64, "base64") as unknown as ArrayBuffer);
    // 開始年度のセルに版の最初の年度、組のラベルの列に 4 行の組
    expect(lwb.getWorksheet(SHEET_FIRST)!.getCell("C6").value).toBe(Math.min(...plan.details.map((d) => d.fiscalYear)));
    const labels = new Set<unknown>();
    lwb.getWorksheet(SHEET_FIRST)!.getColumn("F").eachCell((c) => labels.add(c.value));
    for (const l of ["予定内容", "予定金額", "実績内容", "実績金額"]) expect(labels.has(l)).toBe(true);
    // 様式に合わない案の写し方は、書き出さない
    const bad = { ...lcols, layout: layoutFor({ sheets: [{ ...layoutFor().sheets[0]!, sheet: "無いシート" }] }) };
    const lsBad = await call("templateSave", { name: "【架空】様式L", base64: "", columns: bad, from: ls.version });
    expect((await call("exportSign", { planId: plan.planId, version: 1, name: "【架空】様式L", templateVersion: lsBad.version })).reason).toBe("templateLayoutInvalid");
    // 保存先に書ける人が、自分で作った鍵で偽の Excel と先の時刻の書き出しの署名を置いても、信じる鍵の書き出しが落ちる。
    // 渡した書き出しの署名者を返す（画面は、その 1 つについて鍵の警告を出す。Architect の 3C の直し）
    const forger = otherSigner("【架空】書き換えた人");
    const fake = Buffer.from("PK偽の Excel");
    const fakeHash = createHash("sha256").update(fake).digest("hex");
    const pdir = join(docs, "MOYAI", "plans", plan.planId);
    const st1x = await call("planStatus", { planId: plan.planId });
    const tpl1 = st1x.versions[0].exports.find((x: { template: { version: string } }) => x.template.version === saved.version).template;
    writeFileSync(join(pdir, "exports", exportExcelName(1, fakeHash)), fake);
    const forged = signExport({ planId: plan.planId, version: 1, contentHash: st1x.versions[0].contentHash, by: forger.by, at: "2099-01-01T00:00:00.000Z", template: tpl1, excel: fakeHash }, forger.pair);
    writeFileSync(join(pdir, "signatures", exportSignatureName(1, keyIdOf(forger.pair.pub), fakeHash)), JSON.stringify(forged));
    const got2 = await call("exportFileRead", { planId: plan.planId, version: 1, name: "【架空】様式3", templateVersion: saved.version });
    expect(createHash("sha256").update(Buffer.from(got2.base64, "base64")).digest("hex")).toBe(sx.excel);
    expect(got2.signer).toMatchObject({ by: "【架空】試験の人", trust: "own" });
    // template.version が file・columns と食い違う署名は、形の外れとして数えない（Architect の小 2）
    const odd = signExport({ planId: plan.planId, version: 1, contentHash: st1x.versions[0].contentHash, by: forger.by, at: "2099-01-01T00:00:00.000Z", template: { ...tpl1, version: "f".repeat(64) }, excel: fakeHash }, forger.pair);
    writeFileSync(join(pdir, "signatures", exportSignatureName(1, keyIdOf(forger.pair.pub), "f".repeat(64))), JSON.stringify(odd));
    expect((await call("planStatus", { planId: plan.planId })).versions[0].exports.some((x: { template: { version: string } }) => x.template.version === "f".repeat(64))).toBe(false);
    // 先に別の中身が同じ名前で置かれていても、書き出すと置き換える（落とすたびに fileChanged にしない。Architect の小 1）
    writeFileSync(join(pdir, "exports", exportExcelName(1, sx.excel)), Buffer.from("PK別の中身"));
    expect((await call("exportSign", { planId: plan.planId, version: 1, name: "【架空】様式3", templateVersion: saved.version })).ok).toBe(true);
    expect((await call("exportFileRead", { planId: plan.planId, version: 1, name: "【架空】様式3", templateVersion: saved.version })).ok).toBe(true);

    // 輪を作る
    const ringRoot = join(extra, "輪");
    const rc = await call("ringCreate", { root: ringRoot, packId: "waste-incineration" });
    expect(rc).toMatchObject({ ok: true });
    expect(rc.fingerprint).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);

    // 検問所：見え方が決まるまでは送れない。決まれば数はすべて 0、k ≥ 5
    const pv0 = await call("checkpointPreview", { planId: plan.planId, ringId: rc.ringId, answers: { facility: {}, inNationalTable: true } });
    expect(pv0.view.blockers).toContain("profileIncomplete");
    expect(pv0.questions.map((q: { key: string }) => q.key)).toEqual(["furnace", "capacity_t_per_day", "turbine", "ash", "contract"]);
    const answers = { facility: { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };
    const pv = await call("checkpointPreview", { planId: plan.planId, ringId: rc.ringId, answers });
    expect(pv.view.blockers).toEqual([]);
    expect(pv.view.counts).toEqual({ shape: 0, properNoun: 0, money: 0, freeText: 0, exactDate: 0 });
    expect(pv.view.k).toBeGreaterThanOrEqual(5);
    expect(sha(pv.view.bodyText)).toBe(pv.view.bodyHash);

    // 送る：人が押せば署名して置き、受け手と同じ関数で ✓
    const sent = await call("checkpointSend", { planId: plan.planId, version: 1, ringId: rc.ringId, answers, previewHash: pv.view.bodyHash });
    expect(sent).toMatchObject({ ok: true, seq: 1 });
    expect(sent.report.ok).toBe(true);
    const v = await call("ringVerify", { ringId: rc.ringId });
    // 仲間は 2 行：輪を作った人の鍵と、束に署名した施設の鍵（保管先の計画のフォルダ share/keys/。docs/plan.md §2.19）
    expect(v.report.lines.map((l: { kind: string; status: string }) => `${l.kind}:${l.status}`)).toEqual(["circle:ok", "member:ok", "member:ok", "bundle:ok"]);
    expect(readdirSync(join(docs, "MOYAI", "plans", plan.planId, "share", "keys"))).toEqual([`${rc.ringId}.json`]);
    expect(readdirSync(join(docs, "MOYAI", "plans", plan.planId, "share", "sent"))).toEqual([`${rc.ringId}.json`]);

    // 輪の仲間（監査 D1）：まだ確かめていない仲間は、指紋を読み合わせて確認済みにする（その輪に、その公開鍵の仲間のファイルがあるときだけ）
    const peer = generateKeyPair();
    const peerBody = makeMemberBody(rc.ringId, keyIdOf(peer.pub), peer.pub, "2026-11");
    writeFileSync(join(ringRoot, rc.ringId, "members", `${keyIdOf(peer.pub)}.json`), envelopeText(peerBody, signBody(peerBody, peer.privateKey)));
    const v2 = await call("ringVerify", { ringId: rc.ringId });
    expect(v2.report.lines.find((l: { kind: string; pub?: string }) => l.kind === "member" && l.pub === peer.pub)?.reasons).toEqual(["member.unconfirmed"]);
    expect((await call("ringMemberConfirm", { ringId: rc.ringId, pub: generateKeyPair().pub })).reason).toBe("keyUnknown");
    expect(await call("ringMemberConfirm", { ringId: rc.ringId, pub: peer.pub })).toMatchObject({ ok: true, key: keyIdOf(peer.pub) });
    const v3 = await call("ringVerify", { ringId: rc.ringId });
    expect(v3.report.lines.find((l: { kind: string; pub?: string }) => l.kind === "member" && l.pub === peer.pub)?.status).toBe("ok");

    // 輪の決まりが変わった（輪を作った人が、紛れる数の下限を 1 つ厳しくした）：差を見せ、人が受け入れるまで送らない
    const founderKey = openPlainKey(JSON.parse(readFileSync(join(tb.stateDir!, "keys", `${rc.ringId}.json`), "utf8")) as PlainKey)!;
    const circlePath = join(ringRoot, rc.ringId, "circle.json");
    const oldCircle = JSON.parse(readFileSync(circlePath, "utf8")).body;
    const nextBody = makeRulesDocBody(CIRCLE_V, oldCircle.founder, oldCircle.nonce, 2, "2026-11", { ...oldCircle.rules, minK: oldCircle.rules.minK + 1 });
    writeFileSync(circlePath, envelopeText(nextBody, signBody(nextBody, founderKey.privateKey)));
    const pvR = await call("checkpointPreview", { planId: plan.planId, ringId: rc.ringId, answers });
    expect(pvR.view.blockers).toContain("rules");
    expect(pvR.ring.rulesChange).toMatchObject({ loosened: 0, tightened: 1, rows: [{ rule: "minK", dir: "tightened" }], changer: { pub: oldCircle.founder, confirmed: true } });
    expect((await call("ringRulesAccept", { ringId: rc.ringId, rulesHash: "0".repeat(64) })).reason).toBe("previewChanged");
    expect(await call("ringRulesAccept", { ringId: rc.ringId, rulesHash: pvR.ring.rulesChange.rulesHash })).toMatchObject({ ok: true });
    const pvA = await call("checkpointPreview", { planId: plan.planId, ringId: rc.ringId, answers });
    expect(pvA.ring.rulesChange).toBeNull();
    expect(pvA.view.blockers).not.toContain("rules");

    // 版の履歴と戻す
    // EXPORT：確定した版の書き出しと差分レポートを読む。無い版は断る
    const ex = await call("planFileRead", { planId: plan.planId, version: 1, kind: "export" });
    expect(ex).toMatchObject({ ok: true, version: 1, kind: "export" });
    expect(Buffer.from(ex.base64, "base64").subarray(0, 2).toString()).toBe("PK");
    expect((await call("planFileRead", { planId: plan.planId, version: 1, kind: "report" })).ok).toBe(true);
    expect((await call("planFileRead", { planId: plan.planId, version: 9, kind: "export" })).reason).toBe("versionUnknown");
    const back = await call("planRevert", { planId: plan.planId, to: 1, reason: "試しに戻す", basedOn: 1 });
    expect(back).toMatchObject({ ok: true, version: 2 });
    // 新しく書き出せるのは最新の版だけ。古い版でも、もう置いてある書き出しは落とせる（Architect の縛り 4）
    expect((await call("exportSign", { planId: plan.planId, version: 1, name: "【架空】様式3", templateVersion: saved.version })).reason).toBe("notLatest");
    expect((await call("exportFileRead", { planId: plan.planId, version: 1, name: "【架空】様式3", templateVersion: saved.version })).ok).toBe(true);
    // 差戻された版は書き出さない（Architect の縛り 4）
    const returner = otherSigner("【架空】差し戻した人");
    expect(await signLatest({ root: join(docs, "MOYAI"), planId: plan.planId, version: 2, role: "return", reason: "直してください", signer: returner })).toMatchObject({ ok: true, role: "return" });
    expect((await call("exportSign", { planId: plan.planId, version: 2, name: "【架空】様式3", templateVersion: saved.version })).reason).toBe("returned");
    // 版が変わったので、前の版で見た検問所からは送らない
    const stale = await call("checkpointSend", { planId: plan.planId, version: 1, ringId: rc.ringId, answers, previewHash: pv.view.bodyHash });
    expect(stale.reason).toBe("versionChanged");
    // 最新の版を書き換えると（確かめで合わない版）、検問所は開かず、送らない
    const vf = join(docs, "MOYAI", "plans", plan.planId, "versions", "000002.json");
    writeFileSync(vf, readFileSync(vf, "utf8").replace("試しに戻す", "書き換えた理由"));
    expect((await call("checkpointPreview", { planId: plan.planId, ringId: rc.ringId, answers })).reason).toBe("historyBroken");
    expect((await call("checkpointSend", { planId: plan.planId, version: 2, ringId: rc.ringId, answers, previewHash: pv.view.bodyHash })).reason).toBe("historyBroken");
  });
});

describe("次の版に重ねる資料（1C・重-2）：先に置き、確定では SHA-256 だけを送り、あることとハッシュを照らす", () => {
  it("置いた資料と決定と受けた規則が版の記録に入り、版の資料だけを照らして読める。無い・違う資料では確定しない", async () => {
    extra = join(tmpdir(), `moyai-src-${process.pid}-${Date.now()}`);
    const root = join(extra, "MOYAI");
    mkdirSync(root, { recursive: true });
    tb = await startTestBridge();
    const t = await tab(tb);
    const call = async (id: (typeof NEW_ROUTES)[number], payload: unknown) => {
      const text = JSON.stringify(payload);
      return (await post(tb!, R(id).path, good(tb!), { token: await t.token(R(id).action, text), payload: text })).body;
    };
    expect(await call("settingsSave", { root, name: "【架空】試験の人" })).toMatchObject({ ok: true });
    expect(await call("personKeyCreate", {})).toMatchObject({ ok: true });
    const plan = truthToPlan("fictional-1");
    const acceptances = aiDecisions(plan).map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
    const bytes = Buffer.from("【架空】資料の中身");
    const put = await call("planSourcePut", { planId: plan.planId, base64: bytes.toString("base64") });
    expect(put).toMatchObject({ ok: true, sha256: sha256Of(bytes), size: bytes.length });
    // 置き場所は SHA-256 だけ（名前は道に使わない）
    expect(existsSync(join(root, "plans", plan.planId, "sources", put.sha256))).toBe(true);
    const missing = "0".repeat(64);
    const base = { plan, reason: "資料つきの確定", acceptances, basedOn: null };
    const rule = { when: [{ field: "assetNode.name", op: "equals", values: ["計量機"] }], set: { field: "assetNode.commonItem", value: "WI.RECV.SCALE" }, reason: "名前が同じ" };
    const decision = { questionId: "q-x", answer: "yes", author: "ai_relayed_human", reason: "会話で答えた", sources: [put.sha256] };
    // 置いていない資料・決定が版の資料の外を指す・名前に道の区切り は断る（黙って記録を欠かさない）
    expect((await call("planCommit", { ...base, sources: [{ name: "a.xlsx", sha256: missing, size: 3 }], decisions: [], crosswalk: [] })).reason).toBe("sourceMissing");
    expect((await call("planCommit", { ...base, sources: [{ name: "a.xlsx", sha256: put.sha256, size: bytes.length }], decisions: [{ ...decision, sources: [missing] }], crosswalk: [] })).reason).toBe("sourcesInvalid");
    expect((await call("planCommit", { ...base, sources: [{ name: "../a.xlsx", sha256: put.sha256, size: bytes.length }], decisions: [], crosswalk: [] })).reason).toBe("sourcesInvalid");
    const intake = { questions: 12, decisions: { human: 2, ai: 3, ai_relayed_human: 6, rule_code: 1 } };
    const c = await call("planCommit", { ...base, intake, sources: [{ name: "a.xlsx", sha256: put.sha256, size: bytes.length }], decisions: [decision], crosswalk: [{ rule, target: "assetNode", value: "WI.RECV.SCALE", basis: "案の根拠" }] });
    expect(c).toMatchObject({ ok: true, version: 1 });
    // 聞いた数（2A）は版の記録（署名の中）に入る。差分の頭に計画 ID と署名した人と聞いた数
    const rec = JSON.parse(readFileSync(c.files.version, "utf8"));
    expect(rec.intake).toEqual(intake);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(c.files.report);
    const head = [2, 3, 4].map((r) => (wb.worksheets[0]!.getRow(r).values as unknown[]).join("|"));
    expect(head[0]).toContain(plan.planId);
    expect(head[1]).toContain("聞いた質問 12");
    expect(head[2]).toContain("【架空】試験の人");
    // 版の記録（署名の中）に入り、plan_status の最新の版で読める
    const st = await call("planStatus", { planId: plan.planId });
    expect(st.latest.sources).toEqual([{ name: "a.xlsx", sha256: put.sha256, size: bytes.length }]);
    expect(st.latest.decisions).toEqual([decision]);
    expect(st.latest.crosswalk[0].value).toBe("WI.RECV.SCALE");
    const got = await call("planSourceRead", { planId: plan.planId, version: 1, sha256: put.sha256 });
    expect(got).toMatchObject({ ok: true, name: "a.xlsx" });
    expect(Buffer.from(got.base64, "base64").equals(bytes)).toBe(true);
    // 版の記録に無い資料は読ませない。書き換えた資料は渡さない
    expect((await call("planSourceRead", { planId: plan.planId, version: 1, sha256: missing })).reason).toBe("sourceUnknown");
    writeFileSync(join(root, "plans", plan.planId, "sources", put.sha256), Buffer.from("書き換えた"));
    expect((await call("planSourceRead", { planId: plan.planId, version: 1, sha256: put.sha256 })).reason).toBe("sourceChanged");
    // 戻すと、戻した先の版の資料の記録も写す
    const back = await call("planRevert", { planId: plan.planId, to: 1, reason: "戻す", basedOn: 1 });
    expect(back).toMatchObject({ ok: true, version: 2 });
    expect((await call("planStatus", { planId: plan.planId })).latest.sources).toEqual(st.latest.sources);
  });
});

describe("編集者：承認を頼んだ版の上に次の版を作れるのは、頼んだ人だけ（台帳の新-1）", () => {
  it("承認されるまで（差戻されたあとも）ほかの人は確定も戻すもできない。承認されると誰でも作れる", async () => {
    extra = join(tmpdir(), `moyai-turn-${process.pid}-${Date.now()}`);
    const root = join(extra, "MOYAI");
    mkdirSync(root, { recursive: true });
    const a = await startTestBridge();
    const b = await startTestBridge();
    try {
      const caller = async (x: TestBridge) => {
        const t = await tab(x);
        return async (id: (typeof NEW_ROUTES)[number], payload: unknown) => {
          const text = JSON.stringify(payload);
          const r = await post(x, R(id).path, good(x), { token: await t.token(R(id).action, text), payload: text });
          return r.body;
        };
      };
      const ca = await caller(a);
      const cb = await caller(b);
      for (const [c, name] of [[ca, "【架空】頼んだ人"], [cb, "【架空】ほかの人"]] as const) {
        expect(await c("settingsSave", { root, name })).toMatchObject({ ok: true });
        expect(await c("personKeyCreate", {})).toMatchObject({ ok: true });
      }
      const plan = truthToPlan("fictional-1");
      const acceptances = aiDecisions(plan).map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
      const v1 = await ca("planCommit", { plan, reason: "承認を頼む", acceptances, basedOn: null, request: { kind: "approve", to: "boss@example.jp", note: "" } });
      expect(v1).toMatchObject({ ok: true, version: 1 });
      const next = { ...v1.plan };
      // 承認待ち：ほかの人は確定も戻すもできない。頼んだ人はできる（ここでは試すだけで、作らない）
      expect((await cb("planCommit", { plan: next, reason: "横から重ねる", acceptances: [], basedOn: 1 })).reason).toBe("notYourTurn");
      expect((await cb("planRevert", { planId: plan.planId, to: 1, reason: "横から戻す", basedOn: 1 })).reason).toBe("notYourTurn");
      // 差戻されたあとも、頼んだ人の番に戻るだけ
      const boss = otherSigner("【架空】承認する人");
      expect(await signLatest({ root, planId: plan.planId, version: 1, role: "return", reason: "直してください", signer: boss })).toMatchObject({ ok: true });
      // 差戻しのある版には、承認も、もう一度の差戻しも重ねない（台帳の新-7）
      expect(await signLatest({ root, planId: plan.planId, version: 1, role: "approve", reason: "", signer: boss })).toEqual({ ok: false, reason: "alreadySigned" });
      expect(await signLatest({ root, planId: plan.planId, version: 1, role: "return", reason: "もう一度", signer: otherSigner("【架空】ほかの課長") })).toEqual({ ok: false, reason: "alreadySigned" });
      expect((await cb("planCommit", { plan: next, reason: "横から重ねる", acceptances: [], basedOn: 1 })).reason).toBe("notYourTurn");
      expect(await ca("planCommit", { plan: next, reason: "直した", acceptances: [], basedOn: 1, request: { kind: "approve", to: "boss@example.jp", note: "" } })).toMatchObject({ ok: true, version: 2 });
      // 承認されると閉じ、誰でも次の版を作れる
      expect(await signLatest({ root, planId: plan.planId, version: 2, role: "approve", reason: "", signer: boss })).toMatchObject({ ok: true });
      expect(await signLatest({ root, planId: plan.planId, version: 2, role: "return", reason: "やっぱり", signer: boss })).toEqual({ ok: false, reason: "alreadySigned" });
      expect(await cb("planCommit", { plan: next, reason: "次の年の版", acceptances: [], basedOn: 2 })).toMatchObject({ ok: true, version: 3 });
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe("版を年度で呼ぶための時刻（見せ方だけ。docs/screens.md §3.4 の末尾、仕事 sign-words-v1）", () => {
  it("確定の答えに署名の時刻。版の一覧に施設の年度の始まりと、版を確定した署名の時刻（承認か自分で確定。渡しただけは null）。版の記録には足さない", async () => {
    extra = join(tmpdir(), `moyai-signed-at-${process.pid}-${Date.now()}`);
    const root = join(extra, "MOYAI");
    mkdirSync(root, { recursive: true });
    const a = await startTestBridge();
    try {
      const t = await tab(a);
      const call = async (id: (typeof NEW_ROUTES)[number], payload: unknown) => {
        const text = JSON.stringify(payload);
        return (await post(a, R(id).path, good(a), { token: await t.token(R(id).action, text), payload: text })).body;
      };
      expect(await call("settingsSave", { root, name: "【架空】頼んだ人" })).toMatchObject({ ok: true });
      expect(await call("personKeyCreate", {})).toMatchObject({ ok: true });
      const plan = truthToPlan("fictional-1");
      const acceptances = aiDecisions(plan).map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
      // 承認を頼んで渡す：署名の時刻は返すが、まだ確定していないので一覧の確定の時刻は null
      const v1 = await call("planCommit", { plan, reason: "承認を頼む", acceptances, basedOn: null, request: { kind: "approve", to: "boss@example.jp", note: "" } });
      expect(v1).toMatchObject({ ok: true, version: 1 });
      const record1 = JSON.parse(readFileSync(join(root, "plans", plan.planId, "versions", "000001.json"), "utf8"));
      expect(v1.at).toBe(record1.at);
      let listed = (await call("plansList", {})).plans.find((p: { planId: string }) => p.planId === plan.planId);
      expect(listed.fiscalYearStartMonth).toBe(plan.facility.fiscalYearStartMonth);
      expect(listed.versions[0]).toMatchObject({ version: 1, signedAt: null });
      // 承認すると、承認の署名の時刻
      const approvedAt = new Date("2026-03-31T15:00:00.000Z");
      expect(await signLatest({ root, planId: plan.planId, version: 1, role: "approve", reason: "", signer: otherSigner("【架空】承認する人"), now: approvedAt })).toMatchObject({ ok: true });
      listed = (await call("plansList", {})).plans.find((p: { planId: string }) => p.planId === plan.planId);
      expect(listed.versions[0].signedAt).toBe(approvedAt.toISOString());
      // 自分で確定すると、確定の署名の時刻（版の記録の時刻と同じ）
      const v2 = await call("planCommit", { plan: { ...v1.plan }, reason: "次の版を自分で確定", acceptances: [], basedOn: 1 });
      expect(v2).toMatchObject({ ok: true, version: 2 });
      const record2Text = readFileSync(join(root, "plans", plan.planId, "versions", "000002.json"), "utf8");
      expect(v2.at).toBe(JSON.parse(record2Text).at);
      listed = (await call("plansList", {})).plans.find((p: { planId: string }) => p.planId === plan.planId);
      expect(listed.versions[1]).toMatchObject({ version: 2, signedAt: v2.at });
      // 年度の呼び名は見せ方だけ：版の記録には足さない
      for (const text of [record2Text, JSON.stringify(record1)]) {
        expect(text).not.toContain("signedAt");
        expect(text).not.toContain("年度版");
      }
    } finally {
      await a.close();
    }
  });
});

describe("受け手：似た施設と並べる（peers_compare）", () => {
  it("設定で選んだ台帳の clone を受け手の関数で読み、立場ごとに場を並べる。入札の対象が無ければ聞く", async () => {
    extra = join(tmpdir(), `moyai-peers-${process.pid}-${Date.now()}`);
    mkdirSync(extra, { recursive: true });
    const repo = join(extra, "台帳");
    const demo = buildLedgerDemo({ repo: fileURLToPath(new URL("../../", import.meta.url)), out: repo, state: join(extra, "demo-state"), month: "2026-11" });
    tb = await startTestBridge({ human: { shell: async () => ({ documents: join(extra, "Documents"), mounts: [] }) } });
    const t = await tab(tb);
    const call = async (id: "settingsSave" | "settingsRead" | "peersCompare", payload: unknown) => {
      const text = JSON.stringify(payload);
      const tok = await t.token(R(id).action, text);
      const r = await post(tb!, R(id).path, good(tb!), { token: tok, payload: text });
      expect(r.status, id).toBe(200);
      return r.body;
    };
    const answers = { facility: { furnace: "STOKER", capacity_t_per_day: "C200_400", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };
    const base = { packId: "waste-incineration", axes: null, answers, target: null, facility: null };

    // 台帳の場所をまだ選んでいない：場は missing、理由は notChosen
    const before = await call("peersCompare", { ...base, position: "municipal" });
    expect(before.places).toEqual([{ kind: "ledger", id: null, ok: false, reason: "ledger.notChosen", peers: 0, ng: 0 }]);
    expect(before.comparison.places).toEqual([{ kind: "ledger", id: null, status: "missing" }]);

    // 相対の道は断る。絶対の道を選ぶと、置き場所は前のまま
    expect((await call("settingsSave", { root: null, ledger: "相対の道" })).reason).toBe("ledgerInvalid");
    expect(await call("settingsSave", { root: null, ledger: repo })).toEqual({ ok: true, root: null, ledger: repo, name: null });
    expect((await call("settingsRead", {})).ledger).toBe(repo);
    expect((await call("settingsSave", { root: null })).ledger).toBe(repo);

    // 市町村：主要の軸（炉の型・処理能力の帯）で、台帳の ✓ の束から似た施設を並べる
    const m = await call("peersCompare", { ...base, position: "municipal" });
    expect(m.chosenAxes).toEqual(["furnace", "capacity_t_per_day"]);
    expect(m.places).toEqual([{ kind: "ledger", id: demo.ledgerId, ok: true, reason: null, peers: 10, ng: 0 }]);
    const shown = m.comparison.places[0];
    expect(shown).toMatchObject({ kind: "ledger", id: demo.ledgerId, status: "shown" });
    expect(shown.agg.similar.length).toBeGreaterThanOrEqual(3);
    expect(shown.agg.rows.length).toBeGreaterThan(0);

    // 軸を足すと似た施設は減る（増えない）
    const narrow = await call("peersCompare", { ...base, position: "municipal", axes: ["furnace", "capacity_t_per_day", "turbine", "ash", "contract"] });
    const n0 = narrow.comparison.places[0];
    expect(n0.status === "shown" ? n0.agg.similar.length : n0.similar).toBeLessThanOrEqual(shown.agg.similar.length);

    // 保全子会社：輪に入っていないので輪は missing、台帳は並ぶ
    const s = await call("peersCompare", { ...base, position: "subsidiary" });
    expect(s.comparison.places.map((p: { kind: string; status: string }) => [p.kind, p.status])).toEqual([
      ["ring", "missing"],
      ["ledger", "shown"],
    ]);

    // O&M：入札の対象の答えが無ければ比べず、聞く。入れれば並ぶ
    const o = await call("peersCompare", { ...base, position: "om" });
    expect(o).toMatchObject({ ok: true, comparison: null, reason: "targetMissing" });
    const o2 = await call("peersCompare", { ...base, position: "om", target: { ...answers, facility: { ...answers.facility, furnace: "FLUID" } } });
    expect(o2.comparison.places[0].kind).toBe("ledger");

    // 知らない立場・パックの形でないものは断る
    const bad = await call("peersCompare", { ...base, position: "知らない立場" });
    expect(bad).toMatchObject({ ok: false, reason: "payloadInvalid" });
  }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）
});

describe("公開の台帳へ出す（GitHub の代わりの試験の台。本物の GitHub では未確認）", () => {
  it("確定 → GitHub につなぐ（デバイスフロー）→ 束を見る → 署名して PR → 行方を読む → 接続を切る", async () => {
    extra = join(tmpdir(), `moyai-ledger-pr-${process.pid}-${Date.now()}`);
    mkdirSync(extra, { recursive: true });
    const repo = join(extra, "台帳");
    buildLedgerDemo({ repo: fileURLToPath(new URL("../../", import.meta.url)), out: repo, state: join(extra, "demo-state"), month: "2026-11" });
    mkdirSync(join(repo, ".git"), { recursive: true });
    writeFileSync(join(repo, ".git", "config"), `[remote "origin"]\n\turl = https://github.com/${"ledger-owner"}/moyai-ledger.git\n`);
    const stub = await startGitHubStub();
    try {
      const io: GitHubIo = { hosts: { web: stub.web, api: stub.api }, fetch: (u, i) => fetch(u, i), sleep: async () => {} };
      tb = await startTestBridge({ human: { shell: async () => ({ documents: join(extra, "Documents"), mounts: [] }), github: io, githubClientId: stub.clientId } });
      const t = await tab(tb);
      const call = async (id: (typeof NEW_ROUTES)[number], payload: unknown) => {
        const text = JSON.stringify(payload);
        const tok = await t.token(R(id).action, text);
        const r = await post(tb!, R(id).path, good(tb!), { token: tok, payload: text });
        expect(r.status, id).toBe(200);
        return r.body;
      };
      await call("settingsSave", { root: join(extra, "置き場所"), ledger: repo, name: "【架空】試験の人" });
      await call("personKeyCreate", {});
      const plan = truthToPlan("fictional-1");
      const ds = aiDecisions(plan);
      expect(await call("planCommit", { plan, reason: "試験の確定", acceptances: ds.map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" })), basedOn: null })).toMatchObject({ ok: true, version: 1 });
      const answers = { facility: { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };

      // つなぐ前：誰からも見えるあなたは出るが、台帳の決まりを受け入れていないので束のバイト列は無く、送れない。施設の鍵はまだメモリだけ
      const pv0 = await call("ledgerPreview", { planId: plan.planId, answers });
      expect(pv0).toMatchObject({ ok: true, github: { login: null, ready: true }, ledger: { repo: "ledger-owner/moyai-ledger", key: expect.stringMatching(/^[0-9a-f]{16}$/) } });
      expect(existsSync(join(extra, "置き場所", "plans", plan.planId, "share"))).toBe(false);
      expect(pv0.view.blockers).toContain("noKey");
      expect(pv0.view.bodyHash).toBeNull();
      expect(pv0.view.k).toBeGreaterThanOrEqual(5);
      // 受け口の URL が決まっていなければ、GitHub のアカウントなしの道は出さず、送る経路も断る
      expect(pv0.intake).toBe(false);
      expect((await call("ledgerIntakeSend", { planId: plan.planId, version: 1, answers, previewHash: "0".repeat(64) })).reason).toBe("intakeNotReady");

      // GitHub につなぐ：台帳の決まりを受け入れ、デバイスフローのコードを返す。人が github.com で入れるまで待つ
      const st = await call("githubConnectStart", { packId: "waste-incineration" });
      expect(st).toMatchObject({ ok: true, userCode: "WDJB-MJHT", acceptedNow: true });
      expect(await call("githubConnectState", {})).toMatchObject({ ok: true, state: "waiting" });
      stub.approve(); // 試験の台本が押した（人が github.com でコードを入れた）
      let state = "waiting";
      for (let i = 0; i < 40 && state === "waiting"; i++) {
        await new Promise((r) => setTimeout(r, 200));
        state = (await call("githubConnectState", {})).state;
      }
      expect(state).toBe("ok");
      expect((await call("settingsRead", {})).github).toBe("moyai-test");
      // トークンは状態フォルダに置く（包まない。運営者の決定 2026-11-04）。画面に返す答えには入れない
      expect(JSON.parse(readFileSync(join(tb.stateDir!, "github.json"), "utf8")).v).toBe("moyai.github/1");
      expect(JSON.stringify(await call("settingsRead", {}))).not.toContain(STUB_TOKEN);
      expect(JSON.stringify(await call("githubConnectState", {}))).not.toContain(STUB_TOKEN);

      // 束を見る → 人が押すと PR を 1 つ出す
      const pv = await call("ledgerPreview", { planId: plan.planId, answers });
      expect(pv.github.login).toBe("moyai-test");
      expect(pv.view.blockers).toEqual([]);
      expect(pv.rulesChange).toBeNull();
      // 台帳の決まりが受け入れたものから変わったら差を出し、人が見た決まりのハッシュで受け入れ直す（台帳の新-3）
      const lj = join(tb.stateDir!, "ledgers.json");
      const kept = readFileSync(lj, "utf8");
      writeFileSync(lj, kept.replace(/"acceptedRulesHash":\s*"[0-9a-f]{64}"/, `"acceptedRulesHash": "${"0".repeat(64)}"`));
      const changed = await call("ledgerPreview", { planId: plan.planId, answers });
      expect(changed.rulesChange).toMatchObject({ rulesHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect((await call("ledgerRulesAccept", { packId: plan.packId, rulesHash: "f".repeat(64) })).reason).toBe("previewChanged");
      expect(await call("ledgerRulesAccept", { packId: plan.packId, rulesHash: changed.rulesChange.rulesHash })).toEqual({ ok: true });
      expect((await call("ledgerPreview", { planId: plan.planId, answers })).rulesChange).toBeNull();
      expect(sha(pv.view.bodyText)).toBe(pv.view.bodyHash);
      expect(stub.prs).toHaveLength(0);
      const sent = await call("ledgerSend", { planId: plan.planId, version: 1, answers, previewHash: pv.view.bodyHash });
      expect(sent).toMatchObject({ ok: true, pr: 1, seq: 1, login: "moyai-test" });
      expect(Object.keys(stub.prs[0]!.files)).toEqual([sent.path]);
      expect(stub.prs[0]!.body).not.toContain(plan.displayName);

      // 前の束が台帳に載るまでは、次の束は出さない。行方は公開の PR から読む
      expect((await call("ledgerPreview", { planId: plan.planId, answers })).view.blockers).toContain("pending");
      expect((await call("ledgerSend", { planId: plan.planId, version: 1, answers, previewHash: pv.view.bodyHash })).reason).toBe("ledgerPending");
      const prs = await call("ledgerPrs", { packId: "waste-incineration" });
      expect(prs.prs).toMatchObject([{ pr: 1, seq: 1, version: 1, status: { state: "open", check: "pending" } }]);

      // 接続を切ると、トークンのファイルは消え、出せない
      expect(await call("githubDisconnect", {})).toEqual({ ok: true });
      expect((await call("settingsRead", {})).github).toBeNull();
      expect(existsSync(join(tb.stateDir!, "github.json"))).toBe(false);
    } finally {
      await stub.close();
    }
  }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）
});

describe("公開の台帳へ GitHub のアカウントなしで出す（受け口。GitHub の代わりはメモリの台。本物の Cloudflare と GitHub では未確認）", () => {
  it("確定 → 束を見る（GitHub に未接続でも送れる）→ 署名して受け口へ → 受け口が台帳の検証と同じ関数で確かめて PR → 行方を公開の PR から読む", async () => {
    extra = join(tmpdir(), `moyai-ledger-intake-${process.pid}-${Date.now()}`);
    mkdirSync(extra, { recursive: true });
    const repo = join(extra, "台帳");
    buildLedgerDemo({ repo: fileURLToPath(new URL("../../", import.meta.url)), out: repo, state: join(extra, "demo-state"), month: "2026-11" });
    mkdirSync(join(repo, ".git"), { recursive: true });
    writeFileSync(join(repo, ".git", "config"), `[remote "origin"]\n\turl = https://github.com/${"ledger-owner"}/moyai-ledger.git\n`);
    // GitHub の代わり（メモリ）の main に、台帳の clone と同じファイルを置く
    const dir = await readLedgerDir(repo);
    if (!dir.ok) throw new Error(dir.reason);
    const onMain = Object.fromEntries(dir.files.filter((f) => f.kind === "file" && f.bytes).map((f) => [f.path, f.bytes!]));
    const token = `github_pat_${"Int4ke".repeat(4)}_${"y".repeat(40)}`;
    const gh = fakeLedgerGitHub({ token, files: onMain });
    const env = { GITHUB_TOKEN: token, LEDGER_REPO: "ledger-owner/moyai-ledger", INTAKE_KV: memoryKv() };
    const sentBodies: string[] = [];
    // 受け口（services/ledger-intake のハンドラそのもの。パックの部品は受け口に入れたもの）。送り手の IP は Cloudflare の入口が付ける見出しの代わり
    const ledgerIntake: IntakeIo = {
      url: "https://intake.example",
      fetch: async (u, i) => {
        sentBodies.push(i.body ?? "");
        const req = new Request(u, { method: i.method, headers: { ...i.headers, "cf-connecting-ip": "203.0.113.9" }, ...(i.body !== undefined ? { body: i.body } : {}) });
        return handleRequest(req, env, { fetch: gh.fetch, now: () => Date.now(), packOf });
      },
    };
    // 行方は今と同じ読み方（公開の PR をトークン無しで読む）。行き先は同じメモリの台
    const github: GitHubIo = { hosts: { web: "https://github.com", api: "https://api.github.com" }, fetch: (u, i) => gh.fetch(u, i), sleep: async () => {} };
    tb = await startTestBridge({ human: { shell: async () => ({ documents: join(extra, "Documents"), mounts: [] }), github, githubClientId: null, ledgerIntake } });
    const t = await tab(tb);
    const call = async (id: (typeof NEW_ROUTES)[number], payload: unknown) => {
      const text = JSON.stringify(payload);
      const tok = await t.token(R(id).action, text);
      const r = await post(tb!, R(id).path, good(tb!), { token: tok, payload: text });
      expect(r.status, id).toBe(200);
      return r.body;
    };
    await call("settingsSave", { root: join(extra, "置き場所"), ledger: repo, name: "【架空】試験の人" });
    await call("personKeyCreate", {});
    const plan = truthToPlan("fictional-1");
    const ds = aiDecisions(plan);
    expect(await call("planCommit", { plan, reason: "試験の確定", acceptances: ds.map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" })), basedOn: null })).toMatchObject({ ok: true, version: 1 });
    const answers = { facility: { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };

    // GitHub に未接続でも、受け口の道があれば束のバイト列が出る。GitHub の道は noKey で止まり、受け口の道は送れる
    const pv = await call("ledgerPreview", { planId: plan.planId, answers });
    expect(pv).toMatchObject({ ok: true, intake: true, github: { login: null, ready: false } });
    expect(pv.view.blockers).toEqual(["noKey"]);
    expect(sha(pv.view.bodyText)).toBe(pv.view.bodyHash);
    expect(readLedgers(tb.stateDir!)).toEqual([]);
    expect((await call("ledgerSend", { planId: plan.planId, version: 1, answers, previewHash: pv.view.bodyHash })).reason).toBe("githubNotConnected");
    // 見たハッシュと違えば署名しない
    expect((await call("ledgerIntakeSend", { planId: plan.planId, version: 1, answers, previewHash: "f".repeat(64) })).reason).toBe("previewChanged");
    expect(gh.prs).toHaveLength(0);

    // 人が押すと、束に署名して受け口へ送る。受け口が運営者のアカウントで PR を 1 つ出す
    const sent = await call("ledgerIntakeSend", { planId: plan.planId, version: 1, answers, previewHash: pv.view.bodyHash });
    expect(sent).toMatchObject({ ok: true, pr: 1, seq: 1, url: "https://github.com/ledger-owner/moyai-ledger/pull/1" });
    expect(sentBodies).toHaveLength(1);
    const pr = gh.prs[0]!;
    expect(Object.keys(pr.files)).toEqual([sent.path]);
    expect(pr.files[sent.path]!.toString("utf8")).toBe(sentBodies[0]);
    expect(pr.head).toBe(`intake/${sent.hash.slice(0, 16)}`);
    expect(pr.body.split("\n")[0]).toBe("受け口から（GitHub のアカウントなし）");
    expect(pr.body).toContain(sent.path.split("/")[2]);
    expect(pr.body).not.toContain(plan.displayName);
    // 届いた束は、受け手の関数（台帳の Actions と同じ）で ✓
    const after = verifyLedgerFiles([...dir.files, { path: sent.path, kind: "file", bytes: new Uint8Array(pr.files[sent.path]!) }], packOf("waste-incineration")!);
    expect(after.bundles.find((b) => b.path === sent.path)).toMatchObject({ status: "ok", reasons: [] });
    // 台帳の決まりの受け入れは、人が押したときに記録した。トークンは画面に返す答えに入らない
    expect(readLedgers(tb.stateDir!).map((e) => e.pack)).toEqual(["waste-incineration"]);
    expect(JSON.stringify(sent)).not.toContain(token);

    // 前の束が台帳に載るまでは、次の束は出さない。行方は公開の PR から読む（GitHub の道と同じ持ち出し簿）
    expect((await call("ledgerPreview", { planId: plan.planId, answers })).view.blockers).toContain("pending");
    expect((await call("ledgerIntakeSend", { planId: plan.planId, version: 1, answers, previewHash: pv.view.bodyHash })).reason).toBe("ledgerPending");
    expect(sentBodies).toHaveLength(1);
    const prs = await call("ledgerPrs", { packId: "waste-incineration" });
    expect(prs.prs).toMatchObject([{ pr: 1, seq: 1, version: 1, via: "intake", login: "", status: { state: "open", check: "pending" } }]);
    // 行方を読むのはトークン無し
    expect(gh.calls.filter((c) => /\/pulls\/1$/.test(new URL(c.url).pathname)).every((c) => c.auth === null)).toBe(true);
  }, 300_000); // 上限は CI で測った値に合わせる（11-05。windows-latest で 61〜75 秒、並ぶと 3 倍）
});
