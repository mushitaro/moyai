// 発注明細（1 行が 1 品目・1 作業の明細、金額つき）の形の架空の資料（仕事 reader-orderlines-v1 の試験と測りが使う）。値はどれも架空。
// Shift_JIS の CSV（年度ごとに 1 本。1 行目が題と抽出の条件、2 行目が見出し）と、結ぶ相手の機器の台帳。
import ExcelJS from "exceljs";

/** Shift_JIS（cp932）に書く。表は、2 バイトの並びを TextDecoder で読み、字 → バイトの向きにしたもの（試験の中で組む） */
let table: Map<string, number[]> | null = null;
function sjisTable(): Map<string, number[]> {
  if (table) return table;
  const dec = new TextDecoder("shift_jis");
  const t = new Map<string, number[]>();
  for (let b = 0xa1; b <= 0xdf; b++) t.set(dec.decode(new Uint8Array([b])), [b]);
  const leads = [...Array.from({ length: 0x9f - 0x81 + 1 }, (_, i) => 0x81 + i), ...Array.from({ length: 0xfc - 0xe0 + 1 }, (_, i) => 0xe0 + i)];
  for (const a of leads)
    for (let b = 0x40; b <= 0xfc; b++) {
      if (b === 0x7f) continue;
      const ch = dec.decode(new Uint8Array([a, b]));
      if (ch.length === 1 && ch !== "\uFFFD" && !t.has(ch)) t.set(ch, [a, b]);
    }
  table = t;
  return t;
}

export function sjis(text: string): Uint8Array {
  const t = sjisTable();
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80) out.push(code);
    else {
      const bs = t.get(ch);
      if (!bs) throw new Error(`Shift_JIS に無い字：${ch}`);
      out.push(...bs);
    }
  }
  return new Uint8Array(out);
}

/** 発注明細の見出し（2 行目） */
export const ORDER_HEAD = ["工事番号", "工事名称", "発注番号", "明細番号", "改訂番号", "初回発注日", "最終変更日", "仕入先コード", "仕入先名", "品名", "仕様", "費目", "数量", "単位", "単価", "初回発注額", "発注額", "納期", "検収状況", "最終検収日", "検収累計額", "未検収残額", "通貨", "備考"];

export interface OrderRow {
  order: string;
  line: number;
  rev?: number;
  item: string;
  spec: string;
  kind: string;
  qty?: number;
  unit?: string;
  amount: number;
  first?: number;
  /** 検収累計額（0 なら検収なし） */
  inspected: number;
  inspectDate?: string;
  remark?: string;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export interface CsvOptions {
  /** 金額の項目を書かない */
  noUnit?: boolean;
  /** 金額の項目の値（既定は「円・税抜」） */
  unitText?: string;
  /** 改訂番号の値を、この字にする（数でない改訂番号の試験） */
  revText?: (rev: number) => string;
}

/** 1 行目の題と抽出の条件（「工事年度」「金額：円・税抜」）。opts.noUnit なら金額の項目を書かない */
export function titleRow(fy: number, opts: CsvOptions = {}): string[] {
  return ["【架空】発注明細一覧（最新状態）", "抽出日時", `${fy + 1}/04/01 08:15`, "基準日", `${fy + 1}/03/31`, "工事年度", String(fy), "取消を含む", ...(opts.noUnit ? [] : [`金額：${opts.unitText ?? "円・税抜"}`])];
}

/** 年度ごとの発注明細の CSV（Shift_JIS） */
export function orderLinesCsv(fy: number, rows: OrderRow[], opts: CsvOptions = {}): Uint8Array {
  const body = rows.map((r) => {
    const qty = r.qty ?? 1;
    const vals = [
      `【架空】K-${fy}-1`,
      `【架空】${fy}年度 1号炉整備`,
      r.order,
      String(r.line),
      r.rev === undefined ? "" : opts.revText ? opts.revText(r.rev) : String(r.rev),
      `${fy}/05/10`,
      `${fy}/0${r.rev ? 7 : 5}/10`,
      "【架空】V001",
      "【架空】甲社",
      r.item,
      r.spec,
      r.kind,
      String(qty),
      r.unit ?? "式",
      String(Math.round(r.amount / qty)),
      String(r.first ?? r.amount),
      String(r.amount),
      `${fy}/09/30`,
      r.inspected > 0 ? (r.inspected >= r.amount ? "【架空】検収済" : "【架空】一部検収") : "【架空】未検収",
      r.inspected > 0 ? (r.inspectDate ?? `${fy}/10/05`) : "",
      String(r.inspected),
      String(r.amount - r.inspected),
      "JPY",
      r.remark ?? "",
    ];
    return vals.map(csvCell).join(",");
  });
  return sjis(`${[titleRow(fy, opts).map(csvCell).join(","), ORDER_HEAD.join(","), ...body].join("\r\n")}\r\n`);
}

/** 令和元年度（2019）の明細：結ぶ行・改訂の行・予定の行・取り出せない行（一式・諸経費・運搬）・結ぶ相手の無い行 */
export const ROWS_2019: OrderRow[] = [
  // 1 号炉の給じん装置の整備：2 つの費目（同じ機器・作業・年度は 1 つの年度の値にまとまる）
  { order: "【架空】P19-001", line: 1, item: "1号炉 給じん装置", spec: "1号炉 給じん装置／機械班／撤去・整備・復旧", kind: "【架空】労務費", amount: 1_200_000, inspected: 1_200_000 },
  { order: "【架空】P19-001", line: 2, item: "1号炉 給じん装置", spec: "1号炉 給じん装置／機械班／撤去・整備・復旧", kind: "【架空】材料費", qty: 4, unit: "個", amount: 300_000, inspected: 300_000 },
  // 2 号炉の給じん装置：改訂 0 → 改訂 1（最後の改訂だけを数える）
  { order: "【架空】P19-001", line: 3, rev: 0, item: "2号炉 給じん装置", spec: "2号炉 給じん装置／機械班／撤去・整備・復旧", kind: "【架空】労務費", amount: 800_000, inspected: 0 },
  { order: "【架空】P19-001", line: 3, rev: 1, item: "2号炉 給じん装置", spec: "2号炉 給じん装置／機械班／撤去・整備・復旧", kind: "【架空】労務費", amount: 900_000, first: 800_000, inspected: 900_000 },
  // 検収の無い行（予定）
  { order: "【架空】P19-002", line: 1, item: "1号炉 誘引送風機", spec: "1号炉 誘引送風機／電気班／点検", kind: "【架空】労務費", amount: 500_000, inspected: 0 },
  // 取り出せない行：一式の工事・諸経費・運搬
  { order: "【架空】P19-003", line: 1, item: "1号炉 定期整備工事", spec: "一式", kind: "【架空】工事費", amount: 9_000_000, inspected: 9_000_000 },
  { order: "【架空】P19-003", line: 2, item: "諸経費", spec: "一式", kind: "【架空】諸経費", amount: 300_000, inspected: 300_000 },
  { order: "【架空】P19-003", line: 3, item: "資材運搬", spec: "一式", kind: "【架空】運搬費", amount: 100_000, inspected: 100_000, remark: "【架空】2回" },
  // 機器の台帳に無い機器（結ぶ相手が無い）
  { order: "【架空】P19-004", line: 1, item: "1号炉 投入扉", spec: "1号炉 投入扉／機械班／整備", kind: "【架空】労務費", amount: 400_000, inspected: 400_000 },
];

/** 令和 2 年度（2020）の明細（同じ様式の 2 本目） */
export const ROWS_2020: OrderRow[] = [
  { order: "【架空】P20-001", line: 1, item: "1号炉 給じん装置", spec: "1号炉 給じん装置／機械班／点検", kind: "【架空】労務費", amount: 250_000, inspected: 250_000, inspectDate: "2020/11/20" },
  { order: "【架空】P20-001", line: 2, item: "諸経費", spec: "一式", kind: "【架空】諸経費", amount: 50_000, inspected: 50_000, inspectDate: "2020/11/20" },
];

export const CSV_2019 = orderLinesCsv(2019, ROWS_2019);
export const CSV_2020 = orderLinesCsv(2020, ROWS_2020);

/** 結ぶ相手の機器の台帳（号炉の列と名前の列）。UTF-8 の CSV */
export const ASSET_LIST = new TextEncoder().encode(["号炉,名称,備考", "1号炉,給じん装置,【架空】", "2号炉,給じん装置,【架空】", "1号炉,誘引送風機,【架空】", "2号炉,誘引送風機,【架空】"].join("\r\n") + "\r\n");

/** 性質の違う 2 つ目の資料：Excel の発注明細（題の行が無く、見出しに単位がある。明細 No. と検収日・検収額） */
export async function orderLinesBook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "【架空】試験";
  const ws = wb.addWorksheet("明細");
  const head = ["発注番号", "明細No.", "品名", "仕様", "数量", "単位", "単価（円）", "金額（円）", "検収日", "検収額（円）", "備考"];
  head.forEach((v, i) => (ws.getCell(1, i + 1).value = v));
  const rows: (string | number | Date | null)[][] = [
    ["【架空】Q-01", 1, "2号炉 誘引送風機", "電気班／分解整備", 1, "式", 700_000, 700_000, new Date(Date.UTC(2021, 8, 30)), 700_000, null],
    ["【架空】Q-01", 2, "運搬費", "一式", 1, "式", 80_000, 80_000, new Date(Date.UTC(2021, 8, 30)), 80_000, "【架空】"],
  ];
  rows.forEach((r, k) =>
    r.forEach((v, i) => {
      if (v !== null) ws.getCell(2 + k, i + 1).value = v;
    }),
  );
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/**
 * 測りの資料：2 つの架空の施設の、年度ごとの発注明細の CSV（2015〜2026 年度の 12 本 × 2 施設 = 24 本）。
 * 施設 A は題の行に金額の項目（「金額：円・税抜」）がある。施設 B は無い（金額の単位を 1 問で聞く）。
 * 行は、機器と作業の明細・改訂の行・検収の無い行・取り出せない行（一式・諸経費・運搬）を決まった順にまぜる
 */
export function facilityYearCsvs(): { name: string; bytes: Uint8Array }[] {
  const assets = ["給じん装置", "誘引送風機", "押込送風機", "灰押出装置", "投入扉"];
  const works = ["撤去・整備・復旧", "点検", "分解整備"];
  const crews = ["機械班", "電気班"];
  const out: { name: string; bytes: Uint8Array }[] = [];
  for (const [fac, noUnit] of [
    ["A", false],
    ["B", true],
  ] as const)
    for (let fy = 2015; fy <= 2026; fy++) {
      const rows: OrderRow[] = [];
      for (let i = 0; i < 24; i++) {
        const order = `【架空】${fac}${fy}-${String(1 + Math.floor(i / 8)).padStart(3, "0")}`;
        const line = 1 + (i % 8);
        const amount = 100_000 * (1 + ((i * 7 + fy) % 13));
        const inspected = fy === 2026 || i % 5 === 4 ? 0 : amount;
        if (i % 8 === 7) {
          const lump = [
            ["諸経費", "一式", "【架空】諸経費"],
            ["資材運搬", "一式", "【架空】運搬費"],
            [`${1 + (i % 2)}号炉 定期整備工事`, "一式", "【架空】工事費"],
          ][i % 3] as [string, string, string];
          rows.push({ order, line, item: lump[0], spec: lump[1], kind: lump[2], amount, inspected });
          continue;
        }
        const unit = 1 + (i % 2);
        const asset = assets[i % assets.length] ?? "";
        const work = works[(i + fy) % works.length] ?? "";
        const item = `${unit}号炉 ${asset}`;
        const spec = `${item}／${crews[i % 2]}／${work}`;
        // 改訂のある明細：改訂 0 の行と改訂 1 の行
        if (i % 6 === 1) rows.push({ order, line, rev: 0, item, spec, kind: "【架空】労務費", amount: amount - 50_000, inspected: 0 });
        rows.push({ order, line, ...(i % 6 === 1 ? { rev: 1, first: amount - 50_000 } : {}), item, spec, kind: i % 3 === 0 ? "【架空】材料費" : "【架空】労務費", amount, inspected });
      }
      out.push({ name: `${fac}/発注明細_${fy}.csv`, bytes: orderLinesCsv(fy, rows, { noUnit }) });
    }
  return out;
}

/** 測りの資料の機器の台帳（施設ごと）：号炉 1・2 の 4 つの機器（投入扉は無い。結ぶ相手の無い明細が残る） */
export const FACILITY_ASSETS = new TextEncoder().encode(
  ["号炉,名称", ...[1, 2].flatMap((u) => ["給じん装置", "誘引送風機", "押込送風機", "灰押出装置"].map((a) => `${u}号炉,${a}`))].join("\r\n") + "\r\n",
);
