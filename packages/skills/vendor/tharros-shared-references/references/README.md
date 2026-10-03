# Shared files (agency-wide)

Every skill in this pack serves Tharros Media's own clients and brands: HVAC USA, KC Prestige HVAC, Got Ductless, Elmar HVAC, Tharros Media (the agency), and Cerevex (Tharros's SaaS product, internal-only). No other accounts are in scope. Skill bodies hold no client or vertical facts. They load context in this order:

1. **Client profile** `/home/box/agent-data/workflows/tharros-shared-references/references/clients/<client>/profile.md`: vertical, business model, conversion events and value model, channels, geo, voice, compliance pack, approval owner. Plus any extra client files it lists (for example `voice.md`, `copy-rules.md`).
   - Then the client's **Cerevex prompt layer** (`clients/<client>/prompt-layer.md`, a read-only export) if one exists, per `prompt-layer.md` in this folder. No layer: use the profile alone, silently. (Added 2026-10-03, brief §6.7.)
2. **Vertical pack** `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/<vertical>/pack.md` and its `compliance.md`, named in the profile. Economics, measurement, seasonality triggers, creative notes, and vertical rules live here.
3. **Shared rules** in this folder:
   - `cerevex-recommendation-format.md`: every proposed change, `PENDING_APPROVAL`, never flipped by a skill (format 1.1, 2026-10-03).
   - `prompt-layer.md`: how skills load a client's Cerevex prompt layer, precedence, conflict flags, and the silent fallback.
   - `outcome-economics.md`: the qualified outcome and value model, generalized from v2's job-type economics.
   - `lead-classifier.md`: one label set for calls, forms, and lead-form leads.
   - `verified-facts.md`: dated platform and messaging facts that apply to every vertical.
   - `LICENSES.md`: upstream MIT notices.

**Status gates (check before any work):**
- A profile with `status: internal tool, not marketed` gets no marketing work. Today that is cerevex. Decline and say why (reply shape in the cerevex profile). Recording recommendations in Cerevex is unaffected.
- Tharros Media and Cerevex marketing never name a client or cite, show, or imply a client's results, even with that client's permission (tharros-media profile §Compliance, agency owner 2026-09-29).

If the profile is missing, or a field a skill needs is `TBD`, the skill asks for it or marks dependent output `needs_data`. It never fills the gap from another client or from a vertical default without labeling it `assumption`.

Hard rules for every skill: draft only (a person presses send, publishes, or changes any account or budget); no unattended spend; no scrapers or logged-in sessions driven by the skill; no upstream `tools/clis`; no invented stats; time-sensitive facts carry a verify-as-of date and source; no assistant names or ids in any file.
