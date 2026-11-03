import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { decide } from "../../scripts/guard-hook.mjs";

const env = { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" };
const rings = ["D:\\share\\moyai-ring"];
const run = (tool_name, tool_input) => decide({ tool_name, tool_input }, { env, rings });

const blocked = [
  ["Bash", { command: "curl -X POST http://127.0.0.1:43110/api/confirm" }],
  ["Bash", { command: "curl http://localhost:43110/" }],
  ["Bash", { command: "wget -qO- http://[::1]:43110/" }],
  ["Bash", { command: `node -e "fetch('http://127.0.0.1:43110/api/send',{method:'POST'})"` }],
  ["PowerShell", { command: "Invoke-WebRequest -Uri http://127.0.0.1:43110/api/confirm -Method Post" }],
  ["PowerShell", { command: "iwr http://localhost:43110" }],
  ["PowerShell", { command: "irm -Method Post http://127.0.0.1:43110/x" }],
  ["Bash", { command: "cat /c/Users/u/AppData/Local/MOYAI/state/keys.json" }],
  ["PowerShell", { command: "Get-Content $env:LOCALAPPDATA\\MOYAI\\state\\keys.json" }],
  ["PowerShell", { command: "Get-ChildItem (Join-Path $env:LOCALAPPDATA 'MOYAI')" }],
  ["Bash", { command: "type %LOCALAPPDATA%\\MOYAI\\state\\ledger.jsonl" }],
  ["Read", { file_path: "C:\\Users\\u\\AppData\\Local\\MOYAI\\state\\keys.json" }],
  ["Grep", { pattern: "secret", path: "C:/Users/u/AppData/Local/MOYAI/state" }],
  ["Glob", { pattern: "C:/Users/u/AppData/Local/MOYAI/**/*" }],
  ["Write", { file_path: "C:\\Users\\u\\AppData\\Local\\MOYAI\\state\\x.json", content: "{}" }],
  ["Write", { file_path: "D:\\share\\moyai-ring\\c_ab\\bundles\\k1\\1-abc.json", content: "{}" }],
  ["Edit", { file_path: "d:/share/moyai-ring/c_ab/circle.json", old_string: "a", new_string: "b" }],
  ["Bash", { command: "cp bundle.json 'D:\\share\\moyai-ring\\c_ab\\bundles\\k1\\'" }],
  ["Bash", { command: "git clone https://github.com/woodygaragelab/hoshutaro" }],
  ["Bash", { command: "npm install mxstage" }],
  ["Bash", { command: "gh repo clone mxstage/mxstage" }],
  ["WebFetch", { url: "https://github.com/mxstage/mxstage/blob/main/README.md", prompt: "x" }],
  ["WebFetch", { url: "https://github.com/woodygaragelab/hoshutaro", prompt: "x" }],
  ["WebFetch", { url: "https://mxstage.tsunagi.app/docs", prompt: "x" }],
  ["Bash", { command: "node dist/cli.js ledger submit ./bundle.json" }],
  ["Bash", { command: "node dist/cli.js keys create --circle c_ab" }],
  ["Bash", { command: "node dist/cli.js ledger init --root C:/x --pack waste-incineration" }],
  ["PowerShell", { command: "moyai send --to ring" }],
  // 監査の指摘（2026-11-03）で足した、すり抜けの書き方
  ["Bash", { command: "curl http://127.1:43110/api/confirm" }],
  ["Bash", { command: "curl http://2130706433:43110/" }],
  ["Bash", { command: "curl http://0x7f000001:43110/" }],
  ["Bash", { command: `python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:43110')"` }],
  ["Bash", { command: `python -c "import requests; requests.post('http://localhost:43110/api/send')"` }],
  ["Bash", { command: "git ls-remote https://github.com/mxstage/mxstage" }],
  ["WebFetch", { url: "https://api.github.com/repos/mxstage/mxstage/contents", prompt: "x" }],
  ["WebFetch", { url: "https://codeload.github.com/woodygaragelab/hoshutaro/zip/main", prompt: "x" }],
  ["Bash", { command: "node dist/cli.js --port 1 ledger submit ./b.json" }],
  ["Bash", { command: "npm run cli -- ledger submit ./b.json" }],
  ["Bash", { command: "cp b.json /d/share/moyai-ring/c_ab/bundles/k1/" }],
  // 2 回目の監査（2026-11-03）で足した書き方
  ["Bash", { command: "curl http://0177.0.0.1:43110/" }],
  ["Bash", { command: "curl http://017700000001:43110/" }],
  ["Bash", { command: "curl -g http://[0:0:0:0:0:0:0:1]:43110/" }],
  ["Bash", { command: "curl -g http://[::ffff:7f00:1]:43110/" }],
  ["Bash", { command: "curl 127.1:43110/api/confirm" }],
  ["Bash", { command: 'node dist/cli.js "ledger" "submit" ./b.json' }],
  ["Bash", { command: "node dist/cli ledger submit ./b.json" }],
  ["Bash", { command: "curl -g http://[::]:43110/" }],
];

const allowed = [
  ["Bash", { command: "npm test" }],
  ["Bash", { command: "git push origin main" }],
  ["Bash", { command: "curl -sL https://www.env.go.jp/recycle/waste/3r_network/7_misc/gl-ple_prov.pdf -o .cache/a.pdf" }],
  ["Bash", { command: "node dist/cli.js start" }],
  ["Bash", { command: "node dist/cli.js verify ledger ../moyai-ledger" }],
  ["Bash", { command: 'grep -rE "mxstage|hoshutaro|Maximo" src packs skills samples' }],
  ["PowerShell", { command: "Get-ChildItem C:\\Users\\u\\Moyai" }],
  ["Read", { file_path: "C:\\Users\\u\\Moyai\\docs\\plan.md" }],
  ["Read", { file_path: "D:\\share\\moyai-ring\\c_ab\\circle.json" }],
  ["Write", { file_path: "C:\\Users\\u\\Moyai\\src\\shared\\tools.ts", content: "" }],
  ["WebFetch", { url: "https://github.com/modelcontextprotocol/typescript-sdk", prompt: "x" }],
  ["WebFetch", { url: "https://laws.e-gov.go.jp/api/2/law_data/346M50000100035", prompt: "x" }],
  ["Glob", { pattern: "src/**/*.ts" }],
  // フォルダ名の Moyai と、コミットの文の中の send・confirm では止めない
  ["Bash", { command: 'cd /c/Users/u/Moyai && git commit -m "confirm the send path"' }],
  ["PowerShell", { command: "Set-Location C:\\Users\\u\\Moyai; npm test" }],
  ["Bash", { command: "curl -s https://api.github.com/repos/mushitaro/moyai" }],
  ["Bash", { command: "git log --oneline -- scripts/cli.mjs" }],
  ["Bash", { command: 'git commit -m "cli: confirm the send path"' }],
  ["Bash", { command: 'gh issue create --title "fix cli send" --body "x"' }],
];

for (const [tool, input] of blocked) {
  test(`止める: ${tool} ${JSON.stringify(input).slice(0, 80)}`, () => {
    const r = run(tool, input);
    assert.equal(r.deny, true);
    assert.match(r.reason, /^MOYAI の見張り：/);
  });
}

for (const [tool, input] of allowed) {
  test(`通す: ${tool} ${JSON.stringify(input).slice(0, 80)}`, () => {
    assert.deepEqual(run(tool, input), { deny: false });
  });
}

test("ツールの名前が無い入力は判定の対象外", () => {
  assert.deepEqual(decide({}, { env, rings }), { deny: false });
});

test("フックは読めない入力を止める（壊れたときに開かない）", () => {
  const r = spawnSync(process.execPath, ["scripts/guard-hook.mjs"], { input: "{not json", encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
});

test("フックは止める呼び出しで deny を出し、通す呼び出しでは何も出さない", () => {
  const deny = spawnSync(process.execPath, ["scripts/guard-hook.mjs"], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "curl http://127.0.0.1:43110/" } }),
    encoding: "utf8",
  });
  assert.equal(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision, "deny");
  const allow = spawnSync(process.execPath, ["scripts/guard-hook.mjs"], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "npm test" } }),
    encoding: "utf8",
  });
  assert.equal(allow.stdout, "");
});
