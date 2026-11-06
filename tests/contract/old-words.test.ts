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
  // 橋渡し・CLI・共有の芯・台帳の検証・デモの共有フォルダが出す字（11-06 夜、第 2 弾）
  ...["src/cli", "src/share", "src/bridge", "scripts/ledger", "scripts/demo-ring"].flatMap((d) =>
    readdirSync(d).filter((f) => /\.(ts|mjs)$/.test(f) && !f.endsWith(".d.mts")).map((f) => `${d}/${f}`),
  ),
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
const body = (f: string) => (/\.(ts|mjs)$/.test(f) ? stripComments(read(f)) : read(f));

/** 縛る語。「印」は印刷・押印（印鑑の意味）を許す。「束」は約束・結束（別の語）を許す */
const BANNED: { word: string; re: RegExp }[] = [
  { word: "印", re: /(?<!押)印(?!刷)/g },
  { word: "決定のシート", re: /決定のシート/g },
  { word: "束", re: /(?<![約結])束/g },
  { word: "輪", re: /輪/g },
  { word: "仲間", re: /仲間/g },
  // 2 回目（old-words-v2）。docs/words.md の置き換え
  { word: "当てはめ", re: /当てはめ(?![るまなてた])/g },
  { word: "未当てはめ", re: /未当てはめ/g },
  // 「費用の読み方」「年度の読み方」など、読めない値の質問の名前は words.md が決めた言葉。ルールの意味の「読み方」だけを縛る
  { word: "読み方", re: /(?<!(?:費用|計画・実績|工数|日付|年度)の)読み方/g },
  { word: "検査", re: /(?<![精密機能定期点・])検査/g },
  { word: "合言葉", re: /合言葉/g },
  // 「Skillパック」は許す。単独の「パック」だけを縛る
  { word: "パック", re: /(?<!Skill)パック/g },
  { word: "似た施設", re: /似た施設/g },
  { word: "計量値", re: /計量値/g },
];

/**
 * 許す所。text はその語を含む字のまとまり（ファイルの中にそのままあること）。
 * 束 → 共有ファイル、輪 → 共有フォルダ（運営者の決定、docs/words.md）。
 */
const ALLOWED: { name: string; file: string; text: string; reason: string }[] = [
  { name: "words.md の表の引用（当てはめ）", file: "src/shared/data-names.ts", text: "docs/words.md「当てはめ → 紐付け」", reason: "decidedIn は置き換えの表の見出しを写した記録。表の「前」の列は記録なので直さない" },
  { name: "版をまたぐ紐付けの basis", file: "src/app/text/index.ts", text: "で受けた当てはめと同じ", reason: "sameAs は案の basis に入り、署名される字。前の版の字は直さない（docs/words.md「据え置き」）" },
  { name: "words.md の表の引用（読み方）", file: "src/shared/data-names.ts", text: "docs/words.md「読み方 → ルール」", reason: "decidedIn は置き換えの表の見出しを写した記録" },
  { name: "words.md の表の引用（計量値）", file: "src/shared/data-names.ts", text: "「計量値」を「稼働」に", reason: "decidedIn は運営者の決めた置き換えを写した記録" },
  { name: "data-names の目印の誤り", file: "src/shared/data-names.ts", text: "data-names の印が無い", reason: "ファイルの中の目印（moyai:data-names）の誤り。画面にも Claude にも出ない（words.md で対象外）" },
];

describe("古い言葉（印・決定のシート・束・輪・当てはめ・読み方・検査・合言葉・パック・似た施設・計量値）", () => {
  test("見る所を読めている", () => {
    expect(TS_FILES.length).toBeGreaterThan(8);
    for (const f of ["src/cli/ledger.ts", "src/share/ledger-send.ts", "src/bridge/places.ts", "scripts/ledger/build-bundles.mjs", "scripts/demo-ring/build.mjs"]) expect(TS_FILES, f).toContain(f);
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
