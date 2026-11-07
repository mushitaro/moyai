// ヘッダの「Claude と並べる」のボタン（docs/screens.md §1。仕事 window-arrange-v1）。
// - 出すのは、外のブラウザ・Windows・橋渡しに接続中のときだけ。中のブラウザ（User-Agent に Electron か Claude）・Windows 以外・未接続では出さない。押せない理由の字も置かない。
// - 押して Claude Desktop の窓が無ければ、ボタンの右に「Claude の窓なし」を 4 秒。並べたときは字を出さない。もう一度押せば並べ直す。
// 画面は react-dom/server で描く（試験は node で走る）。時計は vitest の偽の時計で進める。
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeClient, type ConnectionState } from "../../src/app/bridge-client";
import { ArrangeButton, ArrangeButtonView, ArrangeControl, NO_CLAUDE_NOTICE_MS, isInnerBrowser, isWindowsBrowser, showArrangeButton, type BrowserInfo } from "../../src/app/components/ArrangeButton";
import { TEXT } from "../../src/app/text";
import type { WindowArrangeResult } from "../../src/shared/window-arrange";

// 見分けの試験に使う User-Agent の形（版の数は架空。実機の Claude Desktop の User-Agent は未確認）
const CHROME_WIN: BrowserInfo = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" };
const EDGE_WIN: BrowserInfo = { userAgent: `${CHROME_WIN.userAgent} Edg/140.0.0.0`, userAgentData: { platform: "Windows" } };
const ELECTRON_WIN: BrowserInfo = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36" };
const CLAUDE_WIN: BrowserInfo = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.0.0 Chrome/140.0.0.0 Safari/537.36" };
const CHROME_MAC: BrowserInfo = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", userAgentData: { platform: "macOS" } };
const CHROME_LINUX: BrowserInfo = { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" };

const OPEN: ConnectionState = { kind: "open", tokenTtlMs: 120_000 };
const NOT_OPEN: ConnectionState[] = [{ kind: "connecting" }, { kind: "reconnecting" }, { kind: "closed" }, { kind: "refused", code: "tab_already_open" }];

/** 橋渡しの握手を受けた（つながった）タブの側。WebSocket はつながない */
function openClient(): BridgeClient {
  const c = new BridgeClient("ws://unused");
  c.receive(JSON.stringify({ type: "bridge.welcome", data: { heartbeatMs: 15000, deadMs: 45000, tokenTtlMs: 120000 } }));
  return c;
}

describe("ボタンを出す条件", () => {
  it("外のブラウザ・Windows・接続中だけ出す", () => {
    expect(showArrangeButton(CHROME_WIN, OPEN)).toBe(true);
    expect(showArrangeButton(EDGE_WIN, OPEN)).toBe(true);
  });

  it("中のブラウザ（User-Agent に Electron か Claude）では出さない", () => {
    expect(isInnerBrowser(ELECTRON_WIN)).toBe(true);
    expect(isInnerBrowser(CLAUDE_WIN)).toBe(true);
    expect(isInnerBrowser(CHROME_WIN)).toBe(false);
    expect(showArrangeButton(ELECTRON_WIN, OPEN)).toBe(false);
    expect(showArrangeButton(CLAUDE_WIN, OPEN)).toBe(false);
  });

  it("Windows 以外では出さない", () => {
    expect(isWindowsBrowser(CHROME_MAC)).toBe(false);
    expect(isWindowsBrowser(CHROME_LINUX)).toBe(false);
    expect(isWindowsBrowser({ userAgent: "", userAgentData: { platform: "Windows" } })).toBe(true);
    expect(showArrangeButton(CHROME_MAC, OPEN)).toBe(false);
    expect(showArrangeButton(CHROME_LINUX, OPEN)).toBe(false);
  });

  it("橋渡しに未接続（つなぐ途中・つなぎ直し・切れた・断られた）では出さない", () => {
    for (const s of NOT_OPEN) expect(showArrangeButton(CHROME_WIN, s), s.kind).toBe(false);
  });

  it("ヘッダの部品：条件に合うときだけボタンを描き、合わなければ何も描かない（押せない理由の字も無い）", () => {
    const open = openClient();
    const html = renderToStaticMarkup(<ArrangeButton client={open} browser={CHROME_WIN} />);
    expect(html).toContain('data-testid="window-arrange"');
    expect(html).toContain(TEXT.shell.arrange);
    expect(html).toContain("moyai-switch-item"); // 「暗 / 明」と同じ字と大きさ
    expect(html).not.toContain(TEXT.shell.arrangeNoClaude);
    for (const browser of [ELECTRON_WIN, CLAUDE_WIN, CHROME_MAC, CHROME_LINUX]) expect(renderToStaticMarkup(<ArrangeButton client={open} browser={browser} />), browser.userAgent).toBe("");
    // つながる前
    expect(renderToStaticMarkup(<ArrangeButton client={new BridgeClient("ws://unused")} browser={CHROME_WIN} />)).toBe("");
  });

  it("ヘッダの並び：Claude と並べる・暗 / 明・設定", () => {
    const src = readFileSync("src/app/components/Shell.tsx", "utf8");
    const a = src.indexOf("<ArrangeButton client={client} />");
    const b = src.indexOf("<ThemeSwitch />", a);
    const c = src.indexOf("{S.settings}", b);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe("押したとき", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 答えを順に返す橋渡しのふり */
  function control(answers: WindowArrangeResult[]) {
    let calls = 0;
    const ctl = new ArrangeControl(async () => answers[Math.min(calls++, answers.length - 1)]!);
    return { ctl, calls: () => calls };
  }

  it("Claude の窓が無ければ「Claude の窓なし」を 4 秒出して消す", async () => {
    vi.useFakeTimers();
    const { ctl } = control([{ ok: false, reason: "no_claude_window" }]);
    expect(await ctl.press()).toEqual({ ok: false, reason: "no_claude_window" });
    expect(ctl.snapshot()).toEqual({ busy: false, noClaude: true });
    const html = renderToStaticMarkup(<ArrangeButtonView view={ctl.snapshot()} onPress={() => {}} />);
    expect(html).toContain(TEXT.shell.arrangeNoClaude);
    expect(html).toContain('class="moyai-arrange-note"');
    vi.advanceTimersByTime(NO_CLAUDE_NOTICE_MS - 1);
    expect(ctl.snapshot().noClaude).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ctl.snapshot().noClaude).toBe(false);
    expect(renderToStaticMarkup(<ArrangeButtonView view={ctl.snapshot()} onPress={() => {}} />)).not.toContain(TEXT.shell.arrangeNoClaude);
    expect(NO_CLAUDE_NOTICE_MS).toBe(4000);
  });

  it("並べたとき・失敗・Windows 以外の答えでは字を出さない", async () => {
    for (const r of [{ ok: true }, { ok: false, reason: "failed" }, { ok: false, reason: "not_windows" }] as WindowArrangeResult[]) {
      const { ctl } = control([r]);
      await ctl.press();
      expect(ctl.snapshot(), JSON.stringify(r)).toEqual({ busy: false, noClaude: false });
    }
    // 届かない（投げた）ときも、並べたことにせず字も出さない
    const ctl = new ArrangeControl(() => Promise.reject(new Error("x")));
    expect(await ctl.press()).toEqual({ ok: false, reason: "failed" });
    expect(ctl.snapshot()).toEqual({ busy: false, noClaude: false });
  });

  it("もう一度押せば並べ直す。字を出している間に押すと字は消え、窓が無ければまた 4 秒", async () => {
    vi.useFakeTimers();
    const { ctl, calls } = control([{ ok: false, reason: "no_claude_window" }, { ok: false, reason: "no_claude_window" }, { ok: true }, { ok: true }]);
    await ctl.press();
    vi.advanceTimersByTime(3000);
    const p = ctl.press();
    expect(ctl.snapshot()).toEqual({ busy: true, noClaude: false });
    await p;
    // 2 回目の 4 秒は 2 回目に押したときから数える
    vi.advanceTimersByTime(3000);
    expect(ctl.snapshot().noClaude).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(ctl.snapshot().noClaude).toBe(false);
    await ctl.press();
    await ctl.press();
    expect(calls()).toBe(4);
    expect(ctl.snapshot()).toEqual({ busy: false, noClaude: false });
  });

  it("答えを待っている間に押しても、もう一度は頼まない", async () => {
    let release: (r: WindowArrangeResult) => void = () => {};
    let calls = 0;
    const ctl = new ArrangeControl(() => {
      calls++;
      return new Promise((r) => (release = r));
    });
    const a = ctl.press();
    expect(await ctl.press()).toBeNull();
    release({ ok: true });
    expect(await a).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  it("画面から外れたら時計を止める", async () => {
    vi.useFakeTimers();
    const { ctl } = control([{ ok: false, reason: "no_claude_window" }]);
    await ctl.press();
    ctl.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
