// exceljs が書いた xlsx を、Excel が読めるように直す。
// exceljs 4.4.0 は、シートの設定（sheetPr）の子を pageSetUpPr → outlinePr の順に書く。表計算の決まり（ECMA-376 の CT_SheetPr）の順は
// tabColor → outlinePr → pageSetUpPr。印刷を 1 頁の幅に合わせ（fitToPage）、アウトラインの親を上に置く（summaryBelow="0"）と両方が出て、
// Excel は「一部の内容に問題が見つかりました」と言ってシートを空で開く（exceljs で読み直すと気づかない。2026-11-04 のデモの通しで見つけた）。
import JSZip from "jszip";

const ORDER = ["tabColor", "outlinePr", "pageSetUpPr"] as const;
const CHILD = /<(tabColor|outlinePr|pageSetUpPr)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g;

/** sheetPr の子を決まりの順に並べ直す（ほかの所は 1 文字も変えない） */
export function orderSheetPr(xml: string): string {
  return xml.replace(/<sheetPr(\s[^>]*)?>([\s\S]*?)<\/sheetPr>/, (whole, attrs: string | undefined, inner: string) => {
    const kids = [...inner.matchAll(CHILD)].map((m) => ({ name: m[1] as (typeof ORDER)[number], text: m[0] }));
    // 知らない子があれば触らない（並べ替えで落とさない）
    if (kids.map((k) => k.text).join("") !== inner) return whole;
    const sorted = [...kids].sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
    return `<sheetPr${attrs ?? ""}>${sorted.map((k) => k.text).join("")}</sheetPr>`;
  });
}

/** xlsx のバイト列の、どのシートの sheetPr も決まりの順にする */
export async function fixWorkbook(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  for (const name of Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
    const xml = await zip.file(name)!.async("string");
    const fixed = orderSheetPr(xml);
    if (fixed !== xml) zip.file(name, fixed);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
