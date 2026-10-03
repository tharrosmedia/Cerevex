# Google Ads (Search, PMax, Shopping, Demand Gen/YouTube, LSA)

Vertical specifics (segments, audience limits, feed rules) come from the client's vertical pack.

## Search
- **Campaign split:** by segment in the profile (job type, product line, plan tier) plus brand. Separate budgets so brand does not absorb non-brand money.
- **Location option:** "Presence," not "Presence or interest." Check after every import or new campaign.
- **Geo:** from the profile. Use ZIP or region bid adjustments from qualified-outcome data where allowed. In Housing, Employment, or Consumer Finance campaigns (US/Canada; for Tharros clients, financing-led or hiring ads), ZIP targeting is not allowed; use radius ≥ 1 km, city, or country (`/home/box/agent-data/workflows/tharros-shared-references/references/verified-facts.md`).
- **Call assets** (when calls matter) with Google forwarding numbers; duration threshold matches the qualified-call rule (`conversion-tracking-audit`).
- **Ad schedule** tied to answered hours in the profile when calls matter.
- **Standing negatives by theme** (build from the search-terms report; themes, not a pasted list): jobs/careers/training; DIY/how-to/manual (service clients); free; used; out-of-scope products or services from the profile; competitor-brand policy (decide with the owner).
- **Search-terms review cadence:** weekly in peak season, every two weeks otherwise. Proposed negatives cite query, spend, and outcome.
- **Bidding:** start on qualified outcomes; move to value bidding once values import (`offline-conversions.md`).

## Performance Max
- Only once outcome data works. Before that, PMax learns from junk.
- Brand exclusions on PMax so it does not take credit for brand search.
- Asset groups by segment; landing page per segment.
- E-com (HVAC USA): feed titles with brand + model number + tonnage/BTU + product type, GTINs, MAP-compliant prices, product-level exclusions for discontinued or low-margin items.

## Shopping / Merchant Center (e-com)
- Feed price and availability match the landing page and MAP policy; shipping (freight vs parcel) and return policy set; only brands the profile shows authorization for.

## Demand Gen / YouTube
- Reach and retargeting with frequency caps. Exclude view-through from CAC. Restricted-targeting rules apply to Demand Gen for covered categories (June 2026 update).

## Local Services Ads (local service clients only; full checklist in `lsa-gbp-optimizer`)
- Bidding mode choice by how much control the client needs over lead cost by job type; check current mode names in the console.
- Job-type toggles off for job types that do not book or are unprofitable.
- Weekly lead review and dispute list from `lead-quality-review`.
- LSA hours equal answered hours.

## Campaign spec table
Last verified: not re-verified 2026-09-29 unless marked. Check in Google Ads help before building.

| Item | Setting / limit | Verified |
|---|---|---|
| RSA headline / description / path | 30 / 90 / 15 characters; up to 15 headlines, 4 descriptions | working knowledge |
| Demand Gen headline / description / business name | 40 (at least one ≤30) / 90 / 25 characters; up to 5 each | 2026-09-29 (Google Ads Help 17091672) |
| Demand Gen images | 1.91:1, 1:1 required; 4:5 and 9:16 optional | 2026-09-29 |
| Offline import windows | GCLID 90 days; enhanced conversions for leads 63 days | 2026-09-29 |
