import type { Fact, FactState } from "./types";

/** Brief §8.2 H. Flag verified-fact and pack rows older than this. */
export const STALENESS_WINDOW_DAYS = 90;

export interface DatedRow {
  fact: string;
  verifyAsOf: string;
  source: string;
}

export function daysBetween(earlierIso: string, laterIso: string): number {
  const earlier = Date.parse(`${earlierIso.slice(0, 10)}T00:00:00Z`);
  const later = Date.parse(`${laterIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(earlier) || Number.isNaN(later)) {
    throw new Error(`Cannot compare dates ${earlierIso} and ${laterIso}`);
  }
  return Math.round((later - earlier) / 86_400_000);
}

export function isMarkedVerify(verifyAsOf: string): boolean {
  return /\bnot re-verified\b|\bverify\b/i.test(verifyAsOf) && !/^\d{4}-\d{2}-\d{2}$/.test(verifyAsOf.trim());
}

/**
 * A dated row is known only inside the staleness window.
 * Rows marked verify, and rows older than the window, are assumptions until checked.
 */
export function classifyDatedRow(row: DatedRow, asOf: string, windowDays = STALENESS_WINDOW_DAYS): Fact<string> {
  const verifyAsOf = row.verifyAsOf.trim();
  if (isMarkedVerify(verifyAsOf) || !/^\d{4}-\d{2}-\d{2}/.test(verifyAsOf)) {
    return {
      state: "assumption",
      value: row.fact,
      source: row.source,
      asOf: verifyAsOf,
      raw: `${row.fact} | ${verifyAsOf} | ${row.source}`,
    };
  }
  const age = daysBetween(verifyAsOf.slice(0, 10), asOf.slice(0, 10));
  const state: FactState = age > windowDays ? "assumption" : "known";
  return {
    state,
    value: row.fact,
    source: row.source,
    asOf: verifyAsOf.slice(0, 10),
    raw: `${row.fact} | ${verifyAsOf} | ${row.source}`,
  };
}

export function parseVerifiedFactRows(markdown: string): DatedRow[] {
  const rows: DatedRow[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 3) continue;
    if (cells.every((cell) => /^[-:\s]+$/.test(cell))) continue;
    if (/^fact$/i.test(cells[0]) && /verify/i.test(cells[1])) continue;
    rows.push({ fact: cells[0], verifyAsOf: cells[1], source: cells[2] });
  }
  return rows;
}
