# Eval

Run after Write or Edit. Pass / fail. Fix failures before returning.

Detect jobs skip the rewrite checks. They must still name pattern, quote, severity, and fix: no authorship guess, no score.

## Meaning and facts

1. No invented prices, stock, rates, warranty terms, shipping regions, hours, rebates, tax credits, reviews, stats, licenses, or availability.
2. Protected phones, emails, CTAs, legal lines, and required disclosures from `/home/box/agent-data/workflows/tharros-shared-references/references/clients/<client>/profile.md` are intact when used.
3. Every rule in the client's `copy-rules.md` holds (for hvac-usa: DIY vs licensed-startup not blurred; Pro-Install / authorized-channel caveat present when manufacturer coverage is mentioned; multi-zone copy does not sum indoor nameplates; square footage is only a starting point).
4. Vertical compliance rules hold (e.g. home service: licensed-install work not framed as DIY; HVAC e-com: no price below MAP; saas-b2b: no guaranteed results, testimonials only with permission).
5. Warranty and guarantee claims carry the client's stated conditions when coverage is mentioned.
6. Nothing was borrowed from another client's profile.
7. `claims-check` ran on every in-scope claim and returned pass, or each fail is fixed or marked `[confirm with owner]`.
8. Fact-diff list present on Edit; no unsupported additions.

## Voice

1. The piece still sounds like the client's Voice section / `voice.md` or like the writer who handed you the draft.
2. Strong human sentences were left alone.
3. Cutting was proportional. Character was not compressed out.
4. Spoken fillers remain only where they carry voice.
5. A sharp practitioner in the client's category would not call it brochure copy.

## Slop

1. Binary contrasts, negative listings, rhetorical setups, empty openers, and arguing-with-no-one are gone (or marked `low` and rare).
2. Faux-insight, colon reveals, superficial `-ing` clauses, fake-strong verbs, synonym cycling, dramatic fragments, repeated openings, and robotic rhythm are fixed.
3. Importance puffery, vague association, and weasel attribution are replaced with named facts or removed.
4. Metadiscourse, writing-about-the-document, heading echoes, and "here's why that matters" labels are gone.
5. Fake-profound kickers were deleted, not rewritten as prettier metaphors.
6. Portable-claim slop and the vertical pack's slop list (e.g. "comfort solutions," "curated for you," "supercharge your growth," unsourced "#1") are gone.
7. The piece ends on a concrete point or next action.
8. Formatting matches the mode (no heading soup in email/SMS; review replies under 80 words).
9. Dashes are sparse, not a tic.
10. Whether-you're, from-X-to-Y, invented frameworks, soft asks, stacked qualifiers, and portable competitor filler are gone.

## Portability pair

1. Every generic sentence was cut or tied to a client fact.
2. Reverse test: specific client facts (phone, specs, fit, freight, service area, product terms) still present if they belong.

## Revenue test

1. The piece moves the reader toward the client's qualified outcome, closes a draft order, estimate, or open trial, raises ticket or AOV, or saves sales/CSR time. If not, the higher-leverage version was offered.

## Output shape

1. Write: full copy + implementer notes + facts to confirm.
2. Edit: full draft + short What changed + fact-diff + the content-editor handoff line (unless started by `hvac-copy-pipeline`).
3. Detect: pattern / quote / severity / fix only.
4. Do-this-next present on content tasks (not tiny line-edits).
