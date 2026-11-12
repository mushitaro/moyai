// 橋渡しのビルドと画面のビルドが違うときは、状態の帯のビルドの印を朱にするだけ（mushitaro/moyai#43。説明の文は置かない）。
// 橋渡しは bridge.welcome に自分のビルドの commit を添える。前の版の橋渡し（添えない）とは、今の色のまま。
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../../src/app/bridge-client";
import { BuildStamp, buildsDiffer, nextReady } from "../../src/app/components/BuildStamp";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("入っている MOYAI の次の版が用意できたら（#65）、朱にするだけ。今と同じ版なら言わない", () => {
    expect(nextReady("abc1234", "def5678def5678def5678def5678def5678def5")).toBe(true);
    expect(nextReady("abc1234", "abc1234abc1234abc1234abc1234abc1234abc1")).toBe(false);
    expect(nextReady("abc1234", undefined)).toBe(false);
    const next = renderToStaticMarkup(<BuildStamp bridgeBuild="test" bridgeNext={"d".repeat(40)} />);
    expect(next).toContain('data-differ="true"');
    const text = (h: string) => h.replace(/<[^>]+>/g, "");
    expect(text(next)).toBe(text(renderToStaticMarkup(<BuildStamp />)));
  });

  it("橋渡しは、用意できた次の版をつながったタブに bridge.next で知らせ、画面はつながりの状態に持つ。開発の clone なら moyai_update は dev_clone", async () => {
    const c1 = "1".repeat(40);
    const c2 = "2".repeat(40);
    const root = join(tmpdir(), `moyai-next-${process.pid}-${Date.now()}`);
    for (const c of [c1, c2]) {
      mkdirSync(join(root, "versions", c, "dist"), { recursive: true });
      writeFileSync(join(root, "versions", c, "dist", "cli.js"), "");
      writeFileSync(join(root, "versions", c, ".moyai-ready.json"), JSON.stringify({ commit: c }));
    }
    writeFileSync(join(root, "current.json"), JSON.stringify({ current: c1, previous: null, next: c2 }));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const tb = await startTestBridge({ build: "abc1234", appUpdate: { root, running: c1 } });
    cleanups.push(() => tb.close());
    const tab = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
    await tab.opened;
    cleanups.push(() => tab.ws.close());
    tab.send("tab.hello", { secret: SECRET_A, build: "test" });
    const welcome = await tab.next("bridge.welcome");
    const n = (await tab.next("bridge.next")) as { next: string };
    expect(n.next).toBe(c2);
    const c = new BridgeClient("ws://unused");
    c.receive(JSON.stringify({ type: "bridge.welcome", data: welcome }));
    c.receive(JSON.stringify({ type: "bridge.next", data: n }));
    expect(c.connection).toMatchObject({ kind: "open", next: c2 });
    const dev = await startTestBridge({ build: "abc1234" });
    cleanups.push(() => dev.close());
    expect(await dev.bridge.tools.run("moyai_update", { action: "prepare" }, "c")).toMatchObject({ ok: true, data: { action: "prepare", state: "dev_clone" } });
  });
});
