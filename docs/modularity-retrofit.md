# Modularity retrofit (capability flags + connector interfaces)

Lean ship of Product inventory 1.0 / Cos R1+R2 (R3+R4 included where they stayed clean). **No R5. No M5.1/M5.2 product work.**

## Flag registry shape

Stored on `os.workspaces.settings_json.capabilities` (same JSON as Modules & Nav IA — no new table, schema `os` stays `os`).

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
| `AnalyticsConnector` | `ga4`, `first_party` | Stub — compiles only |
| `CallTrackingConnector` | `callrail` (connect), `bundled` | Stub — compiles only |

Shared `Connector` surface: `isConfigured`, `connect`, `disconnect`. Meta + CallRail both satisfy it. No real GA4/CallRail product work.

Sync (`runAdAccountSync`) and live apply (`executeMutation` / `applyViaConnector`) call `getAdPlatformConnector` — they do not import Meta/Google Graph or Google Ads REST helpers. HTTP still never live-writes platforms; apply stays on the authorize-to-apply job. OAuth `/oauth/:platform/start` and **callback** both `requireWritableCapability(connect.meta|google)` before exchanging or upserting tokens. Sync enqueue and disconnect use the same `connect.*` gate.

## R3 (same PR)

- Apply gate + `os/apply.requested` **kept**.
- Mutation families (`pause`, `negatives`, `placement_exclude`, `bid`, `budget`, `create_entity`) sit behind the registry. Bid/budget env flags migrated.
- Sealed apply job type `create_entity` for a later Grok path. UI still never does sync platform writes.

## R4 (same PR)

- One ads-nav catalog in `@shopify-brain/contracts` (`resolveAdsNav`). In-shell `/ads` is the operator path.
- Leftover `apps/ads/web` is hard-blocked unless `shell.legacy_ads_web` is on (default hidden). Authenticated `/app/*` redirects to in-shell `/ads`.
- Console leftover-chrome links require **both** `shell.legacy_ads_web=on` and `NEXT_PUBLIC_ADS_LEGACY_CHROME=1`. `NEXT_PUBLIC_ADS_ORIGIN` is ignored unless that pair is on. The env is a deploy-time companion, not a second product flag.

## Deferred

- **R5** — no deploy/naming quarantine, no Neon `os` rename, no `@shopify-brain` package rename.
- **M5.1 Brief 1.6** — no budget-shift UI, Grok creatives, LP congruence, GA4 connect UX, or brainstorm product.
- **M5.2** — no heatmaps, CallRail product, CRM, weekly narrative.
- **G7 / G10 / R5** — Inngest/package rename, Neon `os` / `@shopify-brain` rename. Not this PR.

## G6 + G9 (follow-up)

- **G6** — Operator Settings lists `OPERATOR_CAPABILITY_CATALOG_LIST` (no unfinished `group: "m51"`). Nav still has no `m51.*` items except the mapped Leads row, which stays hidden while `m51.brainstorm` is hidden.
- **G9** — IA module `leads` maps to capability `m51.brainstorm`. `resolveAdsNav`, in-shell `/ads/leads`, and leftover `/app/brainstorm` require both `modules.leads` and a visible `m51.brainstorm`. Modules Settings shows Leads as “Not live” while the capability is unfinished so enablement cannot diverge. No brainstorm product UI.

## G8 (ops / env leftovers)

Canonical map lives in `@shopify-brain/contracts` (`OPS_ENV_REGISTRY`).

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
