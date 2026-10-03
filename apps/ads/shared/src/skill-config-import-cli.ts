import { importProfiles } from "@cerevex/skills";
import { closeDb, getDb } from "./db";
import { loadEnv, requiredEnv } from "./env";
import { assertLocalDatabase, importSkillConfigBundle } from "./skill-config-import";

async function main(): Promise<void> {
  loadEnv();
  const url = requiredEnv("DATABASE_URL");
  assertLocalDatabase(url);
  const bundle = importProfiles();
  await importSkillConfigBundle(getDb(), bundle);
  console.log(
    JSON.stringify({
      snapshotId: bundle.snapshotId,
      clients: bundle.clients.map((client) => client.slug),
    }),
  );
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});