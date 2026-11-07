// ヘッダの「Claude と並べる」の橋渡しの側（docs/screens.md §1。仕事 window-arrange-v1）。
// - 台本の組み立て：Claude を左 40%（最小 560px）、MOYAI を右の残りに。作業領域の幅 1920・1280・1000 で計算を確かめる。
// - 答えの読み取り、PowerShell の引数（決まった字と、台本の base64 だけ）、Windows 以外は台本を走らせない。
// - 道の守り：今のタブの道と同じ（Origin・Sec-Fetch-Site・タブの秘密）。体は受けない。断った要求では台本を走らせない。拒む試験は消さない。
// PowerShell は走らせない（走らせる部品を差し替える）。
import { afterEach, describe, expect, it } from "vitest";
import {
  ARRANGE,
  WINDOW_ARRANGE_SCRIPT,
  arrangeRects,
  buildArrangeScript,
  createWindowArranger,
  powershellArgs,
  readArrangeOutput,
  type ScriptRunner,
} from "../../src/bridge/window-arrange";
import { HEADER_TAB_SECRET, ROUTES } from "../../src/shared/routes";
import { readWindowArrangeBody } from "../../src/shared/window-arrange";
import { FakeTab, SECRET_A, SECRET_B, http, startTestBridge, type TestBridge } from "../helpers/bridge";

const PATH = ROUTES.tabWindowArrange.path;

describe("台本の組み立て：Claude を左 40%（最小 560px）、MOYAI を右の残り", () => {
  const work = (w: number, h = 1040, left = 0, top = 0) => ({ left, top, right: left + w, bottom: top + h });

  it("幅 1920：Claude 768（40%）、MOYAI 1152", () => {
    expect(arrangeRects(work(1920))).toEqual({ claude: { x: 0, y: 0, w: 768, h: 1040 }, moyai: { x: 768, y: 0, w: 1152, h: 1040 } });
  });

  it("幅 1280：40% は 512 なので最小の 560、MOYAI 720", () => {
    expect(arrangeRects(work(1280))).toEqual({ claude: { x: 0, y: 0, w: 560, h: 1040 }, moyai: { x: 560, y: 0, w: 720, h: 1040 } });
  });

  it("幅 1000：40% は 400 なので最小の 560、MOYAI 440", () => {
    expect(arrangeRects(work(1000))).toEqual({ claude: { x: 0, y: 0, w: 560, h: 1040 }, moyai: { x: 560, y: 0, w: 440, h: 1040 } });
  });

  it("作業領域の左上から並べる（タスクバーが左・上にある、2 つ目の画面）", () => {
    expect(arrangeRects(work(1920, 1032, 1920, 48))).toEqual({ claude: { x: 1920, y: 48, w: 768, h: 1032 }, moyai: { x: 2688, y: 48, w: 1152, h: 1032 } });
  });

  it("画面の拡大（DPI 144 = 150%）では、最小の幅も 1.5 倍（840）", () => {
    expect(arrangeRects(work(1920), 144)?.claude.w).toBe(840);
    expect(arrangeRects(work(2880), 144)?.claude.w).toBe(1152);
  });

  it("作業領域が最小の幅より狭ければ並べない（台本は failed）", () => {
    expect(arrangeRects(work(560))).toBeNull();
    expect(arrangeRects(work(500))).toBeNull();
    expect(arrangeRects(work(1000, 0))).toBeNull();
  });

  it("台本は同じ式を持ち、数は定数から組み立てる", () => {
    expect(ARRANGE).toEqual({ share: 0.4, minWidth: 560 });
    expect(WINDOW_ARRANGE_SCRIPT).toBe(buildArrangeScript(ARRANGE));
    expect(WINDOW_ARRANGE_SCRIPT).toContain("int min = (int)System.Math.Ceiling(560 * dpi / 96.0);");
    expect(WINDOW_ARRANGE_SCRIPT).toContain("int cw = System.Math.Max(min, (int)System.Math.Floor(w * 0.4));");
    expect(WINDOW_ARRANGE_SCRIPT).toContain('if (cw >= w || h <= 0) return "failed";');
    const other = buildArrangeScript({ share: 0.35, minWidth: 600 });
    expect(other).toContain("System.Math.Ceiling(600 * dpi / 96.0)");
    expect(other).toContain("System.Math.Floor(w * 0.35)");
    expect(() => buildArrangeScript({ share: 1.2, minWidth: 560 })).toThrow();
    expect(() => buildArrangeScript({ share: 0.4, minWidth: 5.5 })).toThrow();
  });

  it("台本の中身：前面の窓、Claude Desktop の窓の見分け、作業領域、元に戻す、SetWindowPos", () => {
    const s = WINDOW_ARRANGE_SCRIPT;
    for (const w of [
      "GetForegroundWindow()",
      "Get-Process -Name 'claude'",
      String.raw`'\WindowsApps\Claude_'`,
      String.raw`'\AnthropicClaude\'`,
      "MainWindowHandle -eq [System.IntPtr]::Zero",
      "MonitorFromWindow(moyai, 2)",
      "GetMonitorInfo(mon, ref info)",
      "info.rcWork.Left",
      "IsIconic(claude) || IsZoomed(claude)) ShowWindow(claude, 9)",
      "IsIconic(moyai) || IsZoomed(moyai)) ShowWindow(moyai, 9)",
      "SetWindowPos(claude, System.IntPtr.Zero, left, top, cw, h,",
      "SetWindowPos(moyai, System.IntPtr.Zero, left + cw, top, w - cw, h,",
      "$r = 'no_claude_window'",
    ]) {
      expect(s, w).toContain(w);
    }
    // Claude の窓が無ければ Arrange（窓を動かす）を呼ばない
    expect(s).toContain("if ($claude -eq [System.IntPtr]::Zero) { $r = 'no_claude_window' } else { $r = [MoyaiArrange.Win]::Arrange($moyai, $claude) }");
    // 答えの行は 1 つの形だけ
    expect(s).toContain(`[Console]::Out.WriteLine('{"result":"' + $r + '"}')`);
  });
});

describe("PowerShell の引数と答えの読み取り", () => {
  it("引数は -NoProfile -NonInteractive -EncodedCommand と、台本を UTF-16LE で base64 にしたものだけ", () => {
    const args = powershellArgs();
    expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    expect(args).toHaveLength(4);
    expect(args[3]).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(args[3]!, "base64").toString("utf16le")).toBe(WINDOW_ARRANGE_SCRIPT);
    // 何度作っても同じ（呼び出しごとの値は入らない）
    expect(powershellArgs()).toEqual(args);
  });

  it("答えの読み取り", () => {
    expect(readArrangeOutput('{"result":"ok"}\r\n')).toEqual({ ok: true });
    expect(readArrangeOutput(Buffer.from('\uFEFF{"result":"no_claude_window"}\n'))).toEqual({ ok: false, reason: "no_claude_window" });
    expect(readArrangeOutput('{"result":"failed"}')).toEqual({ ok: false, reason: "failed" });
    // 読めない答え・空・知らない値は failed（並べたことにしない）
    for (const out of ["", "ok", '{"result":"OK"}', '{"result":"not_windows"}', '{"result":"ok","x":1}', "Add-Type : error"]) {
      expect(readArrangeOutput(out), out).toEqual({ ok: false, reason: "failed" });
    }
    // 前に余計な行があっても、答えの行を読む
    expect(readArrangeOutput('WARNING: x\n{"result":"ok"}\n')).toEqual({ ok: true });
  });

  it("タブの側の読み取り：形の違う答えは null", () => {
    expect(readWindowArrangeBody({ ok: true })).toEqual({ ok: true });
    for (const reason of ["no_claude_window", "not_windows", "failed"]) expect(readWindowArrangeBody({ ok: false, reason })).toEqual({ ok: false, reason });
    for (const b of [null, "ok", { ok: false }, { ok: false, reason: "other" }, { ok: "true" }]) expect(readWindowArrangeBody(b)).toBeNull();
  });

  it("Windows 以外は台本を走らせずに not_windows", async () => {
    const calls: string[][] = [];
    const run: ScriptRunner = async (a) => (calls.push(a), '{"result":"ok"}');
    for (const platform of ["linux", "darwin"] as const) expect(await createWindowArranger({ platform, run })()).toEqual({ ok: false, reason: "not_windows" });
    expect(calls).toHaveLength(0);
  });

  it("Windows では決まった引数で 1 回走らせる。走っている間に押されても 2 つ目は走らせない。走らなければ failed", async () => {
    const calls: string[][] = [];
    let release: (s: string) => void = () => {};
    const run: ScriptRunner = (a) => {
      calls.push(a);
      return new Promise((r) => (release = r));
    };
    const arrange = createWindowArranger({ platform: "win32", run });
    const a = arrange();
    const b = arrange();
    release('{"result":"ok"}');
    expect(await a).toEqual({ ok: true });
    expect(await b).toEqual({ ok: true });
    expect(calls).toEqual([powershellArgs()]);
    // 終わったら、もう一度押せば並べ直す
    const c = arrange();
    release('{"result":"no_claude_window"}');
    expect(await c).toEqual({ ok: false, reason: "no_claude_window" });
    expect(calls).toHaveLength(2);
    expect(await createWindowArranger({ platform: "win32", run: () => Promise.reject(new Error("x")) })()).toEqual({ ok: false, reason: "failed" });
  });
});

describe("道の守り（POST /tab/window-arrange）", () => {
  let tb: TestBridge | null = null;
  afterEach(async () => {
    await tb?.close();
    tb = null;
  });

  /** 走らせる部品のふり。呼ばれた数を数える */
  async function start(out = '{"result":"ok"}', platform: NodeJS.Platform = "win32", withTab = true) {
    const calls: string[][] = [];
    tb = await startTestBridge({ windowArrange: { platform, run: async (a) => (calls.push(a), out) } });
    if (withTab) {
      const tab = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
      await tab.opened;
      tab.send("tab.hello", { secret: SECRET_A, build: "test" });
      await tab.next("bridge.welcome");
    }
    return { t: tb, calls };
  }
  const good = (t: TestBridge) => ({ origin: t.origin, "sec-fetch-site": "same-origin", [HEADER_TAB_SECRET]: SECRET_A });
  const post = (t: TestBridge, headers: Record<string, string>, body?: string) => http(t.bridge.port, "POST", PATH, headers, body);

  it("道の表：タブの道、タブの秘密だけ（1 回きりの印は求めない）、体は受けない", () => {
    expect(ROUTES.tabWindowArrange).toMatchObject({ method: "POST", path: "/tab/window-arrange", kind: "tab", requires: { tabSecret: true }, maxBody: 0 });
  });

  it("守りがそろえば、台本を 1 回走らせて答えを返す（体は無し）", async () => {
    const { t, calls } = await start();
    const r = await post(t, good(t));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    const r2 = await post(t, { ...good(t), "content-length": "0" });
    expect(r2.body).toEqual({ ok: true });
    expect(calls).toEqual([powershellArgs(), powershellArgs()]);
  });

  it("Claude の窓が無い・失敗・Windows 以外の答えを、そのまま返す", async () => {
    let s = await start('{"result":"no_claude_window"}');
    expect((await post(s.t, good(s.t))).body).toEqual({ ok: false, reason: "no_claude_window" });
    await tb!.close();
    s = await start("");
    expect((await post(s.t, good(s.t))).body).toEqual({ ok: false, reason: "failed" });
    await tb!.close();
    s = await start('{"result":"ok"}', "linux");
    expect((await post(s.t, good(s.t))).body).toEqual({ ok: false, reason: "not_windows" });
    expect(s.calls).toHaveLength(0);
  });

  it("タブの秘密が無い・違う要求は断り、台本を走らせない", async () => {
    const { t, calls } = await start();
    const none = await post(t, { origin: t.origin, "sec-fetch-site": "same-origin" });
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe("secret_missing");
    const empty = await post(t, { ...good(t), [HEADER_TAB_SECRET]: "" });
    expect(empty.body.error.code).toBe("secret_missing");
    const wrong = await post(t, { ...good(t), [HEADER_TAB_SECRET]: SECRET_B });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("secret_mismatch");
    expect(calls).toHaveLength(0);
  });

  it("Origin が無い・違う、ほかのサイトからの要求は、秘密が合っていても断る", async () => {
    const { t, calls } = await start();
    const noOrigin = await post(t, { [HEADER_TAB_SECRET]: SECRET_A });
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.body.error.code).toBe("origin_missing");
    const evil = await post(t, { ...good(t), origin: "http://evil.example" });
    expect(evil.body.error.code).toBe("origin_not_allowed");
    const cross = await post(t, { ...good(t), "sec-fetch-site": "cross-site" });
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe("fetch_site_not_allowed");
    const host = await post(t, { ...good(t), host: "evil.example" });
    expect(host.body.error.code).toBe("host_not_allowed");
    expect(calls).toHaveLength(0);
  });

  it("体があれば断る。GET は受けない", async () => {
    const { t, calls } = await start();
    const body = await post(t, { ...good(t), "content-type": "application/json" }, "{}");
    expect(body.status).toBe(413);
    expect(body.body.error.code).toBe("body_too_large");
    const get = await http(t.bridge.port, "GET", PATH, good(t));
    expect(get.status).toBe(405);
    expect(get.body.error.code).toBe("method_not_allowed");
    expect(calls).toHaveLength(0);
  });

  it("作業画面のタブがつながっていなければ断る", async () => {
    const { t, calls } = await start('{"result":"ok"}', "win32", false);
    const r = await post(t, good(t));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("tab_not_open");
    expect(calls).toHaveLength(0);
  });
});
