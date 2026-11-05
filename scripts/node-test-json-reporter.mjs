// node:test の報告を JSON にする（scripts/run-tests.mjs が MOYAI_REPORT_DIR のときに使う。docs/acceptance.md の元）。
// 組み込みの junit の報告にはファイルの名前が無いので、試験ごとにファイル・名前・結果を書く。
// 形：{ "tests": [{ "file": <道>, "name": <名前>, "nesting": <深さ>, "status": "passed" | "failed" | "skipped" | "todo" }] }
// 入れ子の試験の外側（suite）は数えない。
export default async function* jsonReporter(source) {
  const tests = [];
  for await (const ev of source) {
    if (ev.type !== "test:pass" && ev.type !== "test:fail") continue;
    const d = ev.data;
    if (d.details?.type === "suite") continue;
    const status = ev.type === "test:fail" ? "failed" : d.skip !== undefined && d.skip !== false ? "skipped" : d.todo !== undefined && d.todo !== false ? "todo" : "passed";
    tests.push({ file: d.file ?? null, name: d.name, nesting: d.nesting, status });
  }
  yield `${JSON.stringify({ tests })}\n`;
}
