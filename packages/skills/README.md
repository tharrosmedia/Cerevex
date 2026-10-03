# `@cerevex/skills`

Pinned, read-only skill templates and the one-way client-profile import for Cerevex Skills Integration slice 1.

Cerevex does not read the box or Drive at runtime. Jobs load `template@version` from this package. Client facts live in the imported config, not in a skill body.

## Re-sync

One command replaces the vendored trees, rebuilds `generated/manifest.json`, and rebuilds `generated/client-configs.json`.

```bash
npm run resync --workspace=@cerevex/skills -- \
  --references path/to/tharros-shared-references-YYYY-MM-DD-HHMM.tar.gz \
  --skills path/to/skills-six-YYYY-MM-DD-HHMM-accepted.tar.gz \
  --overlay no-slop-copy=path/to/no-slop-copy-YYYY-MM-DD-HHMM.tar.gz
```

The two main archives must share a `YYYY-MM-DD-HHMM` stamp, read as America/New_York. `--overlay` replaces one skill folder after the skills archive is extracted. The current pin uses the 2026-10-03 07:20 ET accepted snapshot, with `no-slop-copy` replaced from `no-slop-copy-2026-10-03-0718.tar.gz`.

`vendor/SNAPSHOT.json` records the archive names, the upstream path `/home/box/agent-data/workflows/`, and the stamp.

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

`loadPromptLayerRef` exposes both helpers. A store key such as `got-ductless/maryland` maps to `clients/got-ductless/prompt-layer-maryland.md`.

## Profile import

```bash
npm run import --workspace=@cerevex/skills
```

Parses `vendor/tharros-shared-references/references/clients/<slug>/profile.md` into typed client and store config. Every fact is `known`, `tbd`, `inference`, or `assumption`. `approval_owner: TBD` and `agency owner` resolve to the identity `agency owner (Adam Leech)`. The fact stays TBD on the Missing facts checklist. The identity is not an email. The ads import binds it to `os.users` with `APPROVAL_OWNER_USER_ID` or the workspace membership whose role is `owner`. `APPROVAL_OWNER_NAME` in `apps/ads/.env.example` documents that name. Each client gets a Missing facts checklist from its TBD fields and open questions.

Scope gate: only HVAC USA, Got Ductless, KC Prestige HVAC, Elmar HVAC, Tharros Media, and Cerevex. Level Agency tenants (Edge NYC, Vessel NYC, Kiavi, Perfect Lens World, Perfect Lens CA, Lenspure) cannot be imported and cannot run a skill or job.

Marketing gate: Cerevex is `internal tool, not marketed`, so marketing and qualified-outcome runs are blocked. Recording recommendations stays allowed.

Optional local database write (schema `os` only, localhost):

```bash
npm run import:skill-config --workspace=@tharros/ads-shared
```

That command refuses a non-local database host. Production migrations run only after Adam merges and Cos confirms.
