# Home-service vertical pack

For local service businesses (booked-service model). Moved from v2 skill bodies and `job-type-economics.md` (v2, retired), `call-classifier.md`, `ad-creative/references/trades-formats.md`, `seasonal-creative-bank.md`, and `seasonal-budget-planner/references/triggers.md`. Compliance: `compliance.md` in this folder.

## Qualified outcome and value model
Default qualified outcome: **booked job** (appointment, estimate visit, or order set). CAC uses sold jobs. The profile can override.

| Segment (job type) | Avg ticket ($) | Gross margin % | Lead → booked % | Booked → sold % | Lag (lead to sold) | Source + date |
|---|---|---|---|---|---|---|
| emergency_repair | | | | | same day to days | |
| repair | | | | | | |
| maintenance / membership | | | | | | |
| replacement / install | | | | | often weeks | |
| iaq add-on | | | | | | |

Also record membership renewal rate and later revenue per member for an LTV view. Report replacement by lead-date cohort. Formulas: `/home/box/agent-data/workflows/tharros-shared-references/references/outcome-economics.md`.

## Lead labels (extends `/home/box/agent-data/workflows/tharros-shared-references/references/lead-classifier.md`)
Add `job_type` to every labeled lead. Mapping from v2 labels: booked → qualified_converted; quote_only → qualified_open; price_shopper → low_intent; out_of_area → out_of_area_or_ineligible; wrong_service → wrong_product (e.g. commercial for a residential-only shop); spam_robocall → spam_bot. Duration alone never makes a call qualified.

## Measurement specifics
- Calls are usually the main conversion: dynamic number insertion, a number per source (each GBP location, LSA, Google call assets, Meta, other paid, email/SMS, offline print/yard signs/trucks), recording with state consent disclosure, CSR disposition. Full checks: `/home/box/agent-data/workflows/conversion-tracking-audit/references/checklist.md` §calls.
- LSA leads are reported separately (Google-provided numbers); GBP uses a tracking number with the main line as additional number.
- Offline import: booked and sold dispositions with value from the FSM/CRM named in the profile (KC Prestige HVAC and Elmar HVAC: HCP CRM).

## Capacity
Capacity = crews and booking board. Gate before any spend increase: next open slot ≤ [n] days and board ≤ [x]% full (owner-set numbers). Answered hours from the profile set ad and call-asset schedules.

## Local channels
LSA and Google Business Profile: `lsa-gbp-optimizer` (vertical-scoped skill).

## Demand triggers (for `demand-seasonality-planner`)
Every number is set with the owner from the client's history; proposed numbers are labeled `assumption`.

| Trigger | Condition (shape) | Step | Cap | Capacity gate | Stand-down |
|---|---|---|---|---|---|
| Heat wave | 3-7 day forecast high ≥ [threshold] °F for ≥ [n] days | +[x]% on emergency/repair search and LSA, staged | Max +[y]% vs month plan | Next slot ≤ [n] days, board ≤ [x]% | Forecast below threshold, or gate fails |
| Cold snap | 3-7 day forecast low ≤ [threshold] °F | Same shape for no-heat repair | | Same | Same |
| Shoulder push | Demand forecast below capacity | Shift to replacement estimates + maintenance | Within plan | Install-crew availability | Board fills |
| Manufacturer promo | Brand calendar dates | Replacement creative + budget shift | Promo budget | Install-crew availability | Promo ends |

## Creative formats
| Format | What it is | Rules |
|---|---|---|
| Tech-to-camera | Owner or tech explains one symptom | Real person, real job; consent in profile |
| Before/after install | Old unit vs new, their own jobs | Customer consent; no house numbers or street signs; strip EXIF location |
| Truck and crew | Branded truck, uniformed crew | Real team only |
| Gauge / thermostat close-up | Readings, a part, a filter | No unsafe DIY demonstration |
| Review screenshot | A real review | Permission noted; rating source and date |
| "What's included" checklist | Maintenance-plan static | Plan terms from profile |
| Financing static | Payment or promo angle | Only with `claims-check` pass (TILA trigger terms) |

## Seasonal creative bank
| Moment | Angle | Notes |
|---|---|---|
| Pre-season (spring cooling / fall heating) | Tune-up before the rush | Real slot scarcity only |
| First heat wave | "No cool" emergency; same-day only if true | Pair with capacity gate |
| First cold snap | "No heat" emergency | Same |
| Shoulder months | Replacement + compliant financing; dated manufacturer promos | Crews have room |
| Refrigerant transition (R-410A to A2L such as R-454B / R-32) | What it means for a replacement | Claims only as manufacturer or brief states, with source and date |
| Membership renewal | What members got this year | Real plan terms |

## Trade slop (add to `no-slop-copy` Detect for this vertical)
Phrases that could run on any contractor's site unchanged: "comfort solutions," "all your HVAC needs," "look no further," "your comfort is our top priority," "trusted experts," "state-of-the-art equipment," "we go above and beyond." Empty words for this vertical: innovative climate solutions, comfort oasis, whisper-quiet luxury (unless quoting a spec dB). Fix: attach a client fact from the profile (service area, response time on record, specific job, named tech with consent).
