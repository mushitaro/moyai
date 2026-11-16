// 画面の言葉の英語と日本語（src/app/text/i18n.ts）：形がそろう・言語の切り替え・購読・PC の言語からの選び方。
import { afterEach, describe, expect, it } from "vitest";
import { REGISTERED, defineMessages, getLang, langOfNavigator, messagesIn, setLang, shapeDiff, subscribeLang, withLang } from "../../src/app/text/i18n";
// 表を全部読み込む（読み込むと REGISTERED に入る）
import "../../src/app/text";
import "../../src/app/text/human";
import "../../src/app/text/photo";
import "../../src/app/text/reasons";
import "../../src/app/text/review";
import "../../src/app/text/site";

afterEach(() => setLang("ja", { remember: false }));

describe("i18n の形", () => {
  it("登録したどの表も、英語と日本語の形（鍵・入れ子・組の長さ・字か関数か・引数の数）がそろう", () => {
    expect(REGISTERED.length).toBeGreaterThan(0);
    for (const t of REGISTERED) expect(shapeDiff(t.en, t.ja)).toEqual([]);
  });

  it("形の違いを見つける（鍵が足りない・余る・引数の数・字と関数）", () => {
    expect(shapeDiff({ a: "x", b: { c: "y" } }, { a: "x", b: {} })).toEqual([".b.c: 英語だけ"]);
    expect(shapeDiff({ a: "x" }, { a: "x", z: "q" })).toEqual([".z: 日本語だけ"]);
    expect(shapeDiff({ f: (n: number) => `${n}` }, { f: () => "" })).toEqual([".f: 引数 1 ≠ 0"]);
    expect(shapeDiff({ f: "x" }, { f: () => "" })).toEqual([".f: string ≠ function"]);
  });

  it("型の検査：日本語の表に足りない鍵・余る鍵・違う引数は落ちる", () => {
    const en = { a: "A", n: { b: (x: number) => `B${x}` } };
    // @ts-expect-error 鍵 n.b が無い
    defineMessages(en, { a: "あ", n: {} });
    // @ts-expect-error 余る鍵 z
    defineMessages(en, { a: "あ", n: { b: (x: number) => `い${x}` }, z: "ぜ" });
    // @ts-expect-error 引数の型が違う
    defineMessages(en, { a: "あ", n: { b: (x: string) => `い${x}` } });
    expect(true).toBe(true);
  });
});

describe("i18n の切り替え", () => {
  const T = defineMessages({ hi: "Hello", n: { count: (k: number) => `${k} items` }, list: ["a", "b"] as [string, string] }, { hi: "こんにちは", n: { count: (k: number) => `${k} 件` }, list: ["あ", "い"] });

  it("今の言語の字を返す。先に取っておいた入れ子の表も、読むときの言語になる", () => {
    const N = T.n;
    setLang("en", { remember: false });
    expect(T.hi).toBe("Hello");
    expect(N.count(3)).toBe("3 items");
    expect(T.list).toEqual(["a", "b"]);
    setLang("ja", { remember: false });
    expect(T.hi).toBe("こんにちは");
    expect(N.count(3)).toBe("3 件");
    expect(Object.keys(T.n)).toEqual(["count"]);
    expect(T.n).toBe(N);
  });

  it("言語を変えると、購読した手が呼ばれる（同じ言語なら呼ばれない）", () => {
    let calls = 0;
    const off = subscribeLang(() => calls++);
    setLang("en", { remember: false });
    setLang("en", { remember: false });
    setLang("ja", { remember: false });
    off();
    setLang("en", { remember: false });
    expect(calls).toBe(2);
    expect(getLang()).toBe("en");
  });

  it("withLang と messagesIn は、画面の言語を変えずに別の言語の字を作る", () => {
    setLang("ja", { remember: false });
    expect(withLang("en", () => T.hi)).toBe("Hello");
    const en = messagesIn(T, "en");
    expect(en.hi).toBe("Hello");
    expect(en.n.count(2)).toBe("2 items");
    expect(getLang()).toBe("ja");
  });
});

describe("PC の言語からの選び方", () => {
  it("最初の言語が ja で始まれば日本語、ほかと空は英語", () => {
    expect(langOfNavigator(["ja-JP", "en-US"])).toBe("ja");
    expect(langOfNavigator(["ja"])).toBe("ja");
    expect(langOfNavigator(["en-US", "ja-JP"])).toBe("en");
    expect(langOfNavigator(["fr"])).toBe("en");
    expect(langOfNavigator([])).toBe("en");
    expect(langOfNavigator(undefined)).toBe("en");
  });
});
