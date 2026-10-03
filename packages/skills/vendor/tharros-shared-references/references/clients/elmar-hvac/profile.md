# Elmar HVAC: client profile

status: stub · last_updated: 2026-09-29 · source: agency-owner roster and 2026-09-29 profile answers

## Identity
- slug: elmar-hvac
- engagement: direct
- approval_owner: TBD
- site: TBD

## Business
- vertical pack: home-service
- business_model: booked-service (HVAC contractor; agency owner, 2026-09-29)
- what they sell: new installs of heat pumps, air conditioners, and furnaces; repair and service of existing HVAC equipment
- geo / service area: Baltimore (agency owner, 2026-09-29). Exact boundary (city, county, ZIPs) TBD
- licenses, brands, dealer programs: TBD

## Conversion and value model
- qualified_outcome: booked job; sold job for installs. Source of truth: HCP CRM (Tharros's internal CRM)
- conversion events: TBD
- segments (job types): install (heat pump, AC, furnace) · repair/service
- value model: job values TBD (per `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/home-service/pack.md`; client numbers TBD)
- qualifying_rules: in the Baltimore service area; wants an install or repair/service (TBD beyond that)
- capacity: TBD

## Channels
| Channel | Status | Access | Notes |
|---|---|---|---|
| Meta | live (per roster) | TBD | |
| Google Ads | live (per roster) | TBD | LSA/GBP status TBD |
| SEO | live (per roster) | TBD | |

## Measurement stack
- CRM: HCP CRM (Tharros's internal CRM), the system of record for booked and sold jobs. Offline conversion import (Google, Meta, Microsoft) sends booked and sold stages from HCP CRM (`/home/box/agent-data/workflows/paid-media/references/offline-conversions.md`).
- Click-id capture into HCP CRM: TBD
- Call tracking: TBD
- conversion-tracking-audit: not run

## Voice
TBD (run `voice-profile`). Phone: TBD.

## Compliance
- packs: `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/home-service/compliance.md`
- market overlap: Got Ductless has a Maryland store (legacy files point to the Baltimore area). Keep the two clients' data, audiences, and copy separate. The legacy Baltimore / Timonium / Lutherville showroom references belong to Got Ductless, not Elmar.

## Facts register
| Fact | Source | Date |
|---|---|---|
| Channels Meta, Google, SEO | agency-owner roster | 2026-09-29 |
| HVAC contractor serving Baltimore | agency owner | 2026-09-29 |
| Job types: installs (heat pumps, AC, furnaces) and repair/service | agency owner | 2026-09-29 |
| CRM: HCP CRM (Tharros's internal CRM) | agency owner | 2026-09-29 |

## Open questions
- Job values; exact service-area boundary; phone; license numbers; call tracking; approval owner; site URL
- Does HCP CRM store click ids for offline import?
