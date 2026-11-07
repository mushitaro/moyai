// SHARE の送信経路（docs/screens.md §3.6「送信経路」）：既定は GitHub につないでいれば GitHub［名］、いなければ MOYAI 経由。
// MOYAI 経由は受け口があるときだけ。人が選んだ経路は、つないでいるあいだ効く。MOYAI 経由では GitHub の未接続を押せない理由にしない。
import { describe, expect, it } from "vitest";
import { routeBlockers, shareRouteOf } from "../../src/app/state/share-route";

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
