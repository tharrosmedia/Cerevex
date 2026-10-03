import { readFileSync } from "node:fs";
import path from "node:path";
import { isLevelAgencyTenant } from "./gates";
import { readLibraryVersion } from "./manifest";
import { missingFactsFor, renderMissingFacts } from "./missing-facts";
import { listProfileDirs, parseProfile, readProfileDir } from "./parse-profile";
import { REFERENCES_DIR, REFERENCES_ROOT, readSnapshot } from "./paths";
import type { ClientSkillConfig, InScopeClientSlug, SkillConfigBundle } from "./types";
import { IN_SCOPE_CLIENT_SLUGS } from "./gates";

export function importProfiles(): SkillConfigBundle {
  const snapshot = readSnapshot();
  const libraryVersion = readLibraryVersion(readFileSync(path.join(REFERENCES_ROOT, "SKILL.md"), "utf8"));
  const clientsDir = path.join(REFERENCES_DIR, "clients");
  const parsed: ClientSkillConfig[] = [];
  for (const dir of listProfileDirs(clientsDir)) {
    const files = readProfileDir(dir);
    if (files.slug === "_template") continue;
    if (isLevelAgencyTenant(files.slug)) {
      throw new Error(`Scope gate: refusing to import Level Agency tenant ${files.slug}`);
    }
    parsed.push(
      parseProfile({
        files,
        libraryVersion,
        snapshotId: snapshot.snapshotId,
      }),
    );
  }
  const clients = IN_SCOPE_CLIENT_SLUGS.map((slug) => {
    const client = parsed.find((item) => item.slug === slug);
    if (!client) throw new Error(`Missing in-scope profile ${slug}`);
    return client;
  });
  const missingFacts = {} as SkillConfigBundle["missingFacts"];
  const missingFactsMarkdown = {} as SkillConfigBundle["missingFactsMarkdown"];
  for (const client of clients) {
    const items = missingFactsFor(client);
    missingFacts[client.slug as InScopeClientSlug] = items;
    missingFactsMarkdown[client.slug as InScopeClientSlug] = renderMissingFacts(client.displayName, items);
  }
  return {
    snapshotId: snapshot.snapshotId,
    libraryVersion,
    generatedFrom: "vendored-profiles",
    clients,
    missingFacts,
    missingFactsMarkdown,
  };
}
