import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { checkPublish, zipTextEntries } from "../../scripts/check-publish.mjs";

/** 試験のための最小の zip（1 項目、deflate）。 */
function makeZip(name, text) {
  const data = deflateRawSync(Buffer.from(text, "utf8"));
  const n = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const cdStart = local.length + n.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + n.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([local, n, data, central, n, eocd]);
}

function withTree(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "moyai-cp-"));
  try {
    for (const [p, body] of Object.entries(files)) {
      const abs = join(root, p);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, body);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("前の製品の名前が src に出たら当たる", () => {
  withTree({ "src/a.ts": "// from Maximo\n" }, (root) => {
    assert.equal(checkPublish(root).hits.length, 1);
  });
});

test("xlsx の中の XML に出たら当たる", () => {
  withTree({ "samples/x.xlsx": makeZip("xl/sharedStrings.xml", "<t>HOSHUTARO</t>") }, (root) => {
    const { hits } = checkPublish(root);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].where, "xl/sharedStrings.xml");
  });
});

test("README と docs は見ない（名指しのため）", () => {
  withTree({ "README.md": "MX Stage", "docs/plan.md": "mxstage", "src/ok.ts": "export {}" }, (root) => {
    const r = checkPublish(root);
    assert.equal(r.hits.length, 0);
    assert.equal(r.files, 1);
  });
});

test("zip の読み手は中身を取り出せる", () => {
  const entries = zipTextEntries(makeZip("a.xml", "<x>あ</x>"));
  assert.deepEqual(entries, [{ name: "a.xml", text: "<x>あ</x>" }]);
});
