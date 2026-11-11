// 資料の名前を、名前の一部で引く（mushitaro/moyai#57。Claude が「発注台帳の R6 の分」のような言い方から資料を引き当てる）。
// 比べ方：全角・半角（NFKC）・大文字小文字をそろえ、空白で区切った語がどれも名前に入っていれば当たり。推し量って選ばない（当たりが 2 つ以上なら候補を返す）。

/** 比べるためにそろえた名前（NFKC・小文字・空白を除く） */
export function normName(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/** 名前の一部（空白で区切った語）がどれも入っている資料の名前（並びは元のまま） */
export function matchFiles(query: string, names: readonly string[]): string[] {
  const words = query
    .normalize("NFKC")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "");
  if (!words.length) return [];
  return names.filter((n) => {
    const x = normName(n);
    return words.every((w) => x.includes(w));
  });
}

/** 長い名前は頭と尾だけ（max 字。サロゲートの組も 1 字と数える） */
export function shortName(name: string, max = 32): string {
  const cs = [...name];
  if (cs.length <= max) return name;
  const head = Math.ceil((max - 1) * 0.6);
  return `${cs.slice(0, head).join("")}…${cs.slice(cs.length - (max - 1 - head)).join("")}`;
}

/** 資料の種類（拡張子）ごとの数と、最初の数本の名前（短くした名前）。多い種類から */
export function fileKinds(names: readonly string[], perKind = 3): { kind: string; count: number; names: string[] }[] {
  const by = new Map<string, string[]>();
  for (const n of names) {
    const base = n.split("/").pop() ?? n;
    const dot = base.lastIndexOf(".");
    const kind = dot > 0 ? base.slice(dot).toLowerCase() : "";
    const xs = by.get(kind) ?? [];
    xs.push(n);
    by.set(kind, xs);
  }
  return [...by.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([kind, xs]) => ({ kind, count: xs.length, names: xs.slice(0, perKind).map((n) => shortName(n)) }));
}
