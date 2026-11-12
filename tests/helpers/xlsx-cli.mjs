// Playwright の試験から Excel を作る・読むための小さな道具（exceljs を Playwright の読み込みの外で動かす。
// exceljs を試験の中で import すると、Playwright のモジュールの読み込みが壊れるため）。
//   node tests/helpers/xlsx-cli.mjs write <道> <JSON：{ sheet, cells: { "A1": 値, ... }, merges?: ["A4:A6", ...] }>（値が "=" で始まれば式）
//   node tests/helpers/xlsx-cli.mjs read <道>   → 最初のシートの値を JSON（行の配列。1 行目が先頭）で標準出力へ
//   node tests/helpers/xlsx-cli.mjs book <道>   ← 標準入力に JSON：{ sheets: [{ name, rows: [[値, ...], ...] }] }（シートを並べた本。行が多いので引数で渡さない）
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";

const [cmd, path, arg] = process.argv.slice(2);
if (cmd === "book") {
  const spec = JSON.parse(readFileSync(0, "utf8"));
  const wb = new ExcelJS.Workbook();
  for (const sh of spec.sheets) {
    const ws = wb.addWorksheet(sh.name);
    for (const r of sh.rows) ws.addRow(r);
  }
  await wb.xlsx.writeFile(path);
} else if (cmd === "write") {
  const spec = JSON.parse(arg);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(spec.sheet ?? "Sheet1");
  for (const [ref, v] of Object.entries(spec.cells)) ws.getCell(ref).value = typeof v === "string" && v.startsWith("=") ? { formula: v.slice(1) } : v;
  for (const m of spec.merges ?? []) ws.mergeCells(m);
  await wb.xlsx.writeFile(path);
} else if (cmd === "read") {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const rows = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = ws.getCell(r, c).value;
      row.push(v === null || v === undefined ? null : typeof v === "object" ? String(v.text ?? v.result ?? "") : v);
    }
    rows.push(row);
  }
  process.stdout.write(JSON.stringify(rows));
} else {
  process.stderr.write("使い方：write <道> <JSON> | read <道> | book <道>（標準入力に JSON）\n");
  process.exit(2);
}
