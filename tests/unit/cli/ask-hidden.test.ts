// 合言葉を画面に出さずに読む（人だけの CLI の keys unwrap が、前の形の鍵を移すときに使う）。
// 問いの文字が端末に残ること（readline の描き直しで消えて、止まったように見えたことがある）、打った文字の代わりに「*」を出すこと、
// Backspace・日本語・貼り付け・Ctrl+C を、偽の端末で確かめる。
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { askHidden, type HiddenIO } from "../../../src/cli/human";

function fakeTerminal() {
  const written: string[] = [];
  const raw: boolean[] = [];
  const input = Object.assign(new EventEmitter(), {
    isRaw: false,
    setRawMode(on: boolean) {
      raw.push(on);
      input.isRaw = on;
    },
    setEncoding() {},
    resume() {},
    pause() {},
  });
  const io: HiddenIO = { input, output: { write: (s: string) => written.push(s) } };
  return { io, input, written, raw, type: (s: string) => input.emit("data", s) };
}

describe("askHidden", () => {
  it("問いを出し、打った文字の代わりに 1 文字ごとに「*」を出し、Enter で返す。端末を生のモードから戻す", async () => {
    const t = fakeTerminal();
    const p = askHidden("合言葉：", t.io);
    expect(t.written.join("")).toBe("合言葉：");
    t.type("架空の");
    t.type("合言葉\r");
    expect(await p).toBe("架空の合言葉");
    expect(t.written.join("")).toBe("合言葉：******\n");
    expect(t.raw).toEqual([true, false]);
    expect(t.input.listenerCount("data")).toBe(0);
  });

  it("Backspace で 1 文字消す（日本語も 1 文字）。矢印のエスケープの並びは捨てる", async () => {
    const t = fakeTerminal();
    const p = askHidden("？", t.io);
    t.type("あいう\u007f");
    t.type("\u001b[A");
    t.type("え\b\b");
    t.type("か\r");
    expect(await p).toBe("あか");
    expect(t.written.join("")).toBe("？***\b \b*\b \b\b \b*\n");
  });

  it("貼り付けで改行まで 1 度に来ても、最初の改行までを返す", async () => {
    const t = fakeTerminal();
    const p = askHidden("？", t.io);
    t.type("abcdefgh\r\n");
    expect(await p).toBe("abcdefgh");
  });

  it("Ctrl+C と、空のときの Ctrl+D は null（やめた）", async () => {
    const a = fakeTerminal();
    const pa = askHidden("？", a.io);
    a.type("途中\u0003");
    expect(await pa).toBeNull();
    expect(a.raw).toEqual([true, false]);
    const b = fakeTerminal();
    const pb = askHidden("？", b.io);
    b.type("\u0004");
    expect(await pb).toBeNull();
  });
});
