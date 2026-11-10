// EXPORT の引き算（docs/screens.md 3.5、運営者 2026-11-10「入力も選びも窓の行き来も多すぎる。結果を見せて、人は 1 つ押すだけ」）：
// - 様式の行が唯一の選び：標準・差分（前の確定版があるときだけ）・保存先の様式・Claude が入れた様式・＋ 様式を追加
// - 列対応は読むだけ（列ごとのメニューは無い）。未定の列は朱の「- 未定」で、主ボタンは「理由：列対応 未定 n」で止まる
// - 主ボタンは 1 つ、字は「Excel を出力」か「署名して出力」。署名のダイアログは無く、署名は主ボタンを押した 1 回だけ（その 1 回で署名して落とす）
// 様式と計画はどれも架空。
import { MantineProvider } from "@mantine/core";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TemplateExport, sharedState, type SharedTemplate } from "../../src/app/components/TemplateExport";
import { exportPrimaryOf, undecidedOf } from "../../src/app/state/export-reason";
import { runExport, type HumanCall } from "../../src/app/state/export-run";
import { COLUMNS_SCHEMA, type TemplateColumns } from "../../src/plan/template";
import { TEXT } from "../../src/app/text";
import { layoutFor, layoutPlan } from "../helpers/template-layout";

const T = TEXT.export.template;
const html = (node: ReactNode) => renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);

const cols = (roles: TemplateColumns["roles"]): TemplateColumns => ({ schema: COLUMNS_SCHEMA, headerRow: 3, headers: roles.map((_, i) => `見出し${i}`), roles });
const decided = cols([{ kind: "item" }, { kind: "work" }, { kind: "cycle" }, { kind: "year", fiscalYear: 2026 }]);
const oneOpen = cols([{ kind: "item" }, { kind: "work" }, { kind: "cycle" }, { kind: "none" }]);
const tpl = (o: Partial<SharedTemplate> = {}): SharedTemplate => ({ name: "【架空】様式3", version: "a".repeat(64), current: true, columns: decided, approval: null, exported: false, ...o });

describe("様式の行", () => {
  const props = { plan: layoutPlan(), asOf: "2026-11-07", onSelect: () => {}, onDrop: async () => null, standardExported: true };

  it("前の確定版があれば、標準の次に「差分（第 n−1 版から）」の行（testid export-report）。無ければ出さない", () => {
    const withDiff = html(<TemplateExport {...props} templates={[tpl()]} selected={null} diff={{ from: 6, active: false, exported: false }} />);
    expect(withDiff).toContain(T.diff(6));
    expect(T.diff(6)).toBe("差分（第 6 版から）");
    const order = ["template-standard", "export-report", "template-shared", "template-pick"].map((id) => withDiff.indexOf(`data-testid="${id}"`));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const without = html(<TemplateExport {...props} templates={[tpl()]} selected={null} />);
    expect(without).not.toContain('data-testid="export-report"');
  });

  it("差分を選ぶと差分の行だけが選ばれ、出力したら「✓ 出力済み」", () => {
    const out = html(<TemplateExport {...props} templates={[]} selected={null} diff={{ from: 1, active: true, exported: true }} />);
    expect(out).toMatch(/data-active="true"[^>]*data-testid="export-report"/);
    expect(out).not.toMatch(/data-active="true"[^>]*data-testid="template-standard"/);
    expect(out).toMatch(/data-testid="export-report"[\s\S]*?✓ 出力済み/);
  });

  it("保存先の様式の状態：承認済み・列対応 下書き・列対応 未定 n・出力済み。Claude の案があれば「- Claude の入力」", () => {
    expect(sharedState(tpl({ approval: { in: 5, by: "【架空】佐藤", at: "2026-11-01T00:00:00Z" } }), false)).toBe("承認済み　第 5 版で　【架空】佐藤");
    expect(sharedState(tpl(), false)).toBe("列対応 下書き");
    expect(sharedState(tpl({ columns: oneOpen }), false)).toBe("列対応 未定 1");
    expect(sharedState(tpl({ exported: true, approval: { in: 1, by: "A", at: "" } }), false)).toBe("✓ 出力済み　承認済み　第 1 版で　A");
    expect(sharedState(tpl({ columns: oneOpen }), true)).toBe("列対応 下書き");
    const out = html(<TemplateExport {...props} templates={[tpl()]} selected={null} draftNames={new Set(["【架空】様式3"])} />);
    expect(out).toContain('data-testid="template-claude"');
    expect(out).toContain("- Claude の入力");
  });

  it("列対応は読むだけの字：未定の列は朱の「- 未定」（data-none）。列ごとのメニューも、押す字も無い", () => {
    const out = html(<TemplateExport {...props} templates={[tpl({ columns: oneOpen })]} selected={tpl({ columns: oneOpen })} />);
    const roles = [...out.matchAll(/<th[^>]*data-testid="template-role"[^>]*>([^<]*)</g)].map((m) => [m[0].includes('data-none="true"'), m[1]]);
    expect(roles).toEqual([
      [false, "← 項目"],
      [false, "← 作業"],
      [false, "← 周期"],
      [true, "- 未定"],
    ]);
    expect(out).not.toContain('data-testid="template-role-item"');
    expect(out).not.toContain('aria-haspopup="menu"');
    // 列対応の欄に button は無い（行の button と ＋ 様式を追加だけ）
    const preview = out.slice(out.indexOf('data-testid="template-preview"'));
    expect(preview).not.toContain("<button");
  });
});

describe("主ボタン 1 つ：字は 2 つ、押せない理由は 1 つ", () => {
  it("標準・差分・出力済みの様式は「Excel を出力」（署名しない）", () => {
    expect(exportPrimaryOf({ kind: "standard" }, null, false)).toEqual({ action: "plan", label: "excel", testid: "export-excel", stop: null });
    expect(exportPrimaryOf({ kind: "diff" }, null, false)).toEqual({ action: "report", label: "excel", testid: "export-excel", stop: null });
    expect(exportPrimaryOf({ kind: "template", exported: true, approved: false, undecided: 0 }, null, false)).toMatchObject({ action: "read", label: "excel" });
  });

  it("列対応が下書きなら「署名して出力」、承認済みなら「Excel を出力」（どちらも書き出しに署名する道）。Claude の入力は「署名して出力」", () => {
    expect(exportPrimaryOf({ kind: "template", exported: false, approved: false, undecided: 0 }, null, false)).toEqual({ action: "sign", label: "sign", testid: "export-sign", stop: null });
    expect(exportPrimaryOf({ kind: "template", exported: false, approved: true, undecided: 0 }, null, false)).toMatchObject({ action: "sign", label: "excel", testid: "export-sign" });
    expect(exportPrimaryOf({ kind: "claude", hasLayout: true, ready: true }, null, false)).toEqual({ action: "layout", label: "sign", testid: "layout-output", stop: null });
    expect(T.sign).toBe("署名して出力");
    expect(TEXT.export.excel).toBe("Excel を出力");
  });

  it("未定の列があれば止まる：「理由：列対応 未定 n」。Claude の入力で列対応がまだ無ければ「理由：列対応 未定」", () => {
    const p = exportPrimaryOf({ kind: "template", exported: false, approved: false, undecided: undecidedOf(oneOpen) }, null, false);
    expect(p.stop).toEqual({ kind: "undecided", n: 1 });
    expect(T.undecidedReason(1)).toBe("理由：列対応 未定 1");
    expect(exportPrimaryOf({ kind: "claude", hasLayout: false, ready: true }, null, false).stop).toEqual({ kind: "undecided", n: null });
    expect(T.undecidedReason(null)).toBe("理由：列対応 未定");
    // 案（layout）のある列対応は案で決まっている
    expect(undecidedOf({ ...oneOpen, layout: layoutFor() })).toBe(0);
    expect(undecidedOf(decided)).toBe(0);
  });

  it("前の段の理由が先：確定版なし・差戻しは、列対応より先に止める", () => {
    expect(exportPrimaryOf({ kind: "template", exported: false, approved: false, undecided: 2 }, { kind: "notConfirmed" }, true).stop).toEqual({ kind: "notConfirmed" });
    expect(exportPrimaryOf({ kind: "template", exported: false, approved: false, undecided: 2 }, null, true).stop).toEqual({ kind: "returned" });
    expect(exportPrimaryOf({ kind: "claude", hasLayout: true, ready: true }, { kind: "notConfirmed" }, false).stop).toEqual({ kind: "notConfirmed" });
    expect(exportPrimaryOf({ kind: "claude", hasLayout: true, ready: false }, null, false).stop).toEqual({ kind: "reading" });
  });
});

describe("署名は主ボタンを押した 1 回だけ", () => {
  const recorder = (fail?: string) => {
    const calls: string[] = [];
    const call: HumanCall = async (action) => {
      calls.push(action);
      if (action === fail) return { ok: false, message: "拒まれた" };
      if (action === "template_save") return { ok: true, body: { ok: true, name: "【架空】様式", version: "b".repeat(64) } as never };
      return { ok: true, body: { ok: true, base64: "AA==" } as never };
    };
    return { calls, call };
  };
  const base = { planId: "p", version: 2, fileName: "x.xlsx" };
  const template = { name: "【架空】様式3", version: "a".repeat(64) };

  it("標準・差分・出力済みの様式は読むだけで、署名を呼ばない", async () => {
    for (const action of ["plan", "report"] as const) {
      const r = recorder();
      expect((await runExport({ ...base, action }, r.call)).ok).toBe(true);
      expect(r.calls).toEqual(["plan_file_read"]);
    }
    const r = recorder();
    await runExport({ ...base, action: "read", template }, r.call);
    expect(r.calls).toEqual(["export_file_read"]);
  });

  it("「署名して出力」は、その 1 回で署名してから照らして読む（export_sign → export_file_read）", async () => {
    const r = recorder();
    const out = await runExport({ ...base, action: "sign", template }, r.call);
    expect(out).toMatchObject({ ok: true, base64: "AA==", fileName: "x.xlsx" });
    expect(r.calls).toEqual(["export_sign", "export_file_read"]);
  });

  it("署名が拒まれたら読まない（署名の無い Excel を渡さない）", async () => {
    const r = recorder("export_sign");
    expect(await runExport({ ...base, action: "sign", template }, r.call)).toEqual({ ok: false, message: "拒まれた", saved: null });
    expect(r.calls).toEqual(["export_sign"]);
  });

  it("Claude の列対応は、保存してから、置いた版で署名して読む。保存が拒まれたら署名も出力もしない", async () => {
    const r = recorder();
    const job = { ...base, action: "layout" as const, name: "【架空】様式", base64: "AA==", columns: { ...decided, layout: layoutFor() } };
    const out = await runExport(job, r.call);
    expect(out).toMatchObject({ ok: true, saved: { name: "【架空】様式", version: "b".repeat(64) } });
    expect(r.calls).toEqual(["template_save", "export_sign", "export_file_read"]);
    const no = recorder("template_save");
    expect((await runExport(job, no.call)).ok).toBe(false);
    expect(no.calls).toEqual(["template_save"]);
  });

  it("画面：署名のダイアログは無く、出力の道（runExport）を呼ぶのは主ボタンの onClick だけ。主ボタンは 1 つ", () => {
    const src = readFileSync("src/app/pages/Export.tsx", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/<Modal\b/);
    expect(code).not.toContain("export-sign-dialog");
    expect(code).not.toContain("export-sign-submit");
    expect(code.match(/runExport\(/g)?.length).toBe(1);
    expect(code.match(/output\(\)/g)?.length).toBe(1);
    expect(code).toMatch(/<Button onClick=\{\(\) => void output\(\)\}/);
    expect(code.match(/<Button\b/g)?.length).toBe(1);
    // export_sign を直に呼ばない（state/export-run.ts の道だけ）
    expect(code).not.toContain('"export_sign"');
  });
});
