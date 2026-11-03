// 画面の部品：ビルドの印と【架空】の印、画面の言葉の一覧、Ed25519 の検証の関数。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BridgeClient } from "../../src/app/bridge-client";
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

  it("架空の札", () => {
    expect(renderToStaticMarkup(<FictionMark />)).toContain("架空");
    expect(TEXT.fictionMark).toBe("架空");
  });

  it("タブの側も、読めない通信は飛ばして数え、受け手に件数を渡す", () => {
    const client = new BridgeClient("ws://unused");
    const seen: [string, number][] = [];
    client.subscribe((s, dropped) => seen.push([s.kind, dropped]));
    client.receive("not json");
    client.receive(new ArrayBuffer(3));
    client.receive(JSON.stringify({ type: "tab.hello", data: { secret: "A".repeat(43), build: "x" } })); // 向きが違う
    client.receive(JSON.stringify({ type: "bridge.welcome", data: { heartbeatMs: 1, deadMs: 3, tokenTtlMs: 120000 } }));
    expect(client.dropped).toBe(3);
    expect(seen.at(-1)).toEqual(["open", 3]);
    expect(TEXT.connection.dropped(3)).toContain("3 件");
  });

  it("試験のページの検証の関数が、正しい文を通し、変えた文を通さない", async () => {
    expect(await verifySample(makeEd25519Sample())).toEqual({ valid: true, tampered: false });
  });
});
