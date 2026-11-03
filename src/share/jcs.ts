// RFC 8785（JSON Canonicalization Scheme）の正規化と、厳しい JSON の読み手。どちらも自作。
// 正規化：キーを UTF-16 の符号の単位の順に並べ、空白を入れず、文字列は決まった逃がし方、数は ECMAScript の数の文字の形。
// 読み手：キーの重複・__proto__・BOM・途中で切れた文を見分けて数える（JSON.parse は重複を黙って後ろで上書きするため）。

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class JcsError extends Error {}

const HEX = "0123456789abcdef";

/** 文字列を RFC 8785 §3.2.2.2 の形にする。対にならないサロゲートは I-JSON の外なので拒む。 */
export function canonicalString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d < 0xdc00 || d > 0xdfff) throw new JcsError("対にならないサロゲート");
      out += s[i]! + s[i + 1]!;
      i++;
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) throw new JcsError("対にならないサロゲート");
    switch (c) {
      case 0x08:
        out += "\\b";
        break;
      case 0x09:
        out += "\\t";
        break;
      case 0x0a:
        out += "\\n";
        break;
      case 0x0c:
        out += "\\f";
        break;
      case 0x0d:
        out += "\\r";
        break;
      case 0x22:
        out += '\\"';
        break;
      case 0x5c:
        out += "\\\\";
        break;
      default:
        if (c < 0x20) out += "\\u00" + HEX[c >> 4]! + HEX[c & 15]!;
        else out += s[i]!;
    }
  }
  return out + '"';
}

/** 数を RFC 8785 §3.2.2.3 の形にする（ECMAScript の Number の文字の形。-0 は 0）。NaN と無限は拒む。 */
export function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) throw new JcsError("NaN と無限は JSON にできない");
  if (n === 0) return "0";
  return String(n);
}

/** UTF-16 の符号の単位で比べる（RFC 8785 §3.2.3）。 */
function compareUtf16(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** 値を RFC 8785 の文字列にする。 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return canonicalString(value);
  if (Array.isArray(value)) return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    keys.sort(compareUtf16);
    return "{" + keys.map((k) => canonicalString(k) + ":" + canonicalize(obj[k])).join(",") + "}";
  }
  throw new JcsError(`JSON にできない値の型: ${typeof value}`);
}

// ─── 厳しい読み手 ─────────────────────────────────────────

/** 読んだ文字列の 1 つ。path は "body.chunks.0.class" の形。キーなら isKey が true。 */
export interface JsonString {
  path: string;
  isKey: boolean;
  value: string;
}

export interface StrictParse {
  /** 読めたか。false なら value は null */
  ok: boolean;
  value: Json;
  /** 途中で切れていた（最後まで読んで閉じていない）。届きかけの見分けに使う */
  truncated: boolean;
  /** 文法の外れ（途中で切れたのではない） */
  syntaxError: string | null;
  bom: boolean;
  duplicateKeys: number;
  protoKeys: number;
  /** 対にならないサロゲートの逃がし */
  loneSurrogates: number;
  /** すべての文字列（キーも値も）。読めたところまで */
  strings: JsonString[];
}

class Truncated extends Error {}
class Syntax extends Error {}

/** JSON を厳しく読む。重複したキーは数え、値は最初のものを残す（どちらを残しても形の外れになる）。 */
export function parseJsonStrict(text: string): StrictParse {
  const res: StrictParse = {
    ok: false,
    value: null,
    truncated: false,
    syntaxError: null,
    bom: false,
    duplicateKeys: 0,
    protoKeys: 0,
    loneSurrogates: 0,
    strings: [],
  };
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) {
    res.bom = true;
    i = 1;
  }
  const n = text.length;
  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  };
  const need = () => {
    if (i >= n) throw new Truncated();
  };
  const readString = (): string => {
    // text[i] は '"'
    i++;
    let out = "";
    for (;;) {
      need();
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i++;
        break;
      }
      if (c < 0x20) throw new Syntax("文字列の中の制御文字");
      if (c === 0x5c) {
        i++;
        need();
        const e = text[i]!;
        i++;
        switch (e) {
          case '"':
            out += '"';
            break;
          case "\\":
            out += "\\";
            break;
          case "/":
            out += "/";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "u": {
            if (i + 4 > n) throw new Truncated();
            const h = text.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) throw new Syntax("\\u の後ろが 16 進の 4 文字でない");
            out += String.fromCharCode(parseInt(h, 16));
            i += 4;
            break;
          }
          default:
            throw new Syntax("知らない逃がし");
        }
        continue;
      }
      out += text[i]!;
      i++;
    }
    // 対にならないサロゲートを数える
    for (let j = 0; j < out.length; j++) {
      const c = out.charCodeAt(j);
      if (c >= 0xd800 && c <= 0xdbff) {
        const d = out.charCodeAt(j + 1);
        if (d >= 0xdc00 && d <= 0xdfff) j++;
        else res.loneSurrogates++;
      } else if (c >= 0xdc00 && c <= 0xdfff) res.loneSurrogates++;
    }
    return out;
  };
  const readNumber = (): number => {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (!m) {
      if (i + 1 >= n) throw new Truncated();
      throw new Syntax("数の形でない");
    }
    i += m[0].length;
    const v = Number(m[0]);
    if (!Number.isFinite(v)) throw new Syntax("大きすぎる数");
    return v;
  };
  const readLiteral = (word: string, v: Json): Json => {
    const part = text.slice(i, i + word.length);
    if (part === word) {
      i += word.length;
      return v;
    }
    if (word.startsWith(part) && i + part.length >= n) throw new Truncated();
    throw new Syntax("知らない語");
  };
  const readValue = (path: string, depth: number): Json => {
    if (depth > 64) throw new Syntax("深すぎる");
    ws();
    need();
    const c = text[i]!;
    if (c === "{") {
      i++;
      const obj: Record<string, Json> = Object.create(null) as Record<string, Json>;
      ws();
      need();
      if (text[i] === "}") {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        need();
        if (text[i] !== '"') throw new Syntax("キーが文字列でない");
        const key = readString();
        res.strings.push({ path: path === "" ? key : `${path}.${key}`, isKey: true, value: key });
        if (key === "__proto__" || key === "constructor" || key === "prototype") res.protoKeys++;
        ws();
        need();
        if (text[i] !== ":") throw new Syntax("「:」が無い");
        i++;
        const v = readValue(path === "" ? key : `${path}.${key}`, depth + 1);
        if (Object.prototype.hasOwnProperty.call(obj, key)) res.duplicateKeys++;
        else obj[key] = v;
        ws();
        need();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          break;
        }
        throw new Syntax("「,」か「}」が無い");
      }
      // 原型の無い物のまま返す（__proto__ のキーが原型を変えないように）
      return obj;
    }
    if (c === "[") {
      i++;
      const arr: Json[] = [];
      ws();
      need();
      if (text[i] === "]") {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(readValue(`${path}.${arr.length}`, depth + 1));
        ws();
        need();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          break;
        }
        throw new Syntax("「,」か「]」が無い");
      }
      return arr;
    }
    if (c === '"') {
      const s = readString();
      res.strings.push({ path, isKey: false, value: s });
      return s;
    }
    if (c === "t") return readLiteral("true", true);
    if (c === "f") return readLiteral("false", false);
    if (c === "n") return readLiteral("null", null);
    if (c === "-" || (c >= "0" && c <= "9")) return readNumber();
    throw new Syntax("値の始まりでない");
  };
  try {
    const v = readValue("", 0);
    ws();
    if (i < n) throw new Syntax("値の後ろに余分な文字");
    res.ok = true;
    res.value = v;
  } catch (e) {
    if (e instanceof Truncated) res.truncated = true;
    else if (e instanceof Syntax) res.syntaxError = e.message;
    else throw e;
  }
  return res;
}
