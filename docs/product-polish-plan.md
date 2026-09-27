# Product polish plan

Goal: make every page understandable to a store owner on first visit. Today most pages work, but they read like engineering notes, hide the parameters they use, and give little feedback after an action.

The Search Console page is the reference case. The button says "Sync 28 days", the window is fixed in code, the user can't pick Google's standard ranges or a custom range, and the copy explains what the page *doesn't* do ("this page does not flip it"). Almost every page has some version of this.

This plan was scoped from a full read of `apps/brain` (console) and `apps/ads/web` (legacy ads cockpit). File and line references are as of `c7f984d`.

---

## 1. What's wrong, by pattern

| # | Pattern | Where it shows up |
|---|---|---|
| P1 | **Hidden or hard-coded parameters.** Actions bake in a value the user should choose, or hide which period a number covers. | GSC "Sync 28 days" (`app/seo/search/page.tsx:69,134`, `app/settings/page.tsx:665`, `components/gsc-property-field.tsx:80`, `jobs/seo/src/functions/gsc-sync.ts:13`). Ads spend cards say "From the last check" but are 30-day (`app/ads/page.tsx:191-196`). Creatives always label "Spend (30 days)" even when falling back to another window (`app/ads/creatives/page.tsx:101-125`). No account/campaign/date picker on Check or Sync. |
| P2 | **Engineering language in the UI.** Milestone codes, flag names, env vars, internal names, and "this page does not…" notes. | "Brief / Research / Gate (P2)", "Re-send to Inngest", "Capability flags", "(M5.2)", "kill switch", "Flip the cockpit flag", "this slice", "Site Brain redeploy", "Approve is limited to Adam during soft-launch", `APP_PASSWORD`, `CALLRAIL_*`, "mock (QA)", "Pilot client name and URL are still TBD", "Tokens stay in the spine". |
| P3 | **Inconsistent vocabulary.** Same concept, different names across pages. | Findings vs Recommendations (nav says Recommendations, URL/cards/empty states say findings). Suggestions vs Recommendations (ads). Check vs Audit vs Sync. Deny vs Dismiss vs Dismissed. Snooze vs Later. Leads vs Brainstorm. Approve vs authorized. Sync vs Sync now vs Sync 28 days. |
| P4 | **Async actions without closure.** Background jobs show "queued" and then nothing; the user has to refresh or guess. | GSC sync (flash says the table updates, but the page never refreshes), catalog check, create job, recommendations refresh, ads Sync (partial failures reported as success, `components/ads/sync-ads-button.tsx:44-45`), funnel connect (silent `router.refresh()`), ads-web sync (fake 1.2s sleep). |
| P5 | **Swallowed errors that look like empty data.** `catch {}` renders "No data yet" when the DB or API failed. | 20 occurrences across `app/layout.tsx`, `app/page.tsx`, `seo/*`, `settings`, `stores`, `drafts/[id]` (5). `seo/live/[id]` redirects with `?error=` but never reads it. |
| P6 | **Raw data shown to users.** UUIDs, `JSON.stringify` blobs, enum strings, unformatted numbers, inconsistent dates. | `/drafts/[id]`, `/jobs/[id]`, `/history` are the worst. Raw `resourceType`, `d.type`, `severity`, `kind`, `ad.status`, `row.status`. Impressions/clicks unformatted. Dates via bare `toLocaleString()` everywhere except Ads (`lib/ads-copy.ts` has `formatMoney`/`shortWhen`). |
| P7 | **Hidden limits, no table controls.** | 200 GSC rows, 200 catalog rows, 100 recommendations, 50 jobs, 20 drafts — never disclosed, no pagination, sort, filter, or search. |
| P8 | **Settings as the only place to act.** Pages bounce to a single 890-line Settings page with hash anchors instead of letting the user act in place. | GSC connect, "turn on recommendations", WordPress connect, capability flags. Settings mixes integrations, feature flags, store config, brand voice, a placement JSON helper, and an Inngest resync tool (README calls it temporary). |
| P9 | **High-stakes actions under-explained.** | Approve on `/drafts/[id]` publishes to Shopify/WordPress with no confirmation (`Submit Decision`, L340). Deny/Snooze are one-click everywhere. Ads-web Freeze/Disconnect have no confirm. The ads kill-switch banner uses destructive styling when ads are *running* and calm styling when paused (inverted). |
| P10 | **Two design systems and two ads apps.** | `cx-*`/`btn-*` classes vs hand-rolled Tailwind (`p-8 max-w-*` on drafts/jobs/history; raw `<button>` in CallRail/Clarity/seasonality settings) vs shadcn `components/ui/*` (only used by `SEORulesEditor`). ~44 inline `style={{}}`. Separately, `apps/ads/web` duplicates the ads cockpit with different auth, copy, and broken cross-origin links. |

---

## 2. Bugs found during the audit (fix first, independent of polish)

These are correctness issues, not taste. Each is small.

1. **GSC data duplicates on every sync.** `gsc_rows` has no unique key (`db/migrations/0009_gsc.sql`), so `ON CONFLICT DO NOTHING` in `src/lib/db/gsc.ts:12` never fires. Each sync appends another full copy. `summarizeGscRows` sums all copies, so Impressions/Clicks grow every time someone presses Sync. Recommendations (`listGscRows(…, 4000)`) and the audit job also read duplicated rows.
2. **GSC window is off by one and includes incomplete data.** `fetchSearchAnalytics` sends `today-28 … today` in UTC (29 inclusive days). Google reports in `America/Los_Angeles` and the last 1-3 days are preliminary. Only 5,000 rows are requested with no `startRow` paging (API allows 25,000 per page).
3. **GSC summary won't match Google's numbers.** Totals are summed from query×page rows, which exclude anonymized queries. Google's own totals come from a query without the `query` dimension.
4. **SEO Jobs shows every job.** `app/seo/jobs/page.tsx:18` filters with `j.domain === 'seo' || true`.
5. **Review queue isn't a queue.** `app/review/page.tsx:33` calls `listDrafts(storeId, undefined, 20)` with no status, so already-decided drafts sit in "waiting for a decision".
6. **Approve can fail silently.** `app/drafts/[id]/page.tsx:131-137` only `console.error`s when the Inngest send fails, then redirects as if it succeeded.
7. **Error never shown on catalog detail.** `app/seo/live/[id]/page.tsx:90` redirects with `?error=` but the page doesn't read `searchParams`.
8. **Store config JSON errors are dropped.** Invalid JSON on `/stores/[id]/edit` is ignored in a `catch {}` and the save "succeeds".
9. **Ads pixel snippet uses a relative URL** (`app/ads/funnel/page.tsx:81`), so it breaks when pasted on an external landing page.
10. **Ads Sync reports partial failure as success** (`api/ads/sync/route.ts:49-52` + `sync-ads-button.tsx:44-45`). OAuth error text is dropped (`lib/ads-query.ts:15-16`).
11. **Ads-web links 404.** Creatives/Funnel nav items keep bare `/ads/...` paths on the ads-web origin; Brainstorm links to relative `/ads/leads`.
12. **Ads-web sign-in pre-fills seed credentials** (`adam@tharrosmedia.com` / `local-dev-only`, `apps/ads/web/src/app/sign-in/page.tsx:14-15,84`).
13. **`/sentry-example-page` is excluded from auth** (`apps/brain/middleware.ts:39`) and ships to production.

---

## 3. Decisions needed before building

These change the shape of the work; defaults are proposed so work can start without blocking.

| Decision | Proposed default |
|---|---|
| Name for SEO action items | **Recommendations** everywhere (rename route `/seo/findings` → `/seo/recommendations` with a redirect). |
| Name for Ads action items | **Recommendations** as well, so the product has one word. "Findings" stays only as the evidence list inside a Check. |
| Decision verbs | **Approve / Dismiss / Snooze** everywhere (drop Deny, Later, authorized). |
| Ads analysis verbs | **Check** (analyze) and **Sync** (pull latest data). Drop "Audit" from UI. |
| Leads vs Brainstorm | **Ad ideas** (nav + page title), route kept as `/ads/leads` with alias. |
| Who sees feature flags | Merchants see On/Off feature toggles in plain language. Raw ids, `recommend_only`, unfinished items, env-kill notes, and "Resync Inngest" move behind an **Operator** section only visible to admins. |
| `apps/ads/web` | **Retire it.** It's already hidden by default (`shell.legacy_ads_web`), and every live feature exists in `/ads`. The one gap is per-client detail (`/app/clients/[id]`), which gets ported as `/ads/clients/[id]`. |
| GSC default range | **Last 3 months**, matching Google's own Performance report default. |

---

## 4. Shared foundations (build once, used by every later phase)

Doing these first keeps the page work mechanical and consistent.

1. **Copy rules + glossary** — `docs/ui-copy.md`: the vocabulary from section 3, plus rules: say what an action does, never what a page doesn't do; no milestone codes, flag ids, env vars, vendor/model names ("Grok"), or people's names; state the period next to every metric; button labels are verbs.
2. **Formatting helpers** — move `formatMoney`/`shortWhen` out of `lib/ads-copy.ts` into `lib/format.ts` and add `formatNumber`, `formatPercent`, `formatPosition`, `formatDate`, `formatDateRange`, `formatRelative`. Replace every bare `toLocaleString()`/`toLocaleDateString()`.
3. **Enum label maps** — one `lib/labels.ts` for job types/statuses, draft types, resource types (`collection` → "Collection", `wp_post` → "WordPress post"), severities, ad statuses, connection states. Replace raw enum renders.
4. **`DateRangePicker` component** — presets (Last 7 days, Last 28 days, Last 3 months, Last 6 months, Last 12 months, Last 16 months, Custom) with a custom start/end picker. Encodes to URL params (`?range=3m` or `?from=…&to=…`) so views are linkable. Used by GSC and every Ads metric surface.
5. **Background job status** — a small `job_runs` record (or reuse `events`) written when a sync/check/generate starts and finishes, plus a `<JobStatus>` client component that polls it and shows "Syncing… / Synced 2 min ago / Sync failed: reason — Retry". Replaces "queued" flashes and ad-hoc `AutoRefresh`.
6. **Toasts** — add a toast provider (shadcn `sonner`) for action results; keep `Flash` only for persistent page-level states.
7. **Error surfaces** — replace `catch {}` with a `<LoadError>` panel (message + retry) and add nested `error.tsx`/`loading.tsx` under `seo`, `ads`, `settings`. `app/error.tsx` stops showing raw `error.message`.
8. **`ConfirmDialog`** — built on the existing (unused) `components/ui/dialog.tsx`. Required for anything that publishes, spends, disconnects, or freezes; copy states the destination and consequence.
9. **`DataTable`** — built on `components/ui/table.tsx`: server-side pagination, sortable columns, a search box, and "Showing 1-50 of 1,240". Replaces the hand-rolled tables and hidden limits.
10. **One styling path** — `cx-*`/`btn-*` classes (or shadcn primitives styled to match) as the only option. Migrate raw Tailwind buttons in `workspace-*-settings.tsx`, and the `p-8` prototype chrome on `drafts/[id]`, `jobs/[id]`, `history`. Remove inline `style={{}}`.

---

## 5. Phases

Each phase is independently shippable. Phase 1 is deliberately the pilot: it exercises most foundations on one page and becomes the template for the rest.

### Phase 0 — Correctness fixes
Section 2 bugs 4-13 (bugs 1-3 land with Phase 1 because they change the GSC data model). Small, isolated edits; each gets a test where the repo already has one nearby (`apps/brain/tests`).

### Phase 1 — Search Console rebuild (pilot page)

**Data model** (fixes bugs 1-3)
- New migration: add `search_type`, a `synced_range` key, and a unique index on `(store_id, date_start, date_end, query, page)`; de-duplicate existing rows.
- New `gsc_daily_totals (store_id, date, clicks, impressions, ctr, position)` filled from a `date`-only query. This is small (≤ 490 rows per store for 16 months) and gives totals that match Google for **any** range without re-syncing.
- `fetchSearchAnalytics(storeId, { startDate, endDate })` replaces `days`. Use Pacific dates, end at the latest finalized date (`dataState: final`), page with `rowLimit: 25000` + `startRow`, batch inserts instead of one INSERT per row.
- A sync for a range replaces that range's query×page snapshot in a transaction instead of appending.

**Sync behavior**
- Button label: **Sync**. Clicking it refreshes the currently selected range and the daily totals.
- First connect backfills 16 months of daily totals and the default range (3 months) of query×page data.
- Add a daily scheduled Inngest sync so data is fresh without clicking anything; "Last synced" shows relative time.
- `<JobStatus>` replaces the "queued" flash; the page updates itself when the sync finishes and shows the error if it fails.

**Page**
- Header: property name, connection status, `DateRangePicker` (default Last 3 months), **Sync** button.
- Cards: Clicks, Impressions, Avg. CTR, Avg. position for the chosen range, with change vs the previous period. Small clicks/impressions trend chart from daily totals.
- Queries and Pages tabs (`DataTable`, sortable, searchable, paginated) instead of a collapsed "raw sync rows" table. If the chosen range has no query-level snapshot, show "Sync this range to see queries" with a one-click sync.
- Connect inline (OAuth start) when disconnected; property picker inline after connect. Settings keeps a link, not the only path.
- Copy rewrite: remove "this page does not write the site", "Do not treat this table as the product", "Tables stay collapsed here", "does not flip it". One line of help: what Search Console data is used for and a link to Recommendations.
- Recommendations generation documents its own window ("based on the last 28 days vs the 28 days before") in the Recommendations page, decoupled from the view range.
- Update `gsc-copy.ts`, `gsc-property-field.tsx:80`, and the duplicate Sync button in Settings (`settings/page.tsx:665`) to match.

### Phase 2 — Vocabulary and copy sweep (whole app)
Apply the glossary and copy rules everywhere. Mostly string edits, plus route aliases.
- Recommendations rename (route, nav rail "GSC" → "Search Console", dashboard card, SEO overview metric, empty states).
- Approve/Dismiss/Snooze everywhere, including ads filter chips and ads-web status chips.
- Remove all P2 strings. Largest concentrations: `packages/contracts/src/capabilities.ts` labels/help (M5.2, `FEATURE_*`, "Got Ductless", "Adam"), `components/workspace-capabilities-settings.tsx`, `components/ads/*` ("this slice", "(mock)", "Site apply later"), `lib/ads-copy.ts:331-334`, `wordpress-connect-settings.tsx:90-109`, `/drafts/[id]`, `/jobs/[id]`.
- Rename ambiguous actions: "Review" (which actually queues a job) → "Draft a fix"; "Run catalog check" → "Check pages"; "Re-send to Inngest" → "Retry"; "Adapt / make another for Google?" → "Adapt for Google"; "Place cutoff/Save cutoff" → a labelled position threshold.
- Rename `/api/ads/m51` → a descriptive route (keep the old path as an alias for one release).

### Phase 3 — Settings restructure
- Split into sub-routes with a left nav: **Integrations** (Shopify, Search Console, WordPress, Meta, Google Ads, CallRail, Clarity — each a card with status badge, connected account, last sync, Connect / Reconnect / Disconnect), **Publishing & approvals** (autonomy, allowed content types as checkboxes, block-writes toggle in plain words), **Features** (plain On/Off toggles), **Store** (name, brand voice, SEO rules), **Account** (password — without naming the env var), and an admin-only **Operator** section (raw capability ids, Resync Inngest, placement helper, config JSON).
- Per-form save with inline validation, dirty-state indicator, and toasts instead of ~25 query-string flash variants.
- Disabled controls carry their reason next to them (e.g. "Connect Search Console to sync").
- Update every deep link (`/settings#connects`, `#capabilities`, `#gsc-recs`) to the new routes.

### Phase 4 — SEO workflow pages
- **Dashboard (`/`)**: one "What needs you" list (drafts awaiting approval, new recommendations, failed jobs) instead of duplicate counts; first-run checklist (connect store → connect Search Console → first sync → first recommendation) replaces both the home business-type chooser and the separate `/onboarding` redirect to `/ads`.
- **Recommendations**: `DataTable`/card list with pagination and filters (type, page, impact); the page explains the window it's based on; catalog check shows progress via `<JobStatus>`.
- **Create**: validation messages instead of silent return or thrown errors; pending button; toast + link to the new job.
- **Jobs + History**: merge into one **Activity** page (filters: status, type, date; search by keyword), linked from nav. Job rows lead with keyword/title, not UUIDs.
- **Job detail**: human status timeline instead of the internal pipeline string and raw event log; output shows links to the published page first, JSON under "Technical details"; back link returns to Activity.
- **Review**: only awaiting-approval items, labelled types, pagination.
- **Draft detail**: move onto `cx-page` chrome; structured fields instead of raw JSON textareas for metafields/schema/products; hide the brief/gate dump behind "How this was generated"; Approve opens `ConfirmDialog` naming the destination ("Publish to your Shopify store as a Collection"); edit fields only appear in edit mode.
- **Live catalog**: filters by type + search, pending state on Sync, result toast, labelled types; Shopify items get the same "Propose an improvement" flow WordPress has, or an explicit view-only note.
- **Stores**: "Add store" asks only for what's needed per platform (WordPress no longer shows Shopify token fields); config JSON moves to Operator; "Select" → "Use this store"; test result shows shop name, not a GID.

### Phase 5 — Ads pages in the console
- `DateRangePicker` on the cockpit, Creatives, and recommendation evidence; every metric labelled with its period (and fall-back windows labelled truthfully).
- Account/client pickers on Check, Sync, Creatives, and Funnel (currently picks a default client silently).
- Explain Check vs Sync in one line on the buttons' tooltip/help; Sync reports per-account results including failures.
- Cockpit shows a section map matching the nav; Sales and Workflows placeholders are removed from nav until built.
- Findings detail links to the recommendations it produced (currently a dead end).
- Dismiss/Snooze get a light confirm or an Undo toast; Approve's confirm copy states the concrete change and spend impact without flag jargon; apply results shown as a status line, JSON under details.
- Kill-switch banner severity fixed (ads live = caution, paused = neutral) with plain labels ("Ads changes paused" / "Ads changes can be applied").
- Funnel: absolute pixel URL + copy button, GA4 property ID validation, Disconnect with confirm, success toast.
- Port the one missing capability from ads-web: per-client detail at `/ads/clients/[id]`.

### Phase 6 — Retire `apps/ads/web`
- After Phase 5 ships, redirect every `/app/*` route to its `/ads/*` equivalent, then remove the web package and its Railway service (`cerevex-web`) in a coordinated change. Until then, apply only the safety fixes from section 2 (seed credentials, broken links).
- Rename the `tharros_token` storage key if the app lives longer than one release.

### Phase 7 — Shell, navigation, and visual consistency
- Mobile navigation (collapsible menu; current header just shrinks/overflows).
- Active-state styling for the current module and settings section (`aria-current` is styled but never set).
- Consistent back links/breadcrumbs via `PageHeader` on every page (Ads pages don't use it today).
- Store switcher: show which store you're acting on in page headers where it matters (Settings, Approve).
- Remove `sentry-example-page`; add page-level skeletons in place of the global "Loading…" pulse.

---

## 6. Definition of done for a polished page

Use this checklist in every polish PR.

- [ ] Every button label is a verb that describes the result; no hidden parameters in labels.
- [ ] Any value the result depends on (date range, account, store, limit) is visible and, where reasonable, choosable.
- [ ] Every metric states its period; numbers, money, percents, and dates use `lib/format.ts`.
- [ ] No raw ids, enums, or JSON outside a "Technical details" disclosure.
- [ ] Copy passes `docs/ui-copy.md` (no flags, milestones, env vars, people, or "this page does not…").
- [ ] Background actions show pending → done/failed without a manual refresh.
- [ ] Load failures show an error with retry, not an empty state.
- [ ] Empty state says what to do first and offers the action inline.
- [ ] Lists over ~25 items paginate and say "Showing X of Y"; tables sort.
- [ ] Publishing, spending, disconnecting, or freezing requires confirmation naming the consequence.
- [ ] Uses shared components/classes only; no inline styles.
- [ ] Works at mobile width.

---

## 7. Size and risk by phase

| Phase | Touches | Risk |
|---|---|---|
| 0 Correctness | ~12 files, one-line to small edits | Low |
| 1 Search Console | 1 migration + data backfill, GSC client, sync job, new scheduled job, page, 3 new shared components | Medium — data migration on production Neon (Brain `public` schema only; never touch `os`) |
| Foundations | New `lib/format.ts`, `lib/labels.ts`, 6 shared components, toast provider | Low |
| 2 Copy sweep | ~40 files, mostly strings; route aliases | Low, but wide — needs a visual pass |
| 3 Settings | Split one 887-line page into ~6 routes; rewire deep links | Medium — many forms and redirects |
| 4 SEO pages | ~12 pages; Approve confirm touches the publish path | Medium |
| 5 Ads pages | ~12 pages + `components/ads/*`; new client detail route | Medium — must keep approve-gated, kill-switch-on behavior intact |
| 6 Retire ads-web | Redirects, package + Railway service removal | Medium — coordinate with Railway config outside the repo |
| 7 Shell | Layout, nav, CSS | Low |

Suggested order: Phase 0 → Foundations → Phase 1 (pilot, validates the components) → Phase 2 → Phases 3/4/5 in parallel → Phase 6 → Phase 7.
