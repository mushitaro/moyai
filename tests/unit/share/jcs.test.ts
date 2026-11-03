// RFC 8785 の正規化：RFC の例（§3.2.2 の例、§3.2.3 の並べ方の例、付録 B の数の例）と、厳しい読み手。
import { describe, expect, it } from "vitest";
import { JcsError, canonicalize, parseJsonStrict } from "../../../src/share/jcs";

function fromBits(hex: string): number {
  const b = Buffer.from(hex, "hex");
  return b.readDoubleBE(0);
}

describe("jcs（RFC 8785）", () => {
  it("§3.2.2 の例：数・文字列・語", () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("§3.2.3 の例：キーは UTF-16 の符号の単位の順", () => {
    const input = JSON.parse(
      '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One",' +
        '"\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}',
    );
    const out = canonicalize(input);
    // Object.keys は整数のようなキーを前に出すので、並びは読み手の文字列の順で見る
    const keys = parseJsonStrict(out).strings.filter((x) => x.isKey).map((x) => x.value);
    expect(keys.map((k) => k.codePointAt(0)!.toString(16))).toEqual(["d", "31", "80", "f6", "20ac", "1f600", "fb33"]);
    expect(out).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign",' +
        '"😀":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it("付録 B の数の例（IEEE 754 のビット → 文字）", () => {
    const cases: [string, string][] = [
      ["0000000000000000", "0"],
      ["8000000000000000", "0"],
      ["0000000000000001", "5e-324"],
      ["8000000000000001", "-5e-324"],
      ["7fefffffffffffff", "1.7976931348623157e+308"],
      ["ffefffffffffffff", "-1.7976931348623157e+308"],
      ["4340000000000000", "9007199254740992"],
      ["c340000000000000", "-9007199254740992"],
      ["4430000000000000", "295147905179352830000"],
      ["44b52d02c7e14af5", "9.999999999999997e+22"],
      ["44b52d02c7e14af6", "1e+23"],
      ["44b52d02c7e14af7", "1.0000000000000001e+23"],
      ["444b1ae4d6e2ef4e", "999999999999999700000"],
      ["444b1ae4d6e2ef4f", "999999999999999900000"],
      ["444b1ae4d6e2ef50", "1e+21"],
      ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
      ["3eb0c6f7a0b5ed8d", "0.000001"],
      ["41b3de4355555553", "333333333.3333332"],
      ["41b3de4355555554", "333333333.33333325"],
      ["41b3de4355555555", "333333333.3333333"],
      ["41b3de4355555556", "333333333.3333334"],
      ["41b3de4355555557", "333333333.33333343"],
      ["becbf647612f3696", "-0.0000033333333333333333"],
      ["43143ff3c1cb0959", "1424953923781206.2"],
    ];
    for (const [bits, want] of cases) expect(canonicalize(fromBits(bits)), bits).toBe(want);
  });

  it("NaN と無限は拒む（付録 B）", () => {
    expect(() => canonicalize(fromBits("7fffffffffffffff"))).toThrow(JcsError);
    expect(() => canonicalize(fromBits("7ff0000000000000"))).toThrow(JcsError);
  });

  it("対にならないサロゲートは拒む", () => {
    expect(() => canonicalize("\ud800")).toThrow(JcsError);
    expect(() => canonicalize({ a: "x\udc00" })).toThrow(JcsError);
  });

  it("入れ子の物と配列、空の物", () => {
    expect(canonicalize({ b: [1, { d: 2, c: null }], a: {} })).toBe('{"a":{},"b":[1,{"c":null,"d":2}]}');
  });
});

describe("厳しい読み手", () => {
  it("重複したキー・__proto__・BOM を数える", () => {
    const p = parseJsonStrict('\ufeff{"a":1,"a":2,"__proto__":{"x":1}}');
    expect(p.ok).toBe(true);
    expect(p.bom).toBe(true);
    expect(p.duplicateKeys).toBe(1);
    expect(p.protoKeys).toBe(1);
    // __proto__ は原型を変えない
    expect(Object.getPrototypeOf(p.value)).toBe(null);
  });

  it("途中で切れた文は truncated、文法の外れは syntaxError", () => {
    const full = '{"body":{"a":[1,2,3]},"sig":"00"}';
    for (let cut = 1; cut < full.length; cut++) {
      const p = parseJsonStrict(full.slice(0, cut));
      expect(p.ok, `cut ${cut}`).toBe(false);
      expect(p.truncated, `cut ${cut}`).toBe(true);
    }
    const bad = parseJsonStrict('{"a":1}}');
    expect(bad.ok).toBe(false);
    expect(bad.truncated).toBe(false);
    expect(bad.syntaxError).not.toBe(null);
  });

  it("すべての文字列（キーも値も）を道筋つきで返す", () => {
    const p = parseJsonStrict('{"a":{"b":["x","y"]},"c":"z"}');
    expect(p.strings).toEqual([
      { path: "a", isKey: true, value: "a" },
      { path: "a.b", isKey: true, value: "b" },
      { path: "a.b.0", isKey: false, value: "x" },
      { path: "a.b.1", isKey: false, value: "y" },
      { path: "c", isKey: true, value: "c" },
      { path: "c", isKey: false, value: "z" },
    ]);
  });
});
