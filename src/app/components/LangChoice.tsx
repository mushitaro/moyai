// 設定の画面の「言語　English | 日本語」（2026-11-16、運営者「グローバル対応」。絵：Wire Frame の Settings）。
// 押すとすぐ描き直す（読み込み直しなし）。橋渡しにつながっていれば設定（settings.json の lang）にも保存する（上の行の「保存」とは別）。
// 選びの字は、どちらの画面でもその言語の字で書く（読めない言語の画面からでも戻れる）。
import { setLang, type Lang } from "../text/i18n";
import { useLang } from "../text/use-lang";
import { Switch } from "./Switch";

/** 選びの字（訳さない） */
export const LANG_LABELS: Record<Lang, string> = { en: "English", ja: "日本語" };

export function LangChoice({ label, onSave }: { label: string; onSave?: (lang: Lang) => void }) {
  const lang = useLang();
  return (
    <Switch
      aria-label={label}
      data-testid="lang-choice"
      value={lang}
      onChange={(v) => {
        setLang(v);
        onSave?.(v);
      }}
      data={[
        { value: "en", label: LANG_LABELS.en },
        { value: "ja", label: LANG_LABELS.ja },
      ]}
    />
  );
}
