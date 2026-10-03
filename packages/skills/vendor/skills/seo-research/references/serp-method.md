# SERP measurement method

Goal: five comparable measurements. Same extraction rules on every URL.

## Tools

1. `web_search` — ranked list, snippets, PAA-like questions in titles.
2. `browse_page` — first pass for title, outline, and a main-text extract. Instructions must ask for visible body copy only.
3. `browser_tab` — use when you need links, headings, or a cleaner main-text dump. Run the snippet below.
4. `python3 scripts/analyze_text.py` — word count and density. Required once you have text.

Do not use shopping widgets or ads as organic peers.

## browser_tab extractor

After the page loads, run JS equivalent to:

```javascript
const root = document.querySelector('main, article, [role="main"], #MainContent, .product, .page') || document.body;
const junk = root.querySelectorAll('nav, footer, header, noscript, script, style, iframe, form[action*="search"], .cookie, #cookie');
junk.forEach(el => el.remove());
const headings = [...root.querySelectorAll('h1,h2,h3')].map(h => ({tag: h.tagName, text: (h.innerText || '').trim()})).filter(h => h.text);
const links = [...root.querySelectorAll('a[href]')].map(a => ({
  text: (a.innerText || '').trim().replace(/\\s+/g, ' '),
  href: a.href
})).filter(l => l.href && l.text && l.text.length < 120);
const origin = location.origin;
const internal = links.filter(l => l.href.startsWith(origin));
const external = links.filter(l => /^https?:/.test(l.href) && !l.href.startsWith(origin));
const text = (root.innerText || '').replace(/\\s+/g, ' ').trim();
return {
  url: location.href,
  title: document.title,
  canonical: document.querySelector('link[rel="canonical"]')?.href || null,
  meta: document.querySelector('meta[name="description"]')?.content || null,
  h1: document.querySelector('h1')?.innerText?.trim() || null,
  wordGuess: text.split(/\\s+/).filter(Boolean).length,
  headings,
  internalCount: internal.length,
  externalCount: external.length,
  internalSample: internal.slice(0, 25),
  externalSample: external.slice(0, 10),
  text: text.slice(0, 24000)
};
```

Write the returned `text` to a temp file under `/tmp` and run the analyzer. Do not store competitor full text in the project folder.

## Word count

- Count words in extracted **main text** only.
- Strip menus, breadcrumb duplicates, related-product carousels that repeat the same 8 words fifty times, cookie banners, and footer boilerplate.
- If a collection page is 80% product-card titles, report two numbers: **prose words** and **page words including cards**. Target our prose to the prose number. Do not try to beat 12,000 words of SKU titles.

## Keyword density

Run the script with `--keyword` set to the user’s primary phrase.

Also run once with common HVAC variants when relevant:

- mini split / mini-split / minisplit
- ductless / ductless mini split
- the brand name
- the BTU form they used (12,000 / 12000 / 12k / 12 ton is **not** the same — do not merge 12k with 1 ton)

Density = (exact phrase count / word count) * 100.

Report:

- exact-phrase count
- density % to two decimals
- variant counts separately

Interpretation:

- Median of the five pages is the **band center**.
- Brief a target band of about 0.7× to 1.3× that median.
- If median density is already > 2.0%, call it stuffed and brief **topic coverage** instead of matching the stuffing.
- Title, H1, first 100 words, one H2, and image alt (if we control it) are enough placements for the **primary** keyword. The brief should say that. Do not assign “use the keyword 14 times.”
- Pull candidate related phrases from the same text dump. Pass frequent 2- and 3-grams plus heading phrases into the related-term filter in `references/related-terms.md`. Count promising variants with `analyze_text.py --variant`.

## Headings

Normalize before comparing:

- Lowercase
- Strip brand homepages and “buy now”
- Group synonyms (“what size do I need” = “BTU sizing” = “how many BTUs”)

A topic is **required** when 3+ peers cover it in an H2/H3 or a dedicated module.

A topic is **optional** when 1–2 peers cover it and it matches a HVAC USA advantage (warranty path, freight, Certified Start-Up, multi-zone design call).

Skip topics that would force DIY charge procedures, medical claims, or fake local pages.

## Interlinking

Classify each in-body internal link:

- pdp
- collection / brand
- educational
- support / warranty / shipping policy
- tool / calculator
- other

Record anchor style: exact keyword, partial, branded, generic (“learn more,” “click here”).

Pattern to steal (structure, not copy):

- Collection pages that link up to a buying guide and down to 3–6 PDPs
- Guides that link to one primary collection and the contact/design path
- PDPs that link to compatible outdoor/indoor, line sets, and the parent collection

Do not count footer sitewide links as strategy. Only main-content links.

## Blocked or JS-heavy pages

Try `browser_tab` once. If still empty:

- Mark the row `blocked`
- Use title + snippet + whatever outline is visible
- Pull the next organic peer so the table still has five rows when you can

Never fabricate a word count or density to fill the cell.

## Our own URL

If hvacusa.store already ranks:

- Measure it with the same method
- Put it in a “current property” note, not as one of the five competitors
- Call out gaps vs the median (missing H2, thin word count, no internal links, no FAQ)

## Time box

Five pages, one search, one year-modifier search only if needed. If a single URL eats the budget, skip to the next peer and note it.
