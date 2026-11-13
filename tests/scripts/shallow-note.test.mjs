// 履歴の浅い clone の案内（scripts/shallow-note.mjs。mushitaro/moyai#26）：浅いときだけ、取り方と一緒に知らせる。試験は飛ばさない
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { isShallow, shallowNote } from "../../scripts/shallow-note.mjs";

test("浅くない・分からないときは何も言わない。浅いときは、取り方を添えて知らせる", () => {
  assert.equal(shallowNote(false), null);
  assert.equal(shallowNote(null), null);
  assert.equal(shallowNote(false, true), null);
  for (const failed of [false, true]) {
    const s = shallowNote(true, failed);
    assert.match(s, /^run-tests: /);
    assert.match(s, /git fetch --unshallow origin && git fetch origin --tags/);
    assert.match(s, /凍結のタグと履歴/);
  }
  assert.match(shallowNote(true), /飛ばさずに走らせます/);
  assert.notEqual(shallowNote(true), shallowNote(true, true));
});

test("作業場所が浅い clone かを git に聞く：全部の clone は false、深さ 1 の clone は true、リポジトリでなければ null", () => {
  const tmp = mkdtempSync(join(tmpdir(), "moyai-shallow-"));
  try {
    const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" } });
    const full = join(tmp, "full");
    git(tmp, "init", "-q", "-b", "main", full);
    for (const n of ["a", "b"]) {
      writeFileSync(join(full, n), n);
      git(full, "add", "-A");
      git(full, "commit", "-q", "-m", n);
    }
    assert.equal(isShallow(full), false);
    const shallow = join(tmp, "shallow");
    git(tmp, "clone", "-q", "--depth", "1", pathToFileURL(full).href, shallow);
    assert.equal(isShallow(shallow), true);
    assert.equal(isShallow(tmp), null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("試験を走らせる道具は、案内を出すだけで、浅さで試験を飛ばさない", () => {
  const src = readFileSync("scripts/run-tests.mjs", "utf8");
  assert.match(src, /shallowNote\(shallow\)/);
  assert.match(src, /failed && shallowNote\(shallow, true\)/);
  // 浅さを見る行は、読み込み・聞く行・知らせる 2 行だけ（走らせる試験のファイルや終了コードを、浅さで変えない）
  const lines = src.split("\n").filter((l) => /shallow/i.test(l) && !l.trim().startsWith("//"));
  const allowed = [/^import \{ isShallow, shallowNote \} from "\.\/shallow-note\.mjs";$/, /^const shallow = isShallow\(\);$/, /^if \(shallowNote\(shallow\)\) console\.error\(shallowNote\(shallow\)\);$/, /^if \(failed && shallowNote\(shallow, true\)\) console\.error\(shallowNote\(shallow, true\)\);$/];
  assert.equal(lines.length, allowed.length);
  for (const l of lines) assert.ok(allowed.some((re) => re.test(l.trim())), l);
});
