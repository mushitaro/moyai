// MOYAI のしるし（結ぶ M 朱。src/app/public/brand/README.md）を、画面の色の変数で描く。
// 形は scripts/brand.mjs の書き出し（mark-*.svg）と同じ。形を変えるときは scripts/brand.mjs を直し、ここも合わせる。
// 墨の印は --text、結び目の輪だけ --shu（暗・明の切り替えにそのまま付いてくる）。
const PLAN: [number, number][] = [
  [8.8, 8.8],
  [8.8, 26.8],
  [26.8, 26.8],
  [8.8, 44.8],
  [8.8, 62.8],
];
const ACTUAL: [number, number][] = [
  [80.8, 8.8],
  [62.8, 26.8],
  [80.8, 26.8],
  [80.8, 44.8],
  [80.8, 62.8],
];

export function BrandMark({ height }: { height: number }) {
  return (
    <svg viewBox="0 0 89.6 71.6" height={height} width={(height * 89.6) / 71.6} aria-hidden="true" focusable="false" className="moyai-mark">
      {PLAN.map(([cx, cy]) => (
        <circle key={`p${cx},${cy}`} cx={cx} cy={cy} r={6.4} fill="none" stroke="var(--text)" strokeWidth={2.8} />
      ))}
      {ACTUAL.map(([cx, cy]) => (
        <circle key={`a${cx},${cy}`} cx={cx} cy={cy} r={7.8} fill="var(--text)" />
      ))}
      <circle cx={44.8} cy={44.8} r={7.4} fill="none" stroke="var(--shu)" strokeWidth={3.2} />
      <circle cx={44.8} cy={44.8} r={3.2} fill="var(--text)" />
    </svg>
  );
}
