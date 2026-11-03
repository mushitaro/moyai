// 人だけの CLI と、輪を確かめる CLI。
// - `moyai verify ring <フォルダ>`：受け手と同じ関数（readRing）で、決まり・仲間・束ごとに ✓ か理由つきの ✗ を出す。
// - `moyai keys create --root <輪のフォルダ> --pack <パック>`：輪を作り、その輪の鍵の対を合言葉で包む。
// - `moyai send`：束を送る（検問所の画面から送る。端末から送るのは未実装）。
// 人だけの CLI（keys create・send）は、標準入力が端末でなければ断る（AI のシェルや別のプログラムから呼ばせない）。
// 人への知らせは標準エラーへ出す（標準出力は MCP だけに使う）。合言葉は画面に出さない。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { readRings, readWrappedKey } from "../bridge/places";
import { resolveStateDir } from "../bridge/state";
import { reasonText } from "../app/text/reasons";
import { createRing, PASSPHRASE_MIN, verifyRing, type VerifyReport } from "../share/checkpoint";
import { parseJsonStrict } from "../share/jcs";
import { loadSharePack, resolvePacksDir } from "../share/pack";
import { CIRCLE_FILE } from "../share/ring";
import { HEX16, keyIdOf } from "../share/sign";

export const CLI_TEXT = {
  notTerminal: "この操作は人だけがします。端末から直接走らせてください（標準入力が端末ではないので断りました）。",
  verifyUsage: "使い方：moyai verify ring <輪のフォルダ>（<輪のフォルダ>/<輪ID>/ か、その上のフォルダ）",
  noRing: (p: string) => `輪が見つかりません：${p}（circle.json のあるフォルダか、その上のフォルダを指してください）`,
  circleUnreadable: "決まり（circle.json）を読めません",
  packNotReady: (pack: string, reason: string) => `パック ${pack} の共有の部品を読めません（${reason}）`,
  vocabMismatch: "公開語彙の版が、輪の決まりと違います",
  nationalMismatch: "全国の表の版が、輪の決まりと違います",
  ringHead: (id: string) => `輪 ${id}`,
  circle: "決まり（circle.json）",
  member: (key: string, fp: string | undefined) => `仲間 ${key}${fp ? `（指紋 ${fp}）` : ""}`,
  bundle: (name: string) => `束 ${name}`,
  arriving: "届きかけ",
  missing: "ありません",
  notBundleFiles: (n: number) => `束の形をしていないファイル ${n} 件`,
  summaryOk: "すべて ✓ です。",
  summaryNg: (n: number) => `✗ が ${n} 件あります。`,
  keysUsage: "使い方：moyai keys create --root <輪のフォルダ（絶対の道）> --pack <パック ID>",
  passphrase: "合言葉（8 文字以上。打った文字は画面に出ません。打ち終えたら Enter）：",
  passphraseAgain: "もう一度：",
  passphraseShort: `合言葉は ${PASSPHRASE_MIN} 文字以上にしてください。`,
  passphraseMismatch: "2 回の合言葉が違います。作りませんでした。",
  created: (ringId: string, fp: string, dir: string) => `輪 ${ringId} を作りました：${dir}\n自分の鍵の指紋：${fp}（仲間と電話で読み合わせてください）`,
  createFailed: (r: string) => `作れませんでした（${r}）`,
  cancelled: "やめました。何も書いていません。",
  sendNotHere: "束を送るのは、作業画面の検問所からです（端末から送るのは未実装）。",
};

const say = (m: string) => process.stderr.write(`${m}\n`);

/** 標準入力が端末か（人がいるか）。人だけの CLI は、端末でなければ断る。 */
export function requireTerminal(stdin: { isTTY?: boolean } = process.stdin): boolean {
  if (stdin.isTTY === true) return true;
  say(CLI_TEXT.notTerminal);
  return false;
}

/** 指したフォルダから、輪（<上>/<輪ID>/）の一覧を作る。 */
export function ringsAt(folder: string): { root: string; ringId: string }[] {
  const abs = resolve(folder);
  if (existsSync(join(abs, CIRCLE_FILE)) && HEX16.test(basename(abs))) return [{ root: dirname(abs), ringId: basename(abs) }];
  try {
    return readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.isDirectory() && HEX16.test(d.name) && existsSync(join(abs, d.name, CIRCLE_FILE)))
      .map((d) => ({ root: abs, ringId: d.name }))
      .sort((a, b) => (a.ringId < b.ringId ? -1 : 1));
  } catch {
    return [];
  }
}

/** 状態フォルダから、確認済みの鍵（自分の鍵と、読み合わせた仲間）を読む。 */
export function confirmedKeys(stateDir: string): Set<string> {
  const r = readRings(stateDir);
  const out = new Set(r.confirmed);
  for (const e of r.rings) {
    out.add(e.key);
    const w = readWrappedKey(stateDir, e.ringId);
    if (w) out.add(keyIdOf(w.pub));
  }
  return out;
}

export function formatReport(rep: VerifyReport): string[] {
  const lines = [CLI_TEXT.ringHead(rep.ringId)];
  for (const l of rep.lines) {
    const what = l.kind === "circle" ? CLI_TEXT.circle : l.kind === "member" ? CLI_TEXT.member(l.name, l.fingerprint) : CLI_TEXT.bundle(l.name);
    if (l.status === "ok") lines.push(`  ✓ ${what}`);
    else if (l.status === "arriving") lines.push(`  … ${what}：${CLI_TEXT.arriving}`);
    else if (l.status === "missing") lines.push(`  ✗ ${what}：${CLI_TEXT.missing}`);
    else lines.push(`  ✗ ${what}：${[...new Set(l.reasons.map(reasonText))].join("、")}`);
  }
  if (rep.notBundleFiles > 0) lines.push(`  ✗ ${CLI_TEXT.notBundleFiles(rep.notBundleFiles)}`);
  return lines;
}

/** verify ring。すべて ✓ なら 0、ほかは 1、引数が違えば 2 を返す。 */
export async function verifyRingCli(argv: string[], o: { packsDir?: string; stateDir?: string } = {}): Promise<number> {
  const [what, folder, ...rest] = argv;
  if (what !== "ring" || !folder || rest.length > 0) {
    say(CLI_TEXT.verifyUsage);
    return 2;
  }
  const rings = ringsAt(folder);
  if (rings.length === 0) {
    say(CLI_TEXT.noRing(folder));
    return 1;
  }
  const packsDir = o.packsDir ?? resolvePacksDir();
  const confirmed = confirmedKeys(o.stateDir ?? resolveStateDir());
  let ng = 0;
  for (const r of rings) {
    const p = parseJsonStrict(readFileSync(join(r.root, r.ringId, CIRCLE_FILE), "utf8"));
    const rules = p.ok ? (p.value as { body?: { rules?: { pack?: unknown; vocab?: unknown; national?: unknown } } })?.body?.rules : undefined;
    if (!rules || typeof rules.pack !== "string") {
      say(`${CLI_TEXT.ringHead(r.ringId)}\n  ✗ ${CLI_TEXT.circle}：${CLI_TEXT.circleUnreadable}`);
      ng++;
      continue;
    }
    const pack = loadSharePack(packsDir, rules.pack);
    if (!pack.ok) {
      say(`${CLI_TEXT.ringHead(r.ringId)}\n  ✗ ${CLI_TEXT.packNotReady(rules.pack, pack.reason)}`);
      ng++;
      continue;
    }
    const rep = await verifyRing(r.root, r.ringId, pack.pack, confirmed);
    for (const l of formatReport(rep)) say(l);
    if (rules.vocab !== pack.pack.vocab.hash) say(`  ✗ ${CLI_TEXT.vocabMismatch}`);
    if (rules.national !== pack.pack.table.hash) say(`  ✗ ${CLI_TEXT.nationalMismatch}`);
    ng += rep.lines.filter((l) => l.status !== "ok").length + (rep.notBundleFiles > 0 ? 1 : 0);
    if (rules.vocab !== pack.pack.vocab.hash || rules.national !== pack.pack.table.hash) ng++;
  }
  say(ng === 0 ? CLI_TEXT.summaryOk : CLI_TEXT.summaryNg(ng));
  return ng === 0 ? 0 : 1;
}

/** askHidden が読む端末の形（試験では偽の端末を渡す） */
export interface HiddenIO {
  input: NodeJS.EventEmitter & { isRaw?: boolean; setRawMode?: (on: boolean) => unknown; setEncoding(e: BufferEncoding): unknown; resume(): unknown; pause(): unknown };
  output: { write(s: string): unknown };
}

/**
 * 合言葉を、画面に出さずに 1 行読む。Ctrl+C か、空のときの Ctrl+D なら null（やめた）。
 * readline は使わない（端末の行を描き直すときに問いの文字まで消すので、問いが見えず止まったように見えた）。
 * 端末を生のモードにして、Enter・Backspace・Ctrl+C を自分で読む。矢印などのエスケープの並びは捨てる。
 */
export function askHidden(prompt: string, io: HiddenIO = { input: process.stdin, output: process.stderr }): Promise<string | null> {
  return new Promise((res) => {
    const { input, output } = io;
    const wasRaw = input.isRaw === true;
    let buf: string[] = [];
    const finish = (v: string | null) => {
      input.off("data", onData);
      input.setRawMode?.(wasRaw);
      input.pause();
      output.write("\n");
      res(v);
    };
    const onData = (chunk: string | Buffer) => {
      for (const ch of String(chunk)) {
        if (ch === "\r" || ch === "\n") return finish(buf.join(""));
        if (ch === "\u0003") return finish(null);
        if (ch === "\u0004") {
          if (buf.length === 0) return finish(null);
          continue;
        }
        if (ch === "\u007f" || ch === "\b") {
          buf = buf.slice(0, -1);
          continue;
        }
        if (ch === "\u001b") break;
        if (ch < " ") continue;
        buf.push(ch);
      }
    };
    output.write(prompt);
    input.setRawMode?.(true);
    input.setEncoding("utf8");
    input.on("data", onData);
    input.resume();
  });
}

/** keys create：人だけ。端末でなければ断る。 */
export async function keysCli(argv: string[], o: { stdin?: { isTTY?: boolean } } = {}): Promise<number> {
  if (!requireTerminal(o.stdin)) return 3;
  const [verb, ...rest] = argv;
  let root: string | null = null;
  let packId: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--root") root = rest[++i] ?? null;
    else if (rest[i] === "--pack") packId = rest[++i] ?? null;
    else root = "";
  }
  if (verb !== "create" || !root || !packId || !isAbsolute(root)) {
    say(CLI_TEXT.keysUsage);
    return 2;
  }
  const pack = loadSharePack(resolvePacksDir(), packId);
  if (!pack.ok) {
    say(CLI_TEXT.packNotReady(packId, pack.reason));
    return 1;
  }
  const a = await askHidden(CLI_TEXT.passphrase);
  if (a === null) {
    say(CLI_TEXT.cancelled);
    return 130;
  }
  if (a.length < PASSPHRASE_MIN) {
    say(CLI_TEXT.passphraseShort);
    return 1;
  }
  const b = await askHidden(CLI_TEXT.passphraseAgain);
  if (b === null) {
    say(CLI_TEXT.cancelled);
    return 130;
  }
  if (a !== b) {
    say(CLI_TEXT.passphraseMismatch);
    return 1;
  }
  const r = await createRing({ stateDir: resolveStateDir(), root: resolve(root), pack: pack.pack, passphrase: a, now: new Date() });
  if (!r.ok) {
    say(CLI_TEXT.createFailed(r.reason));
    return 1;
  }
  say(CLI_TEXT.created(r.ringId, r.fingerprint, r.dir));
  return 0;
}

/** send：人だけ。端末でなければ断る。端末から送るのは未実装（検問所の画面から送る）。 */
export function sendCli(o: { stdin?: { isTTY?: boolean } } = {}): number {
  if (!requireTerminal(o.stdin)) return 3;
  say(CLI_TEXT.sendNotHere);
  return 1;
}
