// 写真の取り込み（docs/plan.md §2.3・§2.12・§2.13）：作業画面の側（取り込みの作業場・写真の机・写真のツールの受け手）。
// 許すまで受け取れない／許した 1 枚だけを 1 回、型から外れた格子は直さず断る、位置が画像の外なら断る、
// 写真から作った記録は要確認で、要確認があるうちは計画を作らない、人が一言の理由で確かめると要確認が外れる。
// 人の操作（許す・直す・確かめる・外す）は、画面のボタンの代わりに試験の台本が押す（結果に「試験の台本が押した」と書く）。
// Node には canvas が無いので、作業画面が描き直す代わりに、形がもう合う工場の JPEG（長辺 1,800 px・100 KB 以下）をそのまま渡す画像にする。
// 描き直し（長辺と大きさ）は、Chrome・Edge の端から端までの試験（tests/e2e/photo.spec.ts）で測る。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IntakeWorkspace, type DroppedFile } from "../../src/app/intake/workspace";
import { runTabTool, TAB_TOOL_RECEIVERS } from "../../src/app/intake/tab-tools";
import { sendSize, type PreparedImage } from "../../src/app/intake/photos";
import { IntakeSession } from "../../src/import";
import { markPhotoRecords, photoSource, scannedPageInput } from "../../src/import/photo";
import type { SourceFile } from "../../src/import/grid";
import { HUMAN_ACTIONS } from "../../src/shared/routes";
import { PHOTO_SEND, TOOLS, TOOL_NAMES, toolDef } from "../../src/shared/tools";
import type { AssetNodeT, WorkDetailT } from "../../src/shared/plan";
import { PHOTO_DIR, PHOTO_NAME, jpegSize, photoBytes, truthReading } from "../helpers/photo";

const CTX = { conversation: "c-test", rowsRemaining: 2000 };
const TRIO = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"];
const F2 = "photos/inspection-photo-f2-fy2026.jpg";
const F2_NAME = "inspection-photo-f2-fy2026.jpg";
const SCRIPT_REASON = "試験の台本が押した";

function dropped(name: string, bytes: Uint8Array): DroppedFile {
  return { name, size: bytes.length, bytes: async () => bytes };
}

function workspace(): IntakeWorkspace {
  return new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】写真の試験", fiscalYearStartMonth: 4, fictional: true });
}

/** 渡す画像：工場の JPEG をそのまま（形がもう合うので、描き直さない。品質は null） */
function prepared(bytes: Uint8Array): PreparedImage {
  const size = jpegSize(bytes);
  if (!size) throw new Error("JPEG でない");
  return {
    data: Buffer.from(bytes).toString("base64"),
    width: size.width,
    height: size.height,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    quality: null,
    source: size,
    overTarget: false,
  };
}

/** 人が許す（画面のボタン → 人だけの経路が通ったあとの記録。試験の台本が押した） */
function allowAsHuman(ws: IntakeWorkspace, name: string, bytes: Uint8Array): PreparedImage {
  const img = prepared(bytes);
  ws.photos.allowed(name, img, new Date().toISOString());
  return img;
}

const receive = (ws: IntakeWorkspace, imageRef?: string) => runTabTool(ws, "photo_transcribe", { mode: "receive", ...(imageRef ? { imageRef } : {}) }, CTX);
const place = (ws: IntakeWorkspace, grid: unknown) => runTabTool(ws, "photo_transcribe", { mode: "place", grid }, CTX);

async function trioAndPhoto(): Promise<IntakeWorkspace> {
  const ws = workspace();
  await ws.addFiles([...TRIO.map((n) => dropped(n, new Uint8Array(readFileSync(`${PHOTO_DIR}/${n}`)))), dropped(PHOTO_NAME, photoBytes())]);
  return ws;
}

/** 開いた質問に、既定の答えがあれば既定で、無ければ最初の選択肢で答える（試験の台本が押した） */
function answerAll(ws: IntakeWorkspace): void {
  for (let i = 0; i < 20; i++) {
    const open = ws.analysis().open.filter((q) => !q.decision);
    if (!open.length) return;
    const r = ws.settle(open.map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer ?? q.options[0]?.id ?? "", author: "human", reason: SCRIPT_REASON })));
    expect(r.ok).toBe(true);
  }
}

describe("写真は読まずに並べる", () => {
  it("落とした写真は層 1 で読まず、読むか外すまで計画を作らない（黙って落とさない）", async () => {
    const ws = workspace();
    await ws.addFiles([dropped(PHOTO_NAME, photoBytes())]);
    expect(ws.photoBook.entries().map((e) => e.input.name)).toEqual([PHOTO_NAME]);
    const an = ws.analysis();
    expect(an.sources).toEqual([]);
    expect(an.rejected).toEqual([]);
    expect(ws.composeBlockers().join("・")).toContain(`読んでいない写真 1（${PHOTO_NAME}）`);
    expect(ws.survey().notes.join("\n")).toContain(`${PHOTO_NAME}：写真（まだ読んでいない`);
    // 人が読まずに外すと、理由つきで「読まなかった資料」に数え、止める決まりから外れる
    expect(ws.photos.exclude(PHOTO_NAME)).toBe("ok");
    expect(ws.analysis().rejected).toEqual([{ file: PHOTO_NAME, reason: "人が画面で、読まずに外した" }]);
    expect(ws.composeBlockers().join("・")).not.toContain("読んでいない写真");
    expect(ws.photos.include(PHOTO_NAME)).toBe("ok");
    expect(ws.composeBlockers().join("・")).toContain("読んでいない写真 1");
  });

  it("中身が拡張子の形と合わない画像は、理由つきで読まない", async () => {
    const ws = workspace();
    await ws.addFiles([dropped("not-a-photo.jpg", new TextEncoder().encode("これは画像ではない"))]);
    expect(ws.photoBook.entries()).toHaveLength(0);
    expect(ws.analysis().rejected[0]?.reason).toContain("拡張子の形");
  });
});

describe("許すのは人だけ：許すまで receive は断り、許した 1 枚だけを 1 回渡す", () => {
  it("許す前は断る。許した写真だけ、1 回だけ受け取れる", async () => {
    const ws = workspace();
    const f2 = new Uint8Array(readFileSync(`${PHOTO_DIR}/${F2}`));
    await ws.addFiles([dropped(PHOTO_NAME, photoBytes()), dropped(F2_NAME, f2)]);
    // 許す前
    expect(receive(ws)).toEqual({ ok: false, code: "photo_not_allowed" });
    expect(receive(ws, PHOTO_NAME)).toEqual({ ok: false, code: "photo_not_allowed" });
    // 人が 1 枚目だけを許す
    const img = allowAsHuman(ws, PHOTO_NAME, photoBytes());
    expect(ws.photos.waiting()).toBe(1);
    // 許していない 2 枚目は受け取れない
    expect(receive(ws, F2_NAME)).toEqual({ ok: false, code: "photo_not_allowed" });
    const r = receive(ws);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ mode: "receive", imageRef: PHOTO_NAME, placedCells: 0, needsReview: true, waiting: 0 });
    expect(r.data.image).toEqual({ width: img.width, height: img.height, bytes: img.bytes, mimeType: "image/jpeg" });
    expect(r.image).toEqual({ mimeType: "image/jpeg", data: img.data });
    expect(String(r.data.note)).toContain("box");
    // 許しは使い終わった
    expect(receive(ws)).toEqual({ ok: false, code: "photo_not_allowed" });
    expect(receive(ws, PHOTO_NAME)).toEqual({ ok: false, code: "photo_not_allowed" });
    expect(ws.photos.transfer(PHOTO_NAME).kind).toBe("sent");
    // 人が 2 枚目を許すと、その 1 枚だけ
    allowAsHuman(ws, F2_NAME, f2);
    const r2 = receive(ws, F2_NAME);
    expect(r2.ok && r2.data.imageRef).toBe(F2_NAME);
    // 画面にも AI の作業として出る
    expect(ws.notices.some((n) => n.kind === "ai" && n.text.includes(`写真「${PHOTO_NAME}」を受け取りました`))).toBe(true);
    expect(ws.notices.some((n) => n.kind === "info" && n.text.includes("許しました"))).toBe(true);
  });

  it("人が読まずに外した写真は、許しが残っていても渡さない", async () => {
    const ws = workspace();
    await ws.addFiles([dropped(PHOTO_NAME, photoBytes())]);
    allowAsHuman(ws, PHOTO_NAME, photoBytes());
    ws.photos.exclude(PHOTO_NAME);
    expect(receive(ws)).toEqual({ ok: false, code: "photo_not_allowed" });
  });

  it("AI のツールに、許す・確かめる・外す道が無い（写真のツールの引数は mode・imageRef・grid だけ）", () => {
    const shape = (toolDef("photo_transcribe").input as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape).sort()).toEqual(["grid", "imageRef", "mode"]);
    expect(Object.keys(TAB_TOOL_RECEIVERS).sort()).toEqual(["chart_rows", "check_results", "crosswalk_propose", "intake_compose", "intake_settle", "intake_survey", "peer_reference", "photo_transcribe"]);
    expect(HUMAN_ACTIONS).toContain("photo_allow");
    for (const n of TOOL_NAMES) expect(n).not.toMatch(/allow|confirm|exclude|accept/);
    expect(TOOLS.photo_transcribe.description).toContain("許すツール・確かめるツールは無い");
  });
});

describe("格子の型と位置：外れたものは直さずに断る", () => {
  async function received(): Promise<IntakeWorkspace> {
    const ws = workspace();
    await ws.addFiles([dropped(PHOTO_NAME, photoBytes())]);
    allowAsHuman(ws, PHOTO_NAME, photoBytes());
    expect(receive(ws).ok).toBe(true);
    return ws;
  }
  const cell = (over: Record<string, unknown> = {}) => ({ row: 0, col: 0, text: "【架空】", box: { x: 10, y: 10, w: 100, h: 20 }, confidence: 0.9, ...over });

  it.each([
    ["確からしさが 1 を越える", { mode: "place", grid: { imageRef: PHOTO_NAME, cells: [cell({ confidence: 1.5 })] } }],
    ["文字が空", { mode: "place", grid: { imageRef: PHOTO_NAME, cells: [cell({ text: "" })] } }],
    ["同じ行・列が 2 つ", { mode: "place", grid: { imageRef: PHOTO_NAME, cells: [cell(), cell({ text: "別" })] } }],
    ["位置が負", { mode: "place", grid: { imageRef: PHOTO_NAME, cells: [cell({ box: { x: -1, y: 0, w: 10, h: 10 } })] } }],
    ["幅が 0", { mode: "place", grid: { imageRef: PHOTO_NAME, cells: [cell({ box: { x: 0, y: 0, w: 0, h: 10 } })] } }],
    ["行が小数", { mode: "place", grid: { imageRef: PHOTO_NAME, cells: [cell({ row: 0.5 })] } }],
    ["セルが 0", { mode: "place", grid: { imageRef: PHOTO_NAME, cells: [] } }],
    ["place に grid が無い", { mode: "place" }],
    ["receive に grid を付けた", { mode: "receive", grid: { imageRef: PHOTO_NAME, cells: [cell()] } }],
    ["place で imageRef を外に書いた", { mode: "place", imageRef: PHOTO_NAME, grid: { imageRef: PHOTO_NAME, cells: [cell()] } }],
    ["箱の欄が足りない", { mode: "place", grid: { imageRef: PHOTO_NAME, cells: [cell({ box: { x: 1, y: 1, w: 2 } })] } }],
  ])("型から外れた格子を断る：%s", async (_label, args) => {
    expect(toolDef("photo_transcribe").input.safeParse(args).success).toBe(false);
    const ws = await received();
    expect(runTabTool(ws, "photo_transcribe", args as Record<string, unknown>, CTX)).toEqual({ ok: false, code: "tool_failed" });
    expect(ws.photoBook.get(PHOTO_NAME)?.reading).toBeNull();
  });

  it("位置が受け取った画像の外にあれば、どのセルも置かない", async () => {
    const ws = await received();
    const size = jpegSize(photoBytes())!;
    const r = place(ws, { imageRef: PHOTO_NAME, cells: [cell(), cell({ col: 1, box: { x: size.width - 5, y: 0, w: 10, h: 10 } })] });
    expect(r).toEqual({ ok: false, code: "photo_grid_invalid" });
    expect(ws.photoBook.get(PHOTO_NAME)?.reading).toBeNull();
  });

  it("受け取っていない写真には置けない", async () => {
    const ws = workspace();
    await ws.addFiles([dropped(PHOTO_NAME, photoBytes())]);
    expect(place(ws, { imageRef: PHOTO_NAME, cells: [cell()] })).toEqual({ ok: false, code: "photo_not_received" });
    allowAsHuman(ws, PHOTO_NAME, photoBytes());
    // 許しただけで、まだ受け取っていない
    expect(place(ws, { imageRef: PHOTO_NAME, cells: [cell()] })).toEqual({ ok: false, code: "photo_not_received" });
    expect(place(ws, { imageRef: "無い写真.jpg", cells: [cell()] })).toEqual({ ok: false, code: "photo_not_received" });
  });

  it("型どおりの格子は、元の画像の画素の位置で置き、作者は AI（読み取り）", async () => {
    const ws = await received();
    const grid = truthReading(jpegSize(photoBytes())!);
    const r = place(ws, grid);
    expect(r).toEqual({ ok: true, data: expect.objectContaining({ mode: "place", imageRef: PHOTO_NAME, placedCells: grid.cells.length, needsReview: true, image: null }) });
    const reading = ws.photoBook.get(PHOTO_NAME)!.reading!;
    expect(reading.width).toBe(1800);
    expect(reading.height).toBe(655);
    expect(reading.cells).toHaveLength(grid.cells.length);
    for (const c of reading.cells) {
      expect(c.author).toBe("ai_reading");
      expect(c.box.x + c.box.w).toBeLessThanOrEqual(reading.width);
    }
    // 格子は、層 1 の出力と同じ形（セルの格子＋出どころ）で層 2〜4 に入る
    const src = ws.analysis().sources.find((s) => s.file === PHOTO_NAME)!;
    expect(src.format).toBe("photo");
    expect(src.sheets[0]?.cells.find((c) => c.ref === "A1")?.text).toBe("【架空】定期整備 工事報告書");
    expect(src.photo?.boxes.A1).toEqual([140, 192, 340, 40]);
    expect(src.photo?.confirmed).toBe(false);
  });
});

describe("要確認と止める決まり", () => {
  it("写真から作った記録はどれも要確認。要確認があるうちは計画を作らない（AI が作り始めても）", async () => {
    const ws = await trioAndPhoto();
    allowAsHuman(ws, PHOTO_NAME, photoBytes());
    expect(receive(ws).ok).toBe(true);
    expect(place(ws, truthReading(jpegSize(photoBytes())!)).ok).toBe(true);
    answerAll(ws);
    const an = ws.analysis();
    const review = an.composition.photoReview;
    const mine = review.byFile[PHOTO_NAME]!;
    expect(mine.confirmed).toBe(false);
    expect(mine.assets + mine.details).toBeGreaterThan(0);
    expect(review.assets + review.details).toBe(mine.assets + mine.details);
    const blockers = ws.composeBlockers();
    expect(blockers).toContain(`要確認 ${review.assets + review.details}`);
    // AI が計画を作り始めても、作らない
    expect(runTabTool(ws, "intake_compose", {}, CTX)).toMatchObject({ ok: true });
    await ws.whenComposed();
    expect(ws.compose.state).toBe("failed");
    expect(ws.compose.state === "failed" && ws.compose.blockers.join("・")).toContain("要確認");
    console.log(`写真：要確認 ${review.assets + review.details}（機器の節 ${review.assets}・明細 ${review.details}）、置いたセル ${ws.photoBook.get(PHOTO_NAME)!.reading!.cells.length}`);
  });

  it("写真から作った明細は要確認・作者は AI（読み取り）・出どころに画像の位置。人が確かめたら要確認でない", () => {
    const src = (confirmed: boolean): SourceFile => ({
      file: "p.jpg",
      format: "photo",
      sheets: [],
      ledger: [],
      date1904: false,
      photo: { confirmed, confirmedReason: confirmed ? "並べて合っていた" : null, page: null, boxes: { B3: [1, 2, 3, 4] }, authors: { B3: "ai_reading" } },
    });
    const mk = (): { assets: AssetNodeT[]; details: WorkDetailT[] } => ({
      assets: [
        {
          nodeKey: "n-1",
          tag: null,
          name: "x",
          level: 1,
          parentKey: null,
          classCode: null,
          commonItem: null,
          commonItemAuthor: null,
          commonItemBasis: null,
          commonItemAccepted: false,
          specs: [],
          installedOn: null,
          removedOn: null,
          replacedOn: null,
          series: null,
          sources: [{ file: "p.jpg", sheet: null, page: null, cell: "B3", box: null }],
        },
      ],
      details: [
        {
          detailKey: "d-1",
          workKey: "w-1",
          planOrActual: "actual",
          step: null,
          startDate: null,
          endDate: null,
          fiscalYear: 2025,
          cost: null,
          manDays: 3,
          days: null,
          resultScale: null,
          resultValue: null,
          measuredValue: null,
          previousValue: null,
          performer: null,
          sources: [
            { file: "ledger.xlsx", sheet: "s", page: null, cell: "A1", box: null },
            { file: "p.jpg", sheet: null, page: null, cell: "B3", box: null },
          ],
          basis: "根拠",
          author: "human",
          needsReview: false,
        },
      ],
    });
    const a = mk();
    const r = markPhotoRecords([src(false)], a.assets, a.details);
    expect(r).toEqual({ assets: 1, details: 1, photos: 1, byFile: { "p.jpg": { assets: 1, details: 1, confirmed: false } } });
    expect(a.details[0]).toMatchObject({ needsReview: true, author: "ai_reading" });
    expect(a.details[0]?.sources[1]?.box).toEqual([1, 2, 3, 4]);
    expect(a.assets[0]?.sources[0]?.box).toEqual([1, 2, 3, 4]);
    expect(a.details[0]?.basis).toContain("AI（読み取り）が読んだ（人が確かめるまで要確認）");
    const b = mk();
    const r2 = markPhotoRecords([src(true)], b.assets, b.details);
    expect(r2.assets + r2.details + r2.photos).toBe(0);
    expect(b.details[0]).toMatchObject({ needsReview: false, author: "ai_reading" });
    expect(b.details[0]?.basis).toContain("人が画像と並べて確かめた（並べて合っていた）");
  });
});

describe("人が確かめる：画像と並べてセルを直し、一言の理由で確かめる", () => {
  it("直したセルは作者が人。人が触った写真は AI が置き直せない。理由が空なら確かめられない。確かめると計画を作れる", async () => {
    const ws = await trioAndPhoto();
    allowAsHuman(ws, PHOTO_NAME, photoBytes());
    expect(receive(ws).ok).toBe(true);
    const grid = truthReading(jpegSize(photoBytes())!);
    expect(place(ws, grid).ok).toBe(true);
    // 人が 1 つのセルを直し（作者は人。AI が読んだ文字は残る）、戻す
    expect(ws.photos.correct(PHOTO_NAME, 1, 0, "施設名")).toBe("ok");
    const c = ws.photoBook.get(PHOTO_NAME)!.reading!.cells.find((x) => x.row === 1 && x.col === 0)!;
    expect(c).toMatchObject({ text: "施設名", aiText: "施設", author: "human" });
    expect(ws.analysis().sources.find((s) => s.file === PHOTO_NAME)?.photo?.authors.A2).toBe("human");
    // 人が触った写真には、AI は置き直せない
    expect(place(ws, grid)).toEqual({ ok: false, code: "photo_human_reviewed" });
    expect(ws.photos.correct(PHOTO_NAME, 1, 0, "施設")).toBe("ok");
    expect(ws.photoBook.get(PHOTO_NAME)!.reading!.cells.find((x) => x.row === 1 && x.col === 0)?.author).toBe("ai_reading");
    // 理由が空なら確かめられない
    expect(ws.photos.confirm(PHOTO_NAME, "  ")).toBe("reason_empty");
    answerAll(ws);
    expect(ws.composeBlockers().join("・")).toMatch(/要確認 \d+/);
    // 人が一言の理由で確かめる（試験の台本が押した）
    expect(ws.photos.confirm(PHOTO_NAME, `${SCRIPT_REASON}：正解から書いた格子なので、画像の表と合っている`)).toBe("ok");
    expect(ws.analysis().composition.photoReview.byFile[PHOTO_NAME]?.confirmed).toBe(true);
    // 確かめたあとは、AI は置き直せず、人も直せない（取り消してから）
    expect(place(ws, grid)).toEqual({ ok: false, code: "photo_human_reviewed" });
    expect(ws.photos.correct(PHOTO_NAME, 1, 0, "x")).toBe("confirmed");
    answerAll(ws);
    expect(ws.composeBlockers()).toEqual([]);
    ws.startCompose("human");
    await ws.whenComposed();
    expect(ws.compose.state).toBe("done");
    if (ws.compose.state !== "done") return;
    // 写真から作った記録の出どころには、画像の位置が付く
    const fromPhoto = [...ws.compose.plan.assets, ...ws.compose.plan.details].flatMap((x) => x.sources).filter((s) => s.file === PHOTO_NAME);
    expect(fromPhoto.length).toBeGreaterThan(0);
    for (const s of fromPhoto) expect(s.box).not.toBeNull();
    for (const d of ws.compose.plan.details) expect(d.needsReview).toBe(false);
    // 確かめを取り消すと、また要確認
    expect(ws.photos.unconfirm(PHOTO_NAME)).toBe("ok");
    expect(ws.composeBlockers().join("・")).toMatch(/要確認 \d+/);
  });

  it("人が読み取りを捨てると、AI はもう一度置ける", async () => {
    const ws = workspace();
    await ws.addFiles([dropped(PHOTO_NAME, photoBytes())]);
    allowAsHuman(ws, PHOTO_NAME, photoBytes());
    receive(ws);
    const grid = truthReading(jpegSize(photoBytes())!);
    place(ws, grid);
    ws.photos.correct(PHOTO_NAME, 0, 0, "直した");
    expect(place(ws, grid)).toEqual({ ok: false, code: "photo_human_reviewed" });
    expect(ws.photos.discard(PHOTO_NAME)).toBe("ok");
    expect(ws.composeBlockers().join("・")).toContain("読んでいない写真 1");
    expect(place(ws, grid).ok).toBe(true);
  });
});

describe("渡す大きさ：長辺 1,568〜2,000 px（縦横の比は変えない）", () => {
  it.each([
    [4032, 3024, 2000, 1500],
    [3024, 4032, 1500, 2000],
    [1800, 655, 1800, 655],
    [2000, 10, 2000, 10],
    [2001, 1, 2000, 1],
    [800, 600, 1568, 1176],
    [100, 100, 1568, 1568],
    [1568, 900, 1568, 900],
    [12000, 9000, 2000, 1500],
  ])("%i × %i → %i × %i", (w, h, ew, eh) => {
    const s = sendSize(w, h);
    expect(s).toEqual({ width: ew, height: eh });
    const long = Math.max(s.width, s.height);
    expect(long).toBeGreaterThanOrEqual(PHOTO_SEND.longSideMin);
    expect(long).toBeLessThanOrEqual(PHOTO_SEND.longSideMax);
    // 丸めの誤差（縦横それぞれ 0.5 px まで）のほかは、比を変えない
    expect(Math.abs(s.width * h - s.height * w)).toBeLessThanOrEqual((w + h) / 2);
  });

  it("工場の写真は、長辺 1,800 px・100 KB 以下の JPEG（この試験で渡す画像にそのまま使えることを確かめる）", () => {
    const b = photoBytes();
    expect(jpegSize(b)).toEqual({ width: 1800, height: 655 });
    expect(b.length).toBeLessThanOrEqual(PHOTO_SEND.targetBytes);
    expect(PHOTO_SEND.targetBytes).toBe(100 * 1024);
  });
});

describe("文字の無い PDF の頁の入口（PDF の読み手が呼ぶ）", () => {
  it("頁の画像を写真と同じく並べ、読み取りの出どころに頁と画像の位置を付ける", async () => {
    const s = new IntakeSession({
      planId: "p",
      displayName: "【架空】",
      packId: "waste-incineration",
      facility: { facilityKey: "f", name: "【架空】", fiscalYearStartMonth: 4, scale: null, scaleUnit: null, legalFlags: [], fictional: true, inNationalTable: null },
    });
    const input = scannedPageInput("report-scan.pdf", 3, { bytes: photoBytes(), mimeType: "image/jpeg" });
    expect(input).toMatchObject({ name: "report-scan.pdf#p3", origin: { kind: "pdf_page", file: "report-scan.pdf", page: 3 } });
    expect(await s.addPhotos([input])).toEqual([]);
    expect(s.analyze().composition.blockers.join("・")).toContain("読んでいない写真 1（report-scan.pdf#p3）");
    expect(s.photos.place("report-scan.pdf#p3", { width: 1800, height: 655, cells: [{ row: 0, col: 0, text: "【架空】", box: { x: 1, y: 2, w: 3, h: 4 }, confidence: 1 }] }, "t", null)).toBe("ok");
    const src = photoSource(s.photos.get("report-scan.pdf#p3")!);
    expect(src.photo?.page).toBe(3);
    const assets: AssetNodeT[] = [];
    const details: WorkDetailT[] = [
      {
        detailKey: "d",
        workKey: "w",
        planOrActual: "actual",
        step: null,
        startDate: null,
        endDate: null,
        fiscalYear: 2025,
        cost: null,
        manDays: null,
        days: null,
        resultScale: null,
        resultValue: null,
        measuredValue: null,
        previousValue: null,
        performer: null,
        sources: [{ file: "report-scan.pdf#p3", sheet: null, page: null, cell: "A1", box: null }],
        basis: "b",
        author: "rule_code",
        needsReview: false,
      },
    ];
    markPhotoRecords([src], assets, details);
    expect(details[0]?.sources[0]).toMatchObject({ page: 3, box: [1, 2, 3, 4] });
    expect(details[0]?.needsReview).toBe(true);
  });
});
