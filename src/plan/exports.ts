// 様式で書き出した Excel への署名（運営者の決定 3C、Wire の「EXPORT で、署名して書き出す」、Architect の縛り 7 点。docs/screens.md 3.5）。
// 確定した版の中身は変えず、書き出した Excel のバイト列に、人が自分の鍵で署名して、版の signatures/ に足す（承認・差し戻しと同じく、あとから足す署名）。
// 署名する文は { schema, planId, version, contentHash, by, key, at, template: { name, file, columns, version }, excel } の JCS。
// - template.file は様式のファイルの SHA-256、columns は写し方（列の役目）の JCS の SHA-256、version は両方から作った版（templates.ts）。
// - excel は書き出した Excel の SHA-256。Excel は plans/<計画ID>/exports/<版>-<excel の頭 16>.xlsx に置き、落とすときに照らす。
// 書き出しの署名は版を作る署名ではないので、鎖・承認・頼み・編集の番・読み方の承認のどれにも数えない（版の署名と別の形・別のファイル名にして、混ざらないようにする）。
// 数えるのは様式の写し方の承認だけ（信じる鍵のものだけ。bridge/templates.ts）。
import { canonicalize } from "../share/jcs";
import { HEX64, HEX128, keyIdOf, sha256Hex, signBody, verifyBody, type KeyPair } from "../share/sign";
import { validName } from "./signature";

export const EXPORT_SCHEMA = "moyai.export/0";

export interface ExportTemplateRef {
  /** 様式の名前（保管先の 様式/<名前>/） */
  name: string;
  /** 様式のファイル（.xlsx）の SHA-256 */
  file: string;
  /** 写し方（列の役目）の JCS の SHA-256 */
  columns: string;
  /** 様式の版（file と columns から作る） */
  version: string;
}

export interface ExportStatement {
  schema: typeof EXPORT_SCHEMA;
  planId: string;
  version: number;
  /** 版の記録の中身のハッシュ */
  contentHash: string;
  by: string;
  key: string;
  at: string;
  template: ExportTemplateRef;
  /** 書き出した Excel の SHA-256 */
  excel: string;
}

export interface ExportFile {
  statement: ExportStatement;
  pub: string;
  sig: string;
}

/** 確かめた書き出しの署名 */
export interface ExportInfo {
  by: string;
  key: string;
  pub: string;
  at: string;
  template: ExportTemplateRef;
  excel: string;
  /** 署名のファイルの名前 */
  file: string;
}

export function signExport(s: Omit<ExportStatement, "schema" | "key">, pair: KeyPair): ExportFile {
  if (!validName(s.by)) throw new Error("呼び名の形でない");
  const statement: ExportStatement = { schema: EXPORT_SCHEMA, ...s, key: keyIdOf(pair.pub) };
  return { statement, pub: pair.pub, sig: signBody(statement, pair.privateKey) };
}

const isRef = (t: unknown): t is ExportTemplateRef => {
  if (!t || typeof t !== "object") return false;
  const r = t as Partial<ExportTemplateRef>;
  return (
    Object.keys(r).sort().join(",") === "columns,file,name,version" &&
    typeof r.name === "string" &&
    r.name.length > 0 &&
    r.name.length <= 80 &&
    [r.file, r.columns, r.version].every((h) => typeof h === "string" && HEX64.test(h))
  );
};

/** 書き出しの署名のファイルの形と、署名そのものを確かめる（鍵を信じるかは呼ぶ側） */
export function verifyExportFile(f: unknown): f is ExportFile {
  if (!f || typeof f !== "object") return false;
  const { statement: s, pub, sig } = f as Partial<ExportFile>;
  if (!s || typeof pub !== "string" || typeof sig !== "string" || !HEX64.test(pub) || !HEX128.test(sig)) return false;
  if (Object.keys(s).sort().join(",") !== "at,by,contentHash,excel,key,planId,schema,template,version") return false;
  if (s.schema !== EXPORT_SCHEMA || typeof s.by !== "string" || !validName(s.by) || typeof s.at !== "string" || typeof s.planId !== "string") return false;
  if (typeof s.contentHash !== "string" || !HEX64.test(s.contentHash) || !Number.isInteger(s.version) || typeof s.excel !== "string" || !HEX64.test(s.excel)) return false;
  if (!isRef(s.template) || s.key !== keyIdOf(pub)) return false;
  return verifyBody(s, sig, pub);
}

/** 書き出しの署名のファイルの名前：<版 6 桁>-export-<鍵ID>-<Excel の SHA-256 の頭 16>.json（同じ人が同じ版で何度でも書き出せる。Architect の縛り 1） */
export function exportSignatureName(version: number, keyId: string, excel: string): string {
  return `${String(version).padStart(6, "0")}-export-${keyId}-${excel.slice(0, 16)}.json`;
}
export const EXPORT_SIGNATURE_FILE = /^(\d{6})-export-([0-9a-f]{16})-([0-9a-f]{16})\.json$/;

/** 書き出した Excel の置き場所の名前：exports/<版 6 桁>-<Excel の頭 16>.xlsx（標準の書き出しの <版>-plan.xlsx とは別） */
export function exportExcelName(version: number, excel: string): string {
  return `${String(version).padStart(6, "0")}-${excel.slice(0, 16)}.xlsx`;
}

/** 写し方（列の役目）の中身のハッシュ */
export function columnsHash(columns: unknown): string {
  return sha256Hex(canonicalize(columns));
}

/**
 * 1 つの版の書き出しの署名を読み、確かめて合うものだけを返す（計画・版・中身のハッシュ・名前の鍵と Excel の頭が合うもの）。
 * 合わないファイルは数えて返す（版の確かめには使わない。書き出しの署名が壊れても、版は開ける）
 */
export function checkExports(files: readonly { name: string; text: string }[], planId: string, version: number, hash: string): { ok: ExportInfo[]; bad: number } {
  const ok: ExportInfo[] = [];
  let bad = 0;
  for (const { name, text } of files) {
    const m = EXPORT_SIGNATURE_FILE.exec(name);
    if (!m || Number(m[1]) !== version) continue;
    let f: unknown;
    try {
      f = JSON.parse(text);
    } catch {
      bad++;
      continue;
    }
    if (!verifyExportFile(f)) {
      bad++;
      continue;
    }
    const s = f.statement;
    if (s.planId !== planId || s.version !== version || s.contentHash !== hash || s.key !== m[2] || s.excel.slice(0, 16) !== m[3]) {
      bad++;
      continue;
    }
    ok.push({ by: s.by, key: s.key, pub: f.pub, at: s.at, template: s.template, excel: s.excel, file: name });
  }
  return { ok, bad };
}
