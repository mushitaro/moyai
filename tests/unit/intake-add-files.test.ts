// intake_add_files（資料を作業画面に入れる）：送り手（中継 → 橋渡し）と受け手（作業画面のタブ）の契約。
// - 橋渡し：道を確かめて資料を選ぶ（直下の 6 種類だけ・200 個まで・1 つ 64 MB まで・`..`・シンボリックリンク・状態フォルダとリポジトリの中は断る）。
// - 作業画面：資料ごとのワンタイムトークンで中身を取りに来て（タブの秘密とその回）、人が落とした資料と同じ道で取り込む。
// - AI に返すのは名前・大きさ・件数・断った理由だけ（セルの値・文字は返さない。安全の決まり 3）。
// どれも一時のフォルダで行う。デモの資料はリポジトリの packs/waste-incineration/demo/。
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { addFilesFromBridge, connectTabTools } from "../../src/app/intake/tab-tools";
import { IntakeWorkspace, MAX_FILE_BYTES } from "../../src/app/intake/workspace";
import { BridgeClient } from "../../src/app/bridge-client";
import { checkFolder, checkTemplateFile, collectIntake, demoPacks, pickFiles, readIntakeFile, skillPacks, skillPacksText, type IntakeCollection } from "../../src/bridge/intake-files";
import { resolvePacksDir } from "../../src/share/pack";
import { createRelayServer } from "../../src/cli/relay";
import { ERRORS, errorBody } from "../../src/shared/errors";
import { encodeEvent } from "../../src/shared/events";
import { HEADER_TAB_SECRET, ROUTES } from "../../src/shared/routes";
import { INTAKE_ADD_MAX_BYTES, INTAKE_ADD_MAX_FILES, INTAKE_FACILITY_NAME_MAX, TOOLS, intakeAddFilesToTabSchema, intakeFacilityNameOk } from "../../src/shared/tools";
import { packChoices } from "../../src/app/chart/catalog";
import { TEXT } from "../../src/app/text";
import { FakeTab, SECRET_A, startTestBridge, type TestBridge } from "../helpers/bridge";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const PACKS = resolvePacksDir();
const REPO = dirname(PACKS);
const DEMO = join(PACKS, "waste-incineration", "demo");
const DEMO_FILES = ["daily-report.csv", "equipment-ledger.xlsx", "plan-hoshitori.xlsx"];
/** 資料の中のセルの値（AI の結果に入ってはいけない） */
const CELL_VALUES = ["【架空】", "通風補機", "日報システム"];

function temp(prefix = "moyai-add-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

/** 中身を書かずに大きさだけのファイル（疎なファイル） */
function sized(path: string, bytes: number): void {
  const fd = openSync(path, "w");
  ftruncateSync(fd, bytes);
  closeSync(fd);
}

const env = (stateDir: string | null) => ({ packsDir: PACKS, stateDir, repoRoot: REPO });

/**
 * シンボリックリンクを作る。Windows のフォルダは junction（権限が要らない。lstat ではリンクに見える）。
 * Windows でファイルのリンクを作る権限が無ければ false（その確かめは飛ばしたと出す）
 */
function link(target: string, path: string, dir = false): boolean {
  try {
    symlinkSync(target, path, dir ? (process.platform === "win32" ? "junction" : "dir") : "file");
    return true;
  } catch (e) {
    if (process.platform === "win32" && (e as NodeJS.ErrnoException).code === "EPERM") {
      console.log(`シンボリックリンクを作る権限が無いので、${path} のリンクの確かめは飛ばした`);
      return false;
    }
    throw e;
  }
}

describe("橋渡し：道を確かめて資料を選ぶ", () => {
  it("直下の .xlsx・.xls・.csv・.pdf・.jpg・.png だけを名前の順に選ぶ。断った資料は名前と理由、ほかの種類と下のフォルダは数だけ", () => {
    const d = temp();
    const outside = temp("moyai-outside-");
    writeFileSync(join(outside, "secret.xlsx"), "外");
    for (const n of ["b.csv", "a.xlsx", "c.PDF", "d.jpg", "e.png", "f.xls"]) writeFileSync(join(d, n), "x");
    writeFileSync(join(d, "notes.txt"), "x");
    mkdirSync(join(d, "sub"));
    writeFileSync(join(d, "sub", "deep.xlsx"), "x");
    mkdirSync(join(d, "folder.xlsx"));
    const linked = link(join(outside, "secret.xlsx"), join(d, "link.xlsx"));
    sized(join(d, "big.xlsx"), INTAKE_ADD_MAX_BYTES + 1);
    sized(join(d, "edge.csv"), INTAKE_ADD_MAX_BYTES);
    const r = collectIntake({ source: "folder", path: d }, env(temp()));
    if (typeof r === "string") throw new Error(r);
    expect(r.files.map((f) => f.name)).toEqual(["a.xlsx", "b.csv", "c.PDF", "d.jpg", "e.png", "edge.csv", "f.xls"]);
    expect(r.refused).toEqual([
      { name: "big.xlsx", reason: "too_large" },
      { name: "folder.xlsx", reason: "not_file" },
      ...(linked ? [{ name: "link.xlsx", reason: "link" }] : []),
    ]);
    expect(r.refusedTotal).toBe(linked ? 3 : 2);
    // notes.txt と sub/ は名前を返さずに数える（下のフォルダの中は読まない）
    expect(r.others).toBe(2);
    expect(JSON.stringify(r)).not.toContain("notes.txt");
    expect(JSON.stringify(r)).not.toContain("deep.xlsx");
    expect(r).toMatchObject({ source: "folder", pack: null, facilityName: null });
  });

  it("200 個まで。201 個目からは over_count。並べる断りは 200 まで、数は全部数える", () => {
    const d = temp();
    for (let i = 0; i < INTAKE_ADD_MAX_FILES + 5; i++) writeFileSync(join(d, `r${String(i).padStart(3, "0")}.csv`), "x");
    const r = pickFiles(d);
    if (typeof r === "string") throw new Error(r);
    expect(r.files).toHaveLength(INTAKE_ADD_MAX_FILES);
    expect(r.files.at(-1)?.name).toBe("r199.csv");
    expect(r.refused.map((x) => x.reason)).toEqual(Array(5).fill("over_count"));
    const d2 = temp();
    for (let i = 0; i < 405; i++) writeFileSync(join(d2, `n${String(i).padStart(3, "0")}.csv`), "x");
    const r2 = pickFiles(d2);
    if (typeof r2 === "string") throw new Error(r2);
    expect(r2.files).toHaveLength(200);
    expect(r2.refused).toHaveLength(200);
    expect(r2.refusedTotal).toBe(205);
  });

  it("絶対の道でない・`..` を含む・装置の道・シンボリックリンクのフォルダ・状態フォルダとリポジトリの中は断る", () => {
    const state = temp("moyai-state-");
    const d = temp();
    mkdirSync(join(d, "x"));
    const e = env(state);
    expect(checkFolder("relative/folder", e)).toBe("intake_path_not_allowed");
    expect(checkFolder(`${d}/x/..`, e)).toBe("intake_path_not_allowed");
    expect(checkFolder(`${d}/x/../x`, e)).toBe("intake_path_not_allowed");
    expect(checkFolder("\\\\?\\C:\\data", e)).toBe("intake_path_not_allowed");
    expect(checkFolder("\\\\.\\PhysicalDrive0", e)).toBe("intake_path_not_allowed");
    // ネットワークの道（見るだけで SMB・WebDAV で外へつなぐ）とローカルの管理共有も受けない（Security の点検 11-08 の中5）
    expect(checkFolder("\\\\attacker.example\\s", e)).toBe("intake_path_not_allowed");
    expect(checkFolder("//attacker.example/s", e)).toBe("intake_path_not_allowed");
    expect(checkFolder("\\\\localhost\\C$\\Users", e)).toBe("intake_path_not_allowed");
    expect(checkTemplateFile("\\\\attacker.example\\s\\様式.xlsx", e)).toBe("intake_path_not_allowed");
    expect(checkFolder("", e)).toBe("intake_path_not_allowed");
    // 状態フォルダとその下
    mkdirSync(join(state, "inner"));
    expect(checkFolder(state, e)).toBe("intake_path_not_allowed");
    expect(checkFolder(join(state, "inner"), e)).toBe("intake_path_not_allowed");
    // リポジトリとその下（パックの demo/ も、folder では読まない）
    expect(checkFolder(REPO, e)).toBe("intake_path_not_allowed");
    expect(checkFolder(DEMO, e)).toBe("intake_path_not_allowed");
    // シンボリックリンクのフォルダは、外を指していても断る
    const aliasHome = temp();
    expect(link(d, join(aliasHome, "alias"), true)).toBe(true);
    expect(checkFolder(join(aliasHome, "alias"), e)).toBe("intake_path_not_allowed");
    // 上のフォルダがリンクで、実体がリポジトリの中なら断る
    const up = temp();
    expect(link(join(REPO, "packs"), join(up, "packs-link"), true)).toBe(true);
    expect(checkFolder(join(up, "packs-link", "waste-incineration"), e)).toBe("intake_path_not_allowed");
    // 無い・ファイル
    expect(checkFolder(join(d, "none"), e)).toBe("intake_folder_missing");
    writeFileSync(join(d, "f.csv"), "x");
    expect(checkFolder(join(d, "f.csv"), e)).toBe("intake_folder_missing");
    // 外のふつうのフォルダは読める
    expect(checkFolder(d, e)).toEqual({ path: resolve(d), real: expect.any(String) });
  });

  it("demo：Skillパックの demo/ の 3 つ（説明の README.md と demo.json は資料に数えない）。施設名は demo.json の【架空】のもの", () => {
    expect(demoPacks(PACKS)).toContain("waste-incineration");
    const r = collectIntake({ source: "demo", pack: "waste-incineration" }, env(null)) as IntakeCollection;
    expect(r.files.map((f) => f.name)).toEqual(DEMO_FILES);
    expect(r.refused).toEqual([]);
    expect(r.pack).toBe("waste-incineration");
    expect(r.facilityName).toMatch(/^【架空】/);
    // demo/ のあるパックが 1 つなら pack は省ける
    if (demoPacks(PACKS).length === 1) expect((collectIntake({ source: "demo" }, env(null)) as IntakeCollection).files).toHaveLength(3);
    expect(collectIntake({ source: "demo", pack: "no-such-pack" }, env(null))).toBe("intake_demo_missing");
    // demo/ の無い Skillパックの道を名指ししても読まない
    expect(collectIntake({ source: "demo", pack: "night-soil" }, env(null))).toBe("intake_demo_missing");
  });

  it("取りに来たときに、選んだときと形が違えば（大きさ・リンクに替わった）読まない", async () => {
    const d = temp();
    const p = join(d, "a.csv");
    writeFileSync(p, "abc");
    expect(String(await readIntakeFile({ path: p, size: 3 }))).toBe("abc");
    expect(await readIntakeFile({ path: p, size: 4 })).toBeNull();
    rmSync(p);
    if (link(join(DEMO, "daily-report.csv"), p)) expect(await readIntakeFile({ path: p, size: readFileSync(join(DEMO, "daily-report.csv")).length })).toBeNull();
    expect(await readIntakeFile({ path: join(d, "none.csv"), size: 0 })).toBeNull();
  });

  it("上限は取り込みの画面と同じ 64 MB", () => {
    expect(INTAKE_ADD_MAX_BYTES).toBe(MAX_FILE_BYTES);
  });
});

/** 作業画面のふりが、資料のワンタイムトークンで中身を取りに行く（node:http。Origin・Sec-Fetch-Site・タブの秘密を添える） */
function fetchFile(tb: TestBridge, fileId: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Buffer; type: string | undefined }> {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ fileId });
    const req = request(
      {
        host: "127.0.0.1",
        port: tb.bridge.port,
        method: "POST",
        path: ROUTES.tabIntakeFile.path,
        headers: { "content-type": "application/json", origin: tb.origin, "sec-fetch-site": "same-origin", [HEADER_TAB_SECRET]: SECRET_A, ...headers },
      },
      (r) => {
        const chunks: Buffer[] = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => res({ status: r.statusCode ?? 0, body: Buffer.concat(chunks), type: r.headers["content-type"] }));
      },
    );
    req.on("error", rej);
    req.end(body);
  });
}

type Call = { requestId: string; name: string; args: any };

/** 中継（本物）→ 橋渡し（本物）→ タブ（ふり）。タブのふりは answer で答える（中身を取りに行ける） */
async function chain(answer: (call: Call, tb: TestBridge) => Promise<unknown>) {
  const tb = await startTestBridge();
  cleanups.push(() => tb.close());
  const tab = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
  await tab.opened;
  tab.send("tab.hello", { secret: SECRET_A, build: "test" });
  await tab.next("bridge.welcome");
  cleanups.push(() => tab.ws.close());
  const calls: Call[] = [];
  tab.ws.on("message", (raw) => {
    const ev = JSON.parse(raw.toString("utf8"));
    if (ev.type !== "bridge.tool_call") return;
    calls.push(ev.data);
    void answer(ev.data, tb).then((result) => tab.ws.send(encodeEvent("tab.tool_result", { requestId: ev.data.requestId, result: result as never })));
  });
  const server = createRelayServer({ stateDir: tb.stateDir });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  cleanups.push(() => client.close());
  await client.listTools();
  return { tb, client, calls };
}

describe("送り手と受け手：中継 → 橋渡し → 作業画面", () => {
  it("demo：橋渡しは名前・大きさ・ワンタイムトークンだけを渡し、作業画面は 1 回だけ中身を取れる。AI には名前・大きさ・件数だけを返す", async () => {
    const got: Record<string, Buffer> = {};
    const { tb, client, calls } = await chain(async (call, tb) => {
      const added = [];
      for (const f of call.args.files) {
        const r = await fetchFile(tb, f.fileId);
        expect(r.status).toBe(200);
        expect(r.type).toBe("application/octet-stream");
        got[f.name] = r.body;
        // 2 回目は取れない（1 回きり）
        const again = await fetchFile(tb, f.fileId);
        expect(again.status).toBe(404);
        expect(JSON.parse(String(again.body)).error.code).toBe("intake_file_unavailable");
        added.push({ name: f.name, sheets: 1, rows: 10 });
      }
      return { ok: true, data: { added, refused: [] } };
    });
    const r: any = await client.callTool({ name: "intake_add_files", arguments: { source: "demo" } });
    expect(r.isError).toBeFalsy();
    // 作業画面へ渡したもの：型どおり、道は渡さない
    const sent = intakeAddFilesToTabSchema.parse(calls[0]!.args);
    expect(sent.files.map((f) => f.name)).toEqual(DEMO_FILES);
    expect(JSON.stringify(calls[0]!.args)).not.toContain(DEMO);
    for (const n of DEMO_FILES) expect(got[n]!.equals(readFileSync(join(DEMO, n)))).toBe(true);
    // AI へ：名前・大きさ・件数・断った理由だけ
    expect(r.structuredContent).toMatchObject({ source: "demo", pack: "waste-incineration", refused: [], refusedTotal: 0, others: 0 });
    expect(r.structuredContent.added).toEqual(DEMO_FILES.map((n) => ({ name: n, bytes: readFileSync(join(DEMO, n)).length, sheets: 1, rows: 10 })));
    for (const v of CELL_VALUES) expect(JSON.stringify(r), v).not.toContain(v);
    expect(JSON.stringify(r)).not.toContain(DEMO);
    expect(TOOLS.intake_add_files.output.safeParse(r.structuredContent).success).toBe(true);
    // 呼び出しが終わったら、使わなかったトークンも捨てる
    expect(tb.bridge.tools.stagedCount()).toBe(0);
  });

  it("経路の守り：タブの秘密が無い・違う・Origin が無い・ほかのサイトからは断る。知らないトークンは断る", async () => {
    let ids: string[] = [];
    const { tb, client } = await chain(async (call, tb) => {
      ids = call.args.files.map((f: { fileId: string }) => f.fileId);
      const id = ids[0]!;
      expect(JSON.parse(String((await fetchFile(tb, id, { [HEADER_TAB_SECRET]: "" })).body)).error.code).toBe("secret_missing");
      expect(JSON.parse(String((await fetchFile(tb, id, { [HEADER_TAB_SECRET]: "B".repeat(43) })).body)).error.code).toBe("secret_mismatch");
      expect(JSON.parse(String((await fetchFile(tb, id, { origin: "" })).body)).error.code).toBe("origin_missing");
      expect(JSON.parse(String((await fetchFile(tb, id, { origin: "http://evil.example" })).body)).error.code).toBe("origin_not_allowed");
      expect(JSON.parse(String((await fetchFile(tb, id, { "sec-fetch-site": "cross-site" })).body)).error.code).toBe("fetch_site_not_allowed");
      expect(JSON.parse(String((await fetchFile(tb, "x".repeat(22))).body)).error.code).toBe("intake_file_unavailable");
      // 断られたあとでも、正しい守りなら取れる（断りはトークンを使わない）
      expect((await fetchFile(tb, id)).status).toBe(200);
      return { ok: true, data: { added: [], refused: call.args.files.map((f: { name: string }) => ({ name: f.name, reason: "unreadable" })) } };
    });
    const r: any = await client.callTool({ name: "intake_add_files", arguments: { source: "demo" } });
    expect(r.structuredContent.refused.map((x: any) => x.reason)).toEqual(["unreadable", "unreadable", "unreadable"]);
    expect(r.structuredContent.refusedTotal).toBe(3);
    // 呼び出しのあとは、どのトークンも取れない
    for (const id of ids) expect((await fetchFile(tb, id)).status).toBe(404);
  });

  it("folder：断った資料は橋渡しの分と作業画面の分を合わせて返す。道の外れは作業画面に渡さず、誤りの文で返す", async () => {
    const d = temp();
    writeFileSync(join(d, "a.csv"), "x,y\n1,2\n");
    writeFileSync(join(d, "memo.docx"), "x");
    const { tb, client, calls } = await chain(async () => ({ ok: true, data: { added: [{ name: "a.csv", sheets: 1, rows: 2 }], refused: [] } }));
    const r: any = await client.callTool({ name: "intake_add_files", arguments: { source: "folder", path: d } });
    expect(r.structuredContent).toMatchObject({ source: "folder", pack: null, added: [{ name: "a.csv", bytes: 8, sheets: 1, rows: 2 }], refused: [], refusedTotal: 0, others: 1 });
    expect(JSON.stringify(r)).not.toContain("memo.docx");
    // 状態フォルダの中・`..`・相対の道は、作業画面に渡さずに断る
    for (const path of [tb.stateDir, `${d}/../${d.split("/").pop()}`, "relative"]) {
      const e: any = await client.callTool({ name: "intake_add_files", arguments: { source: "folder", path } });
      expect(e.isError, path).toBe(true);
      expect(e.content, path).toEqual([{ type: "text", text: ERRORS.intake_path_not_allowed.text }]);
    }
    expect(calls).toHaveLength(1);
    // 型：folder には path が要り、demo には path と facilityName を渡さない
    for (const args of [{ source: "folder" }, { source: "demo", path: d }, { source: "demo", facilityName: "【架空】甲" }]) {
      expect(TOOLS.intake_add_files.input.safeParse(args).success, JSON.stringify(args)).toBe(false);
    }
  });

  it("作業画面が、渡していない名前・重なった名前・中身らしい欄を返したら、AI に渡さない", async () => {
    for (const bad of [
      { added: [{ name: "other.xlsx", sheets: 1, rows: 1 }], refused: [] },
      { added: [{ name: "daily-report.csv", sheets: 1, rows: 1 }], refused: [{ name: "daily-report.csv", reason: "unreadable" }] },
      { added: [{ name: "daily-report.csv", sheets: 1, rows: 1, cells: ["【架空】"] }], refused: [] },
    ]) {
      const { client } = await chain(async () => ({ ok: true, data: bad }));
      const r: any = await client.callTool({ name: "intake_add_files", arguments: { source: "demo" } });
      expect(r.isError, JSON.stringify(bad)).toBe(true);
      expect(r.content).toEqual([{ type: "text", text: ERRORS.tab_bad_result.text }]);
    }
  });
});

describe("作業画面：人が落とした資料と同じ道で取り込む", () => {
  const demoArgs = () => {
    const c = collectIntake({ source: "demo", pack: "waste-incineration" }, env(null)) as IntakeCollection;
    const byId = new Map<string, string>();
    const files = c.files.map((f, i) => {
      const fileId = `${"f".repeat(21)}${i}`;
      byId.set(fileId, f.path);
      return { fileId, name: f.name, size: f.size };
    });
    const fetch = async (id: string) => (byId.has(id) ? new Uint8Array(readFileSync(byId.get(id)!)) : null);
    return { args: { source: "demo", pack: c.pack, facilityName: c.facilityName, files }, fetch };
  };

  it("デモの資料を入れる：パックと施設名が空ならデモのもの、架空になる。返すのは名前と件数だけ。2 回目は同じ名前として断る", async () => {
    const ws = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    const { args, fetch } = demoArgs();
    const r = await addFilesFromBridge(ws, args, fetch);
    if (!r.ok) throw new Error(r.code);
    expect(r.data.refused).toEqual([]);
    const added = r.data.added as { name: string; sheets: number | null; rows: number | null }[];
    expect(added.map((a) => a.name).sort()).toEqual(DEMO_FILES);
    for (const a of added) {
      expect(a.sheets, a.name).toBeGreaterThan(0);
      expect(a.rows, a.name).toBeGreaterThan(0);
    }
    for (const v of CELL_VALUES) expect(JSON.stringify(r), v).not.toContain(v);
    expect(ws.fileCount).toBe(3);
    expect(ws.settings).toMatchObject({ packId: "waste-incineration", facilityName: args.facilityName, fictional: true });
    expect(ws.notices[0]?.kind).toBe("ai");
    // 2 回目：同じ名前の資料はもう入っている
    const again = await addFilesFromBridge(ws, args, fetch);
    if (!again.ok) throw new Error(again.code);
    expect(again.data.added).toEqual([]);
    expect((again.data.refused as { reason: string }[]).map((x) => x.reason)).toEqual(["same_name", "same_name", "same_name"]);
    expect(ws.fileCount).toBe(3);
  });

  it("デモの資料は、架空でない資料・ほかのパックと混ぜない", async () => {
    const { args, fetch } = demoArgs();
    const real = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "x", fiscalYearStartMonth: 4, fictional: false });
    await real.addFiles([{ name: "mine.csv", size: 4, bytes: async () => new TextEncoder().encode("a,b\n") }]);
    // 架空でない資料があれば、どれも入れずに mixed で断る（誤りでなく答えで返す。仕事 chat-prompts-v1）
    expect(await addFilesFromBridge(real, args, fetch)).toEqual({ ok: true, data: { added: [], refused: DEMO_FILES.map((name) => ({ name, reason: "mixed" })) } });
    expect(real.fileCount).toBe(1);
    const other = new IntakeWorkspace({ packId: "night-soil", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    expect(await addFilesFromBridge(other, args, fetch)).toEqual({ ok: false, code: "intake_demo_mixed" });
    expect(other.fileCount).toBe(0);
  });

  it("取れなかった資料は changed、読めない形は unreadable、画像は写真の欄に並ぶ（件数は null）。型に合わない引数は tool_failed", async () => {
    const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】甲", fiscalYearStartMonth: 4, fictional: true });
    const photo = new Uint8Array(readFileSync("samples/out/waste-incineration/fictional-1/photos/inspection-photo-f1-fy2025.jpg"));
    const broken = new TextEncoder().encode("これは xlsx ではない");
    const files = { a: photo, b: broken };
    const args = {
      source: "folder",
      pack: null,
      facilityName: null,
      files: [
        { fileId: "a".repeat(22), name: "photo.jpg", size: photo.length },
        { fileId: "b".repeat(22), name: "broken.xlsx", size: broken.length },
        { fileId: "c".repeat(22), name: "gone.csv", size: 10 },
      ],
    };
    const r = await addFilesFromBridge(ws, args, async (id) => (id[0] === "a" ? files.a : id[0] === "b" ? files.b : null));
    if (!r.ok) throw new Error(r.code);
    expect(r.data.added).toEqual([{ name: "photo.jpg", sheets: null, rows: null }]);
    expect(r.data.refused).toEqual([
      { name: "gone.csv", reason: "changed" },
      { name: "broken.xlsx", reason: "unreadable" },
    ]);
    expect(await addFilesFromBridge(ws, { source: "folder", files: "x" }, async () => null)).toEqual({ ok: false, code: "tool_failed" });
  });

  it("橋渡しとの接続につなぐ：intake_add_files の呼び出しは、BridgeClient で中身を取りに行ってから答える", async () => {
    const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】甲", fiscalYearStartMonth: 4, fictional: true });
    const client = new BridgeClient("ws://127.0.0.1:1/ws"); // つながない。届いた通信を receive で渡す
    const sent: any[] = [];
    (client as any).send = (type: string, data: unknown) => sent.push({ type, data });
    const asked: string[] = [];
    client.fetchIntakeFile = async (id: string) => (asked.push(id), new TextEncoder().encode("日付,作業\n"));
    connectTabTools(client, ws);
    const fileId = "z".repeat(22);
    client.receive(encodeEvent("bridge.tool_call", { requestId: "t1", name: "intake_add_files", args: { source: "folder", pack: null, facilityName: null, files: [{ fileId, name: "a.csv", size: 10 }] }, conversation: "c", rowsRemaining: 2000 }));
    await expect.poll(() => sent.length).toBe(1);
    expect(asked).toEqual([fileId]);
    // 大きさが合わない中身は入れない
    expect(sent[0].data.result).toEqual({ ok: true, data: { added: [], refused: [{ name: "a.csv", reason: "changed" }] } });
  });
});

// folder の pack・facilityName：利用者にチャットのほかの操作をさせないため、Skillパックと施設名もチャットから施設設定に置く。
// 置くのは作業画面の欄が空のときだけ（人が画面で選んだ・打ったものは上書きしない）。施設名はどれも架空。
describe("folder の Skillパックと施設名", () => {
  /** ふつうの（架空の印の無い）CSV が 1 つあるフォルダ */
  const CSV = "日付,作業\n2024-04-01,点検\n";
  const folder = () => {
    const d = temp();
    writeFileSync(join(d, "a.csv"), CSV);
    return d;
  };
  const choice = (id: string) => packChoices().find((p) => p.id === id)!;
  const A = TEXT.intake.ai;

  it("型：施設名は 1〜40 字（サロゲートの組も 1 字）。空・41 字・前後の空白・制御の文字は断る。demo には添えない", () => {
    const d = temp();
    const ok = (a: object) => TOOLS.intake_add_files.input.safeParse(a).success;
    expect(INTAKE_FACILITY_NAME_MAX).toBe(40);
    expect(ok({ source: "folder", path: d, pack: "waste-incineration", facilityName: "あ".repeat(40) })).toBe(true);
    expect(ok({ source: "folder", path: d, facilityName: "𠮷".repeat(40) })).toBe(true);
    expect(ok({ source: "folder", path: d, pack: "waste-incineration" })).toBe(true);
    for (const bad of ["", "あ".repeat(41), "𠮷".repeat(41), " 【架空】乙", "【架空】乙 ", "【架空】\n乙", "\u0000"]) {
      expect(ok({ source: "folder", path: d, facilityName: bad }), JSON.stringify(bad)).toBe(false);
      expect(intakeFacilityNameOk(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(ok({ source: "folder", path: d, pack: "Waste_Incineration" })).toBe(false);
    expect(ok({ source: "demo", facilityName: "【架空】乙" })).toBe(false);
    // 作業画面へ渡す形も同じ決まり（folder は 40 字まで。demo の施設名は demo.json のもので 80 字まで）
    const toTab = (facilityName: string, source = "folder") => intakeAddFilesToTabSchema.safeParse({ source, pack: null, facilityName, files: [] }).success;
    expect(toTab("あ".repeat(40))).toBe(true);
    expect(toTab("𠮷".repeat(40))).toBe(true);
    expect(toTab("あ".repeat(41))).toBe(false);
    expect(toTab(" 【架空】乙")).toBe(false);
    expect(toTab("あ".repeat(41), "demo")).toBe(true);
  });

  it("橋渡し：pack は作業画面で選べる Skillパック（common.json のあるもの）だけ。無いものは資料を読む前に断る", () => {
    const packs = temp("moyai-packs-");
    const put = (dir: string, file: string, body: string) => {
      mkdirSync(join(packs, dir), { recursive: true });
      writeFileSync(join(packs, dir, file), body);
    };
    put("alpha", "common.json", "{}");
    put("alpha", "pack.json", JSON.stringify({ name: "【架空】甲の業種" }));
    put("beta", "pack.json", JSON.stringify({ name: "【架空】中身の無い業種" }));
    put("gamma", "common.json", "{}");
    put("_kinds", "common.json", "{}");
    expect(skillPacks(packs)).toEqual([
      { id: "alpha", name: "【架空】甲の業種" },
      { id: "gamma", name: "gamma" },
    ]);
    expect(skillPacksText(packs)).toBe("alpha：【架空】甲の業種・gamma：gamma");
    const e = { packsDir: packs, stateDir: temp("moyai-state-"), repoRoot: REPO };
    const d = folder();
    const r = collectIntake({ source: "folder", path: d, pack: "alpha", facilityName: "【架空】乙" }, e) as IntakeCollection;
    expect(r).toMatchObject({ source: "folder", pack: "alpha", facilityName: "【架空】乙", refused: [], others: 0 });
    expect(r.files.map((f) => f.name)).toEqual(["a.csv"]);
    expect(collectIntake({ source: "folder", path: d }, e)).toMatchObject({ pack: null, facilityName: null });
    for (const pack of ["beta", "_kinds", "no-such-pack"]) expect(collectIntake({ source: "folder", path: d, pack }, e), pack).toBe("intake_pack_unknown");
    // 道が外れていても、先に Skillパックで断る（フォルダを見に行かない）
    expect(collectIntake({ source: "folder", path: "relative", pack: "beta" }, e)).toBe("intake_pack_unknown");
    // 型を通らない施設名は、ここでも直さずに断る
    expect(collectIntake({ source: "folder", path: d, facilityName: "あ".repeat(41) }, e)).toBe("invalid_input");
    // リポジトリの packs/ では、作業画面の Skillパックの欄と同じものを選べる
    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    expect(skillPacks(PACKS)).toEqual(packChoices().map(({ id, name }) => ({ id, name })).sort(byId));
    expect(skillPacks(PACKS).length).toBeGreaterThan(0);
  });

  it("送り手と受け手：中継 → 橋渡し → 作業画面の欄まで届き、空の欄にだけ置く。2 回目の違う値は置かない", async () => {
    const d = folder();
    const ws = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    // 作業画面の受け手は本物。中身は経路 tabIntakeFile でワンタイムトークンを使って取りに行く
    const { client, calls } = await chain(async (call, tb) =>
      addFilesFromBridge(ws, call.args, async (id) => {
        const r = await fetchFile(tb, id);
        return r.status === 200 ? new Uint8Array(r.body) : null;
      }),
    );
    const r: any = await client.callTool({ name: "intake_add_files", arguments: { source: "folder", path: d, pack: "waste-incineration", facilityName: "【架空】乙" } });
    expect(r.isError).toBeFalsy();
    expect(intakeAddFilesToTabSchema.parse(calls[0]!.args)).toMatchObject({ source: "folder", pack: "waste-incineration", facilityName: "【架空】乙" });
    expect(JSON.stringify(calls[0]!.args)).not.toContain(d);
    expect(r.structuredContent).toMatchObject({ source: "folder", pack: "waste-incineration", refused: [], refusedTotal: 0 });
    expect(r.structuredContent.added.map((a: { name: string }) => a.name)).toEqual(["a.csv"]);
    expect(TOOLS.intake_add_files.output.safeParse(r.structuredContent).success).toBe(true);
    expect(ws.settings).toMatchObject({ packId: "waste-incineration", facilityName: "【架空】乙", fictional: false });
    expect(ws.notices.map((n) => n.text)).toContain(A.facilitySet([A.facilityPack(choice("waste-incineration").name), A.facilityName("【架空】乙")]));
    // 2 回目：違う Skillパックと施設名を添えても、入っている値は変えない（資料は入る）
    writeFileSync(join(d, "b.csv"), CSV);
    const again: any = await client.callTool({ name: "intake_add_files", arguments: { source: "folder", path: d, pack: "night-soil", facilityName: "【架空】丙" } });
    expect(again.isError).toBeFalsy();
    expect(again.structuredContent.added.map((a: { name: string }) => a.name)).toEqual(["b.csv"]);
    expect(ws.settings).toMatchObject({ packId: "waste-incineration", facilityName: "【架空】乙" });
    expect(ws.notices.map((n) => n.text)).toContain(A.facilityKept([A.facilityPack(choice("night-soil").name), A.facilityName("【架空】丙")]));
  });

  it("送り手と受け手：無い Skillパックは作業画面に渡さずに断り、選べる ID と名前を返す。型に合わない施設名も渡さない", async () => {
    const d = folder();
    const { client, calls } = await chain(async () => ({ ok: true, data: { added: [], refused: [] } }));
    const r: any = await client.callTool({ name: "intake_add_files", arguments: { source: "folder", path: d, pack: "no-such-pack", facilityName: "【架空】乙" } });
    expect(r.isError).toBe(true);
    const text = errorBody("intake_pack_unknown", { packs: skillPacksText(PACKS) }).error.message;
    expect(r.content[0]).toEqual({ type: "text", text });
    expect(text).not.toContain("{packs}");
    for (const p of packChoices()) expect(text).toContain(`${p.id}：${p.name}`);
    for (const facilityName of ["あ".repeat(41), " 【架空】乙", ""]) {
      const e: any = await client.callTool({ name: "intake_add_files", arguments: { source: "folder", path: d, facilityName } });
      expect(e.isError, JSON.stringify(facilityName)).toBe(true);
    }
    expect(calls).toHaveLength(0);
  });

  describe("作業画面の受け手", () => {
    const bytes = new TextEncoder().encode(CSV);
    const args = (o: { pack?: string | null; facilityName?: string | null }) => ({
      source: "folder",
      pack: o.pack ?? null,
      facilityName: o.facilityName ?? null,
      files: [{ fileId: "a".repeat(22), name: "a.csv", size: bytes.length }],
    });
    const wsOf = (packId: string, facilityName: string) => new IntakeWorkspace({ packId, facilityName, fiscalYearStartMonth: 4, fictional: false });

    it("空の欄に置き、AI の作業の欄に知らせる。架空の印の無い資料は架空にしない", async () => {
      const ws = wsOf("", "");
      const r = await addFilesFromBridge(ws, args({ pack: "waste-incineration", facilityName: "【架空】乙" }), async () => bytes);
      if (!r.ok) throw new Error(r.code);
      expect(r.data).toEqual({ added: [{ name: "a.csv", sheets: expect.any(Number), rows: expect.any(Number) }], refused: [] });
      expect(ws.settings).toMatchObject({ packId: "waste-incineration", facilityName: "【架空】乙", fictional: false });
      const notes = ws.notices.filter((n) => n.kind === "ai").map((n) => n.text);
      expect(notes).toContain(A.facilitySet([A.facilityPack(choice("waste-incineration").name), A.facilityName("【架空】乙")]));
      expect(notes).toContain(A.filesAdded(false, 1, 0));
      // 添えなければ何も置かず、施設設定の知らせも出さない
      const none = wsOf("", "");
      await addFilesFromBridge(none, args({}), async () => bytes);
      expect(none.settings).toMatchObject({ packId: "", facilityName: "" });
      expect(none.notices.map((n) => n.text)).toEqual([A.filesAdded(false, 1, 0)]);
    });

    it("人が選んだ Skillパック・打った施設名は上書きしない（違う値は未反映と知らせる）。空の欄だけ置く", async () => {
      const human = wsOf("night-soil", "【架空】人の施設");
      const r = await addFilesFromBridge(human, args({ pack: "waste-incineration", facilityName: "【架空】AI の施設" }), async () => bytes);
      if (!r.ok) throw new Error(r.code);
      expect(r.data.added).toHaveLength(1);
      expect(human.settings).toMatchObject({ packId: "night-soil", facilityName: "【架空】人の施設" });
      const notes = human.notices.map((n) => n.text);
      expect(notes).toContain(A.facilityKept([A.facilityPack(choice("waste-incineration").name), A.facilityName("【架空】AI の施設")]));
      expect(notes.some((t) => t.startsWith("AI が施設設定を入力"))).toBe(false);
      // 施設名だけ人が打ってある：Skillパックだけ置く
      const nameOnly = wsOf("", "【架空】人の施設");
      await addFilesFromBridge(nameOnly, args({ pack: "waste-incineration", facilityName: "【架空】AI の施設" }), async () => bytes);
      expect(nameOnly.settings).toMatchObject({ packId: "waste-incineration", facilityName: "【架空】人の施設" });
      expect(nameOnly.notices.map((n) => n.text)).toEqual(
        expect.arrayContaining([A.facilitySet([A.facilityPack(choice("waste-incineration").name)]), A.facilityKept([A.facilityName("【架空】AI の施設")])]),
      );
      // Skillパックだけ人が選んである（同じ値なら知らせない）。空白だけの施設名は空として置く
      const packOnly = wsOf("waste-incineration", "  ");
      await addFilesFromBridge(packOnly, args({ pack: "waste-incineration", facilityName: "【架空】AI の施設" }), async () => bytes);
      expect(packOnly.settings).toMatchObject({ packId: "waste-incineration", facilityName: "【架空】AI の施設" });
      expect(packOnly.notices.map((n) => n.text)).toContain(A.facilitySet([A.facilityName("【架空】AI の施設")]));
      expect(packOnly.notices.some((n) => n.text.startsWith("AI の施設設定は未反映"))).toBe(false);
    });

    it("作業画面の一覧に無い Skillパックは置かず、資料も取りに行かない（intake_pack_not_on_screen）", async () => {
      const ws = wsOf("", "");
      let asked = 0;
      const r = await addFilesFromBridge(ws, args({ pack: "no-such-pack", facilityName: "【架空】乙" }), async () => (asked++, bytes));
      expect(r).toEqual({ ok: false, code: "intake_pack_not_on_screen" });
      expect(asked).toBe(0);
      expect(ws.fileCount).toBe(0);
      expect(ws.settings).toMatchObject({ packId: "", facilityName: "" });
      expect(ws.notices[0]).toMatchObject({ kind: "ai", text: A.packNotOnScreen("no-such-pack") });
    });

    it("施設名の長さ：40 字は置き、41 字は型で断る（何も置かず、資料も入れない）", async () => {
      for (const name of ["あ".repeat(40), "𠮷".repeat(40)]) {
        const ws = wsOf("", "");
        const r = await addFilesFromBridge(ws, args({ facilityName: name }), async () => bytes);
        expect(r.ok, name).toBe(true);
        expect(ws.settings.facilityName).toBe(name);
      }
      for (const name of ["あ".repeat(41), "𠮷".repeat(41)]) {
        const ws = wsOf("", "");
        expect(await addFilesFromBridge(ws, args({ facilityName: name }), async () => bytes)).toEqual({ ok: false, code: "tool_failed" });
        expect(ws.settings.facilityName).toBe("");
        expect(ws.fileCount).toBe(0);
      }
    });
  });
});
