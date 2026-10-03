---
name: seo-research
description: Research a keyword and page type against Google, score the top 5 ranking pages (intent, word count, keyword density, related terms, headings, interlinking), then output a HVAC USA content brief for content-outline. Triggers include SEO research, keyword research, SERP analysis, content brief, semantically related keywords, keyword variations, LSI terms, top ranking pages, keyword density, interlinking strategy, write requirements for a page.
---

> version 1.0-accepted · origin: tharros-original (pre-v4 HVAC USA copy pipeline; no upstream text; no earlier version tag) · repointed 2026-09-29 (v4.1) · accepted 2026-10-03 (Cerevex Skills Integration Brief 1.0 slice 1)

# SEO Research

Turn a keyword + page type into a writeable brief. Do not write the page in this skill unless the user asks. Hand the brief to `content-outline`.

Read `references/page-types.md` before classifying the page. Read `references/serp-method.md` before scraping. Read `references/related-terms.md` when building the variant list. Read `references/internal-links.md` when building the interlink plan. Fill `assets/brief-template.md` as the return format.

## Client facts (HVAC USA)

Read before writing requirements: `/home/box/agent-data/workflows/tharros-shared-references/references/clients/hvac-usa/profile.md` (brands, CTAs, never-say), `/home/box/agent-data/workflows/tharros-shared-references/references/clients/hvac-usa/copy-rules.md` (binding), and `/home/box/agent-data/workflows/tharros-shared-references/references/clients/hvac-usa/voice.md`. HVAC USA sells **Lennox and Trane** only and ships online; it has no confirmed customer-visit location. The legacy Baltimore / Timonium / Lutherville showroom, Deereco Road addresses, and mini-split brand list belong to Got Ductless (`/home/box/agent-data/workflows/tharros-shared-references/references/clients/got-ductless/profile.md`, all CONFIRM with Adam) and never go in an HVAC USA brief, outline, or draft.

Prompt layer: after the profile, load the client's Cerevex prompt layer per `/home/box/agent-data/workflows/tharros-shared-references/references/prompt-layer.md` (precedence, conflict flags, silent fallback when none exists).

## Input

Need a **primary keyword**. Infer the rest when obvious. Ask only if a wrong guess would produce the wrong brief.

| Field | Required | Notes |
|---|---|---|
| Primary keyword | yes | The query the page should win, not a title brainstorm |
| Page type | infer | pdp, collection, money-page, educational, comparison, local, faq, contractor |
| Target URL | no | Existing hvacusa.store URL if this is a refresh |
| Segment | infer | homeowner one-room, whole-home, DIY, contractor, property, federal |
| Extra terms | no | User-supplied seeds only. Related terms still come from the SERP |

If the keyword is a model number, treat page type as **pdp** unless the user says otherwise.

## Revenue test

The brief must name one job: rank-and-convert on a money query, pre-sell a call / design request, or arm a draft-order conversation. If the keyword cannot do one of those for HVAC USA, say so and propose a better query before spending scrape time.

## Workflow

### 1. Classify intent and page type

Run `web_search` on the exact primary keyword (and the same query plus the current year only if the SERP is clearly seasonal or refrigerant-transition related).

Label dominant intent from the actual results, not from a textbook:

- **Transactional** — PDPs, add-to-cart collections, “for sale / buy / price”
- **Commercial investigation** — “best,” brand vs brand, DIY vs pro, sizing-to-buy
- **Informational** — what / how / warranty / refrigerant explainers
- **Local** — city + equipment, store or showroom, installer-near-me. HVAC USA ships online with no confirmed visit location, so local intent is a **no-build** for HVAC USA (Got Ductless's Maryland store is a separate client; see its profile)
- **Navigational** — brand-direct or our brand name

Record People Also Ask, related searches, and which result types occupy positions 1–10 (shopping, videos, forums, maps). Forums and YouTube are context, not the five pages you measure.

### 2. Pick the five pages

Take the first five **organic HTML pages** that are real peers for this query.

Skip, and note why:

- Our own URLs (list them separately as “we already rank”)
- YouTube, Reddit, Quora, Facebook, Pinterest
- Pure map-pack listings with no page
- PDFs unless a PDF is actually ranking in the top 5
- Thin affiliate doorways if a stronger OEM or retailer is right behind them — prefer the stronger peer

Name the competitor set when they appear: HVACDirect, ACWholesalers, eComfort, Alpine Home Air, brand-direct Lennox / Trane dealers, Amazon, big-box.

### 3. Measure each page

For every URL, follow `references/serp-method.md`. You must collect:

- Title, H1, meta description if visible
- Word count of **main content** (not nav, cookie banner, or footer)
- Primary-keyword raw count and density
- Close-variant counts (plural, hyphenation, mini-split vs mini split vs ductless)
- Related phrases in titles, H2s, PAA, and body (see `references/related-terms.md`)
- H1 / H2 / H3 outline
- Internal links in the main content (count, anchor text, destination type)
- External links in the main content (count, whether they are OEM, YouTube, or citation)
- Modules that are not prose (tables, spec grids, FAQs, reviews, filters, CTAs, shipping widgets)
- Obvious unique claim (price-led, spec-led, DIY-led, installer-led)

Run `python3 scripts/analyze_text.py` on extracted main text whenever you have a text dump. Do not eyeball density.

If a page blocks fetching, record “blocked” and replace it with the next organic peer so you still have five measured pages when possible. Never invent word counts.

### 4. Synthesize the bar

Build one comparison table, then compute:

- Word-count **median** and range
- Density **median** and range for the primary keyword
- Related-term list scored by how many of the five pages use each phrase
- Heading topics that appear on 3+ of 5 pages (required coverage)
- Heading topics that appear on 1–2 pages (optional / differentiator)
- Interlink patterns (what they link to, typical anchor style, how many in-body links)

Choose the target format from the SERP, not from a “longer is better” rule. If money results are collection / PDP pages of 400–900 words plus filters, do not brief a 3,000-word essay. If guides own the query, brief a guide with a commercial close.

### 5. Write the brief

Fill `assets/brief-template.md`. The brief is the deliverable.

Hard rules for requirements:

- Target word count = median of the five pages that share our chosen format, plus 10–20% only if we have a real extra section (sizing caveats, warranty path, freight). Do not pad.
- Keyword density = stay inside the SERP median band. Treat density as a ceiling check, not a quota. When the writer would repeat the primary keyword, use a related term from the brief instead.
- Related terms = SERP-derived only. Cap at 8–15 on commercial pages and 12–20 on guides. Assign each term one placement (H2, FAQ, spec module, or body once). Do not attach a repeat quota to variants either.
- Never instruct the writer to copy a competitor sentence, table, or review.
- Interlink plan must use real or plausible hvacusa.store destinations from `references/internal-links.md`. Flag any URL that must be confirmed live.
- CTA default: **Call (913) 364-0070 — we'll size it, draft your order, then you buy online.** Shorter sizing help line allowed in chrome. Secondary CTA matches page type (add to cart, request a design).
- Fill the brief’s **Brand facts** block from our live catalog (Lennox and Trane only) and the hvac-usa profile. Do not copy a competitor’s BTU span, series list, or warranty years into that block.
- Collection required coverage includes: range/filter first screen, who it’s for, sizing (bands only if we have them), our series, indoor styles we stock, refrigerant/voltage match, warranty caveat, install BOM, short FAQ.
- Facts the writer must not invent: prices, stock, warranty years by brand, excluded shipping states, hours, installer coverage map, rebate amounts, min line-set length, kit wire gauge.
- Name the proof the page still needs (reviews, crate photo, spec sheet) instead of faking it.

### 6. Hand off

Default next skill is `content-outline`. Do not draft the page unless asked in the same turn. If this run was started by `hvac-copy-pipeline`, produce the brief and return control — do not stop for a paste-ready handoff.

End with a **Write this next** block the owner can paste:

- Skill to load: `content-outline`
- Page type / format mode
- Segment
- Primary keyword + related-term table
- Required H2s
- Word-count target
- CTA
- Facts to confirm

## Output shape

Return, in this order:

1. One-line revenue hypothesis
2. Intent + recommended format
3. SERP snapshot (types in 1–10, PAA, our current rank if seen)
4. Top-5 measurement table
5. Coverage map (must-have vs optional vs skip)
6. Related-term table (variant, type, pages used, where to place it)
7. Interlink plan
8. Full content brief (template)
9. Do-this-next (2–4 actions by expected dollars or time)

Skip preamble about “the HVAC SEO landscape.”

## Do not

- Stuff keywords or brief a density above the highest honest competitor without a new section that earns the words.
- Invent an LSI dump. If a phrase did not appear in the SERP, PAA, related searches, or on 2+ measured pages, it does not go on the related-term list.
- Recommend city or local pages for HVAC USA (online-only, no confirmed visit location). The Baltimore / Timonium / Lutherville showroom scope was Got Ductless's (CONFIRM with Adam), not HVAC USA's.
- Name any brand other than Lennox or Trane as carried, or brief a brand-vs-brand price claim.
- Tell the writer to DIY-sell a non-DIY refrigerant system.
- Promise manufacturer warranty on internet-sold equipment without the Pro-Install / authorized-channel caveat.
- Attack named competitors with undefendable claims.
- Use `/pages/contact` (historic 404). Prefer `/pages/contact-us` after confirming it is live.
- Treat Amazon or forum threads as the word-count model for a retailer money page.