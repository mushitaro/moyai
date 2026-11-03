// 写真の机（このタブのメモリだけ）：人が許した写真を AI に渡す画像と、渡した記録を持ち、写真のツールの受け手になる。
// 許すのは人だけ：画面のボタン → 確かめのダイアログ → 人だけの経路 photo_allow（橋渡しが、タブの回と画像のハッシュに結んで覚える）。
// AI のツール（photo_transcribe）にできるのは、許された写真を 1 回受け取る（receive）ことと、受け取った写真に読んだ格子を置く（place）ことだけ。
// 確かめる・許すツールは無い。読み取り・人の直し・確かめは、取り込みの写真の一覧（import/photo.ts の PhotoBook）が持つ。
// 画像は、この画面の中（canvas）で長辺 1,568〜2,000 px にし、JPEG で約 100 KB 以下にする（切り抜かない）。
import type { PhotoBook, ReviewOutcome } from "../../import/photo";
import { PHOTO_SEND, type PhotoCellIn, type PhotoImage } from "../../shared/tools";
import { PHOTO_TEXT } from "../text";

/** AI に渡す画像（この画面が描き直した JPEG） */
export interface PreparedImage {
  /** base64（改行なし） */
  data: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  /** JPEG の品質（0〜1）。描き直さずに使ったもの（試験で、もう形の合う画像をそのまま使うとき）は null */
  quality: number | null;
  /** 元の画像の大きさ（画素） */
  source: { width: number; height: number };
  /** 目安の 100 KB に収まらなかった（運ぶ上限の内） */
  overTarget: boolean;
}

/** 渡す記録。none：許していない／allowed：人が許し、AI の受け取り待ち／sent：AI に渡した */
export type Transfer =
  | { kind: "none" }
  | { kind: "allowed"; at: string; image: PreparedImage }
  | { kind: "sent"; at: string; conversation: string; image: PreparedImage };

export type ReceiveResult = { ok: true; data: Record<string, unknown>; image: PhotoImage } | { ok: false; code: "photo_not_allowed" };
export type PlaceResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: "photo_not_received" | "photo_grid_invalid" | "photo_human_reviewed" };

/** 渡す大きさ：長辺を 1,568〜2,000 px に収める（縦横の比は変えない。小さい画像は 1,568 px まで広げる） */
export function sendSize(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height);
  const target = Math.min(PHOTO_SEND.longSideMax, Math.max(PHOTO_SEND.longSideMin, long));
  const k = target / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** 長辺を縮めた大きさ（1,568 px より下げない） */
function shrink(s: { width: number; height: number }): { width: number; height: number } | null {
  const long = Math.max(s.width, s.height);
  if (long <= PHOTO_SEND.longSideMin) return null;
  const target = Math.max(PHOTO_SEND.longSideMin, Math.floor(long * 0.9));
  const k = target / long;
  return { width: Math.max(1, Math.round(s.width * k)), height: Math.max(1, Math.round(s.height * k)) };
}

const Q_MAX = 0.92;
const Q_MIN = 0.3;

async function hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * 渡す画像を作る（ブラウザの中だけ）。長辺を 1,568〜2,000 px にし、品質を下げて約 100 KB 以下に収める。
 * 収まらなければ長辺を 1,568 px まで縮める。それでも収まらなければ、運ぶ上限の内なら目安を越えたことを添えて使う。
 * いつも描き直すので、元の画像の位置などの付け足しの情報（Exif）は渡らない。透明な所は白にする。
 */
export async function prepareForAi(bytes: Uint8Array, mimeType: string): Promise<PreparedImage | { error: "decode" } | { error: "tooLarge"; bytes: number }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }));
  } catch {
    return { error: "decode" };
  }
  try {
    const source = { width: bmp.width, height: bmp.height };
    let size: { width: number; height: number } | null = sendSize(source.width, source.height);
    let smallest: { blob: Blob; q: number; size: { width: number; height: number } } | null = null;
    while (size) {
      const canvas = new OffscreenCanvas(size.width, size.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return { error: "decode" };
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, size.width, size.height);
      const enc = (q: number) => canvas.convertToBlob({ type: PHOTO_SEND.mimeType, quality: q });
      // 品質を二分で探す：目安に収まるうちで、いちばん高い品質
      let best: { blob: Blob; q: number } | null = null;
      const top = await enc(Q_MAX);
      if (top.size <= PHOTO_SEND.targetBytes) best = { blob: top, q: Q_MAX };
      else {
        const bottom = await enc(Q_MIN);
        if (!smallest || bottom.size < smallest.blob.size) smallest = { blob: bottom, q: Q_MIN, size };
        if (bottom.size <= PHOTO_SEND.targetBytes) {
          best = { blob: bottom, q: Q_MIN };
          let lo = Q_MIN;
          let hi = Q_MAX;
          for (let i = 0; i < 6; i++) {
            const mid = Math.round(((lo + hi) / 2) * 100) / 100;
            const b = await enc(mid);
            if (b.size <= PHOTO_SEND.targetBytes) {
              best = { blob: b, q: mid };
              lo = mid;
            } else hi = mid;
          }
        }
      }
      if (best) return await done(best.blob, best.q, size, source, false);
      size = shrink(size);
    }
    if (smallest && smallest.blob.size <= PHOTO_SEND.maxBytes) return await done(smallest.blob, smallest.q, smallest.size, source, true);
    return { error: "tooLarge", bytes: smallest?.blob.size ?? 0 };
  } finally {
    bmp.close();
  }
}

async function done(blob: Blob, q: number, size: { width: number; height: number }, source: { width: number; height: number }, overTarget: boolean): Promise<PreparedImage> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { data: base64(bytes), width: size.width, height: size.height, bytes: bytes.length, sha256: await hex(bytes), quality: q, source, overTarget };
}

/**
 * 写真の机。取り込みの写真の一覧（PhotoBook）と並べて、渡す記録を写真の名前ごとに持つ。
 * changed は画面を描き直し、取り込みを読み直させる（読み取りが変わると層 2〜4 の結果が変わる）。
 */
export class PhotoDesk {
  private readonly transfers = new Map<string, Transfer>();

  constructor(
    private readonly book: () => PhotoBook,
    private readonly changed: (data: boolean) => void,
    private readonly note: (kind: "ai" | "info", text: string) => void,
  ) {}

  transfer(name: string): Transfer {
    return this.transfers.get(name) ?? { kind: "none" };
  }

  /** 人だけの経路（photo_allow）が通ったあとに、画面が呼ぶ */
  allowed(name: string, image: PreparedImage, at: string): void {
    this.transfers.set(name, { kind: "allowed", at, image });
    this.note("info", PHOTO_TEXT.ai.allowed(name));
    this.changed(false);
  }

  // ─── 人の操作（画面のボタンだけから呼ぶ。AI のツールの受け手からは呼ばない）───

  /** 人がセルの文字を直す（作者は人。空にするとそのセルを格子から外す） */
  correct(name: string, row: number, col: number, text: string): ReviewOutcome {
    return this.after(this.book().correct(name, row, col, text));
  }

  /** 人が画像と並べて確かめる（一言の理由が要る） */
  confirm(name: string, reason: string): ReviewOutcome {
    return this.after(this.book().confirm(name, reason, new Date().toISOString()));
  }

  unconfirm(name: string): ReviewOutcome {
    return this.after(this.book().unconfirm(name));
  }

  /** 人が読み取りを捨てる（AI はまた置ける。受け取った画像はそのまま） */
  discard(name: string): ReviewOutcome {
    return this.after(this.book().discard(name));
  }

  /** 人が読まずに外す。渡す記録も捨てる（許しが残っていても渡さない） */
  exclude(name: string): ReviewOutcome {
    this.transfers.delete(name);
    return this.after(this.book().exclude(name, new Date().toISOString()));
  }

  include(name: string): ReviewOutcome {
    return this.after(this.book().include(name));
  }

  private after(r: ReviewOutcome): ReviewOutcome {
    if (r === "ok") this.changed(true);
    return r;
  }

  /** AI に渡す要約の注記：許して受け取り待ちの写真 */
  surveyNotes(): string[] {
    const out: string[] = [];
    for (const [name, t] of this.transfers) if (t.kind === "allowed") out.push(`${name}：写真。人が AI クライアントに渡すことを許した。photo_transcribe（mode: receive）で受け取れる`);
    return out;
  }

  /** 人が許し、まだ AI に渡していない写真の数 */
  waiting(): number {
    let n = 0;
    for (const [name, t] of this.transfers) if (t.kind === "allowed" && this.book().get(name) && !this.book().get(name)?.excluded) n++;
    return n;
  }

  /** AI の receive：人が許した写真を 1 枚渡す（imageRef が無ければ、許した順でいちばん古いもの）。渡したら許しを使い終える */
  receive(imageRef: string | undefined, conversation: string): ReceiveResult {
    const allowed = [...this.transfers.entries()]
      .filter((x): x is [string, Extract<Transfer, { kind: "allowed" }>] => x[1].kind === "allowed")
      .filter(([name]) => {
        const e = this.book().get(name);
        return !!e && !e.excluded;
      })
      .sort((a, b) => a[1].at.localeCompare(b[1].at));
    const pick = imageRef === undefined ? allowed[0] : allowed.find(([name]) => name === imageRef);
    if (!pick) {
      this.note("ai", PHOTO_TEXT.ai.receiveRefused);
      return { ok: false, code: "photo_not_allowed" };
    }
    const [name, t] = pick;
    this.transfers.set(name, { kind: "sent", at: new Date().toISOString(), conversation, image: t.image });
    this.note("ai", PHOTO_TEXT.ai.received(name));
    this.changed(false);
    const img = t.image;
    return {
      ok: true,
      data: {
        mode: "receive",
        imageRef: name,
        placedCells: 0,
        needsReview: true,
        image: { width: img.width, height: img.height, bytes: img.bytes, mimeType: PHOTO_SEND.mimeType },
        waiting: this.waiting(),
        note: PHOTO_TEXT.tool.received(img.width, img.height),
      },
      image: { mimeType: PHOTO_SEND.mimeType, data: img.data },
    };
  }

  /**
   * AI の place：受け取った写真に、読んだ格子を置く。位置は受け取った画像の画素で確かめ（外にあれば断る）、
   * 元の画像の画素に直して写真の一覧に置く（切り抜いていないので、縦横それぞれ同じ倍率で戻る）。
   */
  place(grid: { imageRef: string; cells: PhotoCellIn[] }, conversation: string): PlaceResult {
    const name = grid.imageRef;
    const t = this.transfer(name);
    const e = this.book().get(name);
    const refuse = (code: "photo_not_received" | "photo_grid_invalid" | "photo_human_reviewed") => {
      this.note("ai", PHOTO_TEXT.ai.placeRefused(name));
      return { ok: false as const, code };
    };
    if (!e || e.excluded || t.kind !== "sent") return refuse("photo_not_received");
    if (e.confirmed || e.reading?.cells.some((c) => c.author === "human")) return refuse("photo_human_reviewed");
    const { width: W, height: H, source } = t.image;
    for (const c of grid.cells) if (c.box.x + c.box.w > W || c.box.y + c.box.h > H) return refuse("photo_grid_invalid");
    const kx = source.width / W;
    const ky = source.height / H;
    const cells = grid.cells.map((c) => {
      const x = Math.min(source.width, c.box.x * kx);
      const y = Math.min(source.height, c.box.y * ky);
      return {
        row: c.row,
        col: c.col,
        text: c.text,
        confidence: c.confidence,
        box: { x, y, w: Math.min(source.width - x, c.box.w * kx), h: Math.min(source.height - y, c.box.h * ky) },
      };
    });
    const r = this.book().place(name, { width: source.width, height: source.height, cells }, new Date().toISOString(), conversation);
    if (r === "human_reviewed") return refuse("photo_human_reviewed");
    if (r !== "ok") return refuse(r === "unknown" ? "photo_not_received" : "photo_grid_invalid");
    this.note("ai", PHOTO_TEXT.ai.placed(name, cells.length));
    this.changed(true);
    return {
      ok: true,
      data: { mode: "place", imageRef: name, placedCells: cells.length, needsReview: true, image: null, waiting: this.waiting(), note: PHOTO_TEXT.tool.placed(cells.length) },
    };
  }
}
