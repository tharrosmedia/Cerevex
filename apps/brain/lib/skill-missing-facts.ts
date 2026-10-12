import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function plainFactLabel(label: string): string {
  return label.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

let cached: Record<string, string[]> | null = null;

function loadLabels(): Record<string, string[]> {
  if (cached) return cached;
  const path = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/skills/generated/client-configs.json');
  const bundle = JSON.parse(readFileSync(path, 'utf8')) as {
    missingFacts?: Record<string, Array<{ label?: unknown }>>;
  };
  const labels: Record<string, string[]> = {};
  for (const [slug, items] of Object.entries(bundle.missingFacts ?? {})) {
    labels[slug] = items
      .map((item) => (typeof item.label === 'string' ? plainFactLabel(item.label) : ''))
      .filter((label) => label.length > 0);
  }
  cached = labels;
  return labels;
}

/** Fact names from the bundled profile. Empty when the slug is unknown. */
export function bundledMissingFactLabels(slug: string): string[] {
  return loadLabels()[slug] ?? [];
}
