// 公開の台帳の静的なページ（GitHub Pages）を描く。純粋な関数：確かめ直した台帳（verifyLedgerFiles の結果）と、
// パックの名前の表から、1 枚の HTML の文字列を作る。生のファイルは写さず、確かめて ✓ になった束から集計した値だけを描く。
// - 文字はすべてエスケープする（束・道・名前・理由のどれも）。スクリプトは置かない。
// - CSP：default-src 'none'。スタイルは中の <style> 1 つだけを、その SHA-256 で許す。画像・書体・接続・フォームは無し。外への要求は無い。
// - 書体は端末に入っている BIZ UDPゴシック から（書体のファイルを読まない）。数と年度の列は tabular-nums。
import { createHash } from "node:crypto";
import { SITE_TEXT as T } from "../app/text/site";
import { reasonText } from "../app/text/reasons";
import { BANDS_VERSION, BAND_DEFS, STAT_FIELDS, bandCodes, type StatField } from "./bands";
import { aggregate, latestPerKey, sectionsOf, type Aggregate, type StatCell } from "./aggregate";
import type { Profile } from "./k";
import type { LedgerRead } from "./ledger";
import type { SharePack } from "./pack";
import { bandShort, statText } from "./stat-text";

export { bandShort };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));
}
const h = escapeHtml;

export const SITE_CSS = `
:root{--bg:#f7f7f4;--surface:#fff;--fg:#1d2421;--muted:#5b6661;--border:#d9ddd8;--accent:#1f6f5c;--ok:#1f7a3f;--ng:#b3261e;--fiction-bg:#fff1c2;--fiction-fg:#5c3d00;--head-bg:#eef1ed;--stat-bg:#f3f6f2}
@media (prefers-color-scheme:dark){:root{--bg:#151a18;--surface:#1d2422;--fg:#e6ebe8;--muted:#a3aea9;--border:#33403b;--accent:#6fc7ad;--ok:#7fd49a;--ng:#ff8a80;--fiction-bg:#4a3a10;--fiction-fg:#ffe7a3;--head-bg:#222b28;--stat-bg:#1a2220}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:"BIZ UDPGothic","BIZ UDPゴシック","Hiragino Sans","Hiragino Kaku Gothic ProN","Meiryo",sans-serif;font-size:15px;line-height:1.7}
main{max-width:1320px;margin:0 auto;padding:16px}
h1{font-size:1.5rem;margin:.5rem 0}
h2{font-size:1.2rem;margin:2rem 0 .5rem;border-bottom:1px solid var(--border);padding-bottom:.25rem}
h3{font-size:1.05rem;margin:1.5rem 0 .25rem}
p,li{max-width:60em}
.fiction{background:var(--fiction-bg);color:var(--fiction-fg);padding:.5rem .75rem;border-radius:4px;font-weight:700}
.muted{color:var(--muted)}
.num,.fy,td.band,code{font-variant-numeric:tabular-nums}
code{font-family:inherit;background:var(--head-bg);padding:0 .25em;border-radius:3px;overflow-wrap:anywhere}
dl.rules{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem;margin:0}
dl.rules dt{color:var(--muted)}
dl.rules dd{margin:0;overflow-wrap:anywhere}
.ok{color:var(--ok);font-weight:700}
.ng{color:var(--ng);font-weight:700}
.scroll{overflow-x:auto;border:1px solid var(--border);background:var(--surface)}
table{border-collapse:collapse;width:max-content;min-width:100%}
th,td{border:1px solid var(--border);padding:.2rem .45rem;text-align:left;vertical-align:top}
thead th{background:var(--head-bg);position:sticky;top:0}
td.fy,th.fy{text-align:center;min-width:3.2em}
td.band{white-space:nowrap}
tr.stat td,tr.stat th{background:var(--stat-bg)}
tr.stat td.band{white-space:normal;min-width:10em;max-width:15em;font-size:.9rem}
tr.first th,tr.first td{border-top:2px solid var(--muted)}
footer{margin:3rem 0 1rem;color:var(--muted);font-size:.85rem}
`;

/** CSP の値（中の <style> だけを、その SHA-256 で許す） */
export function siteCsp(css: string = SITE_CSS): string {
  const hash = createHash("sha256").update(css, "utf8").digest("base64");
  return [
    "default-src 'none'",
    `style-src 'sha256-${hash}'`,
    "img-src 'none'",
    "font-src 'none'",
    "script-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** 見え方の軸の値を日本語にする（全国の表の名前。粗くした帯は範囲から言う） */
export function axisValueText(pack: Pick<SharePack, "axes">, key: string, code: string): string {
  const a = pack.axes.find((x) => x.key === key);
  if (!a) return code;
  const named = a.codes.find((c) => c.code === code);
  if (named) return named.name;
  const unit = a.unit ?? "";
  const lt = /^[A-Z]+LT(\d+)$/.exec(code);
  if (lt) return T.axisBelow(lt[1]!, unit);
  const rg = /^[A-Z]+(\d+)_(\d+)$/.exec(code);
  if (rg) return T.axisRange(rg[1]!, rg[2]!, unit);
  const p = /^[A-Z]+(\d+)P$/.exec(code);
  if (p) return T.axisAtLeast(p[1]!, unit);
  return code;
}

/** 見え方を日本語にする（軸は全国の表の軸の順） */
export function profileText(pack: Pick<SharePack, "axes">, p: Profile): string {
  const keys = Object.keys(p.axes);
  const order = (k: string) => {
    const i = pack.axes.findIndex((a) => a.key === k);
    return i < 0 ? pack.axes.length : i;
  };
  const axes = keys
    .sort((a, b) => order(a) - order(b) || (a < b ? -1 : 1))
    .map((k) => `${pack.axes.find((a) => a.key === k)?.name ?? k} ${axisValueText(pack, k, p.axes[k]!)}`);
  return [T.group[p.group] ?? p.group, T.stage(p.stage), ...axes].join("・");
}

export interface SiteInput {
  read: LedgerRead;
  pack: Pick<SharePack, "table" | "classNames" | "axes">;
  /** 作業の属性の名前（packs/_kinds/work.json） */
  workNames: Record<string, string>;
  /** ビルドの印 */
  build: string;
}

export interface SiteModel {
  sections: { profile: Profile; aggregate: Aggregate }[];
  ok: number;
  ng: number;
  keys: number;
}

/** 集計：✓ の束（鍵ごとに最新）から、見え方ごとの節を作る（サイトに自分は無いので self は null） */
export function siteModel(i: Pick<SiteInput, "read" | "pack">): SiteModel {
  const okLines = i.read.bundles.filter((b) => b.status === "ok");
  const peers = latestPerKey(okLines);
  const bands = i.read.ledger.rules?.bands;
  // 似た施設の多い節から並べる（同じ数なら見え方の順）
  const sections = sectionsOf(peers)
    .map((profile) => ({
      profile,
      aggregate: aggregate({ table: i.pack.table, profile, self: null, peers, ...(bands ? { bands } : {}) }),
    }))
    .map((s, k) => ({ s, k }))
    .sort((a, b) => b.s.aggregate.similar.length - a.s.aggregate.similar.length || a.k - b.k)
    .map(({ s }) => s);
  return { sections, ok: okLines.length, ng: i.read.bundles.length - okLines.length, keys: peers.length };
}

function rulesBlock(i: SiteInput): string {
  const l = i.read.ledger;
  const r = l.rules;
  const rows: [string, string][] = [
    [T.ledgerId, l.id ?? "—"],
    [T.version, l.version !== null ? String(l.version) : "—"],
    [T.month, l.month ?? "—"],
    [T.hash, l.hash ?? "—"],
    [T.founder, l.founder ?? "—"],
  ];
  const parts = rows.map(([k, v]) => `<dt>${h(k)}</dt><dd><code>${h(v)}</code></dd>`);
  parts.push(`<dt>${h(T.status)}</dt><dd>${l.status === "ok" ? `<span class="ok">${h(T.ok)}</span>` : `<span class="ng">${h(T.ng)}</span> ${h([...new Set(l.reasons.map(reasonText))].join("、"))}`}</dd>`);
  if (r) {
    parts.push(`<dt>${h(T.minK)}</dt><dd class="num">${h(String(r.minK))}</dd>`);
    parts.push(`<dt>${h(T.fields)}</dt><dd>${h(r.fields.join("・"))}</dd>`);
    const bandRows = STAT_FIELDS.map((f: StatField) => `${f}：${bandCodes(BAND_DEFS[f], r.bands[f]).map(bandShort).join("・")}`);
    parts.push(`<dt>${h(T.bands)}</dt><dd>${bandRows.map((x) => h(x)).join("<br>")}<br><span class="muted">${h(BANDS_VERSION)}</span></dd>`);
    parts.push(`<dt>${h(T.pack)}</dt><dd><code>${h(r.pack)}</code></dd>`);
    parts.push(`<dt>${h(T.vocab)}</dt><dd><code>${h(r.vocab)}</code></dd>`);
    parts.push(`<dt>${h(T.national)}</dt><dd><code>${h(r.national)}</code></dd>`);
  }
  parts.push(`<dt>${h(T.withheld)}</dt><dd>${h(T.withheldText)}</dd>`);
  return `<dl class="rules">${parts.join("")}</dl>`;
}

function countsBlock(i: SiteInput, m: SiteModel): string {
  const out = [`<p><span class="ok">${h(T.okCount(m.ok))}</span>　<span class="${m.ng ? "ng" : "muted"}">${h(T.ngCount(m.ng))}</span>　${h(T.keys(m.keys))}　${h(T.others(i.read.others.length))}</p>`];
  const ngs = [...i.read.bundles.filter((b) => b.status !== "ok").map((b) => ({ path: b.path, reasons: b.reasons })), ...i.read.others];
  if (ngs.length) {
    out.push(`<h3>${h(T.ngHead)}</h3><ul>`);
    for (const b of ngs) out.push(`<li><code>${h(b.path)}</code>：${h([...new Set(b.reasons.map(reasonText))].join("、"))}</li>`);
    out.push("</ul>");
  }
  return out.join("");
}

function sectionBlock(i: SiteInput, s: SiteModel["sections"][number], n: number): string {
  const g = s.aggregate;
  const out = [`<section><h3>${h(T.profileHead(n))}：${h(profileText(i.pack, s.profile))}</h3>`];
  out.push(`<p>${h(T.similar(g.similar.length))}${g.belowFive ? `　<span class="ng">${h(T.belowFive)}</span>` : ""}</p>`);
  const years = g.years;
  const head = [T.colClass, T.colWork, T.colLabel].map((x) => `<th scope="col">${h(x)}</th>`).join("") +
    years.map((y) => `<th scope="col" class="fy">${h(y.replace(/^FY/, ""))}</th>`).join("") +
    [T.colInterval, T.colManDays, T.colDays].map((x) => `<th scope="col">${h(x)}</th>`).join("");
  const body: string[] = [];
  for (const r of g.rows) {
    const cls = i.pack.classNames[r.class] ?? r.class;
    const work = i.workNames[r.work] ?? r.work;
    r.peers.forEach((p, k) => {
      const ys = new Set(p.years);
      body.push(
        `<tr${k === 0 ? ' class="first"' : ""}><th scope="row">${h(cls)}</th><td>${h(work)}</td><td>${h(p.label)}</td>` +
          years.map((y) => `<td class="fy">${ys.has(y) ? h(T.done) : ""}</td>`).join("") +
          STAT_FIELDS.map((f) => `<td class="band">${p[f] ? h(bandShort(p[f]!)) : ""}</td>`).join("") +
          "</tr>",
      );
    });
    body.push(
      `<tr class="stat"><th scope="row">${h(cls)}</th><td>${h(work)}</td><td>${h(T.statRow(r.peers.length))}</td>` +
        `<td colspan="${Math.max(1, years.length)}"></td>` +
        STAT_FIELDS.map((f) => `<td class="band">${h(statText(r.stats[f]))}</td>`).join("") +
        "</tr>",
    );
  }
  out.push(`<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body.join("")}</tbody></table></div></section>`);
  return out.join("");
}

/** ページ全体（1 枚の HTML） */
export function renderLedgerSite(i: SiteInput): string {
  const m = siteModel(i);
  const sections = m.sections.length ? m.sections.map((s, k) => sectionBlock(i, s, k + 1)).join("") : `<p>${h(T.noBundles)}</p>`;
  return [
    "<!doctype html>",
    '<html lang="ja"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${h(siteCsp())}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${h(T.title)}</title>`,
    `<style>${SITE_CSS}</style>`,
    "</head><body><main>",
    `<p class="fiction">${h(T.fiction)}</p>`,
    `<h1>${h(T.title)}</h1>`,
    `<p>${h(T.lead)}</p>`,
    `<h2>${h(T.rulesHead)}</h2>`,
    rulesBlock(i),
    `<h2>${h(T.countsHead)}</h2>`,
    countsBlock(i, m),
    `<h2>${h(T.sectionsHead)}</h2>`,
    `<p class="muted">${h(T.statNote)}</p>`,
    `<p class="muted">${h(T.labelNote)}</p>`,
    sections,
    `<footer>${h(T.footer(i.build))}</footer>`,
    "</main></body></html>",
    "",
  ].join("\n");
}
