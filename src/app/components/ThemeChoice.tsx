// 設定の画面の「明暗　自動 | 暗 | 明」（mushitaro/moyai#61。既定は自動＝PC の設定に従う）。選びはこの PC に覚える（Mantine の色の手）。
// ヘッダには置かない（引き算）。AI の screen_set の theme も、同じ applyTheme を通る。
import { useMantineColorScheme } from "@mantine/core";
import { applyTheme, type ThemeChoice as Choice } from "../state/screen";
import { TEXT } from "../text";
import { Switch } from "./Switch";

const S = TEXT.shell;

export function ThemeChoice() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <Switch
      aria-label={S.themeLabel}
      data-testid="theme-choice"
      value={colorScheme}
      onChange={(v) => applyTheme(v as Choice) || setColorScheme(v as Choice)}
      data={[
        { value: "auto", label: S.themeAuto },
        { value: "dark", label: S.themeDark },
        { value: "light", label: S.themeLight },
      ]}
    />
  );
}
