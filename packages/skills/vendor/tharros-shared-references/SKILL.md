---
name: tharros-shared-references
description: Use this when any Tharros Media marketing skill (or you) needs a client's profile, voice, copy rules, or scope gate (HVAC USA, Got Ductless, KC Prestige HVAC, Elmar HVAC, Tharros Media, Cerevex), a vertical pack or compliance pack (home-service, ecommerce-dtc, saas-b2b, local-other), outcome economics, the lead and call classifier, verified platform facts, the Cerevex recommendation format, or third-party licenses. Reference library read by the v4.1 skills; it does no work on its own.
---

# Tharros shared references (v4.1)

> installed 2026-09-29 from `_adapted-v4/_shared` (v4.1 profile facts). Reference-only skill: other skills read these files by absolute path.

Root: `/home/box/agent-data/workflows/tharros-shared-references/references/` (same layout as the draft pack's `_shared/`; every `_shared/...` path in the v4.1 skills was rewritten to this root).

## Load order for any client task
1. `/home/box/agent-data/workflows/tharros-shared-references/references/clients/README.md`: roster, status gates, and the no-client-names rule.
2. `/home/box/agent-data/workflows/tharros-shared-references/references/clients/<client>/profile.md`: facts, qualified outcome, channels, voice, protected lines, never-say, and the **scope gate**. If the gate declines the task (Cerevex is internal-only; Tharros Media marketing never names clients or cites client results), stop and say why.
3. `voice.md` / `copy-rules.md` in the same client folder when present (HVAC USA has both; copy-rules are binding).
   - Then the client's Cerevex prompt layer, `clients/<client>/prompt-layer.md` (read-only export; Drive master at `Agents/Cerevex/Client prompt layers/`), as `/home/box/agent-data/workflows/tharros-shared-references/references/prompt-layer.md` describes: compliance and hard limits beat profile facts, which beat layer rules, which beat template defaults; conflicts are flagged; no layer means the profile alone, silently. Agents never edit a layer.
4. The client's vertical pack and compliance file: `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/<vertical>/pack.md` and `compliance.md` (see `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/README.md` for which client uses which).
5. As the task needs: `outcome-economics.md`, `lead-classifier.md` (call and lead classifier), `verified-facts.md` (dated platform facts; re-verify anything older than its verify-as-of date), `cerevex-recommendation-format.md` (how every recommendation is written up for approval; format 1.1 from 2026-10-03 adds approver and executor records, source and version tags, and the dedupe key).

Client slugs: `hvac-usa`, `got-ductless`, `kc-prestige-hvac`, `elmar-hvac`, `tharros-media`, `cerevex`; `_template` for a new client (use the `voice-profile` skill to fill it).

Legacy note: the v1 Baltimore / Timonium / Lutherville showroom, Deereco Road addresses, and mini-split brand list were HVAC USA context in the old files. They now sit in `clients/got-ductless/profile.md`, marked CONFIRM with Adam, and never appear in HVAC USA work. HVAC USA = Lennox + Trane, shipped online.

## Project folder
Working and output paths in the skills (`plans/<client>/...`, `audits/<client>/...`, `loops/<client>/...`, `reviews/lead-quality/<client>/`, `competitor-profiles/<client>/<date>/`, `co-op/<client>/...`) are relative to the project folder `/workspace/tharros/`. Create folders as needed. Never write working files into this skill folder.

## Editing
These files are the source of truth for client facts. Change a fact here (with source and date in the profile's Facts register), not inside individual skills. Only the agency owner lifts a scope gate.

## Index
| File | Title |
|---|---|
| `/home/box/agent-data/workflows/tharros-shared-references/references/LICENSES.md` | Upstream licenses |
| `/home/box/agent-data/workflows/tharros-shared-references/references/README.md` | Shared files (agency-wide) |
| `/home/box/agent-data/workflows/tharros-shared-references/references/cerevex-recommendation-format.md` | Cerevex recommendation format |
| `/home/box/agent-data/workflows/tharros-shared-references/references/clients/README.md` | Client profiles |
| `/home/box/agent-data/workflows/tharros-shared-references/references/clients/_template/profile.md` | <Client name>: client profile |
| `/home/box/agent-data/workflows/tharros-shared-references/references/clients/cerevex/profile.md` | Cerevex: client profile |
| `/home/box/agent-data/workflows/tharros-shared-references/references/clients/elmar-hvac/profile.md` | Elmar HVAC: client profile |
| `/home/box/agent-data/workflows/tharros-shared-references/references/clients/got-ductless/profile.md` | Got Ductless: client profile |
| `/home/box/agent-data/workflows/tharros-shared-references/references/clients/hvac-usa/copy-rules.md` | HVAC USA: copy rules (binding for every writer) |
| `/home/box/agent-data/workflows/tharros-shared-references/references/clients/hvac-usa/profile.md` | HVAC USA: client profile |
| `/home/box/agent-data/workflows/tharros-shared-references/references/clients/hvac-usa/voice.md` | HVAC USA: voice |
| `/home/box/agent-data/workflows/tharros-shared-references/references/clients/kc-prestige-hvac/profile.md` | KC Prestige HVAC: client profile |
| `/home/box/agent-data/workflows/tharros-shared-references/references/clients/tharros-media/profile.md` | Tharros Media (agency brand): client profile |
| `/home/box/agent-data/workflows/tharros-shared-references/references/lead-classifier.md` | Lead classifier (shared) |
| `/home/box/agent-data/workflows/tharros-shared-references/references/outcome-economics.md` | Outcome economics (required input) |
| `/home/box/agent-data/workflows/tharros-shared-references/references/prompt-layer.md` | Client prompt layer (Cerevex export): how skills load it |
| `/home/box/agent-data/workflows/tharros-shared-references/references/verified-facts.md` | Verified facts register (universal, time-sensitive) |
| `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/README.md` | Vertical packs |
| `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/ecommerce-dtc/compliance.md` | E-commerce compliance pack (HVAC equipment) |
| `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/ecommerce-dtc/pack.md` | E-commerce vertical pack (HVAC equipment) |
| `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/home-service/compliance.md` | Home-service compliance pack |
| `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/home-service/pack.md` | Home-service vertical pack |
| `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/local-other/pack.md` | Local / other vertical pack (generic) |
| `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/saas-b2b/compliance.md` | SaaS / B2B compliance pack |
| `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/saas-b2b/pack.md` | SaaS / B2B vertical pack |
