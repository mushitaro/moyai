// Mantine をデザイン定義 §13.2 に合わせる設定。色の値はここに書かず、src/ui/tokens.css の変数を指す。
// 運営者の指示（2026-11-04）：「研ぎ澄まされた刀」と「もやいの輪＝和＝柔」。箱の縁を消し、線は 1 本の細い刃のように、余白は広く。
// - ボタンも入力欄も、切り替えと同じく字の濃さと太さだけで示す（運営者の指示 2026-11-04：引き算）。
//   主ボタンは墨の字・太さ 500、二番目は淡い字・太さ 400。面・縁・下線・矢印は持たない。
//   入力欄は地とほとんど同じ淡い面で、線を持たない。入力しているあいだは上の名前が墨の字・太さ 500 になり、面が 1 段沈む。
//   面と地の差は 3:1 に届かない。上の名前と入力の例で、そこに入れることを示す。
// - 箱（Paper の縁）とタグの縁は消し、余白で分ける。
// 画面のコードに残っている color="red" などの名前は、墨と朱のどちらかに向ける（緑・黄・青を出さない。§2.1）。
import { Alert, Badge, Button, createTheme, type CSSVariablesResolver, type MantineColorsTuple } from "@mantine/core";

// 明るい順（0 = sumi-e0、9 = sumi-16）
const sumi: MantineColorsTuple = [
  "var(--sumi-e0)",
  "var(--sumi-c0)",
  "var(--sumi-b5)",
  "var(--sumi-88)",
  "var(--sumi-7a)",
  "var(--sumi-6b)",
  "var(--sumi-5e)",
  "var(--sumi-4a)",
  "var(--sumi-3a)",
  "var(--sumi-16)",
];
const shu: MantineColorsTuple = [
  "var(--shu-400)",
  "var(--shu-400)",
  "var(--shu-400)",
  "var(--shu-400)",
  "var(--shu-500)",
  "var(--shu-500)",
  "var(--shu-600)",
  "var(--shu-600)",
  "var(--shu-600)",
  "var(--shu-600)",
];

/** 朱に向ける名前（誤り・注意）と、墨に向ける名前（それ以外） */
const SHU_NAMES = new Set(["red", "orange", "shu"]);
const isShu = (color: string | undefined) => color !== undefined && SHU_NAMES.has(color);

export const moyaiTheme = createTheme({
  colors: { sumi, shu, red: shu, orange: shu, teal: sumi, green: sumi, blue: sumi, yellow: sumi, gray: sumi },
  primaryColor: "sumi",
  primaryShade: { light: 9, dark: 0 },
  fontFamily: "var(--font-body)",
  fontFamilyMonospace: "var(--font-num)",
  headings: {
    fontFamily: "var(--font-heading)",
    fontWeight: "500",
    sizes: {
      h1: { fontSize: "24px", lineHeight: "40px", fontWeight: "400" },
      h2: { fontSize: "24px", lineHeight: "40px", fontWeight: "400" },
      h3: { fontSize: "17px", lineHeight: "30px", fontWeight: "500" },
      h4: { fontSize: "17px", lineHeight: "30px", fontWeight: "500" },
      h5: { fontSize: "14px", lineHeight: "22px", fontWeight: "500" },
      h6: { fontSize: "14px", lineHeight: "22px", fontWeight: "500" },
    },
  },
  // §3.2：xs = caption、sm = body-s、md = body、lg = body-l
  fontSizes: { xs: "11px", sm: "13px", md: "14px", lg: "16px", xl: "20px" },
  lineHeights: { xs: "18px", sm: "22px", md: "26px", lg: "30px", xl: "30px" },
  // §4.1 の段：xs = sp-3、sm = sp-5、md = sp-6、lg = sp-7、xl = sp-8（余白を広く取る）
  spacing: { xs: "8px", sm: "16px", md: "24px", lg: "32px", xl: "48px" },
  defaultRadius: 0,
  radius: { xs: "0", sm: "0", md: "0", lg: "0", xl: "0" },
  shadows: { xs: "none", sm: "none", md: "none", lg: "none", xl: "none" },
  cursorType: "pointer",
  components: {
    Button: Button.extend({
      vars: (_theme, props) => {
        const variant = props.variant ?? "filled";
        const size = props.size ?? "md";
        const height = size === "compact-sm" || size === "xs" || size === "sm" ? "var(--h-s)" : size === "lg" || size === "xl" ? "var(--h-l)" : "var(--h-m)";
        const root: Record<string, string> = {
          "--button-height": height,
          "--button-padding-x": height === "var(--h-s)" ? "var(--sp-5)" : "var(--sp-6)",
          "--button-fz": "13px",
          "--button-radius": "0",
        };
        // 切り替えと同じ決まり：面・縁・下線・矢印を持たず、字の濃さと太さだけ（運営者の指示 2026-11-04）。
        // 主（filled）は墨の字と太さ 500、二番目は淡い字と太さ 400。朱の名前は朱の字
        const primary = variant === "filled";
        root["--button-bg"] = "transparent";
        root["--button-hover"] = "transparent";
        root["--button-bd"] = "0";
        root["--button-padding-x"] = "var(--sp-2)";
        root["--button-color"] = isShu(props.color) ? "var(--shu-text)" : primary ? "var(--text)" : "var(--text-3)";
        return { root };
      },
      styles: (_theme, props) => ({
        root: {
          fontWeight: (props.variant ?? "filled") === "filled" ? 500 : 400,
          letterSpacing: "var(--track-label)",
          transition: "color var(--dur-quick) var(--ease-standard)",
        },
      }),
      classNames: { root: "moyai-button" },
    }),
    Badge: Badge.extend({
      defaultProps: { variant: "transparent", radius: 0 },
      // タグは縁を持たない言葉だけ。朱の札だけ朱の字
      vars: (_theme, props) => ({
        root: {
          "--badge-height": "auto",
          "--badge-padding-x": "0",
          "--badge-fz": "12px",
          "--badge-radius": "0",
          "--badge-bg": "transparent",
          "--badge-bd": "0",
          "--badge-color": isShu(props.color) ? "var(--shu-text)" : "var(--text-2)",
        },
      }),
      styles: { root: { textTransform: "none", fontWeight: 500, letterSpacing: "var(--track-label)", overflow: "visible" } },
    }),
    Alert: Alert.extend({
      defaultProps: { radius: 0, variant: "light" },
      // §10.11：地を持たず、左に状態の罫（誤りは朱の実線、注意は朱の破線、ほかは 1px の罫）
      styles: (_theme, props) => ({
        root: {
          background: "transparent",
          border: 0,
          borderLeft: props.color === "red" ? "2px solid var(--shu)" : props.color === "orange" ? "2px dashed var(--shu)" : "1px solid var(--line-strong)",
          padding: "var(--sp-3) var(--sp-6)",
          color: "var(--text)",
        },
        title: { color: "var(--text)", fontWeight: 500, letterSpacing: "var(--track-label)" },
        message: { color: "var(--text-2)" },
        icon: { color: props.color === "red" || props.color === "orange" ? "var(--shu-text)" : "var(--text)" },
      }),
    }),
    // 現れる演出はしない（DS：動きは色の変化だけ）。Modal・Menu・Popover・Tooltip のフェードを 0 に
    Modal: {
      defaultProps: { radius: 0, shadow: "none", centered: false, transitionProps: { duration: 0 }, overlayProps: { backgroundOpacity: 1, color: "var(--overlay)" } },
      styles: {
        content: { background: "var(--layer-2)", border: "1px solid var(--line-strong)" },
        header: { background: "var(--layer-2)", padding: "var(--sp-7) var(--sp-8) var(--sp-5)" },
        body: { padding: "0 var(--sp-8) var(--sp-7)" },
        title: { fontFamily: "var(--font-heading)", fontSize: "17px", lineHeight: "30px", fontWeight: 500, letterSpacing: "var(--track-heading)" },
      },
    },
    Paper: {
      // 箱は作らない（§1）。縁は消し、上に 1 本の細い罫と余白だけ
      defaultProps: { radius: 0, shadow: "none" },
      styles: { root: { background: "transparent", border: 0, borderTop: "1px solid var(--line)", paddingInline: 0 } },
    },
    // 入力欄と、その名前・補足は src/app/theme.css に置く（焦点の見え方を CSS で切り替えるため。theme の styles は style 属性になり上書きできない）
    Checkbox: {
      defaultProps: { radius: 0, color: "sumi" },
      vars: () => ({ root: { "--checkbox-color": "var(--fill)", "--checkbox-icon-color": "var(--on-fill)", "--checkbox-radius": "0" } }),
    },
    Radio: {
      // 丸の地はいつも透明なので、選んだ印の点は墨で描く（地の色で描くと、選んでも見えない）
      vars: () => ({ root: { "--radio-color": "var(--text)", "--radio-icon-color": "var(--text)", "--radio-size": "16px" } }),
      styles: { radio: { background: "transparent", borderColor: "var(--line-field)" }, label: { letterSpacing: "var(--track-body)" } },
    },
    Table: {
      // §10.8：縦の罫なし、縞なし、見出しは地を持たず label の text-3。セルの余白は広く
      defaultProps: { verticalSpacing: "sm", horizontalSpacing: "md" },
      styles: {
        th: { background: "transparent", color: "var(--text-3)", fontSize: "12px", fontWeight: 500, letterSpacing: "var(--track-label)", borderBottom: "1px solid var(--line-strong)" },
        td: { fontSize: "13px", letterSpacing: "var(--track-body)" },
      },
    },
    Code: {
      styles: { root: { background: "var(--layer-1)", color: "var(--text)", borderRadius: 0, fontFamily: "var(--font-num)", padding: "var(--sp-3) var(--sp-4)" } },
    },
    Anchor: {
      defaultProps: { underline: "always" },
      styles: { root: { color: "var(--text)", textUnderlineOffset: "6px", textDecorationColor: "var(--line-strong)", letterSpacing: "var(--track-body)" } },
    },
    Menu: {
      defaultProps: { radius: 0, shadow: "none", transitionProps: { duration: 0 } },
      styles: { dropdown: { background: "var(--layer-2)", border: "1px solid var(--line-strong)" } },
    },
    Popover: {
      defaultProps: { radius: 0, shadow: "none", transitionProps: { duration: 0 } },
    },
    Tooltip: {
      defaultProps: { radius: 0, openDelay: 400, transitionProps: { duration: 0 } },
      styles: { tooltip: { background: "var(--layer-3)", color: "var(--text)", fontSize: "13px", maxWidth: 280, padding: "var(--sp-3) var(--sp-4)" } },
    },
    Text: {
      styles: { root: { letterSpacing: "var(--track-body)" } },
    },
    Stack: {
      defaultProps: { gap: "md" },
    },
  },
});

/** Mantine の色の変数を役割のトークンに向ける（§13.2） */
export const moyaiCssVariables: CSSVariablesResolver = () => {
  const common = {
    "--mantine-color-body": "var(--bg)",
    "--mantine-color-text": "var(--text)",
    "--mantine-color-dimmed": "var(--text-3)",
    "--mantine-color-error": "var(--shu-text)",
    "--mantine-color-placeholder": "var(--text-3)",
    "--mantine-color-anchor": "var(--text)",
    "--mantine-color-default": "transparent",
    "--mantine-color-default-hover": "transparent",
    "--mantine-color-default-color": "var(--text)",
    "--mantine-color-default-border": "var(--line)",
    "--mantine-primary-color-filled": "var(--fill)",
    "--mantine-primary-color-filled-hover": "var(--fill-hover)",
    "--mantine-primary-color-contrast": "var(--on-fill)",
  };
  return { variables: {}, light: common, dark: common };
};
