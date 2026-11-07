// 工程表（ガント）の 2 つの形の架空の資料（仕事 reader-gantt-v1 の試験と測りが使う）。値はどれも架空。
// 形 1：日の列の上に、施工の期間を線の図形で引く（描画の XML を zip に足して組む）。頁ごとのシートが何枚もある。
// 形 2：週の列のセルに、その週に施工した日数を数で書く。年度ごとのシート（「R3」「R4」）。
import ExcelJS from "exceljs";
import JSZip from "jszip";

// ─── 形 1：線の図形 ───────────────────────────────────────────

/** 形 1 の作業の行：機器の下の作業と、線の図形の列（1 から数える。両端を含む） */
export interface LineWork {
  work: string;
  effort: number;
  from: number;
  to: number;
  /** 現場管理の行（「本頁 現場管理計」に数える） */
  supervise?: boolean;
}
export interface LineAsset {
  asset: string;
  order: string;
  works: LineWork[];
}
export interface LineGroup {
  equipment: string;
  assets: LineAsset[];
}
export interface LinePage {
  sheet: string;
  unit: string;
  /** 日の列の最初の日（1990-10-04 なら [1990, 10, 4]） */
  first: [number, number, number];
  groups: LineGroup[];
}

/** 日の列：E（5）から Y（25）まで 21 日。人工計は Z（26） */
export const DAY_FROM = 5;
export const DAY_TO = 25;
export const EFFORT_COL = 26;

const E = 5;
export const PAGE_1: LinePage = {
  sheet: "001_1004",
  unit: "1号炉",
  first: [1990, 10, 4],
  groups: [
    {
      equipment: "ボイラ・給水",
      assets: [
        {
          asset: "1号炉 廃熱ボイラ",
          order: "W1990-00005",
          works: [
            { work: "初期状態確認", effort: 6, from: E, to: E + 2 },
            { work: "機能確認", effort: 2, from: E + 3, to: E + 3 },
            { work: "現場管理監督・立会", effort: 0.5, from: E, to: E + 3, supervise: true },
          ],
        },
        {
          asset: "1号炉 給水ポンプ",
          order: "W1990-00006",
          works: [
            { work: "分解整備", effort: 12, from: E + 4, to: E + 7 },
            { work: "現場管理監督・立会", effort: 1, from: E + 4, to: E + 7, supervise: true },
          ],
        },
      ],
    },
    {
      equipment: "燃焼設備",
      assets: [
        {
          asset: "1号炉 火格子",
          order: "W1990-00007",
          works: [
            { work: "火格子 点検", effort: 8, from: E + 8, to: E + 11 },
            { work: "現場管理監督・立会", effort: 0.5, from: E + 8, to: E + 9, supervise: true },
          ],
        },
      ],
    },
  ],
};

export const PAGE_2: LinePage = {
  sheet: "002_1004",
  unit: "1号炉",
  first: [1990, 10, 4],
  groups: [
    {
      equipment: "排ガス処理",
      assets: [
        {
          asset: "1号炉 ろ過式集じん器",
          order: "W1990-00011",
          works: [
            { work: "ろ布 交換", effort: 16, from: E + 12, to: E + 15 },
            { work: "現場管理監督・立会", effort: 1, from: E + 12, to: E + 15, supervise: true },
          ],
        },
      ],
    },
  ],
};

/** 日の列のその日に、作業の行の人工を施工の日に等しく割り振った和（「本頁 ○○計」の日ごとの数） */
function perDay(page: LinePage, c: number, supervise: boolean): number {
  let n = 0;
  for (const g of page.groups)
    for (const a of g.assets)
      for (const w of a.works) if (!!w.supervise === supervise && c >= w.from && c <= w.to) n += w.effort / (w.to - w.from + 1);
  return n;
}

function serial(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / 86400000 + 25569;
}

interface LineShape {
  name: string;
  row: number;
  from: number;
  to: number;
  rect?: boolean;
  text?: string;
}

function pageSheet(wb: ExcelJS.Workbook, page: LinePage, opts: { mismatch?: boolean; plan?: boolean; weekdays?: boolean } = {}): LineShape[] {
  const ws = wb.addWorksheet(page.sheet);
  const shapes: LineShape[] = [];
  ws.getCell("A1").value = `【架空】平成2年度 若葉清掃工場 定期整備業務委託 ${opts.plan ? "予定工程表" : "工程表"}`;
  ws.mergeCells("A1:Z1");
  ws.getCell("A2").value = "契約番号 WK-1990-01　工程表　1号炉停止";
  ws.getCell("A3").value = "人工＝8時間。協力会社作業と現場管理監督を別計。";
  ws.getCell("A4").value = "線は施工期間を表す。人工は右端合計。";
  const head = ["号炉", "設備", "機器", "作業・部位"];
  head.forEach((h, i) => (ws.getCell(6, i + 1).value = h));
  const [y, m, d] = page.first;
  for (let c = DAY_FROM; c <= DAY_TO; c++) {
    const cell = ws.getCell(6, c);
    cell.value = serial(y, m, d + (c - DAY_FROM));
    cell.numFmt = "yyyy-mm-dd";
  }
  ws.getCell(6, EFFORT_COL).value = "人工計";
  let r = 7;
  if (opts.weekdays) {
    for (let c = DAY_FROM; c <= DAY_TO; c++) ws.getCell(r, c).value = "日月火水木金土"[new Date(Date.UTC(y, m - 1, d + (c - DAY_FROM))).getUTCDay()]!;
    r++;
  }
  ws.getCell(r, 1).value = page.unit;
  ws.mergeCells(r, 1, r, 4);
  r++;
  let total = 0;
  let totalSup = 0;
  for (const g of page.groups) {
    ws.getCell(r, 2).value = g.equipment;
    ws.mergeCells(r, 2, r, 4);
    r++;
    for (const a of g.assets) {
      ws.getCell(r, 3).value = a.asset;
      ws.mergeCells(r, 3, r, 4);
      ws.getCell(r, 5).value = a.order;
      ws.mergeCells(r, 5, r, EFFORT_COL);
      r++;
      for (const w of a.works) {
        ws.getCell(r, 4).value = w.work;
        ws.getCell(r, EFFORT_COL).value = w.effort;
        shapes.push({ name: `WorkLine_${r}`, row: r, from: w.from, to: w.to });
        if (w.supervise) totalSup += w.effort;
        else total += w.effort;
        r++;
      }
    }
  }
  ws.getCell(r, 1).value = "本頁 協力会社計";
  for (let c = DAY_FROM; c <= DAY_TO; c++) ws.getCell(r, c).value = perDay(page, c, false) + (opts.mismatch && c === DAY_FROM ? 1 : 0);
  ws.getCell(r, EFFORT_COL).value = total;
  r++;
  ws.getCell(r, 1).value = "本頁 現場管理計";
  for (let c = DAY_FROM; c <= DAY_TO; c++) ws.getCell(r, c).value = perDay(page, c, true);
  ws.getCell(r, EFFORT_COL).value = totalSup;
  return shapes;
}

function anchor(s: LineShape, id: number): string {
  // anchor の col・row は 0 から数える。線の終わりは、終わりの日の列の右の端（次の列の左の端、colOff 0）
  const from = `<xdr:from><xdr:col>${s.from - 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${s.row - 1}</xdr:row><xdr:rowOff>95250</xdr:rowOff></xdr:from>`;
  const to = `<xdr:to><xdr:col>${s.to}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${s.row - 1}</xdr:row><xdr:rowOff>95250</xdr:rowOff></xdr:to>`;
  const sp = s.rect
    ? `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${s.name}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>${
        s.text ? `<xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${s.text}</a:t></a:r></a:p></xdr:txBody>` : ""
      }</xdr:sp>`
    : `<xdr:cxnSp macro=""><xdr:nvCxnSpPr><xdr:cNvPr id="${id}" name="${s.name}"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="28575"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></xdr:spPr></xdr:cxnSp>`;
  return `<xdr:twoCellAnchor>${from}${to}${sp}<xdr:clientData/></xdr:twoCellAnchor>`;
}

const PIC_ANCHOR =
  '<xdr:twoCellAnchor><xdr:from><xdr:col>27</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>29</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="90" name="Logo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdMissing"/></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>';

function drawingXml(shapes: LineShape[], extra = ""): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${shapes
    .map((s, i) => anchor(s, i + 2))
    .join("")}${extra}</xdr:wsDr>`;
}

/** 書いた xlsx の zip に、シートごとの描画の部品を足す（ExcelJS は線の図形を書かないため） */
export async function addDrawings(bytes: Uint8Array, perSheet: { sheet: number; xml: string }[]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  let types = await zip.file("[Content_Types].xml")!.async("string");
  for (const { sheet, xml } of perSheet) {
    const part = `xl/drawings/drawing${sheet}.xml`;
    zip.file(part, xml);
    types = types.replace("</Types>", `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    const relsName = `xl/worksheets/_rels/sheet${sheet}.xml.rels`;
    const rel = `<Relationship Id="rIdDrw1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${sheet}.xml"/>`;
    const old = zip.file(relsName);
    const rels = old
      ? (await old.async("string")).replace("</Relationships>", `${rel}</Relationships>`)
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel}</Relationships>`;
    zip.file(relsName, rels);
    const sheetName = `xl/worksheets/sheet${sheet}.xml`;
    let sx = await zip.file(sheetName)!.async("string");
    if (!/xmlns:r=/.test(sx)) sx = sx.replace("<worksheet ", '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    // <drawing> は pageSetup などの後、tableParts などの前に置く
    sx = /<tableParts\b/.test(sx) ? sx.replace(/<tableParts\b/, '<drawing r:id="rIdDrw1"/><tableParts') : sx.replace("</worksheet>", '<drawing r:id="rIdDrw1"/></worksheet>');
    zip.file(sheetName, sx);
  }
  zip.file("[Content_Types].xml", types);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

export interface LineBookOptions {
  /** 「本頁 協力会社計」の最初の日の数を 1 ずらす（検算で合わない） */
  mismatch?: boolean;
  /** 題を「予定工程表」にする */
  plan?: boolean;
  /** 描画に画像の図形と字のある四角を足す（持たない図形と、字を持つ図形） */
  extraShapes?: boolean;
  /** 描画の部品を足さない（線の図形の無い同じ Excel） */
  noDrawing?: boolean;
  /** 日の列の下に曜日の段を置く */
  weekdays?: boolean;
}

/** 形 1 の工程表（頁のシート 2 枚。線の図形つき） */
export async function lineBook(opts: LineBookOptions = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "【架空】試験";
  const per: { sheet: number; xml: string }[] = [];
  [PAGE_1, PAGE_2].forEach((p, i) => {
    const shapes = pageSheet(wb, p, opts);
    const extra = opts.extraShapes && i === 0 ? PIC_ANCHOR + anchor({ name: "Memo_1", row: 3, from: 27, to: 29, rect: true, text: "【架空】メモ" }, 80) : "";
    per.push({ sheet: i + 1, xml: drawingXml(shapes, extra) });
  });
  const buf = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return opts.noDrawing ? buf : addDrawings(buf, per);
}

// ─── 形 2：週の列の数 ─────────────────────────────────────────

/** 週の列：I（9）から 53 週。号炉の見出しの行は週ごとの日数の和 */
export const WEEK_FROM = 9;
export const WEEKS = 53;

export interface WeekRow {
  equipment?: string;
  tag: string;
  name: string;
  vendor: string;
  effort: number;
  /** 週の列の位置（0 から。I が 0）→ その週に施工した日数 */
  weeks: Record<number, number>;
}
export interface WeekUnit {
  title: string;
  /** 運転状況の行の塗りの週（0 から） */
  stop: [number, number];
  rows: WeekRow[];
}
export interface WeekSheet {
  sheet: string;
  /** 年度の始まりの週の初めの日（月曜） */
  first: [number, number, number];
  units: WeekUnit[];
}

const VENDOR = "【架空】架空プラント工業㈱";
export const R3: WeekSheet = {
  sheet: "R3",
  first: [2021, 3, 29],
  units: [
    {
      title: "■ 1号炉",
      stop: [6, 12],
      rows: [
        { equipment: "燃焼設備", tag: "H-203", name: "給じん装置", vendor: VENDOR, effort: 11, weeks: { 7: 3 } },
        { tag: "G-201", name: "火格子（乾燥段）", vendor: VENDOR, effort: 20, weeks: { 7: 4 } },
        { tag: "G-202", name: "火格子（燃焼段）", vendor: VENDOR, effort: 18, weeks: { 6: 3, 7: 2 } },
        { tag: "G-203", name: "火格子（後燃焼段）", vendor: VENDOR, effort: 19, weeks: { 8: 1, 9: 2, 38: 1 } },
      ],
    },
    {
      title: "■ 2号炉",
      stop: [20, 25],
      rows: [
        { equipment: "燃焼設備", tag: "H-213", name: "給じん装置", vendor: VENDOR, effort: 9, weeks: { 21: 3 } },
        { equipment: "通風設備", tag: "F-221", name: "誘引送風機", vendor: VENDOR, effort: 24, weeks: { 22: 5, 23: 2 } },
      ],
    },
  ],
};
export const R4: WeekSheet = {
  sheet: "R4",
  first: [2022, 3, 28],
  units: [
    {
      title: "■ 1号炉",
      stop: [7, 12],
      rows: [
        { equipment: "燃焼設備", tag: "H-203", name: "給じん装置", vendor: VENDOR, effort: 12, weeks: { 8: 4 } },
        { tag: "G-201", name: "火格子（乾燥段）", vendor: VENDOR, effort: 15, weeks: { 8: 2, 9: 1 } },
      ],
    },
  ],
};

export function weekStart(s: WeekSheet, i: number): Date {
  const [y, m, d] = s.first;
  return new Date(Date.UTC(y, m - 1, d + 7 * i));
}

const md = (dt: Date) => `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
const GRAY: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBFBFBF" } };
const BLUE: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF9DC3E6" } };
const YELLOW: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } };

export interface WeekBookOptions {
  /** 号炉の見出しの行の延べ人工を 1 ずらす（検算で合わない） */
  mismatch?: boolean;
  /** 題に年度を書かず、シートの名前も年度でない（年を補えない） */
  noYear?: boolean;
  /** 2 列の対応表のシートを足す */
  mapSheet?: boolean;
  /** 工数を時間で書く（見出し「延べ時間」、2 行目の注記「1人工＝8時間」） */
  hours?: boolean;
}

function weekSheet(wb: ExcelJS.Workbook, s: WeekSheet, opts: WeekBookOptions) {
  const ws = wb.addWorksheet(opts.noYear ? `工程_${s.sheet === "R3" ? "1" : "2"}` : s.sheet);
  ws.getCell("A1").value = opts.noYear ? "若葉クリーンセンター（架空）　工程表" : `若葉クリーンセンター（架空）　工程表（${s.sheet}）`;
  if (opts.hours) ws.getCell("A2").value = "1人工＝8時間（延べ時間は人工 × 8）";
  const head = ["設備", "機器番号", "機器名称", "号機", "号炉の記載", "業者", "日数", opts.hours ? "延べ時間" : "延べ人工"];
  head.forEach((h, i) => (ws.getCell(4, i + 1).value = h));
  let lastMonth = -1;
  for (let i = 0; i < WEEKS; i++) {
    const dt = weekStart(s, i);
    // 月の見出し：その週の中に月の 1 日がある列（最初の列は年度の始まりの月）
    const end = new Date(dt.getTime() + 6 * 86400000);
    const month = i === 0 ? end.getUTCMonth() + 1 : end.getUTCDate() <= 7 ? end.getUTCMonth() + 1 : -1;
    if (month > 0 && month !== lastMonth) {
      ws.getCell(4, WEEK_FROM + i).value = `${month}月`;
      lastMonth = month;
    }
    ws.getCell(5, WEEK_FROM + i).value = md(dt);
  }
  let r = 6;
  for (const u of s.units) {
    const unitNo = Number(/(\d)号炉/.exec(u.title)?.[1] ?? "1");
    const sums = new Map<number, number>();
    for (const x of u.rows) for (const [k, v] of Object.entries(x.weeks)) sums.set(Number(k), (sums.get(Number(k)) ?? 0) + v);
    const days = u.rows.reduce((a, x) => a + Object.values(x.weeks).reduce((p, q) => p + q, 0), 0);
    const effort = u.rows.reduce((a, x) => a + x.effort, 0);
    ws.getCell(r, 1).value = u.title;
    ws.getCell(r, 7).value = days;
    ws.getCell(r, 8).value = (effort + (opts.mismatch ? 1 : 0)) * (opts.hours ? 8 : 1);
    for (let i = 0; i < WEEKS; i++) {
      const cell = ws.getCell(r, WEEK_FROM + i);
      cell.fill = YELLOW;
      const v = sums.get(i);
      if (v) cell.value = v;
    }
    r++;
    ws.getCell(r, 1).value = `　${unitNo}号炉 運転状況（灰 = 停止）`;
    for (let i = u.stop[0]; i <= u.stop[1]; i++) ws.getCell(r, WEEK_FROM + i).fill = GRAY;
    r++;
    for (const x of u.rows) {
      if (x.equipment) ws.getCell(r, 1).value = x.equipment;
      ws.getCell(r, 2).value = x.tag;
      ws.getCell(r, 3).value = x.name;
      ws.getCell(r, 5).value = `${unitNo}号炉`;
      ws.getCell(r, 6).value = x.vendor;
      ws.getCell(r, 7).value = Object.values(x.weeks).reduce((p, q) => p + q, 0);
      ws.getCell(r, 8).value = x.effort * (opts.hours ? 8 : 1);
      for (const [k, v] of Object.entries(x.weeks)) {
        const cell = ws.getCell(r, WEEK_FROM + Number(k));
        cell.value = v;
        cell.fill = BLUE;
      }
      r++;
    }
  }
}

/** 形 2 の工程表（年度のシート 2 枚） */
export async function weekBook(opts: WeekBookOptions = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "【架空】試験";
  weekSheet(wb, R3, opts);
  weekSheet(wb, R4, opts);
  if (opts.mapSheet) {
    const ws = wb.addWorksheet("読替");
    ws.getCell("A1").value = "旧機器番号";
    ws.getCell("B1").value = "新機器番号";
    [["H-3", "H-203"], ["G-1", "G-201"], ["G-3", "G-203"]].forEach(([a, b], i) => {
      ws.getCell(i + 2, 1).value = a!;
      ws.getCell(i + 2, 2).value = b!;
    });
  }
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
