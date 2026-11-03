#!/usr/bin/env node
// 公開の台帳のデモの束を作る（docs/sharing.md §6）。架空の 10 施設の正解の世界から、本物の写し取りと署名で束を作り、
// 出す台帳のフォルダ（ledger/ledger.json と ledger/bundles/）に書く。わざと外れた束 3 つ（k < 5・費用の欄・施設名）も別に書く。
// 鍵は走らせるたびに作り、秘密鍵は一時の状態のフォルダにだけ書く（場所を最後に出す）。GitHub には何も送らない（PR は人が出す）。
//
//   node scripts/ledger/build-bundles.mjs --out <出す台帳のリポジトリの根> [--rejects <外れた束のフォルダ>] [--month 2026-11]
//                                         [--state <状態のフォルダ>] [--ledger-json <前に作った ledger.json>]
//
// 芯（demo-core.ts）は TypeScript なので、Vite の SSR のビルドで状態のフォルダの下に 1 つの JS にしてから読む。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

const say = (m) => process.stderr.write(`${m}\n`);
const USAGE =
  "使い方：node scripts/ledger/build-bundles.mjs --out <出す台帳のリポジトリの根> [--rejects <外れた束のフォルダ>] [--month YYYY-MM] [--state <状態のフォルダ>] [--ledger-json <ledger.json>]";

function parse(argv) {
  const a = { out: null, rejects: null, month: "2026-11", state: null, ledgerJson: null };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (v === undefined) return null;
    if (k === "--out") a.out = resolve(v);
    else if (k === "--rejects") a.rejects = resolve(v);
    else if (k === "--month") a.month = v;
    else if (k === "--state") a.state = resolve(v);
    else if (k === "--ledger-json") a.ledgerJson = resolve(v);
    else return null;
  }
  return a.out ? a : null;
}

const REASON_TEXT_NOTE = "理由のコードの日本語は src/app/text/reasons.ts（verify ledger と PR のコメントと同じ）";

const PR_TEXT = {
  facilities: (n, ledgerId) =>
    [
      `【架空】公開の台帳のデモ：架空の ${n} 施設の束`,
      "",
      `この PR は、MOYAI を作る側のセッションが、架空の ${n} 施設の束を台帳（ID \`${ledgerId}\`）に足すために出したものです。`,
      "施設はどれも架空で、サンプルの工場の正解の世界から直接書いた計画を、MOYAI の本物の写し取りと署名のコードに通して作りました（取り込みは通していません）。",
      "鍵は道具が走らせるたびに作り、秘密鍵はリポジトリに入れていません。束の中身は、塊の年度と、間隔・工数・日数の帯だけです。",
      "",
      "期待する結果：Actions の ledger-validate がすべて ✓。",
      "",
    ].join("\n"),
  reject: (title, why, reasons) =>
    [
      `【架空】わざと外れた束：${title}`,
      "",
      "この PR は、MOYAI を作る側のセッションが、台帳の検証が理由つきで ✗ にすることを示すために、架空の束で出したものです。マージしません。",
      `束は本物の署名の関数で署名してあり、道と鎖は正しく、外れは中身だけです（${why}）。`,
      "",
      `期待する結果：Actions の ledger-validate が ✗。理由のコード：${reasons.map((r) => `\`${r}\``).join("・")}（${REASON_TEXT_NOTE}）。`,
      "",
    ].join("\n"),
  cases: {
    kBelow5: ["k < 5", "見え方を、全国の表で 3 施設しかない組に書き換えた。送る側の k も数え直しと同じ値にしてある"],
    costField: ["費用の欄", "塊に費用の欄（cost）を足した。費用はどの束にも出さない（帯にもしない）"],
    facilityName: ["施設名", "body に架空の施設の名前の欄を足した"],
  },
};

async function main() {
  const a = parse(process.argv.slice(2));
  if (!a) {
    say(USAGE);
    return 2;
  }
  if (existsSync(join(a.out, "ledger"))) {
    say(`出す先にもう ledger/ があります：${a.out}（足すだけの台帳を上書きしません）`);
    return 2;
  }
  if (a.rejects && existsSync(a.rejects) && readdirSync(a.rejects).length > 0) {
    say(`外れた束のフォルダが空ではありません：${a.rejects}`);
    return 2;
  }
  const state = a.state ?? mkdtempSync(join(tmpdir(), "moyai-ledger-demo-"));
  mkdirSync(state, { recursive: true });
  const outDir = join(state, "build");
  const { build } = await import("vite");
  await build({
    configFile: false,
    logLevel: "warn",
    root: REPO,
    ssr: { noExternal: true },
    build: {
      ssr: join(HERE, "demo-core.ts"),
      outDir,
      emptyOutDir: true,
      target: "node22",
      minify: false,
      rolldownOptions: { output: { entryFileNames: "demo-core.js" } },
    },
  });
  const core = await import(pathToFileURL(join(outDir, "demo-core.js")).href);
  const r = core.buildLedgerDemo({
    repo: REPO,
    out: a.out,
    state,
    month: a.month,
    ...(a.rejects ? { rejects: a.rejects } : {}),
    ...(a.ledgerJson ? { ledgerJson: a.ledgerJson } : {}),
  });
  writeFileSync(join(state, "PR-facilities.md"), PR_TEXT.facilities(r.facilities.length, r.ledgerId), "utf8");
  for (const x of r.rejects) {
    const [title, why] = PR_TEXT.cases[x.case];
    writeFileSync(join(a.rejects, x.case, "PR.md"), PR_TEXT.reject(title, why, x.reasons), "utf8");
  }
  const ok = r.read.bundles.filter((b) => b.status === "ok").length;
  say(`台帳 ${r.ledgerId}（ledger.json の SHA-256 ${r.ledgerHash.slice(0, 16)}…）`);
  say(`束 ${r.facilities.length} 件を書きました：${a.out}`);
  say(`受け手と同じ関数で確かめました：✓ ${ok} 件・✗ ${r.read.bundles.length - ok} 件・決まり ${r.read.ledger.status === "ok" ? "✓" : "✗"}`);
  for (const x of r.rejects) say(`外れた束 ${x.case}：${a.rejects}/${x.case}/${x.path}（理由 ${x.reasons.join("・")}）`);
  say(`状態のフォルダ（秘密鍵と、施設と鍵の対応。リポジトリに入れない）：${state}`);
  return r.read.ok && r.rejects.every((x) => x.reasons.length > 0) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    say(`build-bundles：止まりました（${e instanceof Error ? e.message : "誤り"}）`);
    process.exit(1);
  },
);
