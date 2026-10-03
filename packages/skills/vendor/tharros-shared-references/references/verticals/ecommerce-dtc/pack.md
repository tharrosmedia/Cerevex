# E-commerce vertical pack (HVAC equipment)

Scoped to what Tharros's clients need today: online HVAC equipment sales. That means HVAC USA (phone-assisted; Lennox and Trane) and Got Ductless (a mini-split retailer with a physical Maryland store; brands TBD). For a store with a storefront, also use the GBP checklist in `lsa-gbp-optimizer`. Compliance: `compliance.md` in this folder. Equipment rules (refrigerant, DIY vs licensed install, 25C, warranty caveats): `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/home-service/compliance.md` §equipment.

## Qualified outcome and value model
Default qualified outcome: **purchase**, net of cancels and returns where the data allows. Phone-assisted stores add a secondary outcome: qualified sizing call or draft order created. Stores with a storefront may add store visits or store sales if they can be tracked (GBP directions and calls, store POS).

| Segment (product line) | AOV ($) | Gross margin % | Freight cost / order | Return/cancel % | Repeat or contractor reorder rate | Source + date |
|---|---|---|---|---|---|---|

- Metrics: ROAS and margin ROAS by product line (freight and dealer cost make revenue ROAS misleading on equipment); CAC on first orders; homeowner vs contractor split; new vs returning.
- Always split by product line and buyer type; blended numbers hide mix.
- Formulas: `/home/box/agent-data/workflows/tharros-shared-references/references/outcome-economics.md`.

## Measurement specifics
- Purchase event fires once per order with value, currency, and order id (dedup key) on the browser pixel and server-side (Meta CAPI, Google enhanced conversions, OpenAI Conversions API where used).
- Phone and draft orders: import the order back to the platform with the click id or enhanced-conversion match keys, or they look like lost sales. Draft-order payment links should keep the original click id.
- Calls to the sales line are a secondary conversion (call tracking with a qualified-duration rule), never the primary for bidding.
- Refunds and cancels: adjust or retract conversion value where the platform supports it.
- Checks: `/home/box/agent-data/workflows/conversion-tracking-audit/references/checklist.md` §e-com.

## Feeds and Merchant Center
- The product feed is the ad: title (brand + model number + tonnage/BTU or key attribute + product type), GTIN/MPN, price and availability matching the landing page, shipping (freight vs parcel) and return policy set in Merchant Center, product category, custom labels for margin, product line, and freight class.
- MAP: feed price never below the brand's current MAP/UPP (`compliance.md` §1). If MAP hides price until cart, check how the feed and landing page handle it before listing.
- Disapprovals and "price mismatch" are the common silent losses; check diagnostics before optimizing bids.
- Brand authorization: list only brands the profile shows authorization for (HVAC USA: Lennox and Trane; Got Ductless: TBD, legacy list unconfirmed).

## Capacity
Not crew-bound, but check inventory depth, back-orders, freight lead times, and phone-sizing staff hours before raising spend on a product line. A phone-assisted store whose sizing line is full is capacity-bound.

## Demand triggers (for `demand-seasonality-planner`)
| Trigger | Condition (shape) | Notes |
|---|---|---|
| Weather | Same shape as the home-service heat and cold triggers | Inventory and sizing-staff gate replaces the crew gate |
| Shoulder season | Spring and fall replacement planning | Contractor buyers plan ahead |
| Manufacturer promo / new model year | Brand calendar | MAP and brand guidelines |
| Stock events | Back-in-stock / low stock on a top line | Pause or shift before spend is wasted |
| Store promo windows | Dates from the client | Terms from the client; MAP applies |

## Creative notes
Product facts (model, tonnage, SEER2/HSPF2 from the spec sheet with date), what ships in the box and by what method, sizing help by phone, real install photos with consent. Specs per platform: `/home/box/agent-data/workflows/ad-creative/references/platform-specs.md`.

## E-com slop (add to `no-slop-copy` Detect)
"Elevate your comfort," "curated for you," "must-have," "game-changer," "unbeatable prices," "you deserve it." Fix: model fact, spec, shipping method, or policy from the profile.
