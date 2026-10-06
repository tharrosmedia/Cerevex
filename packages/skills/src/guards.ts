/**
 * Shared claims-check and no-slop-copy guards for slice 1.
 * Deterministic checks from the pinned skills. A fail blocks Approve.
 * This is not a model call and it is not legal clearance.
 */

import type { NormalizedRecommendation } from "./recommendation";

export interface GuardResult {
  claimsCheck: string;
  noSlop: string;
  issues: string[];
}

const OTHER_BRANDS = [
  "carrier",
  "bryant",
  "goodman",
  "daikin",
  "mitsubishi",
  "rheem",
  "york",
  "amana",
  "bosch",
  "american standard",
];

const SLOP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bdelve\b/i, label: "delve" },
  { pattern: /\bleverage\b/i, label: "leverage" },
  { pattern: /\bunlock\b/i, label: "unlock" },
  { pattern: /\bcutting-edge\b/i, label: "cutting-edge" },
  { pattern: /\bseamless\b/i, label: "seamless" },
  { pattern: /\btapestry\b/i, label: "tapestry" },
  { pattern: /\bholistic\b/i, label: "holistic" },
  { pattern: /\belevate your\b/i, label: "elevate your" },
  { pattern: /\bit'?s not just\b/i, label: "it's not just" },
  { pattern: /\bhere'?s the thing\b/i, label: "here's the thing" },
  { pattern: /\blet me be clear\b/i, label: "let me be clear" },
  { pattern: /\bwhat nobody tells you\b/i, label: "what nobody tells you" },
  { pattern: /\bin today'?s\b/i, label: "in today's" },
  { pattern: /\brobust solution\b/i, label: "robust solution" },
  { pattern: /\bgame[- ]changer\b/i, label: "game changer" },
];

const CLIENT_NAMES = ["hvac usa", "got ductless", "kc prestige", "elmar hvac", "elmar"];

export function runRecGuards(
  record: NormalizedRecommendation,
  client: { slug: string; forbidClientNamesAndResults?: boolean },
): GuardResult {
  const copy = [record.why_plain, record.change?.from, record.change?.to].filter((part): part is string => Boolean(part && part.trim()));
  const text = copy.join("\n");
  const issues: string[] = [];
  const claims = claimIssues(text, client);
  issues.push(...claims);
  const slop = slopIssues(record.why_plain ?? "");
  issues.push(...slop);
  const claimsCheck = claims.length === 0 ? (copy.length === 0 ? "n/a" : "pass") : `fail: ${claims.join("; ")}`;
  const noSlop = slop.length === 0 ? "pass" : `fail: ${slop.join("; ")}`;
  return { claimsCheck, noSlop, issues };
}

function claimIssues(text: string, client: { slug: string; forbidClientNamesAndResults?: boolean }): string[] {
  if (text.trim().length === 0) return [];
  const issues: string[] = [];
  const lower = text.toLowerCase();
  if (client.slug === "hvac-usa") {
    if (/\bcage\b/i.test(text)) issues.push("HVAC USA has no Cage number");
    if (lower.includes("local-ductless-stores")) issues.push("/pages/local-ductless-stores is Got Ductless only");
    if (/deereco|timonium|lutherville|baltimore showroom/i.test(text)) {
      issues.push("Maryland showroom addresses belong to Got Ductless");
    }
    if (/showroom|come visit|customer visits/i.test(text)) {
      issues.push("HVAC USA has no confirmed customer-visit location");
    }
    for (const brand of OTHER_BRANDS) {
      if (lower.includes(brand)) issues.push(`do not name ${brand} as a carried brand`);
    }
    if (/\b25c\b|tax credit|federal tax/i.test(text)) issues.push("no 25C or federal tax-credit claim");
    if (/\$\s?\d/.test(text) && !/confirm with owner|map\/upp|source:/i.test(text)) {
      issues.push("price needs a source and the current MAP policy");
    }
  }
  if (/\b#\s*1\b|number one|guaranteed (results|leads)|best in (the )?(city|class|industry)/i.test(text)) {
    issues.push("unsupported superlative or guaranteed-results claim");
  }
  if (client.forbidClientNamesAndResults || client.slug === "tharros-media" || client.slug === "cerevex") {
    for (const name of CLIENT_NAMES) {
      if (lower.includes(name)) issues.push(`Tharros and Cerevex marketing cannot name ${name}`);
    }
  }
  return issues;
}

function slopIssues(whyPlain: string): string[] {
  const text = whyPlain.trim();
  if (text.length === 0) return [];
  const issues: string[] = [];
  const sentences = text.split(/[.!?]+/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (sentences.length > 2) issues.push("why_plain is more than two sentences");
  for (const pattern of SLOP_PATTERNS) {
    if (pattern.pattern.test(text)) issues.push(`no-slop pattern: ${pattern.label}`);
  }
  return issues;
}

const SPEND_INCREASE =
  /\b(increase|raise|scale|higher|more)\b[^.]{0,48}\b(spend|budget|bid)s?\b|\b(spend|budget|bid)s?\b[^.]{0,48}\b(increase|raise|up|higher)\b/i;

export function isSpendIncrease(record: Pick<NormalizedRecommendation, "change">): boolean {
  return SPEND_INCREASE.test(record.change?.to ?? "");
}

/**
 * conversion-tracking-audit has not run for any store in slice 1.
 * A requires entry that names it is unmet even when the record says :pass.
 */
export function unmetRequires(requires: string[] | undefined): string | null {
  if (!requires || requires.length === 0) return null;
  for (const gate of requires) {
    if (/conversion-tracking-audit/i.test(gate)) {
      return "conversion-tracking-audit has not been run";
    }
    if (!/:pass\b/i.test(gate)) return `gate not passed: ${gate}`;
  }
  return null;
}

export function capacityBlocksSpend(record: Pick<NormalizedRecommendation, "capacity_check" | "change">): string | null {
  if (!isSpendIncrease(record)) return null;
  const check = record.capacity_check?.trim() ?? "";
  if (/^pass:/i.test(check)) return null;
  if (check.length === 0) return "spend increase needs capacity_check";
  return `capacity_check is not a pass (${check})`;
}
