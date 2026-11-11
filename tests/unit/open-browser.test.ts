// 作業画面を開く（mushitaro/moyai#44）：Windows で既定のブラウザが Chrome か Edge なら別の窓で開く。分からなければ今までどおり。
// cmd も reg も走らせない（引数の組み立てと答えの読み取りだけ）。実機の Windows では未確認。
import { describe, expect, it } from "vitest";
import { browserOfProgId, readProgId, windowsOpenArgs } from "../../src/cli/open-browser";

describe("作業画面を別の窓で開く", () => {
  it("ProgId から Chrome と Edge を見分け、ほかは分からないとする", () => {
    expect(browserOfProgId("ChromeHTML")).toBe("chrome");
    expect(browserOfProgId("MSEdgeHTM")).toBe("msedge");
    expect(browserOfProgId("FirefoxURL-308046B0AF4A39CB")).toBeNull();
    expect(browserOfProgId(null)).toBeNull();
  });

  it("reg query の答えから ProgId を読む", () => {
    const out = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice\r\n    ProgId    REG_SZ    ChromeHTML\r\n\r\n";
    expect(readProgId(out)).toBe("ChromeHTML");
    expect(readProgId("")).toBeNull();
  });

  it("ブラウザが分かり、URL が橋渡しの形なら --new-window。ほかは既定のブラウザに渡す", () => {
    expect(windowsOpenArgs("http://127.0.0.1:43110/", "chrome")).toEqual(["/c", "start", '""', "chrome", "--new-window", "http://127.0.0.1:43110/"]);
    expect(windowsOpenArgs("http://127.0.0.1:43110/#/merge", "msedge")).toEqual(["/c", "start", '""', "msedge", "--new-window", "http://127.0.0.1:43110/#/merge"]);
    expect(windowsOpenArgs("http://127.0.0.1:43110/", null)).toEqual(["/c", "start", '""', "http://127.0.0.1:43110/"]);
    // 形の違う URL（ほかの宛先・記号）は別の窓にしない
    expect(windowsOpenArgs("http://example.com/", "chrome")).toEqual(["/c", "start", '""', "http://example.com/"]);
    expect(windowsOpenArgs("http://127.0.0.1:43110/&calc", "chrome")[3]).toBe("http://127.0.0.1:43110/&calc");
  });
});
