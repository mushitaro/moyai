// node video/record.mjs s3 [--compose-only]：左に本物の Claude Code（端末なしの claude -p、MCP は moyai だけ）、右に同じ時刻の MOYAI を撮り、横に並べた MP4 にする
// 人の操作（資料を落とす・受ける・署名する）は、この台本が画面のボタンで押す。質問への答えは、利用者が撮る前に一言で伝えたことにする（作者 ai_relayed_human）。どちらも YouTube の説明欄に書く
// 撮った回の Claude の言い回しを、そのまま使う。通しは撮る回だけにする（Claude Code の使用量を使うため）
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { buildStamp } from "../scripts/build-stamp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const scene = process.argv[2] ?? "s3";
const composeOnly = process.argv.includes("--compose-only");
// --dry：Claude Code を使わず、取り込みだけを MCP の SDK の台本で進める（人の操作の台本を確かめるため。撮る回には使わない）
const dry = process.argv.includes("--dry");
const out = join(here, "out", `${scene}.rec`);
const RIGHT = { width: 1280, height: 1080 };
const LEFT = { width: 640, height: 1080 };
const FPS = 30;

const FACILITY = "【架空】みどり台クリーンセンター";
const NAME = "【架空】山田";
const HUMAN = "撮影の台本が押した（Claude の案を画面で見て受けた）";
const F1 = { dir: join(repo, "samples/out/waste-incineration/fictional-1"), files: ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"] };
const TOOLS = ["intake_survey", "intake_settle", "intake_compose", "chart_rows", "crosswalk_propose", "check_results", "note_for_human"].map((t) => `mcp__moyai__${t}`);
const PROMPT = `あなたは MOYAI の利用者を手伝っています。作業画面は開いていて、利用者は施設「${FACILITY}」の資料を落としました。利用者は撮影の前に「質問には既定の答えでよい」と言っています。
次の順に進めてください。
1. intake_survey（part: questions）で質問を読み、既定の答えで intake_settle をする（author: ai_relayed_human、reason: 利用者がチャットで既定の答えでよいと言った）。質問が無くなるまで繰り返す。
2. intake_compose で計画を作り、intake_survey（part: compose）で終わるまで見る。
3. intake_survey（part: crosswalk）と chart_rows を読み、crosswalk_propose で当てはめの規則の案を置く。未当てはめが残れば、規則を足す。決まらないものは推測で埋めない。
4. 最後に、人に受けてほしいことを 3 行で伝えて終わる。確定と署名は人が画面でするので、しない。`;

const log = [];
const mark = (kind, data = {}) => log.push({ t: Date.now(), kind, ...data });

function freePort() {
  return new Promise((res) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
}

async function startBridge(stateDir) {
  const port = await freePort();
  const child = spawn(process.execPath, ["dist/cli.js", "start", "--port", String(port), "--no-open"], { cwd: repo, env: { ...process.env, MOYAI_STATE_DIR: stateDir }, stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`起動しない: ${buf}`)), 15_000);
    child.stderr.on("data", (d) => { buf += d; const m = /橋渡しを起こしました：(\S+)/.exec(buf); if (m) { clearTimeout(timer); resolve(m[1].replace(/\/$/, "")); } });
    child.once("exit", (c) => reject(new Error(`止まった ${c}: ${buf}`)));
  });
  return { base, stop: () => child.kill() };
}

/** 人：決定のシートで、種類ごとに切り替えて、受けていない決定を全部受ける（「まとめて受ける」は見えている種類だけを受けるため） */
async function acceptAll(page) {
  // 版の履歴を読み終えて、行か「ありません」が出るまで待つ（早く数えると 0 と数えて受けずに進む）
  await page.locator('[data-testid="pending-row"], [data-testid="decisions-none"], [data-testid="crosswalk-rule"]').first().waitFor({ timeout: 20_000 });
  const open = () => page.locator('[data-testid="pending-row"][data-accepted="false"], [data-testid="crosswalk-rule"][data-state="proposed"]').count();
  for (let pass = 0; pass < 4 && (await open()) > 0; pass++) {
    const kinds = page.getByTestId("decisions-kind").locator("button");
    const n = Math.max(1, await kinds.count());
    for (let i = 0; i < n; i++) {
      if ((await kinds.count()) > i && !(await kinds.nth(i).isDisabled())) await kinds.nth(i).click();
      await page.waitForTimeout(500);
      const bulk = page.getByTestId("decisions-bulk-accept");
      await page.getByTestId("decisions-reason").fill(HUMAN);
      if (await bulk.isEnabled()) await bulk.click();
      await page.waitForTimeout(800);
    }
  }
  await page.getByTestId("confirm-open").and(page.locator(":not([disabled])")).waitFor({ timeout: 20_000 });
}

/** --dry のとき：質問に既定の答えを置き、計画を作るところまでを台本が進める */
async function runScripted(stateDir) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const c = new Client({ name: "moyai-video-dry", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(repo, "dist/cli.js"), "mcp"], env: { ...process.env, MOYAI_STATE_DIR: stateDir } }));
  const call = async (name, args = {}) => (await c.callTool({ name, arguments: args })).structuredContent;
  mark("claude-start", { cmd: "（試し：台本が Claude の代わり。撮る回には使わない）" });
  for (let round = 0; round < 15; round++) {
    const q = await call("intake_survey", { part: "questions" });
    if (!q?.questions?.length) break;
    await call("intake_settle", { decisions: q.questions.map((x) => ({ questionId: x.questionId, answer: x.defaultAnswer, author: "ai_relayed_human", reason: "利用者がチャットで、既定の答えでよいと答えた" })) });
  }
  await call("intake_compose");
  for (let i = 0; i < 100; i++) { if ((await call("intake_survey", { part: "compose" }))?.compose?.state !== "running") break; await new Promise((r) => setTimeout(r, 300)); }
  await c.close();
  mark("claude-end", { code: 0 });
}

/** 本物の Claude Code を端末なしで動かし、stream-json の 1 行ごとに受け取った時刻を付けて残す */
function runClaude(stateDir, cwd) {
  const cfg = join(cwd, "moyai-only.mcp.json");
  writeFileSync(cfg, JSON.stringify({ mcpServers: { moyai: { type: "stdio", command: "node", args: [join(repo, "dist/cli.js"), "mcp"], env: { MOYAI_STATE_DIR: stateDir } } } }));
  const args = ["-p", PROMPT, "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--mcp-config", cfg, "--allowedTools", TOOLS.join(",")];
  mark("claude-start", { cmd: "claude -p … --strict-mcp-config --mcp-config moyai-only.mcp.json" });
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let rest = "";
    child.stdout.on("data", (d) => {
      rest += d;
      const lines = rest.split("\n");
      rest = lines.pop();
      for (const l of lines) if (l.trim()) { try { mark("claude", { e: JSON.parse(l) }); } catch { /* 途中の行 */ } }
    });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill(), 20 * 60_000);
    child.once("exit", (c) => { clearTimeout(timer); mark("claude-end", { code: c }); c === 0 ? resolve() : reject(new Error(`claude ${c}: ${err.slice(-400)}`)); });
  });
}

async function capture() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "right"), { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "moyai-rec-"));
  const stateDir = join(work, "state");
  mkdirSync(stateDir);
  const bridge = await startBridge(stateDir);
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await (await browser.newContext({ viewport: RIGHT, deviceScaleFactor: 1 })).newPage();
    const cdp = await page.context().newCDPSession(page);
    cdp.on("Page.screencastFrame", (f) => {
      writeFileSync(join(out, "right", `${Math.round((f.metadata.timestamp ?? Date.now() / 1000) * 1000)}.jpg`), Buffer.from(f.data, "base64"));
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: RIGHT.width, maxHeight: RIGHT.height, everyNthFrame: 1 });

    // 人：設定（保管先・呼び名）
    await page.goto(`${bridge.base}/#/settings`);
    await page.getByTestId("root-input").fill(join(work, "共有の保管先"));
    await page.getByTestId("name-input").fill(NAME);
    await page.getByTestId("settings-save").click();
    await page.getByTestId("current-name").waitFor();
    // 人：トップ →「＋ 新しい施設」→ 資料を落とす
    await page.goto(`${bridge.base}/#/`);
    mark("start");
    await page.getByTestId("moyai-new").click();
    await page.getByTestId("pack").click();
    await page.getByRole("option", { name: "ごみ焼却", exact: false }).first().click();
    await page.getByTestId("facility-name").fill(FACILITY);
    const files = F1.files.map((n) => ({ name: basename(n), b64: readFileSync(join(F1.dir, n)).toString("base64") }));
    const dt = await page.evaluateHandle((fs) => {
      const d = new DataTransfer();
      for (const f of fs) d.items.add(new File([Uint8Array.from(atob(f.b64), (x) => x.charCodeAt(0))], f.name));
      return d;
    }, files);
    mark("human", { what: "資料を 3 つ落とす" });
    await page.getByTestId("drop").dispatchEvent("drop", { dataTransfer: dt });
    await page.getByTestId("dest-file").nth(files.length - 1).waitFor({ timeout: 20_000 });

    // Claude（本物）：取り込み → 計画 → 当てはめの案
    if (dry) await runScripted(stateDir);
    else await runClaude(stateDir, work);

    // 人：決定のシートで受ける → 星取表（共通の設備項目 × 作業の属性）→ 署名して確定
    mark("human", { what: "決定のシートで受ける" });
    await page.getByTestId("sheet-decisions").click();
    await acceptAll(page);
    mark("human", { what: "星取表を見る" });
    await page.getByTestId("sheet-chart").click();
    await page.getByTestId("rows-mode").getByText("共通の設備項目 × 作業の属性").click();
    await page.locator(".ag-row").first().waitFor();
    await page.waitForTimeout(3000);
    mark("human", { what: "署名して確定する" });
    await page.getByTestId("confirm-open").click();
    await page.getByTestId("ask-self").check();
    await page.getByTestId("confirm-reason").fill("取り込みと当てはめを入れた第 1 版");
    await page.waitForTimeout(800);
    await page.getByTestId("confirm-submit").click();
    await page.getByTestId("confirm-done").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape");
    await page.goto(`${bridge.base}/#/`);
    await page.waitForTimeout(2500);
    mark("end");
    await cdp.send("Page.stopScreencast").catch(() => {});
  } finally {
    writeFileSync(join(out, "log.json"), JSON.stringify(log, null, 1));
    await browser.close();
    bridge.stop();
    rmSync(work, { recursive: true, force: true });
  }
}

// ─── 左の札：Claude Code の記録を端末の形に描く ───────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (s, n = 90) => { const t = String(s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
function resultText(c) {
  const parts = Array.isArray(c.content) ? c.content.map((x) => x.text ?? "").join(" ") : String(c.content ?? "");
  return short(parts, 110);
}
/** 記録を、左の札の行の列にする。行は出た時刻を持つ */
function terminalLines(events) {
  const lines = [];
  for (const ev of events) {
    if (ev.kind === "claude-start") lines.push({ t: ev.t, cls: "cmd", text: `$ ${ev.cmd}` }, { t: ev.t, cls: "dim", text: "MCP：moyai だけ（--strict-mcp-config）" });
    if (ev.kind === "human") lines.push({ t: ev.t, cls: "human", text: `人 ▸ ${ev.what}（撮影の台本が押す）` });
    if (ev.kind !== "claude") continue;
    const e = ev.e;
    if (e.type === "assistant") for (const c of e.message?.content ?? []) {
      if (c.type === "text" && c.text.trim()) lines.push({ t: ev.t, cls: "say", text: short(c.text, 240) });
      if (c.type === "tool_use" && c.name.startsWith("mcp__moyai__")) lines.push({ t: ev.t, cls: "tool", text: `● ${c.name.replace("mcp__moyai__", "")} ${short(JSON.stringify(c.input), 70)}` });
    }
    if (e.type === "user") for (const c of e.message?.content ?? []) if (c.type === "tool_result") lines.push({ t: ev.t, cls: "res", text: `  ⎿ ${resultText(c)}` });
  }
  return lines;
}
function leftHtml(lines, stamp) {
  return `<!doctype html><meta charset=utf-8><link rel=stylesheet href="${pathToFileURL(join(repo, "node_modules/@fontsource/ibm-plex-sans-jp/400.css"))}"><style>
@font-face{font-family:Mono;src:url(${pathToFileURL(join(repo, "node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2"))})}
html,body{margin:0;width:${LEFT.width}px;height:${LEFT.height}px;background:#0a0a0a;color:#e0e0e0;overflow:hidden}
.h{padding:22px 26px 14px;border-bottom:1px solid #2e2e2e;font:400 20px "IBM Plex Sans JP";letter-spacing:.06em}.h b{color:#d0644c;font-weight:500}
.b{position:absolute;left:0;right:0;top:64px;bottom:40px;padding:14px 26px;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;font:15px/1.55 Mono,"IBM Plex Sans JP"}
.b p{margin:0 0 6px;word-break:break-all}.cmd{color:#8a8a8a}.dim{color:#6f6f6f}.tool{color:#e0e0e0}.res{color:#8a8a8a}.say{color:#f2f2f2;font-family:"IBM Plex Sans JP"}.human{color:#d0644c;font-family:"IBM Plex Sans JP"}
.s{position:absolute;left:26px;bottom:12px;font:12px Mono;color:#6a6a6a}
</style><div class=h>Claude Code <b>·</b> 本物の記録</div><div class=b>${lines.map((l) => `<p class=${l.cls}>${esc(l.text)}</p>`).join("")}</div><div class=s>${esc(stamp)}</div>`;
}

async function compose() {
  const log = JSON.parse(readFileSync(join(out, "log.json"), "utf8"));
  const t0 = log.find((e) => e.kind === "start").t;
  const t1 = log.find((e) => e.kind === "end").t;
  const b = buildStamp();
  const stamp = `MOYAI · build ${b.time} JST · ${b.commit}`;
  const lines = terminalLines(log).filter((l) => l.t <= t1);
  // 左：行が増えるたびに 1 枚
  const ldir = join(out, "left");
  rmSync(ldir, { recursive: true, force: true });
  mkdirSync(ldir);
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: LEFT });
  const steps = [...new Set([t0, ...lines.map((l) => Math.max(l.t, t0))])].sort((a, b) => a - b);
  const left = [];
  for (const [i, t] of steps.entries()) {
    const f = join(ldir, `${String(i).padStart(4, "0")}.png`);
    writeFileSync(join(out, "left.html"), leftHtml(lines.filter((l) => l.t <= t), stamp));
    await page.goto(pathToFileURL(join(out, "left.html")).href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: f });
    left.push({ t, f });
  }
  await browser.close();
  const right = readdirSync(join(out, "right")).filter((n) => n.endsWith(".jpg")).map((n) => ({ t: Number(n.slice(0, -4)), f: join(out, "right", n) })).filter((x) => x.t <= t1).sort((a, b) => a.t - b.t);
  const list = (frames, name) => {
    const fr = frames.filter((x, i) => i === frames.length - 1 || frames[i + 1].t > t0);
    const rows = fr.map((x, i) => `file '${x.f.replace(/\\/g, "/")}'\nduration ${((Math.min(fr[i + 1]?.t ?? t1, t1) - Math.max(x.t, t0)) / 1000).toFixed(3)}`);
    rows.push(`file '${fr.at(-1).f.replace(/\\/g, "/")}'`);
    const p = join(out, `${name}.txt`);
    writeFileSync(p, rows.join("\n"));
    return p;
  };
  const mp4 = join(here, "out", `${scene}.mp4`);
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", list(left, "left"),
    "-f", "concat", "-safe", "0", "-i", list(right, "right"),
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-filter_complex", `[0:v]fps=${FPS},scale=${LEFT.width}:${LEFT.height},setsar=1[l];[1:v]fps=${FPS},scale=${RIGHT.width}:${RIGHT.height}:force_original_aspect_ratio=decrease,pad=${RIGHT.width}:${RIGHT.height}:(ow-iw)/2:(oh-ih)/2:color=0x0a0a0a,setsar=1[r];[l][r]hstack=inputs=2,format=yuv420p[v]`,
    "-map", "[v]", "-map", "2:a", "-shortest", "-t", ((t1 - t0) / 1000).toFixed(3),
    "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-movflags", "+faststart", mp4]);
  const sec = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4]).toString().trim();
  console.log(`${mp4}　${Number(sec).toFixed(1)} 秒　${stamp}　Claude の行 ${lines.length}`);
}

if (!composeOnly) await capture();
if (existsSync(join(out, "log.json"))) await compose();
