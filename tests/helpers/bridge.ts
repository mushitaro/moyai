// 試験の道具：一時のフォルダに画面と状態フォルダを作り、空きのポートで橋渡しを起こす。
// 要求は node:http で送る（Host・Origin・Sec-Fetch-Site を自由に付けるため）。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startBridge, type Bridge, type BridgeOptions } from "../../src/bridge/server";
import { encodeEvent, type EventData, type TabToBridge } from "../../src/shared/events";

export interface TestBridge {
  bridge: Bridge;
  dir: string;
  stateDir: string;
  origin: string;
  host: string;
  close(): Promise<void>;
}

export async function startTestBridge(extra: Partial<BridgeOptions> = {}): Promise<TestBridge> {
  const dir = mkdtempSync(join(tmpdir(), "moyai-test-"));
  const staticDir = join(dir, "app");
  const stateDir = join(dir, "state");
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>t</title>");
  writeFileSync(join(staticDir, "assets", "a.js"), "export {};");
  writeFileSync(join(dir, "secret.txt"), "外のファイル");
  const bridge = await startBridge({ port: 0, staticDir, stateDir, ...extra });
  const host = `127.0.0.1:${bridge.port}`;
  return {
    bridge,
    dir,
    stateDir,
    host,
    origin: `http://${host}`,
    close: async () => {
      await bridge.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface Res {
  status: number;
  body: any;
  headers: Record<string, string | string[] | undefined>;
}

export function http(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers, setHost: !("host" in headers) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* JSON でない */
        }
        resolve({ status: res.statusCode ?? 0, body: parsed, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** タブのふりをする WebSocket。届いたイベントを順に貯める。 */
export class FakeTab {
  readonly ws: WebSocket;
  readonly events: { type: string; data: any }[] = [];
  closeCode: number | null = null;
  private waiters: (() => void)[] = [];
  readonly opened: Promise<void>;
  readonly closed: Promise<number>;
  autoPong = true;

  constructor(url: string, origin: string | undefined, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { ...(origin ? { origin } : {}), headers });
    this.opened = new Promise((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("unexpected-response", (_req, r) => rej(new Error(`refused ${r.statusCode}`)));
      this.ws.once("error", rej);
    });
    this.closed = new Promise((res) => this.ws.once("close", (code) => res((this.closeCode = code))));
    this.ws.on("message", (raw) => {
      const ev = JSON.parse(raw.toString("utf8"));
      this.events.push(ev);
      if (ev.type === "bridge.ping" && this.autoPong) this.send("tab.pong", { at: ev.data.at });
      for (const w of this.waiters.splice(0)) w();
    });
  }

  send<T extends TabToBridge>(type: T, data: EventData<T>): void {
    this.ws.send(encodeEvent(type, data));
  }

  async next(type: string, timeoutMs = 3000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.events.find((e) => e.type === type);
      if (hit) {
        this.events.splice(this.events.indexOf(hit), 1);
        return hit.data;
      }
      if (Date.now() > deadline) throw new Error(`届かない: ${type}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
}

/** 正しい形のタブの秘密（43 文字） */
export const SECRET_A = "A".repeat(43);
export const SECRET_B = "B".repeat(43);
