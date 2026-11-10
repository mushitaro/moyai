// EXPORT の押せない理由（docs/screens.md 3.5・§4 の 5）：押せないボタンには、いつも「理由：」の 1 行。
// 順は、ブリッジ → 計画 → 版の読込（読込中・読めない）→ 確定版 → 署名と鎖。
import { describe, expect, it } from "vitest";
import { exportBlockOf, withReasonHead } from "../../src/app/state/export-reason";
import { TEXT } from "../../src/app/text";

const ok = { connected: true, hasPlan: true, load: { kind: "ready" as const }, hasLatest: true, broken: false };

describe("EXPORT の押せない理由", () => {
  it("押せるときは理由なし", () => {
    expect(exportBlockOf(ok)).toBeNull();
  });

  it("前の段の理由を先にする", () => {
    expect(exportBlockOf({ ...ok, connected: false, hasPlan: false })).toEqual({ kind: "notConnected" });
    expect(exportBlockOf({ ...ok, hasPlan: false, load: { kind: "loading" } })).toEqual({ kind: "noPlan" });
    expect(exportBlockOf({ ...ok, load: { kind: "loading" }, hasLatest: false })).toEqual({ kind: "loading" });
    expect(exportBlockOf({ ...ok, load: { kind: "error", message: "保存先が未確定です。" }, hasLatest: false })).toEqual({ kind: "loadError", message: "保存先が未確定です。" });
    expect(exportBlockOf({ ...ok, hasLatest: false, broken: true })).toEqual({ kind: "notConfirmed" });
    expect(exportBlockOf({ ...ok, broken: true })).toEqual({ kind: "broken" });
  });

  it("理由の字は「理由：」で始まり、重ねない", () => {
    expect(withReasonHead("保存先が未確定です。")).toBe("理由：保存先が未確定です。");
    expect(withReasonHead("理由：ブリッジ未接続")).toBe("理由：ブリッジ未接続");
    const T = TEXT.export;
    for (const s of [T.notConnected, T.noPlanReason, T.loading, T.notConfirmed]) expect(s.startsWith("理由：")).toBe(true);
  });

  it("出力のあとの 1 行（下の帯の左）は、状態とファイル名だけ", () => {
    expect(TEXT.export.saved("A_第1版_星取表.xlsx")).toBe("✓ 出力　A_第1版_星取表.xlsx");
  });

  it("押せない理由は 1 つだけ（副のボタンは無いので、2 つめの理由の置き場も無い）。列対応の未定と差戻しも「理由：」で始まる", () => {
    const T = TEXT.export.template;
    for (const s of [T.undecidedReason(1), T.undecidedReason(null), withReasonHead(T.returned)]) expect(s.startsWith("理由：")).toBe(true);
    expect((TEXT.export as Record<string, unknown>).report).toBeUndefined();
  });
});
