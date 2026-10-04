# `apps/ads`

**Cerevex ads module** — Origin M1/M2 import plus M3 audit orchestration and M4 operator cockpit (Plan 1.5). Professionally managed ads spine: workspace/client auth, first-party Meta/Google OAuth (read-only), encrypted tokens, Inngest sync of entities + 7d/30d metrics, then audits → findings → schema-valid **proposed** recommendations. The Next.js cockpit is the read/decide surface: clients, ad accounts, audits, authorize/deny/snooze. It uses the shared Cerevex top shell (Ads as a module) — not a second sidebar chrome. SEO / Review / Stores / Settings link back to the console.

Modules & Nav IA 1.1: first-run onboarding picks a business type (home-service operator / agency / ecommerce). Defaults are Leads ON for all, Clients ON only for agency, Sales ON only for ecommerce, Workflows ON. Flags live in `os.workspaces.settings_json`. Settings → Modules can override; the Ads rail shows only ON modules.

Modularity retrofit + M5.1 Brief 1.6 + M5.2 Phase A–F: product capabilities live in `settings_json.capabilities`. `m51.*`, `m52.callrail_connect`, `m52.bundled_call_tracking`, `m52.crm_join`, `m52.lead_lifecycle`, `m52.booked_job_signal`, `m52.clarity_connect`, `m52.lp_intelligence`, `m52.creative_fatigue`, `m52.search_negatives`, `m52.geo_discipline`, `m52.brand_guardrails`, `m52.seasonality_calendar`, `m52.owner_weekly_narrative`, and `apply.create_entity` are live flags (default hidden). `modules.leads` is IA only — the Leads / brainstorm surface also needs `m51.brainstorm` visible. Connector interfaces (`AdPlatformConnector`, `AnalyticsConnector`, `CallTrackingConnector`, `SiteConnector`) live in `@tharros/ads-shared/connectors`. CallRail Connect and bundled Twilio-class tracking swap behind the same interface. Clarity Connect sits on `AnalyticsConnector` and pulls aggregated session signals only. Site apply stays later until a Site connector can mutate. Sync pull, live apply, and OAuth exchange go through `getAdPlatformConnector`. Details: [`docs/modularity-retrofit.md`](../../docs/modularity-retrofit.md) and [`docs/m51-brief-1.6.md`](../../docs/m51-brief-1.6.md).

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
| `@tharros/ads-workers` | `apps/ads/workers` | Thin host: env, health, `/api/inngest` on app id `cerevex-ads` |
| `@cerevex/jobs-ads-shared` | `jobs/ads/shared` | Stubs, apply, audit, canonical `ads/account.sync` |
| `@cerevex/jobs-ads-meta` | `jobs/ads/meta` | Meta pull + legacy `meta/ads/*` listener |
| `@cerevex/jobs-ads-google` | `jobs/ads/google` | Google pull + legacy `google/ads/*` listener |
| `@cerevex/jobs-meta-ads` | `jobs/meta/ads` | Legacy-thin re-export of `@cerevex/jobs-ads-meta` until dual-compat removal |
| `@cerevex/jobs-google-ads` | `jobs/google/ads` | Legacy-thin re-export of `@cerevex/jobs-ads-google` until dual-compat removal |
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

## Migration ledger

`ads:db:migrate` records applied files in `os.__drizzle_migrations`. That is the ledger prod already has. There is no `drizzle` schema. The only production migrate command is [Production migrate](#production-migrate). `ads:db:migrate` and the Bun one-shot are local or other non-production only. Migrate refuses when schema `os` already has tables but `os.__drizzle_migrations` is missing or empty, including a database whose rows are still in `drizzle.__drizzle_migrations`. For that local or other non-production database, create the os ledger if needed and copy it once, then run migrate again:

```sql
CREATE TABLE IF NOT EXISTS os.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO os.__drizzle_migrations (hash, created_at) SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;
```

Do not run that copy against production. To list a local ledger, the script only reads:

```bash
npm run ledger --workspace=@tharros/ads-shared
```

SQL in `apps/ads/shared/drizzle/*.sql` is immutable once applied or merged to `main`. `.gitattributes` forces LF on those files. A hash mismatch prints the expected hash and the hash that was found. `ADS_MIGRATIONS_FOLDER` is honored only when `NODE_ENV=test`. Any other value is refused before that folder is read. Rollback SQL belongs in `apps/ads/shared/drizzle-rollbacks/`, outside the migrator folder.

The hand steps below are for a local or other non-production database. Do not use them on production.

If migrate refuses a tag whose `when` is at or below the latest applied `created_at`, changing that `when` in place will not apply it. Either:

1. Apply `<tag>.sql` by hand with `search_path` set to `os, public`. Insert one row into `os.__drizzle_migrations`: `hash` is the sha256 hex of the file text, and `created_at` is the journal `when`. Then run migrate again.
2. Re-tag it. Remove the skipped tag from the journal and delete that `.sql` from `apps/ads/shared/drizzle/`. Add a new tag whose `when` is after every journal `when` and after the latest applied `created_at`. Do not change the `when` of a tag that is already applied.

Sign in at http://127.0.0.1:43181 as the seeded owner:

- email: `SEED_OWNER_EMAIL` (default `adam@tharrosmedia.com`)
- password: `SEED_OWNER_PASSWORD` (default `local-dev-only`)

Pilots: **Got Ductless**, **KC Prestige**, **Elmar HVAC**. Connect Meta / Connect Google (OAuth when app IDs are set; Advanced mock when they are empty), then **Sync now**, then run an audit. Approve / Deny / Snooze on recommendation detail. Approve is blocked while ads are paused.

Health:

- API: `GET http://127.0.0.1:43180/health`
- Worker: `GET http://127.0.0.1:43182/health`
- Inngest Dev UI: http://127.0.0.1:43183

## Production migrate

Adam, or an ops shell that already has the prod URL, runs this once before a deploy that needs a new `os` tag. Do not run it twice at once. It does not seed, and it does not apply Brain `public` migrations. `npm run ads:db:migrate` and `bun artifacts/os-neon-migrate.ts` stay local or other non-production only.

```bash
PRODUCTION_NEON_HOST=<neon-host> DATABASE_URL='<prod-url>' npm run ads:db:migrate:prod -- --host <neon-host> --confirm
```

`<neon-host>` is the hostname only (no user, password, or path). `DATABASE_URL` must set `sslmode=require` or stricter (`verify-ca`, `verify-full`) on every host, including loopback. `sslmode=disable` is refused. A missing `sslmode` is refused unless the test-only flag `OS_PROD_MIGRATE_ALLOW_INSECURE_LOOPBACK=1` is set, and that flag is honored only when the host is loopback (`127.0.0.1`, `localhost`, or `::1`). Do not set it for a production run. The host node-postgres will connect to (parsed with `pg-connection-string`, the same parser as `pg`) must equal `--host` and `PRODUCTION_NEON_HOST`. The command checks that before it connects. It refuses a `host` or `hostaddr` query parameter, an `options` parameter (including `endpoint=`), more than one host, a unix-socket host, and `endpoint=` in the password. It never prints `DATABASE_URL`. Put the URL in the environment only. Do not commit it. Optional `--statement-timeout` overrides the statement timeout. The default is `120s`. Example: `--statement-timeout 5min`. The value must be a duration such as `120s`, `500ms`, or `5min`.

Before any write it opens a read-only transaction, lists `os.__drizzle_migrations`, and prints JSON: `applied` tags and the `pending` tags it would apply. A bundled migration is applied only when `artifacts/<tag>.sql` and the `sql` field in `artifacts/os-migrate-bundle.json` share one sha256, and the SQL is schema-qualified to `os`. Comments and string literals are ignored for that check. It refuses `public.` identifiers, `SET SCHEMA public`, `ALTER ... SET SCHEMA public`, and `SET search_path` or `SET LOCAL search_path` to anything other than `os`. A `public.` mention that appears only in a comment is allowed. A ledger row counts as that migration only when both `hash` and `created_at` match the bundle. Anything else is drift or an unknown row: a hash on the right `created_at` that is not the artifact hash, a known hash on the wrong `created_at`, a row that matches nothing, a duplicate, or a later tag applied while an earlier tag is missing. Those cases print the problem and refuse before any write. This command does not create `os.__drizzle_migrations`.

Each pending tag then runs in its own transaction. The transaction first takes `pg_advisory_xact_lock(hashtext('cerevex.os-prod-migrate')::bigint)`, which is this command's lock. That wait uses a 30s `lock_timeout`. If another run still holds the lock, the command refuses with "another migrate run holds the lock." After the lock is held, the transaction sets `lock_timeout` to 5s for the DDL and `statement_timeout` to the `--statement-timeout` value (default `120s`), then reads the ledger again before it runs the SQL. The SQL and the ledger insert commit together. A failure rolls that tag back. Tags already committed earlier in the same run stay applied. A second overlapping run either applies nothing or refuses. Running the command again after a success applies only what the ledger still does not have. When every bundled tag is already applied, `--confirm` writes nothing. Still do not start two runs at once.

Replace `--confirm` with `--dry-run` to print the same listing and write nothing. Omitting both flags prints the listing and refuses to write. `--host` is required. It does not default.

### Rollback

Note the Neon point-in-time restore timestamp before you run the command. This command does not run down migrations and does not delete ledger rows. Undo for a migration it has committed is that Neon restore, or a new forward migration whose `when` is after every applied `created_at`. A point-in-time restore rewinds the whole Neon branch, including Brain's `public` schema, not only `os`. Do not edit applied SQL, do not apply files with `psql`, and do not change `os.__drizzle_migrations` on production. SQL in `apps/ads/shared/drizzle-rollbacks/` is not applied here.

## Environment

See `apps/ads/.env.example`. Never commit `.env`. Brain env stays in `apps/brain/.env`.

Ads `DATABASE_URL` must resolve to schema `os`. Do not write ads tables into Brain `public` / pgvector. Local compose (`:54329`) is ads-only development and the default for M3 mock-mode smoke. Shared Neon smoke reuses the **existing Brain `DATABASE_URL`** (same Neon project) — see [SMOKE.md](./SMOKE.md). Do not provision a second Neon project. Do not run `ads:db:seed` against production Brain Neon.

Tests and the seed script refuse a production Neon compute only when `PRODUCTION_NEON_HOST` or `PRODUCTION_DATABASE_URL` is set. Without either variable the guard cannot tell that compute from a branch compute: an unmarked Neon host is refused by default and allowed only with `ALLOW_NONLOCAL_TEST_DB=1`. Ops boxes set `PRODUCTION_NEON_HOST` to the hostname only (no scheme and no path) in a shell env file, for example `ep-….aws.neon.tech`. Do not commit that hostname. Those production URLs are parsed on their own: process `PGOPTIONS` and `PGPASSWORD` are not copied into the production endpoint set. The guard reads a Neon routing id from the URL password and from `PGPASSWORD` when the URL has no password. It does not read `~/.pgpass` or `PGPASSFILE`, so a routing id that exists only in a pgpass file is not checked.

## Inngest names (R5 / G7)

Canonical names. Platform is payload data, not the event namespace. Legacy `os/*`, `meta/ads/*`, and `google/ads/*` listeners stay registered for one release.

| Event | Function ID | Package |
|---|---|---|
| `ads/stub.ping` | `ads-stub-ping` | `@cerevex/jobs-ads-shared` |
| `ads/stub.sync` | `ads-stub-sync` | `@cerevex/jobs-ads-shared` |
| `ads/audit.requested` | `ads-audit-requested` | `@cerevex/jobs-ads-shared` (local tables only; **no platform writes**) |
| `ads/apply.requested` | `ads-apply-requested` | `@cerevex/jobs-ads-shared` (kill switch + authorize + freeze; executes mutate-existing mutations) |
| `ads/account.sync` | `ads-account-sync` | `@cerevex/jobs-ads-shared` (one function; `platform: "meta" \| "google"` selects the pull in `jobs/ads/meta` or `jobs/ads/google`) |

One-release aliases stay registered: `os/*` on `@cerevex/jobs-ads-shared`, `meta/ads/account.sync` on `@cerevex/jobs-ads-meta`, `google/ads/account.sync` on `@cerevex/jobs-ads-google`. Customers never install Inngest. SEO stays `jobs/seo`; an LLMs vs search engines split is future and out of this slice.

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
