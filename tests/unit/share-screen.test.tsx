// SHARE の引き算（2026-11-10。運営者「足すのではなく引く。画面を人に操作させない。結果を見せて、ボタンを 1 つ押させる」）：
// - 見え方の答えは画面で選ばない（q-* の選びが無い）。Claude が置いた答えなら「- Claude の入力」、足りなければ朱で「見え方 未確定 n（軸）」だけ
// - Claude の answers は、このタブの SHARE の今の選びになるだけ（作業画面の途中の中身に署名・送る欄は無い。tests/unit/share-preview.test.ts）
// 計画はすべて架空。
import { MantineProvider } from "@mantine/core";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { YouProfile } from "../../src/app/pages/Checkpoint";
import { HUMAN_TEXT } from "../../src/app/text/human";

const T = HUMAN_TEXT.checkpoint;
const html = (node: ReactNode) => renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);

describe("SHARE の見え方の 1 行", () => {
  it("答えがそろえば「施設 ― …　同区分の施設 m（全国 n）」。Claude が置いた答えなら「- Claude の入力」", () => {
    const out = html(<YouProfile undetermined={null} profile={T.profileLine("ストーカ炉、100〜200t/日")} k={{ k: 38, minK: 5, all: 844 }} loading={false} ai />);
    expect(out).toContain("施設 ― ストーカ炉、100〜200t/日、所在");
    expect(out).toContain("同区分の施設 38（全国 844）");
    expect(out).toContain('data-testid="ai-answers-mark"');
    expect(out).toContain("- Claude の入力");
    // 人だけの答え（Claude が置いていない）なら印は無い
    const human = html(<YouProfile undetermined={null} profile={T.profileLine("ストーカ炉")} k={{ k: 38, minK: 5, all: null }} loading={false} ai={false} />);
    expect(human).not.toContain("ai-answers-mark");
    expect(human).toContain("同区分の施設 38<");
  });

  it("答えが足りなければ、朱の「施設 ― 見え方 未確定 n（軸）」だけで、選びも入力も無い", () => {
    const out = html(<YouProfile undetermined={["全国の表に載る施設か", "炉の形式"]} profile={null} k={null} loading={false} ai={false} />);
    expect(out).toContain("施設 ― 見え方 未確定 2（全国の表に載る施設か・炉の形式）");
    expect(out).toContain('data-state="undetermined"');
    expect(out).not.toMatch(/<select|<input|同区分の施設/);
  });

  it("SHARE の画面に見え方の選び（q-*）・常に出す GitHub につなぐ・OneDrive の知らせ・鍵の置き場所の文が無い。押せない理由は今の字のまま", () => {
    const src = readFileSync("src/app/pages/Checkpoint.tsx", "utf8");
    expect(src).not.toMatch(/data-testid=\{`q-/);
    expect(src).not.toContain('"q-national"');
    expect(src).not.toContain("SyncedNotice");
    expect(src).not.toContain("keyInPlan");
    expect(src).not.toContain("ring-folder-path");
    // GitHub につなぐのは押せない理由「GitHub　未接続」の右だけ
    expect(src.match(/data-testid="github-open"/g)).toHaveLength(1);
    expect(src).toMatch(/sendReason === T\.sendNeeds\.noKey[^\n]*\n[^\n]*data-testid="github-open"/);
    expect(T.sendNeeds.groupUnknown).toBe("全国の表に載る施設かが未確定");
    expect(T.sendNeeds.profileIncomplete).toBe("施設の見え方が未確定");
    expect(T.sendNeeds.sent).toBe("送信済み");
  });
});
