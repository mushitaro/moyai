// 人だけの CLI と、輪を確かめる CLI。
// - `moyai verify ring <フォルダ>`：受け手と同じ関数（readRing）で、決まり・仲間・束ごとに ✓ か理由つきの ✗ を出す。
// - `moyai verify demo-ring [<フォルダ>]`：リポジトリのデモの輪（demo-ring/）を、verify ring と同じ関数で確かめ、
//   全員 ✓・わざと入れた ✗ が約束の理由で ✗ かを照らす。確認済みに数える鍵は demo-ring.json から読む（状態フォルダは読まない）。
// - `moyai keys create --root <輪のフォルダ> --pack <パック>`：輪を作り、その輪の鍵の対を状態フォルダに置く（包まない）。
// - `moyai keys unwrap`：前の形の鍵（合言葉で包んだもの）を、前の合言葉で 1 度だけ開き、包まない形に置き換える。
//   合言葉はやめた（運営者の決定 2026-11-04「パスワードは絶対いやです」、docs/plan.md §2.19）。前の形の鍵はアプリでは使わない。
// - `moyai send`：束を送る（検問所の画面から送る。端末から送るのは未実装）。
// 人だけの CLI（keys create・send）は、標準入力が端末でなければ断る（AI のシェルや別のプログラムから呼ばせない）。
// 人への知らせは標準エラーへ出す（標準出力は MCP だけに使う）。前の合言葉は画面に出さない。
import { knownMaxSeq } from "../share/ring-seen";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRoot, detectDocuments, readKeyFile, readRings, readSettings, replaceOldKeyFile } from "../bridge/places";
import { ownKeysAt } from "../share/facility";
import { oldOwnKeys, replaceOldOwnKey } from "../bridge/people";
import { resolveStateDir } from "../bridge/state";
import { reasonText } from "../app/text/reasons";
import { createRing, verifyRing, type VerifyReport } from "../share/checkpoint";
import { parseJsonStrict } from "../share/jcs";
import { loadSharePack, resolvePacksDir } from "../share/pack";
import { CIRCLE_FILE } from "../share/ring";
import { DEMO_RING_FILE, DEMO_RING_ID, judgeDemoRing, parseDemoRingManifest } from "../share/demo-ring";
import { HEX16, fingerprint, isWrappedKey, keyIdOf, toPlainKey, unwrapPrivateKey, WrongPassphrase, type WrappedKey } from "../share/sign";

export const CLI_TEXT = {
  notTerminal: "この操作は人だけがします。端末から直接走らせてください（標準入力が端末ではないので断りました）。",
  verifyUsage: "使い方：moyai verify ring <共有フォルダ>（<共有フォルダ>/<共有フォルダ ID>/ か、その上のフォルダ）",
  noRing: (p: string) => `共有フォルダが見つかりません：${p}（circle.json のあるフォルダか、その上のフォルダを指してください）`,
  circleUnreadable: "決まり（circle.json）を読めません",
  packNotReady: (pack: string, reason: string) => `Skillパック ${pack} の共有の部品を読めません（${reason}）`,
  vocabMismatch: "公開語彙の版が、共有フォルダの決まりと違います",
  nationalMismatch: "全国の表の版が、共有フォルダの決まりと違います",
  ringHead: (id: string) => `共有フォルダ ${id}`,
  circle: "決まり（circle.json）",
  member: (key: string, fp: string | undefined) => `メンバー ${key}${fp ? `（鍵番号 ${fp}）` : ""}`,
  bundle: (name: string) => `共有ファイル ${name}`,
  arriving: "届きかけ",
  missing: "ありません",
  notBundleFiles: (n: number) => `共有ファイルの形をしていないファイル ${n} 件`,
  summaryOk: "すべて ✓ です。",
  demoUsage: "使い方：moyai verify demo-ring [<デモの共有フォルダ>]（省くとリポジトリの demo-ring/）",
  demoNotOurs: (got: string, want: string) =>
    `デモの共有フォルダではありません：${DEMO_RING_FILE} の共有フォルダ ${got} は、リポジトリのデモの共有フォルダ ${want} と違います（ほかの共有フォルダは moyai verify ring で確かめてください）`,
  demoNoManifest: (p: string) => `デモの共有フォルダの約束のファイル（${DEMO_RING_FILE}）を読めません：${p}`,
  demoConfirmedNote: (n: number) => `デモの共有フォルダ：鍵番号の照合の代わりに、${DEMO_RING_FILE} の ${n} 個の鍵を確認済みに数えます（あなたの状態フォルダは読みません）`,
  demoExpectedNg: (what: string) => `  （${what} の ✗ は、わざと入れた共有ファイルによるものです。約束の理由で ✗ になりました）`,
  demoUnexpected: (what: string) => `約束に無い ✗：${what}`,
  demoUnmet: (what: string, got: string) => `約束の ✗ になりません：${what}（${got}）`,
  demoGotOk: "✓ になった",
  demoGotMissing: "ありません",
  demoGotOther: (r: string) => `理由が違う：${r}`,
  demoSummaryOk: (ok: number, n: number) => `デモの共有フォルダ：拠点 ${ok}/${n} が ✓、わざと入れた ✗ は約束どおり ✗ です。`,
  demoSummaryNg: (n: number) => `デモの共有フォルダ：約束と違う所が ${n} 件あります。`,
  summaryNg: (n: number) => `✗ が ${n} 件あります。`,
  keysUsage: "使い方：moyai keys create --root <共有フォルダ（絶対の道）> --pack <Skillパック ID>　／　moyai keys unwrap",
  noOldKeys: "前の形の鍵（合言葉で包んだもの）はありません。",
  oldKeyHead: (what: string, fp: string) => `前の形の鍵：${what}（鍵番号 ${fp}）`,
  oldPersonKey: (by: string) => `人の鍵「${by}」`,
  oldPlaceKey: (id: string) => `共有フォルダか台帳の鍵 ${id}`,
  oldPassphrase: "前の合言葉（打った文字は「*」で出ます。日本語は変換を確定してから Enter。空で Enter なら、この鍵は飛ばす）：",
  wrongOld: "前の合言葉が鍵を開きませんでした。",
  skipped: "この鍵は飛ばしました（前の形のまま。アプリでは使えません）。",
  unwrapped: "包まない形に置き換えました。",
  unwrapSummary: (done: number, left: number) => `置き換えた鍵 ${done}・前の形のまま ${left}`,
  created: (ringId: string, fp: string, dir: string) => `共有フォルダ ${ringId} を作りました：${dir}\n自分の鍵番号：${fp}（メンバーと電話で照合してください）`,
  createFailed: (r: string) => `作れませんでした（${r}）`,
  cancelled: "やめました。何も書いていません。",
  sendNotHere: "共有ファイルを送るのは、作業画面の検問所からです（端末から送るのは未実装）。",
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

/**
 * 確認済みの鍵：状態フォルダの、輪を作った自分の鍵と読み合わせた仲間に、保管先の計画が輪へ出す施設の鍵（plans/<計画ID>/share/keys/）を足す。
 * 保管先は設定の置き場所か、既定（Documents の下の MOYAI/）。
 */
export async function confirmedKeys(stateDir: string, rootOf: () => Promise<string | null> = async () => readSettings(stateDir).root ?? defaultRoot(await detectDocuments())): Promise<Set<string>> {
  const r = readRings(stateDir);
  const out = new Set(r.confirmed);
  const root = r.rings.length > 0 ? await rootOf() : null;
  for (const e of r.rings) {
    out.add(e.key);
    const w = readKeyFile(stateDir, e.ringId);
    if (w) out.add(keyIdOf(w.pub));
    if (root) for (const k of ownKeysAt(root, e.ringId)) out.add(k);
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
export async function verifyRingCli(argv: string[], o: { packsDir?: string; stateDir?: string; root?: string } = {}): Promise<number> {
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
  const stateDir = o.stateDir ?? resolveStateDir();
  const confirmed = await confirmedKeys(stateDir, ...(o.root !== undefined ? [async () => o.root ?? null] : []));
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
    // この PC が前に見た仲間ごとの最大の seq と照らす（覚え直すのは画面の loadRing だけ。台帳の D3）
    const rep = await verifyRing(r.root, r.ringId, pack.pack, confirmed, knownMaxSeq(stateDir, r.root, r.ringId));
    for (const l of formatReport(rep)) say(l);
    if (rules.vocab !== pack.pack.vocab.hash) say(`  ✗ ${CLI_TEXT.vocabMismatch}`);
    if (rules.national !== pack.pack.table.hash) say(`  ✗ ${CLI_TEXT.nationalMismatch}`);
    ng += rep.lines.filter((l) => l.status !== "ok").length + (rep.notBundleFiles > 0 ? 1 : 0);
    if (rules.vocab !== pack.pack.vocab.hash || rules.national !== pack.pack.table.hash) ng++;
  }
  say(ng === 0 ? CLI_TEXT.summaryOk : CLI_TEXT.summaryNg(ng));
  return ng === 0 ? 0 : 1;
}

/** リポジトリのデモの輪のフォルダ（dist/cli.js からは ../demo-ring、src/cli/human.ts からは ../../demo-ring） */
export function resolveDemoRingDir(from: string = import.meta.url): string {
  const here = dirname(fileURLToPath(from));
  for (const rel of ["../demo-ring", "../../demo-ring"]) {
    const p = join(here, rel);
    if (existsSync(join(p, DEMO_RING_FILE))) return p;
  }
  return join(here, "..", "demo-ring");
}

/**
 * verify demo-ring。verify ring と同じ関数（verifyRing）で確かめ、全員 ✓・わざと入れた ✗ が約束の理由で ✗ なら 0、
 * 約束と違えば 1、引数が違うか、demo-ring.json の輪がリポジトリのデモの輪（DEMO_RING_ID）でなければ 2 を返す。
 * ringId は試験だけが渡す（道具で一時のフォルダに作り直した輪を確かめるため。端末の引数からは変えられない）。
 */
export async function verifyDemoRingCli(argv: string[], o: { packsDir?: string; ringId?: string } = {}): Promise<number> {
  const [what, folder, ...rest] = argv;
  if (what !== "demo-ring" || rest.length > 0) {
    say(CLI_TEXT.demoUsage);
    return 2;
  }
  const dir = resolve(folder ?? resolveDemoRingDir());
  let manifest = null;
  try {
    manifest = parseDemoRingManifest(readFileSync(join(dir, DEMO_RING_FILE), "utf8"));
  } catch {
    manifest = null;
  }
  if (!manifest) {
    say(CLI_TEXT.demoNoManifest(dir));
    return 1;
  }
  const want = o.ringId ?? DEMO_RING_ID;
  if (manifest.ring !== want) {
    say(CLI_TEXT.demoNotOurs(manifest.ring, want));
    return 2;
  }
  const rings = ringsAt(dir);
  if (rings.length !== 1 || rings[0]!.ringId !== manifest.ring) {
    say(CLI_TEXT.noRing(join(dir, manifest.ring)));
    return 1;
  }
  const r = rings[0]!;
  const p = parseJsonStrict(readFileSync(join(r.root, r.ringId, CIRCLE_FILE), "utf8"));
  const rules = p.ok ? (p.value as { body?: { rules?: { pack?: unknown; vocab?: unknown; national?: unknown } } })?.body?.rules : undefined;
  if (!rules || typeof rules.pack !== "string") {
    say(`${CLI_TEXT.ringHead(r.ringId)}
  ✗ ${CLI_TEXT.circle}：${CLI_TEXT.circleUnreadable}`);
    return 1;
  }
  const pack = loadSharePack(o.packsDir ?? resolvePacksDir(), rules.pack);
  if (!pack.ok) {
    say(`${CLI_TEXT.ringHead(r.ringId)}
  ✗ ${CLI_TEXT.packNotReady(rules.pack, pack.reason)}`);
    return 1;
  }
  say(CLI_TEXT.demoConfirmedNote(manifest.confirmed.length));
  const rep = await verifyRing(r.root, r.ringId, pack.pack, new Set(manifest.confirmed.map((c) => c.key)));
  for (const l of formatReport(rep)) say(l);
  const j = judgeDemoRing(rep, manifest);
  const label = (kind: string, name: string) => (kind === "member" ? CLI_TEXT.member(name, undefined) : kind === "bundle" ? CLI_TEXT.bundle(name) : CLI_TEXT.circle);
  let ng = 0;
  if (rules.vocab !== pack.pack.vocab.hash) {
    say(`  ✗ ${CLI_TEXT.vocabMismatch}`);
    ng++;
  }
  if (rules.national !== pack.pack.table.hash) {
    say(`  ✗ ${CLI_TEXT.nationalMismatch}`);
    ng++;
  }
  for (const e of manifest.expectNg) if (!j.unmet.some((u) => u.expect === e)) say(CLI_TEXT.demoExpectedNg(label(e.kind, e.name)));
  for (const l of j.unexpected) say(`  ✗ ${CLI_TEXT.demoUnexpected(label(l.kind, l.name))}`);
  for (const u of j.unmet) {
    const got = !u.got ? CLI_TEXT.demoGotMissing : u.got.status === "ok" ? CLI_TEXT.demoGotOk : CLI_TEXT.demoGotOther([...new Set(u.got.reasons.map(reasonText))].join("、") || u.got.status);
    say(`  ✗ ${CLI_TEXT.demoUnmet(label(u.expect.kind, u.expect.name), got)}`);
  }
  ng += j.unexpected.length + j.unmet.length;
  if (!j.ok && ng === 0) ng = 1; // 拠点の数が合わない・共有ファイルの形でないファイル（上の行に出ている）
  say(ng === 0 ? CLI_TEXT.demoSummaryOk(j.sitesOk, j.sites) : CLI_TEXT.demoSummaryNg(ng));
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
 * 受け取った 1 文字ごとに「*」を出す（日本語を変換して確定すると、変換の欄の文字が消えて、受け取れたかが見えなかった）。
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
          if (buf.length > 0) output.write("\b \b");
          buf = buf.slice(0, -1);
          continue;
        }
        if (ch === "\u001b") break;
        if (ch < " ") continue;
        buf.push(ch);
        output.write("*");
      }
    };
    output.write(prompt);
    input.setRawMode?.(true);
    input.setEncoding("utf8");
    input.on("data", onData);
    input.resume();
  });
}

/** 前の形の鍵の一覧：人の鍵（people/keys/）と、輪・台帳・管理者の鍵（keys/） */
export function oldKeysOf(stateDir: string): { what: string; wrapped: WrappedKey; replace: (pair: ReturnType<typeof unwrapPrivateKey>) => boolean }[] {
  const out: ReturnType<typeof oldKeysOf> = [];
  for (const k of oldOwnKeys(stateDir)) out.push({ what: CLI_TEXT.oldPersonKey(k.by), wrapped: k.wrapped, replace: (pair) => replaceOldOwnKey(stateDir, k.key, pair) });
  const dir = join(stateDir, "keys");
  const ids = existsSync(dir) ? readdirSync(dir).filter((n) => /^[0-9a-f]{16}\.json$/.test(n)).map((n) => n.slice(0, 16)) : [];
  for (const id of ids.sort()) {
    const f = readKeyFile(stateDir, id);
    if (f && isWrappedKey(f)) out.push({ what: CLI_TEXT.oldPlaceKey(id), wrapped: f, replace: (pair) => replaceOldKeyFile(stateDir, id, toPlainKey(pair)) });
  }
  return out;
}

/** keys unwrap：前の形の鍵を、前の合言葉で 1 度だけ開いて置き換える。人だけ。端末でなければ断る。前の形が残れば 1 */
export async function unwrapCli(o: { stdin?: { isTTY?: boolean }; stateDir?: string; ask?: (p: string) => Promise<string | null> } = {}): Promise<number> {
  if (!requireTerminal(o.stdin)) return 3;
  const old = oldKeysOf(o.stateDir ?? resolveStateDir());
  if (old.length === 0) {
    say(CLI_TEXT.noOldKeys);
    return 0;
  }
  const ask = o.ask ?? askHidden;
  let done = 0;
  for (const k of old) {
    say(CLI_TEXT.oldKeyHead(k.what, fingerprint(k.wrapped.pub)));
    for (let tries = 0; ; tries++) {
      const p = await ask(CLI_TEXT.oldPassphrase);
      if (p === null) {
        say(CLI_TEXT.cancelled);
        say(CLI_TEXT.unwrapSummary(done, old.length - done));
        return 130;
      }
      if (p.length === 0 || tries >= 3) {
        say(CLI_TEXT.skipped);
        break;
      }
      try {
        const pair = unwrapPrivateKey(k.wrapped, p);
        if (k.replace(pair)) {
          done++;
          say(CLI_TEXT.unwrapped);
        }
        break;
      } catch (e) {
        if (!(e instanceof WrongPassphrase)) throw e;
        say(CLI_TEXT.wrongOld);
      }
    }
  }
  say(CLI_TEXT.unwrapSummary(done, old.length - done));
  return done === old.length ? 0 : 1;
}

/** keys create・keys unwrap：人だけ。端末でなければ断る。 */
export async function keysCli(argv: string[], o: { stdin?: { isTTY?: boolean } } = {}): Promise<number> {
  if (!requireTerminal(o.stdin)) return 3;
  if (argv.length === 1 && argv[0] === "unwrap") return unwrapCli(o);
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
  const r = await createRing({ stateDir: resolveStateDir(), root: resolve(root), pack: pack.pack, now: new Date() });
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
