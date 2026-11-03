// CLI のビルド（src/cli/main.ts → dist/cli.js）。Vite の SSR のビルドで、依存は node_modules から読む。
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { buildStamp } from "./scripts/build-stamp.mjs";

const stamp = buildStamp();

export default defineConfig({
  define: {
    __MOYAI_BUILD__: JSON.stringify(stamp),
  },
  build: {
    ssr: fileURLToPath(new URL("./src/cli/main.ts", import.meta.url)),
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: false,
    target: "node22",
    minify: false,
    rolldownOptions: {
      output: {
        entryFileNames: "cli.js",
        banner: "#!/usr/bin/env node",
      },
    },
  },
});
