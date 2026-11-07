// EXPORT の写し方の案の見本（仕事 template-layout-v1。docs/screens.md 3.5 に無いので仮の形。Wire の確認待ち）：
// Claude が入れた様式は「未保存」の行で並び、案のある様式は案のとおりに書いた見本を、様式の見た目のまま出す（どの列に何が入るかが分かる）。
// 様式と計画はどれも架空。
import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LayoutPreviewView, buildPreview } from "../../src/app/components/TemplateLayoutPreview";
import { TemplateExport } from "../../src/app/components/TemplateExport";
import { TEXT } from "../../src/app/text";
import { SHEET_FIRST, SHEET_INFO, catalog, layoutFor, layoutPlan, templateBytes } from "../helpers/template-layout";

const L = TEXT.export.template.layout;
const html = (node: ReactNode) => renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);

describe("写し方の案の見本", () => {
  it("案のとおりに書いた計画の表を、見出し・結合のまま出し、案が書くセルに印。数えたもの（年度の外・金額の無い明細・税）を添える", async () => {
    const layout = layoutFor();
    const built = await buildPreview(await templateBytes(), layout, { plan: layoutPlan(), catalog: catalog(), asOf: "2026-11-07" });
    expect(built.kind).toBe("ready");
    const out = html(<LayoutPreviewView built={built} layout={layout} draft basis={L.basisWorking} />);
    expect(out).toContain('data-testid="layout-preview"');
    expect(out).toContain('data-draft="true"');
    expect(out).toContain(L.headDraft);
    expect(out).toContain(`data-sheet="${SHEET_FIRST}"`);
    // 2 段の見出し（設備は縦に 2 行、機器・部位は 2 列 × 2 行）と、書いた名前・組のラベル・千円の金額
    expect(out).toMatch(/rowSpan="2"[^>]*>設備</);
    expect(out).toMatch(/colSpan="2" rowSpan="2"[^>]*>機器・部位</);
    for (const t of ["架空の受入設備", "架空のバケット", "予定内容", "実績金額", "1734.567", "点検、分解整備"]) expect(out).toContain(t);
    expect(out).toContain('data-written="true"');
    expect(out).toContain(L.outOfRange(1));
    expect(out).toContain(L.amountMissing(1));
    expect(out).toContain(L.taxMismatch(1));
    expect(out).toContain(L.taxUnknown(1));
    expect(out).toContain(L.sheetLine(SHEET_FIRST, 17, 6, 2000, 2008));
    expect(out).toContain(L.unit(true, "excl"));
    // シートの切り替え：基本情報も
    expect(out).toContain(`>${SHEET_INFO}</button>`);
  });

  it("案が様式に合わなければ、見本の代わりに理由を出す", async () => {
    const layout = layoutFor({ sheets: [{ ...layoutFor().sheets[0]!, sheet: "無いシート" }] });
    const built = await buildPreview(await templateBytes(), layout, { plan: layoutPlan(), catalog: catalog(), asOf: "2026-11-07" });
    expect(built.kind).toBe("error");
    expect(html(<LayoutPreviewView built={built} layout={layout} draft basis="" />)).toContain("シート「無いシート」が様式に無い");
  });

  it("様式の選び：Claude が入れた様式は「未保存」の行。案があれば「写し方の案」。選ぶと列の役目の表の代わりに見本", () => {
    const out = html(
      <TemplateExport
        plan={layoutPlan()}
        asOf="2026-11-07"
        templates={[]}
        selected={null}
        onSelect={() => {}}
        onDrop={async () => null}
        onRoles={() => {}}
        standardExported={false}
        pending={[{ name: "架空の様式", hasDraft: true }]}
        pendingSel="架空の様式"
        onSelectPending={() => {}}
        draftNames={new Set()}
        layoutView={<div data-testid="layout-preview-slot" />}
      />,
    );
    expect(out).toContain('data-testid="template-pending"');
    expect(out).toContain(L.pending);
    expect(out).toContain(L.draft);
    expect(out).toContain('data-testid="layout-preview-slot"');
    expect(out).not.toContain('data-testid="template-preview"');
    // 標準の行は選ばれていない
    expect(out).toMatch(/data-active="true"[^>]*data-testid="template-pending"/);
  });
});
