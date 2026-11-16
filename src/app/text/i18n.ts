// 画面の言葉の言語（英語と日本語）。英語の表を元にし、日本語の表は同じ形を型で強いる（足りない字・余る字は型の検査で落ちる）。
// - defineMessages(en, ja) は、今の言語の表を読む生きた表を返す。言語を変えると、次に読んだときから新しい言語の字になる。
//   入れ子の表も同じ（const S = TEXT.shell のように先に取っておいても、字を読むのが描くときなら新しい言語になる）。
// - 画面は useLang()（use-lang.ts。subscribeLang の購読）で描き直る。読み込み直しは要らない。
// - 言語の選び方：設定に言語があればそれ、無ければ navigator.languages[0] が ja で始まれば日本語、それ以外は英語。
// 画面の外（橋渡しの Excel の出力・公開の台帳のページ）からも読めるよう、ブラウザの物（window・navigator・localStorage）は有るときだけ触る。

export type Lang = "en" | "ja";
export const LANGS: readonly Lang[] = ["en", "ja"];

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "ja";
}

/** PC の言語から選ぶ：最初の言語が ja で始まれば日本語、それ以外（無いときも）英語 */
export function langOfNavigator(languages: readonly string[] | undefined): Lang {
  const first = languages?.[0];
  return typeof first === "string" && first.toLowerCase().startsWith("ja") ? "ja" : "en";
}

const CACHE_KEY = "moyai.lang";

function readCache(): Lang | null {
  try {
    const v = globalThis.localStorage?.getItem(CACHE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

function writeCache(l: Lang | null): void {
  try {
    if (l === null) globalThis.localStorage?.removeItem(CACHE_KEY);
    else globalThis.localStorage?.setItem(CACHE_KEY, l);
  } catch {
    // 覚えられなくても、今の言語は変わる
  }
}

function initial(): Lang {
  const g = globalThis as { navigator?: { languages?: readonly string[]; language?: string }; document?: unknown };
  const nav = g.navigator;
  // 画面の外（node。node 22 にも navigator はあるので document で分ける）では日本語（今までの出力のまま）。ブラウザでは、前に選んだ言語（設定の写し）→ PC の言語
  if (!nav || g.document === undefined) return "ja";
  return readCache() ?? langOfNavigator(nav.languages?.length ? nav.languages : nav.language ? [nav.language] : undefined);
}

let current: Lang = initial();
{
  const doc = (globalThis as { document?: { documentElement?: { lang: string } } }).document;
  if (doc?.documentElement) doc.documentElement.lang = current;
}
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

/** 今の言語を変える。画面（useLang の購読）は描き直る。remember は、この PC のブラウザに覚えるか（設定の写し） */
export function setLang(l: Lang, opts: { remember?: boolean } = {}): void {
  if (opts.remember !== false) writeCache(l);
  if (l === current) return;
  current = l;
  const doc = (globalThis as { document?: { documentElement?: { lang: string } } }).document;
  if (doc?.documentElement) doc.documentElement.lang = l;
  for (const fn of listeners) fn();
}

/** 設定に言語が無い（PC の言語に従う）ときの言語に戻す */
export function resetLang(): void {
  writeCache(null);
  const nav = (globalThis as { navigator?: { languages?: readonly string[] } }).navigator;
  setLang(nav ? langOfNavigator(nav.languages) : "ja", { remember: false });
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 英語の表の形：字は string、関数は同じ引数と戻り、入れ子の表と組は同じ鍵。
 * 日本語の表はこの形でなければならない（足りない鍵・余る鍵・引数の違いは型の検査で落ちる）。
 */
export type Messages<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R extends string ? string : R
    : T extends readonly unknown[]
      ? { [K in keyof T]: Messages<T[K]> }
      : T extends object
        ? { [K in keyof T]: Messages<T[K]> }
        : T;

type Node = Record<PropertyKey, unknown>;

const isTable = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);

/** 生きた表：今の言語の同じ道の値を返す。入れ子の表は道ごとに 1 つだけ作る（同じものを返す） */
function live<T extends object>(tables: Record<Lang, unknown>, path: readonly PropertyKey[], cache: Map<string, object>): T {
  const key = path.map(String).join("\u0000");
  const hit = cache.get(key);
  if (hit) return hit as T;
  const at = (l: Lang): Node => {
    let n: unknown = tables[l];
    for (const p of path) n = (n as Node)[p];
    return n as Node;
  };
  const proxy = new Proxy(at("en"), {
    get(_t, p) {
      const v = at(current)[p];
      return isTable(v) ? live(tables, [...path, p], cache) : v;
    },
    has: (_t, p) => p in at(current),
    ownKeys: () => Reflect.ownKeys(at(current)),
    getOwnPropertyDescriptor(_t, p) {
      const d = Reflect.getOwnPropertyDescriptor(at(current), p);
      return d ? { ...d, configurable: true } : undefined;
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
  cache.set(key, proxy);
  return proxy as T;
}

/**
 * 言葉の表を作る。en が元（型はここから）、ja は同じ形。返すのは今の言語の表を読む生きた表。
 * 形をそろえる：鍵・入れ子・関数（引数の数）が en と ja で同じかは、型に加えて sameShape でも確かめられる（試験）。
 */
export function defineMessages<T extends object>(en: T, ja: Messages<NoInfer<T>>): T {
  const tables = { en, ja } as Record<Lang, unknown>;
  REGISTERED.push({ en, ja });
  return live<T>(tables, [], new Map());
}

/** その言語の表を、ふつうの表に写して返す（画面の外で、言語を決めて書くとき。Excel の出力など。関数はそのまま） */
export function messagesIn<T extends object>(table: T, lang: Lang): T {
  return withLang(lang, () => snapshot(table)) as T;
}

function snapshot(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(snapshot);
  if (!isTable(v)) return v;
  const o: Node = {};
  for (const k of Reflect.ownKeys(v)) o[k] = snapshot((v as Node)[k]);
  return o;
}

/** 言語を一時だけ変えて fn を走らせる（画面には知らせない。橋渡しの出力が、その出力の言語で字を作るため） */
export function withLang<R>(lang: Lang, fn: () => R): R {
  const prev = current;
  current = lang;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

/** 登録した表（試験が、どの表も英語と日本語の形がそろうかを見る） */
export const REGISTERED: { en: unknown; ja: unknown }[] = [];

/**
 * 2 つの表の形が同じか。違う所の道を返す（空ならそろっている）。
 * 鍵・入れ子・組の長さ・字か関数か・関数の引数の数を比べる。
 */
export function shapeDiff(a: unknown, b: unknown, path = ""): string[] {
  const kind = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
  if (kind(a) !== kind(b)) return [`${path || "."}: ${kind(a)} ≠ ${kind(b)}`];
  if (typeof a === "function") return (a as (...x: unknown[]) => unknown).length === (b as (...x: unknown[]) => unknown).length ? [] : [`${path}: 引数 ${(a as () => unknown).length} ≠ ${(b as () => unknown).length}`];
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return [`${path}: 長さ ${a.length} ≠ ${bb.length}`];
    return a.flatMap((x, i) => shapeDiff(x, bb[i], `${path}[${i}]`));
  }
  if (isTable(a)) {
    const bb = b as Node;
    const ka = Object.keys(a);
    const kb = Object.keys(bb);
    const out: string[] = [];
    for (const k of ka) if (!(k in bb)) out.push(`${path}.${k}: 英語だけ`);
    for (const k of kb) if (!(k in a)) out.push(`${path}.${k}: 日本語だけ`);
    for (const k of ka) if (k in bb) out.push(...shapeDiff(a[k], bb[k], `${path}.${k}`));
    return out;
  }
  return [];
}
