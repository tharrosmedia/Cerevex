import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const journalPath = "apps/ads/shared/drizzle/meta/_journal.json";

function entries(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.entries)) throw new Error(`${journalPath} has no entries`);
  return parsed.entries.map((entry) => ({ tag: String(entry.tag), when: Number(entry.when) }));
}

const local = entries(readFileSync(journalPath, "utf8"));
let previous = -1;
for (const entry of local) {
  if (!Number.isFinite(entry.when) || entry.when <= previous) {
    console.error(
      `Migration journal when must increase: ${entry.tag} (${entry.when}) is not after ${previous}.`,
    );
    process.exit(1);
  }
  previous = entry.when;
}

let baseRaw = "";
try {
  baseRaw = execFileSync("git", ["show", "origin/main:apps/ads/shared/drizzle/meta/_journal.json"], {
    encoding: "utf8",
  });
} catch {
  console.log("Migration journal order is increasing. origin/main has no journal to compare.");
  process.exit(0);
}

const base = entries(baseRaw);
const baseTags = new Set(base.map((entry) => entry.tag));
const maxBase = base.reduce((max, entry) => Math.max(max, entry.when), 0);
for (const entry of local) {
  if (baseTags.has(entry.tag)) continue;
  if (entry.when <= maxBase) {
    console.error(
      `${entry.tag} when ${entry.when} is not after the latest migration on main (${maxBase}). Drizzle skips an older timestamp once a newer one is applied.`,
    );
    process.exit(1);
  }
}

console.log(`Migration journal order ok. New migrations are after main's latest when ${maxBase}.`);
