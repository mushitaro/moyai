// 画面の部品：ビルドの印と【架空】の印、画面の言葉の一覧、Ed25519 の検証の関数。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuildStamp } from "../../src/app/components/BuildStamp";
import { FictionMark } from "../../src/app/components/FictionMark";
import { verifySample } from "../../src/app/pages/SelfTest";
import { TEXT } from "../../src/app/text";
import { makeEd25519Sample } from "../../src/bridge/selftest";

describe("画面の部品", () => {
  it("ビルドの印は「MOYAI · build <日時> JST · <コミット>」", () => {
    const html = renderToStaticMarkup(<BuildStamp />);
    expect(html).toContain("MOYAI · build 2026-11-03 00:00 JST · test");
    expect(html).toContain("moyai-build-stamp");
  });

  it("【架空】の印", () => {
    expect(renderToStaticMarkup(<FictionMark />)).toContain("【架空】");
    expect(TEXT.fictionMark).toBe("【架空】");
  });

  it("試験のページの検証の関数が、正しい文を通し、変えた文を通さない", async () => {
    expect(await verifySample(makeEd25519Sample())).toEqual({ valid: true, tampered: false });
  });
});
