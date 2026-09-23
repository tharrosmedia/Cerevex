# Modularity retrofit (capability flags + connector interfaces)

Lean ship of Product inventory 1.0 / Cos R1–R5. **No M5.1/M5.2 product work.**

## Flag registry shape

Stored on `os.workspaces.settings_json.capabilities` (same JSON as Modules & Nav IA — no new table, schema `os` stays `os` via `ADS_DB_SCHEMA`).

| State | Meaning |
|---|---|
| `on` | Available |
| `hidden` | Unfinished / off. UI hides. Writes return 409. Reads never throw. |
| `recommend_only` | Visible as a recommendation. No writes. |

Seeded ids: `cockpit`, `apply`, `connect.meta`, `connect.google`, `audits`, `sync.live`. Dark placeholders: `m51.budget_shift`, `m51.grok_creatives`, `m51.lp_congruence`, `m51.ga4_connect`, `m51.brainstorm`. R3/R4 also register `apply.bid`, `apply.budget`, `apply.create_entity`, `shell.legacy_ads_web`.

Resolution: catalog default → workspace override → env global kill.

Env kills (no Site Brain redeploy):

- `CAPABILITY_KILL=apply,connect.meta`
- `CAPABILITY_KILL_AUDITS=1` (dots become underscores)
- `FEATURE_BID_MUTATIONS=0` / `FEATURE_BUDGET_MUTATIONS=0` (legacy → `apply.bid` / `apply.budget`)
- `PLATFORM_SYNC_LIVE=0` (legacy → `sync.live`)

`GET`/`PATCH /workspace` returns `workspace.capabilities`, `capabilityCatalog`, and `capabilityKills`. Settings → Capabilities (in-shell and leftover ads-web) flips live product flags only. Unfinished `m51.*` stay out of the operator catalog. `PATCH` still accepts `hidden` / `recommend_only` for those ids; `on` is 409 until `unfinished` is cleared.

## Degrade behavior

- Flag off / hidden → hide nav and CTAs. Recommend-only → show copy, no writes.
- `GET /workspace`, `/clients`, `/audits`, `/recommendations`, ad-account reads **never throw** when a flag is off.
- `POST` connect / new audit is 409 with a plain-language message.
- `apply` off: Approve still records an authorization; the apply job finishes without platform writes. Kill switch + freeze are unchanged.
- Missing / garbage `settings_json` → catalog defaults. No whole-app take-down.

## Connector interfaces

Runtime: `@tharros/ads-shared/connectors` (Node-only — do not import from ads-web). Types are on the ads-shared barrel.

| Kind | Ids | Implementation |
|---|---|---|
| `AdPlatformConnector` | `meta`, `google`, `mock` | Exclusive path for pull, token refresh, OAuth exchange, live read/apply. Meta/Google branches live in `connectors/meta.ts` and `connectors/google.ts`. |
| `AnalyticsConnector` | `ga4`, `first_party`, `clarity` | GA4 + first-party live; Clarity Connect pulls aggregated session signals |
| `CallTrackingConnector` | `callrail` (connect), `bundled` | CallRail live connect; bundled is Twilio-class lean |
| `SiteConnector` | `wordpress` | Stub — `supportsLandingPageMutation: false`. LP recs stay Site apply later |

Shared `Connector` surface: `isConfigured`, `connect`, `disconnect`. Meta + CallRail both satisfy it. No real GA4/CallRail product work.

Sync (`runAdAccountSync`) and live apply (`executeMutation` / `applyViaConnector`) call `getAdPlatformConnector` — they do not import Meta/Google Graph or Google Ads REST helpers. HTTP still never live-writes platforms; apply stays on the authorize-to-apply job. OAuth `/oauth/:platform/start` and **callback** both `requireWritableCapability(connect.meta|google)` before exchanging or upserting tokens. Sync enqueue and disconnect use the same `connect.*` gate.

## R3

- Apply gate + `ads/apply.requested` (legacy alias `os/apply.requested` for one release).
- Mutation families (`pause`, `negatives`, `placement_exclude`, `bid`, `budget`, `create_entity`) sit behind the registry. Bid/budget env flags migrated.
- Sealed apply job type `create_entity` for a later Grok path. UI still never does sync platform writes.

## R4

- One ads-nav catalog in `@cerevex/contracts` (`resolveAdsNav`). In-shell `/ads` is the operator path.
- Leftover `apps/ads/web` is hard-blocked unless `shell.legacy_ads_web` is on (default hidden). Authenticated `/app/*` redirects to in-shell `/ads`.
- Console leftover-chrome links require **both** `shell.legacy_ads_web=on` and `NEXT_PUBLIC_ADS_LEGACY_CHROME=1`. `NEXT_PUBLIC_ADS_ORIGIN` is ignored unless that pair is on. The env is a deploy-time companion, not a second product flag.

## R5 (this PR — G7 + G10)

R5 naming is **shipped**. Packages renamed. Neon schema `os` is **quarantined**, not renamed. Inngest ads topology is generic `ads/*` (platform is data). `seo/*` / `seo-*` and live Inngest app ids are unchanged.

### G7 — Inngest names

Producers emit the new names. Dual listeners keep the old events and function ids for **one release** so in-flight jobs finish. Remove `LEGACY_ADS_*` after that release.

| Old event | New event | Old function id | New function id |
|---|---|---|---|
| `os/stub.ping` | `ads/stub.ping` | `os-stub-ping` | `ads-stub-ping` |
| `os/stub.sync` | `ads/stub.sync` | `os-stub-sync` | `ads-stub-sync` |
| `os/apply.requested` | `ads/apply.requested` | `os-apply-requested` | `ads-apply-requested` |
| `os/audit.requested` | `ads/audit.requested` | `os-audit-requested` | `ads-audit-requested` |
| `meta/ads/account.sync` | `ads/account.sync` (`platform: "meta"`) | `meta-ads-account-sync` | `ads-account-sync` |
| `google/ads/account.sync` | `ads/account.sync` (`platform: "google"`) | `google-ads-account-sync` | `ads-account-sync` |

`jobs/meta/ads` and `jobs/google/ads` folders stay. They only register the legacy platform-prefixed listeners. Canonical sync is `ads-account-sync` on the ads worker.

Unchanged: `seo/*`, `seo-*`, Brain Inngest app id `shopify-brain`, ads Inngest app id `cerevex-ads`, env key `OS_INNGEST_APP_ID`.

### G10 — Packages + Neon `os`

`@tharros/ads*` stays (Railway start/build commands). Everything that was `@shopify-brain/*` is `@cerevex/*`.

| Old | New |
|---|---|
| `shopify-brain-monorepo` | `cerevex-monorepo` |
| `@shopify-brain/brain` | `@cerevex/brain` |
| `@shopify-brain/contracts` | `@cerevex/contracts` |
| `@shopify-brain/db` | `@cerevex/db` |
| `@shopify-brain/shared` | `@cerevex/shared` |
| `@shopify-brain/jobs-seo` | `@cerevex/jobs-seo` |
| `@shopify-brain/jobs-meta-ads` | `@cerevex/jobs-meta-ads` |
| `@shopify-brain/jobs-google-ads` | `@cerevex/jobs-google-ads` |
| `@shopify-brain/jobs-meta-organic` | `@cerevex/jobs-meta-organic` |
| `@tharros/ads`, `@tharros/ads-api`, `@tharros/ads-web`, `@tharros/ads-shared`, `@tharros/ads-workers` | **unchanged** (Railway workspace commands) |

Neon: `ADS_DB_SCHEMA = "os"` (`OS_DB_SCHEMA` is a deprecated alias). No `ALTER SCHEMA`. Drizzle still targets schema `os`.

If Railway Site Brain start/build uses `--workspace=@shopify-brain/brain`, change it to `@cerevex/brain` on merge. Root `npm run build` / `npm start` already proxy to the new name.

## M5.1 Brief 1.6 (this product PR)

`m51.budget_shift`, `m51.grok_creatives`, `m51.lp_congruence`, `m51.ga4_connect`, `m51.brainstorm`, and `apply.create_entity` are live product flags (`unfinished: false`). Defaults stay `hidden`. Operators can turn them on from Settings.

- Budget shift recs Approve through existing `apply_jobs` + `update_budget`.
- Grok generate writes `brainstorm_*` only. Promote inserts a `create_alternative` rec. Approve may `create_ad` when `apply.create_entity` is on.
- LP congruence is recommend-only (`siteApply: later`). No Site / WordPress connector exists.
- Funnel: GA4 connect **and** first-party pixel. Events strengthen budget/creative recs when data exists.

## M5.2 Phase B (bundled call tracking)

`m52.bundled_call_tracking` is a live product flag (`unfinished: false`). Default `hidden`. Env kill: `CAPABILITY_KILL_M52_BUNDLED_CALL_TRACKING=1`.

- Same `CallTrackingConnector` + `call_attribution` join path as CallRail Connect.
- Mock enable for QA. Live Twilio credentials via `TWILIO_*` env or encrypted workspace settings.
- Will not buy a number or change call routing. CallRail stays selected when both are connected.
- Connect customers are untouched when this flag is hidden.

## M5.2 Phase C (Clarity + LP intelligence)

`m52.clarity_connect` and `m52.lp_intelligence` are live product flags (`unfinished: false`). Default `hidden`. Env kills: `CAPABILITY_KILL_M52_CLARITY_CONNECT=1`, `CAPABILITY_KILL_M52_LP_INTELLIGENCE=1`.

- Clarity sits on `AnalyticsConnector` with `pullSessionSignals`. Mock-connect for QA. Live project id / API token via `CLARITY_*` env or encrypted workspace settings.
- Aggregated heatmap / session signals only. No in-house Hotjar-class recorder. No raw PII dump.
- Recs: hero / structure / copy / wizard with a plain-language why. Metrics stay behind Details.
- Site connector (`wordpress`) is a stub (`supportsLandingPageMutation: false`). Approve → apply_jobs stays review-only + “Site apply later”. Deny/Snooze never write.
- Core ads/cockpit stays healthy when both flags are hidden.

## M5.2 Phase D (CRM / HCP booked-job loop)

Deepens Phase A `CrmConnector` (`hcp`). `m52.crm_join`, `m52.lead_lifecycle`, and `m52.booked_job_signal` are live product flags (`unfinished: false`). Default `hidden`. Env kills: `CAPABILITY_KILL_M52_CRM_JOIN=1`, `CAPABILITY_KILL_M52_LEAD_LIFECYCLE=1`, `CAPABILITY_KILL_M52_BOOKED_JOB_SIGNAL=1`.

| Id | Role |
|---|---|
| `m52.crm_join` | Connect / pull Housecall Pro (mock or live). Soft-join booked jobs to calls. Writable required for connect/pull. |
| `m52.lead_lifecycle` | Lead → contacted → booked cards + `lead_lifecycle` inbox recs. Recommend-only CRM mutations (`crm_write_later`). |
| `m52.booked_job_signal` | `booked_job` ads optimization recs. Visible when `on` or `recommend_only`. Ads budget writes only when `on`. |

- Mock path is required for QA. Live HCP via `HCP_API_KEY` / encrypted settings. Fail closed on bad creds. Connect and pull never write HCP.
- Booked-job recs can propose `update_budget` toward the campaign that booked work. Approve → `apply_jobs` with the same kill/freeze/audit gates. Deny/Snooze never write.
- Core ads/cockpit stays healthy when all three flags are hidden.

## M5.2 Phase E (operator hygiene)

`m52.creative_fatigue`, `m52.search_negatives`, `m52.geo_discipline`, and `m52.brand_guardrails` are live product flags (`unfinished: false`). Default `hidden`. Env kills: `CAPABILITY_KILL_M52_CREATIVE_FATIGUE=1`, `CAPABILITY_KILL_M52_SEARCH_NEGATIVES=1`, `CAPABILITY_KILL_M52_GEO_DISCIPLINE=1`, `CAPABILITY_KILL_M52_BRAND_GUARDRAILS=1`.

| Id | Role |
|---|---|
| `m52.creative_fatigue` | Refresh-cadence recs when an ad looks tired. Plain-language why; metrics behind Details. Mutations stay `review`. |
| `m52.search_negatives` | Google search-term / negative hygiene recs. Visible when `on` or `recommend_only`. `add_negative` writes only when `on` and Approve passes. |
| `m52.geo_discipline` | Tighten or correct geo / service area. Visible when `on` or `recommend_only`. `tighten_geo` only when `on`. Live location targeting stays out of this slice. |
| `m52.brand_guardrails` | Block or warn on claims / brand risk. Pause writes only when `on`. Spend-up / create is skipped when the flag is visible and the target has a blocking claim. Never silent unsupervised spend past a guardrail. |

- Recs enter the day-job inbox through `runAuditRun` → `evaluateAccount`. Hidden flags emit nothing and filter leftover rows from GET `/recommendations`.
- Approve → `apply_jobs` with the same kill / freeze / audit gates. Deny / Snooze never write.
- Core ads/cockpit stays healthy when all four flags are hidden. CallRail / bundled / Clarity / LP / CRM Phase D behavior is unchanged.

## M5.2 Phase F (planning + owner narrative)

`m52.seasonality_calendar` and `m52.owner_weekly_narrative` are live product flags (`unfinished: false`). Default `hidden`. Env kills: `CAPABILITY_KILL_M52_SEASONALITY_CALENDAR=1`, `CAPABILITY_KILL_M52_OWNER_WEEKLY_NARRATIVE=1`.

| Id | Role |
|---|---|
| `m52.seasonality_calendar` | Seasonality + offer calendar. Default HVAC year until the operator saves windows in `settings_json.planning`. Calendar→campaign recs (`seasonality`) Approve-gated. |
| `m52.owner_weekly_narrative` | Owner weekly AM-style brief. In-app digest first (no new email). Read-only unless a nested recommended action Approves. Inbox type `weekly_narrative`. |

Allowed apply_jobs mutation kinds when the matching flag is **on** and Approve passes:

- Seasonality: `update_budget` (ramp / shift), `pause` (pause windows). Hold windows stay review-only.
- Weekly narrative: `pause` or `update_budget` only when a nested recommended action is present. Digest-only cards stay `review`.

Deny / Snooze never write. Kill switch + freeze + audit stay on. Calendar windows live in `settings_json.planning` — no Neon ALTER.

## Out of scope (still deferred)

- Unsupervised CRM write-backs. New email infrastructure. Phase F does not reopen A–E.
- Dropping the one-release Inngest `LEGACY_ADS_*` listeners.
- Railway service / DNS / domain cutover. Live Inngest app id `shopify-brain`. Neon schema rename.

## G6 + G9 (follow-up)

- **G6** — Operator Settings lists `OPERATOR_CAPABILITY_CATALOG_LIST` (no unfinished `group: "m51"`). Nav still has no `m51.*` items except the mapped Leads row, which stays hidden while `m51.brainstorm` is hidden.
- **G9** — IA module `leads` maps to capability `m51.brainstorm`. `resolveAdsNav`, in-shell `/ads/leads`, and leftover `/app/brainstorm` require both `modules.leads` and a visible `m51.brainstorm`. Modules Settings shows Leads as “Not live” while the capability is unfinished so enablement cannot diverge. No brainstorm product UI.

## G8 (ops / env leftovers)

Canonical map lives in `@cerevex/contracts` (`OPS_ENV_REGISTRY`).

| Env | Kind | Capability / dest | Notes |
|---|---|---|---|
| `FEATURE_BID_MUTATIONS=0` | capability kill | `apply.bid` | Already mapped. Do not regress. |
| `FEATURE_BUDGET_MUTATIONS=0` | capability kill | `apply.budget` | Already mapped. Do not regress. |
| `PLATFORM_SYNC_LIVE=0` | capability kill | `sync.live` | Default `on`. Off degrades Meta/Google pull + apply to mock. Prefer Settings or `CAPABILITY_KILL_SYNC_LIVE=1`. |
| `NEXT_PUBLIC_ADS_LEGACY_CHROME=1` | capability companion | `shell.legacy_ads_web` | Deploy-time console link allow. G2 still hard-blocks leftover `/app/*` unless the capability is `on`. |
| `APPROVE_OPERATOR_EMAILS` | identity | — | Adam-only soft-launch allowlist. Default `adam@tharrosmedia.com`. Not a capability. `SEED_OWNER_EMAIL` is seed-only. Still ANDed with `apply` + kill switch + freeze. |
| `APP_PASSWORD` | secret | Brain console session | Not ads JWT. Not a feature flag. |
| `JWT_SECRET` | secret | Ads user sessions | Separate from Brain login. |
| `ADS_INTERNAL_KEY` | secret | Brain BFF → ads API | `x-cerevex-internal-key`. Acts as seeded owner. |
| `ADS_API_TOKEN` | secret | Optional BFF Bearer | Not a feature flag. |
| `TOKEN_ENCRYPTION_KEY` | secret | OAuth at rest | Not a feature flag. |

Do not put secrets or operator emails in `settings_json`.
