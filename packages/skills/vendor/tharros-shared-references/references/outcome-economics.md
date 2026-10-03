# Outcome economics (required input)

Every client has one **qualified outcome** and a **value model**, both set in `clients/<client>/profile.md`. All paid, attribution, and reporting work measures against them. Leads, clicks, and CPL are diagnostic only.

## Qualified outcome by business model

| Business model | Qualified outcome (default; the profile overrides) | Value | Typical lag | Vertical pack |
|---|---|---|---|---|
| booked-service (local service) | Booked job or appointment; sold job for CAC | Avg ticket × close rate by job type; actual invoice when sold | Same day to weeks (replacement) | `verticals/home-service/` or `verticals/local-other/` |
| lead-gen | Qualified lead per the client's definition | Expected value per stage from the client's CRM | Days to weeks | `verticals/local-other/` |
| e-com | Purchase (net of returns/cancels where known) | Order value or gross margin; first-order vs repeat; LTV for subscription or replenishment | Minutes to days; LTV over months | `verticals/ecommerce-dtc/` |
| saas-b2b (agency brand; Cerevex dormant) | Demo booked, trial started, or signup, per the profile; paid conversion or signed client for CAC | Expected value per stage (trial → paid rate × first-year value, or signed-client value); MRR/LTV once tracked | Days to months | `verticals/saas-b2b/` |
| brand / no conversion yet | None defined: say so and propose one | n/a | n/a | profile |

## Input table (fill per segment from the client's data)

| Segment (job type, product line, plan tier) | Value per outcome ($) | Margin % | Lead or visit → qualified % | Qualified → sold/paid % | Lag | Source + date |
|---|---|---|---|---|---|---|

Numbers the client did not supply are labeled `assumption` and lower confidence to `low`.

## Formulas

- CPL = spend ÷ leads (diagnostic only)
- Cost per qualified outcome = spend ÷ qualified outcomes
- CAC = spend ÷ new customers (sold jobs, first orders, paid accounts or signed clients; say which)
- ROAS = attributed revenue ÷ spend. Margin ROAS = gross margin $ ÷ spend.
- Break-even cost per qualified outcome = value per outcome × margin % × downstream close rate
- Expected value for value-based bidding = value per outcome × downstream close rate at the stage sent

## Reporting rules

- Every output shows the diagnostic metric (CPL or CPC) next to cost per qualified outcome and CAC or ROAS, split by segment.
- Long-lag segments (replacement jobs, trial-to-paid, subscription LTV) are reported by lead-date or first-order cohort.
- A segment with fewer than about 10 qualified outcomes in the period is marked as a small sample.
