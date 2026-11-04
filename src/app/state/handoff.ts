// 渡すメールの文（docs/screens.md 3.4）：人が「署名して渡す」を押すと、橋渡しが文を用意して返す。このタブのメモリに置き、
// AI には intake_survey の handoff で渡す（Claude が利用者の連携したメールから送る。決まり 1 の例外の 1 つめ）。人は自分のメーラーでも開ける。
export interface HandoffMail {
  to: string;
  subject: string;
  body: string;
}

let current: HandoffMail | null = null;

export function setHandoffMail(m: HandoffMail | null): void {
  current = m;
}

export function getHandoffMail(): HandoffMail | null {
  return current;
}

/** 自分のメーラーで開くリンク（mailto:） */
export function mailtoOf(m: HandoffMail): string {
  return `mailto:${encodeURIComponent(m.to)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
}
