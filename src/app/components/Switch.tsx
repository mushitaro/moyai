// 表示の切り替え（デザイン定義 §10.6）：選べる言葉を短い縦の罫でつなぎ、選んでいる言葉を墨の字と太さで示す。下線も塗りの台も持たない。
// 選択肢は 2〜3 つまで。それより多いときは選ぶ欄にする。
import { Fragment } from "react";

export interface SwitchItem<V extends string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export function Switch<V extends string>(props: {
  value: V;
  onChange: (value: V) => void;
  data: readonly SwitchItem<V>[];
  "aria-label": string;
  "data-testid"?: string;
}) {
  return (
    <div className="moyai-switch" role="group" aria-label={props["aria-label"]} data-testid={props["data-testid"]}>
      {props.data.map((d, i) => (
        <Fragment key={d.value}>
          {i > 0 && (
            <span className="moyai-switch-sep" aria-hidden="true" />
          )}
          <button
            type="button"
            className="moyai-switch-item"
            aria-pressed={props.value === d.value}
            disabled={d.disabled}
            onClick={() => props.value !== d.value && props.onChange(d.value)}
          >
            {d.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
