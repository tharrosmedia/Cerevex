# Client prompt layer (Cerevex export): how skills load it

> version 1.0.1 · 2026-10-03 (07:26 ET §8.3 install edit; supersedes the earlier 1.0 text) · from Cerevex Skills Integration Brief 1.0 (ACCEPTED 2026-10-03) §6.1–§6.7 and §8.2 M. Agency-wide procedure: no client facts here. Every client-facing skill points to this file with one line; the procedure lives only here.

## What a prompt layer is

Each skill is one shared, agency-wide template. Cerevex keeps a per-client (and, where a store differs, per-store) **prompt layer**: learned *behavior* for that business, such as emphasis and angles, preferred and banned phrases from the client's own reviews and calls, segment priorities and search-term patterns, and worked examples from the client's own approved outputs. The layer is seeded from the client profile and changes only through an approved Cerevex record. Its master copy lives in Cerevex; agents get a read-only export.

A layer never holds facts (facts live in `profile.md`), never holds another client's data, and never changes autonomy, approval routing, compliance packs, `claims-check` rules, or the shared hard limits.

## Where the export lives

| Copy | Path | Written by |
|---|---|---|
| Drive (master export) | `Agents/Cerevex/Client prompt layers/<client>.md`, or `<client>-<store>.md` for a store layer | Cerevex, on every approved layer version or rollback. Overwrites the current file; older versions are in Drive file history. |
| Box (what skills read) | `clients/<client>/prompt-layer.md` under this references folder (`/home/box/agent-data/workflows/tharros-shared-references/references/`) | The Drive-to-box sync routine. Cerevex never writes to the box. |
| Box, store layer | `clients/<client>/prompt-layer-<store>.md` (fixed by Cos 2026-10-03; matches Cerevex PR #49). | The same sync routine |

Each export starts with a header giving the layer id and version (for example `<client>[/<store>]@v<n>`), the export date, the approving rec id, and the line "Exported from Cerevex. Read-only. Change it through a Cerevex rec."

## Load step (every client-facing skill)

Run this right **after** the client profile (and any `voice.md` / `copy-rules.md` the profile lists), and before the vertical pack:

1. Check the profile's scope gate first. If the gate declines the task, stop; don't load a layer.
2. Look for `clients/<client>/prompt-layer.md` on the box. If the task is for one store and a store layer exists, load it too; the store layer refines the client layer for that store.
3. If the box file is missing but you can read Drive, check `Agents/Cerevex/Client prompt layers/<client>[-<store>].md`. Use it read-only for this run. Don't copy it to the box yourself; that is the sync routine's job.
4. **No layer anywhere: fall back to the profile silently.** Run the skill exactly as before on `profile.md` and the template defaults. Don't mention the missing layer in client-facing output, don't ask for one, and don't raise a `needs_data` item for it. (Slice 1 seeds a layer for the HVAC USA pilot only, so this is the normal case for most clients.)
5. When a layer is loaded, read its header. Record the layer version in every Cerevex record you write (`versions.layer`; `none` when no layer was loaded). See `/home/box/agent-data/workflows/tharros-shared-references/references/cerevex-recommendation-format.md`.
6. Ignore a layer file that lacks the Cerevex export header, or that names a different client or store. Use the profile alone, and tell the operator (not the client) in your working notes.

## Precedence

Highest wins:

1. **Hard limits and compliance:** the shared hard limits (draft only, no unattended spend, `PENDING_APPROVAL`), the client's compliance pack(s), `claims-check/references/universal-rules.md`, and any `claims-check` result. A layer can never loosen these.
2. **Profile facts:** `profile.md` (and binding `copy-rules.md`): facts, protected lines, never-say, scope gate. A profile fact always beats a layer rule.
3. **Client prompt layer:** store layer over client layer for that store. Layer rules beat the skill template's defaults (emphasis, phrasing, examples, segment priorities).
4. **Template defaults:** the skill body and its references.

## Conflicts get flagged, not silently resolved

- **Layer rule vs compliance, claims, hard limit, or profile fact:** follow the higher rule, drop the layer rule for this run, and flag it. In the run's operator notes, quote both rules. If the run produces Cerevex records, add a `group: needs_data` record with `channel: all`, `target: layer:<client>[/<store>]`, `change: {from: <layer rule>, to: "suspend or amend"}`, and the reason. Never let a learned rule keep a claim the current rules forbid.
- **Layer rule vs template default:** the layer rule wins. Note the conflict in operator notes only when it changes the output materially.
- **A layer rule that looks like a fact** (a price, product line, location, license): don't use it as a fact. Raise a `needs_data` item asking a person to confirm it in `profile.md`.
- Conflict notes are internal. They never appear in client-facing copy.

## Agents never edit a layer

To change a layer, write a layer-change record per rule 11 of `cerevex-recommendation-format.md` (`channel: all`, `skill: <skill>`, `target: layer:<client>[/<store>]`, `change: {from, to}`, evidence, confidence, rollback). Cerevex ingests it, applies the learning threshold (brief §6.4), and it takes effect only after Approve and the next export. Never write to `prompt-layer.md` or the Drive export by hand.
