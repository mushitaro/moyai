// 紐付けの規則の文（案の根拠として計画に残り、版に署名して保管する。AI も intake_survey と crosswalk_propose の結果で読む）。
// 訳さない（英語の画面でも同じ字）：計画に残る字が画面の言語で変わらないように。state/crosswalk.ts が sameAs の形を正規表現で探し、「。」でつなぐ。
// 規則の ID（ruleId）は AI がツールで指す名前でもある。
export const CROSSWALK_BASIS_TEXT = {
  ruleId: (n: number) => `案 ${n}`,
  empty: "（空）",
  cond: {
    equals: (f: string, v: string) => `${f}が${v}`,
    in: (f: string, vs: string) => `${f}が${vs}のどれか`,
    contains: (f: string, v: string) => `${f}に${v}を含む`,
    prefix: (f: string, v: string) => `${f}が${v}で始まる`,
    range: (f: string, a: string, b: string) => `${f}が ${a}〜${b}`,
    and: "、かつ ",
  },
  toItem: (name: string, code: string) => `共通の設備項目「${name}」（${code}）`,
  toAttr: (label: string, code: string) => `作業の属性「${label}」（${code}）`,
  ruleBasis: (id: string, cond: string, to: string, reason: string) => `${id}：${cond} → ${to}。AI の理由：${reason}`,
  acceptedBasis: (basis: string, reason: string) => `${basis}。人が受けた理由：${reason}`,
  /** 1C：もとにした版で人が受けた当てはめと同じ案の理由（決定のシートの「第 n 版と同じ」の受ける理由の既定にもする。Wire） */
  sameAs: (n: number) => `第 ${n} 版で受けた当てはめと同じ`,
  humanBasis: (reason: string) => `人が画面で当てた。理由：${reason}`,
};
