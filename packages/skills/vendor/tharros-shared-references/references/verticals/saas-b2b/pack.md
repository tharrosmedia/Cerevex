# SaaS / B2B vertical pack

For Tharros's own B2B brands. Active today: **Tharros Media** (the agency). **Cerevex** is an internal tool and is not marketed (cerevex profile status), so its rows below are dormant; do not use them unless the agency owner switches Cerevex marketing on. Tharros's buyers are home-service business owners, so load `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/home-service/pack.md` for the buyer's world (job types, seasonality, LSA, call handling). Compliance: `compliance.md` in this folder.

## Qualified outcome and value model
The profile picks the outcome. Defaults until the owner decides:

| Brand | Qualified outcome (pick one in the profile) | CAC event | Value basis |
|---|---|---|---|
| Cerevex (dormant) | Demo booked (held), trial started, or signup completed | First paid month | Plan price × expected paid months (trial→paid rate × retention); MRR and LTV once tracked |
| Tharros Media | Qualified discovery call booked | Signed client | Retainer value × expected term |

| Segment (plan tier, trade, company size) | Value per outcome ($) | Outcome → paid/signed % | Monthly churn % | Lag (outcome to paid) | Source + date |
|---|---|---|---|---|---|

- A form fill, email signup, or pricing-page view is diagnostic, not qualified.
- Report by signup-date cohort: trial→paid and retention show up weeks later.
- Formulas: `/home/box/agent-data/workflows/tharros-shared-references/references/outcome-economics.md`. Numbers the owner did not supply are `assumption`.

## Qualifying rules (starting point; the profile overrides)
- Is an HVAC or home-service operator (not a vendor, agency, job seeker, or student).
- Company size is a segment, not a filter, unless the profile says otherwise.
- Sub-labels for `/home/box/agent-data/workflows/tharros-shared-references/references/lead-classifier.md`: trade, company size (solo, 2-10, 11+ techs: owner to confirm bands), role (owner, office manager, marketer).

## Measurement specifics
- Events: page view → pricing view → signup or trial start → onboarding step → paid. Send the qualified outcome and the paid event server-side (Google enhanced conversions or offline import, Meta CAPI, OpenAI Conversions API if used) with the click id captured at signup.
- Demo booking tools: the booking confirmation (not the calendar page view) is the conversion.
- Product analytics and CRM are the system of record for trial and paid status; ad platforms are not.
- Checks: `/home/box/agent-data/workflows/conversion-tracking-audit/references/checklist.md` §forms and §offline (use the SaaS stage list above).

## Capacity
Tharros: new clients the team can onboard per month (owner-set number). If Cerevex is ever marketed with professionally managed ads, each new customer also uses team hours. Gate spend increases on it.

## Demand triggers (for `demand-seasonality-planner`)
| Trigger | Condition (shape) | Notes |
|---|---|---|
| Operator off-season | The months when the target trades are slower (from home-service pack triggers) | Owners have time to set up marketing; push demos and trials |
| Pre-peak | 4-8 weeks before a trade's peak season | "Get ads running before the rush" only if onboarding time allows |
| Product launch / feature release | Owner's release dates | Claims only for features that are live |
| Trade events | Industry shows or association events the owner names | Dates and presence from the owner |

## Channels (typical roles; confirm in the profile)
Google Search (operators searching for marketing help or software), Meta (operator audiences, retargeting site visitors), LinkedIn (agency owner posts; paid only if the owner opts in), YouTube and short video (product walkthroughs), SEO and AI search (comparison and "how do I get more HVAC leads" queries), email lifecycle for trials. `paid-media` holds platform rules.

## Creative notes
- Show the work without clients: a demo account or mock-up, never a client account, name, logo, or result (tharros-media profile rule, agency owner 2026-09-29).
- Speak to the operator's day: missed calls, slow season, not knowing which ads work. Plain words, per the profile's Voice section.
- Proof: no client names or client results for now, even with permission. Use process facts (what the agency does and how), not outcomes (`compliance.md` §2).

## SaaS / agency slop (add to `no-slop-copy` Detect)
"All-in-one platform," "revolutionize your business," "supercharge your growth," "AI-powered everything," "set it and forget it," "10x your leads," "done-for-you success," "cutting-edge solution," "seamless." Fix: what the product does, in one concrete step the operator recognizes.
