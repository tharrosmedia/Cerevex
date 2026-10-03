# Got Ductless: client profile

status: stub · last_updated: 2026-09-29 · source: agency-owner roster and 2026-09-29 profile answers; legacy items marked

## Identity
- slug: got-ductless
- engagement: direct
- approval_owner: TBD
- site: TBD

## Business
- vertical packs: ecommerce-dtc (online sales, MAP, Merchant Center, feeds), plus the equipment rules in home-service (`/home/box/agent-data/workflows/tharros-shared-references/references/verticals/home-service/compliance.md` §equipment: refrigerant, DIY vs licensed install, 25C, warranty caveats)
- business_model: e-com + local store (online retailer with a physical store in Maryland; agency owner, 2026-09-29)
- what they sell: ductless / mini-split equipment (from the name; product lines TBD)
- store: Maryland; exact address **TBD** (see legacy candidate below)
- geo: online ship-to regions TBD; local store trade area TBD
- installs: TBD (the owner described a retailer; do not claim installation or LSA eligibility until confirmed)

## From legacy copy rules: CONFIRM with Adam
These came from the live v1 skills (no-slop-copy v1 and seo-research, read 2026-09-29). They were filed under HVAC USA there but very likely belong to Got Ductless (agency owner, 2026-09-29). Do not use any of them in copy, schema, listings, or ads until confirmed. They never belong in HVAC USA files.
- Showroom area: Baltimore / Timonium / Lutherville. Legacy local-SEO scope limited city pages to these three places.
- Showroom address (legacy seo-research): 9582 Deereco Road, Lutherville, MD 21093. Warehouse / pickup: 9584 Deereco Road. The agency owner gave the exact address as TBD, so treat both as unconfirmed.
- Legacy example line: "We crate the condenser in Baltimore" (suggests Baltimore-area fulfillment).
- Mini-split brands: Mitsubishi, Fujitsu, Daikin, LG, Durastar, Mr. Cool (DIY).
- Legacy DIY rule: Mr. Cool DIY is a different category from Mitsubishi / Fujitsu / Daikin (licensed install and startup). The home-service §equipment DIY rule applies either way.
- Legacy "also sold" list: Trane, Goodman, Bosch. Owner unclear: HVAC USA sells Trane; Goodman and Bosch are not assigned to any client.

## Conversion and value model
- qualified_outcome: purchase (online order), plus store visit or store sale if it can be tracked (TBD)
- secondary: qualified call or sizing request; direction and call clicks on GBP
- value model: order value and margin by product line (TBD)
- qualifying_rules: TBD
- capacity: inventory, fulfillment, and phone or store staff hours (TBD)

## Channels
| Channel | Status | Access | Notes |
|---|---|---|---|
| Meta | live (per roster) | TBD | |
| Google Ads | live (per roster) | TBD | Shopping/PMax needs Merchant Center and a MAP check |
| OpenAI (ChatGPT) Ads | live (per roster) | TBD | see `/home/box/agent-data/workflows/paid-media/references/openai-ads.md` |
| SEO | live (per roster) | TBD | site plus local store SEO |
| Google Business Profile | TBD (the Maryland store) | TBD | storefront GBP via `lsa-gbp-optimizer` (GBP checklist only; LSA only if installs are confirmed) |

## Measurement stack
E-com platform TBD · call tracking TBD · OpenAI Ads pixel/CAPI status TBD · conversion-tracking-audit: not run

## Voice
TBD (run `voice-profile`). Phone TBD. Never use HVAC USA's (913) number for Got Ductless.

## Compliance
- packs: `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/ecommerce-dtc/compliance.md` + `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/home-service/compliance.md` §equipment
- market overlap: Elmar HVAC also serves Baltimore. Keep the two clients' data, audiences, and copy separate (`competitor-profile` rule).

## Facts register
| Fact | Source | Date |
|---|---|---|
| Channels Meta, Google, OpenAI Ads, SEO | agency-owner roster | 2026-09-29 |
| Online retailer with a physical store in Maryland (exact address TBD) | agency owner | 2026-09-29 |
| `/pages/local-ductless-stores` is a Got Ductless page (legacy URL seen on hvacusa.store link lists; GD only) | agency owner | 2026-09-30 |
| Baltimore/Timonium/Lutherville showroom and mini-split brand list probably belong here | agency owner (inference from legacy files) | 2026-09-29 |

## Open questions
- Confirm the legacy showroom and warehouse addresses, the brand list, phone, site URL, and ship-to regions
- Does it install, or only sell? This decides LSA and the licensed-install copy.
- Dealer authorization and MAP documents per brand; approval owner
