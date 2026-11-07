// 契約・発注の一覧の形の架空の資料（仕事 reader-contracts-v1 の試験と測りが使う）。値はどれも架空。
// 年度ごとのシートの発注台帳の Excel と、年度ごとの発注明細の CSV（1 行目が題と抽出の条件）、結ぶ相手の機器の台帳と作業の履歴。
import ExcelJS from "exceljs";

export const enc = (lines: string[]) => new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** 発注台帳の見出し（年度ごとのシートで同じ並び） */
export const LEDGER_HEAD = ["No.", "契約番号", "件名", "区分", "契約方法", "業者名", "見積取得日", "見積金額（円）", "発注日", "発注金額（円）", "工期（着手）", "工期（完了）", "工事完了日", "検収日", "検収金額（円）", "支払日", "担当", "備考"];

type LedgerRow = { title: string; kind: string; method: string; amount: number; start: Date; end: Date; note?: string };

/** 年度ごとの契約の行（令和5年度・令和6年度）。値はどれも架空 */
const LEDGER: Record<number, LedgerRow[]> = {
  2023: [
    { title: "【架空】DCS保守点検業務委託（R5年度）", kind: "委託", method: "随意契約", amount: 1_320_000, start: utc(2023, 4, 1), end: utc(2024, 3, 31) },
    { title: "【架空】ごみクレーン・灰クレーン年次点検業務委託", kind: "委託", method: "指名競争入札", amount: 2_750_000, start: utc(2023, 7, 1), end: utc(2023, 9, 30), note: "【架空】2基" },
    { title: "【架空】キレート薬剤購入（単価契約）", kind: "物品", method: "一般競争入札", amount: 4_400_000, start: utc(2023, 4, 1), end: utc(2024, 3, 31) },
    { title: "【架空】運転管理業務委託", kind: "委託", method: "一般競争入札", amount: 98_000_000, start: utc(2023, 4, 1), end: utc(2024, 3, 31) },
  ],
  2024: [
    { title: "【架空】DCS保守点検業務委託（R6年度）", kind: "委託", method: "随意契約", amount: 1_350_000, start: utc(2024, 4, 1), end: utc(2025, 3, 31) },
    { title: "【架空】誘引送風機分解整備工事", kind: "工事", method: "指名競争入札", amount: 5_060_000, start: utc(2024, 6, 1), end: utc(2024, 7, 31) },
    { title: "【架空】キレート薬剤購入（単価契約）", kind: "物品", method: "一般競争入札", amount: 4_620_000, start: utc(2024, 4, 1), end: utc(2025, 3, 31) },
  ],
};

/** Excel の発注台帳：年度ごとのシート。1 行目に題、3 行目に見出し、4 行目から契約の行 */
export async function ledgerBook(opts: { badDate?: boolean } = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "【架空】試験";
  for (const [fy, rows] of Object.entries(LEDGER)) {
    const y = Number(fy);
    const ws = wb.addWorksheet(`R${y - 2018}年度`);
    ws.getCell(1, 1).value = `【架空】発注台帳 令和${y - 2018}年度`;
    LEDGER_HEAD.forEach((v, i) => (ws.getCell(3, i + 1).value = v));
    rows.forEach((x, k) => {
      const vals: (string | number | Date | null)[] = [
        k + 1,
        `【架空】K${y}-${String(k + 1).padStart(3, "0")}`,
        x.title,
        x.kind,
        x.method,
        `【架空】${"甲乙丙丁"[k]}社`,
        utc(y, 3, 10 + k),
        Math.round(x.amount * 1.05),
        utc(y, 3, 25),
        x.amount,
        x.start,
        x.end,
        // 工事完了日：読めない書き方の日付（試験で 1 つだけ）
        opts.badDate && k === 0 ? "【架空】年度末" : x.end,
        x.end,
        x.amount,
        utc(x.end.getUTCFullYear(), x.end.getUTCMonth() + 2, 10),
        `【架空】担当${"ABCD"[k]}`,
        x.note ?? null,
      ];
      vals.forEach((v, i) => {
        if (v !== null) ws.getCell(4 + k, i + 1).value = v;
      });
    });
  }
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/** CSV の発注明細：1 行目が題と抽出の条件、2 行目が見出し。年度ごとに 1 本 */
export function orderCsv(fy: number, rows: string[][]): Uint8Array {
  return enc([
    `【架空】発注明細一覧（最新状態）,抽出日時：${fy + 1}/04/02 09:00,基準日：${fy + 1}/03/31`,
    "工事番号,工事名称,工事区分,契約方法,業者名,発注日,発注金額,工期開始,工期終了,検収日,検収金額,支払日,担当課,備考",
    ...rows.map((r) => r.join(",")),
  ]);
}
export const CSV_2023 = orderCsv(2023, [
  ["【架空】W23-01", "【架空】受入ホッパ補修工事", "工事", "随意契約", "【架空】戊社", "2023/08/01", "880000", "2023/08/20", "2023/08/31", "2023/09/05", "880000", "2023/09/29", "【架空】施設課", ""],
  ["【架空】W23-02", "【架空】構内清掃業務委託", "委託", "随意契約", "【架空】己社", "2023/04/01", "600000", "2023/04/01", "2024/03/31", "2024/03/31", "600000", "2024/04/30", "【架空】施設課", "【架空】月1回"],
]);
export const CSV_2024 = orderCsv(2024, [
  ["【架空】W24-01", "【架空】ごみクレーン年次点検業務委託", "委託", "指名競争入札", "【架空】乙社", "2024/06/10", "1500000", "2024/07/01", "2024/08/31", "2024/09/05", "1500000", "2024/09/30", "【架空】施設課", ""],
  ["【架空】W24-02", "【架空】構内清掃業務委託", "委託", "随意契約", "【架空】己社", "2024/04/01", "620000", "2024/04/01", "2025/03/31", "2025/03/31", "620000", "2025/04/30", "【架空】施設課", ""],
]);

/** 機器の台帳と、作業の履歴（ほかの資料の作業の年度の値。契約と結ぶ相手） */
export const ASSETS = enc(["名称,備考", "ごみクレーン,【架空】", "灰クレーン,【架空】", "誘引送風機,【架空】", "DCS,【架空】", "受入ホッパ,【架空】"]);
export const WORKS = enc([
  "機器,作業内容,着手,完了,工数(人日)",
  "ごみクレーン,年次点検,2023/07/10,2023/07/12,3",
  "灰クレーン,年次点検,2023/07/13,2023/07/14,2",
  "DCS,保守点検,2023/10/02,2023/10/03,1",
  "誘引送風機,分解整備,2024/06/03,2024/06/20,10",
  "ごみクレーン,年次点検,2024/07/08,2024/07/10,3",
  "受入ホッパ,補修,2023/08/22,2023/08/25,2",
]);
