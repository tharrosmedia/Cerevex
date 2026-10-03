# Offline and server-side outcome import, value bidding (required)

Without the qualified outcome, PMax, Advantage+, lead forms, and TikTok optimize to form fills or cheap purchases. Treat this as required before any automated-bidding recommendation.

Last verified: 2026-09-29 for the Google windows (`/home/box/agent-data/workflows/tharros-shared-references/references/verified-facts.md`). Other rows not re-verified; confirm in platform help before building.

## What to send (by business model; the profile decides)

| Business model | Stages | Value |
|---|---|---|
| booked-service | Qualified lead → booked job → sold job; disqualified. Source: the profile's CRM (KC Prestige HVAC and Elmar HVAC: HCP CRM, Tharros's internal CRM) | Booked: value × close rate by job type (install vs repair/service); sold: actual revenue or margin |
| e-com | Purchase (pixel + server, dedup); phone/draft orders imported; refunds retracted | Order value or margin; new vs returning flag if supported |
| saas (dormant: Cerevex is internal-only) | Demo booked or trial started → activated → paid; disqualified | Owner-set stage values (trial→paid rate × plan value); no PII beyond approved hashed keys |
| agency lead-gen (Tharros) | Discovery call booked → proposal → signed | Owner-set stage values |
| other lead-gen | Qualified lead → sold/signed | Client-supplied values |

Values come from the profile and `/home/box/agent-data/workflows/tharros-shared-references/references/outcome-economics.md`. State them in the recommendation.

## HCP CRM clients (KC Prestige HVAC, Elmar HVAC)
HCP CRM is the source of booked and sold jobs for the import. Before recommending automated bidding on it, confirm:
1. Leads in HCP CRM carry the click id (GCLID/GBRAID/WBRAID, fbclid or Meta lead ID, MSCLKID) or enhanced-conversion match keys, captured from forms and call tracking.
2. Booked and sold stages have timestamps and job type (install vs repair/service), plus the sold value once job values are set.
3. Who runs the export or upload and how often, and how it fits the 63/90-day Google windows above.

If any of these is unknown, the import is `needs_data`. Do not change HCP CRM fields or connections; write the fix as a recommendation.

## By platform

| Platform | Method | Notes | Verified |
|---|---|---|---|
| Google Ads | GCLID offline import or enhanced conversions for leads; conversion adjustments to retract or restate; enhanced conversions for web (e-com) | GCLID uploads within 90 days of last click; enhanced conversions for leads within 63 days. Capture GCLID/GBRAID/WBRAID in hidden fields and call tracking | 2026-09-29 |
| Meta | Conversions API: Purchase (e-com) or CRM lead stages with the Meta lead ID; "conversion leads" goal | Dedup with pixel event id | not re-verified |
| Microsoft Ads | Offline conversion import with MSCLKID (or the Google import path) | Check upload window | not re-verified |
| TikTok | Events API | Tie to lead ids or order ids | not re-verified |
| OpenAI Ads | OpenAI Pixel + Conversions API (Pixel ID + Conversions API key); pass click reference values (e.g. `oppref`) | Server-side events for confirmed outcomes | 2026-09-29 |

## Value-based bidding sequence

1. Import working and match rate known (report it; do not invent a target).
2. Bid to the qualified outcome (or the furthest importable stage for long-lag models) once volume meets the platform's guidance.
3. Move to value bidding (Max conversion value / tROAS) once values flow.
4. Monthly import-health check (last upload, match rate) in `account-review-loop`.
