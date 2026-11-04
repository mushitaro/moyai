// EXPORT（docs/screens.md 3.5）：確定した版から、人が見る様式の Excel（MOYAI の標準）を落とす。差分レポートも副のボタンで落とす。
// Excel は確定のときに橋渡しが保管先に書いたもの（plans/<計画ID>/exports・reports）で、人だけの経路 plan_file_read で読んでブラウザに落とす。
// 署名と鎖が合わない版の Excel は渡さない。様式に写す（別の様式を落とす）は P2 で、作るまで置かない。
import { Alert, Button, Container, Group, Stack, Table, Text, Title } from "@mantine/core";
import { useMemo, useState } from "react";
import { buildChart } from "../../plan/chart";
import type { Plan } from "../../shared/plan";
import { ROUTES } from "../../shared/routes";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { formatCell } from "../chart/grid";
import { FictionMark } from "../components/FictionMark";
import { readHuman, usePlanStatus } from "../components/ConfirmDialog";
import { useConnection } from "../state/bridge";
import { useWorkingPlan } from "../state/plan-store";
import { sheetHash } from "../stages";
import { TEXT } from "../text";

const T = TEXT.export;
const C = TEXT.chart;
const SAMPLE_ROWS = 12;
const SAMPLE_YEARS = 6;

function download(base64: string, name: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 中身の見本：確定した版の台帳の段の行の先頭と、終わりの年度 */
function Sample({ plan }: { plan: Plan }) {
  const model = useMemo(() => {
    const catalog = catalogFor(plan.packId) ?? emptyCatalog();
    return buildChart(plan, catalog, { levelFallback: C.levelFallback, commonLevels: C.commonLevels, unmapped: C.unmapped, series: C.series }, { mode: "ledger", period: "year", layer: "original", foldLevel: null });
  }, [plan]);
  const periods = model.periods.slice(-SAMPLE_YEARS);
  return (
    <Table withTableBorder className="moyai-num" data-testid="export-sample">
      <Table.Thead>
        <Table.Tr>
          {model.levelNames.map((n) => (
            <Table.Th key={n}>{n}</Table.Th>
          ))}
          {periods.map((p) => (
            <Table.Th key={p.key}>{T.fiscal(p.fiscalYear)}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {model.rows.slice(0, SAMPLE_ROWS).map((r) => (
          <Table.Tr key={r.id}>
            {r.levelCells.map((c, i) => (
              <Table.Td key={i}>{c}</Table.Td>
            ))}
            {periods.map((p) => (
              <Table.Td key={p.key}>{formatCell(r.cells[p.key])}</Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function Export() {
  const { client, state } = useConnection();
  const working = useWorkingPlan();
  const planId = working?.plan.planId ?? "";
  const [load] = usePlanStatus(client, planId, !!working && state.kind === "open");
  const [busy, setBusy] = useState<"export" | "report" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = load.kind === "ready" ? load.status : null;
  const latest = status?.latest ?? null;
  const info = status?.versions?.find((v) => v.version === latest?.version) ?? null;
  const broken = !!info && info.problem !== null;
  const blocked = state.kind !== "open" ? T.notConnected : !working ? T.noPlan : status && !latest ? T.notConfirmed : broken ? T.broken : null;

  const get = async (kind: "export" | "report") => {
    if (!latest || blocked) return;
    setBusy(kind);
    setError(null);
    const r = readHuman<{ ok: boolean; reason?: string; base64: string }>(await client.callHuman("plan_file_read", ROUTES.planFileRead.path, { planId, version: latest.version, kind }));
    setBusy(null);
    if (!r.ok) return setError(r.message);
    download(r.body.base64, kind === "export" ? T.fileName(latest.plan.displayName, latest.version) : T.reportName(latest.plan.displayName, latest.version));
  };

  return (
    <Container fluid py="md" px="lg" data-testid="export-page">
      <Group justify="space-between" align="center" mb="md" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <Title order={2}>{T.title}</Title>
          {latest && (
            <Text fw={700} data-testid="export-plan">
              {latest.plan.displayName}　{T.version(latest.version)}
            </Text>
          )}
          {latest?.plan.facility.fictional && <FictionMark />}
        </Group>
        <Group gap="sm" wrap="nowrap">
          {blocked && (
            <Text size="xs" c="dimmed" data-testid="export-blocked">
              {blocked}
            </Text>
          )}
          <Button variant="default" onClick={() => void get("report")} disabled={!!blocked || !latest} loading={busy === "report"} data-testid="export-report">
            {T.report}
          </Button>
          <Button onClick={() => void get("export")} disabled={!!blocked || !latest} loading={busy === "export"} data-testid="export-excel">
            {T.excel}
          </Button>
        </Group>
      </Group>
      <Stack gap="md">
        <Text size="sm" data-testid="export-format">
          {T.format}
        </Text>
        <Text size="xs" c="dimmed">
          {T.lead}
        </Text>
        {error && (
          <Alert color="gray" data-testid="export-error">
            {error}
          </Alert>
        )}
        {!working && (
          <Text size="sm">
            {T.noPlan} <a href={sheetHash("files")}>{T.toMerge}</a>
          </Text>
        )}
        {latest && <Sample plan={latest.plan} />}
      </Stack>
    </Container>
  );
}
