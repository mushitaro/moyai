// 署名のダイアログを頼むことで「確定する」と「渡す」に分け、署名した版を年度で呼ぶ（docs/screens.md §3.4 の末尾、docs/words.md。仕事 sign-words-v1）。
// - 題と主ボタン：自分で確定する「第 n 版に署名して確定する」「署名して確定する」、編集・承認を頼む「第 n 版に署名して渡す」「署名して渡す」。
// - 版の呼び名：署名した日の年度（施設の年度の始まりで数える）を和暦で「令和 8 年度版（第 1 版）」。結果の 1 文とトップの版の履歴の行だけ。
//   渡したとき・差し戻し・編集中の版には付けない。時刻は日本時間で数える。
// 画面のダイアログは Mantine の Modal（ポータル）で react-dom/server では描けないので、題・主ボタン・結果の 1 文・トップの行の字を作る関数を試す。
import { describe, expect, it } from "vitest";
import { signDialogWords, signDoneLine } from "../../src/app/components/ConfirmDialog";
import { rowVersionLabel, type ListedPlan, type ListedVersion } from "../../src/app/components/MoyaiTop";
import { signResultLine } from "../../src/app/components/SignDialog";
import { HUMAN_TEXT, TEXT } from "../../src/app/text";
import { signedFiscalYear, tokyoYmd, versionName } from "../../src/app/version-name";

/** 日本時間の時刻（ISO） */
const jst = (s: string) => `${s}+09:00`;

describe("署名のダイアログの題と主ボタン（頼むことで替える）", () => {
  it("渡さずに自分で確定する：題「第 n 版に署名して確定する」、主ボタン「署名して確定する」", () => {
    expect(signDialogWords("self", 1)).toEqual({ title: "第 1 版に署名して確定する", submit: "署名して確定する" });
    expect(signDialogWords("self", 7)).toEqual({ title: "第 7 版に署名して確定する", submit: "署名して確定する" });
  });

  it("編集を頼む・承認を頼む：題「第 n 版に署名して渡す」、主ボタン「署名して渡す」", () => {
    for (const ask of ["edit", "approve"] as const) expect(signDialogWords(ask, 7), ask).toEqual({ title: "第 7 版に署名して渡す", submit: "署名して渡す" });
  });

  it("自分で確定すると渡すで、題も主ボタンも違う。自分で確定するときに「渡す」「承認して署名する」を使わない", () => {
    const self = signDialogWords("self", 2);
    const handoff = signDialogWords("approve", 2);
    expect(self.title).not.toBe(handoff.title);
    expect(self.submit).not.toBe(handoff.submit);
    expect(`${self.title}${self.submit}`).not.toContain("渡す");
    expect(self.submit).not.toBe(HUMAN_TEXT.approve.submitApprove);
  });

  it("下の帯から開く主ボタンは「署名して確定する」。承認を頼まれた人の「承認して署名する」は今のまま", () => {
    expect(TEXT.merge.sign).toBe("署名して確定する");
    expect(TEXT.merge.approve).toBe("承認して署名する");
    expect(HUMAN_TEXT.approve.submitApprove).toBe("承認して署名する");
    expect(HUMAN_TEXT.request.renewSubmit).toBe("署名して渡す");
  });
});

describe("署名した日の年度（施設の年度の始まりで数える、和暦）", () => {
  it("4 月始まり：2026-03-31 は令和 7 年度、2026-04-01 は令和 8 年度", () => {
    expect(signedFiscalYear(jst("2026-03-31T23:59:59"), 4)).toEqual({ era: "令和", year: 7 });
    expect(signedFiscalYear(jst("2026-04-01T00:00:00"), 4)).toEqual({ era: "令和", year: 8 });
    expect(signedFiscalYear(jst("2027-03-31T12:00:00"), 4)).toEqual({ era: "令和", year: 8 });
  });

  it("日本時間で数える：UTC の 2026-03-31T15:00Z は日本時間の 4 月 1 日なので令和 8 年度", () => {
    expect(tokyoYmd("2026-03-31T15:00:00.000Z")).toEqual({ y: 2026, m: 4, d: 1 });
    expect(signedFiscalYear("2026-03-31T14:59:59.999Z", 4)).toEqual({ era: "令和", year: 7 });
    expect(signedFiscalYear("2026-03-31T15:00:00.000Z", 4)).toEqual({ era: "令和", year: 8 });
  });

  it("1 月始まりの施設：年度は暦の年。2025-12-31 は令和 7 年度、2026-01-01 と 2026-03-31 は令和 8 年度", () => {
    expect(signedFiscalYear(jst("2025-12-31T23:59:59"), 1)).toEqual({ era: "令和", year: 7 });
    expect(signedFiscalYear(jst("2026-01-01T00:00:00"), 1)).toEqual({ era: "令和", year: 8 });
    expect(signedFiscalYear(jst("2026-03-31T12:00:00"), 1)).toEqual({ era: "令和", year: 8 });
  });

  it("元号は署名した日のもの。年度が前の元号の年に始まっていれば、年度の初日の元号で数える", () => {
    expect(signedFiscalYear(jst("2019-04-15T10:00:00"), 4)).toEqual({ era: "平成", year: 31 });
    expect(signedFiscalYear(jst("2019-06-01T10:00:00"), 4)).toEqual({ era: "令和", year: 1 });
    expect(signedFiscalYear(jst("1989-02-01T10:00:00"), 4)).toEqual({ era: "昭和", year: 63 });
    expect(HUMAN_TEXT.versionName.fiscalYear("令和", 1)).toBe("令和元年度");
    expect(HUMAN_TEXT.versionName.fiscalYear("令和", 8)).toBe("令和 8 年度");
  });

  it("読めない時刻・1〜12 でない始まりの月は null（推測で埋めない）", () => {
    expect(signedFiscalYear("きのう", 4)).toBeNull();
    expect(signedFiscalYear(jst("2026-04-01T00:00:00"), 0)).toBeNull();
    expect(signedFiscalYear(jst("2026-04-01T00:00:00"), 13)).toBeNull();
    expect(signedFiscalYear(jst("2026-04-01T00:00:00"), 4.5)).toBeNull();
  });
});

describe("版の呼び名「令和 n 年度版（第 m 版）」", () => {
  it("署名した版は年度で呼ぶ。署名の前・年度の始まりが分からない・時刻が読めないときは「第 m 版」", () => {
    expect(versionName(1, jst("2026-11-07T13:00:00"), 4)).toBe("令和 8 年度版（第 1 版）");
    expect(versionName(1, null, 4)).toBe("第 1 版");
    expect(versionName(1, jst("2026-11-07T13:00:00"), undefined)).toBe("第 1 版");
    expect(versionName(1, "きのう", 4)).toBe("第 1 版");
  });

  it("同じ年度に版が 2 つあっても、括弧の第 m 版で分かれる", () => {
    const a = versionName(1, jst("2026-05-10T09:00:00"), 4);
    const b = versionName(2, jst("2027-02-20T09:00:00"), 4);
    expect(a).toBe("令和 8 年度版（第 1 版）");
    expect(b).toBe("令和 8 年度版（第 2 版）");
    expect(a).not.toBe(b);
  });

  it("結果の 1 文：自分で確定「令和 8 年度版（第 1 版）を確定しました。」、渡したときは年度なしで今のまま", () => {
    const at = jst("2026-11-07T13:00:00");
    expect(signDoneLine({ version: 1, at, startMonth: 4 }, null)).toBe("令和 8 年度版（第 1 版）を確定しました。");
    expect(signDoneLine({ version: 2, at: jst("2026-03-31T18:00:00"), startMonth: 4 }, null)).toBe("令和 7 年度版（第 2 版）を確定しました。");
    expect(signDoneLine({ version: 1, at, startMonth: 4 }, { to: "kacho@example.jp" })).toBe("第 1 版に署名して、kacho@example.jp へのメールを用意しました。");
  });

  it("結果の 1 文：承認「令和 8 年度版（第 1 版）を承認しました。」、差し戻しは年度なしで今のまま", () => {
    const at = jst("2026-11-07T13:00:00");
    expect(signResultLine("approve", 1, at, 4)).toBe("令和 8 年度版（第 1 版）を承認しました。");
    expect(signResultLine("return", 1, at, 4)).toBe("第 1 版を差戻しました。");
  });
});

const v = (version: number, roles: string[], signedAt: string | null, extra: Partial<ListedVersion> = {}): ListedVersion => ({
  version,
  at: signedAt ?? jst("2026-05-01T09:00:00"),
  contentHash: "0".repeat(64),
  roles,
  by: "【架空】試験の担当",
  problem: null,
  legacy: false,
  signedAt,
  ...extra,
});
/** fiscalYearStartMonth が null なら、年度の始まりを返さない古い橋渡しの形（欄が無い） */
const plan = (versions: ListedVersion[], turn: ListedPlan["turn"] = null, fiscalYearStartMonth: number | null = 4): ListedPlan => ({
  planId: "plan-test",
  displayName: "【架空】試験の施設",
  fictional: true,
  ...(fiscalYearStartMonth === null ? {} : { fiscalYearStartMonth }),
  versions,
  turn,
  derivedFrom: null,
});

describe("トップの版の履歴の行", () => {
  it("確定した版（自分で確定・承認）は「令和 n 年度版（第 m 版）」", () => {
    expect(rowVersionLabel(plan([v(1, ["confirm"], jst("2026-05-10T09:00:00"))], { version: 1, state: "approved" }))).toBe("令和 8 年度版（第 1 版）");
    expect(rowVersionLabel(plan([v(1, ["edit", "approve"], jst("2026-04-02T09:00:00"))], { version: 1, state: "approved" }))).toBe("令和 8 年度版（第 1 版）");
  });

  it("同じ年度の 2 つめの版は「令和 8 年度版（第 2 版）」", () => {
    const p = plan([v(1, ["confirm"], jst("2026-05-10T09:00:00")), v(2, ["confirm"], jst("2026-11-07T13:00:00"))], { version: 2, state: "approved" });
    expect(rowVersionLabel(p)).toBe("令和 8 年度版（第 2 版）");
  });

  it("1 月始まりの施設は暦の年で数える", () => {
    expect(rowVersionLabel(plan([v(1, ["confirm"], jst("2026-02-10T09:00:00"))], null, 1))).toBe("令和 8 年度版（第 1 版）");
    expect(rowVersionLabel(plan([v(1, ["confirm"], jst("2026-02-10T09:00:00"))], null, 4))).toBe("令和 7 年度版（第 1 版）");
  });

  it("編集中・承認待ち・差し戻し・確かめで合わない版には付けない（「第 m 版」のまま）", () => {
    const done = v(1, ["confirm"], jst("2026-05-10T09:00:00"));
    for (const state of ["editing", "awaitingApproval", "returned"] as const) {
      expect(rowVersionLabel(plan([done, v(2, ["edit"], null)], { version: 2, state })), state).toBe("第 2 版");
    }
    expect(rowVersionLabel(plan([v(1, ["confirm"], jst("2026-05-10T09:00:00"), { problem: "chain" })]))).toBe("第 1 版");
    // 年度の始まりを返さない古い橋渡しでも、推測で付けない
    expect(rowVersionLabel(plan([done], null, null))).toBe("第 1 版");
    expect(rowVersionLabel(plan([]))).toBeNull();
  });
});

describe("編集中の版（見出し・下の帯・題）には年度を付けない", () => {
  it("見出しと下の帯と題は「第 n 版」のまま", () => {
    expect(TEXT.top.version(3)).toBe("第 3 版");
    expect(signDialogWords("self", 3).title).not.toMatch(/年度/);
    expect(signDialogWords("edit", 3).title).not.toMatch(/年度/);
    expect(HUMAN_TEXT.confirm.basedOn(2)).toBe("いま確定している版：第 2 版");
  });
});

describe("星取の数の字（docs/words.md「印 → 星取」）", () => {
  it("件数の 1 行：「第 1 版　星取の追加 a」「第 n 版から：星取の追加 a・削除 r・変更 c」", () => {
    expect(HUMAN_TEXT.confirm.summaryLine(null, 3, 0, 0)).toBe("第 1 版　星取の追加 3");
    expect(HUMAN_TEXT.confirm.summaryLine(6, 1, 2, 3)).toBe("第 6 版から：星取の追加 1・削除 2・変更 3");
    expect(HUMAN_TEXT.confirm.summary(1, 2, 3, 4)).toBe("星取　追加 1・削除 2・変更 3・変更なし 4");
  });
});
