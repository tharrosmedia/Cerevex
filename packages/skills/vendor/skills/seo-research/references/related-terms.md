# Related terms

The primary keyword earns title, H1, and first screen. Everything else on the page should prefer a **related term** over another repeat of the head phrase.

Do not build this list from memory. Mine it from the SERP, then assign each term one job.

## Sources, in order

1. Exact-query `web_search` titles and snippets
2. People Also Ask / related-search phrasing
3. H1 and H2 text on the five measured pages
4. Body phrases that appear on **2+** of those pages (use `analyze_text.py` n-grams plus manual scan)
5. User-supplied seeds, only if they also show up in 1–4

Discard a phrase that fails all five.

## Four buckets

| Type | What it is | Example for “12,000 BTU mini split” | Use |
|---|---|---|---|
| close-variant | Same query, different spelling or punctuation | mini-split, 12k BTU mini split, 12000 BTU | One in an H2 or image alt. Do not treat as a new topic. |
| synonym | Same product, different words people type | ductless mini split, ductless heat pump, wall-mounted mini split | Body or H2 instead of repeating the primary. |
| entity | Spec or part the page must name | SEER2, R32, R454B, 230V, line set, condenser, air handler, hyper-heat | Spec module, what’s-in-the-box, one sentence. |
| question | PAA phrasing | how many square feet will a 12,000 BTU mini split cool | FAQ item or the H2 that answers it. |

A term can only live in one bucket. Prefer the tightest bucket (close-variant before synonym).

## HVAC families to check — only keep hits

Scan the five pages for these families when they match the query. Do not dump the whole family onto every brief.

- Form factor: mini split, mini-split, ductless, ductless heat pump, ductless AC, split system
- Indoor style: wall-mounted, floor console, ceiling cassette, slim duct / air handler
- Capacity speech: 9k / 12k / 18k / 24k and the comma form (12,000). Do not merge 12k with “1 ton.”
- Heat: heat pump, hyper-heat, hyper heat, low-ambient, heating capacity
- Efficiency: SEER2, HSPF2, EER2
- Refrigerant: R32, R454B, R410A (only if the page is a matchup or transition explainer)
- Electrical: 115V, 230V, disconnect, circuit
- Install path: DIY, pre-charged line set, professional installation, Certified Start-Up
- Job: single-zone, multi-zone, zone, condenser, branch box
- Rooms we actually sell into: sunroom, garage, addition, basement, bedroom, office

## Scoring

For each surviving term record:

- **pages** — how many of the five use it (heading or body)
- **where they put it** — title, H2, FAQ, spec table, body
- **intent risk** — drop it if it would pull a different job (installer-near-me on a national PDP, DIY on a licensed-install Lennox or Trane page, medical air claims)

Keep:

- Commercial page: 8–15 terms
- Guide / comparison: 12–20 terms

Sort by pages-used, then by usefulness to a buyer. Cut the rest.

## Placement rules for the brief

Assign every kept term **one** placement:

- `title` — reserved for the primary keyword. Close-variants only if the title would sound broken without one.
- `h1` — primary only, unless the H1 is a model number and the synonym is the product type.
- `h2` — the section that owns that topic. One related term per H2 max.
- `faq` — question-bucket terms.
- `spec` — entities.
- `body-once` — synonym that should appear in the section summary instead of a second primary-keyword hit.
- `alt` — one close-variant if we control an image.

Never assign `repeat 4x`. If the outline would say the primary keyword again, it should say the assigned related term instead.

## Do not put on the list

- Competitor brand names unless the page is a comparison
- Cities we do not serve in person
- Model numbers we do not sell
- Synonyms that change the product (window unit, portable AC, PTAC) unless the page is explicitly contrasting them
- Stuffing strings (“best cheap 12000 BTU mini split for sale online”)
- Invented LSI (“climate control solution,” “home comfort ecosystem”)

## Pass to content-outline

The related-term table is part of the brief. `content-outline` must hang each term on a section. If a term has no section that can say it naturally, drop the term — do not add an H2 just to park a synonym.
