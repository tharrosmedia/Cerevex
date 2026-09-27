# Product polish plan

Goal: every page should make sense to a store owner the first time they see it. Today most pages technically work, but they ask for things they don't need, bury the useful information, give no feedback after an action, and read like engineering notes.

This plan is organized **page by page**. Section 1 covers root causes that break many pages at once. Section 2 covers navigation. Sections 3 and 4 are the page specs. The later sections cover shared building blocks, decisions, order of work, and a checklist every page must pass.

File and line references are as of `c7f984d`.

---

## 1. Root causes that affect many pages

Fixing these first makes several pages better at once.

### 1.1 Half the console has no styling
Tailwind is installed in `apps/brain/package.json` but never wired up: there's no `postcss.config.*` and `app/globals.css` has no `@import "tailwindcss"`. Every Tailwind class (`p-8`, `grid-cols-2`, `border`, `text-sm`, …) does nothing. These files render as bare HTML:

- `app/drafts/[id]/page.tsx` (the approve/deny page)
- `app/jobs/[id]/page.tsx`, `app/history/page.tsx`, `app/error.tsx`, `app/loading.tsx`
- Settings panels: `components/workspace-{callrail,clarity,bundled-call-tracking,capabilities,modules,seasonality}-settings.tsx`, `components/SEORulesEditor.tsx`
- All of `components/ui/*` (shadcn)

This is why the draft page isn't responsive and why parts of Settings look unlike the rest. **Fix:** move these pages onto the console's own `cx-*` / `btn-*` classes as each page is rebuilt below, and delete the unused Tailwind and shadcn dependencies at the end. That leaves one styling system. Turning Tailwind on instead would restyle every existing page through Tailwind's CSS reset, so it isn't the shortcut it looks like.

### 1.2 Errors are swallowed and look like "no data"
There are 20 `catch {}` blocks in pages, plus silent `console.warn`s in sync code. A failed Shopify call, database call, or background-job send renders as an empty list or a fake success. The catalog sync bug (4.3) is the clearest example.

### 1.3 Background work never reports back
Sync, check, draft, and recommendation jobs show "queued" at best and then nothing. Users have to refresh, or navigate somewhere else to find the result.

### 1.4 Forms ask for everything up front
Fields are shown whether they apply or not. The Stores form asks for Shopify keys even after you pick WordPress. Raw JSON boxes sit next to plain fields.

### 1.5 Engineering language and hidden parameters
Examples: "Sync 28 days", "Config (JSON, optional)", "Brief / Research / Gate (P2)", "Re-send to Inngest", "Capability flags", "(M5.2)", "kill switch", "this page does not flip it". Separately, fixed windows and limits are hidden from the user (28-day sync, 200 rows, 20 drafts).

---

## 2. Navigation changes

**Top bar today:** SEO · Ads · Review · Stores · Settings, plus a store switcher.
**Top bar proposed:** SEO · Ads · Settings, plus the site switcher.

| Item | Change | Why |
|---|---|---|
| **Stores** | Moves into **Settings → Sites**. `/stores` redirects. | You add or edit a site rarely, and switching sites is already in the header switcher. It doesn't need top-level space. |
| **Review** | Moves into the **SEO sub-menu** with a count badge ("Review 3"). `/review` stays as a route. | Every review item today is SEO content, and people reach it from Recommendations. Ads approvals already live in Ads. |
| **SEO sub-menu** | Order follows the workflow: **Overview · Search Console · Catalog · Recommendations · Review · Activity · New content**. | Today "New content" comes second and Review is missing. The sub-menu should match the order you actually use the pages. |
| **"GSC" rail label** | Becomes "Search Console". | Not everyone knows the acronym. |
| **SEO jobs + History** | Merge into **Activity**. | They show the same data in two layouts, and History isn't in any menu. |
| **Mobile** | A menu button that opens the full nav, instead of a header that shrinks and overflows. | The header can't fit the items today. |
| **Breadcrumbs** | One back link per page, from `PageHeader`, with no hand-written "← A \| ← B" chains. Detail pages show `SEO / Review / Title` as plain text links. | The draft page has three links pointing to two places. |

"Store" becomes **"Site"** throughout the UI, since WordPress sites are supported. The database keeps `store_id`.

---

## 3. The pages you called out

### 3.1 Settings (`app/settings/page.tsx`, 887 lines)

**Problem:** one long page with five anchor sections whose names don't match what's inside them. "Connects" mixes WordPress, Search Console, a recommendation threshold, a write-block switch, Shopify sync, an Ads pointer, and call tracking. "Store" mixes brand voice, a JSON placement helper, and an Inngest resync tool. "Modules & flags" is raw feature flags. About 25 different success/error banners are driven by URL parameters.

**Proposed structure:** separate pages with a left menu on desktop. On mobile, `/settings` is the list and each section opens as its own page.

```
Settings
├─ Sites                    all sites: add, manage, remove   (was the Stores page)
├─ This site: {site name}
│  ├─ Connections           Shopify / WordPress connection, Google Search Console,
│  │                        Meta & Google Ads, call tracking, analytics
│  ├─ Content & SEO         brand voice, SEO rules, recommendation sensitivity
│  └─ Publishing            what can publish without review, allowed content types,
│                           pause all site changes
├─ Ads                      Ads sections on/off, seasonality calendar
├─ Account                  password, sign out
└─ Admin (operators only)   raw feature flags, resync jobs, content placement rules,
                            raw site config
```

**Where every current panel goes**

| Today (line) | New home |
|---|---|
| WordPress connect (631) | Sites → site → Connection |
| Search Console connect / property / disconnect / "Sync 28 days" (633-674) | Connections → Google Search Console (Sync moves to the Search Console page) |
| Search recommendations threshold + "Block writes" (676-709) | Threshold → Content & SEO. Block writes → Publishing, as "Pause all site changes" |
| Shopify catalog sync (711-723) | Sites → site (status + Sync) and the Catalog page |
| Ads accounts pointer (725-731) | Connections → Meta / Google Ads, showing real status |
| CallRail / bundled tracking / Clarity (733-735) | Connections |
| Autonomy (738-765) | Publishing, with checkboxes per content type instead of a comma-separated text box |
| Ads modules, Capabilities (770-771) | Ads (plain on/off). Raw flag ids go to Admin. |
| Seasonality (772) | Ads → Seasonality |
| SEO rules editor (774-784) | Content & SEO |
| Active store status dump (791-819) | Sites → site overview |
| Brand voice (821-847) | Content & SEO |
| Placement helper (849-860) | Admin |
| Job runner / Resync Inngest (862-868) | Admin |
| Account password (871-884), which names `APP_PASSWORD` | Account, without the variable name |

**Behavior**
- Each form saves on its own, shows inline validation, marks unsaved changes, and confirms with a toast instead of a URL banner.
- Every integration uses the same card layout: name, status badge (Connected / Needs attention + reason / Not connected), connected account, last sync, and Connect / Reconnect / Disconnect.
- A disabled control shows its reason next to it (e.g. "Connect Search Console first").
- Deep links (`/settings#connects`, `#capabilities`, `#gsc-recs`) are updated to the new routes.

### 3.2 Sites (was the Stores page, `app/stores/page.tsx` + `stores/[id]/edit`)

**Problems confirmed in code**
- Platform is the second question. The Shopify domain and token fields are always shown and always `required` (L126-134), so picking "WordPress (use Settings → Connects)" still demands Shopify keys. You can't actually add a WordPress site here.
- "Config (JSON, optional)" (L136-139) is a raw placement-rules box for where generated content lands in the theme. Invalid JSON is silently ignored (L55). It's an operator tool, not a merchant question.
- The site is saved *before* the token is verified. "Test connection" is a separate button afterwards, and the first product sync's errors are swallowed (L67-70).
- The "Your stores" table isn't usable on mobile. The CSS turns rows into label/value lines with `justify-content: space-between`, and three buttons plus an "Actions" label don't fit in that line.
- The success message shows a raw Shopify ID (`gid://shopify/Shop/…`).

**New flow: Settings → Sites → Add a site**
1. **What kind of site?** Two large choices, Shopify or WordPress. Nothing else shows until one is picked.
2. **Connect**, with only that platform's fields:
   - *Shopify:* store address (accepts `mystore`, `mystore.myshopify.com`, or a full URL, then normalized), and an Admin API access token. A "How to create a token" disclosure lists the exact permissions the app needs; the list is taken from the queries the code runs and kept in one constant.
   - *WordPress:* site URL, a plugin download, and the plugin key. This reuses `connectWordpressStore`, which can already create a site.
3. **Verify, then save.** The site is only saved once the connection works. The site name is pre-filled from the Shopify shop name or WordPress site title and can be edited.
4. **Land on the new site's page.** The first catalog sync runs in the background with visible progress.

**Sites list:** cards instead of a table. Each card shows the name, platform, address, and connection health, meaning Connected or Needs attention with the reason (e.g. "Token missing permission: read_content"). It also shows the last catalog sync and an "Active" marker, with two actions: **Switch to this site** and **Manage**. Test connection becomes a health check that runs automatically; "Check again" lives on the manage page.

**Site page (was Edit):** name, connection (replace token / reconnect), catalog sync status, and Remove site with confirmation. Raw config JSON moves to Admin. If placement rules turn out to be needed by merchants, they get a structured form later.

### 3.3 Review (`app/review/page.tsx`)

**Problems confirmed in code**
- It isn't really a queue. `listDrafts(storeId, undefined, 20)` (L33) has no status filter, so approved and denied drafts are mixed in with waiting ones.
- There's no grouping by platform or content type. Type shows as a raw code (`seo.wordpress`, `collection`), plus a handle and a full timestamp.
- On mobile each row becomes five label/value lines with no separation between drafts, which is why it reads as one wall of text.
- It isn't in the SEO sub-menu, so clicking "Review" on Recommendations leaves no way there except the top menu.

**New page (SEO → Review)**
- Tabs: **Waiting (n)** · **Approved** · **Dismissed & snoozed**.
- **Sections by platform** (e.g. "Shopify: My Store", "WordPress: blog.example.com"), each with a count. Inside a section, one compact row per draft:
  - a content-type badge (Collection, Page, Blog post, WordPress post, Search snippet update);
  - the title;
  - one line saying where it came from (keyword "hvac filters", or the recommendation "Improve CTR for /collections/filters");
  - its age ("2 h ago");
  - a **Review** button.
- Filter by content type; sort by newest or oldest. The list paginates past 25 items and says so.
- On mobile each row is a small card (title, one meta line, button), not a stacked table.
- The empty state says what feeds Review ("Drafts appear here when you create content or act on a recommendation") and links to both.

**Recommendations → Review handoff:** the "Review" button on a recommendation becomes **Draft a fix**. Clicking it:
1. shows a toast: "Drafting… it will appear in Review";
2. changes the card to *Drafting*, then *Ready for review* with an **Open draft** link;
3. updates the Review count in the SEO sub-menu.

Today the job is queued with no redirect and no message (`startFromFinding`, `app/seo/findings/page.tsx`).

### 3.4 Draft page (`app/drafts/[id]/page.tsx`)

**Problems confirmed in code**
- No styling at all (1.1). Wide `<pre>` JSON blocks, fixed-width textareas, and unconstrained preview HTML overflow on phones.
- Three navigation links to two places: "← Back to Review | ← Back to Job" (L214-216) plus "View full job audit" (L222). A raw job UUID sits in the subtitle (L221).
- Internal debug output: "Brief / Research / Gate (P2)", `JSON.stringify` of the brief and scores, "ON-TOPIC" (L252-265). An "Available Metafields on store" dump (L267-276).
- The decision is a dropdown plus one "Submit Decision" button (L289-340). Approve publishes live with no confirmation. The edit fields are always visible even when you're not editing ("Edit Fields (only for edited)"), and three of them are raw JSON.
- If the background job fails to send, the page still redirects as if it worked (L131-137).

**New page**
- Standard header: one back link "← Review" and the title. A meta line shows the content type, site, keyword, and "Created 2 h ago".
- **Desktop:** preview on the left, a decision panel on the right that stays in view while scrolling. **Mobile:** one column, with Approve / Edit / Dismiss / Snooze in a bar fixed to the bottom of the screen.
- **Preview tabs:**
  - *Page:* images and tables constrained to the screen width.
  - *Google result:* a search snippet built from the SEO title and meta description, with character counts.
  - *Products* (collections only): product names and images instead of JSON.
- **Edit** turns the fields editable in place: title, URL handle, SEO title, meta description, and body. Metafields become labelled inputs; schema and product JSON move under "Advanced".
- **Approve** opens a confirmation: "Publish *Title* to *My Store* as a Collection. It will be live at *URL*." **Dismiss** asks for an optional reason. **Snooze** offers 1 day / 1 week.
- **"How this was made"** is a collapsed section with a research summary, the brief in plain sentences, and quality checks as a checklist (e.g. "On topic ✓"). The link to the job's activity lives here, not in the header.
- A failed send shows an error and keeps the draft in Waiting.

### 3.5 SEO jobs becomes Activity (`app/seo/jobs/page.tsx` + `app/history/page.tsx` + `app/jobs/[id]`)

**Problems confirmed in code**
- The first column is `j.id.slice(0, 8)` (L51). The keyword is stored in `job.input.keyword` but never shown.
- The filter `j.domain === 'seo' || true` (L18) shows every job.
- There's no step or progress, no error reason, no result link, a hidden 50-row cap, and errors are swallowed (L17).
- History shows the same jobs as JSON blobs in the unstyled layout.

**New page (SEO → Activity)**
- Each row leads with **what it worked on**: the keyword for new content, the page title for recommendation fixes, or the post title for WordPress proposals. Then the content type, a human status, the start time as relative time, and the result: **Open draft**, **View live page**, or **Retry**.
  - Status examples: Researching, Writing, Waiting for review, Published, Failed with the reason.
- Running jobs update live. Failed jobs show why.
- Filters by status and type, keyword search, and pagination with "Showing 1-25 of 140".
- **Job detail:** a plain timeline of steps (Researched → Drafted → Reviewed → Published) instead of the pipeline string and raw event log. "Re-send to Inngest" becomes **Retry**. Output leads with the live link; JSON goes under "Technical details". The back link returns to Activity.
- What's running right now is also summarized on the SEO Overview, so Activity is where you look things up, not a page you need to watch.

### 3.6 Live catalog becomes Catalog (`app/seo/live/page.tsx`)

**Why it doesn't sync (likely root cause, confirm against a real store's logs)**
- The collections and pages queries in `src/lib/shopify/catalog.ts` request `publishedOnCurrentPublication`. For a custom-app token, Shopify rejects that field unless the token has `read_product_listings` and the app has its own sales-channel publication. The Stores form only asks for `read_products + write_collections`, and pages and blog posts also need `read_content`.
- Each resource type is fetched in its own `try { … } catch { console.warn }`, so failures are silently skipped. The sync then records zero items as a success.
- Blog posts come only from the first blog.
- The sync runs inside the button click with no pending state and no result message. The only way to tell it did something is to reload and compare.
- Nothing syncs automatically, and nothing on the page explains what the catalog is for.

**Fixes**
- Remove `publishedOnCurrentPublication` and read published state from fields covered by the normal read permissions (or look up the Online Store publication once and use `publishedOnPublication`). Fetch every blog.
- When a site connects, read the token's granted permissions (`currentAppInstallation { accessScopes }`) and show any missing ones on the Sites card with instructions.
- Move sync to a background job with live status. Report results per type, for example: "Synced 42 collections and 8 pages. Blog posts failed: token is missing read_content."
- Sync automatically: daily, and after anything is published.

**New page (SEO → Catalog)**
- Header: "58 items · last synced 3 min ago" and a **Sync** button.
- Tabs with counts: Collections · Pages · Blog posts · WordPress posts. Search, and sort by title or last updated.
- Columns that make the page useful for SEO: title, URL, **SEO title**, **meta description** (with flags for missing or too long), published or hidden, and last updated on the site.
- Row action **Improve** drafts an update and sends it to Review, the same path as Recommendations. Row action **View** opens the live page.
- Catalog detail (`/seo/live/[id]`): Shopify items get the same "Propose an improvement" flow WordPress has. Errors passed back in the URL get displayed (today `?error=` is written but never read, L90).

---

## 4. Remaining pages

### 4.1 Search Console (`app/seo/search/page.tsx`)
- **Data fixes:**
  - `gsc_rows` has no unique key, so every sync appends a duplicate copy and the Impressions and Clicks totals grow each time. Add the key and de-duplicate.
  - Add a small daily-totals table so totals match Google's numbers for any range.
  - Use Pacific-time dates and finalized data.
  - Page through results at 25,000 rows per request.
- **Sync:** the button is labelled **Sync** and refreshes the selected range. It also syncs automatically every day, and backfills history on first connect.
- **Date range picker:** Last 7 days · Last 28 days · **Last 3 months (default, same as Google)** · 6 / 12 / 16 months · Custom.
- **Page layout:**
  - cards for Clicks, Impressions, Avg. CTR, and Avg. position, each with change vs the previous period;
  - a trend chart;
  - sortable, searchable Queries and Pages tabs;
  - connect Search Console from this page, not only from Settings.
- **Copy:** remove the engineering notes ("this page does not write the site", "Do not treat this table as the product").

### 4.2 Recommendations (`app/seo/findings/page.tsx`)
- Rename the route to `/seo/recommendations` and use "Recommendations" consistently. The dashboard and empty states still say "findings".
- Buttons: **Draft a fix** (see 3.3) · **Snooze** · **Dismiss** (drop "Deny").
- State the time window the recommendations are based on. Replace "Place cutoff / Save cutoff" with a labelled sensitivity setting.
- "Run catalog check" becomes **Check pages** and shows progress. List paginated, with filters by type and impact.

### 4.3 Dashboard (`app/page.tsx`) and onboarding
- One **"Needs you"** list: drafts waiting for review, new recommendations, failed jobs. Today the same count appears twice under different names.
- A first-run checklist replaces both the home business-type picker and `/onboarding`, which always redirects to Ads: add a site → connect Search Console → first sync → first recommendation.

### 4.4 New content (`app/seo/create/page.tsx`)
- Inline validation instead of silently doing nothing or throwing an error page.
- A pending button. On submit, a toast with a link to the job in Activity.
- Plain help text instead of "unless store autonomy turns it off".

### 4.5 Ads pages in the console (`app/ads/*`)
- Label every metric with its period and add the date range picker. Today spend reads "From the last check" but is really 30 days.
- Add account and client pickers to Check, Sync, Creatives, and Funnel.
- One vocabulary: Check / Sync / Recommendations / Approve / Dismiss / Snooze. Rename "Brainstorm" to "Ad ideas".
- Remove the Sales and Workflows placeholder pages from the menu until they're built.
- Findings link to the recommendations they produced.
- Dismiss and Snooze get an undo toast.
- The pause banner's severity is backwards today. It should warn when ads can be changed and look neutral when changes are paused.
- The funnel pixel snippet uses an absolute URL, and Sync reports failures for individual accounts.
- Port the per-client page from the old standalone app to `/ads/clients/[id]`.

### 4.6 Old standalone ads app (`apps/ads/web`)
- It's already hidden by default. Once 4.5 ships, redirect its routes into `/ads` and remove it.
- Until then, only apply safety fixes: remove the pre-filled seed login and fix its links that 404.

---

## 5. Correctness bugs (fix first)

| # | Bug | Location |
|---|---|---|
| 1 | Tailwind not wired, so pages render unstyled | see 1.1 |
| 2 | Catalog sync silently saves 0 items | `src/lib/shopify/catalog.ts`, see 3.6 |
| 3 | GSC rows duplicate on every sync, inflating totals | `db/migrations/0009_gsc.sql`, `src/lib/db/gsc.ts:12` |
| 4 | GSC window off by one, includes unfinished days, capped at 5,000 rows | `src/lib/gsc/client.ts:105-122` |
| 5 | Adding a WordPress site requires Shopify fields; sites saved before the token is verified | `app/stores/page.tsx:57,126-134` |
| 6 | Invalid config JSON silently ignored on add and edit | `app/stores/page.tsx:55`, `stores/[id]/edit` |
| 7 | Review shows decided drafts | `app/review/page.tsx:33` |
| 8 | SEO jobs filter `\|\| true` | `app/seo/jobs/page.tsx:18` |
| 9 | Approve redirects as success when the job send fails | `app/drafts/[id]/page.tsx:131-137` |
| 10 | "Draft a fix" (today "Review") gives no feedback | `app/seo/findings/page.tsx` `startFromFinding` |
| 11 | Catalog detail never shows its `?error=` | `app/seo/live/[id]/page.tsx:90` |
| 12 | Ads pixel snippet uses a relative URL | `app/ads/funnel/page.tsx:81` |
| 13 | Ads Sync reports partial failure as success; OAuth error text dropped | `api/ads/sync/route.ts:49-52`, `lib/ads-query.ts:15-16` |
| 14 | Old ads app: pre-filled seed login, links that 404 | `apps/ads/web/src/app/sign-in/page.tsx:14-15`, ads nav hrefs |
| 15 | `/sentry-example-page` is outside login and ships to production | `apps/brain/middleware.ts:39` |

---

## 6. Shared building blocks

Build these once so every page rebuild uses the same parts.

1. **Copy rules and glossary** (`docs/ui-copy.md`):
   - Vocabulary: Site; Recommendations; Draft a fix; Approve / Dismiss / Snooze; Sync; Check; Activity.
   - Rules: buttons are verbs that describe the result; say what a page does, never what it doesn't; no milestone codes, flag ids, env vars, vendor or model names, or people's names; state the period next to every metric.
2. **Formatting** (`lib/format.ts`): numbers, money, percents, positions, dates, date ranges, relative time. **Labels** (`lib/labels.ts`): every content type, job status, platform, and connection state.
3. **Components:**
   - `DateRangePicker`
   - `JobStatus`, which polls a background job and shows pending → done / failed + Retry
   - toasts (sonner)
   - `ConfirmDialog`
   - `DataTable`: pagination, sort, search, "Showing X of Y", and card layout on mobile
   - `IntegrationCard`
   - `LoadError` with retry
   - `SettingsLayout` with the left menu
   - `StepForm` for the add-site flow
4. **Page shell:** `PageHeader` everywhere, with one back link and an optional plain breadcrumb. Nested `loading.tsx` / `error.tsx` for SEO, Ads, and Settings. No inline `style={{}}`.

---

## 7. Decisions (defaults proposed so work can start)

| Decision | Proposed default |
|---|---|
| Stores location | Settings → Sites; removed from the top bar |
| Review location | SEO sub-menu with a count badge |
| "Store" vs "Site" | "Site" in the UI |
| Action items | "Recommendations" in both SEO and Ads |
| Decision buttons | Approve / Dismiss / Snooze |
| Feature flags | Plain on/off under Settings → Ads. Raw flags and dev tools go to an operators-only Admin section. |
| Styling | Console `cx-*` classes only; remove unused Tailwind and shadcn after migration |
| Default Search Console range | Last 3 months (Google's default) |
| Old standalone ads app | Retire after the console Ads pages are finished |

---

## 8. Order of work

Each step is its own PR (or a few). Steps 3-5 can run in parallel once step 2 lands.

| Step | Scope | Risk |
|---|---|---|
| 1. Bug fixes | Section 5, except the GSC data model (bugs 3-4, which go with step 4) | Low |
| 2. Building blocks + nav | Section 6 and section 2 (Stores → Settings, Review → SEO sub-menu, Activity merge, mobile menu) | Low-medium |
| 3. Settings + Sites | 3.1, 3.2 | Medium: many forms and redirects; the add-site flow touches site creation |
| 4. SEO workflow | 3.3 Review, 3.4 Draft, 3.5 Activity, 3.6 Catalog, 4.1 Search Console, 4.2-4.4 | Medium: the Approve confirmation sits on the publish path; the GSC migration runs against production Neon (Brain `public` schema only, never `os`) |
| 5. Ads | 4.5 | Medium: must keep approval gates and pause behavior intact |
| 6. Retire old ads app | 4.6 | Medium: coordinate Railway service removal outside the repo |
| 7. Cleanup | Remove Tailwind and shadcn, remaining copy sweep | Low |

---

## 9. Checklist for every page

- [ ] Asks only for what's needed, in the order that decides what comes next.
- [ ] Button labels are verbs describing the result; no hidden parameters.
- [ ] Values the result depends on (date range, site, account, limit) are visible and choosable where reasonable.
- [ ] Metrics state their period; numbers and dates use `lib/format.ts`.
- [ ] No raw ids, codes, or JSON outside a collapsed "Technical details".
- [ ] Copy follows `docs/ui-copy.md`.
- [ ] Background actions show pending → done / failed without a refresh.
- [ ] Load failures show an error with retry, never a fake empty state.
- [ ] Empty state says what to do first and offers the action inline.
- [ ] Lists over 25 items paginate and show "Showing X of Y".
- [ ] Publishing, spending, disconnecting, or removing asks for confirmation naming the consequence.
- [ ] One back link; reachable from its section's sub-menu.
- [ ] Works at 375 px wide with no horizontal scrolling.
- [ ] Uses shared components and `cx-*` classes only.
