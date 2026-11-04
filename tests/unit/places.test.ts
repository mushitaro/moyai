// 置き場所（docs/plan.md §2.12「Documents の調べ方」）：Documents を UTF-8 で受け、OneDrive・SharePoint の下かを調べる。
// windows-latest と同じく、Documents の場所を日本語の OneDrive の道に書き換えて試す。輪のフォルダは rings.json に書き、見張りのフックが読める形にする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addRing, defaultRoot, detectDocuments, parseShellOutput, readRings, readSettings, syncedOf, syncRootsOf, validRoot, writeSettings } from "../../src/bridge/places";
import { baseRules } from "../../src/share/rules";
// @ts-expect-error 見張りのフックは型の無い .mjs
import { ringFolders } from "../../scripts/guard-hook.mjs";

const DOCS = "C:\\Users\\利用者\\OneDrive\\ドキュメント";
const ENV = { OneDrive: "C:\\Users\\利用者\\OneDrive", OneDriveConsumer: "C:\\Users\\利用者\\OneDrive" };

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("Documents と同期フォルダ", () => {
  it("PowerShell の UTF-8 の出力から、日本語の Documents の道を化けずに読む", () => {
    const out = Buffer.from(`\uFEFF${JSON.stringify({ documents: DOCS, mounts: "C:\\Users\\利用者\\OneDrive" })}\r\n`, "utf8");
    expect(parseShellOutput(out)).toEqual({ documents: DOCS, mounts: ["C:\\Users\\利用者\\OneDrive"] });
    expect(parseShellOutput("not json")).toEqual({ documents: null, mounts: [] });
  });

  it("Documents が OneDrive の下にあれば、そう知らせる（既定の置き場所は Documents の下の MOYAI）", async () => {
    const info = await detectDocuments({ platform: "win32", env: ENV, shell: async () => ({ documents: DOCS, mounts: [] }) });
    expect(info.documents).toBe(DOCS);
    expect(info.synced).toEqual({ kind: "onedrive", base: ENV.OneDrive });
    expect(defaultRoot(info)).toMatch(/ドキュメント[\\/]MOYAI$/);
  });

  it("大文字と小文字・区切りの違いでも下と見る。同期の外なら null", async () => {
    const info = await detectDocuments({ platform: "win32", env: { OneDrive: "c:/users/利用者/onedrive/" }, shell: async () => ({ documents: DOCS, mounts: [] }) });
    expect(info.synced?.kind).toBe("onedrive");
    const local = await detectDocuments({ platform: "win32", env: ENV, shell: async () => ({ documents: "D:\\書類", mounts: [] }) });
    expect(local.synced).toBeNull();
  });

  it("OneDrive が同期する SharePoint のライブラリの下も、同期フォルダと見る", () => {
    const roots = syncRootsOf(ENV, ["C:\\Users\\利用者\\OneDrive", "C:\\Users\\利用者\\架空の会社\\保全 - 共有"]);
    expect(roots.map((r) => r.kind)).toEqual(["onedrive", "sharepoint"]);
    expect(syncedOf("C:\\Users\\利用者\\架空の会社\\保全 - 共有\\輪", roots, "win32")?.kind).toBe("sharepoint");
    expect(syncedOf("D:\\輪", roots, "win32")).toBeNull();
  });

  it("調べられなければ null（推測で埋めない）", async () => {
    const info = await detectDocuments({ platform: "win32", env: ENV, shell: async () => ({ documents: null, mounts: [] }) });
    expect(info.documents).toBeNull();
    expect(defaultRoot(info)).toBeNull();
  });
});

describe("状態フォルダの設定", () => {
  it("置き場所は絶対の道だけ。既定に戻すと null", () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-places-"));
    expect(validRoot("relative/path")).toBeNull();
    expect(validRoot("")).toBeNull();
    const abs = join(dir, "置き場所");
    writeSettings(dir, { v: 1, root: validRoot(abs), ledger: null, name: null });
    expect(readSettings(dir).root).toBe(abs);
    writeSettings(dir, { v: 1, root: null, ledger: validRoot(abs), name: "【架空】山田" });
    expect(readSettings(dir)).toEqual({ v: 1, root: null, ledger: abs, name: "【架空】山田" });
    // 呼び名の形に合わないものは読まない
    writeSettings(dir, { v: 1, root: null, ledger: null, name: "山田/課長" });
    expect(readSettings(dir).name).toBeNull();
  });

  it("輪のフォルダは rings.json の folders に入り、見張りのフック（ringFolders）がそのまま読む", () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-places-"));
    const ringRoot = join(dir, "輪のフォルダ");
    addRing(dir, { ringId: "0123456789abcdef", root: ringRoot, pack: "waste-incineration", key: "fedcba9876543210", acceptedRulesHash: "0".repeat(64), acceptedRules: baseRules("waste-incineration", "0".repeat(64), "0".repeat(64)), createdAt: "2026-11-03T00:00:00.000Z" });
    addRing(dir, { ringId: "1123456789abcdef", root: ringRoot, pack: "waste-incineration", key: "eedcba9876543210", acceptedRulesHash: "0".repeat(64), acceptedRules: baseRules("waste-incineration", "0".repeat(64), "0".repeat(64)), createdAt: "2026-11-03T00:00:00.000Z" });
    expect(readRings(dir).folders).toEqual([ringRoot]);
    expect(readRings(dir).rings).toHaveLength(2);
    expect(ringFolders({ MOYAI_STATE_DIR: dir })).toEqual([ringRoot]);
  });
});
