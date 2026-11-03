// 試験の道具（写真）：工場の写真と、その写真の「読み取り」を正解から作る。
// この試験では AI が画像を読まない。AI の読み取りの代わりに、試験が正解（samples/truth/<パック>/<施設>/photos.truth.json）から
// 格子を書く：写真の正解が指す報告書（reports.truth.json の同じ報告書の同じ頁）に印刷された文字を、印刷の行と列のとおりに並べる。
// 位置（box）は正解に無いので、この道具を書いた者が工場の画像（1,800 × 655 画素）を見て決めた、表の枠の概ねの位置（傾きを含む）を使う。
// ③ は文字と記録で測り、位置は測らない。src/ は正解を読まない。
import { readFileSync } from "node:fs";
import type { PhotoCellIn } from "../../src/shared/tools";

type J = Record<string, any>;

export const PHOTO_PACK = "waste-incineration";
export const PHOTO_FACILITY = "fictional-1";
/** 工場の写真（報告書の PDF の 1 頁を紙に刷って撮った形のもの） */
export const PHOTO_FILE = "photos/inspection-photo-f1-fy2025.jpg";
export const PHOTO_NAME = "inspection-photo-f1-fy2025.jpg";
export const PHOTO_DIR = `samples/out/${PHOTO_PACK}/${PHOTO_FACILITY}`;

export function photoBytes(file = PHOTO_FILE): Uint8Array {
  return new Uint8Array(readFileSync(`${PHOTO_DIR}/${file}`));
}

/** JPEG の大きさ（SOF の印から読む） */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1] ?? 0;
    const len = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: ((b[i + 5] ?? 0) << 8) | (b[i + 6] ?? 0), width: ((b[i + 7] ?? 0) << 8) | (b[i + 8] ?? 0) };
    }
    i += 2 + len;
  }
  return null;
}

function truthDir(): string {
  return `samples/truth/${PHOTO_PACK}/${PHOTO_FACILITY}`;
}

/** 写真の正解と、その写真が写す報告書の頁の正解 */
export function photoTruth(file = PHOTO_FILE): { photo: J; report: J; rows: J[]; world: J } {
  const photos = JSON.parse(readFileSync(`${truthDir()}/photos.truth.json`, "utf8"));
  const reports = JSON.parse(readFileSync(`${truthDir()}/reports.truth.json`, "utf8"));
  const world = JSON.parse(readFileSync(`${truthDir()}/world.json`, "utf8"));
  const photo = (photos.photos as J[]).find((p) => p.file === file);
  if (!photo) throw new Error(`写真の正解が無い：${file}`);
  const report = (reports.reports as J[]).find((r) => r.id === photo.source_report);
  if (!report) throw new Error(`報告書の正解が無い：${photo.source_report}`);
  const rows = (report.rows as J[]).filter((r) => r.page === photo.page);
  return { photo, report, rows, world };
}

/** 西暦の日付（YYYY-MM-DD）を、報告書の書き方（令和n年m月d日）にする。令和のうちだけ */
function wareki(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  if (y < 2019) throw new Error("令和より前の日付は書かない");
  return `令和${y - 2018}年${m}月${d}日`;
}

// 工場の画像の上の表の枠（1,800 × 655 画素の画像で、この道具を書いた者が見て決めた概ねの位置）
const BASE = { width: 1800, height: 655 };
const SLOPE = -0.064; // 右へ行くほど上がる傾き
const TABLE = { left: 150, top: 372, rowH: 27.5, edges: [150, 207, 812, 1073, 1395, 1477, 1660] };
const HEAD = { left: 140, top: 222, rowH: 29.5, edges: [140, 205, 640] };

function slanted(edges: number[], left: number, top: number, rowH: number, r: number, c: number) {
  const x0 = edges[c] as number;
  const x1 = edges[c + 1] as number;
  const yTop = top + r * rowH + SLOPE * (x1 - left);
  const yBottom = top + (r + 1) * rowH + SLOPE * (x0 - left);
  return { x: x0, y: yTop, w: x1 - x0, h: yBottom - yTop };
}

/**
 * 試験が AI の代わりに書く読み取り（正解から）。行と列は 0 から、位置は size（受け取った画像）の画素。
 * 頁の上の題・施設・件名・工期・施工者・頁と、表の見出しと明細の行を、印刷のとおりに並べる。確からしさは 1（正解の文字なので）。
 */
export function truthReading(size: { width: number; height: number } = BASE, file = PHOTO_FILE): { imageRef: string; cells: PhotoCellIn[] } {
  const { photo, report, rows, world } = photoTruth(file);
  const kx = size.width / BASE.width;
  const ky = size.height / BASE.height;
  const cells: PhotoCellIn[] = [];
  const put = (row: number, col: number, text: string, box: { x: number; y: number; w: number; h: number }) =>
    cells.push({ row, col, text, confidence: 1, box: { x: box.x * kx, y: box.y * ky, w: box.w * kx, h: box.h * ky } });
  const start = (rows[0]?.start as string) ?? "";
  const contractor = ((world.rules?.contractors ?? []) as J[]).filter((c) => c.from <= start).sort((a, b) => String(b.from).localeCompare(String(a.from)))[0]?.name;
  put(0, 0, report.title, { x: 140, y: 192, w: 340, h: 40 });
  const head: [string, string][] = [
    ["施設", world.facility.name],
    ["件名", report.subject],
    ["工期", report.term_text],
    ["施工者", contractor],
    ["頁", `${photo.page} / ${report.pages}`],
  ];
  head.forEach(([label, value], i) => {
    put(1 + i, 0, label, slanted(HEAD.edges, HEAD.left, HEAD.top, HEAD.rowH, i, 0));
    put(1 + i, 1, value, slanted(HEAD.edges, HEAD.left, HEAD.top, HEAD.rowH, i, 1));
  });
  ["No.", "機器", "作業内容", "工期", "日数", "工数"].forEach((h, c) => put(6, c, h, slanted(TABLE.edges, TABLE.left, TABLE.top, TABLE.rowH, 0, c)));
  rows.forEach((r, i) => {
    const texts = [String(r.no), r.equipment_text, r.label_text, `${wareki(r.start)}〜${wareki(r.end)}`, String(r.duration_days), r.effort_text];
    texts.forEach((t, c) => put(7 + i, c, t, slanted(TABLE.edges, TABLE.left, TABLE.top, TABLE.rowH, 1 + i, c)));
  });
  return { imageRef: (file.split("/").pop() as string) ?? file, cells };
}

/** 読み取りの格子で、報告書の明細の行（正解の no）が何行目か（0 から） */
export function truthRowOf(no: number, file = PHOTO_FILE): number {
  const { rows } = photoTruth(file);
  const i = rows.findIndex((r) => r.no === no);
  if (i < 0) throw new Error(`その行は写真に無い：${no}`);
  return 7 + i;
}
