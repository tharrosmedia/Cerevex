# Universal claims rules (every client, every vertical)

Current as of 2026-09-29 (ET). **verify** rows were written from working knowledge and not re-checked in this pass. Vertical rules live in `/home/box/agent-data/workflows/tharros-shared-references/references/verticals/<vertical>/compliance.md`. Not legal advice.

## 1. Reviews, ratings, testimonials, endorsements
- FTC rule on consumer reviews and testimonials (16 CFR Part 465, effective Oct 2024): no fake or AI-written reviews, no buying reviews conditioned on sentiment, no undisclosed insider reviews, no suppressing negative reviews. **verify**
- FTC Endorsement Guides (16 CFR Part 255): material connections (paid, free product, employee, affiliate) are disclosed clearly; testimonials reflect typical results or say what is typical. **verify**
- Google: no review gating (asking only happy customers), no incentives for reviews.
- Ratings and counts need source and date ("4.8 on Google, 312 reviews, as of <date>").
- Customer names, photos, quotes, and before/after images only with permission noted in the profile.
- One client's reviews or results never appear in another client's marketing without that client's written permission, recorded in its profile.
- Tharros Media and Cerevex marketing never name a client or cite, show, or imply any client's results, even with permission (agency owner, 2026-09-29; tharros-media profile). `fail`, fix: remove.

## 2. Superlatives, identity, availability, guarantees
- "#1," "best," "top-rated," "most trusted," "lowest price": named, dated source, or `fail`.
- "Family-owned," "locally owned," years in business, awards: only if the profile states it with a source.
- Hours, response times, "same-day," "24/7," shipping speed: must match the profile.
- Guarantees and warranty terms: owner- or legal-approved text only.

## 3. Prices and offers (general)
- Every price, discount, and offer has a source (client price list, promo brief) and an end date if limited.
- "Free" means free: conditions stated next to the claim.
- Vertical pricing rules (MAP, financing, rates) come from the vertical pack.

## 4. Platform policy
- Meta personal attributes: do not assert or imply the viewer's personal traits, finances, health, or other sensitive attributes ("Struggling to pay your bills?"). **verify**
- Special Ad Categories (Meta) and restricted targeting (Google) for housing, employment, and financial products: `/home/box/agent-data/workflows/tharros-shared-references/references/verified-facts.md`. For Tharros clients this mostly means financing-led offers and technician-hiring ads. A campaign in a covered category with age, gender, ZIP, or lookalike targeting is `fail`.
- No fake native UI (message, notification, or system-dialog look-alikes).
- Health, financial, and other restricted categories on each platform (including ChatGPT Ads): confirm the category is approved in the account.
- Trademarks in ad text: follow each platform's trademark policy and the owner's authorization. **verify**

## 5. Messaging (email / SMS)
- Marketing SMS needs prior express written consent; transactional and marketing streams stay separate. Quiet hours and state rules: `/home/box/agent-data/workflows/tharros-shared-references/references/verified-facts.md`; details in `lifecycle-messaging`.
- Email: accurate sender and subject, physical address, working unsubscribe (CAN-SPAM).

## 6. Sources and stats
- No invented stats, studies, or quotes. Every number has a source and date, or it is removed or marked `[confirm with owner]`.
