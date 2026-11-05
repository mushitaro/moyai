// node video/build.mjs [場面の組 ...]：札（video/cards/*.html）を今のビルドの印で描き、ffmpeg でつないで video/out/<組>.mp4 を出す。
// 最後にまとめて作らず、開発と並行して短い動画を作り直し続けるための道具（video/SCRIPT.md）。
// 数字は描くときにリポジトリから数える（ここでは全国の稼働の施設の数を packs の表から読む）。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { buildStamp } from "../scripts/build-stamp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = join(here, "out");

/** 1 枚 = 札と段と秒。shot は画面の 1 枚（リポジトリの中の道）に印を重ねる */
const SCENES = {
  s0: [
    { card: "s0", step: 1, sec: 2.5 },
    { card: "s0", step: 2, sec: 4.5 },
    { card: "s0", step: 3, sec: 5 },
  ],
  s1: [
    { card: "s1", step: 1, sec: 2 },
    { card: "s1", step: 2, sec: 2 },
    { card: "s1", step: 3, sec: 2.5 },
    { card: "s1", step: 4, sec: 2.5 },
    { card: "s1", step: 5, sec: 2.5 },
    { card: "s1", step: 6, sec: 2 },
    { shot: "docs/progress/shots/2026-11-04/demo-full/demo-17-checkpoint.png", sec: 1.5 },
  ],
  s2: [
    { card: "s2", step: 1, sec: 4 },
    { card: "s2", step: 2, sec: 6 },
  ],
};
const GROUPS = { opening: ["s0", "s1", "s2"] };

function nationalActive() {
  const t = JSON.parse(readFileSync(join(root, "packs/waste-incineration/national/table.json"), "utf8"));
  return `全国で稼働しているごみ焼却施設　${t.population.active}（${t.source.publisher}「${t.source.name}」）`;
}

async function render(frames, dir, stamp) {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const pop = nationalActive();
  const files = [];
  for (const [i, f] of frames.entries()) {
    const url = f.shot
      ? `${pathToFileURL(join(here, "cards/shot.html")).href}?src=${encodeURIComponent(pathToFileURL(join(root, f.shot)).href)}`
      : pathToFileURL(join(here, `cards/${f.card}.html`)).href;
    await page.goto(url);
    await page.evaluate(
      ({ step, stamp, pop }) => {
        for (const el of document.querySelectorAll("[data-s]")) {
          const until = el.dataset.until ? Number(el.dataset.until) : Infinity;
          el.classList.toggle("on", Number(el.dataset.s) <= step && step <= until);
        }
        const cap = window.CAPS?.[step];
        if (cap) {
          document.getElementById("ja").textContent = cap[0];
          document.getElementById("en").textContent = cap[1];
        }
        for (const el of document.querySelectorAll(".stamp")) el.textContent = stamp;
        const p = document.getElementById("pop");
        if (p) p.textContent = pop;
      },
      { step: f.step ?? 0, stamp, pop },
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((im) => im.complete));
    const file = join(dir, `${String(i).padStart(3, "0")}.png`);
    await page.screenshot({ path: file });
    files.push({ file, sec: f.sec });
  }
  await browser.close();
  return files;
}

function assemble(files, dir, mp4) {
  const list = files.map((f) => `file '${f.file.split("\\").join("/")}'\nduration ${f.sec}\n`).join("");
  // concat の決まり：最後の 1 枚をもう一度書かないと、その秒が落ちる
  writeFileSync(join(dir, "list.txt"), `${list}file '${files.at(-1).file.split("\\").join("/")}'\n`);
  const total = files.reduce((s, f) => s + f.sec, 0);
  execFileSync(
    "ffmpeg",
    ["-y", "-hide_banner", "-loglevel", "error",
      "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"),
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "18",
      "-c:a", "aac", "-b:a", "128k", "-t", String(total), "-movflags", "+faststart", mp4],
    { stdio: "inherit" },
  );
  return total;
}

const names = process.argv.slice(2);
if (names.length === 0) names.push("opening");
const s = buildStamp();
const stamp = `MOYAI · build ${s.time} JST · ${s.commit}`;
mkdirSync(out, { recursive: true });
for (const name of names) {
  const scenes = GROUPS[name] ?? [name];
  const frames = scenes.flatMap((n) => {
    if (!SCENES[n]) throw new Error(`場面が無い：${n}（あるのは ${Object.keys(SCENES).join("・")}、組は ${Object.keys(GROUPS).join("・")}）`);
    return SCENES[n];
  });
  const dir = join(out, `${name}.frames`);
  // フォルダごと消さず中身だけ消す（開いている端末やエクスプローラがフォルダを掴んでいても動くように）
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { recursive: true, force: true });
  const files = await render(frames, dir, stamp);
  const mp4 = join(out, `${name}.mp4`);
  const total = assemble(files, dir, mp4);
  console.log(`${mp4}　${total} 秒　${stamp}`);
}
