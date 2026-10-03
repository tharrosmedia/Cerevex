# E-commerce compliance pack (HVAC equipment)

Loaded by `claims-check` for e-com clients (today: hvac-usa, got-ductless). Universal rules: `/home/box/agent-data/workflows/claims-check/references/universal-rules.md`. Equipment rules: `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/home-service/compliance.md` §equipment. Current as of 2026-09-29 (ET); **verify** rows were not re-checked in this pass. Not legal advice.

## 1. MAP / UPP and pricing
- MAP/UPP is a manufacturer policy (a contract matter, not a statute): advertised prices at or above the brand's current policy. If the policy hides price until cart, the ad, page, feed, and `Offer` schema must not show a lower price. No policy document in the profile = `needs_source`.
- Price comparisons ("was $X," "compare at," "% off") need a genuine former price or a real comparable price. FTC Guides Against Deceptive Pricing, 16 CFR Part 233; state laws vary. **verify**
- Feed price, landing-page price, and checkout price must match (Merchant Center policy).
- "Free shipping" must match the shipping policy on file, including freight exclusions and residential or liftgate fees.

## 2. Shipping and returns
- Shipping-time claims: FTC Mail, Internet, or Telephone Order Merchandise Rule (16 CFR Part 435): ship within the stated time, or within 30 days if none stated, or get consent to delay. **verify**
- Freight and damage-inspection instructions must match the posted policy.
- Return, restocking-fee, and refund claims must match the posted policy.

## 3. Brands, authorization, warranty
- Brand names and logos only with authorization in the profile; follow the brand's guidelines. Trademark use in Google ad text: resellers have specific allowances. **verify** Google's current trademark policy.
- Dealer-tier or "authorized dealer" claims only with current proof in the profile.
- Manufacturer warranty claims carry the brand's conditions (authorized channel, registration, professional install). Internet-sold equipment caveats: `/home/box/agent-data/workflows/tharros-shared-references/references/clients/hvac-usa/copy-rules.md` and home-service §equipment.

## 4. Product claims
- Efficiency ratings (SEER2, EER2, HSPF2, AFUE) and Energy Star status only from the manufacturer spec sheet or AHRI listing, with the date checked.
- "Made in USA": FTC standard (all or virtually all), 16 CFR Part 323 for labels. **verify**
- No health or air-quality claims beyond what the product labeling supports ("filters allergens" is fine; medical claims are not).
- Tax-credit and rebate lines follow home-service §equipment (federal 25C ended for installs after 2025-12-31).
