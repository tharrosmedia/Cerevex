# KC Prestige HVAC: client profile

status: stub · last_updated: 2026-09-29 · source: agency-owner roster and 2026-09-29 profile answers

## Identity
- slug: kc-prestige-hvac
- engagement: direct
- approval_owner: TBD
- site: TBD

## Business
- vertical pack: home-service
- business_model: booked-service (HVAC contractor; agency owner, 2026-09-29)
- what they sell: new installs of heat pumps, air conditioners, and furnaces; repair and service of existing HVAC equipment
- geo / service area: Kansas City (agency owner, 2026-09-29). Exact boundary (cities, ZIPs, Missouri and/or Kansas side) TBD
- licenses, brands, dealer programs: TBD

## Conversion and value model
- qualified_outcome: booked job; sold job for installs. Source of truth: HCP CRM (Tharros's internal CRM)
- conversion events: calls, forms, Meta lead forms (TBD)
- segments (job types): install (heat pump, AC, furnace) · repair/service
- value model: job values TBD (per `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/home-service/pack.md`; client numbers TBD)
- qualifying_rules: in the Kansas City service area; wants an install or repair/service (TBD beyond that)
- capacity: crews and booking board (TBD)

## Channels
| Channel | Status | Access | Notes |
|---|---|---|---|
| Meta | live (per roster) | TBD | |
| Google Ads | live (per roster) | TBD | LSA/GBP status TBD |

## Measurement stack
- CRM: HCP CRM (Tharros's internal CRM), the system of record for booked and sold jobs. Offline conversion import (Google, Meta, Microsoft) sends booked and sold stages from HCP CRM (`/home/box/agent-data/workflows/paid-media/references/offline-conversions.md`).
- Click-id capture into HCP CRM: TBD
- Call tracking: TBD
- conversion-tracking-audit: not run

## Voice
TBD (run `voice-profile`). Protected lines: phone (816) 307-1427 (per roster).

## Compliance
- packs: `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/home-service/compliance.md`
- client rules: license number display TBD

## Facts register
| Fact | Source | Date |
|---|---|---|
| Channels Meta, Google | agency-owner roster | 2026-09-29 |
| Phone (816) 307-1427 | agency-owner roster | 2026-09-29 |
| HVAC contractor serving Kansas City | agency owner | 2026-09-29 |
| Job types: installs (heat pumps, AC, furnaces) and repair/service | agency owner | 2026-09-29 |
| CRM: HCP CRM (Tharros's internal CRM) | agency owner | 2026-09-29 |

## Open questions
- Job values; exact service-area boundary; license numbers; call tracking; approval owner; site URL
- Does HCP CRM store click ids (GCLID, fbclid, MSCLKID) for offline import?
