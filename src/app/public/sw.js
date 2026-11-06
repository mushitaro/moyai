// MOYAI の Service Worker（手書き。pwa-v0）。画面の殻（index.html・JS・CSS・書体）だけを覚える。
// 殻でない道（/human/・/relay/・/ws・/selftest/・/api・開発の見本の JSON・GET でない呼び出し・ほかの出どころ）は、覚えず、横取りもしない（respondWith を呼ばない）。
// 覚えの名前にビルドの印を入れ、版が変わったら古い覚えを捨てる。印はビルドのときに vite.config.ts が埋める（scripts/build-stamp.mjs の stampServiceWorker）。
// 開いているページを奪わない（clients.claim を呼ばない）。次に開いたページから効く。
"use strict";

const BUILD = "__MOYAI_BUILD__";
const CACHE_PREFIX = "moyai-shell-";
const CACHE = CACHE_PREFIX + BUILD;
/** 画面の入口を覚える鍵（?plan= や #/merge?open= の付いた道も、同じ index.html） */
const PAGE_KEY = "/";

/**
 * 道の判定。page：画面の入口（網を先に見て、つながらなければ覚えを返す）／asset：ビルドしたファイル（名前にハッシュがあるので、覚えを先に見る）／null：覚えない・横取りしない。
 * request は { url, method, mode }、origin はこの Service Worker の出どころ。
 */
function shellKind(request, origin) {
  if (request.method !== "GET") return null;
  let u;
  try {
    u = new URL(request.url);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  if (u.pathname === "/") return request.mode === "navigate" ? "page" : null;
  if (!u.pathname.startsWith("/assets/") || u.search !== "") return null;
  // 開発の見本（/assets/dev-plans/*.json）は殻ではない
  if (u.pathname.startsWith("/assets/dev-plans/")) return null;
  return /\.(?:js|mjs|css|woff2|woff)$/.test(u.pathname) ? "asset" : null;
}

/** 捨てる覚え：MOYAI の殻の覚えのうち、今の版でないもの */
function staleCaches(keys, current) {
  return keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== current);
}

/** index.html が読み込むビルドしたファイルの道（入れたときに一緒に覚える） */
function entryAssets(html) {
  const out = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) out.add(m[1]);
  return [...out];
}

async function putQuietly(cache, key, res) {
  try {
    await cache.put(key, res);
  } catch {
    // 覚えられなくても（容量など）画面は網から動く
  }
}

async function page(request) {
  const cache = await caches.open(CACHE);
  try {
    // 網へは、同じ道をこの出どころの素の GET で取りに行く（人がリンクで開いたときの見出しを、そのまま写さない）
    const res = await fetch(request.url, { cache: "no-store", credentials: "same-origin", redirect: "error" });
    if (res.ok) await putQuietly(cache, PAGE_KEY, res.clone());
    return res;
  } catch {
    const hit = await cache.match(PAGE_KEY);
    return hit ?? Response.error();
  }
}

async function asset(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") await putQuietly(cache, request, res.clone());
  return res;
}

async function install() {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(PAGE_KEY, { cache: "no-store", credentials: "same-origin", redirect: "error" });
    if (res.ok) {
      const html = await res.clone().text();
      await putQuietly(cache, PAGE_KEY, res);
      for (const path of entryAssets(html)) {
        const a = await fetch(path, { credentials: "same-origin" });
        if (a.ok) await putQuietly(cache, path, a);
      }
    }
  } catch {
    // 橋渡しが止まっていれば、覚えずに入れる（次に開いたときに覚える）
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(install().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(staleCaches(keys, CACHE).map((k) => caches.delete(k)))));
});

self.addEventListener("fetch", (event) => {
  const kind = shellKind(event.request, self.location.origin);
  if (kind === "page") event.respondWith(page(event.request));
  else if (kind === "asset") event.respondWith(asset(event.request));
});
