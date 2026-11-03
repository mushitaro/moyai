// 層 1 の入口：形式ごとの読み手に振り分ける。受け付ける形式と読み手を一致させる（plan §2.3）。
import { readCsv, type CsvAmbiguity, type CsvReadOptions } from "./csv";
import type { RejectedFile, SourceFile } from "./grid";
import { readXlsx } from "./xlsx";

export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

export interface ReadOutcome {
  source: SourceFile | null;
  rejected: RejectedFile | null;
  /** CSV の文字コード・区切りが決まらないとき（質問にする） */
  ambiguity: CsvAmbiguity[];
}

/** 読み手のある拡張子（ここだけに置き、案内の文もここから作る） */
export const READABLE = { xlsx: "excel", xlsm: "excel", csv: "csv", tsv: "csv", txt: "csv" } as const;
const listed = Object.keys(READABLE).filter((e) => e !== "txt").map((e) => `.${e}`).join("・");
const RESAVE = `この形式は読めません。保存し直してください（今読める形式：${listed}）`;

export function extensionOf(name: string): string {
  return (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
}

export async function readSource(f: InputFile, csvOptions: CsvReadOptions = {}): Promise<ReadOutcome> {
  const ext = extensionOf(f.name);
  if (ext === "xls" || ext === "doc") return { source: null, rejected: { file: f.name, reason: RESAVE }, ambiguity: [] };
  const kind = (READABLE as Record<string, "excel" | "csv">)[ext];
  if (kind === "excel") {
    try {
      return { source: await readXlsx(f.name, f.bytes, ext === "xlsm" ? "xlsm" : "xlsx"), rejected: null, ambiguity: [] };
    } catch (e) {
      return { source: null, rejected: { file: f.name, reason: `読めませんでした：${e instanceof Error ? e.message : String(e)}` }, ambiguity: [] };
    }
  }
  if (kind === "csv") {
    const r = readCsv(f.name, f.bytes, csvOptions);
    return { source: r.source, rejected: null, ambiguity: r.ambiguity };
  }
  return { source: null, rejected: { file: f.name, reason: `.${ext || "（拡張子なし）"} はこの取り込みの読み手がありません（今読める形式：${listed}）` }, ambiguity: [] };
}
