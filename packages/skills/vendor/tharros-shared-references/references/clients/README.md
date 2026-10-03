# Client profiles

One folder per client: `clients/<client-slug>/profile.md`, plus optional `voice.md` (detailed voice) and `copy-rules.md` (client-only copy rules), and optional `prompt-layer.md` (the client's Cerevex prompt layer: a read-only export synced from Drive, never edited here; see `../prompt-layer.md`). Every skill reads the profile first, then the prompt layer if one exists. Replaces v2's `brand/<brand>/about.md` + `voice.md` convention.

Rules:
- Only facts the client or the agency owner supplied, each with a source and date. Unknown = `TBD`. Inferences are labeled `inference` and never used in client-facing copy.
- `voice-profile` builds or updates `voice.md` and the Voice section. Other skills propose changes; a person accepts them.
- Scope: Tharros Media's own clients and brands only (the six below). Skills do not work on any other account.
- Status gate: a profile with `status: internal tool, not marketed` (today: cerevex) gets no marketing work. Every marketing skill declines and says why. Only the agency owner changes the status.
- Tharros Media and Cerevex marketing never name a client or cite a client's results (tharros-media profile §Compliance, agency owner 2026-09-29).

## Roster (from the agency owner, 2026-09-29; details TBD unless stated)

Six profiles. Anything not listed below is out of scope.

| Slug | Client | Engagement | Vertical pack | Business model | Channels (as given) |
|---|---|---|---|---|---|
| hvac-usa | HVAC USA | owned | ecommerce-dtc (+ home-service equipment rules) | e-com | SEO now; Google + Meta planned |
| kc-prestige-hvac | KC Prestige HVAC | direct | home-service | booked-service (HVAC contractor, Kansas City; HCP CRM) | Meta, Google |
| got-ductless | Got Ductless | direct | ecommerce-dtc (+ home-service equipment rules) | e-com + local store (Maryland) | Meta, Google, OpenAI Ads, SEO |
| elmar-hvac | Elmar HVAC | direct | home-service | booked-service (HVAC contractor, Baltimore; HCP CRM) | Meta, Google, SEO |
| tharros-media | Tharros Media (agency brand) | internal | saas-b2b (B2B services) | lead-gen (inference; confirm) | none yet; no site live |
| cerevex | Cerevex (Tharros's SaaS product) | internal | none active | **internal tool, not marketed** | none |
