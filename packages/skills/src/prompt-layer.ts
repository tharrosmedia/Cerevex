/**
 * Precedence from references/prompt-layer.md (version 1.0.1, 2026-10-03).
 * Seeding a layer is PR 3. This module exposes the procedure the loader pins
 * and the canonical layer paths.
 *
 * Client file: `clients/<client>/prompt-layer.md`
 * Store file: `clients/<client>/prompt-layer-<store>.md`
 *
 * Both paths are canonical. Version 1.0.1 of the vendored procedure names the store path.
 */

export const PROMPT_LAYER_SLUG = "prompt-layer" as const;
export const PROMPT_LAYER_VERSION = "1.0.1" as const;

export const PROMPT_LAYER_PRECEDENCE = [
  {
    rank: 1,
    id: "compliance",
    summary:
      "Shared hard limits, the client's compliance packs, claims-check universal rules, and any claims-check result. A layer cannot loosen these.",
  },
  {
    rank: 2,
    id: "profile-facts",
    summary: "profile.md and binding copy-rules.md. A profile fact always beats a layer rule.",
  },
  {
    rank: 3,
    id: "client-layer",
    summary:
      "Client prompt layer. A store layer refines the client layer for that store. Layer rules beat template defaults.",
  },
  {
    rank: 4,
    id: "template-defaults",
    summary: "The skill body and its references.",
  },
] as const;

export type PromptPrecedenceId = (typeof PROMPT_LAYER_PRECEDENCE)[number]["id"];

/** When no layer file exists, run on the profile and template defaults. Do not invent a layer. */
export const PROMPT_LAYER_MISSING_FALLBACK = "profile" as const;

const RANK: Record<PromptPrecedenceId, number> = {
  compliance: 1,
  "profile-facts": 2,
  "client-layer": 3,
  "template-defaults": 4,
};

/** Lower rank wins. Compliance beats profile facts, which beat the layer, which beats template defaults. */
export function higherPrecedence(a: PromptPrecedenceId, b: PromptPrecedenceId): PromptPrecedenceId {
  return RANK[a] <= RANK[b] ? a : b;
}

const PATH_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertPathSegment(value: string, label: string): void {
  if (!PATH_SEGMENT.test(value)) {
    throw new Error(`${label} path segment ${JSON.stringify(value)} is not a slug`);
  }
}

/** Canonical client prompt-layer path. */
export function clientPromptLayerPath(clientSlug: string): string {
  assertPathSegment(clientSlug, "client");
  return `clients/${clientSlug}/prompt-layer.md`;
}

/**
 * Canonical store prompt-layer path.
 * `store` may be the store segment (`maryland`) or a store key (`got-ductless/maryland`).
 */
export function storePromptLayerPath(clientSlug: string, store: string): string {
  assertPathSegment(clientSlug, "client");
  const prefix = `${clientSlug}/`;
  const segment = store.startsWith(prefix) ? store.slice(prefix.length) : store;
  assertPathSegment(segment, "store");
  return `clients/${clientSlug}/prompt-layer-${segment}.md`;
}
