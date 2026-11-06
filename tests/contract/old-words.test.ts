// 古い言葉（印・決定のシート・束・輪）が、画面の字と Claude・人に見せる文に残っていないか（運営者、11-06 夜：「印は星取と言ってください」「古い言葉をいつまでも使わないでほしい」）。
// 置き換えの表は docs/words.md の「印 → 星取」。○・●・◎（作業の年度の値）は「星取」。
// 署名される字（src/import/compose.ts の basis「星取表 X の印「○」」・LEDGER_SOURCE・CONVERSATION_SOURCE など）は据え置き。src/import はこの試験の対象にしない。
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** 見る所：画面の字、Claude と人に見せる文（ts はコメントを除く）、Skill の本文 */
const TS_FILES = [
  ...readdirSync("src/app/text").filter((f) => f.endsWith(".ts")).map((f) => `src/app/text/${f}`),
  "src/shared/instructions.ts",
  "src/shared/tools.ts",
  "src/shared/errors.ts",
  "src/shared/data-names.ts",
];
const SKILL_FILES = [
  ...readdirSync("packs", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `packs/${d.name}/SKILL.md`)
    .filter((p) => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    }),
  "skills/moyai/SKILL.md",
];
const FILES = [...TS_FILES, ...SKILL_FILES];
const body = (f: string) => (f.endsWith(".ts") ? stripComments(read(f)) : read(f));

/** 縛る語。「印」は印刷・押印（印鑑の意味）を許す */
const BANNED: { word: string; re: RegExp }[] = [
  { word: "印", re: /(?<!押)印(?!刷)/g },
  { word: "決定のシート", re: /決定のシート/g },
  { word: "束", re: /束/g },
  { word: "輪", re: /輪/g },
];

/**
 * 許す所。text はその語を含む字のまとまり（ファイルの中にそのままあること）。
 * 「束」「輪」は docs/words.md の表に置き換えが無い（11-06）。表に入ったら置き換えて、ここから消す。
 */
const ALLOWED: { name: string; file: string; text: string; reason: string }[] = [
  { name: "data-names の目印の誤り", file: "src/shared/data-names.ts", text: "data-names の印が無い", reason: "ファイルの中の目印（moyai:data-names）の誤り。画面にも Claude にも出ない（words.md で対象外）" },
  { name: "決まり 2 の束（instructions）", file: "src/shared/instructions.ts", text: "セル・ファイル・メモ・束の文", reason: "words.md の表に「束」の置き換えが無い" },
  { name: "決まり 2 の束（Skill）", file: "skills/moyai/SKILL.md", text: "セル・ファイル・メモ・束の文", reason: "instructions から作る。words.md の表に「束」の置き換えが無い" },
  { name: "check_results の共有の束", file: "src/shared/tools.ts", text: "共有の束に写す数", reason: "words.md の表に「束」の置き換えが無い" },
  { name: "SHARE の輪（instructions）", file: "src/shared/instructions.ts", text: "輪か公開の台帳に出す", reason: "words.md の表に「輪」の置き換えが無い" },
  { name: "設定の輪（instructions）", file: "src/shared/instructions.ts", text: "台帳の clone・輪・覚えた鍵", reason: "words.md の表に「輪」の置き換えが無い" },
  { name: "SHARE の輪（Skill）", file: "skills/moyai/SKILL.md", text: "輪か公開の台帳に出す", reason: "instructions から作る。words.md の表に「輪」の置き換えが無い" },
  { name: "設定の輪（Skill）", file: "skills/moyai/SKILL.md", text: "台帳の clone・輪・覚えた鍵", reason: "instructions から作る。words.md の表に「輪」の置き換えが無い" },
  { name: "peer_reference の輪", file: "src/shared/tools.ts", text: "（輪は読まない）", reason: "words.md の表に「輪」の置き換えが無い" },
  { name: "し尿の共有の輪", file: "packs/night-soil/SKILL.md", text: "共有（輪・公開の台帳）", reason: "words.md の表に「輪」の置き換えが無い" },
  { name: "ごみ焼却の輪の数字", file: "packs/waste-incineration/SKILL.md", text: "輪（非公開）の数字", reason: "words.md の表に「輪」の置き換えが無い" },
];

describe("古い言葉（印・決定のシート・束・輪）", () => {
  test("見る所を読めている", () => {
    expect(TS_FILES.length).toBeGreaterThan(8);
    expect(SKILL_FILES).toEqual(expect.arrayContaining(["packs/waste-incineration/SKILL.md", "packs/night-soil/SKILL.md", "skills/moyai/SKILL.md"]));
  });

  test("許す所は、どれもまだファイルにあり、縛る語を含む（古い許しを残さない）", () => {
    for (const a of ALLOWED) {
      expect(FILES, a.name).toContain(a.file);
      expect(body(a.file).includes(a.text), `${a.name}：${a.file} に「${a.text}」が無い`).toBe(true);
      expect(BANNED.some((b) => new RegExp(b.re.source).test(a.text)), `${a.name}：縛る語を含まない`).toBe(true);
      expect(a.reason.length).toBeGreaterThan(0);
    }
  });

  test("許す所のほかに、縛る語が無い", () => {
    for (const f of FILES) {
      let rest = body(f);
      for (const a of ALLOWED.filter((x) => x.file === f)) rest = rest.split(a.text).join("");
      for (const b of BANNED) {
        const hits = [...rest.matchAll(b.re)].map((m) => rest.slice(Math.max(0, m.index! - 12), m.index! + 12).replace(/\n/g, " "));
        expect(hits, `${f} に「${b.word}」`).toEqual([]);
      }
    }
  });

  test("星取の言葉（差分の数・差分レポート・凡例）", async () => {
    const { HUMAN_TEXT, TEXT } = await import("../../src/app/text");
    expect(HUMAN_TEXT.confirm.summary(1, 2, 3, 4)).toBe("星取　追加 1・削除 2・変更 3・変更なし 4");
    expect(TEXT.chart.markNone).toBe("星取なし");
    expect(TEXT.chart.markRemoved).toBe("星取の削除");
  });
});
