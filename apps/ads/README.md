# `apps/ads`

**Cerevex ads module** — Origin M1/M2 import plus M3 audit orchestration and M4 operator cockpit (Plan 1.5). Professionally managed ads spine: workspace/client auth, first-party Meta/Google OAuth (read-only), encrypted tokens, Inngest sync of entities + 7d/30d metrics, then audits → findings → schema-valid **proposed** recommendations. The Next.js cockpit is the read/decide surface: clients, ad accounts, audits, authorize/deny/snooze. It uses the shared Cerevex top shell (Ads as a module) — not a second sidebar chrome. SEO / Review / Stores / Settings link back to the console.

Modules & Nav IA 1.1: first-run onboarding picks a business type (home-service operator / agency / ecommerce). Defaults are Leads ON for all, Clients ON only for agency, Sales ON only for ecommerce, Workflows ON. Flags live in `os.workspaces.settings_json`. Settings → Modules can override; the Ads rail shows only ON modules.

Modularity retrofit + M5.1 Brief 1.6 + M5.2 Phase A–D: product capabilities live in `settings_json.capabilities`. `m51.*`, `m52.callrail_connect`, `m52.bundled_call_tracking`, `m52.crm_join`, `m52.lead_lifecycle`, `m52.booked_job_signal`, `m52.clarity_connect`, `m52.lp_intelligence`, and `apply.create_entity` are live flags (default hidden). `modules.leads` is IA only — the Leads / brainstorm surface also needs `m51.brainstorm` visible. Connector interfaces (`AdPlatformConnector`, `AnalyticsConnector`, `CallTrackingConnector`, `SiteConnector`) live in `@tharros/ads-shared/connectors`. CallRail Connect and bundled Twilio-class tracking swap behind the same interface. Clarity Connect sits on `AnalyticsConnector` and pulls aggregated session signals only. Site apply stays later until a Site connector can mutate. Sync pull, live apply, and OAuth exchange go through `getAdPlatformConnector`. Details: [`docs/modularity-retrofit.md`](../../docs/modularity-retrofit.md) and [`docs/m51-brief-1.6.md`](../../docs/m51-brief-1.6.md).

**No unsupervised ad spend.** Approve is Adam-only in soft-launch (`APPROVE_OPERATOR_EMAILS`, default `adam@tharrosmedia.com`). Apply stays behind a workspace kill switch (on by default), per-account freeze, and an explicit Approve. Deny/Snooze never write platforms.

No Zapier. No Tavily. No auto-approve. No unsupervised spend.

M3 product (audits → findings → proposed recs) does **not** deploy or seed production. Shared Neon is schema `os` only — no `public` migrations. Shared Neon smoke checklist + M3 mock path: [SMOKE.md](./SMOKE.md) (same Brain `DATABASE_URL`, do not clobber `seo-*`).

## Layout

| Package | Path | Role |
|---|---|---|
| `@tharros/ads` | `apps/ads` | Umbrella scripts |
| `@tharros/ads-api` | `apps/ads/api` | Hono HTTP API |
| `@tharros/ads-web` | `apps/ads/web` | Next.js operator shell |
| `@tharros/ads-shared` | `apps/ads/shared` | Drizzle schema (`os`), migrate/seed, Inngest client |
| `@tharros/ads-workers` | `apps/ads/workers` | Serves `/api/inngest`; ads orchestration + paid job registration |
| `@cerevex/jobs-meta-ads` | `jobs/meta/ads` | Legacy `meta/ads/*` listener (one release); canonical sync is `ads/account.sync` |
| `@cerevex/jobs-google-ads` | `jobs/google/ads` | Legacy `google/ads/*` listener (one release); canonical sync is `ads/account.sync` |
| `@cerevex/contracts` | `packages/contracts` | Shared envelopes (merged; do not fork) |

`jobs/meta/organic` remains a reserved stub.

## Isolation (week one)

- **Ads Neon:** schema **`os`** (`ADS_DB_SCHEMA` — name stays; renaming would break Neon prod). Do not write ads tables into Brain `public` / pgvector.
- **Ads auth:** email/password + JWT in `apps/ads`. Separate from Brain `APP_PASSWORD`.
- **Inngest:** default app id `cerevex-ads` (env key `OS_INNGEST_APP_ID` is unchanged so Railway env names are not clobbered mid-flight) so Brain `seo-*` sync is not overwritten. Use the **same** Inngest Cloud keys when granted — do not provision a second org. Canonical ads events are `ads/*` / `ads-*`. Legacy `os/*` / `meta/ads/*` / `google/ads/*` listeners stay for one release.
- **No duplicate** Neon / Railway project for the ads module. Local docker Postgres (`:54329`) is for ads-only development. Do not seed prod from this tree.
- **No Tavily.**

## Local run

From the **repo root** (npm workspaces). Requires Node 20+ and Docker for the ads-module Postgres.

```bash
npm install

cp apps/ads/.env.example apps/ads/.env
# Optional: also copy to repo root if you prefer a single .env

npm run ads:db:up        # docker compose in apps/ads (Postgres :54329)
npm run ads:db:migrate   # applies Drizzle SQL into schema os
npm run ads:db:seed
npm run ads:dev          # api :43180, web :43181, worker :43182, Inngest Dev :43183
```

Or from this directory: `npm run db:up && npm run db:migrate && npm run db:seed && npm run dev` (still uses root workspaces).

Sign in at http://127.0.0.1:43181 as the seeded owner:

- email: `SEED_OWNER_EMAIL` (default `adam@tharrosmedia.com`)
- password: `SEED_OWNER_PASSWORD` (default `local-dev-only`)

Pilots: **Got Ductless**, **KC Prestige**, **Elmar HVAC**. Connect Meta / Connect Google (OAuth when app IDs are set; Advanced mock when they are empty), then **Sync now**, then run an audit. Approve / Deny / Snooze on recommendation detail. Approve is blocked while ads are paused.

Health:

- API: `GET http://127.0.0.1:43180/health`
- Worker: `GET http://127.0.0.1:43182/health`
- Inngest Dev UI: http://127.0.0.1:43183

## Environment

See `apps/ads/.env.example`. Never commit `.env`. Brain env stays in `apps/brain/.env`.

Ads `DATABASE_URL` must resolve to schema `os`. Do not write ads tables into Brain `public` / pgvector. Local compose (`:54329`) is ads-only development and the default for M3 mock-mode smoke. Shared Neon smoke reuses the **existing Brain `DATABASE_URL`** (same Neon project) — see [SMOKE.md](./SMOKE.md). Do not provision a second Neon project. Do not run `ads:db:seed` against production Brain Neon.

## Inngest names (R5 / G7)

Canonical names. Platform is payload data, not the event namespace. Legacy `os/*`, `meta/ads/*`, and `google/ads/*` listeners stay registered for one release.

| Event | Function ID | Package |
|---|---|---|
| `ads/stub.ping` | `ads-stub-ping` | `apps/ads/workers` |
| `ads/stub.sync` | `ads-stub-sync` | `apps/ads/workers` |
| `ads/audit.requested` | `ads-audit-requested` | `apps/ads/workers` (local tables only; **no platform writes**) |
| `ads/apply.requested` | `ads-apply-requested` | `apps/ads/workers` (kill switch + authorize + freeze; executes mutate-existing mutations) |
| `ads/account.sync` | `ads-account-sync` | `apps/ads/workers` (`platform: "meta" \| "google"`) |

Brain `seo/*` / `seo-*` are untouched. Live Inngest app ids stay `shopify-brain` / `cerevex-ads`.

## Tests

```bash
npm run ads:db:migrate && npm run ads:db:seed
npm run test --workspace=@tharros/ads-api
```

M3 mock-mode happy path (no live spend): [SMOKE.md](./SMOKE.md).

## npm vs pnpm

Origin shipped as a pnpm monorepo. This repo uses **npm workspaces**. Do not add `pnpm-lock.yaml`. `workspace:*` was rewritten to `*`.

## Railway deploy (cerevex.store)

Ads services live on the **existing** `cerevex.store` Railway project (same project as Site Brain). Do not provision a second Railway / Neon / Inngest product. Do not invent credentials.

PR #10 renamed `apps/os` → `apps/ads` and npm workspaces `@tharros/api|workers|web` → `@tharros/ads-*`. A production hotfix already applied the new start/build commands in the Railway dashboard. **Keep those commands.** The next dashboard reset or “detect from package.json” will regress if it still uses the pre-rename names.

Canonical commands (repo root is the service root — npm workspaces). Copy these exactly:

| Service | Build command | Start command |
|---|---|---|
| `cerevex-ads-api` | `npm install` | `API_HOST=0.0.0.0 API_PORT=$PORT npm run start --workspace=@tharros/ads-api` |
| `cerevex-ads-workers` | `npm install` | `API_HOST=0.0.0.0 WORKER_PORT=$PORT npm run start --workspace=@tharros/ads-workers` |
| `cerevex-web` | `npm install && npm run build --workspace=@tharros/ads-web` | `cd apps/ads/web && npx next start --hostname 0.0.0.0 --port $PORT` |

Never use these **stale** workspace / path names in Railway start/build commands:

- `@tharros/api` → `@tharros/ads-api`
- `@tharros/workers` → `@tharros/ads-workers`
- `@tharros/web` → `@tharros/ads-web`
- `apps/os` → `apps/ads` (Neon schema **`os` stays `os`**)

`Site Brain` is unchanged: root `npm run build` / `npm start` still serve `apps/brain`. Do **not** add a repo-root `railway.toml` / `railway.json` — Railway Config as Code is deprecated and a root file would override Site Brain as well as the ads services.

In-repo copies of the ads service commands (dashboard remains source of truth; do not set `railwayConfigFile` on these): [`railway/`](./railway/).

Listen vars: API uses `API_HOST` + `API_PORT`; workers use `API_HOST` + `WORKER_PORT`. Both must bind `0.0.0.0` and `$PORT` on Railway. `OS_INNGEST_APP_ID=cerevex-ads` (key name stays). Do not sync the ads worker onto Brain `shopify-brain`.

See [SCHEMA.md](./SCHEMA.md) and [Accelerated Merge Plan 1.5](../../docs/accelerated-merge-plan-1.5.md).
