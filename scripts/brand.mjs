// MOYAI のしるし（結ぶ M 朱）の素材を src/app/public/brand/ に書き出す。node scripts/brand.mjs
// 形・寸法・色を変えたら、ここを直して全部を書き出し直す（手で一部だけ直さない）。PNG は入っている Edge で描く
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repo, "package.json"));
const { chromium } = require("@playwright/test");
const OUT = join(repo, "src", "app", "public", "brand");
mkdirSync(join(OUT, "png"), { recursive: true });

const C = {
  dark: { bg: "#0a0a0a", ink: "#e0e0e0", knot: "#bb4a34", sub: "#c0c0c0" },
  light: { bg: "#fbfaf6", ink: "#171512", knot: "#a63e2a", sub: "#3b3833" },
};

// 形：5 列 × 4 行。左の柱と左の斜め＝○（計画）、右＝●（実績）、谷＝◎（結び目）
// 印の外接は x 6.2–93.8、y 6.2–75.8（幅 87.6・高さ 69.6）。ここでは左上を 0 に寄せる
// 縁で印が欠けないよう、外接の周りに 1 の空きを足す
const OX = 5.2, OY = 5.2, MW = 89.6, MH = 71.6;
function markBody({ ink, knot }, small = false) {
  const pos = [14, 32, 50, 68, 86];
  const kind = (c, r) =>
    c === 2 && r === 2 ? "both" : c === 0 || (c === 1 && r === 1) ? "plan" : c === 4 || (c === 3 && r === 1) ? "done" : null;
  const f = (n) => +(n).toFixed(2);
  let s = "";
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 5; c++) {
      const x = f(pos[c] - OX), y = f(pos[r] - OY), k = kind(c, r);
      if (k === "both") {
        s += `<circle cx="${x}" cy="${y}" r="${small ? 7.2 : 7.4}" fill="none" stroke="${knot}" stroke-width="${small ? 3.6 : 3.2}"/>`;
        s += `<circle cx="${x}" cy="${y}" r="3.2" fill="${ink}"/>`;
      } else if (k === "plan") {
        s += `<circle cx="${x}" cy="${y}" r="${small ? 6 : 6.4}" fill="none" stroke="${ink}" stroke-width="${small ? 3.6 : 2.8}"/>`;
      } else if (k === "done") {
        s += `<circle cx="${x}" cy="${y}" r="7.8" fill="${ink}"/>`;
      }
    }
  return s;
}
const svg = (w, h, body, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}">${body}</svg>\n`;
const r2 = (n) => +n.toFixed(2);

const kronaB64 = readFileSync(join(repo, "node_modules/@fontsource/krona-one/files/krona-one-latin-400-normal.woff2")).toString("base64");
const fontStyle = `<style>@font-face{font-family:"Krona One";src:url(data:font/woff2;base64,${kronaB64}) format("woff2")}</style>`;

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
const plexCss = pathToFileURL(join(repo, "node_modules/@fontsource/ibm-plex-sans-jp/400.css")).href;
await page.setContent(`<html><head>${fontStyle}<link rel="stylesheet" href="${plexCss}"></head><body></body></html>`);
await page.evaluate(() => document.fonts.load('40px "Krona One"'));
// 字の実寸（大文字の高さと、字間を含む墨の幅）を 100 の大きさで測る
const m = await page.evaluate(() => {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = '100px "Krona One"';
  const t = ctx.measureText("MOYAI");
  return { cap: t.actualBoundingBoxAscent, left: t.actualBoundingBoxLeft, ink: t.actualBoundingBoxRight + t.actualBoundingBoxLeft };
});
const TRACK = 0.18;
const word = (size) => ({ cap: (m.cap * size) / 100, width: ((m.ink + 4 * TRACK * 100) * size) / 100, left: (m.left * size) / 100 });
const text = (x, y, size, fill) =>
  `<text x="${r2(x)}" y="${r2(y)}" font-family="Krona One" font-size="${r2(size)}" letter-spacing="${r2(size * TRACK)}" fill="${fill}">MOYAI</text>`;

const files = {};
const put = (name, content) => { files[name] = content; writeFileSync(join(OUT, name), content); };

// 1. しるし（地なし）
for (const t of ["dark", "light"]) put(`mark-${t}.svg`, svg(MW, MH, markBody(C[t]), "MOYAI"));
put("mark-mono-black.svg", svg(MW, MH, markBody({ ink: "#171512", knot: "#171512" }), "MOYAI"));
put("mark-mono-white.svg", svg(MW, MH, markBody({ ink: "#ffffff", knot: "#ffffff" }), "MOYAI"));

// 2. 組み（横・縦）
// 横組みの字の高さは印 3 行分（2 段目の上の縁から 4 段目の下の縁、51.6）、しるしの上下の中央。間はしるしの高さの半分
const CAP_H = 51.6 / MH, GAP_H = 0.5;
const lockH = (t) => {
  const size = (MH * CAP_H) / (m.cap / 100), w = word(size), gap = MH * GAP_H;
  const W = MW + gap + w.width;
  return svg(r2(W), MH, fontStyle + markBody(C[t]) + text(MW + gap + w.left, MH / 2 + w.cap / 2, size, C[t].ink), "MOYAI");
};
const lockV = (t) => {
  const size = (MH * 0.3) / (m.cap / 100), w = word(size), gap = MH * 0.32;
  const W = Math.max(MW, w.width), H = MH + gap + w.cap;
  return svg(r2(W), r2(H), fontStyle + `<g transform="translate(${r2((W - MW) / 2)} 0)">${markBody(C[t])}</g>` + text((W - w.width) / 2 + w.left, H, size, C[t].ink), "MOYAI");
};
for (const t of ["dark", "light"]) { put(`lockup-horizontal-${t}.svg`, lockH(t)); put(`lockup-vertical-${t}.svg`, lockV(t)); }

// 2b. 字の組み（しるしを M として OYAI の前に置く）
// しるしの印の外接（69.6）を OYAI の大文字の高さの 1.06 倍に。丸の並びが字より小さく見える分を補う
// しるしと O の間は、Krona One の「MO」の M と O の墨の間と同じ
const wm = await page.evaluate((TRACK) => {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = '100px "Krona One"';
  ctx.letterSpacing = `${TRACK * 100}px`;
  const t = ctx.measureText("OYAI"), M = ctx.measureText("M"), O = ctx.measureText("O");
  return { cap: t.actualBoundingBoxAscent, left: t.actualBoundingBoxLeft, right: t.actualBoundingBoxRight, gap: M.width - M.actualBoundingBoxRight - O.actualBoundingBoxLeft };
}, TRACK);
const wordmark = (t) => {
  const IH = 69.6, IW = 87.6, over = 1.06, size = IH / (wm.cap / 100), k = size / 100;
  const mw = IW * over, mh = IH * over, top = (mh - IH) / 2, tx = mw + wm.gap * k + wm.left * k;
  const W = tx + wm.right * k, P = 1;
  return svg(r2(W + 2 * P), r2(mh + 2 * P), fontStyle +
    `<g transform="translate(${P} ${P})"><g transform="scale(${over}) translate(-1 -1)">${markBody(C[t])}</g>` +
    `<text x="${r2(tx)}" y="${r2(top + IH)}" font-family="Krona One" font-size="${r2(size)}" letter-spacing="${r2(size * TRACK)}" fill="${C[t].ink}">OYAI</text></g>`, "MOYAI");
};
for (const t of ["dark", "light"]) put(`wordmark-${t}.svg`, wordmark(t));

// 3. アイコン（墨の地。any は角まで地、maskable は安全円の中に収める）
const tile = (size, scale, small, t = "dark") => {
  const s = (size * scale) / 100 / MW, tx = (size - MW * s) / 2, ty = (size - MH * s) / 2;
  return svg(size, size, `<rect width="${size}" height="${size}" fill="${C[t].bg}"/><g transform="translate(${r2(tx)} ${r2(ty)}) scale(${r2(s)})">${markBody(C[t], small)}</g>`, "MOYAI");
};
put("app-icon.svg", tile(512, 72, false));
put("app-icon-maskable.svg", tile(512, 62, false));
put("app-icon-light.svg", tile(512, 72, false, "light"));

// 4. ファビコン（地なし。暗・明は読み手の設定に合わせる）
const favBody = markBody({ ink: "var(--ink)", knot: "var(--knot)" }, true);
put("favicon.svg", svg(MW, MW, `<style>svg{--ink:${C.light.ink};--knot:${C.light.knot}}@media (prefers-color-scheme:dark){svg{--ink:${C.dark.ink};--knot:${C.dark.knot}}}</style><g transform="translate(0 ${r2((MW - MH) / 2)})">${favBody}</g>`, "MOYAI"));
const favTile = (size) => svg(size, size, `<rect width="${size}" height="${size}" fill="${C.dark.bg}"/><g transform="translate(${r2(size * 0.04)} ${r2((size - MH * (size * 0.92) / MW) / 2)}) scale(${r2((size * 0.92) / MW)})">${markBody(C.dark, true)}</g>`, "MOYAI");

// 5. OGP（1200×630、左揃え）と SNS のアバター
const og = (t) => {
  const markScale = 1.9, mh = MH * markScale, size = (mh * CAP_H) / (m.cap / 100), w = word(size), gap = mh * GAP_H;
  const x0 = 96, y0 = 630 / 2 - mh / 2 - 40;
  return `<!doctype html><html><head>${fontStyle}<link rel="stylesheet" href="${plexCss}"></head><body style="margin:0">
<div style="width:1200px;height:630px;background:${C[t].bg};position:relative;overflow:hidden">
<svg viewBox="0 0 ${r2(MW * markScale + gap + w.width)} ${r2(mh)}" width="${r2(MW * markScale + gap + w.width)}" height="${r2(mh)}" style="position:absolute;left:${x0}px;top:${r2(y0)}px"><g transform="scale(${markScale})">${markBody(C[t])}</g>${text(MW * markScale + gap + w.left, mh / 2 + w.cap / 2, size, C[t].ink)}</svg>
<div style="position:absolute;left:${x0}px;top:${r2(y0 + mh + 48)}px;font:400 32px/48px 'IBM Plex Sans JP';letter-spacing:0.06em;color:${C[t].sub}">保全の記録を一つの計画にまとめ、似た施設と同じ行で比べる</div>
</div></body></html>`;
};

// PNG を書く
async function shot(html, w, h, name, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><head>${fontStyle}<link rel="stylesheet" href="${plexCss}"><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ path: join(OUT, "png", name), omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}
const sized = (s, w, h) => s.replace(/width="[^"]+" height="[^"]+"/, `width="${w}" height="${h}"`);

for (const n of [192, 512]) {
  await shot(sized(files["app-icon.svg"], n, n), n, n, `icon-${n}.png`);
  await shot(sized(files["app-icon-maskable.svg"], n, n), n, n, `icon-maskable-${n}.png`);
}
await shot(sized(files["app-icon.svg"], 180, 180), 180, 180, "apple-touch-icon.png");
const ico = [];
for (const n of [16, 32, 48]) ico.push([n, await shot(favTile(n), n, n, `favicon-${n}.png`)]);
for (const t of ["dark", "light"]) {
  await shot(sized(files[`mark-${t}.svg`], 1024, Math.round((1024 * MH) / MW)), 1024, Math.round((1024 * MH) / MW), `mark-${t}-1024.png`, true);
  const [lw, lh] = files[`lockup-horizontal-${t}.svg`].match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  const H = 240, W = Math.round((lw * H) / lh);
  await shot(sized(files[`lockup-horizontal-${t}.svg`], W, H), W, H, `lockup-horizontal-${t}.png`, true);
  const [ww, wh] = files[`wordmark-${t}.svg`].match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  const WW = Math.round((ww * H) / wh);
  await shot(sized(files[`wordmark-${t}.svg`], WW, H), WW, H, `wordmark-${t}.png`, true);
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(og(t));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, "png", `og-${t}.png`) });
}
await shot(sized(tile(400, 64, false), 400, 400), 400, 400, "avatar-400.png");
await browser.close();

// favicon.ico（PNG を 3 つ入れる）
const head = Buffer.alloc(6 + 16 * ico.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(ico.length, 4);
let off = head.length;
ico.forEach(([n, buf], i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(n, e); head.writeUInt8(n, e + 1); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(off, e + 12); off += buf.length;
});
writeFileSync(join(OUT, "favicon.ico"), Buffer.concat([head, ...ico.map(([, b]) => b)]));

// 6. manifest の型
writeFileSync(join(OUT, "site.webmanifest"), JSON.stringify({
  name: "MOYAI", short_name: "MOYAI", background_color: C.dark.bg, theme_color: C.dark.bg, display: "standalone",
  icons: [
    { src: "/brand/png/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/brand/png/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/brand/png/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/brand/png/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}, null, 2) + "\n");
console.log("ok", Object.keys(files).length, "svg");
