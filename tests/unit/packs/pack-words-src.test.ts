// 業種の語は src/ に書かない（パックに置く。docs/plan.md §5.1 の pack.words）。
// packs/ のどのパックの語（1 段目の項目の名前・検査が選ぶ作業の名前・尺度の名前。2 文字以上、ASCII だけの語は除く、NFKC）も、
// src/ のコード（コメントを外したもの）に出ないことを見る。コメントの例（「計量機 › 点検」など）は数えない。
// 許す一覧（ALLOW）に入れるファイルは、理由を書く。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 業種の語が出てよいファイルと理由 */
const ALLOW: Record<string, string> = {
  "src/bridge/connect/fake.ts": "試験の台だけで使う偽の連携（MOYAI_CONNECT_FAKE=1）の【架空】の中身。利用者の道では読まない",
};

function packWords(pack: string): Set<string> {
  const words = new Set<string>();
  const add = (s: unknown) => {
    if (typeof s !== "string") return;
    const t = s.normalize("NFKC").trim();
    if (t.length >= 2 && !/^[\x00-\x7f]+$/.test(t)) words.add(t);
  };
  const walk = (n: unknown, keys: string[]) => {
    if (Array.isArray(n)) n.forEach((x) => walk(x, keys));
    else if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) (keys.includes(k) && typeof v === "string" ? add(v) : walk(v, keys));
  };
  walk(JSON.parse(readFileSync(join("packs", pack, "common.json"), "utf8")), ["name"]);
  const checks = join("packs", pack, "checks.json");
  if (existsSync(checks)) {
    for (const c of JSON.parse(readFileSync(checks, "utf8")).checks as { params: { works?: { values: string[] }[]; scale?: string } }[]) {
      for (const w of c.params.works ?? []) for (const v of w.values) add(v);
      add(c.params.scale);
    }
  }
  return words;
}

/** コメントを外す（ブロックのコメントと、行の頭か空白のあとの // から行末まで。URL の // は残す） */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(),])\/\/.*$/gm, "$1");
}

const srcFiles = (): string[] => {
  const out: string[] = [];
  const rec = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) rec(p);
      else if (/\.(ts|tsx|mjs|js|json)$/.test(n)) out.push(p.replace(/\\/g, "/"));
    }
  };
  rec("src");
  return out;
};

const packs = readdirSync("packs").filter((p) => existsSync(join("packs", p, "common.json")));

describe("pack.words：業種の語は src/ のコードに無い（パックに置く）", () => {
  it("コメントを外すと、// と /* */ の中の語は数えない。URL の // は残す", () => {
    expect(stripComments('const a = 1; // 焼却炉\n/* ごみクレーン */ const b = "https://x.example/焼却炉";')).toBe('const a = 1; \n const b = "https://x.example/焼却炉";');
  });

  it.each(packs)("%s のパックの語が、src/ のどのファイルのコードにも出ない（許す一覧のほか）", (pack) => {
    const words = packWords(pack);
    expect(words.size, `${pack} の語が少なすぎる（読み方が壊れた）`).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const f of srcFiles()) {
      if (f in ALLOW) continue;
      const code = stripComments(readFileSync(f, "utf8")).normalize("NFKC");
      for (const w of words) if (code.includes(w)) hits.push(`${f}：「${w}」`);
    }
    expect(hits, "業種の語はパック（packs/<パック>/）に置く。src/ に書くしかないなら、理由を書いて ALLOW に入れる").toEqual([]);
  });

  it("許す一覧のファイルはあり、理由が書いてある", () => {
    for (const [f, why] of Object.entries(ALLOW)) {
      expect(existsSync(f), f).toBe(true);
      expect(why.length, f).toBeGreaterThan(10);
    }
  });
});
