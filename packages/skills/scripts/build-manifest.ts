import { mkdirSync, writeFileSync } from "node:fs";
import { buildManifest } from "../src/manifest";
import { GENERATED_DIR, MANIFEST_PATH } from "../src/paths";

mkdirSync(GENERATED_DIR, { recursive: true });
const manifest = buildManifest();
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${manifest.entries.length} pins to ${MANIFEST_PATH}`);
