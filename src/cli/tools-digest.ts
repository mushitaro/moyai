// ツールの定義の指紋（mushitaro/moyai#43）：AI クライアントが起動のときに受けて持ち続けるもの（名前・題・説明・入出力の形・MCP の instructions）。
// 中継（moyai mcp）は起きたときに、この指紋を状態フォルダに書く。moyai update は、新しいビルドの指紋とこれを比べ、
// 違うか分からないときだけ「Claude Desktop を開き直す」が要ると言う。中継がいくつも動いているときは、最後に起きたものの指紋。
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { MCP_INSTRUCTIONS } from "../shared/instructions";
import { EXPOSED_TOOL_NAMES, toolDef } from "../shared/tools";

export const RELAY_DIGEST_FILE = "relay-tools.digest";

export function toolsDigest(): string {
  const tools = EXPOSED_TOOL_NAMES.map((name) => {
    const d = toolDef(name);
    return { name, title: d.title, description: d.description, input: z.toJSONSchema(d.input), output: z.toJSONSchema(d.output) };
  });
  return createHash("sha256").update(JSON.stringify({ instructions: MCP_INSTRUCTIONS, tools })).digest("hex");
}

/** 中継が起きたときに書く。書けなくても中継は止めない（update が「分からない」と言うだけ） */
export function writeRelayDigest(stateDir: string, digest: string = toolsDigest()): void {
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(stateDir, RELAY_DIGEST_FILE), `${digest}\n`);
  } catch {
    /* 書けなかった */
  }
}

/** 中継が書いた指紋。無いか形が違えば null */
export function readRelayDigest(stateDir: string): string | null {
  try {
    const v = readFileSync(join(stateDir, RELAY_DIGEST_FILE), "utf8").trim();
    return /^[0-9a-f]{64}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
