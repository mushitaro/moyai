// 橋渡しのビルドと画面のビルドが違うときは、状態の帯のビルドの印を朱にするだけ（mushitaro/moyai#43。説明の文は置かない）。
// 橋渡しは bridge.welcome に自分のビルドの commit を添える。前の版の橋渡し（添えない）とは、今の色のまま。
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../../src/app/bridge-client";
import { BuildStamp, buildsDiffer } from "../../src/app/components/BuildStamp";
import { FakeTab, SECRET_A, startTestBridge } from "../helpers/bridge";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

describe("ビルドの印（#43）", () => {
  it("違うと言うのは、両方の版が分かって違うときだけ", () => {
    expect(buildsDiffer("abc1234", "def5678")).toBe(true);
    expect(buildsDiffer("abc1234", "abc1234")).toBe(false);
    expect(buildsDiffer("abc1234", undefined)).toBe(false);
    expect(buildsDiffer("unknown", "def5678")).toBe(false);
    expect(buildsDiffer("abc1234", "unknown")).toBe(false);
  });

  it("違えば data-differ を付け（朱）、字は今と同じ。同じか分からなければ付けない", () => {
    const differ = renderToStaticMarkup(<BuildStamp bridgeBuild="def5678" />);
    const same = renderToStaticMarkup(<BuildStamp bridgeBuild="test" />);
    const none = renderToStaticMarkup(<BuildStamp />);
    expect(differ).toContain('data-differ="true"');
    expect(same).not.toContain("data-differ");
    expect(none).not.toContain("data-differ");
    const text = (h: string) => h.replace(/<[^>]+>/g, "");
    expect(text(differ)).toBe(text(none));
  });

  it("橋渡しは bridge.welcome に自分のビルドを添え、画面はつながりの状態に持つ", async () => {
    const tb = await startTestBridge({ build: "abc1234" });
    cleanups.push(() => tb.close());
    const tab = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
    await tab.opened;
    cleanups.push(() => tab.ws.close());
    tab.send("tab.hello", { secret: SECRET_A, build: "test" });
    const welcome = (await tab.next("bridge.welcome")) as { build?: string };
    expect(welcome.build).toBe("abc1234");
    const c = new BridgeClient("ws://unused");
    c.receive(JSON.stringify({ type: "bridge.welcome", data: welcome }));
    expect(c.connection).toMatchObject({ kind: "open", build: "abc1234" });
    // 前の版の橋渡し（build を添えない）
    const old = new BridgeClient("ws://unused");
    old.receive(JSON.stringify({ type: "bridge.welcome", data: { heartbeatMs: 1, deadMs: 2, tokenTtlMs: 3 } }));
    expect(old.connection).toEqual({ kind: "open", tokenTtlMs: 3 });
  });
});
