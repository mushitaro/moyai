// 値の無いセルの「―」（U+2015）。等幅の書体では「—」に見えるので、等幅の列でも本文の字（text-3）で出す（docs/words.md、Wire、11-06）
export const NONE = "―";

export function NoneMark() {
  return <span className="moyai-none">{NONE}</span>;
}
