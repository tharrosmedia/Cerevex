import { mkdirSync, writeFileSync } from "node:fs";
import { importProfiles } from "../src/import-profiles";
import { CLIENT_CONFIG_PATH, GENERATED_DIR } from "../src/paths";

mkdirSync(GENERATED_DIR, { recursive: true });
const bundle = importProfiles();
writeFileSync(CLIENT_CONFIG_PATH, `${JSON.stringify(bundle, null, 2)}\n`);
const counts = Object.fromEntries(
  bundle.clients.map((client) => [client.slug, bundle.missingFacts[client.slug].length]),
);
console.log(
  JSON.stringify(
    {
      snapshotId: bundle.snapshotId,
      clients: bundle.clients.map((client) => client.slug),
      missingFactCounts: counts,
      path: CLIENT_CONFIG_PATH,
    },
    null,
    2,
  ),
);
