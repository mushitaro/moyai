// 画面のビルド（src/app → dist/app）。ビルドの印をここで埋める。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { sharedBuildStamp } from "./scripts/build-stamp.mjs";

const stamp = sharedBuildStamp();

export default defineConfig({
  root: fileURLToPath(new URL("./src/app", import.meta.url)),
  base: "/",
  plugins: [react()],
  define: {
    __MOYAI_BUILD__: JSON.stringify(stamp),
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/app", import.meta.url)),
    emptyOutDir: true,
    target: "es2023",
    // 書体の小さなファイルを JS に埋め込まない（埋め込むと Windows でも読み込まれるため）
    assetsInlineLimit: 0,
  },
});
