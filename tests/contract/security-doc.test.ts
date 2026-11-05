// docs/security.md が、ツール定義と経路の許可の一覧から作ったものと同じか（docs/plan.md §5.2 の 6）。
// 作り直すとき：MOYAI_WRITE_DOCS=1 npx vitest run tests/contract/security-doc.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { MAX_FILE_BYTES } from "../../src/app/intake/workspace";
import { BRIDGE_TOOL_RECEIVERS, OUTBOUND_MAX } from "../../src/bridge/tools";
import { TOKEN_TTL_MS } from "../../src/bridge/tokens";
import { securityMarkdown } from "../../src/shared/security";

const PATH = "docs/security.md";

test("docs/security.md はツール定義から作ったものと同じ", () => {
  const text = securityMarkdown({ receivers: BRIDGE_TOOL_RECEIVERS, tokenTtlMs: TOKEN_TTL_MS, maxFileBytes: MAX_FILE_BYTES, outboundMax: OUTBOUND_MAX });
  if (process.env.MOYAI_WRITE_DOCS === "1") writeFileSync(PATH, text);
  expect(readFileSync(PATH, "utf8").replace(/\r\n/g, "\n")).toBe(text);
});
