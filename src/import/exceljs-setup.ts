// exceljs 4.4.0（版を固定）の中に当てる小さな直し。当て試し（日誌 2026-11-03）で見つけた 3 つ：
// (a) 表示形式の文字から「\」が消える → 文字のまま受ける
// (b) 日付を Date で返す（ミリ秒の丸めと時差の罠）→ 通し番号の数のまま受ける
// (c) ja-JP の組み込みの番号（14, 22, 27-36, 50-58）が失われる → 番号の表に足す
// exceljs の版が変わったら、試験（tests/unit/import/layer1.test.ts）が落ちる。
import ExcelJS from "exceljs";
import utils from "exceljs/lib/utils/utils.js";
import NumFmtXform from "exceljs/lib/xlsx/xform/style/numfmt-xform.js";
import defaults from "exceljs/lib/xlsx/defaultnumformats.js";
import { JA_BUILTIN } from "./numfmt";

let applied = false;

export function patchedExcelJS(): typeof ExcelJS {
  if (applied) return ExcelJS;
  NumFmtXform.prototype.parseOpen = function parseOpen(this: { model?: unknown }, node) {
    if (node.name === "numFmt") {
      this.model = { id: parseInt(node.attributes.numFmtId ?? "0", 10), formatCode: node.attributes.formatCode };
      return true;
    }
    return false;
  };
  utils.isDateFmt = () => false;
  for (const [id, f] of Object.entries(JA_BUILTIN)) defaults[id] = { f };
  applied = true;
  return ExcelJS;
}

/** 直しが効いているか（試験で使う） */
export function patchesInEffect(): { rawNumFmt: boolean; noDates: boolean; jaBuiltins: boolean } {
  patchedExcelJS();
  const probe: { model?: { formatCode?: string } } = {};
  NumFmtXform.prototype.parseOpen.call(probe, { name: "numFmt", attributes: { numFmtId: "200", formatCode: "0.0\\m" } });
  return {
    rawNumFmt: probe.model?.formatCode === "0.0\\m",
    noDates: utils.isDateFmt("yyyy/m/d") === false,
    jaBuiltins: defaults["14"]?.f === "yyyy/m/d" && defaults["28"]?.f === JA_BUILTIN[28],
  };
}
