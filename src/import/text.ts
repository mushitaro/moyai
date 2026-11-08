// セルの文字の書き方を読む小さな決まり（一般の性質だけ）：号・系列、工数、人数と作業時間の幅、番号 1 / 1-1、名前の中の機器番号。
// 決まらないものは null を返し、呼ぶ側が質問にする。
import { nfkc } from "./era";
import { CUES, cue, escapeRe, norm } from "./cues";

// ─── 号・系列 ──────────────────────────────────────────────────

export type UnitValue =
  | { kind: "number"; n: number; spelling: string }
  | { kind: "common" }
  | { kind: "ditto" };

const UNIT_PREFIX = CUES.unit.numberPrefix.map((p) => escapeRe(nfkc(p))).join("|");
const UNIT_MARK = CUES.unit.numberMark.map((p) => escapeRe(nfkc(p))).join("|");
const RE_UNIT_PREFIX = new RegExp(`^(?:${UNIT_PREFIX})\\s*(\\d{1,3})\\s*(\\p{Script=Han}{0,2})$`, "u");
const RE_UNIT_MARK = new RegExp(`^(\\d{1,3})\\s*(?:${UNIT_MARK})\\s*(\\p{Script=Han}{0,2})$`, "u");
const UNIT_ORDINAL = CUES.unit.ordinalPrefix.map((p) => escapeRe(nfkc(p))).join("|");
// 「{数}{字}」（字は 2 つまで。「1系」「1系列」）。頭に順の字があってもよい（「第1系列」）
const RE_UNIT_HAN = new RegExp(`^(${UNIT_ORDINAL})?(\\d{1,3})(\\p{Script=Han}{1,2})$`, "u");
/** 数を数える字（「1基」「2台」「1式」）：数量であって号ではない */
const COUNTERS = new Set(CUES.unit.counters.map((w) => nfkc(w)));

/** 号・系列の書き方を読む：「{数}号{字}」「No.{数}{字}」「{数}{字}」「第{数}{字}」・共通・〃（数は全角でもよい）。数の書き方の形（spelling）も返す */
export function parseUnit(text: string): UnitValue | null {
  const s = nfkc(text).replace(/\s+/g, "");
  if (!s) return null;
  if (cue.isDitto(s)) return { kind: "ditto" };
  if (cue.isCommon(s)) return { kind: "common" };
  let m = RE_UNIT_PREFIX.exec(s);
  if (m) return { kind: "number", n: Number(m[1]), spelling: `No.{n}${m[2] ?? ""}` };
  m = RE_UNIT_MARK.exec(s);
  if (m) return { kind: "number", n: Number(m[1]), spelling: `{n}号${m[2] ?? ""}` };
  m = RE_UNIT_HAN.exec(s);
  if (m && !COUNTERS.has(m[3] ?? "")) return { kind: "number", n: Number(m[2]), spelling: `${m[1] ?? ""}{n}${m[3] ?? ""}` };
  return null;
}

/** 文字の中の号・系列（名前の後ろの括弧など）。「名前（{数}号）」→ 数。見つからなければ null */
export function unitInText(text: string): number | null {
  const s = nfkc(text);
  const re = new RegExp(`(?:${UNIT_PREFIX})\\s*(\\d{1,3})|(\\d{1,3})\\s*(?:${UNIT_MARK})`, "gu");
  const found = new Set<number>();
  for (const m of s.matchAll(re)) found.add(Number(m[1] ?? m[2]));
  return found.size === 1 ? ([...found][0] ?? null) : null;
}

// ─── 号炉・機器・作業を 1 つのセルに書いたもの ─────────────────────────

export interface FlatWork {
  unit: UnitValue | null;
  asset: string;
  work: string;
}

/** 号機の書き方（「No.2」「№2」「2号機」「(2)」）を「No.2」にそろえる。そろえられなければそのまま */
function machineToken(t: string): string {
  const s = nfkc(t).trim();
  const m = /^(?:No\.?|NO\.?|#)\s*(\d{1,3})$/u.exec(s) ?? /^(\d{1,3})\s*号機$/u.exec(s) ?? /^[(（](\d{1,3})[)）]$/u.exec(s);
  return m ? `No.${Number(m[1])}` : s;
}

/** 号機の書き方（「No.2」「#2」「2号機」「(2)」「B号機」） */
const RE_MACHINE = /^(?:(?:No|NO)\.?\s*\d{1,3}|\d{1,3}\s*号機|[(（]\d{1,3}[)）]|[A-Za-z]\s*号機)$/u;

/** 号炉の印（「1号」「1号炉」「1炉」「#1」・共通・号なし「—」）。号機（「No.2」「2号機」）は号炉ではない。号炉でなければ null */
function unitToken(t: string): UnitValue | null {
  const s = nfkc(t).trim();
  if (!s || /^(?:No|NO|№)/u.test(s) || /号機$/u.test(s)) return null;
  if (/^[-－―—‐]+$/u.test(s) || cue.isCommon(s)) return { kind: "common" };
  if (/^#\s*\d{1,3}$/u.test(s)) return { kind: "number", n: Number(s.replace(/\D/g, "")), spelling: "#{n}" };
  const u = parseUnit(s);
  return u?.kind === "number" ? u : null;
}

/** 号炉の印の頭（空白で区切らずに続けた「１号落塵CV」「#1BFP」「—投入扉」も）。括弧の中（inParen）なら共通の略の頭（「共B号機」）も */
const RE_UNIT_HEAD = /^(#\s*\d{1,3}|\d{1,3}\s*(?:号炉|号(?!機)|炉)|[-－―—‐]+)\s*(.*)$/u;
const RE_UNIT_HEAD_PAREN = /^(#\s*\d{1,3}|\d{1,3}\s*(?:号炉|号(?!機)|炉)|[-－―—‐]+|共通|共)\s*(.*)$/u;
export function leadingUnit(s: string, inParen = false): { unit: UnitValue; rest: string } | null {
  const sp = /^(\S+)\s+(\S.*)$/u.exec(s);
  if (sp) {
    const u = unitToken(sp[1] ?? "");
    if (u) return { unit: u, rest: (sp[2] ?? "").trim() };
  }
  const whole = unitToken(s);
  if (whole) return { unit: whole, rest: "" };
  const m = (inParen ? RE_UNIT_HEAD_PAREN : RE_UNIT_HEAD).exec(s);
  const head = m?.[1] ?? "";
  const u = m ? (/^共/u.test(head) ? ({ kind: "common" } as const) : unitToken(head)) : null;
  return m && u && (inParen || (m[2] ?? "") !== "") ? { unit: u, rest: (m[2] ?? "").trim() } : null;
}

/**
 * 号炉・系統の欄に、号炉と号機を並べて書いたもの（「1号炉 No.1」「1号炉⏎No.2」「共通 2号機」）を、号炉と号機に分ける。
 * 号機は号炉ではない（別の機器の番号）。号炉の語と号機の語のほかの語があれば null（読めない。呼ぶ側が聞く）
 */
export function splitSeriesCell(text: string): { unit: UnitValue | null; machine: string | null } | null {
  const toks = nfkc(text).split(/\s+/u).filter(Boolean);
  if (!toks.length) return null;
  let unit: UnitValue | null = null;
  let machine: string | null = null;
  for (const t of toks) {
    if (machine === null && RE_MACHINE.test(t)) machine = machineToken(t);
    else if (unit === null && unitToken(t)) unit = unitToken(t);
    else return null;
  }
  return unit && machine ? { unit, machine } : null;
}

/**
 * 名前の中に書いた号炉と号機（「1号炉 No.1 減温塔噴霧P」）：空白で区切った語のうち、号炉の語（数のもの）と号機の語を除いた名前と、除いた号炉と号機。
 * 除く語が無いか、除くと名前が残らなければ null
 */
export function splitNameUnits(text: string): { name: string; unit: number | null; machine: string | null } | null {
  const toks = nfkc(text).split(/\s+/u).filter(Boolean);
  let unit: number | null = null;
  let machine: string | null = null;
  const rest: string[] = [];
  for (const t of toks) {
    const u = unitToken(t);
    if (unit === null && u?.kind === "number") unit = u.n;
    else if (machine === null && RE_MACHINE.test(t)) machine = machineToken(t);
    else rest.push(t);
  }
  if ((unit === null && machine === null) || !rest.length) return null;
  return { name: rest.join(" "), unit, machine };
}

/** 括弧の外の空白があるか（「ST 開放点検（定期事業者検査）」は空白で分ける） */
const spaceOutsideParen = (s: string) => /\s/u.test(s.replace(/[(（][^()（）]*[)）]/gu, ""));

/**
 * 号炉・機器・作業を 1 つのセルに、見出しの順で書いたもの（「1号 No.2 BFP 分解整備」「給じん装置（１号炉）点検整備」）を分ける。
 * 区切りは空白か括弧：空白（括弧の外）なら最後の語が作業、その前が機器。空白が無く括弧があれば、括弧の前が機器、括弧の中が号炉と号機、
 * 括弧の後が作業。号機の書き方はそろえて機器の名前の後ろに付ける。区切りが無ければ null（呼ぶ側が質問にする）
 */
export function splitFlatWork(text: string): FlatWork | null {
  let s = nfkc(text).replace(/\s+/g, " ").trim();
  if (!s) return null;
  let unit: UnitValue | null = null;
  const lead = leadingUnit(s);
  if (lead) {
    unit = lead.unit;
    s = lead.rest;
  }
  if (spaceOutsideParen(s)) {
    const toks = s.split(" ");
    const work = toks.pop() as string;
    const machines = toks.filter((t) => RE_MACHINE.test(nfkc(t).trim()));
    const names = toks.filter((t) => !machines.includes(t));
    const asset = [...names, ...machines.map(machineToken)].join(" ");
    return asset ? { unit, asset, work } : null;
  }
  const paren = /^(.+?)[(（]([^()（）]*)[)）](\S.*)$/u.exec(s);
  if (!paren) return null;
  let qual = (paren[2] ?? "").trim();
  const q = leadingUnit(qual, true);
  if (q) {
    unit = unit ?? q.unit;
    qual = q.rest;
  }
  const asset = [paren[1] ?? "", qual ? machineToken(qual) : ""].filter(Boolean).join(" ");
  return asset ? { unit, asset, work: (paren[3] ?? "").trim() } : null;
}

// ─── 発注明細の品名・仕様の中の号炉・機器・作業 ─────────────────────────

export interface OrderItem {
  /** 号炉の数（書いていなければ null） */
  unit: number | null;
  asset: string;
  work: string;
}

/**
 * 発注明細の品名・仕様を「／」で区切った並び（「1号炉 給じん装置／1号炉 給じん装置／機械班／撤去・整備・復旧」）から、号炉・機器・作業を取り出す。
 * 品名と仕様の区切りを順につなぎ、同じ字の区切りは 1 つにする。作業は、作業の語（cues の titleWork）を含む最後の区切り。
 * 機器は、作業より前の最初の区切りの、頭の号炉の語を除いた名前（号炉だけの区切りは号炉にして、次の区切りを機器にする）。間の区切り（班など）は使わない。
 * 一式の印だけの区切りは数量の書き方として除く。区切りが 2 つに満たない・ほかの字と並べた一式の印がある（一式の工事）・作業の語が無い・
 * 機器の名前が残らない・号炉が 2 つある、のどれかなら null（作業にしない。呼ぶ側が記録に残す）
 */
export function splitOrderItem(texts: readonly (string | null)[]): OrderItem | null {
  const segs: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const raw of nfkc(t).split("/")) {
      const seg = raw.replace(/\s+/g, " ").trim();
      if (!seg) continue;
      const set = cue.stripSet(seg);
      if (set.set) {
        if (norm(set.text) === "") continue;
        return null;
      }
      if (!segs.some((x) => norm(x) === norm(seg))) segs.push(seg);
    }
  }
  if (segs.length < 2) return null;
  let wi = -1;
  for (let i = segs.length - 1; i >= 1 && wi < 0; i--) if (TITLE_WORK.some((w) => norm(segs[i] ?? "").includes(norm(w)))) wi = i;
  const work = segs[wi];
  if (wi < 1 || !work) return null;
  // 作業より前の区切りに書いた号炉（2 つの号炉があれば、どちらかに決めない）
  const units = new Set<number>();
  let asset: string | null = null;
  for (let i = 0; i < wi; i++) {
    const seg = segs[i] ?? "";
    const lead = leadingUnit(seg);
    if (lead && lead.unit.kind !== "number") return null;
    if (lead?.unit.kind === "number") units.add(lead.unit.n);
    const name = lead ? lead.rest : seg;
    if (asset === null && name) asset = name;
  }
  if (asset === null || units.size > 1) return null;
  return { unit: units.size ? ([...units][0] ?? null) : null, asset, work };
}

// ─── 周期 ────────────────────────────────────────────────────

export interface CycleSpan {
  years?: number;
  months?: number;
}

/** 周期の見出しに書いた単位（「周期(年)」→ 年、「周期（月）」「周期(か月)」→ 月）。書いていなければ null */
export function cycleHeaderUnit(header: string): "years" | "months" | null {
  const h = nfkc(header).replace(/\s+/g, "");
  if (/[(（][^)）]*(?:か月|ヶ月|カ月|ケ月|月)[^)）]*[)）]/u.test(h)) return "months";
  if (/[(（][^)）]*年[^)）]*[)）]/u.test(h)) return "years";
  return null;
}

/**
 * 周期の書き方を読む：「1年」「3Y」は年、「6か月」「6ヶ月」「130M」は月。数だけ（「3」）は見出しの単位で読み、単位が無ければ読まない。
 * 年の小数（「0.5」年）は月に直す（整数の月になるときだけ）。読めない書き方（「毎回」「隔回」「随時」）は null（呼ぶ側が聞く）
 */
export function parseCycle(text: string, headerUnit: "years" | "months" | null): CycleSpan | null {
  const s = nfkc(text).replace(/\s+/g, "");
  const toYears = (n: number): CycleSpan | null => (Number.isInteger(n) && n > 0 ? { years: n } : Number.isInteger(n * 12) && n > 0 ? { months: n * 12 } : null);
  const toMonths = (n: number): CycleSpan | null => (Number.isInteger(n) && n > 0 ? (n % 12 === 0 ? { years: n / 12 } : { months: n }) : null);
  let m = /^(\d+(?:\.\d+)?)(?:年|Y)$/iu.exec(s);
  if (m) return toYears(Number(m[1]));
  m = /^(\d+)(?:か月|ヶ月|カ月|ケ月|月|M)$/iu.exec(s);
  if (m) return toMonths(Number(m[1]));
  // 「年4回」「年12回」：12 か月を回数で割る（割り切れるときだけ）
  m = /^年(\d+)回$/u.exec(s);
  if (m && Number(m[1]) > 0 && 12 % Number(m[1]) === 0) return toMonths(12 / Number(m[1]));
  m = /^(\d+(?:\.\d+)?)$/u.exec(s);
  if (m && headerUnit === "years") return toYears(Number(m[1]));
  if (m && headerUnit === "months") return toMonths(Number(m[1]));
  return null;
}

// ─── 件名の中の機器の名前 ─────────────────────────────────────

const TITLE_WORK = [...new Set(CUES.titleWork.map((w) => nfkc(w)))].sort((a, b) => b.length - a.length);

/**
 * 機器の欄の無い台帳の件名（「R3年度 中央監視制御装置保守点検業務委託」「DCS保守点検業務委託（H28年度）」）の、機器の名前の案：
 * 後ろの括弧（年度・回数）と頭の年度を除き、後ろの作業の語（「点検」「業務委託」など）をくり返し除いた残り。作業の語が無ければ null
 */
export function assetFromTitle(text: string): { asset: string; work: string } | null {
  let s = nfkc(text).replace(/\s+/g, " ").trim();
  s = s.replace(/\s*[(（][^()（）]*[)）]\s*$/u, "").trim();
  s = s.replace(/^(?:(?:令和|平成|R|H)\s*(?:\d{1,2}|元)|(?:19|20)\d{2})\s*年度\s*/u, "").trim();
  let work = "";
  for (;;) {
    const w = TITLE_WORK.find((x) => s.endsWith(x) && s.length > x.length);
    if (!w) break;
    work = `${w}${work}`;
    s = s.slice(0, -w.length).trim();
  }
  return work && s ? { asset: s, work } : null;
}

// ─── 工数 ────────────────────────────────────────────────────

export type EffortValue = { amount: number; unit: "manDays" | "hours" | "persons" | "bare"; style: string };

const W = (xs: readonly string[]) => xs.map((x) => escapeRe(nfkc(x))).sort((a, b) => b.length - a.length).join("|");
const NUM = "(\\d+(?:\\.\\d+)?)";
const RE_MD = new RegExp(`^(?:${W(CUES.effort.totalPrefix)})?${NUM}(?:${W(CUES.effort.manDays)})$`, "i");
const RE_TOTAL_PERSONS = new RegExp(`^(?:${W(CUES.effort.totalPrefix)})${NUM}(?:${W(CUES.effort.persons)})$`, "i");
const RE_PERSONS = new RegExp(`^${NUM}(?:${W(CUES.effort.persons)})$`, "i");
const RE_HOURS = new RegExp(`^${NUM}(?:${W(CUES.effort.hours)})$`, "i");
const RE_BARE = new RegExp(`^${NUM}$`);

/**
 * 工数の書き方を読む。人・日／人工／延べ N 人は人・日の数（延べ人数は人・日を数えたもの）。
 * 時間は、1 人・日の時間が決まるまで人・日に直さない（呼ぶ側が質問にする）。
 * 「N 人」（延べが無い）は人数で、人・日ではない。数だけは単位が分からない。
 */
export function parseEffort(v: string | number): EffortValue | null {
  if (typeof v === "number") return Number.isFinite(v) ? { amount: v, unit: "bare", style: "数だけ" } : null;
  const s = nfkc(v).replace(/[\s　]+/g, "");
  let m = RE_MD.exec(s);
  if (m) return { amount: Number(m[1]), unit: "manDays", style: s.replace(/[\d.]+/, "{n}") };
  m = RE_TOTAL_PERSONS.exec(s);
  if (m) return { amount: Number(m[1]), unit: "manDays", style: s.replace(/[\d.]+/, "{n}") };
  m = RE_HOURS.exec(s);
  if (m) return { amount: Number(m[1]), unit: "hours", style: s.replace(/[\d.]+/, "{n}") };
  m = RE_PERSONS.exec(s);
  if (m) return { amount: Number(m[1]), unit: "persons", style: s.replace(/[\d.]+/, "{n}") };
  m = RE_BARE.exec(s.replace(/,/g, ""));
  if (m) return { amount: Number(m[1]), unit: "bare", style: "数だけ" };
  // 時間と分（「192:00」「7:30」）：時間
  m = /^(\d{1,5}):([0-5]\d)$/.exec(s);
  if (m) return { amount: Number(m[1]) + Number(m[2]) / 60, unit: "hours", style: "{h}:{mm}" };
  return null;
}

// ─── 作業日報の人数と作業時間の幅（工数＝人数 × 時間 ÷ 1 人・日の時間） ─────────

export type PersonsValue = { n: number; style: "数" | "計" | "職種" };

const TRADES = CUES.effort.trades.map((w) => nfkc(w)).filter((w) => w !== "");
/** 略した職種の 1 字（職種の語の頭の字）→ 職種の語。2 つの語の頭が同じ字なら、その字は略として読まない */
const TRADE_ABBR = (() => {
  const m = new Map<string, string | null>();
  for (const w of TRADES) {
    const ch = [...w][0] ?? "";
    m.set(ch, m.has(ch) ? null : w);
  }
  return m;
})();
const PERSON_UNIT = W(CUES.effort.persons);
const TOTAL_WORDS = W([...CUES.rowRole.totalExact, ...CUES.rowRole.total]);
const RE_PERSONS_TOTAL = new RegExp(`^(?:${TOTAL_WORDS})(\\d+)(?:${PERSON_UNIT})(?:[(（][^()（）]*[)）])?$`, "u");
const RE_PERSONS_PLAIN = new RegExp(`^(\\d+)(?:${PERSON_UNIT})?$`, "u");
const RE_TRADE_TOKEN = new RegExp(`^(?:(${W(TRADES)})|(\\p{Script=Han}))(\\d+)(?:${PERSON_UNIT})?`, "u");
/** 規則の職種の語（Skillパック・3 段目の effortTrade）を足した読み手。足す語の組ごとに 1 つ作って覚える */
const tradeParsers = new Map<string, { token: RegExp; abbr: Map<string, string | null> }>();
function tradeParser(extra: readonly string[]): { token: RegExp; abbr: Map<string, string | null> } {
  const add = extra.map((w) => nfkc(w)).filter((w) => w !== "" && !TRADES.includes(w));
  if (!add.length) return { token: RE_TRADE_TOKEN, abbr: TRADE_ABBR };
  const key = add.join("\u0001");
  const hit = tradeParsers.get(key);
  if (hit) return hit;
  const words = [...TRADES, ...add];
  const abbr = new Map<string, string | null>();
  for (const w of words) {
    const ch = [...w][0] ?? "";
    abbr.set(ch, abbr.has(ch) ? null : w);
  }
  const made = { token: new RegExp(`^(?:(${W(words)})|(\\p{Script=Han}))(\\d+)(?:${PERSON_UNIT})?`, "u"), abbr };
  tradeParsers.set(key, made);
  return made;
}
const LIST_SEP = new RegExp(`[\\s、,，${CUES.listSeparators.map((x) => escapeRe(nfkc(x))).join("")}]+`, "gu");

/**
 * 人数の欄を読む（作業日報の「作業人員」）。読める書き方：数（「4」「4名」）、合計（「計4名（機械工3）」は 4。括弧の中は内訳で、足さない）、
 * 職種の語＋数の並び（「機械工1 溶接工1 作業員2」は 4）、略した職種の 1 字＋数（「機2」）。職種の語は packs/_cues の手がかり。
 * 読めなければ null（呼ぶ側が質問にする）
 */
export function parsePersons(v: string | number, extraTrades: readonly string[] = []): PersonsValue | null {
  const { token: tradeToken, abbr: tradeAbbr } = tradeParser(extraTrades);
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? { n: v, style: "数" } : null;
  const s = nfkc(v).trim();
  if (!s) return null;
  const tight = s.replace(/[\s　]+/g, "");
  let m = RE_PERSONS_PLAIN.exec(tight);
  if (m) return { n: Number(m[1]), style: "数" };
  m = RE_PERSONS_TOTAL.exec(tight);
  if (m) return { n: Number(m[1]), style: "計" };
  let rest = s.replace(LIST_SEP, "");
  let n = 0;
  let count = 0;
  while (rest) {
    const t = tradeToken.exec(rest);
    if (!t) return null;
    // 1 字の略は、職種の語の頭の字で、ほかの語と重ならないものだけ
    if (!t[1] && !tradeAbbr.get(t[2] ?? "")) return null;
    n += Number(t[3]);
    count++;
    rest = rest.slice(t[0].length);
  }
  return count ? { n, style: "職種" } : null;
}

/** 見出しの末尾の括弧が人数の単位か（「職種別人員（人）」）。上の段がこの形なら、下の段の列は人数の列 */
export function personsHeaderUnit(header: string): boolean {
  const h = nfkc(header).replace(/[\s　]+/g, "");
  const paren = /[(（]([^()（）]*)[)）]$/u.exec(h)?.[1] ?? null;
  return paren !== null && CUES.effort.persons.some((w) => nfkc(w) === paren);
}

export interface TimeSpan {
  /** 始まりと終わり（0 時からの分） */
  start: number;
  end: number;
  /** 幅の時間（昼休みは引かない） */
  hours: number;
}

// 波線（全角・半角・波ダッシュ）とハイフン・ダッシュの類（NFKC のあと）
const RE_SPAN = /^(\d{1,2}):(\d{2})[~〜\-‐‑‒–—―−ー](\d{1,2}):(\d{2})$/u;

/**
 * 作業時間の幅「開始～終了」（「8:30～17:00」「8:30-17:00」）を読む。昼休みは引かない（引くかは呼ぶ側が聞く）。
 * 終わりが始まりより前（夜をまたぐ書き方）・時刻として読めないものは null
 */
export function parseTimeSpan(text: string): TimeSpan | null {
  const m = RE_SPAN.exec(nfkc(text).replace(/[\s　]+/g, ""));
  if (!m) return null;
  const [h0, m0, h1, m1] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
  if (m0 > 59 || m1 > 59 || h0 > 24 || h1 > 24 || (h0 === 24 && m0 > 0) || (h1 === 24 && m1 > 0)) return null;
  const start = h0 * 60 + m0;
  const end = h1 * 60 + m1;
  if (end <= start) return null;
  return { start, end, hours: (end - start) / 60 };
}

/** 幅と、昼休み（12:00 から lunchHours 時間）の重なり（時間） */
export function lunchOverlap(span: TimeSpan, lunchHours: number): number {
  const a = Math.max(span.start, 12 * 60);
  const b = Math.min(span.end, 12 * 60 + lunchHours * 60);
  return b > a ? (b - a) / 60 : 0;
}

// ─── 番号 1 / 1-1 / 1-1-1 ─────────────────────────────────────

/** 段の番号の深さ。「1」→1、「1-1」→2、「1.2.3」→3。番号でなければ null */
export function numberDepth(v: string | number): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? 1 : null;
  const s = nfkc(v).replace(/\s+/g, "");
  if (!/^\d{1,3}(?:[-.]\d{1,3})*$/.test(s)) return null;
  return s.split(/[-.]/).length;
}

// ─── 名前の中の機器番号 ───────────────────────────────────────

export interface TagSplit {
  name: string;
  tag: string;
  /** 書き方の形（質問をまとめる鍵）："末尾の括弧" か "頭の符号" */
  pattern: "trailingParen" | "leadingCode";
}

const RE_TAG_PAREN = /^(.+?)\s*[（(〔［[]\s*([A-Z][A-Z0-9]{1,7}(?:-[A-Z0-9]{1,6})*)\s*[)）〕］\]]$/;
const RE_TAG_LEAD = /^([A-Z][A-Z0-9]{1,7}(?:-[A-Z0-9]{1,6})*)\s+(\S.*)$/;

/** 名前の中の英大文字の符号（機器番号）の候補。決めるのは呼ぶ側（質問にする） */
export function splitTag(text: string): TagSplit | null {
  const s = nfkc(text).replace(/\s*\n\s*/g, " ").trim();
  let m = RE_TAG_PAREN.exec(s);
  if (m && m[1] && m[2]) return { name: m[1].trim(), tag: m[2], pattern: "trailingParen" };
  m = RE_TAG_LEAD.exec(s);
  if (m && m[1] && m[2] && /[^\x00-\x7f]/.test(m[2])) return { name: m[2].trim(), tag: m[1], pattern: "leadingCode" };
  return null;
}

/** 機器番号の末尾の数（「ABC-1」「AB1」→ 1）。無ければ null */
export function tagTrailingNumber(tag: string): number | null {
  const m = /-(\d{1,3})$/.exec(tag) ?? /[A-Z](\d{1,3})$/.exec(tag);
  return m ? Number(m[1]) : null;
}

/** 名前を比べるための形（NFKC・空白なし・括弧の全角半角をそろえる） */
export function nameKey(s: string): string {
  return norm(s).replace(/[（]/g, "(").replace(/[）]/g, ")");
}

/** 記号らしい短い文字か（凡例・印のセル） */
export function isSymbolLike(s: string): boolean {
  const t = nfkc(s).trim();
  if (!t || t.length > 3) return false;
  return !/[0-9A-Za-z\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t);
}

export { norm };

// ─── 費用の列（運営者の決定 A 案、2026-11-06。Architect の注文：単位を推測しない・円の整数で持つ・元のセルと元の字を残す） ─────

/** 費用の列の見出しの単位：「(千円/回)」「千円」→ 1000、「万円」→ 10000、「(円)」「円」→ 1。決まらなければ null（呼ぶ側が聞く） */
export function costHeaderUnit(header: string): number | null {
  const h = nfkc(header).replace(/\s+/g, "");
  if (/百万円/u.test(h)) return 1_000_000;
  if (/千円/u.test(h)) return 1000;
  if (/万円/u.test(h)) return 10_000;
  if (/円/u.test(h)) return 1;
  return null;
}

/** 費用の列の見出しの税の扱い：「税込」→ incl、「税抜」「税別」→ excl。決まらなければ null（呼ぶ側が聞く） */
export function costHeaderTax(header: string): "incl" | "excl" | null {
  const h = nfkc(header).replace(/\s+/g, "");
  if (/税込/u.test(h)) return "incl";
  if (/税抜|税別/u.test(h)) return "excl";
  return null;
}

/**
 * 費用のセルを読む：数の値か、「1,200」「¥1,200」「1200千円」の形。セルに単位（千円・万円・円）があればそれで、無ければ見出しの単位で円にする。
 * 円の整数にならないもの・数の無いもの・単位の決まらないものは null（呼ぶ側が聞く。推し量らない）
 */
export function parseCost(text: string, value: unknown, headerUnit: number | null): number | null {
  const s = nfkc(text).replace(/[\s,，]/g, "").replace(/^[¥￥]/u, "");
  const num = typeof value === "number" && Number.isFinite(value) && s.replace(/[円千万百]/gu, "") === String(value).replace(/,/g, "") ? value : null;
  const m = /^(\d+(?:\.\d+)?)(百万円|千円|万円|円)?$/u.exec(s);
  const n = num ?? (m ? Number(m[1]) : null);
  if (n === null || !Number.isFinite(n) || n < 0) return null;
  const unit = m?.[2] === "百万円" ? 1_000_000 : m?.[2] === "千円" ? 1000 : m?.[2] === "万円" ? 10_000 : m?.[2] === "円" ? 1 : headerUnit;
  if (unit === null) return null;
  const yen = Math.round(n * unit * 1000) / 1000;
  return Number.isInteger(yen) ? yen : null;
}
