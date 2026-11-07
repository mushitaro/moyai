// 発注明細の見分けを、単価の列の無い購買の出力にも広げる（品名か摘要・数量・発注額か検収額・明細の番号か検収の欄）。
// 作りの違う 2 つの購買の出力（古い Shift_JIS の CSV と、新しい UTF-8 の CSV）で、見出しの別の言い方が効くことを縛る。資料はどれも架空。
import { describe, expect, test } from "vitest";
import type { Analysis } from "../../../src/import";
import { sjis } from "./orderline-fixtures";
import { session } from "./helpers";

const statusOf = (an: Analysis, file: string) => [...an.composition.status.entries()].filter(([k]) => k.startsWith(`${file}\u0000`)).map(([, v]) => v);
const silent = (an: Analysis, file: string) => statusOf(an, file).filter((v) => v.s === "unresolved" && !v.questionId).length;

const OLD = sjis(
  [
    "【架空】旧購買管理　発注台帳抄録,金額：千円・税抜,出力基準 H23.12.31",
    "工事略称,注文No,枝,発注日,仕入先,摘要,数,単位,発注額,検収日,検収額,備考",
    "平成10年度 架空清掃工場 定期整備業務委託,PO-1998-00001,01,H10.3.23,【架空】東清掃工業,1号炉 焼却炉 炉内付着物除去 清掃,1,式,1380.0,H10.5.18,1380.0,W1998-00001",
    "平成10年度 架空清掃工場 定期整備業務委託,PO-1998-00001,02,H10.3.23,【架空】東清掃工業,2号炉 誘引送風機 軸受交換,2,個,410.0,H10.6.02,410.0,",
    "平成10年度 架空清掃工場 定期整備業務委託,PO-1998-00002,01,H10.4.01,【架空】西機工,資材運搬,1,式,95.0,,,",
  ].join("\r\n") + "\r\n",
);

const NEW = new TextEncoder().encode(
  "﻿" +
    [
      "【架空】購買明細出力,,単位：円（税抜）,新システム運用開始：2012-01-01",
      "発注ID,明細ID,工事番号,起票日,取引先コード,品名,発注数量,単位,税抜発注金額,累計検収金額,最終検収日,残額,発生区分,旧注文参照,検収状況",
      "N12-000001,10,SM-2011-02,2012-01-01,K001,2炉IDF 軸受整備・芯出し,1,式,420000,420000,2012-01-25,0,移行残,23-0001/01,完了",
      "N12-000002,10,SM-2011-02,2012-01-01,B001,駆動側軸受,1,個,280000,280000,2012-01-25,0,移行残,23-0001/02,完了",
      "N12-000003,10,SM-2012-01,2012-02-10,K002,1炉 給じん装置 点検,1,式,150000,0,,150000,通常,,未検収",
    ].join("\r\n") +
    "\r\n",
);

describe("単価の列の無い購買の出力も発注明細として読む（題の行の「単位：」も金額の単位）", () => {
  for (const [name, bytes, label] of [
    ["旧購買出力.csv", OLD, "古い Shift_JIS（注文No・枝・摘要・数・発注額・検収額）"],
    ["新購買出力.csv", NEW, "新しい UTF-8（発注ID・明細ID・品名・発注数量・税抜発注金額・累計検収金額）"],
  ] as const) {
    test(`${label}：発注明細と見分け、記録にし、質問の無い未解決のセルを残さない。作業にしない`, async () => {
      const s = session();
      await s.add([{ name, bytes }]);
      const an = s.analyze();
      const tables = an.layouts.flatMap((l) => l.tables);
      expect(tables.map((t) => t.shape)).toEqual(["orderLines"]);
      expect(tables[0]!.headerRows).toEqual([2]);
      expect(an.records.contracts.length).toBe(3);
      expect(an.records.events).toEqual([]);
      expect(silent(an, name)).toBe(0);
      // 題の行の「金額：千円・税抜」「単位：円（税抜）」のどちらでも、金額の単位を聞かない
      expect(an.open.filter((q) => q.kind === "costUnit")).toEqual([]);
    });
  }

  test("品名と数量があっても、金額の列が無い表（部品の一覧）は発注明細にしない", async () => {
    const s = session();
    const bytes = new TextEncoder().encode(["明細ID,品名,数量,単位,備考", "1,軸受,2,個,", "2,パッキン,10,枚,"].join("\r\n") + "\r\n");
    await s.add([{ name: "部品.csv", bytes }]);
    const an = s.analyze();
    expect(an.layouts.flatMap((l) => l.tables).map((t) => t.shape)).not.toContain("orderLines");
  });
});
