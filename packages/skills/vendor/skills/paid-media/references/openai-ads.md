# OpenAI (ChatGPT) Ads

A real self-serve channel as of 2026. Facts: `/home/box/agent-data/workflows/tharros-shared-references/references/verified-facts.md`, checked 2026-09-29.

- **Eligibility first:** confirm the client's category is approved in Ads Manager and ads pass policy review. Financial services and health are restricted (case-by-case), so financing-led angles may not run. Got Ductless (HVAC equipment retail) runs this channel per the roster. Cerevex is not marketed.
- **Audience reality:** ads show only to Free and Go users (not Plus, Pro, Business, Enterprise, or Edu), and not to users known or predicted to be under 18.
- **Start:** geo-targeted CPC campaign, capped budget, on research-style queries for the client's segments (e.g. comparison and "is X worth it" questions).
- **Measure before scaling:** OpenAI Pixel + Conversions API sending the qualified outcome (`offline-conversions.md`).
- **Holdout:** keep a small geo or time holdout; judge on incremental qualified outcomes (`attribution`).
- **Organic vs paid:** organic mention rate (`ai-search-visibility`) and paid ChatGPT ads are separate. Recommend a paid test mainly where organic mention rate is low.

## Spec table
Last verified: 2026-09-29. Creative limits from secondary guides citing OpenAI help; confirm in Ads Manager.

| Item | Setting / limit | Verified |
|---|---|---|
| Buying | Self-serve Ads Manager (beta, US), CPM or CPC bidding | 2026-09-29 (OpenAI, SEJ) |
| Measurement | JavaScript Pixel, Conversions API (Pixel ID + Conversions API key), click-through and view-through reporting | 2026-09-29 (OpenAI developer docs, help center) |
| Ad creative | Title (≤50 characters), description (≤100 characters), square image (1:1, PNG/JPG, up to 1200x1200) | 2026-09-29 (secondary) |
| Audience | Free and Go users only | 2026-09-29 (OpenAI help center) |
