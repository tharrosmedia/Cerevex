# Meta (Facebook / Instagram)

- **Special Ad Category first:** Housing, Employment, or Financial products and services campaigns must declare the category; targeting limits then apply (age 18-65+, all genders, no ZIP or location exclusions, 15-mile minimum radius, no lookalikes, limited detailed targeting). Verified 2026-09-29 (`/home/box/agent-data/workflows/tharros-shared-references/references/verified-facts.md`). Financing-led creative (e.g. HVAC financing offers) and technician-hiring ads run in separate campaigns with the category set if required.
- **Instant Forms (lead-gen clients):** "Higher intent" form type plus a qualifying question from the profile's qualifying rules. Two to four fields. In special-category campaigns, ask nothing the platform or law prohibits.
- **Speed to lead:** someone reaches a form lead in under 5 minutes, or fix that before scaling (`lifecycle-messaging`).
- **CAPI:** e-com sends Purchase with value and order id, deduplicated with the pixel; lead-gen sends CRM stages (qualified, booked or sold, disqualified; HCP CRM for KC Prestige HVAC and Elmar HVAC) and optimizes with the "conversion leads" goal (`offline-conversions.md`).
- **Catalog / Advantage+ shopping (e-com):** catalog synced to the same feed as Merchant Center; exclusions for out-of-stock and restricted items.
- **Targeting:** creative-led broad targeting inside the profile's geo, unless a special category limits it.
- **Retargeting:** customer lists only where the client has consent for that use.
- **Personal attributes:** do not assert or imply the viewer's traits, finances, or health (`claims-check`).
- **Judge on** cost per qualified outcome or ROAS, not CPL.

## Spec table
Last verified: not re-verified 2026-09-29 unless marked. Check in Meta Ads Manager / Business Help before building.

| Item | Setting / limit | Verified |
|---|---|---|
| Special Ad Categories | Housing, Employment, Financial products and services (+ social issues/elections/politics) | 2026-09-29 |
| Primary text | ~125 characters visible before truncation (recommended) | working knowledge |
| Headline | ~40 characters recommended | working knowledge |
| Lead form type | More volume / Higher intent | working knowledge |
