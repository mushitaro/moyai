// 確定（docs/plan.md §2.9）：版は足すだけ、戻すのは前の版を指す記録を足すこと、差分レポート（Excel）、
// 人が受けていない決定が残れば確定しない、理由が空なら確定しない。試験は一時のフォルダ（日本語の OneDrive の道の形）で行う。
import { SIGNER } from "../helpers/signer";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { aiDecisions, diffPlans, pendingDecisions } from "../../src/plan/diff";
import { commitPlan, planDir, readHistory, revertPlan, VERSION_SCHEMA_V0 } from "../../src/plan/store";
import { signatureFileName, signStatement } from "../../src/plan/signature";
import { keyIdOf } from "../../src/share/sign";
import { otherSigner } from "../helpers/signer";
import { writeFileSync } from "node:fs";
import type { Plan } from "../../src/shared/plan";
import { asset, detail, plan, work } from "./share/fixtures";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

/** 一時のフォルダの下に、この PC と同じ形の道（利用者\OneDrive\ドキュメント\MOYAI）を作る */
function root(): string {
  dir = mkdtempSync(join(tmpdir(), "moyai-commit-"));
  return join(dir, "利用者", "OneDrive", "ドキュメント", "MOYAI");
}

function aiPlan(): Plan {
  return plan({
    assets: [asset("a1", "T.FEED.LIFT"), asset("a2", "T.POWER.GEN", { commonItemAuthor: "ai", commonItemAccepted: false, commonItemBasis: "名前が似ている" })],
    works: [work("w1", "OVERHAUL", ["a1"]), work("w2", "INSPECT", ["a2"])],
    details: [
      detail("d1", "w1", 2016),
      detail("d2", "w1", 2019, { author: "ai_relayed_human", basis: "チャットで人が答えた" }),
      detail("d3", "w2", 2018, { planOrActual: "plan" }),
    ],
  });
}

async function readSheet(path: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0]!;
  const out: string[][] = [];
  ws.eachRow((row) => out.push((row.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? "" : String(v)))));
  return out;
}

describe("確定：版と差分レポート", () => {
  it("理由が空なら確定しない", async () => {
    const r = await commitPlan({ root: root(), plan: aiPlan(), reason: "  ", acceptances: [], basedOn: null, signer: SIGNER, client: "t" });
    expect(r).toEqual({ ok: false, reason: "reasonEmpty" });
  });

  it("AI と AI（チャットでの人の答え）の決定が人に受けられるまで確定しない。受ける理由も空は通さない", async () => {
    const p = aiPlan();
    const ds = aiDecisions(p);
    expect(ds.map((d) => d.id).sort()).toEqual(["detail:d2", "item:a2"]);
    const r1 = await commitPlan({ root: root(), plan: p, reason: "確定の試験", acceptances: [], basedOn: null, signer: SIGNER, client: "t" });
    expect(r1).toMatchObject({ ok: false, reason: "pendingDecisions", pending: 2 });
    const r2 = await commitPlan({ root: join(dir, "x"), plan: p, reason: "確定の試験", acceptances: ds.map((d) => ({ id: d.id, hash: d.hash, reason: "" })), basedOn: null, signer: SIGNER, client: "t" });
    expect(r2).toEqual({ ok: false, reason: "acceptanceReasonEmpty" });
    const r3 = await commitPlan({ root: join(dir, "x"), plan: p, reason: "確定の試験", acceptances: [{ id: "item:a2", hash: "0".repeat(16), reason: "見た" }], basedOn: null, signer: SIGNER, client: "t" });
    expect(r3).toEqual({ ok: false, reason: "acceptanceUnknown" });
  });

  it("読み方の決定（年度の読み方など）も、AI の答えは人が受けるまで確定しない。決まり（コード）と人の答えは聞かない。答えが変われば聞き直す", async () => {
    const rd = (questionId: string, author: Plan["details"][number]["author"], answer = "暦年") => ({ questionId, kind: "yearKind", question: "年の列は年度か暦年か", answer, author, reason: "見出しに「年」とある", rows: 12 });
    const p: Plan = { ...plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"])], details: [detail("d1", "w1", 2016)] }), readingDecisions: [rd("q-ai", "ai"), rd("q-rule", "rule_code"), rd("q-human", "human")] };
    const ds = aiDecisions(p);
    expect(ds.map((d) => d.id)).toEqual(["reading:q-ai"]);
    expect(ds[0]).toMatchObject({ kind: "reading", target: "年の列は年度か暦年か", value: "暦年" });
    const rt = root();
    expect(await commitPlan({ root: rt, plan: p, reason: "確定の試験", acceptances: [], basedOn: null, signer: SIGNER, client: "t" })).toMatchObject({ ok: false, reason: "pendingDecisions", pending: 1 });
    const v1 = await commitPlan({ root: rt, plan: p, reason: "確定の試験", acceptances: [{ id: ds[0]!.id, hash: ds[0]!.hash, reason: "見出しを見て暦年でよい" }], basedOn: null, signer: SIGNER, client: "t" });
    if (!v1.ok) throw new Error(v1.reason);
    const accepted = (await readHistory(rt, "plan-test")).accepted;
    expect(pendingDecisions(v1.record.plan, accepted)).toHaveLength(0);
    const changed: Plan = { ...v1.record.plan, readingDecisions: [rd("q-ai", "ai", "年度")] };
    expect(pendingDecisions(changed, accepted).map((d) => d.id)).toEqual(["reading:q-ai"]);
  });

  it("読み方の決定で作者が決まった明細は、明細の行に出さず決定に付く。効く明細が増えれば、また受けていない決定になる", () => {
    const rd = { questionId: "q-link", kind: "workLink", question: "この作業日報の行は星取表のどの印か", answer: "同じ作業", author: "ai_relayed_human" as const, reason: "利用者がチャットで答えた", rows: 2, details: ["d2"], where: "日報.csv" };
    const p: Plan = { ...aiPlan(), readingDecisions: [rd] };
    const ds = aiDecisions(p);
    expect(ds.map((d) => d.id).sort()).toEqual(["item:a2", "reading:q-link"]);
    expect(ds.find((d) => d.kind === "reading")).toMatchObject({ count: 1, where: "日報.csv" });
    const accepted = ds.map((d) => ({ id: d.id, hash: d.hash }));
    expect(pendingDecisions(p, accepted)).toEqual([]);
    const more: Plan = { ...p, readingDecisions: [{ ...rd, details: ["d2", "d3"] }] };
    expect(pendingDecisions(more, accepted).map((d) => d.id)).toEqual(["reading:q-link"]);
    // 明細の数で言えない決定（年度の読み方など）は、数を出さない
    expect(aiDecisions({ ...p, readingDecisions: [{ ...rd, details: [] }] }).find((d) => d.kind === "reading")?.count).toBeNull();
  });

  it("版は足すだけ：版のファイルを足し、差分レポートを書き、戻すのは前の版を指す新しい記録", async () => {
    const rt = root();
    const p = aiPlan();
    const acc = aiDecisions(p).map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
    const v1 = await commitPlan({ root: rt, plan: p, reason: "初めの確定", acceptances: acc, basedOn: null, signer: SIGNER, client: "tab-1" });
    if (!v1.ok) throw new Error(v1.reason);
    expect(v1.version).toBe(1);
    expect(v1.record.plan.version).toBe(1);
    // 受けた当てはめは「人が受けた」になり、作者は AI のまま
    const a2 = v1.record.plan.assets.find((a) => a.nodeKey === "a2")!;
    expect(a2.commonItemAccepted).toBe(true);
    expect(a2.commonItemAuthor).toBe("ai");
    // 日本語の OneDrive の道の下に書けている
    expect(v1.files.version).toContain(join("利用者", "OneDrive", "ドキュメント", "MOYAI", "plans", "plan-test", "versions", "000001.json"));
    const first = readFileSync(v1.files.version, "utf8");

    // 同じ版を元にした 2 回目は、ほかの確定が先に入っていれば断る
    expect(await commitPlan({ root: rt, plan: p, reason: "古い画面から", acceptances: [], basedOn: null, signer: SIGNER, client: "tab-2" })).toEqual({ ok: false, reason: "stale" });

    // 2 版目：印を 1 つ足し、1 つ消す。受けた決定は、同じ中身なら聞き直さない
    const p2: Plan = { ...v1.record.plan, details: [...v1.record.plan.details.filter((d) => d.detailKey !== "d1"), detail("d4", "w1", 2022, { manDays: 3 })] };
    expect(pendingDecisions(p2, (await readHistory(rt, "plan-test")).accepted)).toHaveLength(0);
    const v2 = await commitPlan({ root: rt, plan: p2, reason: "2022 の分解整備を足した", acceptances: [], basedOn: 1, signer: SIGNER, client: "tab-1" });
    if (!v2.ok) throw new Error(v2.reason);
    expect(v2.version).toBe(2);
    expect(v2.record.summary).toMatchObject({ added: 1, removed: 1, changed: 0 });
    // 親の鎖：1 版目の中身のハッシュと、1 版目の署名のファイルのハッシュの並び
    const h12 = await readHistory(rt, "plan-test");
    expect(v2.record.parent).toEqual({ version: 1, contentHash: h12.versions[0]!.contentHash, signatures: h12.versions[0]!.signatures.map((x) => x.fileHash) });

    // 1 版目に戻す：3 版目の記録が 1 版目を指す。前の版のファイルは変わらない
    const v3 = await revertPlan({ root: rt, planId: "plan-test", to: 1, reason: "2022 の分は誤りだった", basedOn: 2, signer: SIGNER, client: "tab-1" });
    if (!v3.ok) throw new Error(v3.reason);
    expect(v3.record.kind).toBe("revert");
    expect(v3.record.revertOf).toBe(1);
    expect(v3.record.summary).toMatchObject({ added: 1, removed: 1 });
    expect(readFileSync(v1.files.version, "utf8")).toBe(first);
    const d = planDir(rt, "plan-test");
    expect(readdirSync(join(d, "versions")).sort()).toEqual(["000001.json", "000002.json", "000003.json"]);
    expect(readdirSync(join(d, "reports")).sort()).toEqual(["000001-diff.xlsx", "000002-diff.xlsx", "000003-diff.xlsx"]);
    const h = await readHistory(rt, "plan-test");
    expect(h.versions.map((v) => v.kind)).toEqual(["confirm", "confirm", "revert"]);
    // どの版にも、確かめた署名が 1 つ（確定・確定・戻す）。確かめで合わない版は無い
    expect(h.versions.map((v) => v.signatures.map((x) => [x.role, x.by]))).toEqual([[["confirm", SIGNER.by]], [["confirm", SIGNER.by]], [["revert", SIGNER.by]]]);
    expect(h.versions.every((v) => v.problem === null && !v.legacy)).toBe(true);
    expect(readdirSync(join(d, "signatures"))).toHaveLength(3);
    expect(readdirSync(join(rt, "people"))).toEqual([`${keyIdOf(SIGNER.pair.pub)}.json`]);

    // 差分レポート：機器・作業・年度・前の印・後の印・誰が・なぜ
    const rows = await readSheet(v2.files.report);
    const head = rows.findIndex((r) => r[0] === "機器");
    expect(rows[head]).toEqual(["機器", "作業", "年度", "前の印", "後の印", "誰が", "なぜ"]);
    const body = rows.slice(head + 1);
    expect(body).toContainEqual(["架空の機器 a1", "架空の作業", "2022", "（印なし）", "● 実施", "人", "架空の記録"]);
    expect(body).toContainEqual(["架空の機器 a1", "架空の作業", "2016", "● 実施", "（印なし）", "人", "架空の記録"]);
    expect(rows.some((r) => r.includes("2022 の分解整備を足した"))).toBe(true);
  });

  it("AI が置いた作業の属性（人が受けていない案）も、受けるまで確定しない。受けると「人が受けた」になり、作者は AI のまま", async () => {
    const base = aiPlan();
    const p: Plan = {
      ...base,
      works: base.works.map((w) => (w.workKey === "w1" ? { ...w, attribute: "OVERHAUL", attributeAuthor: "ai", attributeBasis: "案 1：作業の名前が分解整備", attributeAccepted: false } : w)),
    };
    const ds = aiDecisions(p);
    expect(ds.map((d) => d.id).sort()).toEqual(["attr:w1", "detail:d2", "item:a2"]);
    expect(ds.find((d) => d.id === "attr:w1")).toMatchObject({ kind: "attribute", value: "OVERHAUL", author: "ai" });
    const rt = root();
    expect(await commitPlan({ root: rt, plan: p, reason: "確定の試験", acceptances: [], basedOn: null, signer: SIGNER, client: "t" })).toMatchObject({ ok: false, reason: "pendingDecisions", pending: 3 });
    const v1 = await commitPlan({ root: rt, plan: p, reason: "確定の試験", acceptances: ds.map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" })), basedOn: null, signer: SIGNER, client: "t" });
    if (!v1.ok) throw new Error(v1.reason);
    expect(v1.record.plan.works.find((w) => w.workKey === "w1")).toMatchObject({ attributeAccepted: true, attributeAuthor: "ai" });
    // 当てはめの欄で人が受けたもの（attributeAccepted が true）は、もう受けていない決定に並ばない
    expect(aiDecisions(v1.record.plan).filter((d) => d.kind === "attribute")).toEqual([]);
  });

  it("差は機器・作業・年度ごとの印（計画と実施が重なれば ◎）", () => {
    const before = aiPlan();
    const after: Plan = { ...before, details: [...before.details, detail("d5", "w2", 2018)] };
    const d = diffPlans(before, after);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ nodeKey: "a2", fiscalYear: 2018, before: "plan", after: "both" });
    expect(diffPlans(null, before).added).toBe(3);
  });
});

describe("版の署名（docs/plan.md §2.18.2）", () => {
  async function twoVersions() {
    const rt = root();
    const p = aiPlan();
    const acc = aiDecisions(p).map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
    const v1 = await commitPlan({ root: rt, plan: p, reason: "初めの確定", acceptances: acc, basedOn: null, signer: SIGNER, client: "t" });
    if (!v1.ok) throw new Error(v1.reason);
    const v2 = await commitPlan({ root: rt, plan: v1.record.plan, reason: "2 版目", acceptances: [], basedOn: 1, signer: SIGNER, client: "t" });
    if (!v2.ok) throw new Error(v2.reason);
    return { rt, d: planDir(rt, "plan-test") };
  }

  it("呼び名の形に合わない人は署名しない", async () => {
    const r = await commitPlan({ root: root(), plan: aiPlan(), reason: "確定", acceptances: [], basedOn: null, signer: { ...SIGNER, by: "山田/課長" }, client: "t" });
    expect(r).toEqual({ ok: false, reason: "nameInvalid" });
  });

  it("版の中身を書き換えると、署名が合わない版になり、その上には重ねない", async () => {
    const { rt, d } = await twoVersions();
    const f = join(d, "versions", "000001.json");
    writeFileSync(f, readFileSync(f, "utf8").replace("初めの確定", "書き換えた理由"));
    const h = await readHistory(rt, "plan-test");
    // 1 版目は署名の中身のハッシュと合わない。2 版目は親の鎖が合わない
    expect(h.versions.map((v) => v.problem)).toEqual(["signature", "chain"]);
    const r = await commitPlan({ root: rt, plan: aiPlan(), reason: "3 版目", acceptances: [], basedOn: 2, signer: SIGNER, client: "t" });
    expect(r).toEqual({ ok: false, reason: "historyBroken" });
  });

  it("署名のファイルを消すと、その版は署名の無い版、次の版は鎖が合わない版になる", async () => {
    const { rt, d } = await twoVersions();
    rmSync(join(d, "signatures", signatureFileName(1, "confirm", keyIdOf(SIGNER.pair.pub))));
    const h = await readHistory(rt, "plan-test");
    expect(h.versions.map((v) => v.problem)).toEqual(["unsigned", "chain"]);
  });

  it("版の記録の作った鍵でない鍵の作る署名は、版を作った署名に数えず外して数える。頼みも作った人のものだけ（監-1）", async () => {
    const { rt, d } = await twoVersions();
    const h = await readHistory(rt, "plan-test");
    const v2 = h.versions[1]!;
    expect(v2).toMatchObject({ makerRecorded: true, unrecordedMakers: 0 });
    // 保管先に書ける別の人が、自分の鍵で同じ中身に「確定」「渡す」の署名を足す
    const thief = otherSigner("【架空】なりすます人");
    for (const role of ["confirm", "edit"] as const) {
      const f = signStatement({ planId: "plan-test", version: 2, contentHash: v2.contentHash, role, by: thief.by, at: "2026-11-04T05:00:00.000Z", reason: "2 版目" }, thief.pair);
      writeFileSync(join(d, "signatures", signatureFileName(2, role, f.statement.key)), JSON.stringify(f));
    }
    const h2 = await readHistory(rt, "plan-test");
    const w = h2.versions[1]!;
    expect(w.problem).toBeNull();
    expect(w.unrecordedMakers).toBe(2);
    expect(w.signatures.map((x) => x.by)).toEqual([SIGNER.by]);
    // なりすます人が自分宛ての頼みを置いても、作った人の頼みに数えない（番は奪えない）
    const { createRequest, readRequests } = await import("../../src/plan/request");
    await createRequest({ root: rt, planId: "plan-test", version: 2, contentHash: w.contentHash, kind: "edit", to: thief.by, by: thief.by, pair: thief.pair, now: new Date("2026-11-04T06:00:00Z") });
    const rq = await readRequests(rt, "plan-test", w);
    expect(rq.requests).toEqual([]);
    expect(rq.foreign).toHaveLength(1);
    // 作った鍵が記録に入るので、記録の作った鍵を書き換えると中身のハッシュが変わり、署名が合わない
    const f = join(d, "versions", "000002.json");
    const rec = JSON.parse(readFileSync(f, "utf8"));
    expect(rec.maker).toEqual({ key: keyIdOf(SIGNER.pair.pub), pub: SIGNER.pair.pub });
    rec.maker = { key: keyIdOf(thief.pair.pub), pub: thief.pair.pub };
    writeFileSync(f, JSON.stringify(rec, null, 1));
    expect((await readHistory(rt, "plan-test")).versions[1]!.problem).not.toBeNull();
  });

  it("ほかの人の承認の署名を足すと、2 版目の署名に並ぶ（版の記録は書き直さない）。ほかの版の中身を指す署名は数えない", async () => {
    const { rt, d } = await twoVersions();
    const h = await readHistory(rt, "plan-test");
    const v2 = h.versions[1]!;
    const boss = otherSigner("【架空】課長");
    const before = readFileSync(join(d, "versions", "000002.json"), "utf8");
    const ok = signStatement({ planId: "plan-test", version: 2, contentHash: v2.contentHash, role: "approve", by: boss.by, at: "2026-11-04T05:00:00.000Z", reason: "見て承認する" }, boss.pair);
    writeFileSync(join(d, "signatures", signatureFileName(2, "approve", ok.statement.key)), JSON.stringify(ok));
    const other = otherSigner("【架空】よその人");
    const wrong = signStatement({ planId: "plan-test", version: 2, contentHash: h.versions[0]!.contentHash, role: "approve", by: other.by, at: "2026-11-04T05:00:00.000Z", reason: "別の版の中身" }, other.pair);
    writeFileSync(join(d, "signatures", signatureFileName(2, "approve", wrong.statement.key)), JSON.stringify(wrong));
    const h2 = await readHistory(rt, "plan-test");
    expect(readFileSync(join(d, "versions", "000002.json"), "utf8")).toBe(before);
    expect(h2.versions[1]!.signatures.map((x) => [x.role, x.by]).sort()).toEqual([["approve", "【架空】課長"], ["confirm", SIGNER.by]]);
    // 合わない署名のファイルがあると、その版は「署名が合わない」として開かない
    expect(h2.versions[1]!.problem).toBe("signature");
  });

  it("署名の無い前の形の版（v0）は、読むだけにし、承認には数えない（legacy）", async () => {
    const rt = root();
    const d = planDir(rt, "plan-test");
    const v0 = { schema: VERSION_SCHEMA_V0, planId: "plan-test", version: 1, kind: "confirm", revertOf: null, at: "2026-11-03T00:00:00.000Z", author: "human", client: "t", reason: "前の形", acceptances: [], summary: { added: 0, removed: 0, changed: 0, same: 0 }, prev: null, plan: { ...aiPlan(), version: 1 } };
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(d, "versions"), { recursive: true });
    writeFileSync(join(d, "versions", "000001.json"), JSON.stringify(v0));
    const h = await readHistory(rt, "plan-test");
    expect(h.versions[0]).toMatchObject({ legacy: true, problem: null, signatures: [] });
  });

  it("前の形の版（v0）は先頭に続く部分だけ。署名のある版のあとに置いた v0 は鎖が合わない版で、最新にも基底にもならず、受けた決定にも数えない", async () => {
    const { rt, d } = await twoVersions();
    const tail = {
      schema: VERSION_SCHEMA_V0, planId: "plan-test", version: 3, kind: "confirm", revertOf: null, at: "2026-11-05T00:00:00.000Z", author: "human", client: "t",
      reason: "署名なしで足した版", acceptances: [{ id: "x", hash: "0".repeat(16), reason: "勝手に受けた", author: "human" }], summary: { added: 0, removed: 0, changed: 0, same: 0 }, prev: null,
      plan: { ...aiPlan(), version: 3 },
    };
    writeFileSync(join(d, "versions", "000003.json"), JSON.stringify(tail));
    const h = await readHistory(rt, "plan-test");
    expect(h.versions.map((v) => [v.version, v.legacy, v.problem])).toEqual([[1, false, null], [2, false, null], [3, true, "chain"]]);
    expect(h.accepted.some((a) => a.id === "x")).toBe(false);
    // 鎖が合わない版の上には重ねない
    expect(await commitPlan({ root: rt, plan: aiPlan(), reason: "4 版目", acceptances: [], basedOn: 3, signer: SIGNER, client: "t" })).toEqual({ ok: false, reason: "historyBroken" });
  });

  it("鎖は親の中身と作った署名だけを持つ：親にあとから承認が足されても（同期で遅れて届いても）、次の版の鎖は切れない", async () => {
    const { rt, d } = await twoVersions();
    const h = await readHistory(rt, "plan-test");
    const rec2 = JSON.parse(readFileSync(join(d, "versions", "000002.json"), "utf8"));
    expect(rec2.parent.signatures).toHaveLength(1);
    // 1 版目に、2 版目を作ったあとで承認が届く
    const boss = otherSigner("【架空】課長");
    const late = signStatement({ planId: "plan-test", version: 1, contentHash: h.versions[0]!.contentHash, role: "approve", by: boss.by, at: "2026-11-05T05:00:00.000Z", reason: "遅れて届いた承認" }, boss.pair);
    writeFileSync(join(d, "signatures", signatureFileName(1, "approve", late.statement.key)), JSON.stringify(late));
    const h2 = await readHistory(rt, "plan-test");
    expect(h2.versions.map((v) => v.problem)).toEqual([null, null]);
    expect(h2.versions[0]!.signatures.map((x) => x.role).sort()).toEqual(["approve", "confirm"]);
    // 作った署名を消すと、鎖は切れる
    rmSync(join(d, "signatures", signatureFileName(1, "confirm", keyIdOf(SIGNER.pair.pub))));
    expect((await readHistory(rt, "plan-test")).versions.map((v) => v.problem)).toEqual(["unsigned", "chain"]);
  });
});

describe("渡す・承認・差し戻し（docs/plan.md §2.18.2・docs/screens.md 3.4）", () => {
  it("編集を頼んで渡す版は edit の署名。ほかの人が承認の署名を足し、自分の版は自分で承認できない。いちばん新しい版にだけ足せる", async () => {
    const { signLatest } = await import("../../src/plan/store");
    const rt = root();
    const p = aiPlan();
    const acc = aiDecisions(p).map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" }));
    const v1 = await commitPlan({ root: rt, plan: p, reason: "承認を頼む", acceptances: acc, basedOn: null, signer: SIGNER, role: "edit", client: "t" });
    if (!v1.ok) throw new Error(v1.reason);
    const h1 = await readHistory(rt, "plan-test");
    expect(h1.versions[0]).toMatchObject({ problem: null, signatures: [{ role: "edit", by: SIGNER.by }] });
    // 自分の版は自分で承認できない。同じ呼び名の 2 つ目の鍵でも同じ
    expect(await signLatest({ root: rt, planId: "plan-test", version: 1, role: "approve", reason: "", signer: SIGNER })).toEqual({ ok: false, reason: "selfApprove" });
    expect(await signLatest({ root: rt, planId: "plan-test", version: 1, role: "approve", reason: "", signer: otherSigner(SIGNER.by) })).toEqual({ ok: false, reason: "selfApprove" });
    const boss = otherSigner("【架空】課長");
    // 差し戻しは理由が要る
    expect(await signLatest({ root: rt, planId: "plan-test", version: 1, role: "return", reason: " ", signer: boss })).toEqual({ ok: false, reason: "reasonEmpty" });
    expect(await signLatest({ root: rt, planId: "plan-test", version: 1, role: "approve", reason: "見て承認する", signer: boss })).toEqual({ ok: true, version: 1, role: "approve" });
    const h2 = await readHistory(rt, "plan-test");
    expect(h2.versions[0]!.signatures.map((x) => [x.role, x.by]).sort()).toEqual([["approve", "【架空】課長"], ["edit", SIGNER.by]]);
    expect(h2.versions[0]!.problem).toBeNull();
    // 次の版の鎖は、親を作った署名だけを持つ（承認は入れない）。そのあとは、前の版には足せない
    const v2 = await commitPlan({ root: rt, plan: v1.record.plan, reason: "2 版目", acceptances: [], basedOn: 1, signer: SIGNER, client: "t" });
    if (!v2.ok) throw new Error(v2.reason);
    expect(v2.record.parent!.signatures).toHaveLength(1);
    expect((await readHistory(rt, "plan-test")).versions.every((v) => v.problem === null)).toBe(true);
    expect(await signLatest({ root: rt, planId: "plan-test", version: 1, role: "approve", reason: "", signer: otherSigner() })).toEqual({ ok: false, reason: "notLatest" });
  });
});
