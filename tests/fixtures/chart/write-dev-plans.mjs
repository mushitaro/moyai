#!/usr/bin/env node
// 試しの計画（架空）を、ビルドした画面の横（dist/app/assets/dev-plans/）に書く。画面は ?plan=<名前>#/chart で読む。
// npm run build のあとに走らせる（ビルドは dist/app を空にするので、そのたびに書き直す）。src/ には何も足さない。
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DEV_PLANS, DEV_PLAN_DIR } from "./truth-to-plan.mjs";

if (!existsSync(join("dist", "app", "index.html"))) {
  console.error("write-dev-plans: dist/app が無い。先に npm run build を走らせる");
  process.exit(1);
}
mkdirSync(DEV_PLAN_DIR, { recursive: true });
for (const [name, make] of Object.entries(DEV_PLANS)) {
  const plan = make();
  writeFileSync(join(DEV_PLAN_DIR, `${name}.json`), JSON.stringify(plan));
  console.error(`write-dev-plans: ${name}（機器と段の節 ${plan.assets.length}、記録 ${plan.details.length}）`);
}
