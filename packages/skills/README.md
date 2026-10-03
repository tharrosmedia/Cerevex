# `@cerevex/skills`

Pinned, read-only skill templates and the one-way client-profile import for Cerevex Skills Integration slice 1.

Cerevex does not read the box or Drive at runtime. Jobs load `template@version` from this package. Client facts live in the imported config, not in a skill body.

## Re-sync

One command replaces the vendored trees, runs `manifest` to rebuild `generated/manifest.json`, and runs `import` to rebuild `generated/client-configs.json`. It refuses symlinks in the source tree instead of copying them into `vendor/`.

```bash
npm run resync --workspace=@cerevex/skills -- --source /home/box/agent-data/workflows
```

`--source` is the live workflows directory. It defaults to `/home/box/agent-data/workflows`. The script copies `tharros-shared-references` and each skill folder from that directory. It does not read an old snapshot archive.

Pinned shared references live in `pins/shared-references.json`. The accepted bytes for those paths also live under `overlays/shared-references/`. Today that pin is `references/prompt-layer.md` at sha256 `69e3d463c490519ad80603125d872ce5aa29cae20580cb3bb19c4108f73097e9` (prompt-layer 1.0.1). Re-sync hashes the overlay and the file in `--source`. If either digest differs, the script throws and leaves `vendor/` as it is, so 1.0.1 survives. Optional `--overlay name=/path/to/skill-dir` replaces one skill folder after the source copy. Optional `--stamp YYYY-MM-DD-HHMM` sets the snapshot id, read as America/New_York.

`vendor/SNAPSHOT.json` records the source directory, the America/New_York stamp, and the shared-reference pins that passed the check.

## Loader

```ts
import { loadTemplate, loadSharedRef, loadPromptLayerRef } from "@cerevex/skills";

const paid = loadTemplate("paid-media", "0.4.1-accepted");
paid.read("references/google.md");

const format = loadSharedRef("cerevex-recommendation-format", "1.1");
const procedure = loadPromptLayerRef();
```

A requested version that is not the vendored pin throws. The loader checks the content hash and only reads files inside the pin.

Prompt-layer precedence, highest first: compliance, profile facts, client layer (a store layer refines the client layer), template defaults. If no layer exists, fall back to the profile. Seeding a layer is a later PR.

The layer paths are canonical:

- Client: `clients/<client>/prompt-layer.md` (`clientPromptLayerPath`)
- Store: `clients/<client>/prompt-layer-<store>.md` (`storePromptLayerPath`)

`loadPromptLayerRef` loads `prompt-layer@1.0.1` and exposes both helpers. A store key such as `got-ductless/maryland` maps to `clients/got-ductless/prompt-layer-maryland.md`. The vendored procedure names that store path.

## Profile import

```bash
npm run import --workspace=@cerevex/skills
```

Parses `vendor/tharros-shared-references/references/clients/<slug>/profile.md` into typed client and store config. Every fact is `known`, `tbd`, `inference`, or `assumption`. `approval_owner: TBD` and `agency owner` resolve to the identity `agency owner (Adam Leech)`. The fact stays TBD on the Missing facts checklist. The identity is not an email. The ads import binds it to `os.users` with `APPROVAL_OWNER_USER_ID` only when that user is an owner of every workspace that holds a linked client. Otherwise it binds the workspace membership whose role is `owner`. An id that is only an owner of a different workspace is refused. The import writes only to a local database, or to a non-local host when `PRODUCTION_NEON_HOST` or `PRODUCTION_DATABASE_URL` is set and does not match that host. `ALLOW_NONLOCAL_TEST_DB` alone does not open the write path. The whole bundle is one transaction, and a successful upsert sets `imported_at`. `APPROVAL_OWNER_NAME` in `apps/ads/.env.example` documents that name. Each client gets a Missing facts checklist from its TBD fields and open questions.

Scope gate: only HVAC USA, Got Ductless, KC Prestige HVAC, Elmar HVAC, Tharros Media, and Cerevex. Level Agency tenants (Edge NYC, Vessel NYC, Kiavi, Perfect Lens World, Perfect Lens CA, Lenspure) cannot be imported and cannot run a skill or job.

Marketing gate: Cerevex is `internal tool, not marketed`, so marketing and qualified-outcome runs are blocked. Recording recommendations stays allowed.

Optional local database write (schema `os` only, localhost):

```bash
npm run import:skill-config --workspace=@tharros/ads-shared
```

That command refuses a non-local database host. Production migrations run only after Adam merges and Cos confirms.
