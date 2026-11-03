// src/shared の型、1 回きりの印の店、状態フォルダの場所、引数の読み方、Ed25519 の見本。
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makeEd25519Sample } from "../../src/bridge/selftest";
import { resolveStateDir } from "../../src/bridge/state";
import { TokenStore } from "../../src/bridge/tokens";
import { checkFetchSite, checkHost, checkOrigin } from "../../src/bridge/guard";
import { parseStartArgs } from "../../src/cli/args";
import { refused } from "../../src/cli/relay";
import { listenErrorCode } from "../../src/bridge/server";
import { decodeEvent, encodeEvent } from "../../src/shared/events";
import { AUTHOR_KINDS, ENTITIES, FIELD_REFS, fieldDef } from "../../src/shared/fields";
import { errorBody } from "../../src/shared/errors";
import { RULE_MAX_VALUES, TOOLS, ruleSchema, statRowOf } from "../../src/shared/tools";
import { STAMP_ENV, sharedBuildStamp } from "../../scripts/build-stamp.mjs";

describe("作者の種類", () => {
  it("人・AI・AI（チャットでの人の答え）・AI（読み取り）・決まり（コード）の 5 つを、どの作者の欄も使う", () => {
    expect(AUTHOR_KINDS).toEqual(["human", "ai", "ai_relayed_human", "ai_reading", "rule_code"]);
    expect(fieldDef("assetNode.commonItemAuthor").values).toEqual(AUTHOR_KINDS);
    expect(fieldDef("workDetail.author").values).toEqual(AUTHOR_KINDS);
  });
});

describe("仲間の統計の行", () => {
  // 帯の値は計画（§2.8）に書いてある端の値だけを使う。境目は 11-05 に決める
  it("帯のコードだけを通し、生の数と、ほかの欄の帯を通さない", () => {
    const interval = statRowOf("interval");
    const manDays = statRowOf("manDays");
    const days = statRowOf("days");
    expect(interval.safeParse({ shown: "x" }).success).toBe(true);
    expect(interval.safeParse({ shown: "range", n: 3, low: "I1", high: "I16_30" }).success).toBe(true);
    expect(manDays.safeParse({ shown: "median", n: 7, median: "W1_9", q1: "W1_9", q3: "W1000P" }).success).toBe(true);
    expect(days.safeParse({ shown: "median", n: 5, median: "D1_3", q1: "D1_3", q3: "D121P" }).success).toBe(true);
    expect(manDays.safeParse({ shown: "median", n: 7, median: 12, q1: "W1_9", q3: "W1000P" }).success).toBe(false);
    expect(days.safeParse({ shown: "median", n: 4, median: "D1_3", q1: "D1_3", q3: "D121P" }).success).toBe(false);
    expect(interval.safeParse({ shown: "range", n: 2, low: "I1", high: "I16_30" }).success).toBe(false);
    expect(interval.safeParse({ shown: "range", n: 3, low: "W1_9", high: "W1000P" }).success).toBe(false);
    expect(manDays.safeParse({ shown: "range", n: 3, low: "D1_3", high: "D121P" }).success).toBe(false);
    const agg = TOOLS.peer_reference.output.shape.aggregates.element;
    expect(Object.keys(agg.shape).sort()).toEqual(["commonItem", "days", "interval", "manDays", "place", "work"]);
  });
});

describe("ビルドの印", () => {
  it("scripts/build.mjs が 1 回作った印を、画面と CLI の設定が同じに読む", () => {
    const env = { [STAMP_ENV]: JSON.stringify({ time: "2026-11-03 12:34", commit: "abcdef0" }) };
    expect(sharedBuildStamp(env)).toEqual({ time: "2026-11-03 12:34", commit: "abcdef0" });
    expect(sharedBuildStamp({}).time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe("欄の名前", () => {
  it("芯のデータの形の 5 つ（施設・資産の節・作業・作業明細・計量値）がある", () => {
    expect(Object.values(ENTITIES).map((e) => e.label)).toEqual(["施設", "資産の節", "作業", "作業明細", "計量値"]);
    expect(FIELD_REFS).toContain("workDetail.planOrActual");
    expect(fieldDef("workDetail.cost").neverShared).toBe(true);
    expect(fieldDef("workDetail.performer").neverShared).toBe(true);
    expect(new Set(FIELD_REFS).size).toBe(FIELD_REFS.length);
  });
});

describe("規則の形", () => {
  const base = { set: { field: "work.strategy", value: "time_based" }, reason: "理由" };
  it("欄 × 比べ方 × 値の組を受ける", () => {
    expect(ruleSchema.safeParse({ ...base, when: [{ field: "work.kind", op: "equals", values: ["a"] }] }).success).toBe(true);
    expect(ruleSchema.safeParse({ ...base, when: [{ field: "workDetail.fiscalYear", op: "range", values: [2020, 2025] }] }).success).toBe(true);
  });
  it(`値の組は ${RULE_MAX_VALUES} 個まで`, () => {
    const v = (n: number) => Array.from({ length: n }, (_, i) => String(i));
    expect(ruleSchema.safeParse({ ...base, when: [{ field: "work.kind", op: "in", values: v(20) }] }).success).toBe(true);
    expect(ruleSchema.safeParse({ ...base, when: [{ field: "work.kind", op: "in", values: v(21) }] }).success).toBe(false);
  });
  it("一覧に無い欄・範囲の値の数違い・理由なしは受けない", () => {
    expect(ruleSchema.safeParse({ ...base, when: [{ field: "work.nope", op: "equals", values: ["a"] }] }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, when: [{ field: "work.kind", op: "range", values: [1] }] }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, when: [{ field: "work.kind", op: "equals", values: ["a", "b"] }] }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, reason: "", when: [{ field: "work.kind", op: "equals", values: ["a"] }] }).success).toBe(false);
  });
});

describe("イベントの形", () => {
  it("送り手の向きが違うもの・型に合わないものは読まない", () => {
    const hello = encodeEvent("tab.hello", { secret: "A".repeat(43), build: "x" });
    expect(decodeEvent(hello, "tab")?.type).toBe("tab.hello");
    expect(decodeEvent(hello, "bridge")).toBeNull();
    expect(decodeEvent('{"type":"tab.hello","data":{"secret":"x"}}', "tab")).toBeNull();
    expect(decodeEvent("not json", "tab")).toBeNull();
  });
});

describe("1 回きりの印", () => {
  it("1 回で消え、切れ、操作・中身・タブの回に結ばれる", () => {
    let now = 0;
    const s = new TokenStore(120_000, () => now);
    const a = s.issue("commit_trial", "h", "s1");
    expect(s.consume(a.token, "commit_trial", "h", "s1")).toBeNull();
    expect(s.consume(a.token, "commit_trial", "h", "s1")).toBe("token_unknown");
    const b = s.issue("commit_trial", "h", "s1");
    now = 120_001;
    expect(s.consume(b.token, "commit_trial", "h", "s1")).toBe("token_expired");
    now = 0;
    const c = s.issue("commit_trial", "h", "s1");
    expect(s.consume(c.token, "commit_trial", "h", "s2")).toBe("token_mismatch");
    expect(s.consume(undefined, "commit_trial", "h", "s1")).toBe("token_missing");
  });
});

describe("網の外側の判定", () => {
  it("Host・Origin・Sec-Fetch-Site", () => {
    expect(checkHost("127.0.0.1:43110", 43110)).toBeNull();
    expect(checkHost("localhost:43110", 43110)).toBeNull();
    expect(checkHost("attacker.example:43110", 43110)).toBe("host_not_allowed");
    expect(checkHost(undefined, 43110)).toBe("host_not_allowed");
    expect(checkOrigin(undefined, "127.0.0.1:1", 1, true)).toBe("origin_missing");
    expect(checkOrigin(undefined, "127.0.0.1:1", 1, false)).toBeNull();
    expect(checkOrigin("http://127.0.0.1:1", "127.0.0.1:1", 1, true)).toBeNull();
    expect(checkOrigin("http://localhost:1", "127.0.0.1:1", 1, true)).toBe("origin_not_allowed");
    expect(checkOrigin("null", "127.0.0.1:1", 1, true)).toBe("origin_not_allowed");
    expect(checkFetchSite("same-site", true)).toBe("fetch_site_not_allowed");
    expect(checkFetchSite("none", false)).toBe("fetch_site_not_allowed");
    expect(checkFetchSite("none", true)).toBeNull();
  });
});

describe("起動と中継の誤りの読み替え", () => {
  it("待ち受けの誤り：使われている → port_in_use、権限で断られた → port_denied、ほかはそのまま", () => {
    expect(listenErrorCode({ code: "EADDRINUSE" })).toBe("port_in_use");
    expect(listenErrorCode({ code: "EACCES" })).toBe("port_denied");
    expect(listenErrorCode({ code: "EINVAL" })).toBeNull();
    expect(errorBody("port_denied", { port: 80 }).error.message).toContain("ポート 80");
  });
  it("接続を拒まれた誤りは、AggregateError の中にあっても見分ける", () => {
    expect(refused({ code: "ECONNREFUSED" })).toBe(true);
    expect(refused(new AggregateError([Object.assign(new Error("x"), { code: "ECONNREFUSED" })]))).toBe(true);
    expect(refused({ code: "ECONNRESET" })).toBe(false);
    expect(refused(undefined)).toBe(false);
  });
});

describe("状態フォルダと引数", () => {
  it("環境変数があればそこ、無ければ OS ごとの場所（読み書きはしない）", () => {
    expect(resolveStateDir({ MOYAI_STATE_DIR: "/tmp/x" }, "win32")).toBe("/tmp/x");
    expect(resolveStateDir({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32").replace(/\\/g, "/")).toBe(
      "C:/Users/u/AppData/Local/MOYAI/state",
    );
    expect(resolveStateDir({ XDG_STATE_HOME: "/h/.state" }, "linux").replace(/\\/g, "/")).toBe("/h/.state/moyai");
  });
  it("start の引数", () => {
    expect(parseStartArgs([])).toEqual({ port: 43110, open: true });
    expect(parseStartArgs(["--port", "43111", "--no-open"])).toEqual({ port: 43111, open: false });
    expect(parseStartArgs(["--port=8080"])).toEqual({ port: 8080, open: true });
    expect(parseStartArgs(["--port", "0"])).toBeNull();
    expect(parseStartArgs(["--port", "x"])).toBeNull();
    expect(parseStartArgs(["--other"])).toBeNull();
  });
  it("誤りの文に値を差し込む", () => {
    expect(errorBody("port_in_use", { port: 43110 }).error.message).toContain("ポート 43110");
  });
});

describe("Ed25519 の見本", () => {
  it("Node の署名を WebCrypto（Node の）で検証でき、1 文字変えた文は通らない", async () => {
    const s = makeEd25519Sample();
    const key = await webcrypto.subtle.importKey("jwk", s.publicKeyJwk, { name: "Ed25519" }, false, ["verify"]);
    const sig = Buffer.from(s.signature, "base64url");
    expect(await webcrypto.subtle.verify("Ed25519", key, sig, Buffer.from(s.message, "base64url"))).toBe(true);
    expect(await webcrypto.subtle.verify("Ed25519", key, sig, Buffer.from(s.tamperedMessage, "base64url"))).toBe(false);
    expect(s.message).not.toBe(s.tamperedMessage);
  });
});
