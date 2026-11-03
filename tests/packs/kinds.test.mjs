// 2 段目の機器の種類（packs/_kinds/kinds.json）と、ごみ焼却の 1 段目への当てはめを確かめる。網に出ない。ファイルを読むだけ。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const readJson = (p) => JSON.parse(read(p));

const kindsDoc = readJson("packs/_kinds/kinds.json");
const common = readJson("packs/waste-incineration/common.json");

// docs/plan.md §2.1 の分類コードの形
const CODE_RE = /^[A-Z]{2,4}(\.[A-Z0-9_]{2,16}){1,4}$/;
const STATES = new Set(["照合済", "未確認"]);
// 出典に書いてよいサイト（このセッションで読める公の機関）
const ALLOWED_HOSTS = new Set(["laws.e-gov.go.jp", "elaws.e-gov.go.jp", "www.e-gov.go.jp", "env.go.jp", "www.env.go.jp", "www.mhlw.go.jp", "www.mlit.go.jp"]);
const SOURCE_KEYS = ["title", "issuer", "url", "state", "checked"];

/**
 * docs/plan.md §2.1 の「20 種（…）」を、書かれた順に返す。
 * 書き方は「16 種の名前を・でつないだもの」「、と運営者の決定（…）で足した」「足した 4 種を・でつないだもの」。
 * 足した 4 種の「破砕・切断機」は名前の中に・を含むので、足した側は V1_ADDED_NAMES と照らす。
 */
function planKindNames() {
  const plan = read("docs/plan.md");
  const start = plan.indexOf("### 2.1 ");
  assert.ok(start >= 0, "docs/plan.md に §2.1 が無い");
  const end = plan.indexOf("\n### ", start + 1);
  const section = plan.slice(start, end < 0 ? undefined : end);
  const m = /20 種（([^、）]+)、と運営者の決定（[^）]*）で足した([^）]+)）/.exec(section);
  assert.ok(m, "§2.1 に「20 種（…、と…足した…）」が無い");
  assert.equal(m[2], V1_ADDED_NAMES.join("・"), "§2.1 の足した 4 種の書き方が kinds.json の順と合わない");
  return m[1].split("・");
}

/** common.json の項目（systems[].items[] と systems[].variants[].items[]）を、書かれた順に返す。 */
function commonItems(doc) {
  return doc.systems.flatMap((s) => [...(s.items ?? []), ...(s.variants ?? []).flatMap((v) => v.items ?? [])]);
}

const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

test("kinds.json の形と note", () => {
  assert.equal(kindsDoc.schema, "moyai.kinds/0");
  assert.ok(nonEmpty(kindsDoc.note), "note が空");
  assert.ok(Array.isArray(kindsDoc.kinds));
});

// v1 で足した 4 種（運営者の決定 2026-11-03）。§2.1 の 16 種のあとに、この順で並ぶ
const V1_ADDED_NAMES = ["炉", "集じん装置", "発電機", "破砕・切断機"];

test("種類は 20 で、名前が docs/plan.md §2.1 の 16 種のあとに、炉・集じん装置・発電機・破砕・切断機の順で一致する", () => {
  const planNames = planKindNames();
  assert.equal(planNames.length, 16, "§2.1 から読んだ種類が 16 でない");
  assert.equal(kindsDoc.kinds.length, 20);
  assert.deepEqual(
    kindsDoc.kinds.map((k) => k.name),
    [...planNames, ...V1_ADDED_NAMES],
  );
});

test("コードは一意で、§2.1 の形に合い、KD. で始まる", () => {
  const codes = kindsDoc.kinds.map((k) => k.code);
  assert.equal(new Set(codes).size, codes.length, "コードが重なる");
  for (const c of codes) {
    assert.ok(typeof c === "string" && c.startsWith("KD."), `KD. で始まらない: ${c}`);
    assert.match(c, CODE_RE);
  }
});

test("根拠は公の出典か ownReason のどちらか一方だけ", () => {
  for (const k of kindsDoc.kinds) {
    const b = k.basis;
    assert.ok(b && typeof b === "object", `${k.code}: basis が無い`);
    const hasSource = SOURCE_KEYS.some((key) => key in b);
    const hasOwn = "ownReason" in b;
    assert.ok(hasSource !== hasOwn, `${k.code}: 出典と ownReason の両方があるか、どちらも無い`);
    if (hasOwn) {
      assert.equal(b.type, "own", `${k.code}: ownReason なら type は own`);
      assert.ok(nonEmpty(b.ownReason), `${k.code}: ownReason が空`);
      assert.ok(!/[\r\n]/.test(b.ownReason), `${k.code}: ownReason が 1 行でない`);
      continue;
    }
    assert.equal(b.type, "source", `${k.code}: 出典なら type は source`);
    for (const key of ["title", "issuer", "url"]) assert.ok(nonEmpty(b[key]), `${k.code}: ${key} が無い`);
    assert.ok(STATES.has(b.state), `${k.code}: state が照合済か未確認でない: ${b.state}`);
    if (b.state === "照合済") {
      assert.ok(b.checked && typeof b.checked === "object", `${k.code}: 照合済なのに checked が無い`);
      assert.ok(nonEmpty(b.checked.what), `${k.code}: checked.what が空`);
      assert.match(b.checked.on ?? "", /^\d{4}-\d{2}-\d{2}$/, `${k.code}: checked.on が日付でない`);
      const u = new URL(b.url);
      assert.equal(u.protocol, "https:", `${k.code}: url が https でない`);
      assert.ok(ALLOWED_HOSTS.has(u.hostname), `${k.code}: 照合済なのに読めないサイトの url: ${u.hostname}`);
    }
  }
});

test("common.json の 35 の項目のどれにも kind があり、null なら kindReason が空でない", () => {
  const items = commonItems(common);
  assert.equal(items.length, 35);
  for (const it of items) {
    assert.ok("kind" in it, `${it.code}: kind が無い`);
    if (it.kind === null) {
      assert.ok(nonEmpty(it.kindReason), `${it.code}: kind が null なのに kindReason が空`);
      assert.ok(!/[\r\n]/.test(it.kindReason), `${it.code}: kindReason が 1 行でない`);
    } else {
      assert.equal(typeof it.kind, "string", `${it.code}: kind がコードの文字列か null でない`);
    }
  }
});

test("common.json が使うコードは、どれも kinds.json にある", () => {
  const known = new Set(kindsDoc.kinds.map((k) => k.code));
  const used = commonItems(common)
    .map((it) => it.kind)
    .filter((c) => c !== null);
  assert.ok(used.length > 0, "当てたコードが 0 件");
  for (const c of used) assert.ok(known.has(c), `kinds.json に無いコード: ${c}`);
});
