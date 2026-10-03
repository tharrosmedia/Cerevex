import { DEFAULT_APPROVE_OPERATOR_EMAIL } from "@cerevex/contracts";
import type { Fact, FactState, ResolvedApprovalOwner } from "./types";

const DEFAULT_APPROVAL_OWNER_NAME = "Adam";

export function classifyProfileValue(
  raw: string,
  hints?: { key?: string },
): { state: FactState; value: string | null } {
  const text = raw.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const key = hints?.key?.toLowerCase() ?? "";

  if (!text) return { state: "tbd", value: null };

  if (
    /\binference\b/i.test(text) ||
    key.includes("internal context") ||
    /\bnot a copy claim\b/i.test(text)
  ) {
    return { state: "inference", value: text };
  }

  if (/\bCONFIRM\b|\bunconfirmed\b|\bnot re-verified\b/i.test(text)) {
    return { state: "assumption", value: text };
  }

  if (/^(none\b|n\/a\b|not applicable\b)/i.test(text) && !/\bTBD\b/.test(text)) {
    return { state: "known", value: text };
  }

  if (/\bTBD\b/.test(text)) {
    return { state: "tbd", value: null };
  }

  return { state: "known", value: text };
}

export interface DecomposedValue {
  primary: { state: FactState; value: string | null; raw: string };
  parts: Array<{ label: string; state: FactState; value: string | null; raw: string }>;
}

/**
 * Split a profile clause into a primary fact plus labeled gaps.
 * A bare "(TBD)" marks the whole clause unknown. A specific parenthetical
 * ("pricing TBD") keeps the prefix and records the gap.
 */
export function decomposeProfileValue(raw: string, key?: string): DecomposedValue {
  const clean = raw.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const sentences = clean
    .split(/\.\s+(?=[A-Z])/)
    .map((sentence) => sentence.replace(/\.$/, "").trim())
    .filter(Boolean);
  const clauses = sentences.flatMap((sentence) =>
    sentence
      .split(";")
      .map((clause) => clause.trim())
      .filter(Boolean),
  );

  const parts: DecomposedValue["parts"] = [];
  for (const clause of clauses) {
    const peeled = peelSpecificTbdParenthetical(clause);
    if (peeled) {
      const prefix = classifyProfileValue(peeled.prefix, { key });
      parts.push({
        label: key ?? "value",
        state: prefix.state,
        value: prefix.value,
        raw: peeled.prefix,
      });
      parts.push({
        label: peeled.gap.replace(/\bTBD\b/i, "").replace(/[():]/g, "").trim() || "gap",
        state: "tbd",
        value: null,
        raw: peeled.gap,
      });
      continue;
    }
    const classified = classifyProfileValue(clause, { key });
    parts.push({
      label: clause.replace(/\bTBD\b/i, "").replace(/[():]/g, "").trim() || key || "value",
      state: classified.state,
      value: classified.value,
      raw: clause,
    });
  }

  const known = parts.filter((part) => part.state === "known");
  const assumptions = parts.filter((part) => part.state === "assumption");
  const inferences = parts.filter((part) => part.state === "inference");
  const tbds = parts.filter((part) => part.state === "tbd");

  // "CONFIRM both" covers every clause in the field, so none of them is known yet.
  if (parts.some((part) => /^confirm\b/i.test(part.raw))) {
    return {
      primary: { state: "assumption", value: clean, raw: clean },
      parts,
    };
  }

  let primary: DecomposedValue["primary"];
  if (known.length > 0) {
    primary = { state: "known", value: known.map((part) => part.value).join("; "), raw: clean };
  } else if (inferences.length > 0 && tbds.length === 0) {
    primary = {
      state: "inference",
      value: inferences.map((part) => part.value).join("; "),
      raw: clean,
    };
  } else if (assumptions.length > 0 && tbds.length === 0 && inferences.length === 0) {
    primary = {
      state: "assumption",
      value: assumptions.map((part) => part.value).join("; "),
      raw: clean,
    };
  } else if (inferences.length > 0 && known.length === 0) {
    primary = {
      state: "inference",
      value: inferences.map((part) => part.value).join("; "),
      raw: clean,
    };
  } else {
    primary = { state: "tbd", value: null, raw: clean };
  }

  return { primary, parts };
}

function peelSpecificTbdParenthetical(clause: string): { prefix: string; gap: string } | null {
  const match = clause.match(/^(.*\S)\s*\(([^)]*\bTBD\b[^)]*)\)\s*$/i);
  if (!match) return null;
  const prefix = match[1].trim();
  const gap = match[2].trim();
  if (/\bTBD\b/.test(prefix)) return null;
  if (/^tbd$/i.test(gap)) return null;
  return { prefix, gap };
}

export function makeFact<T extends string>(
  raw: string,
  source: string | null,
  asOf: string | null,
  key?: string,
): Fact<T> {
  const classified = classifyProfileValue(raw, { key });
  return {
    state: classified.state,
    value: classified.value as T | null,
    source: classified.state === "tbd" ? null : source,
    asOf: classified.state === "tbd" ? null : asOf,
    raw,
  };
}

export function factFromDecomposed(
  raw: string,
  source: string | null,
  asOf: string | null,
  key?: string,
): { fact: Fact<string>; gaps: Array<{ label: string; fact: Fact<string> }> } {
  const decomposed = decomposeProfileValue(raw, key);
  const fact: Fact<string> = {
    state: decomposed.primary.state,
    value: decomposed.primary.value,
    source: decomposed.primary.state === "tbd" ? null : source,
    asOf: decomposed.primary.state === "tbd" ? null : asOf,
    raw,
  };
  const gaps: Array<{ label: string; fact: Fact<string> }> = decomposed.parts
    .filter((part) => part.state === "tbd" && decomposed.primary.state !== "tbd")
    .filter((part) => part.raw !== raw)
    .map((part) => ({
      label: part.label,
      fact: {
        state: "tbd" as const,
        value: null,
        source: null,
        asOf: null,
        raw: part.raw,
      },
    }));
  const assumptionParts = decomposed.parts.filter(
    (part) => part.state === "assumption" && decomposed.primary.state === "known",
  );
  for (const part of assumptionParts) {
    gaps.push({
      label: part.label,
      fact: {
        state: "assumption",
        value: part.value,
        source,
        asOf,
        raw: part.raw,
      },
    });
  }
  return { fact, gaps };
}

/** Inference, assumption, and TBD never become client-facing copy. */
export function valueForClientFacingCopy<T>(fact: Fact<T> | null | undefined): T | null {
  if (!fact || fact.state !== "known") return null;
  return fact.value;
}

export function resolveApprovalOwner(fact: Fact<string>): ResolvedApprovalOwner {
  if (fact.state === "tbd" || fact.value == null) {
    return {
      name: DEFAULT_APPROVAL_OWNER_NAME,
      email: DEFAULT_APPROVE_OPERATOR_EMAIL,
      role: "approver-and-admin",
      resolvedFrom: "tbd-default",
    };
  }
  if (/agency owner/i.test(fact.value)) {
    return {
      name: DEFAULT_APPROVAL_OWNER_NAME,
      email: DEFAULT_APPROVE_OPERATOR_EMAIL,
      role: "approver-and-admin",
      resolvedFrom: "agency-owner",
    };
  }
  return {
    name: fact.value,
    email: null,
    role: "approver",
    resolvedFrom: "profile",
  };
}
