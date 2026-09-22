# Shared Neon smoke (Plan 1.5 / M3 gate)

Copy-paste checklist for **one** existing Brain Neon project. Do **not** provision a second Neon (or Railway / Inngest org). No Meta/Google writes. No M3 product work.

This environment typically does **not** have Brain production `DATABASE_URL`. Run the SQL / migrate steps only after someone grants that URL from vault (or Railway Brain service env). Do not invent secrets.

---

## What this smoke proves

1. OS migrations land only in schema **`os`**.
2. Brain `public` + `vector` (pgvector) tables are untouched.
3. A simple `SELECT` against `os` works (API `/health` if you start OS).
4. Inngest apps stay split: Brain `shopify-brain` (`seo/*` / `seo-*`) vs OS `tharros-os` (`os/*`, `meta/ads/*`, `google/ads/*`). Syncing OS must not overwrite SEO.

---

## Schema isolation evidence (repo)

| File | What it does |
|---|---|
| `apps/os/shared/src/schema.ts` | `export const osSchema = pgSchema("os")` — every OS table/enum is in `os` |
| `apps/os/shared/drizzle.config.ts` | `schemaFilter: ["os"]` |
| `apps/os/shared/src/migrate.ts` | `CREATE SCHEMA IF NOT EXISTS "os"` then Drizzle migrate with `search_path=os,public` |
| `apps/os/shared/drizzle/0000_m1_spine.sql` | `CREATE SCHEMA IF NOT EXISTS "os"`; `CREATE TYPE "os".…`; `CREATE TABLE "os"."…"` |
| `apps/os/shared/drizzle/0001_m2_connect.sql` | `CREATE TABLE "os"."ad_entities"` / `"os"."ad_metrics"` + ALTERs on `"os".…` |
| `packages/contracts/src/neon.ts` | `OS_DB_SCHEMA = "os"`; Brain forbidden: `public`, `pgvector` |
| `apps/brain/db/migrations/0001_init.sql` | Brain `public` tables + `CREATE EXTENSION vector` (no schema `os`) |

Exact SQL that creates the isolated schema (first statement of `0000_m1_spine.sql`, also issued by `migrate.ts`):

```sql
CREATE SCHEMA IF NOT EXISTS "os";
```

Enums and tables are schema-qualified, for example:

```sql
CREATE TYPE "os"."app_role" AS ENUM('owner', 'operator', 'client_readonly');
CREATE TYPE "os"."decision_action" AS ENUM('authorize', 'deny', 'snooze');
CREATE TYPE "os"."platform" AS ENUM('meta', 'google');
CREATE TABLE "os"."workspaces" ( … );
CREATE TABLE "os"."users" ( … );
-- … remaining M1 tables in "os" …
```

M2 (`0001_m2_connect.sql`) adds `"os"."ad_entities"`, `"os"."ad_metrics"`, and columns on existing `"os"` tables.

**Why `search_path`:** Drizzle column types are written as `"platform"` (unprefixed) while the type lives at `"os"."platform"`. Migrations must run with `search_path` including `os` (migrate.ts sets this). Do not create those enums in `public`.

Drizzle also creates journal schema **`drizzle`** (`__drizzle_migrations`). That is expected and is not a Brain table.

---

## Inngest non-clobber evidence (repo)

| Side | App id | Serve route | Function IDs | Events |
|---|---|---|---|---|
| Brain SEO | `INNGEST_APP_ID` **or** `shopify-brain` | Next: `apps/brain/app/api/inngest/route.ts` → `{PUBLIC_URL}/api/inngest` | `seo-*` (+ helpers `update-job-status`, `log-event`) | `seo/*` |
| OS | `OS_INNGEST_APP_ID` **or else** `INNGEST_APP_ID` **or else** `tharros-os` | Worker: `apps/os/workers/src/index.ts` → `http://<API_HOST>:<WORKER_PORT>/api/inngest` (local `:43182`) | `os-*`, `meta-ads-*`, `google-ads-*` | `os/*`, `meta/ads/*`, `google/ads/*` |

Wiring:

- Brain client: `jobs/seo/src/client.ts` — `id: process.env.INNGEST_APP_ID \|\| 'shopify-brain'`
- Brain register: `apps/brain/src/inngest/index.ts` re-exports `@shopify-brain/jobs-seo`
- Brain Cloud resync: `apps/brain/scripts/sync-inngest.ts` → `POST https://api.inngest.com/v2/apps/${appId}/syncs` with `{ url: PUBLIC_URL + '/api/inngest' }` (`npm run inngest:sync`)
- OS client: `apps/os/shared/src/inngest.ts` — `id: OS_INNGEST_APP_ID \|\| INNGEST_APP_ID \|\| "tharros-os"`
- OS serve: worker `GET/POST` `/api/inngest` (Inngest `serve` from `inngest/node`)
- Local OS Dev Server: `apps/os/package.json` `dev` → `inngest-cli … --port 43183 -u http://127.0.0.1:43182/api/inngest`

SEO IDs that must remain registered on **`shopify-brain`** (do not rename):

`seo-job`, `seo-ensure-job`, `seo-research`, `seo-create-brief`, `seo-write-draft`, `seo-edit-draft`, `seo-optimize-draft`, `seo-evaluate`, `seo-grade-draft`, `seo-revise-draft`, `seo-save-draft`, `seo-save-approval`, `seo-publish`, `seo-catalog-sync`, `seo-gsc-sync`, `seo-audit`, plus helpers `update-job-status`, `log-event`.

OS IDs that belong only on **`tharros-os`**:

`os-stub-ping`, `os-stub-sync`, `os-apply-requested`, `meta-ads-account-sync`, `google-ads-account-sync`.

### Exact env vars

**Brain process** (`apps/brain/.env` / Railway Brain service):

| Var | Role |
|---|---|
| `DATABASE_URL` | Existing Brain Neon (public + pgvector) |
| `INNGEST_EVENT_KEY` | Inngest Cloud event key (same org as OS) |
| `INNGEST_SIGNING_KEY` | Inngest Cloud signing key |
| `INNGEST_API_KEY` | Management key for `npm run inngest:sync` only |
| `INNGEST_APP_ID` | Optional; default **`shopify-brain`** |
| `PUBLIC_URL` | Brain public origin only, e.g. `https://cerevex.store` (code appends `/api/inngest`) |

**OS process** (`apps/os/.env` — not Brain `APP_PASSWORD`):

| Var | Role |
|---|---|
| `DATABASE_URL` | **Same** Brain Neon URL (same project). Schema `os` isolates tables |
| `OS_INNGEST_APP_ID` | **Set to `tharros-os`.** Required in any env that also has `INNGEST_APP_ID=shopify-brain` |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Reuse Brain Cloud keys. Do **not** create a second Inngest org |
| `INNGEST_DEV` | Local Dev Server only (`http://127.0.0.1:43183`). Unset in Cloud |
| `TOKEN_ENCRYPTION_KEY` | OS token-at-rest (not Brain `ENCRYPTION_KEY`) |
| `JWT_SECRET` | OS auth (not Brain `APP_PASSWORD`) |

**Clobber rule:** Inngest Cloud **app sync replaces that app’s function set**. If the OS worker is synced to app id `shopify-brain`, SEO functions disappear.

- Always set `OS_INNGEST_APP_ID=tharros-os` when OS can see Brain env.
- Never point `PUBLIC_URL` / Brain `inngest:sync` at the OS worker (`:43182`).
- Never run Brain `npm run inngest:sync` with an OS serve URL.
- OS has no Cloud sync script yet. If you add one, it must target app **`tharros-os`** and the **OS worker** `/api/inngest` URL only.

---

## Copy-paste checklist

### 0. Prerequisites (human / vault)

- [ ] Brain production `DATABASE_URL` from vault or Railway Brain service (same Neon project).
- [ ] Confirm you will **not** create a second Neon project.
- [ ] Confirm no Meta/Google live writes (leave `META_APP_*` / `GOOGLE_*` empty; do not click live Sync).
- [ ] Confirm M3 product work is still held.

```bash
# From repo root after granting DATABASE_URL (do not commit it)
export DATABASE_URL='<paste Brain Neon URL from vault>'
# Optional: if the URL has no sslmode and Neon requires TLS
# export DATABASE_URL="${DATABASE_URL}?sslmode=require"
```

### 1. Snapshot Brain public / pgvector (before)

```bash
node --input-type=module <<'JS'
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tables = await pool.query(`
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
  ORDER BY 1, 2`);
const ext = await pool.query(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
const knowledge = await pool.query(`
  SELECT n.nspname AS schema, c.relname AS table, a.attname AS column,
         format_type(a.atttypid, a.atttypmod) AS type
  FROM pg_attribute a
  JOIN pg_class c ON a.attrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public' AND c.relname = 'knowledge' AND a.attname = 'embedding'`);
const counts = await pool.query(`
  SELECT
    (SELECT count(*) FROM public.stores) AS stores,
    (SELECT count(*) FROM public.jobs) AS jobs,
    (SELECT count(*) FROM public.knowledge) AS knowledge`);
console.log("public tables:", tables.rows.map((r) => r.table_name).join(", "));
console.log("vector extension:", ext.rows);
console.log("knowledge.embedding:", knowledge.rows);
console.log("row counts:", counts.rows[0]);
await pool.end();
JS
```

Expected public tables (Brain migrations `0001`–`0010`):  
`stores`, `jobs`, `drafts`, `approvals`, `knowledge`, `events`, `products`, `catalog_resources`, `gsc_rows`, `seo_findings` (plus any later Brain tables).  
`knowledge.embedding` should remain `vector(1536)`. Save the row counts.

### 2. Create schema `os` + run OS migrations

`migrate.ts` already runs `CREATE SCHEMA IF NOT EXISTS "os"` and sets `search_path` to `os, public`.

```bash
# Same DATABASE_URL as Brain. Do not change the Neon project.
# Do NOT run os:db:seed against production (would write local-dev owner password).
cp -n apps/os/.env.example apps/os/.env
# Put DATABASE_URL into apps/os/.env (or export it). Leave META_/GOOGLE_ blank.

npm run os:db:migrate
```

Manual SQL equivalent (if you use `psql` instead of the migrator):

```sql
CREATE SCHEMA IF NOT EXISTS os;
SET search_path TO os, public;
-- then apply apps/os/shared/drizzle/0000_m1_spine.sql
-- then apply apps/os/shared/drizzle/0001_m2_connect.sql
```

### 3. Verify Brain public / pgvector untouched

Re-run the snapshot from step 1. Pass if:

- [ ] Same `public` table list (no `workspaces`, `ad_accounts`, `oauth_credentials`, … in `public`)
- [ ] `vector` extension still present
- [ ] `public.knowledge.embedding` still `vector(1536)`
- [ ] `stores` / `jobs` / `knowledge` counts unchanged

```bash
node --input-type=module <<'JS'
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const leaked = await pool.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'workspaces','users','memberships','clients','ad_accounts',
      'oauth_credentials','ad_entities','ad_metrics','recommendations'
    )`);
if (leaked.rows.length) {
  console.error("FAIL: OS tables leaked into public:", leaked.rows);
  process.exit(1);
}
console.log("PASS: no OS table names in public");
await pool.end();
JS
```

### 4. Verify `os` schema + simple SELECT / health

```bash
node --input-type=module <<'JS'
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const schema = await pool.query(`SELECT nspname FROM pg_namespace WHERE nspname = 'os'`);
const tables = await pool.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'os' AND table_type = 'BASE TABLE'
  ORDER BY 1`);
const ping = await pool.query(`SELECT count(*)::int AS workspaces FROM os.workspaces`);
console.log("schema os:", schema.rows);
console.log("os tables:", tables.rows.map((r) => r.table_name).join(", "));
console.log("SELECT os.workspaces:", ping.rows[0]);
if (!schema.rows.length || !tables.rows.length) process.exit(1);
await pool.end();
JS
```

Expected `os` tables include:  
`workspaces`, `users`, `memberships`, `clients`, `client_memberships`, `ad_accounts`, `ad_entities`, `ad_metrics`, `oauth_credentials`, `recommendations`, `decisions`, `authorizations`, `apply_jobs`, `audit_log`, plus stubs (`audit_runs`, `findings`, `brainstorm_*`, `workflow*`).

Optional API health (needs OS process + same `DATABASE_URL`; no platform writes):

```bash
# JWT_SECRET required to boot; META_/GOOGLE_ stay empty
npm run os:dev
# other terminal
curl -sS http://127.0.0.1:43180/health
curl -sS http://127.0.0.1:43182/health
```

`checks.db` should be `"ok"`. Worker `checks.functions` should be the OS / paid IDs only (no `seo-*`).

### 5. Inngest: keep separate app ids

```bash
# Brain — leave production SEO sync alone
#   INNGEST_APP_ID=shopify-brain   (or unset)
#   serve: $PUBLIC_URL/api/inngest
#   npm run inngest:sync   # only with Brain PUBLIC_URL

# OS — explicit app id so Brain INNGEST_APP_ID cannot win the fallback
export OS_INNGEST_APP_ID=tharros-os
# Reuse Brain INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY when granted.
# Do NOT set INNGEST_APP_ID=shopify-brain on the OS worker.
# Do NOT POST a sync to /v2/apps/shopify-brain/syncs with the OS worker URL.
```

Local (does not touch Cloud SEO):

```bash
# already part of npm run os:dev — Inngest Dev :43183 → worker :43182/api/inngest
# Brain local Dev (separate terminal / port) stays:
#   npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Cloud check (dashboard, after keys exist): app **`shopify-brain`** still lists `seo-job` / `seo-*`. App **`tharros-os`** lists `os-*` / `meta-ads-*` / `google-ads-*` only.

---

## Out of scope / do not do

- Second Neon project, second Railway project, second Inngest org
- `npm run os:db:seed` on production Brain Neon
- Live Meta/Google OAuth or Sync
- M3 features
- Renaming `seo/*` → `brain/*`

---

## Blockers (this agent run)

Recorded 2026-09-22 from a Cloud Agent on `tharrosmedia/Shopify-Brain` `main` (PR #5 merged). No secrets invented.

| Blocker | Why |
|---|---|
| **`DATABASE_URL` (vault)** | Not in process env, not in any `.env`. Cannot apply migrations or run the SELECT against Brain Neon. |
| **Railway access** | No `railway` CLI / `RAILWAY_TOKEN`. Cannot read Brain service env or attach OS to the existing Railway project. |
| **Inngest Cloud keys** | `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` / `INNGEST_API_KEY` unset. Cannot verify Cloud app listings; do not sync. |
| **`psql`** | Not installed here; use the Node `pg` snippets above (or local `psql`) after `DATABASE_URL` is granted. |

Unblock: paste Brain `DATABASE_URL` into the agent/OS env (same Neon project), then re-run steps 1–4. Railway is only needed if OS must deploy onto the existing Brain project — not required for a laptop smoke against the granted URL.
