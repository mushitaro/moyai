// 公開の台帳へ出す（docs/plan.md §2.8・§2.12。運営者の決定、2026-11-04「MOYAI が出す」）：台帳の clone を受け手と同じ関数で読み、
// 施設の鍵（保管先の計画のフォルダ share/keys/<台帳ID>.json、docs/plan.md §2.19）で、輪と同じ関数で束を作って署名し、clone の木に足して ✓ のものだけを、GitHub の代わりの試験の台へ PR に出す。
// 届いた束は受け手の関数で ✓。前に出した束が clone に無く PR が閉じていなければ、次は出さない。
// 本物の GitHub では確かめていない（試験の台は tests/helpers/github-stub.ts）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GITHUB_HOSTS, githubClientIdOf, githubHostsOf, openLedgerPr, pollDevice, prStatus, repoOfRemote, startDevice, whoAmI, type GitHubIo } from "../../../src/bridge/github";
import { gitRemote } from "../../../src/bridge/human";
import { readGitHub, readLedgers, writeGitHub, type LedgerSentEntry } from "../../../src/bridge/places";
import { previewPlace, sealPlace, type Answers } from "../../../src/share/checkpoint";
import { facilityKey, storeFacilityKey, writePlanSent, type Facility } from "../../../src/share/facility";
import { keyIdOf, type KeyPair } from "../../../src/share/sign";
import { readLedgerDir, verifyLedgerFiles } from "../../../src/share/ledger";
import { LEDGER_PR_TEXT, acceptLedger, checkAgainstLedger, ledgerAcceptance, ledgerBranch, ledgerBundlePath, ledgerPlace, loadLedgerForSend, pendingSent } from "../../../src/share/ledger-send";
import type { SharePack } from "../../../src/share/pack";
import { startGitHubStub, STUB_TOKEN, type GitHubStub } from "../../helpers/github-stub";
import { FACILITY_COMMON, SPEC, smallPlan, table, vocab } from "./fixtures";
import { makeLedger, writeRepo } from "./ledger-fixtures";

const PACK: SharePack = { id: "waste-incineration", name: "架空のパック", spec: SPEC, vocab, table, classNames: { "T.FEED.LIFT": "架空の昇降機" }, axes: [] };
const NOW = new Date(2026, 10, 4, 12, 0, 0);
const MONTH = "2026-11";
const ANSWERS: Answers = { facility: FACILITY_COMMON, inNationalTable: true };
const pending = new Map<string, KeyPair>();
/** 施設の鍵（保管先にあればそれ、無ければメモリの鍵） */
function senderOf(facility: Facility, ledgerId: string): { facility: Facility; pair: KeyPair; stored: boolean } {
  const k = facilityKey(facility, ledgerId, pending);
  if (!k.ok) throw new Error(k.reason);
  return { facility, pair: k.pair, stored: k.stored };
}

let dir = "";
let stub: GitHubStub | null = null;
afterEach(async () => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
  await stub?.close();
  stub = null;
});

async function setup() {
  dir = mkdtempSync(join(tmpdir(), "moyai-ledger-send-"));
  const stateDir = join(dir, "state");
  const clone = join(dir, "台帳の clone");
  const L0 = makeLedger();
  writeRepo(clone, L0, []);
  mkdirSync(join(clone, ".git"), { recursive: true });
  writeFileSync(join(clone, ".git", "config"), '[core]\n\tbare = false\n[remote "origin"]\n\turl = https://github.com/ledger-owner/moyai.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n');
  const L = await loadLedgerForSend(clone, PACK);
  if (!L.ok) throw new Error(L.reason);
  const facility: Facility = { root: join(dir, "保管先"), planId: smallPlan().planId };
  return { stateDir, clone, L0, L, facility };
}

const io = (s: GitHubStub): GitHubIo => ({ hosts: { web: s.web, api: s.api }, fetch: (u, i) => fetch(u, i), sleep: async () => {} });

describe("公開の台帳へ出す：台帳の clone・鍵・束", () => {
  it("台帳の clone の origin から GitHub のリポジトリを読む（https・ssh。GitHub でなければ null）", async () => {
    const { clone } = await setup();
    expect(repoOfRemote(gitRemote(clone))).toEqual({ owner: "ledger-owner", name: "moyai" });
    expect(repoOfRemote("git@github.com:a-b/moyai.git")).toEqual({ owner: "a-b", name: "moyai" });
    expect(repoOfRemote("https://gitlab.com/a/b")).toBeNull();
    expect(repoOfRemote("https://github.com/a/b/c")).toBeNull();
    expect(gitRemote(join(dir, "無い"))).toBeNull();
  });

  it("鍵は台帳ごとに 1 つ。はじめに作り（包まない）、次からは同じ鍵を使う", async () => {
    const { stateDir, L, facility } = await setup();
    // GitHub につなぐときは、決まりを受け入れたことだけを状態フォルダに書く（2 度目は前のまま）
    expect(ledgerAcceptance(stateDir, L.id)).toBeNull();
    const a = acceptLedger(stateDir, L, PACK, NOW);
    expect(readLedgers(stateDir).map((e) => e.ledgerId)).toEqual([L.id]);
    expect(acceptLedger(stateDir, L, PACK, new Date(2027, 0, 1))).toEqual(a);
    // 束に署名する鍵は施設のもの：送るまではメモリの鍵で、書くのは送ったとき
    const s1 = senderOf(facility, L.id);
    expect(s1.stored).toBe(false);
    expect(senderOf(facility, L.id).pair.pub).toBe(s1.pair.pub);
    expect(storeFacilityKey(facility, L.id, s1.pair, pending)).toBe("ok");
    expect(senderOf(facility, L.id)).toMatchObject({ stored: true });
    expect(senderOf(facility, L.id).pair.pub).toBe(s1.pair.pub);
  });

  it("輪と同じ関数で束を作り、clone の木に足して受け手の関数で ✓。見たハッシュと違えば署名しない", async () => {
    const { stateDir, L, facility } = await setup();
    const accepted = acceptLedger(stateDir, L, PACK, NOW);
    const sender = senderOf(facility, L.id);
    const place = ledgerPlace(L, accepted, sender);
    const v = previewPlace(place, PACK, smallPlan(), ANSWERS, MONTH);
    expect(v.blockers).toEqual([]);
    expect(v.bodyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(v.bodyText!).to).toEqual({ kind: "ledger", id: L.id });
    expect(sealPlace(place, sender.pair, PACK, smallPlan(), ANSWERS, MONTH, "f".repeat(64))).toEqual({ ok: false, reason: "previewChanged" });
    const s = sealPlace(place, sender.pair, PACK, smallPlan(), ANSWERS, MONTH, v.bodyHash!);
    if (!s.ok) throw new Error(s.reason);
    const path = ledgerBundlePath(keyIdOf(sender.pair.pub), s.input.seq, s.hash);
    expect(path).toMatch(/^ledger\/ledger\/bundles\/[0-9a-f]{16}\/000001-[0-9a-f]{16}\.json$/);
    expect(checkAgainstLedger(L, PACK, path, Buffer.from(s.text, "utf8"))).toEqual({ ok: true });
    // 1 バイト変えた束は、受け手の関数で ✗
    const bad = Buffer.from(s.text.replace('"seq":1', '"seq":2'), "utf8");
    expect(checkAgainstLedger(L, PACK, path, bad).ok).toBe(false);
  });

  it("前に出した束が clone に無く、PR が閉じていなければ pending。閉じた PR の束は数えない", async () => {
    const { stateDir, L, facility } = await setup();
    const accepted = acceptLedger(stateDir, L, PACK, NOW);
    const sender = senderOf(facility, L.id);
    storeFacilityKey(facility, L.id, sender.pair, pending);
    const key = keyIdOf(sender.pair.pub);
    const e = { ledgerId: L.id, key, seq: 1, hash: "c".repeat(64), path: "ledger/ledger/bundles/x", month: MONTH, at: NOW.toISOString(), repo: "ledger-owner/moyai", pr: 7, url: "https://github.com/x/pull/7", login: "moyai-test" };
    // 持ち出し簿は保管先の計画のフォルダ（どの PC も、まだ載っていない PR を読める）
    writePlanSent<LedgerSentEntry>(facility, L.id, [{ ...e, state: "open" } as LedgerSentEntry]);
    expect(pendingSent(facility, L, key)?.pr).toBe(7);
    // 審査中の束の次は、連番 2・前の束のハッシュでつなぐ（台帳に載れば鎖が合う）
    expect(previewPlace(ledgerPlace(L, accepted, sender), PACK, smallPlan(), ANSWERS, MONTH).seq).toBe(2);
    writePlanSent<LedgerSentEntry>(facility, L.id, [{ ...e, state: "closed" } as LedgerSentEntry]);
    expect(pendingSent(facility, L, key)).toBeNull();
    expect(previewPlace(ledgerPlace(L, accepted, sender), PACK, smallPlan(), ANSWERS, MONTH).seq).toBe(1);
  });
});

describe("GitHub とのやりとり（試験の台）", () => {
  it("行き先は GitHub だけ。環境変数で替えられるのは 127.0.0.1 の試験の台だけで、Client ID もそのときだけ替わる", () => {
    expect(githubHostsOf({})).toBe(GITHUB_HOSTS);
    expect(githubHostsOf({ MOYAI_GITHUB_WEB: "https://evil.example", MOYAI_GITHUB_API: "https://evil.example" })).toBe(GITHUB_HOSTS);
    expect(githubHostsOf({ MOYAI_GITHUB_WEB: "http://127.0.0.1:9", MOYAI_GITHUB_API: "https://api.github.com" })).toBe(GITHUB_HOSTS);
    const h = githubHostsOf({ MOYAI_GITHUB_WEB: "http://127.0.0.1:9", MOYAI_GITHUB_API: "http://127.0.0.1:9/" });
    expect(h).toEqual({ web: "http://127.0.0.1:9", api: "http://127.0.0.1:9" });
    expect(githubClientIdOf(null, { MOYAI_GITHUB_CLIENT_ID: "x" }, GITHUB_HOSTS)).toBeNull();
    expect(githubClientIdOf(null, { MOYAI_GITHUB_CLIENT_ID: "stub-client-id" }, h)).toBe("stub-client-id");
    expect(githubClientIdOf("Iv1.0123456789abcdef", {}, GITHUB_HOSTS)).toBe("Iv1.0123456789abcdef");
  });

  it("デバイスフロー：人が許すまで待ち、許すと public_repo のトークン。断れば denied", async () => {
    stub = await startGitHubStub();
    const g = io(stub);
    const d = await startDevice(g, stub.clientId);
    if (!d.ok) throw new Error(d.reason);
    expect(d.userCode).toBe("WDJB-MJHT");
    expect(await pollDevice(g, stub.clientId, d.deviceCode)).toEqual({ state: "pending" });
    stub.approve();
    const r = await pollDevice(g, stub.clientId, d.deviceCode);
    expect(r).toEqual({ state: "ok", token: STUB_TOKEN });
    expect(await whoAmI(g, STUB_TOKEN)).toBe("moyai-test");
    expect(await whoAmI(g, "違うトークン")).toBeNull();
    const s2 = await startGitHubStub();
    try {
      s2.deny();
      expect(await pollDevice(io(s2), s2.clientId, "dev-code-1")).toEqual({ state: "denied" });
    } finally {
      await s2.close();
    }
  });

  it("トークンは包まずに状態フォルダに置く。前の形（合言葉で包んだもの）は読まず、つなぎ直してもらう", async () => {
    const { stateDir } = await setup();
    writeGitHub(stateDir, { v: "moyai.github/1", login: "moyai-test", token: STUB_TOKEN, connectedAt: NOW.toISOString() });
    expect(readGitHub(stateDir)).toMatchObject({ login: "moyai-test", token: STUB_TOKEN });
    writeFileSync(join(stateDir, "github.json"), JSON.stringify({ v: "moyai.github/0", login: "moyai-test", token: { v: "moyai.wrapped-secret/0", aad: "moyai.github-token", salt: "00", iv: "00", ct: "00", tag: "00" }, connectedAt: NOW.toISOString() }));
    expect(readGitHub(stateDir)).toBeNull();
  });

  it("フォーク → 枝 → 束のファイル 1 つ → 台帳の既定のブランチへ PR。届いた束は受け手の関数で ✓。行方を読む", async () => {
    const { stateDir, L, clone, facility } = await setup();
    stub = await startGitHubStub();
    const g = io(stub);
    const accepted = acceptLedger(stateDir, L, PACK, NOW);
    const sender = senderOf(facility, L.id);
    const key = keyIdOf(sender.pair.pub);
    const place = ledgerPlace(L, accepted, sender);
    const v = previewPlace(place, PACK, smallPlan(), ANSWERS, MONTH);
    const s = sealPlace(place, sender.pair, PACK, smallPlan(), ANSWERS, MONTH, v.bodyHash!);
    if (!s.ok) throw new Error(s.reason);
    const path = ledgerBundlePath(key, s.input.seq, s.hash);
    const r = await openLedgerPr(g, STUB_TOKEN, {
      upstream: repoOfRemote(gitRemote(clone))!,
      path,
      bytes: Buffer.from(s.text, "utf8"),
      branch: ledgerBranch(key, s.input.seq, s.hash),
      title: LEDGER_PR_TEXT.title(key, s.input.seq),
      body: "架空の本文",
      commitMessage: LEDGER_PR_TEXT.commitMessage(key, s.input.seq),
    });
    expect(r).toMatchObject({ ok: true, number: 1, login: "moyai-test", fork: "moyai-test/moyai" });
    const pr = stub.prs[0]!;
    expect(pr.base).toBe("main");
    expect(pr.head).toMatch(/^moyai-test:moyai\/bundle-[0-9a-f]{16}-000001-[0-9a-f]{8}$/);
    expect(Object.keys(pr.files)).toEqual([path]);
    // 届いた束を、台帳の木に足して受け手の関数で確かめる
    const dirRead = await readLedgerDir(clone);
    if (!dirRead.ok) throw new Error(dirRead.reason);
    const read = verifyLedgerFiles([...dirRead.files, { path, kind: "file", bytes: new Uint8Array(pr.files[path]!) }], PACK);
    expect(read.bundles.find((b) => b.path === path)?.status).toBe("ok");
    // トークンは Authorization にだけ載り、ほかには出ない
    expect([...stub.tokensSeen]).toEqual([STUB_TOKEN]);
    expect(JSON.stringify(stub.prs)).not.toContain(STUB_TOKEN);

    // 行方：審査中 → 検証 ✗（理由は台帳の検証が PR に書いた文）→ 閉じた
    expect(await prStatus(g, { owner: "ledger-owner", name: "moyai" }, 1)).toMatchObject({ state: "open", check: "pending", reason: null });
    pr.check = { status: "completed", conclusion: "failure" };
    pr.comments.push({ user: { login: "github-actions[bot]", type: "Bot" }, body: "## 台帳の検証 ✗\n\n- 紛れる数 k が 5 に届かない" });
    pr.state = "closed";
    expect(await prStatus(g, { owner: "ledger-owner", name: "moyai" }, 1)).toMatchObject({ state: "closed", check: "ng", reason: "台帳の検証 ✗ / 紛れる数 k が 5 に届かない" });
    pr.check = { status: "completed", conclusion: "success" };
    pr.state = "closed";
    pr.merged = true;
    expect(await prStatus(g, { owner: "ledger-owner", name: "moyai" }, 1)).toMatchObject({ state: "merged", check: "ok" });
    expect(await prStatus(g, { owner: "ledger-owner", name: "moyai" }, 99)).toBeNull();
  });

  it("台帳の持ち主のアカウントなら、フォークせずに台帳のリポジトリに枝を作って PR を出す（自分のリポジトリはフォークできない）", async () => {
    const { stateDir, L, clone, facility } = await setup();
    stub = await startGitHubStub({ login: "ledger-owner" });
    const g = io(stub);
    const accepted = acceptLedger(stateDir, L, PACK, NOW);
    const sender = senderOf(facility, L.id);
    const key = keyIdOf(sender.pair.pub);
    const place = ledgerPlace(L, accepted, sender);
    const v = previewPlace(place, PACK, smallPlan(), ANSWERS, MONTH);
    const s = sealPlace(place, sender.pair, PACK, smallPlan(), ANSWERS, MONTH, v.bodyHash!);
    if (!s.ok) throw new Error(s.reason);
    const path = ledgerBundlePath(key, s.input.seq, s.hash);
    const r = await openLedgerPr(g, STUB_TOKEN, {
      upstream: repoOfRemote(gitRemote(clone))!,
      path,
      bytes: Buffer.from(s.text, "utf8"),
      branch: ledgerBranch(key, s.input.seq, s.hash),
      title: LEDGER_PR_TEXT.title(key, s.input.seq),
      body: "架空の本文",
      commitMessage: LEDGER_PR_TEXT.commitMessage(key, s.input.seq),
    });
    expect(r).toMatchObject({ ok: true, number: 1, login: "ledger-owner", fork: "ledger-owner/moyai" });
    expect(stub.prs[0]!.head).toMatch(/^ledger-owner:moyai\/bundle-/);
    expect(Object.keys(stub.prs[0]!.files)).toEqual([path]);
  });

  it("トークンが無効なら、フォークもしない（unauthorized）", async () => {
    stub = await startGitHubStub();
    const r = await openLedgerPr(io(stub), "違うトークン", {
      upstream: stub.upstream,
      path: "ledger/ledger/bundles/0123456789abcdef/000001-0123456789abcdef.json",
      bytes: new Uint8Array([1]),
      branch: "moyai/x",
      title: "t",
      body: "b",
      commitMessage: "m",
    });
    expect(r).toEqual({ ok: false, reason: "unauthorized" });
    expect(stub.calls.some((c) => c.includes("/forks"))).toBe(false);
  });
});
