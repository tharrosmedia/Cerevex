# Modularity retrofit (capability flags + connector interfaces)

Lean ship of Product inventory 1.0 / Cos R1+R2 (R3+R4 included where they stayed clean). **No R5. No M5.1/M5.2 product work.**

## Flag registry shape

Stored on `os.workspaces.settings_json.capabilities` (same JSON as Modules & Nav IA — no new table, schema `os` stays `os`).

| State | Meaning |
|---|---|
| `on` | Available |
| `hidden` | Unfinished / off. UI hides. Writes return 409. Reads never throw. |
| `recommend_only` | Visible as a recommendation. No writes. |

Seeded ids: `cockpit`, `apply`, `connect.meta`, `connect.google`, `audits`. Dark placeholders: `m51.budget_shift`, `m51.grok_creatives`, `m51.lp_congruence`, `m51.ga4_connect`, `m51.brainstorm`. R3/R4 also register `apply.bid`, `apply.budget`, `apply.create_entity`, `shell.legacy_ads_web`.

Resolution: catalog default → workspace override → env global kill.

Env kills (no Site Brain redeploy):

- `CAPABILITY_KILL=apply,connect.meta`
- `CAPABILITY_KILL_AUDITS=1` (dots become underscores)
- `FEATURE_BID_MUTATIONS=0` / `FEATURE_BUDGET_MUTATIONS=0` (legacy → `apply.bid` / `apply.budget`)

`GET`/`PATCH /workspace` returns `workspace.capabilities`, `capabilityCatalog`, and `capabilityKills`. Settings → Capabilities (in-shell and leftover ads-web) flips per business.

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
| `AdPlatformConnector` | `meta`, `google`, `mock` | Existing OAuth + pull; mock is a first-class impl |
| `AnalyticsConnector` | `ga4`, `first_party` | Stub — compiles only |
| `CallTrackingConnector` | `callrail` (connect), `bundled` | Stub — compiles only |

Shared `Connector` surface: `isConfigured`, `connect`, `disconnect`. Meta + CallRail both satisfy it. No real GA4/CallRail product work.

## R3 (same PR)

- Apply gate + `os/apply.requested` **kept**.
- Mutation families (`pause`, `negatives`, `placement_exclude`, `bid`, `budget`, `create_entity`) sit behind the registry. Bid/budget env flags migrated.
- Sealed apply job type `create_entity` for a later Grok path. UI still never does sync platform writes.

## R4 (same PR)

- One ads-nav catalog in `@shopify-brain/contracts` (`resolveAdsNav`). In-shell `/ads` is the operator path.
- Leftover `apps/ads/web` is hard-blocked unless `shell.legacy_ads_web` is on (default hidden). Authenticated `/app/*` redirects to in-shell `/ads`. `NEXT_PUBLIC_ADS_LEGACY_CHROME=1` remains the console cross-origin link gate.
- Cross-origin `NEXT_PUBLIC_ADS_ORIGIN` is ignored unless `NEXT_PUBLIC_ADS_LEGACY_CHROME=1`.

## Deferred

- **R5** — no deploy/naming quarantine, no Neon `os` rename, no `@shopify-brain` package rename.
- **M5.1 Brief 1.6** — no budget-shift UI, Grok creatives, LP congruence, GA4 connect UX, or brainstorm product.
- **M5.2** — no heatmaps, CallRail product, CRM, weekly narrative.
