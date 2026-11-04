// human-only（docs/plan.md §5.1）の続き：確定・版・設定・輪と鍵・検問所の人だけの経路。
// どの経路も、素の HTTP・タブの秘密の無い要求・Origin の無い要求・偽った Origin で秘密なし・使い終えた印・切れた印を拒む。拒む試験は消さない。
// あわせて、正しいタブから、Documents が日本語の OneDrive の下にある PC の形で、確定 → 輪を作る → 検問所 → 送る → 確かめるを通す。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aiDecisions } from "../../src/plan/diff";
import { HEADER_TAB_SECRET, ROUTES, ROUTE_IDS, type HumanAction, type RouteDef } from "../../src/shared/routes";
import { EXPOSED_TOOL_NAMES, TOOL_NAMES } from "../../src/shared/tools";
import { truthToPlan } from "../fixtures/chart/truth-to-plan.mjs";
import { fileURLToPath } from "node:url";
import { buildLedgerDemo } from "../../scripts/ledger/demo-core";
import { FakeTab, SECRET_A, http, startTestBridge, type TestBridge } from "../helpers/bridge";
import { STUB_TOKEN, startGitHubStub } from "../helpers/github-stub";
import type { GitHubIo } from "../../src/bridge/github";
import { CIRCLE_V, envelopeText, makeMemberBody, makeRulesDocBody } from "../../src/share/bundle";
import { generateKeyPair, keyIdOf, openPlainKey, signBody, type PlainKey } from "../../src/share/sign";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const NEW_ROUTES = ROUTE_IDS.filter((id) => ROUTES[id].kind === "human" && id !== "commitTrial");
/** 人だけの経路の道と操作の名前 */
const R = (id: (typeof NEW_ROUTES)[number]) => ROUTES[id] as RouteDef & { path: string; action: HumanAction };

let tb: TestBridge | null = null;
let extra = "";
afterEach(async () => {
  await tb?.close();
  tb = null;
  if (extra) rmSync(extra, { recursive: true, force: true });
  extra = "";
});

async function tab(t: TestBridge) {
  const tb = new FakeTab(`ws://${t.host}/ws`, t.origin);
  await tb.opened;
  tb.send("tab.hello", { secret: SECRET_A, build: "test" });
  await tb.next("bridge.welcome");
  let n = 0;
  return {
    tab: tb,
    async token(action: HumanAction, payload: string): Promise<string> {
      const requestId = `r${++n}`;
      tb.send("tab.token_request", { requestId, action, payloadHash: sha(payload) });
      const tok = await tb.next("bridge.token");
      return tok.token as string;
    },
  };
}

const good = (t: TestBridge) => ({ "content-type": "application/json", origin: t.origin, "sec-fetch-site": "same-origin", [HEADER_TAB_SECRET]: SECRET_A });
const post = (t: TestBridge, path: string, headers: Record<string, string>, body: unknown) => http(t.bridge.port, "POST", path, headers, JSON.stringify(body));

describe("新しい人だけの経路は、どれも守りを越えさせない", () => {
  it("人だけの経路が増えた（確定・版・設定・輪・検問所）。どれも MCP のツールに無い", () => {
    expect(NEW_ROUTES.sort()).toEqual(["planCommit", "planFileRead", "planRevert", "planSign", "planStatus", "plansList", "planVersionRead", "commentAdd", "commentsList", "personKeyCreate", "personKeyConfirm", "ringCreate", "ringVerify", "ringMemberConfirm", "ringRulesAccept", "settingsRead", "settingsSave", "checkpointOpenText", "checkpointPreview", "checkpointSend", "photoAllow", "peersCompare", "readingsRead", "ledgerPreview", "ledgerSend", "ledgerPrs", "githubConnectStart", "githubConnectState", "githubDisconnect"].sort());
    for (const id of NEW_ROUTES) {
      const r: RouteDef = ROUTES[id];
      expect(r.requires).toEqual({ tabSecret: true, oneTimeToken: true });
      for (const n of [...TOOL_NAMES, ...EXPOSED_TOOL_NAMES]) expect(n).not.toBe(r.action);
    }
  });

  it.each(NEW_ROUTES)("%s：素の HTTP（Origin も秘密も無い）を拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const path = R(id).path;
    const t = await token(R(id).action, "{}");
    expect((await http(tb.bridge.port, "GET", path)).body.error.code).toBe("method_not_allowed");
    const r = await post(tb, path, { "content-type": "application/json" }, { token: t, payload: "{}" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("origin_missing");
  });

  it.each(NEW_ROUTES)("%s：タブの秘密が無ければ、正しい Origin と印でも拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    const r = await post(tb, R(id).path, { "content-type": "application/json", origin: tb.origin }, { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("secret_missing");
  });

  it.each(NEW_ROUTES)("%s：Origin の無い要求は、秘密と印がそろっていても拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    const r = await post(tb, R(id).path, { "content-type": "application/json", [HEADER_TAB_SECRET]: SECRET_A }, { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("origin_missing");
  });

  it.each(NEW_ROUTES)("%s：偽った Origin で秘密なしの要求を拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    const r = await post(tb, R(id).path, { "content-type": "application/json", origin: "http://evil.example" }, { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("origin_not_allowed");
  });

  it.each(NEW_ROUTES)("%s：使い終えた印を拒む", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    const first = await post(tb, R(id).path, good(tb), { token: t, payload: "{}" });
    expect(first.status).toBe(200);
    const again = await post(tb, R(id).path, good(tb), { token: t, payload: "{}" });
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe("token_unknown");
  });

  it.each(NEW_ROUTES)("%s：切れた印（120 秒）を拒む", async (id) => {
    let now = 1_000_000;
    tb = await startTestBridge({ now: () => now });
    const { token } = await tab(tb);
    const t = await token(R(id).action, "{}");
    now += 120_001;
    const r = await post(tb, R(id).path, good(tb), { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("token_expired");
  });

  it.each(NEW_ROUTES)("%s：ほかの操作に結んだ印では通らない", async (id) => {
    tb = await startTestBridge();
    const { token } = await tab(tb);
    const other: HumanAction = R(id).action === "plan_status" ? "settings_read" : "plan_status";
    const t = await token(other, "{}");
    const r = await post(tb, R(id).path, good(tb), { token: t, payload: "{}" });
    expect(r.body.error.code).toBe("token_mismatch");
  });
});

describe("正しいタブから：確定 → 輪を作る → 検問所 → 送る → 確かめる（Documents が日本語の OneDrive の下）", () => {
  it("端まで通る。中身の形が違う・理由が空のものは断る", async () => {
    // 輪のフォルダの道も固有名詞の照らす相手なので、乱数の英字（計画の語と偶然重なる）を入れない名前にする（数だけは照らさない）
    extra = join(tmpdir(), `moyai-human-${process.pid}-${Date.now()}`);
    mkdirSync(extra, { recursive: true });
    const docs = join(extra, "利用者", "OneDrive", "ドキュメント");
    const onedrive = join(extra, "利用者", "OneDrive");
    tb = await startTestBridge({ human: { platform: "win32", env: { OneDrive: onedrive }, shell: async () => ({ documents: docs, mounts: [] }), openText: () => {} } });
    const t = await tab(tb);
    const call = async (id: (typeof NEW_ROUTES)[number], payload: unknown) => {
      const text = JSON.stringify(payload);
      const tok = await t.token(R(id).action, text);
      const r = await post(tb!, R(id).path, good(tb!), { token: tok, payload: text });
      expect(r.status, id).toBe(200);
      return r.body;
    };

    // 設定：Documents は OneDrive の下、既定の置き場所はその下の MOYAI
    const s = await call("settingsRead", {});
    expect(s.documents).toBe(docs);
    expect(s.documentsSynced).toEqual({ kind: "onedrive", base: onedrive });
    expect(s.root).toBe(join(docs, "MOYAI"));
    expect(s.packs.find((p: { id: string }) => p.id === "waste-incineration")?.ready).toBe(true);
    expect((await call("settingsSave", { root: "相対の道" })).reason).toBe("rootInvalid");

    // 確定：人が受けていない決定（AI の当てはめ）を受け、理由つきで
    const plan = truthToPlan("fictional-1");
    const st = await call("planStatus", { planId: plan.planId });
    expect(st).toMatchObject({ ok: true, latest: null, synced: { kind: "onedrive" } });
    const ds = aiDecisions(plan);
    expect(ds.length).toBeGreaterThan(0);
    // 署名：呼び名が無ければ鍵を作れない。呼び名を決め、自分の鍵を作る（合言葉はやめた）
    expect((await call("personKeyCreate", {})).reason).toBe("nameMissing");
    expect((await call("planCommit", { plan, reason: "試験の確定", acceptances: [], basedOn: null })).reason).toBe("nameMissing");
    expect((await call("settingsSave", { root: null, name: "山田/課長" })).reason).toBe("nameInvalid");
    expect(await call("settingsSave", { root: null, name: "【架空】試験の人" })).toMatchObject({ ok: true, name: "【架空】試験の人" });
    expect((await call("planCommit", { plan, reason: "試験の確定", acceptances: [], basedOn: null })).reason).toBe("personKeyMissing");
    const key = await call("personKeyCreate", {});
    expect(key).toMatchObject({ ok: true, name: "【架空】試験の人" });
    expect((await call("personKeyCreate", {})).reason).toBe("personKeyExists");
    // 担当者の範囲の読み方の持ち主は、署名する人だけ（タブから来たほかの呼び名は断る。監査 D2）
    expect((await call("planCommit", { plan, reason: "試験の確定", acceptances: [], basedOn: null, readings: [{ skill: {}, by: "【架空】ほかの人", facilityKey: null }] })).reason).toBe("readingInvalid");
    expect((await call("planCommit", { plan, reason: "", acceptances: [], basedOn: null })).reason).toBe("reasonEmpty");
    expect((await call("planCommit", { plan, reason: "試験の確定", acceptances: [], basedOn: null })).reason).toBe("pendingDecisions");
    const c = await call("planCommit", { plan, reason: "試験の確定", acceptances: ds.map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" })), basedOn: null });
    expect(c).toMatchObject({ ok: true, version: 1 });
    // 版の一覧には、確かめた署名と、この PC の鍵として信じた印（own）と指紋
    const st1 = await call("planStatus", { planId: plan.planId });
    expect(st1.versions[0].signatures).toMatchObject([{ role: "confirm", by: "【架空】試験の人", trust: "own", fingerprint: key.fingerprint }]);
    expect(st1).toMatchObject({ name: "【架空】試験の人", hasKey: true });
    expect(existsSync(c.files.version)).toBe(true);
    expect(existsSync(c.files.report)).toBe(true);
    expect(c.files.version.startsWith(join(docs, "MOYAI", "plans"))).toBe(true);

    // 輪を作る
    const ringRoot = join(extra, "輪");
    const rc = await call("ringCreate", { root: ringRoot, packId: "waste-incineration" });
    expect(rc).toMatchObject({ ok: true });
    expect(rc.fingerprint).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);

    // 検問所：見え方が決まるまでは送れない。決まれば数はすべて 0、k ≥ 5
    const pv0 = await call("checkpointPreview", { planId: plan.planId, ringId: rc.ringId, answers: { facility: {}, inNationalTable: true } });
    expect(pv0.view.blockers).toContain("profileIncomplete");
    expect(pv0.questions.map((q: { key: string }) => q.key)).toEqual(["furnace", "capacity_t_per_day", "turbine", "ash", "contract"]);
    const answers = { facility: { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };
    const pv = await call("checkpointPreview", { planId: plan.planId, ringId: rc.ringId, answers });
    expect(pv.view.blockers).toEqual([]);
    expect(pv.view.counts).toEqual({ shape: 0, properNoun: 0, money: 0, freeText: 0, exactDate: 0 });
    expect(pv.view.k).toBeGreaterThanOrEqual(5);
    expect(sha(pv.view.bodyText)).toBe(pv.view.bodyHash);

    // 送る：人が押せば署名して置き、受け手と同じ関数で ✓
    const sent = await call("checkpointSend", { planId: plan.planId, version: 1, ringId: rc.ringId, answers, previewHash: pv.view.bodyHash });
    expect(sent).toMatchObject({ ok: true, seq: 1 });
    expect(sent.report.ok).toBe(true);
    const v = await call("ringVerify", { ringId: rc.ringId });
    // 仲間は 2 行：輪を作った人の鍵と、束に署名した施設の鍵（保管先の計画のフォルダ share/keys/。docs/plan.md §2.19）
    expect(v.report.lines.map((l: { kind: string; status: string }) => `${l.kind}:${l.status}`)).toEqual(["circle:ok", "member:ok", "member:ok", "bundle:ok"]);
    expect(readdirSync(join(docs, "MOYAI", "plans", plan.planId, "share", "keys"))).toEqual([`${rc.ringId}.json`]);
    expect(readdirSync(join(docs, "MOYAI", "plans", plan.planId, "share", "sent"))).toEqual([`${rc.ringId}.json`]);

    // 輪の仲間（監査 D1）：まだ確かめていない仲間は、指紋を読み合わせて確認済みにする（その輪に、その公開鍵の仲間のファイルがあるときだけ）
    const peer = generateKeyPair();
    const peerBody = makeMemberBody(rc.ringId, keyIdOf(peer.pub), peer.pub, "2026-11");
    writeFileSync(join(ringRoot, rc.ringId, "members", `${keyIdOf(peer.pub)}.json`), envelopeText(peerBody, signBody(peerBody, peer.privateKey)));
    const v2 = await call("ringVerify", { ringId: rc.ringId });
    expect(v2.report.lines.find((l: { kind: string; pub?: string }) => l.kind === "member" && l.pub === peer.pub)?.reasons).toEqual(["member.unconfirmed"]);
    expect((await call("ringMemberConfirm", { ringId: rc.ringId, pub: generateKeyPair().pub })).reason).toBe("keyUnknown");
    expect(await call("ringMemberConfirm", { ringId: rc.ringId, pub: peer.pub })).toMatchObject({ ok: true, key: keyIdOf(peer.pub) });
    const v3 = await call("ringVerify", { ringId: rc.ringId });
    expect(v3.report.lines.find((l: { kind: string; pub?: string }) => l.kind === "member" && l.pub === peer.pub)?.status).toBe("ok");

    // 輪の決まりが変わった（輪を作った人が、紛れる数の下限を 1 つ厳しくした）：差を見せ、人が受け入れるまで送らない
    const founderKey = openPlainKey(JSON.parse(readFileSync(join(tb.stateDir!, "keys", `${rc.ringId}.json`), "utf8")) as PlainKey)!;
    const circlePath = join(ringRoot, rc.ringId, "circle.json");
    const oldCircle = JSON.parse(readFileSync(circlePath, "utf8")).body;
    const nextBody = makeRulesDocBody(CIRCLE_V, oldCircle.founder, oldCircle.nonce, 2, "2026-11", { ...oldCircle.rules, minK: oldCircle.rules.minK + 1 });
    writeFileSync(circlePath, envelopeText(nextBody, signBody(nextBody, founderKey.privateKey)));
    const pvR = await call("checkpointPreview", { planId: plan.planId, ringId: rc.ringId, answers });
    expect(pvR.view.blockers).toContain("rules");
    expect(pvR.ring.rulesChange).toMatchObject({ loosened: 0, tightened: 1, rows: [{ rule: "minK", dir: "tightened" }], changer: { pub: oldCircle.founder, confirmed: true } });
    expect((await call("ringRulesAccept", { ringId: rc.ringId, rulesHash: "0".repeat(64) })).reason).toBe("previewChanged");
    expect(await call("ringRulesAccept", { ringId: rc.ringId, rulesHash: pvR.ring.rulesChange.rulesHash })).toMatchObject({ ok: true });
    const pvA = await call("checkpointPreview", { planId: plan.planId, ringId: rc.ringId, answers });
    expect(pvA.ring.rulesChange).toBeNull();
    expect(pvA.view.blockers).not.toContain("rules");

    // 版の履歴と戻す
    // EXPORT：確定した版の書き出しと差分レポートを読む。無い版は断る
    const ex = await call("planFileRead", { planId: plan.planId, version: 1, kind: "export" });
    expect(ex).toMatchObject({ ok: true, version: 1, kind: "export" });
    expect(Buffer.from(ex.base64, "base64").subarray(0, 2).toString()).toBe("PK");
    expect((await call("planFileRead", { planId: plan.planId, version: 1, kind: "report" })).ok).toBe(true);
    expect((await call("planFileRead", { planId: plan.planId, version: 9, kind: "export" })).reason).toBe("versionUnknown");
    const back = await call("planRevert", { planId: plan.planId, to: 1, reason: "試しに戻す", basedOn: 1 });
    expect(back).toMatchObject({ ok: true, version: 2 });
    // 版が変わったので、前の版で見た検問所からは送らない
    const stale = await call("checkpointSend", { planId: plan.planId, version: 1, ringId: rc.ringId, answers, previewHash: pv.view.bodyHash });
    expect(stale.reason).toBe("versionChanged");
    // 最新の版を書き換えると（確かめで合わない版）、検問所は開かず、送らない
    const vf = join(docs, "MOYAI", "plans", plan.planId, "versions", "000002.json");
    writeFileSync(vf, readFileSync(vf, "utf8").replace("試しに戻す", "書き換えた理由"));
    expect((await call("checkpointPreview", { planId: plan.planId, ringId: rc.ringId, answers })).reason).toBe("historyBroken");
    expect((await call("checkpointSend", { planId: plan.planId, version: 2, ringId: rc.ringId, answers, previewHash: pv.view.bodyHash })).reason).toBe("historyBroken");
  });
});

describe("受け手：似た施設と並べる（peers_compare）", () => {
  it("設定で選んだ台帳の clone を受け手の関数で読み、立場ごとに場を並べる。入札の対象が無ければ聞く", async () => {
    extra = join(tmpdir(), `moyai-peers-${process.pid}-${Date.now()}`);
    mkdirSync(extra, { recursive: true });
    const repo = join(extra, "台帳");
    const demo = buildLedgerDemo({ repo: fileURLToPath(new URL("../../", import.meta.url)), out: repo, state: join(extra, "demo-state"), month: "2026-11" });
    tb = await startTestBridge({ human: { shell: async () => ({ documents: join(extra, "Documents"), mounts: [] }) } });
    const t = await tab(tb);
    const call = async (id: "settingsSave" | "settingsRead" | "peersCompare", payload: unknown) => {
      const text = JSON.stringify(payload);
      const tok = await t.token(R(id).action, text);
      const r = await post(tb!, R(id).path, good(tb!), { token: tok, payload: text });
      expect(r.status, id).toBe(200);
      return r.body;
    };
    const answers = { facility: { furnace: "STOKER", capacity_t_per_day: "C200_400", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };
    const base = { packId: "waste-incineration", axes: null, answers, target: null, facility: null };

    // 台帳の場所をまだ選んでいない：場は missing、理由は notChosen
    const before = await call("peersCompare", { ...base, position: "municipal" });
    expect(before.places).toEqual([{ kind: "ledger", id: null, ok: false, reason: "ledger.notChosen", peers: 0, ng: 0 }]);
    expect(before.comparison.places).toEqual([{ kind: "ledger", id: null, status: "missing" }]);

    // 相対の道は断る。絶対の道を選ぶと、置き場所は前のまま
    expect((await call("settingsSave", { root: null, ledger: "相対の道" })).reason).toBe("ledgerInvalid");
    expect(await call("settingsSave", { root: null, ledger: repo })).toEqual({ ok: true, root: null, ledger: repo, name: null });
    expect((await call("settingsRead", {})).ledger).toBe(repo);
    expect((await call("settingsSave", { root: null })).ledger).toBe(repo);

    // 市町村：主要の軸（炉の型・処理能力の帯）で、台帳の ✓ の束から似た施設を並べる
    const m = await call("peersCompare", { ...base, position: "municipal" });
    expect(m.chosenAxes).toEqual(["furnace", "capacity_t_per_day"]);
    expect(m.places).toEqual([{ kind: "ledger", id: demo.ledgerId, ok: true, reason: null, peers: 10, ng: 0 }]);
    const shown = m.comparison.places[0];
    expect(shown).toMatchObject({ kind: "ledger", id: demo.ledgerId, status: "shown" });
    expect(shown.agg.similar.length).toBeGreaterThanOrEqual(3);
    expect(shown.agg.rows.length).toBeGreaterThan(0);

    // 軸を足すと似た施設は減る（増えない）
    const narrow = await call("peersCompare", { ...base, position: "municipal", axes: ["furnace", "capacity_t_per_day", "turbine", "ash", "contract"] });
    const n0 = narrow.comparison.places[0];
    expect(n0.status === "shown" ? n0.agg.similar.length : n0.similar).toBeLessThanOrEqual(shown.agg.similar.length);

    // 保全子会社：輪に入っていないので輪は missing、台帳は並ぶ
    const s = await call("peersCompare", { ...base, position: "subsidiary" });
    expect(s.comparison.places.map((p: { kind: string; status: string }) => [p.kind, p.status])).toEqual([
      ["ring", "missing"],
      ["ledger", "shown"],
    ]);

    // O&M：入札の対象の答えが無ければ比べず、聞く。入れれば並ぶ
    const o = await call("peersCompare", { ...base, position: "om" });
    expect(o).toMatchObject({ ok: true, comparison: null, reason: "targetMissing" });
    const o2 = await call("peersCompare", { ...base, position: "om", target: { ...answers, facility: { ...answers.facility, furnace: "FLUID" } } });
    expect(o2.comparison.places[0].kind).toBe("ledger");

    // 知らない立場・パックの形でないものは断る
    const bad = await call("peersCompare", { ...base, position: "知らない立場" });
    expect(bad).toMatchObject({ ok: false, reason: "payloadInvalid" });
  }, 60_000);
});

describe("公開の台帳へ出す（GitHub の代わりの試験の台。本物の GitHub では未確認）", () => {
  it("確定 → GitHub につなぐ（デバイスフロー）→ 束を見る → 署名して PR → 行方を読む → 接続を切る", async () => {
    extra = join(tmpdir(), `moyai-ledger-pr-${process.pid}-${Date.now()}`);
    mkdirSync(extra, { recursive: true });
    const repo = join(extra, "台帳");
    buildLedgerDemo({ repo: fileURLToPath(new URL("../../", import.meta.url)), out: repo, state: join(extra, "demo-state"), month: "2026-11" });
    mkdirSync(join(repo, ".git"), { recursive: true });
    writeFileSync(join(repo, ".git", "config"), `[remote "origin"]\n\turl = https://github.com/${"ledger-owner"}/moyai-ledger.git\n`);
    const stub = await startGitHubStub();
    try {
      const io: GitHubIo = { hosts: { web: stub.web, api: stub.api }, fetch: (u, i) => fetch(u, i), sleep: async () => {} };
      tb = await startTestBridge({ human: { shell: async () => ({ documents: join(extra, "Documents"), mounts: [] }), github: io, githubClientId: stub.clientId } });
      const t = await tab(tb);
      const call = async (id: (typeof NEW_ROUTES)[number], payload: unknown) => {
        const text = JSON.stringify(payload);
        const tok = await t.token(R(id).action, text);
        const r = await post(tb!, R(id).path, good(tb!), { token: tok, payload: text });
        expect(r.status, id).toBe(200);
        return r.body;
      };
      await call("settingsSave", { root: join(extra, "置き場所"), ledger: repo, name: "【架空】試験の人" });
      await call("personKeyCreate", {});
      const plan = truthToPlan("fictional-1");
      const ds = aiDecisions(plan);
      expect(await call("planCommit", { plan, reason: "試験の確定", acceptances: ds.map((d) => ({ id: d.id, hash: d.hash, reason: "画面で見て受けた" })), basedOn: null })).toMatchObject({ ok: true, version: 1 });
      const answers = { facility: { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };

      // つなぐ前：誰からも見えるあなたは出るが、台帳の決まりを受け入れていないので束のバイト列は無く、送れない。施設の鍵はまだメモリだけ
      const pv0 = await call("ledgerPreview", { planId: plan.planId, answers });
      expect(pv0).toMatchObject({ ok: true, github: { login: null, ready: true }, ledger: { repo: "ledger-owner/moyai-ledger", key: expect.stringMatching(/^[0-9a-f]{16}$/) } });
      expect(existsSync(join(extra, "置き場所", "plans", plan.planId, "share"))).toBe(false);
      expect(pv0.view.blockers).toContain("noKey");
      expect(pv0.view.bodyHash).toBeNull();
      expect(pv0.view.k).toBeGreaterThanOrEqual(5);

      // GitHub につなぐ：台帳の決まりを受け入れ、デバイスフローのコードを返す。人が github.com で入れるまで待つ
      const st = await call("githubConnectStart", { packId: "waste-incineration" });
      expect(st).toMatchObject({ ok: true, userCode: "WDJB-MJHT", acceptedNow: true });
      expect(await call("githubConnectState", {})).toMatchObject({ ok: true, state: "waiting" });
      stub.approve(); // 試験の台本が押した（人が github.com でコードを入れた）
      let state = "waiting";
      for (let i = 0; i < 40 && state === "waiting"; i++) {
        await new Promise((r) => setTimeout(r, 200));
        state = (await call("githubConnectState", {})).state;
      }
      expect(state).toBe("ok");
      expect((await call("settingsRead", {})).github).toBe("moyai-test");
      // トークンは状態フォルダに置く（包まない。運営者の決定 2026-11-04）。画面に返す答えには入れない
      expect(JSON.parse(readFileSync(join(tb.stateDir!, "github.json"), "utf8")).v).toBe("moyai.github/1");
      expect(JSON.stringify(await call("settingsRead", {}))).not.toContain(STUB_TOKEN);
      expect(JSON.stringify(await call("githubConnectState", {}))).not.toContain(STUB_TOKEN);

      // 束を見る → 人が押すと PR を 1 つ出す
      const pv = await call("ledgerPreview", { planId: plan.planId, answers });
      expect(pv.github.login).toBe("moyai-test");
      expect(pv.view.blockers).toEqual([]);
      expect(sha(pv.view.bodyText)).toBe(pv.view.bodyHash);
      expect(stub.prs).toHaveLength(0);
      const sent = await call("ledgerSend", { planId: plan.planId, version: 1, answers, previewHash: pv.view.bodyHash });
      expect(sent).toMatchObject({ ok: true, pr: 1, seq: 1, login: "moyai-test" });
      expect(Object.keys(stub.prs[0]!.files)).toEqual([sent.path]);
      expect(stub.prs[0]!.body).not.toContain(plan.displayName);

      // 前の束が台帳に載るまでは、次の束は出さない。行方は公開の PR から読む
      expect((await call("ledgerPreview", { planId: plan.planId, answers })).view.blockers).toContain("pending");
      expect((await call("ledgerSend", { planId: plan.planId, version: 1, answers, previewHash: pv.view.bodyHash })).reason).toBe("ledgerPending");
      const prs = await call("ledgerPrs", { packId: "waste-incineration" });
      expect(prs.prs).toMatchObject([{ pr: 1, seq: 1, version: 1, status: { state: "open", check: "pending" } }]);

      // 接続を切ると、トークンのファイルは消え、出せない
      expect(await call("githubDisconnect", {})).toEqual({ ok: true });
      expect((await call("settingsRead", {})).github).toBeNull();
      expect(existsSync(join(tb.stateDir!, "github.json"))).toBe(false);
    } finally {
      await stub.close();
    }
  }, 60_000);
});
