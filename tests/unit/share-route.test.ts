// SHARE の送信経路（docs/screens.md §3.6「送信経路」）：既定は GitHub につないでいれば GitHub［名］、いなければ MOYAI 経由。
// MOYAI 経由は受け口があるときだけ。人が選んだ経路は、つないでいるあいだ効く。MOYAI 経由では GitHub の未接続を押せない理由にしない。
import { describe, expect, it } from "vitest";
import { lastSegment, ringLabels, routeBlockers, shareRouteOf } from "../../src/app/state/share-route";

describe("送信経路の決め方", () => {
  it("既定：つないでいれば GitHub［名］、つないでいなければ MOYAI 経由。受け口が無ければ GitHub だけ", () => {
    expect(shareRouteOf({ login: "moyai-test", intake: true, chosen: null })).toBe("github");
    expect(shareRouteOf({ login: null, intake: true, chosen: null })).toBe("intake");
    expect(shareRouteOf({ login: null, intake: false, chosen: null })).toBe("github");
    expect(shareRouteOf({ login: "moyai-test", intake: false, chosen: null })).toBe("github");
  });

  it("人が選んだ経路（施設ごとに覚えたもの）は、つないでいるあいだ効く。受け口が無くなれば GitHub、つないでいなければ MOYAI 経由", () => {
    expect(shareRouteOf({ login: "moyai-test", intake: true, chosen: "intake" })).toBe("intake");
    expect(shareRouteOf({ login: "moyai-test", intake: true, chosen: "github" })).toBe("github");
    expect(shareRouteOf({ login: "moyai-test", intake: false, chosen: "intake" })).toBe("github");
    expect(shareRouteOf({ login: null, intake: true, chosen: "github" })).toBe("intake");
  });

  it("MOYAI 経由では GitHub の未接続（noKey）を押せない理由にしない。ほかの理由は残す", () => {
    expect(routeBlockers("intake", ["noKey"])).toEqual([]);
    expect(routeBlockers("intake", ["noKey", "pending"])).toEqual(["pending"]);
    expect(routeBlockers("github", ["noKey", "pending"])).toEqual(["noKey", "pending"]);
  });
});

describe("共有フォルダの選びの名前", () => {
  it("設定で選んだフォルダの最後の名前を出し、内部の ID は出さない（値は ID のまま）", () => {
    const m = ringLabels([
      { ringId: "0123456789abcdef", root: "C:\\Users\\a\\OneDrive\\共有フォルダ\\" },
      { ringId: "fedcba9876543210", root: "/mnt/share/近隣3施設" },
    ]);
    expect(m.get("0123456789abcdef")).toBe("共有フォルダ");
    expect(m.get("fedcba9876543210")).toBe("近隣3施設");
  });

  it("同じ名前が 2 つあれば、ID の頭 4 字を括弧で添えて分ける", () => {
    const m = ringLabels([
      { ringId: "aaaa000000000000", root: "D:\\x\\共有" },
      { ringId: "bbbb000000000000", root: "E:\\y\\共有" },
      { ringId: "cccc000000000000", root: "E:\\y\\別" },
    ]);
    expect([...m.values()]).toEqual(["共有（aaaa）", "共有（bbbb）", "別"]);
  });

  it("道の最後の名前：区切りが \\ でも / でも、末尾に区切りがあっても", () => {
    expect(lastSegment("C:\\a\\b\\")).toBe("b");
    expect(lastSegment("/a/b")).toBe("b");
    expect(lastSegment("b")).toBe("b");
  });
});
