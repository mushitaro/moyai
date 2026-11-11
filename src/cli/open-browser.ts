// 作業画面を既定のブラウザで開く（moyai start と、作業画面が開いていないときに橋渡しが開く）。
// Windows で既定のブラウザが Chrome か Edge なら、別の窓（--new-window）で開く（mushitaro/moyai#44）：
// claude.ai のタブと同じ窓のタブで開くと、「Claude と並べる」で窓どうしを並べられないので。
// 既定のブラウザは HKCU の http の UserChoice の ProgId で見分ける（ChromeHTML・MSEdgeHTM）。分からなければ今までどおり既定のブラウザに渡す。
// 引数は決まった字と、橋渡しが作った 127.0.0.1 の URL だけ（形が違えば別の窓にしない）。実機の Windows では未確認。
import { execFileSync, spawn } from "node:child_process";

export type NewWindowBrowser = "chrome" | "msedge";

/** 既定のブラウザの ProgId から、別の窓で開けるブラウザを見分ける */
export function browserOfProgId(progId: string | null): NewWindowBrowser | null {
  if (!progId) return null;
  if (/^ChromeHTML/i.test(progId)) return "chrome";
  if (/^MSEdgeHTM/i.test(progId)) return "msedge";
  return null;
}

/** reg query の答えから ProgId を読む */
export function readProgId(out: string): string | null {
  const m = /^\s*ProgId\s+REG_SZ\s+(\S+)\s*$/im.exec(out);
  return m ? m[1]! : null;
}

// cmd の区切りになる字（& ^ | < > " など）を入れない
const LOCAL_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}\/[A-Za-z0-9#/._-]*$/;

/** cmd に渡す引数。ブラウザが分かり、URL が橋渡しの形なら、そのブラウザの別の窓で開く */
export function windowsOpenArgs(url: string, browser: NewWindowBrowser | null): string[] {
  if (browser && LOCAL_URL.test(url)) return ["/c", "start", '""', browser, "--new-window", url];
  return ["/c", "start", '""', url];
}

function defaultBrowserWindows(): NewWindowBrowser | null {
  try {
    const out = execFileSync(
      "reg",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice", "/v", "ProgId"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 3000 },
    );
    const b = browserOfProgId(readProgId(out));
    // start が見つけられる（App Paths に登録がある）ときだけ。無ければ「見つかりません」の窓が出るので、今までどおり既定のブラウザに渡す
    return b && hasAppPath(b) ? b : null;
  } catch {
    return null;
  }
}

function hasAppPath(b: NewWindowBrowser): boolean {
  for (const root of ["HKLM", "HKCU"]) {
    try {
      execFileSync("reg", ["query", `${root}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${b}.exe`], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 3000,
      });
      return true;
    } catch {
      /* 無い */
    }
  }
  return false;
}

export function openBrowser(url: string): void {
  // 開けなくても止めない（URL は端末に出してある）
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", windowsOpenArgs(url, defaultBrowserWindows())]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd as string, args as string[], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      windowsVerbatimArguments: process.platform === "win32",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* 開けなかった */
  }
}
