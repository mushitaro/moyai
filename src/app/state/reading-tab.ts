// MERGE の「読み方」のタブのデータ（docs/plan.md §2.17。形は Wire のキャンバスの Reading.dc.html）。
// 読み方（3 段目の Skill）ごとの見出しの行と、1 規則 1 行。並べる順は効く順（施設 → 担当 → 会社）。1・2 段は編集できないので並べない。
// 前の版からの差は、同じ名前の承認済みの読み方と比べる（無ければ、どの規則も「足した」）。
// 規則を変えて前の版で承認済みのセルが変わる数は、版どうしのセルの差が要るので、まだ出さない（null）。
import type { Analysis } from "../../import";
import type { LoadedReading, PlanCycleRule, ReadingRule, ReadingScope } from "../../import/reading";
import { activeRules, isPlanRule, shortVersion } from "../../import/reading";

export interface ReadingTabRule {
  id: string;
  /** 決まり（人の言葉の 1 文） */
  text: string;
  /** 効く資料（資料の名前の型と見出しの文字。無ければ「どの資料にも」） */
  appliesTo: string | null;
  /** 件数：読み方の決まりは効いたセル、計画ルールは作業中の計画に出した周期の案の印 */
  hits: number;
  /** 件数の単位（「セル 42」「印 18」。Wire、11-06） */
  unit: "cell" | "mark";
  /** 計画ルールだけ：項目と属性は当たるが、紐付けをまだ人が確定していない作業の数（確定するまで案を出さない） */
  waiting: number;
  /** 決めた人：「Claude（会話で決めた）」か、人の呼び名 */
  decidedBy: { kind: "ai" } | { kind: "human"; name: string | null };
  /** 前の版から：足した・変えた・変わらない */
  change: "added" | "changed" | "same";
  /** 規則で変わる承認済みのセルの数（まだ数えない） */
  approvedCellsChanged: number | null;
  /** 見本：資料と、セルの番地（D88）と、そのセルの文字 */
  sample: { file: string; ref: string; text: string } | null;
}

export interface ReadingTabSkill {
  name: string;
  scope: ReadingScope;
  /** 版（4 文字 × 2 組）。下書きは「―」 */
  version: string;
  status: "draft" | "unapproved" | "approved";
  /** 承認した星取表の版の番号（「承認済み（第 n 版で）」）。承認済みでなければ null */
  approvedIn: number | null;
  rules: ReadingTabRule[];
}

const sameRule = (a: ReadingRule, b: ReadingRule) => JSON.stringify(a) === JSON.stringify(b);

function appliesTo(r: ReadingRule): string | null {
  // 計画ルールは資料でなく計画に効く（元の資料の欄は「計画」）
  if (isPlanRule(r)) return "計画";
  const parts = [r.when?.file ? `資料「${r.when.file}」` : null, r.when?.headers?.length ? `見出しに「${r.when.headers.join("」「")}」` : null].filter((x): x is string => !!x);
  return parts.length ? parts.join("・") : null;
}

/** タブのデータ。readings：作業画面が当てている読み方。an：その読み方で読んだ結果。planInfo：計画ルールが作業中の計画に出した周期の案の印の数と、紐付けの確定を待つ作業の数 */
export function readingTab(
  readings: readonly LoadedReading[],
  an: Pick<Analysis, "ruleHits" | "sources">,
  planInfo: (name: string, rule: PlanCycleRule) => { marks: number; waiting: number } = () => ({ marks: 0, waiting: 0 }),
): { skills: ReadingTabSkill[]; unapproved: number } {
  const order = activeRules(readings);
  const names = [...new Set(order.map((a) => a.from.name))];
  const skills: ReadingTabSkill[] = [];
  for (const name of names) {
    const mine = readings.filter((r) => r.skill.name === name);
    const shown = mine.find((r) => r.draft) ?? mine[0];
    if (!shown) continue;
    const approved = mine.find((r) => r.approved && !r.draft) ?? null;
    const status: ReadingTabSkill["status"] = shown.draft ? "draft" : shown.approved ? "approved" : "unapproved";
    skills.push({
      name,
      scope: shown.skill.scope,
      version: shown.draft ? "―" : shortVersion(shown.version),
      status,
      approvedIn: status === "approved" ? (shown.approvedIn ?? null) : null,
      rules: shown.skill.rules.map((r) => {
        const before = approved?.skill.rules.find((x) => x.id === r.id) ?? null;
        const s = an.ruleHits.sample(r.id);
        const cell = s ? an.sources.find((x) => x.file === s.file)?.sheets.flatMap((g) => g.cells).find((c) => c.ref === s.ref) : null;
        return {
          id: r.id,
          text: r.text,
          appliesTo: appliesTo(r),
          hits: isPlanRule(r) ? planInfo(name, r).marks : an.ruleHits.count(r.id),
          unit: isPlanRule(r) ? "mark" : "cell",
          waiting: isPlanRule(r) ? planInfo(name, r).waiting : 0,
          decidedBy: r.author === "ai" ? { kind: "ai" } : { kind: "human", name: r.by ?? null },
          change: !approved || shown === approved ? (approved ? "same" : "added") : !before ? "added" : sameRule(before, r) ? "same" : "changed",
          approvedCellsChanged: null,
          sample: s ? { file: s.file, ref: s.ref, text: cell?.text ?? "" } : null,
        };
      }),
    });
  }
  const unapproved = skills.filter((x) => x.status !== "approved").reduce((n, x) => n + x.rules.filter((r) => r.change !== "same").length, 0);
  return { skills, unapproved };
}
