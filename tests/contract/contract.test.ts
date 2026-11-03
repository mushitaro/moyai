// contract（docs/plan.md §5.1）：イベント・ツール・誤りの型の送り手と受け手。どちらかが無い型 0。
// 型の解析に頼らず、一覧で数える。送り手は送る側のフォルダのソースから、受け手は受け手の一覧から数える。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRIDGE_EVENT_HANDLERS } from "../../src/app/bridge-client";
import { ERROR_TEXT } from "../../src/app/text";
import { TAB_EVENT_HANDLERS } from "../../src/bridge/tab";
import { ERRORS, ERROR_CODES, type ErrorSide } from "../../src/shared/errors";
import { EVENTS, EVENT_TYPES, type EventSide } from "../../src/shared/events";
import { ROUTES, ROUTE_IDS, type RouteDef } from "../../src/shared/routes";
import { EXPOSED_TOOL_NAMES, TOOLS, TOOL_NAMES } from "../../src/shared/tools";
import { BRIDGE_TOOL_RECEIVERS } from "../../src/bridge/tools";
import { createRelayServer } from "../../src/cli/relay";
import toolNames from "../../src/shared/tool-names.json";

function sources(dir: string): string {
  let out = "";
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out += sources(p);
    else if (/\.(ts|tsx)$/.test(e.name)) out += `\n${readFileSync(p, "utf8")}`;
  }
  return out;
}

const EVENT_SENDER_DIRS: Record<EventSide, string> = { tab: "src/app", bridge: "src/bridge" };
const ERROR_SENDER_SOURCES: Record<ErrorSide, string> = {
  bridge: sources("src/bridge"),
  relay: readFileSync("src/cli/relay.ts", "utf8"),
  cli: readFileSync("src/cli/main.ts", "utf8"),
  tab: sources("src/app"),
};

describe("イベントの送り手と受け手", () => {
  it.each(EVENT_TYPES)("%s には送るコードと受ける処理がある", (type) => {
    const def = EVENTS[type];
    expect(def.from).not.toBe(def.to);
    const src = sources(EVENT_SENDER_DIRS[def.from]);
    const re = new RegExp(`send\\w*\\([^"\\n]*"${type.replace(".", "\\.")}"`);
    expect(re.test(src), `送り手（${def.from}）が ${type} を送っていない`).toBe(true);
    const receivers: Record<EventSide, Record<string, unknown>> = { bridge: TAB_EVENT_HANDLERS, tab: BRIDGE_EVENT_HANDLERS };
    expect(Object.keys(receivers[def.to]), `受け手（${def.to}）に ${type} の処理が無い`).toContain(type);
  });

  it("受け手の一覧に、一覧に無いイベントが無い", () => {
    for (const k of [...Object.keys(TAB_EVENT_HANDLERS), ...Object.keys(BRIDGE_EVENT_HANDLERS)]) expect(EVENT_TYPES).toContain(k);
  });
});

describe("誤りの送り手と受け手", () => {
  it.each(ERROR_CODES)("%s には送り手のコードと、受け手に見せる文がある", (code) => {
    const def = ERRORS[code];
    expect(ERROR_SENDER_SOURCES[def.from].includes(`"${code}"`), `送り手（${def.from}）が ${code} を出していない`).toBe(true);
    if (def.to === "tab") expect((ERROR_TEXT as Record<string, string>)[code], `画面の言葉に ${code} が無い`).toBeTruthy();
    else expect(def.text.length).toBeGreaterThan(0);
  });

  it("画面の言葉に、受け手が tab でない誤りが混ざっていない", () => {
    for (const k of Object.keys(ERROR_TEXT)) expect(ERRORS[k as keyof typeof ERRORS].to).toBe("tab");
  });

  it("AI に返す文は、受け手が ai の誤りのものだけを中継が使う（中継は ERRORS の文をそのまま返す）", () => {
    expect(readFileSync("src/cli/relay.ts", "utf8")).toContain("errorBody(");
  });
});

describe("ツールの送り手と受け手", () => {
  it("tool-names.json と TOOLS が同じ 12。中継が出すのは今見せるものだけ", () => {
    expect(toolNames).toHaveLength(12);
    expect(Object.keys(TOOLS).sort()).toEqual([...toolNames].sort());
    expect(TOOL_NAMES).toEqual(toolNames);
    for (const n of TOOL_NAMES) expect(TOOLS[n].name).toBe(n);
    const server = createRelayServer({ stateDir: "unused" });
    const registered = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    expect(registered.sort()).toEqual([...EXPOSED_TOOL_NAMES].sort());
    // 見せないものは、待っている画面の名前を持つ
    for (const n of TOOL_NAMES.filter((x) => !EXPOSED_TOOL_NAMES.includes(x))) expect(TOOLS[n].waitsFor, n).not.toBeNull();
  });

  it("どのツールにも、橋渡しの側の受け手（処理か「未実装」）が一覧である。未実装の数を出す", () => {
    expect(Object.keys(BRIDGE_TOOL_RECEIVERS).sort()).toEqual([...TOOL_NAMES].sort());
    const notImplemented = TOOL_NAMES.filter((n) => BRIDGE_TOOL_RECEIVERS[n] === "not_implemented");
    console.log(`contract: ツール ${TOOL_NAMES.length} のうち未実装 ${notImplemented.length}（今見せるもの ${EXPOSED_TOOL_NAMES.length}）`);
    // 作業画面へ渡すもの：取り込みの 3 つ、星取表の行、当てはめの案。処理を足したら、この数を減らす
    expect(TOOL_NAMES.filter((n) => BRIDGE_TOOL_RECEIVERS[n] === "tab").sort()).toEqual(["chart_rows", "crosswalk_propose", "intake_compose", "intake_settle", "intake_survey"]);
    expect(notImplemented).toHaveLength(7);
  });

  it("確定・送る・昇格・保存のツールが無い", () => {
    for (const n of TOOL_NAMES) expect(n).not.toMatch(/commit|confirm|send|submit|promote|save|accept/);
  });
});

describe("経路の許可の一覧", () => {
  it("人だけの経路は、タブの秘密と 1 回きりの印の両方を求める", () => {
    const human = ROUTE_IDS.filter((id) => ROUTES[id].kind === "human");
    expect(human.length).toBeGreaterThan(0);
    for (const id of human) {
      const r: RouteDef = ROUTES[id];
      expect(r.requires, id).toEqual({ tabSecret: true, oneTimeToken: true });
      expect(r.method, id).toBe("POST");
      expect(r.action, id).toBeTruthy();
    }
  });

  it("人だけの経路を呼ぶのは画面だけ（中継は呼ばない）", () => {
    const relay = readFileSync("src/cli/relay.ts", "utf8");
    for (const id of ROUTE_IDS.filter((i) => ROUTES[i].kind === "human")) {
      expect(relay).not.toContain(`ROUTES.${id}`);
      expect(sources("src/app")).toContain(`ROUTES.${id}.path`);
    }
  });
});
