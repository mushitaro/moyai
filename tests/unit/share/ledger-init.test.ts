// 公開の台帳の決まりを作って管理者の鍵で署名する（人だけのコマンド ledger init と、その芯 createLedger）。
// 書いた ledger.json は受け手と同じ関数（verify ledger）で ✓、秘密鍵は台帳に書かず状態フォルダに合言葉で包んで置く、端末でなければ断る。
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { initCli } from "../../../src/cli/ledger";
import { createLedger } from "../../../src/share/ledger-init";
import { readLedgerDir, verifyLedgerFiles } from "../../../src/share/ledger";
import { loadSharePack, resolvePacksDir } from "../../../src/share/pack";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
const loaded = loadSharePack(resolvePacksDir(), "waste-incineration");
if (!loaded.ok) throw new Error("パックを読めない");
const pack = loaded.pack;
const PASS = "架空の管理者の合言葉 です";

describe("createLedger", () => {
  it("決まりを書き、受け手と同じ関数で ✓。秘密鍵は台帳に無く、状態フォルダに包んで置く。足すだけ（2 度目は書かない）", async () => {
    const root = tmp("moyai-ledger-init-");
    const state = tmp("moyai-ledger-state-");
    const r = createLedger({ root, pack, passphrase: PASS, stateDir: state, month: "2026-11" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.fingerprint).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    const text = readFileSync(r.path, "utf8");
    expect(text).not.toMatch(/PRIVATE|privateKey/i);
    const dir = await readLedgerDir(root);
    if (!("files" in dir)) throw new Error("台帳を読めない");
    const v = verifyLedgerFiles(dir.files, pack);
    expect(v.ledger).toMatchObject({ status: "ok", reasons: [], id: r.ledgerId, founder: r.fingerprint });
    expect(v.ok).toBe(true);
    const keys = readdirSync(join(state, "keys"));
    expect(keys).toEqual([`${r.ledgerId}.json`]);
    expect(readFileSync(join(state, "keys", keys[0]!), "utf8")).not.toContain(PASS);
    expect(createLedger({ root, pack, passphrase: PASS, stateDir: state, month: "2026-11" })).toEqual({ ok: false, reason: "exists" });
  });

  it("短い合言葉・月の形の誤りは書かない", () => {
    const root = tmp("moyai-ledger-init-");
    const state = tmp("moyai-ledger-state-");
    expect(createLedger({ root, pack, passphrase: "短い", stateDir: state, month: "2026-11" })).toEqual({ ok: false, reason: "passphraseShort" });
    expect(createLedger({ root, pack, passphrase: PASS, stateDir: state, month: "2026-13" })).toEqual({ ok: false, reason: "monthInvalid" });
    expect(existsSync(join(root, "ledger"))).toBe(false);
  });
});

describe("ledger init（人だけのコマンド）", () => {
  it("端末でなければ断る（3）。合言葉が合わなければ書かない（1）。合えば書く（0）", async () => {
    const root = tmp("moyai-ledger-init-");
    const state = tmp("moyai-ledger-state-");
    expect(await initCli(["--root", root, "--pack", "waste-incineration"], { stdin: { isTTY: false }, stateDir: state })).toBe(3);
    const answers = (xs: string[]) => {
      let i = 0;
      return async () => xs[i++] ?? "";
    };
    const tty = { isTTY: true };
    expect(await initCli(["--root", root, "--pack", "waste-incineration"], { stdin: tty, ask: answers([PASS, "違う合言葉 です です"]), stateDir: state })).toBe(1);
    expect(existsSync(join(root, "ledger"))).toBe(false);
    const cancelAt = (n: number) => {
      let i = 0;
      return async () => (i++ < n ? PASS : null);
    };
    expect(await initCli(["--root", root, "--pack", "waste-incineration"], { stdin: tty, ask: cancelAt(0), stateDir: state })).toBe(130);
    expect(await initCli(["--root", root, "--pack", "waste-incineration"], { stdin: tty, ask: cancelAt(1), stateDir: state })).toBe(130);
    expect(existsSync(join(root, "ledger"))).toBe(false);
    expect(await initCli(["--root", "相対の道", "--pack", "waste-incineration"], { stdin: tty, ask: answers([PASS, PASS]), stateDir: state })).toBe(2);
    expect(await initCli(["--root", root, "--pack", "waste-incineration", "--month", "2026-11"], { stdin: tty, ask: answers([PASS, PASS]), stateDir: state })).toBe(0);
    expect(existsSync(join(root, "ledger", "ledger.json"))).toBe(true);
  });
});
