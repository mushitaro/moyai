// ヘッダの「Claude と並べる」（docs/screens.md §1）：Claude Desktop の窓を左、MOYAI の窓を右に並べる（Windows だけ）。
// - 橋渡しが PowerShell（-NoProfile -NonInteractive、窓を出さない）で、user32 を呼ぶ小さな台本を走らせる。
// - 台本はこのファイルの定数。引数は決まった字と、台本を UTF-16LE で base64 にしたものだけ（利用者の値を混ぜない）。
// - MOYAI の窓は、押した直後の前面の窓（GetForegroundWindow）。Claude Desktop の窓は、プロセスの名前が claude で、
//   実行ファイルの道が \WindowsApps\Claude_ か \AnthropicClaude\ を含み、MainWindowHandle が 0 でないもの。無ければ窓は動かさない。
// - MOYAI の窓がある画面の作業領域（MonitorFromWindow・GetMonitorInfo の rcWork）で、Claude を左 40%（最小 560px）、MOYAI を右の残りに。
//   最大化・最小化の窓は先に元に戻す（ShowWindow の SW_RESTORE）。動かすのは SetWindowPos。
// - 台本の組み立て（buildArrangeScript）と答えの読み取り（readArrangeOutput）は、PowerShell を走らせずに試験する（tests/unit/window-arrange.test.ts）。
import { execFile } from "node:child_process";
import type { WindowArrangeResult } from "../shared/window-arrange";

/** Claude の窓の幅：作業領域の幅の 40%。ただし 560px より狭くしない（docs/screens.md §1） */
export const ARRANGE = { share: 0.4, minWidth: 560 } as const;

export interface WorkArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 並べ方の計算（台本の中の C# と同じ式）。dpi は MOYAI の窓がある画面の DPI（96 で 100%）。
 * 最小の 560px は 100% のときの幅で、画面の拡大に合わせて広げる（台本は物理の画素で動かすため）。
 * 作業領域が最小の幅より狭ければ null（台本は窓を動かさずに failed を返す）。
 */
export function arrangeRects(work: WorkArea, dpi = 96, o: { share: number; minWidth: number } = ARRANGE): { claude: WindowRect; moyai: WindowRect } | null {
  const w = work.right - work.left;
  const h = work.bottom - work.top;
  const min = Math.ceil((o.minWidth * dpi) / 96);
  const cw = Math.max(min, Math.floor(w * o.share));
  if (cw >= w || h <= 0) return null;
  return {
    claude: { x: work.left, y: work.top, w: cw, h },
    moyai: { x: work.left + cw, y: work.top, w: w - cw, h },
  };
}

/**
 * 台本を組み立てる。数は share と minWidth だけを差し込む（どちらもこのファイルの定数。利用者の値は入らない）。
 * 答えは 1 行の JSON：{"result":"ok"} か {"result":"no_claude_window"} か {"result":"failed"}。窓の題・道・番号は出さない。
 */
export function buildArrangeScript(o: { share: number; minWidth: number } = ARRANGE): string {
  if (!(o.share > 0 && o.share < 1) || !Number.isInteger(o.minWidth) || o.minWidth <= 0) throw new Error("並べ方の数が範囲の外");
  return String.raw`$ErrorActionPreference = 'Stop'
$r = 'failed'
try {
Add-Type -Namespace MoyaiArrange -Name Win -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr MonitorFromWindow(System.IntPtr hwnd, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool GetMonitorInfo(System.IntPtr monitor, ref MONITORINFO info);
[System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool IsIconic(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool IsZoomed(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool ShowWindow(System.IntPtr hwnd, int cmd);
[System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetWindowPos(System.IntPtr hwnd, System.IntPtr after, int x, int y, int cx, int cy, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr SetThreadDpiAwarenessContext(System.IntPtr context);
[System.Runtime.InteropServices.DllImport("shcore.dll")] static extern int GetDpiForMonitor(System.IntPtr monitor, int type, out uint dpiX, out uint dpiY);
public static string Arrange(System.IntPtr moyai, System.IntPtr claude) {
  if (moyai == System.IntPtr.Zero || claude == System.IntPtr.Zero || moyai == claude) return "failed";
  bool aware = false;
  try { aware = SetThreadDpiAwarenessContext(new System.IntPtr(-4)) != System.IntPtr.Zero; } catch (System.Exception) { aware = false; }
  System.IntPtr mon = MonitorFromWindow(moyai, 2);
  if (mon == System.IntPtr.Zero) return "failed";
  MONITORINFO info = new MONITORINFO();
  info.cbSize = System.Runtime.InteropServices.Marshal.SizeOf(typeof(MONITORINFO));
  if (!GetMonitorInfo(mon, ref info)) return "failed";
  int dpi = 96;
  if (aware) {
    try { uint dx; uint dy; if (GetDpiForMonitor(mon, 0, out dx, out dy) == 0 && dx > 0) dpi = (int)dx; } catch (System.Exception) { dpi = 96; }
  }
  int left = info.rcWork.Left;
  int top = info.rcWork.Top;
  int w = info.rcWork.Right - left;
  int h = info.rcWork.Bottom - top;
  int min = (int)System.Math.Ceiling(${o.minWidth} * dpi / 96.0);
  int cw = System.Math.Max(min, (int)System.Math.Floor(w * ${o.share}));
  if (cw >= w || h <= 0) return "failed";
  if (IsIconic(claude) || IsZoomed(claude)) ShowWindow(claude, 9);
  if (IsIconic(moyai) || IsZoomed(moyai)) ShowWindow(moyai, 9);
  bool a = SetWindowPos(claude, System.IntPtr.Zero, left, top, cw, h, 0x0010);
  bool b = SetWindowPos(moyai, System.IntPtr.Zero, left + cw, top, w - cw, h, 0x0014);
  SetWindowPos(claude, System.IntPtr.Zero, left, top, cw, h, 0x0014);
  return (a && b) ? "ok" : "failed";
}
'@
$moyai = [MoyaiArrange.Win]::GetForegroundWindow()
$claude = [System.IntPtr]::Zero
foreach ($p in @(Get-Process -Name 'claude' -ErrorAction SilentlyContinue)) {
  $path = ''
  try { $path = [string]$p.Path } catch { $path = '' }
  if (-not $path) { continue }
  if ($path.IndexOf('\WindowsApps\Claude_', [System.StringComparison]::OrdinalIgnoreCase) -lt 0 -and $path.IndexOf('\AnthropicClaude\', [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
  if ($p.MainWindowHandle -eq [System.IntPtr]::Zero) { continue }
  $claude = $p.MainWindowHandle
  break
}
if ($claude -eq [System.IntPtr]::Zero) { $r = 'no_claude_window' } else { $r = [MoyaiArrange.Win]::Arrange($moyai, $claude) }
} catch { $r = 'failed' }
[Console]::Out.WriteLine('{"result":"' + $r + '"}')
`;
}

/** 走らせる台本（定数） */
export const WINDOW_ARRANGE_SCRIPT = buildArrangeScript();

/** PowerShell に渡す引数。決まった字と、台本を UTF-16LE で base64 にしたもの（-EncodedCommand。引用符と改行を崩さない） */
export function powershellArgs(script: string = WINDOW_ARRANGE_SCRIPT): string[] {
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

/** 台本の答えを読む。決まった形の行が無ければ failed（読めない答えを、並べたことにしない）。 */
export function readArrangeOutput(out: Buffer | string): WindowArrangeResult {
  const text = (typeof out === "string" ? out : out.toString("utf8")).replace(/^\uFEFF/, "");
  let last: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\{"result":"(ok|no_claude_window|failed)"\}$/.exec(line.trim());
    if (m) last = m[1]!;
  }
  if (last === "ok") return { ok: true };
  if (last === "no_claude_window") return { ok: false, reason: "no_claude_window" };
  return { ok: false, reason: "failed" };
}

/** 台本を走らせる部品（試験は差し替える）。標準出力を返す。走らなければ空 */
export type ScriptRunner = (args: string[]) => Promise<string>;

export const runPowerShell: ScriptRunner = (args) =>
  new Promise((res) => {
    execFile("powershell", args, { encoding: "buffer", windowsHide: true, timeout: 15_000 }, (_err, stdout) => res(Buffer.isBuffer(stdout) ? stdout.toString("utf8") : ""));
  });

/**
 * 窓を並べる関数を作る。Windows 以外は台本を走らせずに not_windows。
 * 走っている間にもう一度呼ばれたら、同じ答えを待つ（PowerShell を 2 つ走らせない）。
 */
export function createWindowArranger(o: { platform?: NodeJS.Platform; run?: ScriptRunner } = {}): () => Promise<WindowArrangeResult> {
  const platform = o.platform ?? process.platform;
  const run = o.run ?? runPowerShell;
  let running: Promise<WindowArrangeResult> | null = null;
  return () => {
    if (platform !== "win32") return Promise.resolve({ ok: false, reason: "not_windows" });
    running ??= run(powershellArgs())
      .then(readArrangeOutput, (): WindowArrangeResult => ({ ok: false, reason: "failed" }))
      .finally(() => {
        running = null;
      });
    return running;
  };
}
