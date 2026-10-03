# Local / other vertical pack (generic)

Fallback for a future Tharros client whose vertical has no dedicated pack yet (no current profile uses it). Use it with the universal rules, and replace it with a dedicated pack once the vertical is known. Tharros Media uses `saas-b2b/`; Cerevex is internal-only and not marketed.

## Qualified outcome and value model
Set from the profile: booked appointment, qualified lead, purchase, or signed contract. If the profile has none, the first deliverable is a proposed definition marked `assumption` for the owner to approve; paid recommendations stay `needs_data` until it is set.

| Segment | Value per outcome ($) | Margin % | Lead → qualified % | Qualified → sold % | Lag | Source + date |
|---|---|---|---|---|---|---|

## Measurement
Whatever the business converts on: calls, forms, bookings, purchases. Run `conversion-tracking-audit` with the sections that apply.

## Capacity
From the profile (staff, appointments, inventory) or "not capacity-bound" with the reason.

## Demand triggers
From the client's own history only (seasonality in their data, events, launches). No borrowed thresholds.

## Compliance (baseline)
- Universal rules: `/home/box/agent-data/workflows/claims-check/references/universal-rules.md` (FTC endorsements and reviews, superlatives, platform policies, messaging).
- Licenses, certifications, and professional claims only as the profile lists them.
- Regulated categories (health, legal, alcohol, cannabis, gambling, political, employment, housing, credit): stop and flag for a dedicated pack and client counsel before writing claims.
