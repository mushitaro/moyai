// MOYAI（トップ。docs/screens.md 3.1、絵は Main.dc.html）：もやいの星取表で、どの施設のどの版から始めるかを選ぶ。主ボタンは無い。
// 左 32px から始める（中央に寄せない）。「Claude に話す」の例は状態の帯（Shell）。橋渡しに断られた・切れたときだけ、上に知らせを出す。
// 開発の道具（確定の試し・前の画面への道・Ed25519 の試験のページ）は、設定の画面の下（components/DevTools.tsx）。
import { Alert, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import type { BridgeClient, ConnectionState } from "../bridge-client";
import { ERROR_TEXT, TEXT } from "../text";
import { MoyaiTop } from "../components/MoyaiTop";

function useConnection(client: BridgeClient): { state: ConnectionState; dropped: number } {
  const [v, setV] = useState<{ state: ConnectionState; dropped: number }>({ state: { kind: "connecting" }, dropped: 0 });
  useEffect(() => client.subscribe((state, dropped) => setV({ state, dropped })), [client]);
  return v;
}

export function Home({ client }: { client: BridgeClient }) {
  const { state, dropped } = useConnection(client);

  return (
    <div className="moyai-top-page">
      <div className="moyai-top-body">
        {state.kind === "refused" && (
          <Alert color="red" title={TEXT.connection.refused} data-testid="refused" mx={32} mt="md">
            {ERROR_TEXT[state.code]} {TEXT.connection.refusedHelp}
          </Alert>
        )}
        {state.kind === "closed" && (
          <Alert color="orange" title={TEXT.connection.closed} mx={32} mt="md">
            {TEXT.connection.closedHelp}
          </Alert>
        )}
        {dropped > 0 && (
          <Text size="sm" c="dimmed" mx={32} mt="md" data-testid="dropped">
            {TEXT.connection.dropped(dropped)}
          </Text>
        )}
        <MoyaiTop client={client} />
      </div>
    </div>
  );
}
