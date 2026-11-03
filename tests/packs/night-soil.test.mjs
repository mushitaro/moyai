// し尿処理のパック（packs/night-soil/）の 1 段目の項目と、2 段目の種類への当てはめを確かめる。網に出ない。ファイルを読むだけ。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

const common = readJson("packs/night-soil/common.json");
const sourcesDoc = readJson("packs/night-soil/sources.json");
const kindsDoc = readJson("packs/_kinds/kinds.json");

// docs/plan.md §2.1 の分類コードの形
const CODE_RE = /^[A-Z]{2,4}(\.[A-Z0-9_]{2,16}){1,4}$/;
const VERIFICATION = new Set(["原典照合済", "未確認"]);
// 出典に書いてよいサイト（このパックを照らしたサンドボックスで読める公の機関）
const ALLOWED_HOSTS = new Set(["www.env.go.jp", "env.go.jp"]);
const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2", ".xlsx", ".xls", ".zip"]);

const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const oneLine = (v) => nonEmpty(v) && !/[\r\n]/.test(v);
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

/** common.json の項目（systems[].items[] と systems[].variants[].items[]）を、書かれた順に返す。 */
function commonItems(doc) {
  return doc.systems.flatMap((s) => [...(s.items ?? []), ...(s.variants ?? []).flatMap((v) => v.items ?? [])]);
}

/** dir の下のテキストのファイルを返す。dir が無ければ空。 */
function* textFiles(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* textFiles(p);
    else if (e.isFile() && !BINARY_EXT.has(extname(e.name).toLowerCase())) yield p;
  }
}

test("common.json の形：ごみ焼却の common.json と同じ欄があり、出典が sources.json にある", () => {
  assert.equal(common.schema, "moyai.common/0");
  assert.equal(common.pack, "night-soil");
  for (const key of ["source", "table", "verifiedBy", "verifiedAt"]) assert.ok(nonEmpty(common[key]), `${key} が空`);
  assert.ok(VERIFICATION.has(common.verification), `verification が原典照合済か未確認でない: ${common.verification}`);
  assert.match(common.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(common.page, { printed: 27, pdf: 35 });
  assert.ok(Array.isArray(common.systems) && common.systems.length > 0, "systems が空");
  const ids = sourcesDoc.sources.map((s) => s.id);
  assert.ok(ids.includes(common.source), `source が sources.json に無い: ${common.source}`);
});

test("コードは一意で、§2.1 の形に合い、NS. で始まる。項目のコードは設備のコードの下にある", () => {
  const codes = [];
  for (const s of common.systems) {
    assert.ok(nonEmpty(s.name), `${s.code}: 設備の名前が空`);
    codes.push(s.code);
    for (const it of [...(s.items ?? []), ...(s.variants ?? []).flatMap((v) => v.items ?? [])]) {
      assert.ok(it.code.startsWith(`${s.code}.`), `${it.code}: 設備 ${s.code} の下に無い`);
      assert.ok(nonEmpty(it.name), `${it.code}: 名前が空`);
      codes.push(it.code);
    }
  }
  assert.equal(new Set(codes).size, codes.length, "コードが重なる");
  for (const c of codes) {
    assert.ok(typeof c === "string" && c.startsWith("NS."), `NS. で始まらない: ${c}`);
    assert.match(c, CODE_RE);
  }
  assert.ok(commonItems(common).length > 0, "項目が 0 件");
});

test("どの項目にも kind があり、null なら kindReason が 1 行で空でない。kind があれば kindReason を持たない", () => {
  for (const it of commonItems(common)) {
    assert.ok("kind" in it, `${it.code}: kind が無い`);
    if (it.kind === null) {
      assert.ok(oneLine(it.kindReason), `${it.code}: kind が null なのに kindReason が 1 行の文でない`);
    } else {
      assert.equal(typeof it.kind, "string", `${it.code}: kind がコードの文字列か null でない`);
      assert.ok(!("kindReason" in it), `${it.code}: kind があるのに kindReason がある`);
    }
  }
});

test("使う kind は、どれも kinds.json の 20 種にある", () => {
  const known = new Set(kindsDoc.kinds.map((k) => k.code));
  assert.equal(known.size, 20);
  const used = commonItems(common)
    .map((it) => it.kind)
    .filter((c) => c !== null);
  assert.ok(used.length > 0, "当てた種類が 0 件");
  for (const c of used) assert.ok(known.has(c), `kinds.json に無いコード: ${c}`);
});

test("隠れた行と空の行の書き置きは、在る項目と設備を指す", () => {
  const itemCodes = commonItems(common).map((it) => it.code);
  const systemCodes = new Set(common.systems.map((s) => s.code));
  assert.ok(Array.isArray(common.hidden), "hidden が無い");
  for (const h of common.hidden) {
    const a = itemCodes.indexOf(h.after);
    const b = itemCodes.indexOf(h.before);
    assert.ok(a >= 0, `hidden.after が項目に無い: ${h.after}`);
    assert.ok(b >= 0, `hidden.before が項目に無い: ${h.before}`);
    assert.equal(b, a + 1, "hidden の前と後の項目が隣どうしでない");
    assert.ok(oneLine(h.how) && oneLine(h.note), "hidden の how か note が 1 行の文でない");
  }
  for (const e of common.emptyRows ?? []) {
    assert.ok(systemCodes.has(e.system), `emptyRows の設備が無い: ${e.system}`);
    assert.ok(Number.isInteger(e.count) && e.count > 0);
  }
});

test("sources.json の形：照らしていない欄は null で unverified にあり、URL は公の機関の https", () => {
  assert.equal(sourcesDoc.schema, "moyai.sources/0");
  assert.equal(sourcesDoc.pack, "night-soil");
  const ids = sourcesDoc.sources.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "出典の id が重なる");
  for (const s of sourcesDoc.sources) {
    for (const key of ["id", "name", "publisher", "url", "state"]) assert.ok(nonEmpty(s[key]), `${s.id}: ${key} が空`);
    const u = new URL(s.url);
    assert.equal(u.protocol, "https:", `${s.id}: url が https でない`);
    assert.ok(ALLOWED_HOSTS.has(u.hostname), `${s.id}: 読めないサイトの url: ${u.hostname}`);
    const unverified = new Set(s.unverified ?? []);
    for (const [key, value] of Object.entries(s)) {
      if (value === null) assert.ok(unverified.has(key), `${s.id}: ${key} が null なのに unverified に無い`);
    }
    for (const key of unverified) assert.ok(s[key] === null || s[key] === undefined, `${s.id}: ${key} が unverified なのに値がある`);
    if (s.sha256 !== null) assert.match(s.sha256, /^[0-9a-f]{64}$/, `${s.id}: sha256 の形でない`);
    if (s.retrieved !== null) assert.match(s.retrieved, /^\d{4}-\d{2}-\d{2}$/, `${s.id}: retrieved が日付でない`);
    if (s.state === "原典照合済") {
      assert.ok(Array.isArray(s.checked) && s.checked.length > 0, `${s.id}: 原典照合済なのに checked が空`);
      for (const c of s.checked) {
        assert.ok(nonEmpty(c.what) && nonEmpty(c.by), `${s.id}: checked の what か by が空`);
        assert.match(c.on ?? "", /^\d{4}-\d{2}-\d{2}$/, `${s.id}: checked.on が日付でない`);
      }
    }
  }
});

test("全国の表の数は、内で辻褄が合う", () => {
  const nat = sourcesDoc.sources.find((s) => s.url.endsWith("/facility/08.xlsx"));
  assert.ok(nat, "08.xlsx の出典が無い");
  const c = nat.counted;
  assert.ok(c && typeof c === "object", "counted が無い");
  assert.equal(c.headerRows.count, c.headerRows.to - c.headerRows.from + 1);
  assert.equal(c.dataRows.count, c.dataRows.to - c.dataRows.from + 1);
  assert.equal(c.dataRows.from, c.headerRows.to + 1, "見出しの次の行から施設の行が始まらない");
  for (const name of ["汚水処理", "汚泥処理", "ごみ処理事業実施方式", "運転管理体制", "施設の改廃"]) {
    const col = c.columns[name];
    assert.ok(col, `列が無い: ${name}`);
    assert.match(col.column, /^[A-Z]{1,2}$/, `${name}: 列の字の形でない`);
    assert.ok(col.emptyRows >= 0 && col.emptyRows <= c.dataRows.count);
    assert.ok(col.multiValueRows >= 0 && col.multiValueRows <= c.dataRows.count);
  }
  assert.equal(sum(c.status), c.dataRows.count, "施設の改廃の数の和が施設の行の数と合わない");
  assert.equal(c.status["空"], c.columns["施設の改廃"].emptyRows);
  assert.equal(c.operating, c.status["空"], "稼働の数が施設の改廃が空の数と合わない");
  const ov = c.operatingValues;
  assert.equal(sum(ov["ごみ処理事業実施方式"]), c.operating);
  assert.equal(sum(ov["運転管理体制"]), c.operating);
  // 1 行が複数の値に入るので、値の和は稼働の数より多いか同じ
  assert.ok(sum(ov["汚水処理"]) >= c.operating);
  assert.ok(sum(ov["汚泥処理"]) >= c.operating);
});

test("このパックの語（設備と項目の名前）が src/ に 1 つも出ない（src/ が無ければ空として通る）", () => {
  const words = [...new Set([...common.systems.map((s) => s.name), ...commonItems(common).map((it) => it.name)])];
  assert.ok(words.length > 0, "語が 0 件");
  const hits = [];
  for (const f of textFiles(join(root, "src"))) {
    const text = readFileSync(f, "utf8");
    for (const w of words) if (text.includes(w)) hits.push(`${f.slice(root.length)}: ${w}`);
  }
  assert.deepEqual(hits, []);
});
