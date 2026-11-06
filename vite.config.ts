// 画面のビルド（src/app → dist/app）。ビルドの印をここで埋める。
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sharedBuildStamp, stampServiceWorker, type BuildStamp } from "./scripts/build-stamp.mjs";

const stamp = sharedBuildStamp();
const outDir = fileURLToPath(new URL("./dist/app", import.meta.url));

/** public から写した sw.js に、ビルドの印を埋める（覚えの名前に入る。PWA） */
function stampSw(s: BuildStamp): Plugin {
  return {
    name: "moyai:stamp-sw",
    apply: "build",
    writeBundle() {
      const p = join(outDir, "sw.js");
      writeFileSync(p, stampServiceWorker(readFileSync(p, "utf8"), s));
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL("./src/app", import.meta.url)),
  base: "/",
  plugins: [react(), stampSw(stamp)],
  define: {
    __MOYAI_BUILD__: JSON.stringify(stamp),
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: "es2023",
    // 書体の小さなファイルを JS に埋め込まない（埋め込むと Windows でも読み込まれるため）
    assetsInlineLimit: 0,
  },
});
