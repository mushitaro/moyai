// 写真・スキャンの取り込み（plan §2.3）。写真は層 1 の読み手では読まない。落とした写真は並べるだけで、
// 人が画面で 1 枚ずつ AI クライアントに渡すことを許し、AI が読んだ格子（行・列・文字・位置・確からしさ）を置くと、
// その格子を「セルの格子＋出どころ（ファイル・画像の位置）」にして、層 2〜4 へほかの形式と同じく渡す。
// AI が読んだものの作者は「AI（読み取り）」。人が画像と並べて確かめるまで、この写真から作った記録はどれも要確認で、
// 要確認が 1 つでもあれば計画を作らない（止める決まり。数えるのは層 4 の compose.ts が markPhotoRecords で）。
// 読んでいない写真も、人が読むか外すまで計画を作らない（黙って捨てない）。
// ここは純粋な TS（画面も通信も持たない）。画像を小さくして AI に渡すのは作業画面（app/intake/photos.ts）。
import type { AuthorKind } from "../shared/fields";
import type { AssetNodeT, SourceRef, WorkDetailT } from "../shared/plan";
import { cellRef, leadingSpaceWidth, type GridCell, type LedgerEntry, type PhotoMeta, type RejectedFile, type SourceFile } from "./grid";

/** 写真として受ける拡張子と形（ここだけに置く） */
export const PHOTO_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" } as const;
export type PhotoMime = (typeof PHOTO_TYPES)[keyof typeof PHOTO_TYPES];

/** 確からしさがこれより低いセルは、確かめるときに目立たせ、台帳に数える */
export const PHOTO_LOW_CONFIDENCE = 0.7;

export function photoMimeOf(name: string): PhotoMime | null {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
  return (PHOTO_TYPES as Record<string, PhotoMime>)[ext] ?? null;
}

/** 中身の頭が形と合うか（JPEG は FF D8 FF、PNG は 89 50 4E 47 0D 0A 1A 0A） */
export function sniffPhoto(bytes: Uint8Array, mime: PhotoMime): boolean {
  const head = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  return mime === "image/jpeg" ? head([0xff, 0xd8, 0xff]) : head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

/** 写真の出どころ：落とした画像のファイルか、文字の無い PDF の頁 */
export type PhotoOrigin = { kind: "file" } | { kind: "pdf_page"; file: string; page: number };

export interface PhotoInput {
  /** 取り込みの中で一意の名前（写真はファイルの名前、PDF の頁は「ファイルの名前#p頁」）。AI には imageRef として見せる */
  name: string;
  bytes: Uint8Array;
  mimeType: PhotoMime;
  origin: PhotoOrigin;
}

/**
 * 文字の無い PDF の頁を、写真の道へ回す入口（PDF の読み手が、頁を画像にしてから呼ぶ）。
 * 返したものを IntakeSession.addPhotos に渡すと、写真と同じく「人の許しを待つ画像」として並ぶ。
 * 読み取りの出どころは、この名前（ファイルの名前#p頁）と頁の番号と、頁の画像の上の位置になる。
 */
export function scannedPageInput(file: string, page: number, image: { bytes: Uint8Array; mimeType: PhotoMime }): PhotoInput {
  return { name: `${file}#p${page}`, bytes: image.bytes, mimeType: image.mimeType, origin: { kind: "pdf_page", file, page } };
}

export interface PhotoBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 読み取りの 1 セル。位置は元の画像の画素 */
export interface PhotoCellRead {
  /** 0 から数える行と列（AI が置いたまま） */
  row: number;
  col: number;
  /** 今の文字（人が直したら人の文字。空は、人が消したセル） */
  text: string;
  /** AI が読んだ文字（人が直しても残す） */
  aiText: string;
  box: PhotoBox;
  confidence: number;
  author: "ai_reading" | "human";
}

export interface PhotoReading {
  /** 位置の基になる画像の大きさ（元の画像の画素） */
  width: number;
  height: number;
  cells: PhotoCellRead[];
  placedAt: string;
  /** 置いた会話（中継の 1 つの接続） */
  conversation: string | null;
}

export interface PhotoEntry {
  input: PhotoInput;
  /** 元の画像のバイト列の SHA-256 */
  sha256: string;
  reading: PhotoReading | null;
  confirmed: { at: string; reason: string } | null;
  excluded: { at: string; reason: string } | null;
}

export type PhotoState = "unread" | "read" | "confirmed" | "excluded";

export type PlaceOutcome = "ok" | "unknown" | "human_reviewed" | "out_of_image" | "duplicate_cell" | "empty";
export type ReviewOutcome = "ok" | "unknown" | "no_reading" | "confirmed" | "no_cell" | "reason_empty";

/** 人が読まずに外したときの理由（台帳と「読まなかった資料」に出す） */
export const PHOTO_EXCLUDED_REASON = "人が画面で、読まずに外した";

export function photoState(e: PhotoEntry): PhotoState {
  if (e.excluded) return "excluded";
  if (!e.reading) return "unread";
  return e.confirmed ? "confirmed" : "read";
}

/** 写真の一覧と、その読み取り・人の直し・確かめ。取り込みの読み直し（IntakeSession を作り直す）をまたいで 1 つを使う。 */
export class PhotoBook {
  private readonly items = new Map<string, PhotoEntry>();

  /** 並べる。同じ名前があれば断る。中身が拡張子の形と合わなければ断る（読めないものは理由つきで返す） */
  async list(input: PhotoInput): Promise<RejectedFile | null> {
    if (this.items.has(input.name)) return { file: input.name, reason: "同じ名前の資料がもう入っている" };
    if (!sniffPhoto(input.bytes, input.mimeType)) return { file: input.name, reason: `画像の中身が拡張子の形（${input.mimeType}）と合わないので、読まなかった` };
    this.items.set(input.name, { input, sha256: await sha256Hex(input.bytes), reading: null, confirmed: null, excluded: null });
    return null;
  }

  entries(): PhotoEntry[] {
    return [...this.items.values()];
  }

  get(name: string): PhotoEntry | undefined {
    return this.items.get(name);
  }

  /**
   * AI が読んだ格子を置く（位置は元の画像の画素に直したもの）。前の読み取りと入れ替える。
   * 人が直したか確かめた写真は変えない。位置が画像の外・同じ行と列が 2 つ・空のセルは、どれも置かずに断る（直さない）。
   */
  place(name: string, r: { width: number; height: number; cells: Omit<PhotoCellRead, "aiText" | "author">[] }, at: string, conversation: string | null): PlaceOutcome {
    const e = this.items.get(name);
    if (!e || e.excluded) return "unknown";
    if (e.confirmed || e.reading?.cells.some((c) => c.author === "human")) return "human_reviewed";
    if (!r.cells.length) return "empty";
    const seen = new Set<string>();
    for (const c of r.cells) {
      const k = `${c.row},${c.col}`;
      if (seen.has(k)) return "duplicate_cell";
      seen.add(k);
      if (c.text === "") return "empty";
      const b = c.box;
      // 画素の倍率を掛けたときの小数の誤差だけを許す（画像の外にはみ出したものは断る）
      const eps = 1e-6;
      if (!(b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= r.width + eps && b.y + b.h <= r.height + eps)) return "out_of_image";
    }
    e.reading = {
      width: r.width,
      height: r.height,
      cells: [...r.cells].sort((a, b) => a.row - b.row || a.col - b.col).map((c) => ({ ...c, aiText: c.text, author: "ai_reading" as const })),
      placedAt: at,
      conversation,
    };
    return "ok";
  }

  /** 人がセルの文字を直す（作者は人）。空にすると、そのセルは格子から外れる。確かめたあとは直せない（確かめを取り消してから） */
  correct(name: string, row: number, col: number, text: string): ReviewOutcome {
    const e = this.items.get(name);
    if (!e) return "unknown";
    if (!e.reading) return "no_reading";
    if (e.confirmed) return "confirmed";
    const c = e.reading.cells.find((x) => x.row === row && x.col === col);
    if (!c) return "no_cell";
    const t = text.trim();
    c.text = t;
    c.author = t === c.aiText ? "ai_reading" : "human";
    return "ok";
  }

  /** 人が読み取りを捨てる（AI がまた置ける） */
  discard(name: string): ReviewOutcome {
    const e = this.items.get(name);
    if (!e) return "unknown";
    if (!e.reading) return "no_reading";
    e.reading = null;
    e.confirmed = null;
    return "ok";
  }

  /** 人が画像と並べて確かめる（一言の理由が要る）。これで、この写真から作った記録は要確認でなくなる */
  confirm(name: string, reason: string, at: string): ReviewOutcome {
    const e = this.items.get(name);
    if (!e) return "unknown";
    if (!e.reading) return "no_reading";
    if (e.confirmed) return "confirmed";
    const why = reason.trim();
    if (!why) return "reason_empty";
    e.confirmed = { at, reason: why };
    return "ok";
  }

  /** 人が確かめを取り消す（また要確認に戻る） */
  unconfirm(name: string): ReviewOutcome {
    const e = this.items.get(name);
    if (!e) return "unknown";
    if (!e.confirmed) return "no_reading";
    e.confirmed = null;
    return "ok";
  }

  /** 人が読まずに外す／戻す */
  exclude(name: string, at: string): ReviewOutcome {
    const e = this.items.get(name);
    if (!e) return "unknown";
    e.excluded = { at, reason: PHOTO_EXCLUDED_REASON };
    return "ok";
  }

  include(name: string): ReviewOutcome {
    const e = this.items.get(name);
    if (!e) return "unknown";
    e.excluded = null;
    return "ok";
  }

  /** 層 2〜4 へ渡す格子（読み取りのある、外していない写真） */
  sources(): SourceFile[] {
    return this.entries()
      .filter((e) => !e.excluded && e.reading)
      .map((e) => photoSource(e));
  }

  /** 読んでいない写真（並べただけで、読み取りも外す決めも無い）。これがあるうちは計画を作らない */
  unread(): PhotoEntry[] {
    return this.entries().filter((e) => !e.excluded && !e.reading);
  }

  /** 人が読まずに外した写真（「読まなかった資料」に理由つきで出す） */
  excludedFiles(): RejectedFile[] {
    return this.entries()
      .filter((e) => e.excluded)
      .map((e) => ({ file: e.input.name, reason: e.excluded?.reason ?? PHOTO_EXCLUDED_REASON }));
  }
}

/** 読み取りを、層 1 の出力と同じ形（セルの格子＋出どころ）にする。文字は見えたとおりの文字列（CSV と同じく型を推さない） */
export function photoSource(e: PhotoEntry): SourceFile {
  const r = e.reading;
  if (!r) throw new Error("読み取りの無い写真");
  const cells: GridCell[] = [];
  const boxes: PhotoMeta["boxes"] = {};
  const authors: PhotoMeta["authors"] = {};
  let maxRow = 0;
  let maxCol = 0;
  for (const c of r.cells) {
    if (c.text === "") continue;
    const rr = c.row + 1;
    const cc = c.col + 1;
    const ref = cellRef(rr, cc);
    cells.push({
      r: rr,
      c: cc,
      ref,
      value: c.text,
      text: c.text,
      type: "string",
      numFmt: "General",
      formula: null,
      formulaNoCache: false,
      error: null,
      bold: false,
      indent: 0,
      leadingSpaces: leadingSpaceWidth(c.text),
      note: null,
    });
    boxes[ref] = [c.box.x, c.box.y, c.box.w, c.box.h];
    authors[ref] = c.author;
    maxRow = Math.max(maxRow, rr);
    maxCol = Math.max(maxCol, cc);
  }
  const ledger: LedgerEntry[] = [];
  const human = r.cells.filter((c) => c.author === "human");
  const low = r.cells.filter((c) => c.text !== "" && c.author === "ai_reading" && c.confidence < PHOTO_LOW_CONFIDENCE);
  ledger.push({
    kind: "decided",
    what: "photoReading",
    count: cells.length,
    detail: e.confirmed
      ? `AI（読み取り）が画像から読んだ格子を、人が画像と並べて確かめた（理由：${e.confirmed.reason}）`
      : "AI（読み取り）が画像から読んだ格子。人が画像と並べて確かめるまで要確認で、計画は作らない",
    sheet: null,
  });
  if (human.length) ledger.push({ kind: "decided", what: "photoHumanCells", count: human.length, detail: "人が直したセル（空にしたものは格子から外した）", sheet: null });
  if (low.length) ledger.push({ kind: "warning", what: "photoLowConfidence", count: low.length, detail: `AI の確からしさが ${PHOTO_LOW_CONFIDENCE} より低いセル`, sheet: null });
  return {
    file: e.input.name,
    format: "photo",
    sheets: [{ name: null, index: 0, state: "visible", cells, merges: [], rows: {}, cols: {}, maxRow, maxCol }],
    ledger,
    date1904: false,
    photo: {
      confirmed: e.confirmed !== null,
      confirmedReason: e.confirmed?.reason ?? null,
      page: e.input.origin.kind === "pdf_page" ? e.input.origin.page : null,
      boxes,
      authors,
    },
  };
}

/** 弱い順（compose.ts の作者の順と同じ）。写真から作った明細は「AI（読み取り）」より強くしない */
const AUTHOR_RANK: AuthorKind[] = ["ai", "ai_reading", "ai_relayed_human", "human", "rule_code"];

export interface PhotoReview {
  /** 確かめていない写真から作った記録（機器の節・明細） */
  assets: number;
  details: number;
  /** 読み取りを置いたのに、人がまだ確かめていない写真（記録がまだできていなくても数える） */
  photos: number;
  /** 写真ごとの、その写真から作った記録の数（確かめたものも数える）と、確かめたか */
  byFile: Record<string, { assets: number; details: number; confirmed: boolean }>;
}

/**
 * 層 4 で、写真から作った記録に印を付ける（compose.ts が計画を作る前に呼ぶ）：
 * 出どころに画像の位置（と PDF の頁）を付け、確かめていない写真から作った明細を要確認にし、
 * 写真から作った明細の作者を「AI（読み取り）」より強くしない（人が直したセルだけから作ったものは除く）。
 * 確かめていない写真から作った記録の数と、確かめていない写真の数を返す（機器の節には要確認の欄が無いので、ここで数えて止める決まりに足す。
 * 写真の行がまだ未解決で記録ができていなくても、確かめていない写真があるうちは止める）。
 */
export function markPhotoRecords(sources: SourceFile[], assets: AssetNodeT[], details: WorkDetailT[]): PhotoReview {
  const meta = new Map<string, PhotoMeta>();
  for (const s of sources) if (s.photo) meta.set(s.file, s.photo);
  const review: PhotoReview = { assets: 0, details: 0, photos: 0, byFile: {} };
  if (!meta.size) return review;
  for (const [file, m] of meta) {
    review.byFile[file] = { assets: 0, details: 0, confirmed: m.confirmed };
    if (!m.confirmed) review.photos++;
  }
  const touch = (refs: SourceRef[]) => {
    const files = new Set<string>();
    let allHuman = true;
    for (const s of refs) {
      const m = meta.get(s.file);
      if (!m) continue;
      files.add(s.file);
      if (s.cell) {
        const b = m.boxes[s.cell];
        if (b) s.box = [b[0], b[1], b[2], b[3]];
        if (m.authors[s.cell] !== "human") allHuman = false;
      } else allHuman = false;
      if (m.page !== null) s.page = m.page;
    }
    return { files: [...files], unconfirmed: [...files].some((f) => !meta.get(f)?.confirmed), allHuman };
  };
  for (const a of assets) {
    const t = touch(a.sources);
    for (const f of t.files) review.byFile[f]!.assets++;
    if (t.unconfirmed) review.assets++;
  }
  for (const d of details) {
    const t = touch(d.sources);
    if (!t.files.length) continue;
    for (const f of t.files) review.byFile[f]!.details++;
    if (t.unconfirmed) {
      d.needsReview = true;
      review.details++;
    }
    if (!t.allHuman && AUTHOR_RANK.indexOf(d.author) > AUTHOR_RANK.indexOf("ai_reading")) d.author = "ai_reading";
    const how = t.files.map((f) => {
      const m = meta.get(f);
      return m?.confirmed ? `写真 ${f} は AI（読み取り）が読み、人が画像と並べて確かめた（${m.confirmedReason ?? ""}）` : `写真 ${f} は AI（読み取り）が読んだ（人が確かめるまで要確認）`;
    });
    d.basis = `${d.basis}。${how.join("。")}`;
  }
  return review;
}

/** バイト列の SHA-256（16 進）。ブラウザでも Node でも WebCrypto で取る */
async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
