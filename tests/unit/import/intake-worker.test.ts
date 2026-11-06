// 取り込みを worker に移した境目（src/app/intake/worker-protocol.ts・intake-host.ts・engine.ts・workspace.ts）の試験。
// worker の無い node では、同じ通信を同じスレッドで処理する受け手で確かめる（sameThreadPort は構造化複製と非同期の受け渡しで worker と同じ形にする）。
// 確かめること：通信の往復（答えはどれも構造化複製できる）、読込の進みの数、同じ資料を 2 回入れても 1 回しか読まない、
// 写しの要求を詰める（読込の途中は最後の 1 回だけ）、ツールは受け手の答えを待つ（古い写しで答えない）、worker の写しは同じスレッドの読み取りと同じ。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { IntakeHost } from "../../../src/app/intake/intake-host";
import { WorkerEngine, sameThreadPort, type IntakePort } from "../../../src/app/intake/engine";
import { IntakeWorkspace, type DroppedFile } from "../../../src/app/intake/workspace";
import { runTabTool, runTabToolAsync, type TabToolResult } from "../../../src/app/intake/tab-tools";
import type { PreparedImage } from "../../../src/app/intake/photos";
import type { IntakeRequest, IntakeView, ReplyOf } from "../../../src/app/intake/worker-protocol";
import { clearWorkingPlan, getWorkingPlan } from "../../../src/app/state/plan-store";
import { IntakeSession, type IntakeOptions } from "../../../src/import/session";
import { PHOTO_EXCLUDED_REASON } from "../../../src/import/photo";
import { TEXT } from "../../../src/app/text";
import { PHOTO_NAME, jpegSize, photoBytes, truthReading } from "../../helpers/photo";
import { rows, xlsxOf } from "./helpers";

afterEach(() => {
  clearWorkingPlan();
  vi.restoreAllMocks();
});

const PACK = "waste-incineration";
const settings = { packId: PACK, facilityName: "【架空】甲工場", fiscalYearStartMonth: 4, fictional: true };
const CTX = { conversation: "c-worker", rowsRemaining: 2000 };
const OPTIONS: IntakeOptions = {
  planId: "plan-worker",
  displayName: "【架空】甲工場",
  packId: PACK,
  facility: { facilityKey: "f-worker", name: "【架空】甲工場", fiscalYearStartMonth: 4, scale: null, scaleUnit: null, legalFlags: [], fictional: true, inNationalTable: null },
};
const F2_DIR = `samples/out/${PACK}/fictional-2/`;
const F2_FILES = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx"];

/** 小さな星取表（行の数を変えると中身のハッシュが変わる） */
async function sheet(name: string, n: number): Promise<{ name: string; bytes: Uint8Array }> {
  const bytes = await xlsxOf((ws) =>
    rows(ws, 1, [["機器", "作業内容", "2024年度"], ...Array.from({ length: n }, (_, i) => [`【架空】ポンプ${i + 1}`, "点検", "●"])]),
  );
  return { name, bytes };
}

/** 落とされたファイル（呼ぶたびに新しい配列を返す。worker へ移すので） */
const dropped = (f: { name: string; bytes: Uint8Array }): DroppedFile => ({ name: f.name, size: f.bytes.length, bytes: async () => f.bytes.slice() });
const f2 = (): { name: string; bytes: Uint8Array }[] => F2_FILES.map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(F2_DIR + n)) }));

const inWorker = () => new IntakeWorkspace(settings, new WorkerEngine(sameThreadPort()));
const sameThread = () => new IntakeWorkspace(settings);

function data(r: TabToolResult): any {
  if (!r.ok) throw new Error(`誤り：${r.code}`);
  return r.data;
}

/** 受け手に 1 通を送り、答えが構造化複製できること（複製しても同じ値）を確かめてから返す */
function caller(host: IntakeHost) {
  let id = 0;
  return async <R extends IntakeRequest>(req: R, v = 1): Promise<ReplyOf<R>> => {
    const sent = structuredClone({ id: ++id, v, req });
    const r = await host.receive(sent);
    if (!r || r.kind !== "reply") throw new Error("答えが無い");
    expect(structuredClone(r)).toEqual(r);
    if (!r.ok) throw new Error(r.error);
    return r.reply as ReplyOf<R>;
  };
}

const withoutAt = ({ at: _at, ...v }: IntakeView) => v;

describe("通信の往復（同じスレッドの受け手）", () => {
  test("open → read → view → survey → sheets → match → settle → undo → commit。答えはどれも構造化複製できる", async () => {
    const host = new IntakeHost();
    const call = caller(host);
    expect(await call({ op: "open", options: OPTIONS })).toBeNull();
    const a = await sheet("【架空】星取表A.xlsx", 3);
    const read = await call({ op: "read", name: a.name, bytes: a.bytes });
    expect(read).toMatchObject({ name: a.name, accepted: true, cached: false, rejected: [], listed: [] });
    const view = await call({ op: "view" }, 2);
    expect(view.at).toBe(2);
    expect(view.files).toEqual([a.name]);
    expect(view.sheets.map((s) => s.file)).toEqual([a.name]);
    const survey = await call({ op: "survey" });
    expect(survey.files.map((f) => f.fileRef)).toEqual([a.name]);
    const sheets = await call({ op: "sheets", file: a.name });
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.grid.cells.length).toBeGreaterThan(0);
    expect(sheets[0]!.status.length).toBeGreaterThan(0);
    await call({ op: "match", noDate: "日付なし" });
    expect(await call({ op: "nextUnresolved", after: null, file: "無い資料" })).toBeNull();
    const commit = await call({ op: "commit" });
    expect(commit.files.map((f) => f.name)).toEqual([a.name]);
    expect(commit.files[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    // 知らない質問への決定は、どれも置かずに断る
    expect(await call({ op: "settle", decisions: [{ questionId: "q-none", answer: "x", author: "ai", reason: "試験" }] })).toEqual({
      ok: false,
      code: "unknown_question",
      questionId: "q-none",
    });
  });

  test("決定を置いて取り消す（受け手が確かめる）", async () => {
    const host = new IntakeHost();
    const call = caller(host);
    await call({ op: "open", options: OPTIONS });
    for (const f of f2()) await call({ op: "read", name: f.name, bytes: f.bytes });
    const v0 = await call({ op: "view" });
    const q = v0.questions.find((x) => v0.open.includes(x.questionId) && x.defaultAnswer !== null)!;
    expect(q).toBeTruthy();
    const r = await call({ op: "settle", decisions: [{ questionId: q.questionId, answer: q.defaultAnswer!, author: "ai", reason: "既定の答え" }] });
    expect(r.ok).toBe(true);
    const v1 = await call({ op: "view" });
    expect(v1.decisions.map((d) => d.questionId)).toContain(q.questionId);
    await call({ op: "undo", questionId: q.questionId });
    const v2 = await call({ op: "view" });
    expect(v2.decisions.map((d) => d.questionId)).not.toContain(q.questionId);
  });

  test("open の前の要求は、誤りとして答える（受け手は止まらない）", async () => {
    const host = new IntakeHost();
    const r = await host.receive({ id: 7, v: 0, req: { op: "view" } });
    expect(r).toMatchObject({ kind: "reply", id: 7, ok: false });
    const call = caller(host);
    expect(await call({ op: "open", options: OPTIONS })).toBeNull();
    expect((await call({ op: "view" })).files).toEqual([]);
  });
});

describe("読込の進み", () => {
  for (const [mode, make] of [
    ["同じスレッド", sameThread],
    ["worker の形", inWorker],
  ] as const) {
    test(`1 つ読むごとに 1 つ進み、読み終わると消える（${mode}）`, async () => {
      const ws = make();
      const seen: string[] = [];
      ws.subscribe(() => {
        const p = ws.readProgress;
        const k = p ? `${p.done}/${p.total}` : "-";
        if (seen.at(-1) !== k) seen.push(k);
      });
      const files = await Promise.all([1, 2, 3, 4].map((i) => sheet(`【架空】表${i}.xlsx`, i)));
      const big: DroppedFile = { name: "【架空】大きい.xlsx", size: 64 * 1024 * 1024 + 1, bytes: async () => new Uint8Array() };
      // 読んでいる間に足した資料は、そのあとに続けて読み、進みの数に足す
      const first = ws.addFiles([...files.slice(0, 3).map(dropped), big]);
      const second = ws.addFiles([dropped(files[3]!)]);
      await Promise.all([first, second]);
      expect(seen).toEqual(["0/4", "0/5", "1/5", "2/5", "3/5", "4/5", "-"]);
      expect(ws.readProgress).toBeNull();
      expect(ws.fileCount).toBe(4);
      expect(ws.skippedFiles.map((f) => f.file)).toEqual([big.name]);
      expect(ws.view.files).toHaveLength(4);
    });
  }
});

describe("資料ごとの覚え", () => {
  test("同じ名前・大きさ・中身の資料は、読み手を 1 回しか走らせない（入れ直し・読み直し・新しい取り込みでも）", async () => {
    const host = new IntakeHost();
    const call = caller(host);
    await call({ op: "open", options: OPTIONS });
    const a = await sheet("【架空】星取表A.xlsx", 3);
    expect((await call({ op: "read", name: a.name, bytes: a.bytes })).cached).toBe(false);
    // 同じ取り込みにもう一度：同じ名前なので取り込みが外す（読まない）
    const again = await call({ op: "read", name: a.name, bytes: a.bytes.slice() });
    expect(again.accepted).toBe(false);
    expect(again.rejected[0]?.reason).toContain("同じ名前");
    // 年度の始まりを変えて作り直す：覚えから使う
    await call({ op: "reset", options: { ...OPTIONS, facility: { ...OPTIONS.facility, fiscalYearStartMonth: 1 } }, readings: [] });
    // 新しい取り込み（別の施設）に同じ資料：覚えから使う
    await call({ op: "open", options: OPTIONS });
    expect((await call({ op: "read", name: a.name, bytes: a.bytes.slice() })).cached).toBe(true);
    expect(host.stats.reads).toBe(1);
    expect(host.stats.cached).toBe(2);
    // 同じ名前でも中身が違えば読む
    await call({ op: "open", options: OPTIONS });
    const changed = await sheet(a.name, 4);
    expect((await call({ op: "read", name: changed.name, bytes: changed.bytes })).cached).toBe(false);
    expect(host.stats.reads).toBe(2);
  });

  test("作業場から：同じ資料を 2 回落としても、読み手は 1 回", async () => {
    const ws = sameThread();
    const a = await sheet("【架空】星取表A.xlsx", 3);
    await ws.addFiles([dropped(a)]);
    await ws.addFiles([dropped(a)]);
    expect(ws.view.rejected.map((r) => r.reason)).toContain("同じ名前の資料がもう入っている");
    // 年度の始まりを変えて読み直しても、読み手は走らせない
    await ws.configure({ ...settings, fiscalYearStartMonth: 1 });
    const host = (ws as unknown as { engine: { local: IntakeHost } }).engine.local;
    expect(host.stats.reads).toBe(1);
    expect(host.stats.cached).toBe(1);
    expect(ws.fileCount).toBe(1);
  });
});

describe("写しの要求を詰める", () => {
  test("受け手：読み込みの後ろの写しの要求は、読み終わってから 1 回だけ読み取って、まとめて答える", async () => {
    const host = new IntakeHost();
    const call = caller(host);
    await call({ op: "open", options: OPTIONS });
    const a = await sheet("【架空】表A.xlsx", 2);
    const b = await sheet("【架空】表B.xlsx", 3);
    const spy = vi.spyOn(IntakeSession.prototype, "analyze");
    const all = await Promise.all([
      call({ op: "read", name: a.name, bytes: a.bytes }, 1),
      call({ op: "view" }, 1),
      call({ op: "read", name: b.name, bytes: b.bytes }, 2),
      call({ op: "view" }, 2),
      call({ op: "view" }, 2),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    const views = [all[1], all[3], all[4]] as IntakeView[];
    for (const v of views) {
      expect(v.files).toEqual([a.name, b.name]);
      expect(v.at).toBe(2);
    }
  });

  test("作業場（worker の形）：読込の途中に資料や読み方が変わっても、読み終わってからの 1 回だけ読み取る", async () => {
    const ws = inWorker();
    const files = await Promise.all([1, 2, 3, 4, 5].map((i) => sheet(`【架空】表${i}.xlsx`, i)));
    const spy = vi.spyOn(IntakeSession.prototype, "analyze");
    let poked = false;
    ws.subscribe(() => {
      if (!poked && ws.readProgress?.done === 2) {
        poked = true;
        ws.setApprovedReadings([]);
        ws.setFacility({ packId: "night-soil" });
      }
    });
    await ws.addFiles(files.map(dropped));
    expect(poked).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ws.view.files).toHaveLength(5);
  });
});

describe("ツールは受け手の答えを待つ", () => {
  test("worker のときは同期の形では呼べない。待つ形は、前に置いた決定を含む値で答える", async () => {
    const ws = inWorker();
    await ws.addFiles(f2().map(dropped));
    expect(() => runTabTool(ws, "intake_survey", {}, CTX)).toThrow();
    const s1 = data(await runTabToolAsync(ws, "intake_survey", { part: "questions" }, CTX));
    const q = (s1.questions as { questionId: string; defaultAnswer: string | null }[]).find((x) => x.defaultAnswer !== null)!;
    expect(q).toBeTruthy();
    // 決定と要約を待たずに並べて呼ぶ：要約は決定を置いたあとの値で答える
    const [r, s2] = await Promise.all([
      runTabToolAsync(ws, "intake_settle", { decisions: [{ questionId: q.questionId, answer: q.defaultAnswer, author: "ai", reason: "既定の答え" }] }, CTX),
      runTabToolAsync(ws, "intake_survey", { part: "questions" }, CTX),
    ]);
    expect(data(r).unresolved).toBeTypeOf("number");
    expect((data(s2).questions as { questionId: string }[]).map((x) => x.questionId)).not.toContain(q.questionId);
    // 画面の写しも、待てば決定を含む
    await ws.fresh();
    expect(ws.decisions().map((d) => d.questionId)).toContain(q.questionId);
  });

  test("読込の途中に呼ばれた要約は、読み終わった資料までで答え、途中であることを注記に書く", async () => {
    const ws = inWorker();
    const files = await Promise.all([1, 2, 3, 4, 5].map((i) => sheet(`【架空】表${i}.xlsx`, i)));
    let mid: Promise<TabToolResult> | null = null;
    ws.subscribe(() => {
      if (!mid && ws.readProgress?.done === 1) mid = runTabToolAsync(ws, "intake_survey", {}, CTX);
    });
    await ws.addFiles(files.map(dropped));
    expect(mid).not.toBeNull();
    const s = data(await mid!);
    expect(s.files.length).toBeGreaterThanOrEqual(1);
    if (s.files.length < 5) expect(s.notes[0]).toContain(TEXT.intake.ai.readingNote(1, 5).slice(0, 8));
    const after = data(await runTabToolAsync(ws, "intake_survey", {}, CTX));
    expect(after.files).toHaveLength(5);
    expect((after.notes as string[]).some((n) => n.startsWith(TEXT.intake.ai.readingNote(0, 0).slice(0, 8)))).toBe(false);
  });

  test("人が画面で答える（worker の形）：置いて写しが届くまで busy。届いた写しに決定がある", async () => {
    const ws = inWorker();
    await ws.addFiles(f2().map(dropped));
    const v = ws.view;
    const q = v.questions.find((x) => v.open.includes(x.questionId) && x.defaultAnswer !== null)!;
    expect(q).toBeTruthy();
    const p = ws.answerAsHumanAsync(q.questionId, q.defaultAnswer!, "試験の台本が押した");
    expect(ws.busy).toBe(true);
    expect((await p).ok).toBe(true);
    expect(ws.busy).toBe(false);
    expect(ws.view.decisions).toContainEqual(expect.objectContaining({ questionId: q.questionId, author: "human" }));
    // 取り消しも同じ
    const u = ws.undoAsync(q.questionId);
    expect(ws.busy).toBe(true);
    await u;
    expect(ws.busy).toBe(false);
    expect(ws.view.decisions.map((d) => d.questionId)).not.toContain(q.questionId);
  });

  test("読み方の規則を置くツールは、読み直しのあとの数で答える", async () => {
    const ws = inWorker();
    await ws.addFiles(f2().map(dropped));
    const r = data(
      await runTabToolAsync(
        ws,
        "reading_rules_propose",
        { name: "【架空】台帳の読み方", scope: "facility", rules: [{ id: "x1", text: "「備考」の列は外す", kind: "columnRole", column: "備考", role: "exclude", author: "ai", reason: "会話で決めた" }] },
        CTX,
      ),
    );
    await ws.fresh();
    expect(r.unresolvedCells).toBe(ws.view.unresolvedCells);
    expect(r.openQuestions).toBe(ws.view.open.length);
  });
});

describe("worker の写しは、同じスレッドの読み取りと同じ", () => {
  test("工場の資料（fictional-2）：写し・要約・決定のあとの写し・計画", async () => {
    const a = sameThread();
    const b = inWorker();
    await a.addFiles(f2().map(dropped));
    await b.addFiles(f2().map(dropped));
    expect(withoutAt(b.view)).toEqual(withoutAt(a.view));
    expect(data(await runTabToolAsync(b, "intake_survey", {}, CTX))).toEqual(data(runTabTool(a, "intake_survey", {}, CTX)));
    // 既定の答えのある質問に、質問が無くなるまで答える（どちらにも同じ決定）
    let rounds = 0;
    for (; rounds < 10; rounds++) {
      const v = a.view;
      const ds = v.questions
        .filter((q) => v.open.includes(q.questionId) && q.defaultAnswer !== null)
        .map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer!, author: "ai_relayed_human" as const, reason: "利用者がチャットで答えた" }));
      if (!ds.length) break;
      expect(await b.settleAsync(ds)).toEqual(a.settle(ds));
      expect(withoutAt(b.view)).toEqual(withoutAt(a.view));
    }
    expect(rounds).toBeGreaterThan(0);
    expect(b.composeBlockers()).toEqual(a.composeBlockers());
    expect(b.intakeStats()).toEqual(a.intakeStats());
    expect(b.aiOnlyLinks()).toEqual(a.aiOnlyLinks());
    // シートの写し（画面が開いた資料だけ）
    const sa = await a.sheets(F2_FILES[1]!);
    const sb = await b.sheets(F2_FILES[1]!);
    expect(sb.map((s) => [s.file, s.sheetIndex, s.grid.cells.length, [...s.status]])).toEqual(sa.map((s) => [s.file, s.sheetIndex, s.grid.cells.length, [...s.status]]));
    expect(await b.nextUnresolved(null)).toEqual(await a.nextUnresolved(null));
    expect(await b.matchRows("日付なし")).toEqual(await a.matchRows("日付なし"));
    // 計画を作る（どちらも同じ計画。計画は worker から構造化複製で届く）
    expect(a.composeBlockers()).toEqual([]);
    a.startCompose("human");
    await a.whenComposed();
    const pa = getWorkingPlan()!.plan;
    clearWorkingPlan();
    b.startCompose("human");
    await b.whenComposed();
    expect(b.compose.state).toBe("done");
    const pb = getWorkingPlan()!.plan;
    expect(pb.planId).toBe(pa.planId);
    expect([pb.assets.length, pb.works.length, pb.details.length]).toEqual([pa.assets.length, pa.works.length, pa.details.length]);
    expect(pb.details.map((d) => d.detailKey)).toEqual(pa.details.map((d) => d.detailKey));
    expect(b.notRecomposed()).toBe(false);
  });

  test("写真：人と AI の操作は、worker の中の写真の一覧にも同じにする", async () => {
    const bytes = photoBytes();
    const size = jpegSize(bytes)!;
    const img: PreparedImage = {
      data: Buffer.from(bytes).toString("base64"),
      width: size.width,
      height: size.height,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      quality: null,
      source: size,
      overTarget: false,
    };
    const a = sameThread();
    const b = inWorker();
    for (const ws of [a, b]) {
      await ws.addFiles([dropped({ name: PHOTO_NAME, bytes })]);
      expect(ws.photoBook.entries().map((e) => e.input.name)).toEqual([PHOTO_NAME]);
      await ws.fresh();
      expect(ws.composeBlockers().join("・")).toContain("読んでいない写真 1");
      ws.photos.allowed(PHOTO_NAME, img, "2026-11-06T00:00:00.000Z");
      data(await runTabToolAsync(ws, "photo_transcribe", { mode: "receive", imageRef: PHOTO_NAME }, CTX));
      data(await runTabToolAsync(ws, "photo_transcribe", { mode: "place", grid: truthReading(size) }, CTX));
      await ws.fresh();
      expect(ws.view.files).toContain(PHOTO_NAME);
    }
    expect(withoutAt(b.view)).toEqual(withoutAt(a.view));
    // 人が読まずに外す
    for (const ws of [a, b]) {
      expect(ws.photos.exclude(PHOTO_NAME)).toBe("ok");
      await ws.fresh();
      expect(ws.view.rejected).toContainEqual({ file: PHOTO_NAME, reason: PHOTO_EXCLUDED_REASON });
    }
    expect(withoutAt(b.view)).toEqual(withoutAt(a.view));
  });
});

describe("worker が起きないとき", () => {
  test("起きる前に落ちたら、同じスレッドの受け手で続け、そう知らせる", async () => {
    let fail: () => void = () => undefined;
    const port: IntakePort = {
      post: () => {
        throw new Error("起きる前の worker には送らない");
      },
      listen: (_on, f) => {
        fail = f;
      },
    };
    const ws = new IntakeWorkspace(settings, new WorkerEngine(port, () => new IntakeHost()));
    const a = await sheet("【架空】星取表A.xlsx", 3);
    const reading = ws.addFiles([dropped(a)]);
    fail();
    await reading;
    expect(ws.fileCount).toBe(1);
    expect(ws.view.files).toEqual([a.name]);
    expect(ws.notices.map((n) => n.text)).toContain(TEXT.intake.workerFallback);
  });

  test("落ちたままなら、待っている要求は誤りで終わる（黙って待たせない）", async () => {
    let fail: () => void = () => undefined;
    const port: IntakePort = { post: () => undefined, listen: (_on, f) => (fail = f) };
    const ws = new IntakeWorkspace(settings, new WorkerEngine(port));
    const a = await sheet("【架空】星取表A.xlsx", 3);
    const reading = ws.addFiles([dropped(a)]);
    fail();
    await reading;
    expect(ws.fileCount).toBe(0);
    expect(ws.skippedFiles.map((f) => f.reason)).toEqual([TEXT.intake.drop.failed]);
    expect(ws.notices.map((n) => n.text)).toContain(TEXT.intake.workerStopped);
  });
});
