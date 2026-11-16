// The public ledger site (static GitHub Pages page) in English. The Japanese table in ../site.ts must have the same shape.
// The ledger during the event has only fictional facilities, so every page shows [Fictional].

const n = (v: number) => v.toLocaleString("en-US");

export const EN_SITE_TEXT = {
  title: "[Fictional] MOYAI public ledger",
  fiction: "[Fictional] All facilities and numbers on this page are fictional (the public ledger during the event has only fictional facilities).",
  lead:
    "Shared files sent to the public ledger, verified again, with the Maintenance schedule (Hoshitori) and statistics rows of similar facilities. The only shared values are the fiscal years of each entry (common equipment item × work type) and the bands for interval, man-days and days. No shared file has costs, people, exact dates or notes.",
  rulesHead: "Ledger rule",
  countsHead: "Shared files checked",
  sectionsHead: "Hoshitori and statistics rows of similar facilities",
  ledgerId: "Ledger ID",
  version: "Rule version",
  month: "Rule month",
  hash: "SHA-256 of ledger.json",
  founder: "Administrator key ID",
  status: "Rule check",
  minK: "Minimum facilities in the same category",
  fields: "Fields copied (per entry)",
  bands: "Band boundaries",
  pack: "Skill pack",
  vocab: "SHA-256 of the public vocabulary",
  national: "SHA-256 of the national list",
  withheld: "Fields not shown in the public ledger",
  withheldText:
    "Major upgrade entries, and facilities not on the national list. Years in service are never shown in the shared folder or the public ledger (with the fiscal year they reveal the start year; fixed in code, cannot be added by a rule)",
  ok: "✓",
  ng: "✗",
  okCount: (k: number) => `✓ ${n(k)}`,
  ngCount: (k: number) => `✗ ${n(k)}`,
  keys: (k: number) => `Keys ${n(k)} (the latest ✓ shared file per key is counted)`,
  others: (k: number) => `Files outside the allowed forms ${n(k)}`,
  /** Keys with a ✓ revocation record (not counted in k or the totals) */
  retired: (k: number) => `Revoked keys ${n(k)} (not counted)`,
  ngHead: "✗ shared files and reasons (not counted)",
  noBundles: "No shared files checked as ✓ yet.",
  profileHead: (k: number) => `Profile ${k}`,
  group: { NATIONAL: "Facilities on the national list", OUTSIDE: "Facilities not on the national list" } as Record<string, string>,
  stage: (s: number) => `Aggregation level ${s}`,
  similar: (k: number) => `Similar facilities ${n(k)}`,
  belowFive: "Fewer than 5 facilities match these conditions.",
  colClass: "Common equipment item",
  colWork: "Work type",
  colLabel: "Facility (anonymous label)",
  colInterval: "Interval",
  colManDays: "Man-days",
  colDays: "Days",
  done: "●",
  statRow: (k: number) => `Statistics row (facilities with this entry ${n(k)})`,
  statX: "x",
  /** "Range 2–5 yr, n 3" */
  statRange: (span: string, k: number) => `Range ${span}, n ${n(k)}`,
  /** "Median 3 yr (quartiles 2–5 yr), n 6". quartile is null when the quartiles equal the median */
  statMedian: (med: string, quartile: string | null, k: number) =>
    quartile === null ? `Median ${med} (quartiles the same), n ${n(k)}` : `Median ${med} (quartiles ${quartile}), n ${n(k)}`,
  statNote:
    "n in a statistics row is the number of facilities with that field. n 0–2 shows x, 3–4 shows the range and n, 5 or more shows the median, quartiles and n (nearest rank on the band order). Groups are not counted together.",
  labelNote: "Labels are made from the start of the key ID. The same key keeps the same label as its shared files increase.",
  footer: (build: string) => `This page was made by the MOYAI ledger site, which verified the ledger's shared files again with the same functions as the receiver (raw files are not copied). ${build}`,
  bandUnit: { I: "yr", W: "man-days", D: "days" } as Record<string, string>,
  bandAtLeast: (a: string, unit: string) => `${a} ${unit} or more`,
  bandRange: (a: string, b: string, unit: string) => (a === b ? `${a} ${unit}` : `${a}–${b} ${unit}`),
  axisBelow: (a: string, unit: string) => `Under ${a} ${unit}`,
  axisRange: (a: string, b: string, unit: string) => `${a} ${unit} to under ${b} ${unit}`,
  axisAtLeast: (a: string, unit: string) => `${a} ${unit} or more`,
};
