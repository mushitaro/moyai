// 実績の追加の案の詳しくに出す参考（Architect の 71・Wire、11-06 夜）：根拠ではなく参考。1 行目「参考　同じ機器の 2024 年度の実績 1（作業明細 3）」、
// その下に作業ごとの「火格子交換　作業明細 3」を 3 つまで、残りは「ほか n」。確定のシートの詳しくと、星取表の詳しくの「理由」の下に置く（text-3）
import { Stack, Text } from "@mantine/core";
import { actualReferenceView } from "../../plan/star";
import type { Plan } from "../../shared/plan";
import { HUMAN_TEXT } from "../text";

const T = HUMAN_TEXT.decisions;

export function StarReference({ plan, workKey, fiscalYear }: { plan: Plan; workKey: string; fiscalYear: number }) {
  const v = actualReferenceView(plan, workKey, fiscalYear);
  if (!v) return null;
  return (
    <Stack gap={0} data-testid="star-reference">
      <Text size="xs" c="var(--text-3)" className="moyai-num">
        {v.head}
      </Text>
      {v.items.map((x) => (
        <Text key={x.name} size="xs" c="var(--text-3)" className="moyai-num" data-testid="star-reference-item">
          {T.starRefItem(x.name, x.lines)}
        </Text>
      ))}
      {v.more > 0 && (
        <Text size="xs" c="var(--text-3)" className="moyai-num">
          {T.more(v.more)}
        </Text>
      )}
    </Stack>
  );
}
