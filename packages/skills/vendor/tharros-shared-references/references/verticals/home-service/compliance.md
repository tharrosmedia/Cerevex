# Home-service compliance pack

Loaded by `claims-check` for home-service clients, and §Equipment for HVAC equipment sellers (e.g. hvac-usa). Universal rules (reviews, superlatives, platform policy, messaging) are in `/home/box/agent-data/workflows/claims-check/references/universal-rules.md`. Rules current as of 2026-09-29 (ET); **verify** rows were not re-checked in this pass. Not legal advice.

## 1. Consumer financing (TILA / Regulation Z)
| Situation | Rule | Compliant options |
|---|---|---|
| Closed-end credit ad states a **trigger term**: amount or % of down payment, number of payments or repayment period ("60 months"), payment amount ("$89/mo"), or finance charge | Must also state down payment, repayment terms, and APR (and that it may increase, if so). 12 CFR 1026.24(d). **verify** | Short: "Financing available, subject to credit approval." Full: the financing provider's approved disclosure from the profile, verbatim |
| Open-end credit (revolving plans), deferred interest ("no interest if paid in full in 12 months") | Separate rules, 12 CFR 1026.16. **verify** | Financing provider's approved text only |
| "0% APR for 60 months" | Contains a repayment period: trigger | Full disclosure, or the short line |
| No financing-provider text on file | `needs_source`; use the short line | |

Platform: financing-led creative can fall under Meta's Financial products and services Special Ad Category and ChatGPT Ads restricted financial rules (`/home/box/agent-data/workflows/tharros-shared-references/references/verified-facts.md`).

## 2. Licenses and trade credentials
- Several states require the contractor license number in advertising; rules differ by trade and medium. Record rule, source, date per state in the profile. Missing = `needs_source`. **verify per state**
- "Licensed and insured," "EPA 608 certified," "NATE-certified," "permits pulled" only if the profile lists it as current. EPA Section 608 certification applies to technicians who handle refrigerant; do not imply a company certification the profile does not show. **verify**

## 3. Manufacturer brands, dealer tiers, co-op, MAP
- Manufacturer name or logo only if the profile shows authorization; follow the brand's current guidelines.
- Dealer-tier names only if current, checked within 90 days. Lapsed or unknown = `fail`.
- Advertised equipment prices at or above current MAP/UPP; see `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/ecommerce-dtc/compliance.md` §MAP.
- Co-op-funded creative follows the program's rules (`co-op-claim-pack`).

## 4. Tax credits and rebates
| Fact | Verify as of | Source |
|---|---|---|
| Federal 25C is not allowed for property placed in service after 2025-12-31 (installation complete by that date). No 25C / "30% federal tax credit" claim for 2026 installs: `fail`. | 2026-09-29 | IRS FAQ FS-2025-05 on P.L. 119-21: irs.gov/newsroom/faqs-for-modification-of-sections-25c-25d-25e-30c-30d-45l-45w-and-179d-under-public-law-119-21-139-stat-72-july-4-2025-commonly-known-as-the-one-big-beautiful-bill-obbb |
| Federal 25D (includes geothermal heat pumps) not allowed for expenditures after 2025-12-31. | 2026-09-29 | Same IRS FAQ |
| State HEEHRA/HOMES and utility rebates vary by state and are often income-qualified. Never state amount or eligibility without program URL and check date in the profile. | 2026-09-29 (rule) | No program list verified |

Stale page copy is the common failure; check old pages and templates.

## 5. Badges and availability
- "Google Guaranteed" / "Google Screened" only if active in LSA (screenshot under 90 days).
- "Same-day," "24/7," "we answer every call" must match answered hours and emergency coverage in the profile.
- Warranty and guarantee text: owner-approved only; manufacturer warranty carries brand conditions (registration, licensed install, authorized channel).

## 6. Equipment and safety (also for HVAC equipment e-com)
- Refrigerant transition (R-410A to A2L such as R-454B, R-32): pricing, availability, regulatory claims only as the manufacturer or brief states, dated. No "R-410A is illegal" overclaims.
- No DIY instructions for systems that need licensed install; pre-charged DIY lines are a separate category.
- IAQ and health: manufacturer-stated performance only; no medical claims.
- Carbon monoxide / fire: only what the brief and code support.

## 7. Platform
- Meta personal attributes: "Is your AC broken?" fine; "Struggling to pay your bills?" not. **verify**
- ChatGPT Ads: local services reported eligible (secondary sources); financing angles may be restricted. Confirm in Ads Manager.
