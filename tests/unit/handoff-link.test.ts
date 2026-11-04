// 渡すメールのリンクは、受け取る人の MOYAI の既定のポートで開く（送る人の --port を載せない。Wire、2026-11-04）
import { describe, expect, it } from "vitest";
import { HANDOFF_ORIGIN } from "../../src/bridge/human";
import { DEFAULT_PORT } from "../../src/bridge/server";

describe("渡すリンクの行き先", () => {
  it("moyai start の既定のポートと同じ", () => {
    expect(HANDOFF_ORIGIN).toBe(`http://127.0.0.1:${DEFAULT_PORT}`);
  });
});
