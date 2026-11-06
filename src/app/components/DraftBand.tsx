// 下の帯の「前の作業を戻す｜捨てる」（pwa-v0）。開いたときに前の作業の写し（state/draft.ts）が残っていれば出し、人が選ぶまで消さない。
// 施設か版が今の作業と違えば「戻す」は押せず、理由を出す。
// 出すのは橋渡しとつながったタブだけ（タブは 1 つだけ。断られた 2 つ目のタブで戻したり捨てたりしない）。
import { useConnection } from "../state/bridge";
import { draftKeeper, useDraftView } from "../state/draft";
import { TEXT } from "../text";

const T = TEXT.draft;

/** 書いた時刻を、この PC の時刻で「YYYY-MM-DD HH:mm」にする（読めなければ空） */
export function draftTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 戻したあとに呼ぶ（計画の ID を取り込みの作業場に固定するなど。App.tsx が渡す） */
export function DraftBand({ onRestored }: { onRestored: (planId: string) => void }) {
  const { offer, block } = useDraftView();
  const { state } = useConnection();
  if (!offer || state.kind !== "open") return null;
  const plan = offer.working.plan;
  const restore = () => {
    const k = draftKeeper();
    if (k && k.restore() === null) onRestored(plan.planId);
  };
  const discard = () => void draftKeeper()?.discard();
  return (
    <span className="moyai-status-draft" role="group" aria-label={T.label} data-testid="draft-band">
      <span className="moyai-status-draft-what" data-testid="draft-what">
        {T.what(plan.displayName || plan.planId, draftTime(offer.savedAt))}
      </span>
      {block && <span data-testid="draft-blocked">{T.blocked[block]}</span>}
      <button type="button" className="moyai-status-button" onClick={restore} disabled={block !== null} data-testid="draft-restore">
        {T.restore}
      </button>
      <span className="moyai-switch-sep" aria-hidden="true" />
      <button type="button" className="moyai-status-button" onClick={discard} data-testid="draft-discard">
        {T.discard}
      </button>
    </span>
  );
}
