// 試験の資料：何行にも折り返した 1 つの記録を並べた PDF の表（工事報告書と整備総括の 2 つの形）。値はどれも架空。
// 書き手は、字を列の途中で切って別の文字の並びにする（見出しの字も切る）。読み手は文字の左端の位置で列を組むので、
// 切れた字は別の列のセルになる。頁の頭書き・頁の足・節の題・文の段落・項目と内容の表も書く。
import { pdfOf, type PdfPage, type PdfText } from "./pdf-helpers";

/** 字の大きさ（pt）。試験の書体は、どの字も幅が字の大きさと同じ */
export const SIZE = 9;
const W = SIZE;

/** 列の左端（pt）：表の外の文・名前の欄・項目と内容の表の内容・整備内容・状態・結果 */
export const X = { margin: 40, name: 60, content: 200, work: 260, state: 440 };

/**
 * 1 行の字を、字の数ごとに切って並べる（chunk は 1 つの数か、切る字の数の並び）。切った字の並びは、前の並びの終わりから隙間なく続ける。
 * 書き手の空白は字の半分の幅（pdf.js は 1 つの並びの中の空白として読む）。切った並びは、字の大きさをわずかに変えて別の並びにする
 * （pdf.js は大きさの同じ字が隙間なく続くと 1 つの並びにつなぐため）
 */
export function chunked(x: number, y: number, text: string, chunk?: number | number[]): PdfText[] {
  const chars = [...text];
  const sizes = chunk === undefined ? [chars.length] : typeof chunk === "number" ? [] : chunk;
  const out: PdfText[] = [];
  let i = 0;
  let k = 0;
  let cx = x;
  while (i < chars.length) {
    const n = typeof chunk === "number" ? chunk : (sizes[k] ?? chars.length - i);
    const piece = chars.slice(i, i + n).join("");
    const size = k % 2 === 0 ? SIZE : SIZE - 0.01;
    const words = piece.split(" ");
    words.forEach((w, j) => {
      if (w !== "") out.push({ x: cx, y, text: w, size });
      cx += [...w].length * size + (j < words.length - 1 ? W / 2 : 0);
    });
    i += n;
    k++;
  }
  return out;
}

/** 状態・結果の欄の 1 行の字の数（折り返す幅） */
export const STATE_WIDTH = 30;

/** 字を、決まった字の数で折り返す */
export function wrap(text: string, width: number): string[] {
  const chars = [...text];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += width) out.push(chars.slice(i, i + width).join("").trim());
  return out.filter(Boolean);
}

export interface BlockRecord {
  /** 名前の欄の行（1 行目は設備の短い名前、2 行目からは「号炉 設備／部位」を折り返したもの） */
  name: string[];
  /** 整備内容・期間の欄の行 */
  work: string[];
  /** 状態・結果の欄のまとまり（STATE_WIDTH の字の数で折り返す。行ごとに切る字の数） */
  state: { text: string; chunk?: number | number[] }[];
}

interface Form {
  head: string[];
  foot: (page: number, pages: number) => { x: number; text: string }[];
  /** 1 頁目の、表より上の中身（行の y を返す） */
  firstPage: (y: number) => { texts: PdfText[]; y: number };
  /** 表の前の題（切った字） */
  caption: { text: string; chunk: number[] } | null;
  /** 表の記録（頁ごと） */
  pages: BlockRecord[][];
  /** 2 頁目から見出しをくり返すか */
  repeatHeader: boolean;
  /** 最後の頁の、表の下の文の段落 */
  tail: string[];
}

const PITCH = 12;
const GAP = 30;
const HEAD_Y = 36;
const FOOT_Y = 575;

function headerTexts(y: number): PdfText[] {
  return [...chunked(X.name, y, "設備・機器／部位", 7), ...chunked(X.work, y, "整備内容・期間", 7), ...chunked(X.state, y, "状態・結果／申し送り", 7)];
}

function recordTexts(r: BlockRecord, y0: number): { texts: PdfText[]; y: number } {
  const texts: PdfText[] = [];
  const state = r.state.flatMap((s) => wrap(s.text, STATE_WIDTH).map((line) => ({ text: line, chunk: s.chunk })));
  const n = Math.max(r.name.length, r.work.length, state.length);
  for (let i = 0; i < n; i++) {
    const y = y0 + i * PITCH;
    const nm = r.name[i];
    const wk = r.work[i];
    const st = state[i];
    if (nm) texts.push(...chunked(X.name, y, nm));
    if (wk) texts.push(...chunked(X.work, y, wk));
    if (st) texts.push(...chunked(X.state, y, st.text, st.chunk ?? 7));
  }
  return { texts, y: y0 + (n - 1) * PITCH };
}

function build(form: Form): Uint8Array {
  const pages: PdfPage[] = [];
  const total = form.pages.length;
  form.pages.forEach((records, pi) => {
    const texts: PdfText[] = [];
    form.head.forEach((h, i) => texts.push(...chunked(X.margin, HEAD_Y + i * PITCH, h)));
    let y = HEAD_Y + form.head.length * PITCH + GAP;
    if (pi === 0) {
      const f = form.firstPage(y);
      texts.push(...f.texts);
      y = f.y + GAP;
      if (form.caption) {
        texts.push(...chunked(X.margin, y, form.caption.text, form.caption.chunk));
        y += GAP;
      }
    }
    if (pi === 0 || form.repeatHeader) {
      texts.push(...headerTexts(y));
      y += GAP;
    }
    records.forEach((r) => {
      const t = recordTexts(r, y);
      texts.push(...t.texts);
      y = t.y + GAP;
    });
    if (pi === total - 1)
      form.tail.forEach((line, i) => {
        texts.push(...chunked(X.margin, y + i * PITCH, line, i === 0 ? undefined : [26, 9, 9, 9]));
      });
    for (const f of form.foot(pi + 1, total)) texts.push(...chunked(f.x, FOOT_Y, f.text));
    pages.push({ width: 842, height: 595, texts });
  });
  return pdfOf(pages);
}

/** 工事報告書（3 頁）：1 頁目は総括（項目と内容の表・節の題と文の段落）、2・3 頁目が機器ごとの表。期間は年月日のそろった書き方 */
export const REPORT_RECORDS: BlockRecord[][] = [
  [
    {
      name: ["焼却炉本体", "1号炉 焼却炉本体／炉", "壁局部損耗域（24 m2）"],
      work: ["炉壁局部24 m2の打替補修", "2020-06-04 ～ 2020-06-08", "当該炉停止・隔離", "施工記録 W-0052-C1-2020"],
      state: [
        { text: "実施済" },
        { text: "炉壁局部の有効残厚 72.7 mm。次停止時予測 炉壁局部の有効残厚 59.7 mmが補修管理値を越えるため、今回停止内で対象部を整備。" },
        { text: "根拠：OBS-0052-C1-2020", chunk: 30 },
        { text: "判断：損耗域の範囲・残厚確認", chunk: 11 },
        { text: "施工量 24.0 m2／耐火 22人工", chunk: [12, 30] },
        { text: "備考：当該炉停止・隔離。部材は既往診断から選定。", chunk: 14 },
      ],
    },
    {
      name: ["落じんコンベヤ", "1号炉 炉下落じんコン", "ベヤ／1号炉 炉下落じ", "んコンベヤ"],
      work: ["損耗チェーン・スプロケット部取替", "2020-05-17 ～ 2020-05-23", "当該炉停止・隔離", "施工記録 W-0053-C1-2020"],
      state: [
        { text: "実施済" },
        { text: "同一ピッチ区間のチェーン伸び率 2.1 %。管理値 2.0 %を越えた。" },
        { text: "根拠：OBS-0053-C1-2020", chunk: 30 },
        { text: "施工量 18.0 m／機械 12人工", chunk: [11, 30] },
        { text: "備考：チェーンとスプロケットを取替。", chunk: 14 },
      ],
    },
  ],
  [
    {
      name: ["灰押出装置", "1号炉 灰押出装置／押", "出板ライナ"],
      work: ["押出板ライナ取替", "2020-06-10 ～ 2020-06-12", "当該炉停止・隔離"],
      state: [{ text: "予定" }, { text: "次停止時予定。ライナ摩耗の進行を確認した。" }, { text: "判断：摩耗の範囲を次停止時に確認", chunk: 14 }, { text: "施工量 6.0 m2／機械 8人工", chunk: [11, 30] }],
    },
    {
      name: ["排水処理設備", "共通 排水処理設備／移", "送ポンプ"],
      work: ["移送ポンプ分解整備", "2020-05-25 ～ 2020-05-26", "施工記録 W-0055-C0-2020"],
      state: [{ text: "実施済" }, { text: "軸受とメカニカルシールを交換した。" }, { text: "施工量 1.0 台／機械 4人工", chunk: [11, 30] }],
    },
  ],
];

/** 名前の欄の空いた行だけの「記録」（表の頭に置く。塊にできない行） */
export const ORPHAN: BlockRecord = { name: [], work: [], state: [{ text: "前回からの申し送り事項は無い。" }] };

/** 期間を年の無い月-日の書き方にする（「2020-06-04 ～ 2020-06-08」→「06-04～06-08」） */
const toMonthDay = (rs: BlockRecord[]): BlockRecord[] => rs.map((r) => ({ ...r, work: r.work.map((w) => w.replace(/^\d{4}-(\d{2}-\d{2}) ～ \d{4}-(\d{2}-\d{2})$/u, "$1～$2")) }));

/**
 * 工事報告書。orphan：2 頁目の表の頭に、名前の欄の空いた行を置く。monthDay：期間を年の無い月-日にする。
 * yearInTitle：頁の頭書きに年度を書く（書かなければ、年は項目と内容の表の工期から補う）
 */
export function reportPdf(opts: { orphan?: boolean; monthDay?: boolean; yearInTitle?: boolean } = {}): Uint8Array {
  const pages = REPORT_RECORDS.map((rs) => (opts.monthDay ? toMonthDay(rs) : rs));
  if (opts.orphan) pages[0] = [ORPHAN, ...(pages[0] ?? [])];
  return build({
    head: ["【架空】若葉環境センター", `${opts.yearInTitle === false ? "" : "令和2年度 "}若葉環境センター 1号炉 設備補修工事（請`, "契約番号 WK-2020-03 対象 1号炉 作成 2020"],
    foot: (p, n) => [
      { x: X.margin, text: "【架空】若葉環境センター" },
      { x: X.content, text: "WK-2020-03" },
      { x: 629, text: `WK-2020-03-${p} / ${n}` },
    ],
    firstPage: (y0) => {
      const texts: PdfText[] = [{ x: X.margin, y: y0, text: "工事報告書 総括", size: 11 }];
      let y = y0 + GAP;
      const kv: [string, string][] = [
        ["項目", "内容"],
        ["対象設備", "300 t/日（100 t/24h × 3炉）／1号炉"],
        ["工期", "2020-04-10 ～ 2020-06-18"],
        ["施工区分", "補修。運転業務は含まない。"],
      ];
      kv.forEach(([k, v], i) => texts.push(...chunked(X.name, y + i * PITCH, k), ...chunked(X.content, y + i * PITCH, v)));
      y += (kv.length - 1) * PITCH + GAP;
      texts.push(...chunked(X.margin, y, "1．工事の概要"));
      texts.push(...chunked(X.margin, y + PITCH, "燃焼設備、灰出し設備を対象に、各機器の停止・隔離条件を確認し", [26, 9]));
      texts.push(...chunked(X.margin, y + 2 * PITCH, "、損耗の大きい部位を補修した。施工の記録は機器ごとに次頁以降に示す。", [26, 9, 9]));
      y += 2 * PITCH + GAP;
      texts.push(...chunked(X.margin, y, "3．残件・経過確認"));
      texts.push(...chunked(X.margin, y + PITCH, "本報告の施工範囲は完了。次回は摩耗・減肉の変化を同一条件で確認する。測定対象外の部位を含めて設備全体の", [26, 9, 7, 7, 4]));
      texts.push(...chunked(X.margin, y + 2 * PITCH, "健全性を断定しない。", [3, 3, 4]));
      return { texts, y: y + 2 * PITCH };
    },
    caption: { text: "機器別の整備結果", chunk: [2, 4, 2] },
    pages: [[], ...pages],
    repeatHeader: true,
    tail: [],
  });
}

/** 整備総括（2 頁）：1 頁目に項目と内容の表と機器ごとの表、2 頁目は見出しをくり返さずに続ける。期間は年の無い月-日（年は題の年度から） */
export const SUMMARY_RECORDS: BlockRecord[][] = [
  [
    {
      name: ["焼却炉本体", "2号炉 焼却炉本体／炉", "壁局部"],
      work: ["炉壁局部の打替補修", "05-14～05-18", "当該炉停止・隔離"],
      state: [
        { text: "実施済" },
        { text: "炉壁局部の有効残厚 70.2 mm。管理値を越えるため打替。" },
        { text: "根拠：OBS-0101-C2-2021", chunk: 30 },
        { text: "施工量 24.0 m2／ 耐火 22.0 人工", chunk: [13, 30] },
        { text: "備考：耐火物は在庫品を使用。", chunk: 14 },
      ],
    },
    {
      name: ["ボイラ", "2号炉 ボイラ／過熱器", "管"],
      work: ["過熱器管の部分取替", "05-20～05-27", "当該炉停止・隔離", "施工記録 W-0102-C2-2021"],
      state: [{ text: "実施済" }, { text: "減肉部の肉厚 3.1 mm。取替基準を下回った。" }, { text: "施工量 12.0 本／ 溶接 30.0 人工", chunk: [12, 30] }],
    },
  ],
  [
    {
      name: ["誘引送風機", "2号炉 誘引送風機／軸", "受"],
      work: ["軸受の分解点検", "06-01～06-03", "当該炉停止・隔離"],
      state: [{ text: "実施済" }, { text: "振動値は管理値の範囲内。" }, { text: "判断：軸受の摩耗は軽微", chunk: 14 }, { text: "施工量 2.0 個／ 機械 6.0 人工", chunk: [11, 30] }],
    },
  ],
];

/** 整備総括。yearInTitle：頁の頭書きに年度を書く（書かなければ、年の無い期間の年は補えない） */
export function summaryPdf(opts: { yearInTitle?: boolean } = {}): Uint8Array {
  return build({
    head: ["【架空】みなと第三清掃工場", `${opts.yearInTitle === false ? "" : "令和3年度 "}2号炉 定期整備 整備総括`, "作成：2022-03-31"],
    foot: (p, n) => [{ x: X.margin, text: "【架空】みなと第三清掃工場 整備総括" }, { x: 629, text: `${p} / ${n}` }],
    firstPage: (y0) => {
      const texts: PdfText[] = [{ x: X.margin, y: y0, text: "整備総括", size: 11 }];
      const y = y0 + GAP;
      const kv: [string, string][] = [
        ["項目", "内容"],
        ["対象設備", "2号炉"],
        ["記録時点", "2022-03-31"],
      ];
      kv.forEach(([k, v], i) => texts.push(...chunked(X.name, y + i * PITCH, k), ...chunked(X.content, y + i * PITCH, v)));
      return { texts, y: y + (kv.length - 1) * PITCH };
    },
    caption: null,
    pages: SUMMARY_RECORDS,
    repeatHeader: false,
    tail: ["2．所見", "各機器の整備は計画どおり完了した。次年度は同じ部位の残厚を測り、減肉の速さを確かめる。", "以上"],
  });
}
