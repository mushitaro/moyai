// 施設の設定（Wire の決定 2026-11-04：見え方の答えは施設の性質なので、ここ 1 か所に置き、星取表や SHARE では答えない）。
// 全国の表に載る施設かと、見え方の軸（炉の型・処理能力の帯…）の答えを、作業中の計画の施設の欄に置く。次の版に署名すると版に残る。
// 軸の名前と選べる値は、橋渡しが全国の表から作る（SHARE と同じ問い）。規模から読める帯は見込みとして先に選んでおき、人が決める。
import { Button, Group, Modal, NativeSelect, SimpleGrid, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import type { Plan } from "../../shared/plan";
import { ROUTES } from "../../shared/routes";
import { useConnection } from "../state/bridge";
import { setFacilityDialog, useFacilityDialog } from "../state/facility-dialog";
import { getWorkingPlan, updateWorkingPlan } from "../state/plan-store";
import { TEXT } from "../text";
import { readHuman } from "./ConfirmDialog";

const F = TEXT.facility;

interface Question {
  key: string;
  name: string;
  codes: { code: string; name: string }[];
  suggested: string | null;
}

export function FacilityDialog({ plan, readOnly }: { plan: Plan; readOnly: boolean }) {
  const opened = useFacilityDialog();
  const { client, state } = useConnection();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [national, setNational] = useState<boolean | null>(plan.facility.inNationalTable);
  const [profile, setProfile] = useState<Record<string, string>>(plan.facility.profile ?? {});

  // 開くたびに、計画の今の答えから始め、問い（軸と値）を橋渡しから読む
  useEffect(() => {
    if (!opened) return;
    setNational(plan.facility.inNationalTable);
    setProfile(plan.facility.profile ?? {});
    if (state.kind !== "open") return;
    void (async () => {
      const r = readHuman<{ ok: boolean; reason?: string; questions: Question[] }>(
        await client.callHuman("peers_compare", ROUTES.peersCompare.path, {
          packId: plan.packId,
          position: "municipal",
          axes: null,
          answers: { facility: {}, inNationalTable: null },
          target: null,
          facility: { scale: plan.facility.scale, scaleUnit: plan.facility.scaleUnit },
        }),
      );
      if (!r.ok) return setError(r.message);
      setError(null);
      setQuestions(r.body.questions);
      // 規模から読める帯は見込みとして先に選ぶ（まだ答えていない軸だけ。人が直せる）
      const pre: Record<string, string> = {};
      for (const q of r.body.questions) if (q.suggested && !(plan.facility.profile ?? {})[q.key]) pre[q.key] = q.suggested;
      if (Object.keys(pre).length > 0) setProfile((p) => ({ ...pre, ...p }));
    })();
  }, [opened, client, state.kind, plan]);

  const save = () => {
    const w = getWorkingPlan();
    if (!w) return;
    const clean = Object.fromEntries(Object.entries(profile).filter(([, v]) => v));
    updateWorkingPlan({ ...w.plan, facility: { ...w.plan.facility, inNationalTable: national, profile: clean } }, w.proposals);
    setFacilityDialog(false);
  };

  return (
    <Modal opened={opened} onClose={() => setFacilityDialog(false)} title={F.title} size="xl" centered data-testid="facility-dialog">
      <Stack gap="md">
        <Text size="xs" c="dimmed" style={{ letterSpacing: "0.1em" }}>
          {F.profile}
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" verticalSpacing="sm">
          <NativeSelect
            size="xs"
            label={F.national}
            value={national === null ? "" : national ? "yes" : "no"}
            onChange={(e) => setNational(e.currentTarget.value === "" ? null : e.currentTarget.value === "yes")}
            data={[
              { value: "", label: F.choose },
              { value: "yes", label: F.yes },
              { value: "no", label: F.no },
            ]}
            disabled={readOnly}
            data-testid="facility-national"
          />
          {(questions ?? []).map((q) => (
            <NativeSelect
              key={q.key}
              size="xs"
              label={q.name}
              value={profile[q.key] ?? ""}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setProfile((p) => ({ ...p, [q.key]: v }));
              }}
              data={[{ value: "", label: F.choose }, ...q.codes.map((c) => ({ value: c.code, label: c.name }))]}
              disabled={readOnly}
              data-testid={`facility-${q.key}`}
            />
          ))}
        </SimpleGrid>
        {error && (
          <Text size="sm" c="var(--shu-text)">
            {error}
          </Text>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={() => setFacilityDialog(false)}>
            {F.cancel}
          </Button>
          {!readOnly && (
            <Button onClick={save} data-testid="facility-save">
              {F.save}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
