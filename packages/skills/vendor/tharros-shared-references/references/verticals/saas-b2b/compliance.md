# SaaS / B2B compliance pack

Loaded by `claims-check` for tharros-media (and for cerevex only if its marketing is switched on; today it is internal-only). Universal rules (FTC endorsements and reviews, superlatives, pricing basics, platform policy, messaging): `/home/box/agent-data/workflows/claims-check/references/universal-rules.md`. Current as of 2026-09-29 (ET); **verify** rows were not re-checked in this pass. Not legal advice.

## 1. Results claims (the main risk)
- **No guaranteed results.** No "guaranteed leads," "guaranteed ROI," "double your calls," or any promised number of leads, jobs, or revenue. `fail`.
- Performance claims ("customers see X% more booked jobs") need substantiation before they run: a documented, representative data set with the period, sample size, and method, saved in the profile. The FTC expects advertisers to have a reasonable basis for objective claims. Without it: `needs_source`.
- A single customer's result is not typical. If shown, it needs permission and a clear statement of what results customers generally achieve, or no implied typicality. (FTC Endorsement Guides, 16 CFR Part 255, §255.2.) **verify** wording against the current Guides
- "Affordable," "professionally managed," "for any HVAC operator": allowed as positioning when true. What "professionally managed" includes (who manages, how often) must match the plan terms, or the claim is `needs_source`.

## 2. Testimonials, reviews, case studies
- Real customers only, with written permission recorded in the profile. No fake, composite, AI-generated, or paraphrased-as-quote testimonials. (FTC Consumer Reviews and Testimonials Rule, 16 CFR Part 465, effective October 2024: `/home/box/agent-data/workflows/tharros-shared-references/references/verified-facts.md`.)
- Disclose material connections: free accounts, discounts, payment, or a business relationship with the reviewer (e.g. a customer who is also a Tharros agency client). (16 CFR Part 255.) **verify**
- No review gating or suppressing negative reviews on review sites (G2, Capterra, Google).
- **Tharros and Cerevex marketing: no client names and no client results, for now (agency owner, 2026-09-29).** No client name, logo, screenshot, quote, review, number, or case study, and no "our clients get X" claim, even with the client's permission. `fail`, fix: remove. The agency owner lifts this only by editing the tharros-media profile.

## 3. Product and AI claims
- Features only if live today. "Coming soon" items say so, with no date the owner has not set.
- AI claims: describe what the feature does; no "AI does it all," "fully autonomous," or accuracy claims without substantiation. The FTC has brought cases over deceptive AI claims (Operation AI Comply, 2024). **verify**
- Integrations and partner logos (Google, Meta, FSM tools) only per each partner's brand and partner-program rules; no implied endorsement ("Google-approved") without a current partner status in the profile.

## 4. Pricing, trials, subscriptions
- Price, plan contents, and trial length exactly as on the pricing page on file (date checked).
- "Free trial": state if a card is required and what happens at the end. Auto-renewal needs clear terms before billing, express consent, and an easy way to cancel: federal ROSCA; the FTC's 2024 "click to cancel" amendments were reported vacated in July 2025 (**verify** current status); state auto-renewal laws apply, and some cover B2B sales. **verify**
- "No contract," "cancel anytime" only if the terms say so.

## 5. B2B messaging
- Cold email to operators: CAN-SPAM applies to B2B email (identify the sender, physical address, working unsubscribe, honest subject line).
- Texts to operators need the same TCPA consent as consumer texts (`/home/box/agent-data/workflows/lifecycle-messaging/references/compliance.md`).
- Scraped contact lists: do not recommend buying or scraping lists.

## 6. Platform
- Google and Meta: software and marketing-services ads are generally allowed; "guaranteed results" and misleading claims break misrepresentation policies. **verify** before launch.
- ChatGPT Ads: confirm the software category is eligible in Ads Manager (`/home/box/agent-data/workflows/tharros-shared-references/references/verified-facts.md`).
- LinkedIn ads (if the owner opts in): check LinkedIn's advertising policies before launch. **verify**
