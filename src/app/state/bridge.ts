// このタブの橋渡しとの接続（タブの秘密を持つ接続は、このタブで 1 つだけ）と、そのつながりの状態。
import { useEffect, useState } from "react";
import { BridgeClient, type ConnectionState } from "../bridge-client";

let client: BridgeClient | null = null;

/** 接続を 1 つだけ作って返す（最初に呼んだときにつなぐ） */
export function bridgeClient(): BridgeClient {
  if (!client) {
    client = new BridgeClient(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    client.connect();
  }
  return client;
}

export function useConnection(): { client: BridgeClient; state: ConnectionState; dropped: number } {
  const c = bridgeClient();
  const [v, setV] = useState<{ state: ConnectionState; dropped: number }>({ state: { kind: "connecting" }, dropped: 0 });
  useEffect(() => c.subscribe((state, dropped) => setV({ state, dropped })), [c]);
  return { client: c, ...v };
}
