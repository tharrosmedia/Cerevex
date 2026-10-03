# Verified facts register (universal, time-sensitive)

Facts that apply across verticals. Vertical facts (tax credits, EPA and license rules, MAP) live in each `verticals/<vertical>/compliance.md`. Each row has a verify-as-of date and a source. Before a fact goes into client-facing work, check the row is under 90 days old; if older, re-verify. A fact not in a register or the client profile with a source is unverified and gets `[confirm with owner]`.

"Secondary" means a trade or press source; re-check the primary source before relying on it.

## Ad platforms

| Fact | Verify as of | Source |
|---|---|---|
| OpenAI (ChatGPT) Ads: self-serve Ads Manager (beta) for US advertisers since May 2026, CPM and CPC bidding, conversion measurement via JavaScript Pixel and server-side Conversions API (Pixel ID + separate Conversions API key; pass click reference values such as `oppref`). | 2026-09-29 | openai.com/index/new-ways-to-buy-chatgpt-ads (blocked to fetch; seen in search), developers.openai.com/ads/conversion-tracking, help.openai.com "Measure Results"; Search Engine Journal (secondary) |
| ChatGPT ads show only to Free and Go plan users; Plus, Pro, Business, Enterprise, and Edu have no ads; not shown to users known or predicted to be under 18. | 2026-09-29 | help.openai.com "Ads in ChatGPT" |
| ChatGPT ads are limited to eligible categories that pass policy review. Financial services and health are restricted (case-by-case); political ads are not allowed. Confirm the client's category in Ads Manager (e.g. home services for Got Ductless; software for Cerevex). | 2026-09-29 | help.openai.com "Ads in ChatGPT"; category list from secondary sources |
| Google Ads offline conversion import with GCLID: upload within 90 days of the last ad click. Enhanced conversions for leads: within 63 days. | 2026-09-29 | support.google.com/google-ads/answer/15081888 (search summary); API uploads may be moving to the Data Manager API, check before building |
| Meta Special Ad Categories: Housing, Employment, Financial products and services (replaced "Credit" as of 2025-01-14; required for US financial products and services campaigns from 2025-01-21), plus social issues/elections/politics. Selecting housing, employment, or financial products and services limits targeting: age 18-65+ fixed, all genders, no ZIP or location exclusions, 15-mile minimum radius in the US and Canada, no lookalikes (Special Ad Audiences instead), restricted detailed targeting. | 2026-09-29 | developers.facebook.com/docs/marketing-api/audiences/special-ad-category; facebook.com/business/help/298000447747885 and /2220749868045706; AdFlint (secondary) for the targeting list |
| Google restricted targeting for Housing, Employment, and Consumer Finance ads in the US and Canada: no targeting by gender, age, parental status, marital status, or ZIP code; radius (min 1 km), city, and country targeting allowed; Canada may use postal FSA. Google updated the article in June 2026 to clarify Demand Gen and Discovery. | 2026-09-29 | support.google.com/adspolicy/answer/143465, /16700846, /17135641 |

Why the special-category rows stay: home-service clients may run financing-led offers (which can fall under financial products and services) and technician-hiring ads (employment). Check the category before building those campaigns.

## Messaging law (US)

| Fact | Verify as of | Source |
|---|---|---|
| Federal TCPA: no telephone solicitations before 8am or after 9pm, called party's local time. | Not re-verified 2026-09-29 | 47 CFR 64.1200(c)(1) |
| Florida and Oklahoma mini-TCPA laws: commercial solicitations only 8am-8pm recipient local time, and no more than 3 on the same subject in 24 hours; both treat texts as covered. Other states have their own rules. | 2026-09-29 | Fla. Stat. 501.616; law-firm summaries (secondary) |

## Reviews and endorsements (US)

| Fact | Verify as of | Source |
|---|---|---|
| FTC Trade Regulation Rule on the Use of Consumer Reviews and Testimonials (16 CFR Part 465) bans fake or AI-generated reviews, buying reviews conditioned on sentiment, undisclosed insider reviews, and review suppression; effective October 2024. | Not re-verified 2026-09-29 | ftc.gov; 16 CFR Part 465 |

Not legal advice. Anything a client relies on legally goes to their counsel.
