// 【業種】（設定からのリンク。docs/plan.md §2.7・docs/screens.md 3.7）：設備の地図の群（A〜H）ごとに、設備の種類のパックを並べる。
// 数は packs/ から数える。中身のあるパックには印、空のパックを選ぶと「まだ中身がありません」と出どころの候補を出す。作らない行は名前と理由だけ。
// 説明の文は置かない。名前・群の名前・作らない理由・出どころの候補は、すべてパックと packs/_kinds/ から読む。
import { Container, Group, Stack, Text, Title } from "@mantine/core";
import { useMemo, useState } from "react";
import { industryMap } from "../industries";
import type { MapRow } from "../../shared/pack";
import { TEXT } from "../text";

const T = TEXT.industries;

function Detail({ row }: { row: MapRow }) {
  return (
    <div className="moyai-industry-detail" data-testid={`industry-detail-${row.id}`}>
      {row.kind === "empty" && (
        <Text size="sm">
          {T.emptyLine}
          {T.candidates}
          {row.sourceCandidates.map((c, i) => (
            <span key={i}>
              {i > 0 && "、"}
              {T.candidate(c.title, c.issuer)}
              {c.scope === "group" && <span className="moyai-industry-dim">{T.groupScope}</span>}
            </span>
          ))}
        </Text>
      )}
      <Text size="xs" className="moyai-industry-dim">
        {T.verification}　{row.verification}
      </Text>
    </div>
  );
}

export function Industries() {
  const map = useMemo(() => industryMap(), []);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Container size="lg" py="lg" data-testid="industries-page">
      <Group gap="sm" align="baseline" mb="md">
        <Title order={2}>{T.title}</Title>
        <Text className="moyai-num moyai-industry-dim" data-testid="industries-total">
          {T.count(map.total)}
        </Text>
      </Group>
      <Stack gap="lg">
        {map.invalid.map((x) => (
          <Text key={x.folder} size="sm" data-testid="industries-invalid">
            × {T.invalid(x.folder)}
          </Text>
        ))}
        {map.groups.map((g) => (
          <section key={g.id} className="moyai-industry-group" data-testid={`industry-group-${g.id}`}>
            <Group gap="sm" align="baseline" className="moyai-industry-head">
              <Text className="moyai-num" fw={500}>
                {g.id}
              </Text>
              <Text fw={500}>{g.name}</Text>
              <Text size="xs" className="moyai-num moyai-industry-dim" data-testid={`industry-count-${g.id}`}>
                {T.count(g.rows.length)}
              </Text>
            </Group>
            <ul className="moyai-industry-list">
              {g.rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="moyai-industry-row"
                    aria-expanded={selected === r.id}
                    data-kind={r.kind}
                    data-testid={`industry-${r.id}`}
                    onClick={() => setSelected((cur) => (cur === r.id ? null : r.id))}
                  >
                    <span>{r.name}</span>
                    <span className="moyai-industry-mark">{r.kind === "content" ? `✓ ${T.filled}` : T.empty}</span>
                  </button>
                  {selected === r.id && <Detail row={r} />}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {map.notBuilt.length > 0 && (
          <section className="moyai-industry-group" data-testid="industry-group-notbuilt">
            <Group gap="sm" align="baseline" className="moyai-industry-head">
              <Text fw={500}>{T.notBuilt}</Text>
            </Group>
            <ul className="moyai-industry-list">
              {map.notBuilt.map((r) => (
                <li key={r.id} className="moyai-industry-row" data-kind="notBuilt" data-testid={`industry-${r.id}`}>
                  <span>{r.name}</span>
                  <span className="moyai-industry-mark">{r.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Stack>
    </Container>
  );
}
