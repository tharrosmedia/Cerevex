# HVAC USA house style (compatibility copy)

Compatibility file so `hvac-copy-pipeline`, `content-draft`, and `content-editor` keep working unchanged: they read `/home/box/agent-data/workflows/no-slop-copy/references/house-style.md`. The source of truth is `/home/box/agent-data/workflows/tharros-shared-references/references/clients/hvac-usa/` (`profile.md`, `copy-rules.md`, `voice.md`); the pipeline skills were repointed to those files on 2026-09-29 and read them first; this copy stays for compatibility and must match them (if it disagrees, the profile wins). Other clients never use this file.

Migrated from the live `/home/box/agent-data/workflows/no-slop-copy/references/house-style.md` (v1.1) and the HVAC USA rules in the live `/home/box/agent-data/workflows/no-slop-copy/SKILL.md`. Protected lines are copied exactly. Items marked **CONFIRM** are open questions for the owner (see the pack CHANGELOG).

## Business
- Brand: HVAC USA
- Site: https://hvacusa.store/
- Business model: e-commerce, phone-assisted
- Product focus: conventional residential HVAC (furnaces, AC, heat pumps, air handlers, coils, etc.)
- Brands: Lennox and Trane, sold online (agency owner, 2026-09-29). Lennox + Trane only for now; do not name any other brand as carried.
- Internal context only, not a copy claim: v1 house style noted Lennox is more competitive online than Trane. Never write a price claim or a brand-vs-brand price comparison from it.
- Sales path: build trust by phone → draft order/estimate → customer purchases online
- Dealer authorization / tier and MAP-UPP policy for Lennox and Trane: **CONFIRM** (needed by claims-check before any price ad)

## Shipping, hours, contact
- Ships: lower 48 from Kansas City warehouse. **CONFIRM** (per house-style v1.1; not yet confirmed with the owner in this review)
- Phone: (913) 364-0070
- Email: info@hvacusa.store
- Hours: Monday–Friday 9am–5pm CST

## Protected lines (do not reword)
- Default CTA (use at least once per page, usually close): Call (913) 364-0070 — we'll size it, draft your order, then you buy online.
- Allowed shorter CTA in headings, first screen, and meta: Call (913) 364-0070 for sizing help.
- Do not drop the phone. Do not invent a third CTA line.
- Do not invent other phone numbers or emails. Do not mention any prior brand names. Prefer https://hvacusa.store/ pages that are confirmed live before publishing links.

## Hard rules (binding for every writer)
1. Do not invent prices, stock, rebate amounts, warranty years, excluded shipping states, hours, or installer availability. Write "confirm with owner" and keep moving.
2. Do not tell a homeowner to DIY a non-DIY refrigerant system. Pre-charged DIY systems are a different category from systems that need a licensed install and startup; never blur the two. (**CONFIRM** which DIY lines, if any, the store sells.)
3. Do not promise manufacturer warranty on internet-sold equipment without the Pro-Install / authorized-channel caveat.
4. Multi-zone outdoor capacity is not the sum of indoor nameplates. Flag diversity and send complex jobs to a human designer.
5. Sizing copy may use square footage as a starting point only. Insulation, sun, ceiling height, and climate matter, especially for heating in cold climates.
6. Do not attack competitors with claims we cannot defend.
7. Do not write medical-grade air claims. "Filters allergens" is fine.
8. Do not publish policy language that conflicts with site shipping or refund policy.
9. Do not invent sources, stats, reviews, or case studies.
10. No federal tax-credit (25C) language for equipment installed in 2026 or later. See `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/home-service/compliance.md`.
11. Advertised equipment prices follow the brand's current MAP/UPP policy; product schema never shows a lower price than the page or cart policy allows.
12. Brands carried: Lennox and Trane only. No brand-vs-brand price claims.

## Never say
- Any prior brand name.
- A physical location for customer visits. **CONFIRM** whether one exists before any page or schema mentions one.
- The Baltimore / Timonium / Lutherville showroom or Deereco Road addresses from the v1 files. They belong to Got Ductless (agency owner, 2026-09-29).

Voice: practical, phone-first, installer-aware, no hype. Help homeowners and contractors choose equipment, then finish online.
