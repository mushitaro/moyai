// node video/cut.mjs s3：撮った回（video/out/<場面>.mp4 と <場面>.rec/log.json）の Claude の部分を早送りにし、右上に倍率の札を出す。
// 続けて node video/cut.mjs join opening s3 で、短い動画をつないで video/out/short.mp4 にする
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
const ff = (args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
// drawtext は woff2 を読めないので、Windows の等幅の書体を使う（倍率の札は数字と × だけ）
const font = "C\\:/Windows/Fonts/consola.ttf";

/** Claude の部分（claude-start〜claude-end）を、その長さが target 秒になるよう早送りにする */
function fastForward(scene, target = 15) {
  const log = JSON.parse(readFileSync(join(outDir, `${scene}.rec`, "log.json"), "utf8"));
  const t0 = log.find((e) => e.kind === "start").t;
  const a = (log.find((e) => e.kind === "claude-start").t - t0) / 1000;
  const b = (log.find((e) => e.kind === "claude-end").t - t0) / 1000;
  const k = (b - a) / target;
  const src = join(outDir, `${scene}.mp4`);
  const end = dur(src);
  const label = `×${Math.round(k)}`;
  const fc = [
    `[0:v]trim=0:${a},setpts=PTS-STARTPTS[v0]`,
    `[0:v]trim=${a}:${b},setpts=(PTS-STARTPTS)/${k},drawtext=fontfile='${font}':text='${label}':x=w-tw-48:y=40:fontsize=40:fontcolor=0xd0644c[v1]`,
    `[0:v]trim=${b}:${end},setpts=PTS-STARTPTS[v2]`,
    `[v0][v1][v2]concat=n=3:v=1:a=0,fps=30,format=yuv420p[v]`,
  ].join(";");
  const out = join(outDir, `${scene}-cut.mp4`);
  ff(["-i", src, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-filter_complex", fc, "-map", "[v]", "-map", "1:a", "-shortest", "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-movflags", "+faststart", out]);
  console.log(`${out}　${dur(out).toFixed(1)} 秒（Claude ${(b - a).toFixed(1)} 秒を ${label}）`);
}

function join_(names) {
  const ins = names.flatMap((n) => ["-i", join(outDir, `${n}.mp4`)]);
  const fc = names.map((_, i) => `[${i}:v]fps=30,scale=1920:1080,setsar=1[v${i}];[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`).join(";")
    + ";" + names.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${names.length}:v=1:a=1[v][a]`;
  const out = join(outDir, "short.mp4");
  ff([...ins, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-movflags", "+faststart", out]);
  console.log(`${out}　${dur(out).toFixed(1)} 秒（${names.join(" + ")}）`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "join") join_(rest);
else fastForward(cmd ?? "s3");
