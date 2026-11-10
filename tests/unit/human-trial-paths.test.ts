// 人の試し（時間の地図 2、mushitaro/moyai#32）と星取の削除の確定は、画面の人の操作だけが呼ぶ。
// AI のツールの受け手（src/app/intake/ の下の、tab-tools.ts とそれが呼ぶ screen-set.ts など）と橋渡し（src/bridge/）のどのファイルにも、その関数名が無いこと
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HUMAN_ONLY = ["moveStarByHuman", "undoTrialByHuman", "redoTrialByHuman", "acceptRemovalsByHuman", "undoRemovalsByHuman", "rejectStarGroupByHuman"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mts)$/.test(n) ? [p] : [];
  });
}

describe("人だけの星取の操作は、AI のツールの受け手と橋渡しから呼ばない", () => {
  for (const dir of ["src/app/intake", "src/bridge"]) {
    it(dir, () => {
      const list = files(dir);
      expect(list.length).toBeGreaterThan(0);
      for (const f of list) {
        const src = readFileSync(f, "utf8");
        for (const name of HUMAN_ONLY) expect(src.includes(name), `${f} に ${name}`).toBe(false);
      }
    });
  }
});
