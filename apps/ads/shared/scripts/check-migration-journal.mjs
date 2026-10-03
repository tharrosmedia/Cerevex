import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const journalPath = "apps/ads/shared/drizzle/meta/_journal.json";
const TAG_NAME = /^[A-Za-z0-9_-]+$/;

function sqlHash(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

function entries(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.entries)) throw new Error(`${journalPath} has no entries`);
  return parsed.entries.map((entry) => {
    const tag = String(entry.tag);
    if (!TAG_NAME.test(tag)) throw new Error(`Migration journal tag ${JSON.stringify(tag)} is not a file name.`);
    return { tag, when: Number(entry.when) };
  });
}

function show(spec) {
  return execFileSync("git", ["show", spec], { encoding: "utf8" });
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
  baseRaw = show("origin/main:apps/ads/shared/drizzle/meta/_journal.json");
} catch {
  if (process.env.CI === "true") {
    console.error("CI cannot compare the migration journal because origin/main is missing. Refusing to pass.");
    process.exit(1);
  }
  console.log("Migration journal order is increasing. origin/main has no journal to compare.");
  process.exit(0);
}

const base = entries(baseRaw);
const localByTag = new Map(local.map((entry) => [entry.tag, entry]));
const baseTags = new Set(base.map((entry) => entry.tag));
const maxBase = base.reduce((max, entry) => Math.max(max, entry.when), 0);

for (const entry of base) {
  const current = localByTag.get(entry.tag);
  if (!current) {
    console.error(`${entry.tag} is on origin/main but missing from this journal.`);
    process.exit(1);
  }
  if (current.when !== entry.when) {
    console.error(
      `${entry.tag} when ${current.when} does not match origin/main (${entry.when}). Applied journal timestamps are immutable.`,
    );
    process.exit(1);
  }
  let baseSql = "";
  try {
    baseSql = show(`origin/main:apps/ads/shared/drizzle/${entry.tag}.sql`);
  } catch {
    console.error(`origin/main is missing apps/ads/shared/drizzle/${entry.tag}.sql.`);
    process.exit(1);
  }
  let localSql = "";
  try {
    localSql = readFileSync(`apps/ads/shared/drizzle/${entry.tag}.sql`, "utf8");
  } catch {
    console.error(`${entry.tag}.sql is on origin/main but missing from apps/ads/shared/drizzle/.`);
    process.exit(1);
  }
  const localHash = sqlHash(localSql);
  const baseHash = sqlHash(baseSql);
  if (localHash !== baseHash) {
    console.error(
      `${entry.tag} SQL hash ${localHash} does not match origin/main ${baseHash}. Applied SQL is immutable.`,
    );
    process.exit(1);
  }
}

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
