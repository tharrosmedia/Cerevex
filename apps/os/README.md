# `apps/os`

Tharros OS — Origin **M1/M2** import (Plan 1.5). Professionally managed ads spine: workspace/client auth, first-party Meta/Google OAuth (read-only), encrypted tokens, Inngest sync of entities + 7d/30d metrics.

No Zapier. No Tavily. No live platform writes. No unsupervised spend. Apply stays behind a workspace kill switch (on by default) and an explicit authorization.

**M3 is held until shared Neon smoke.** Copy-paste checklist: [SMOKE.md](./SMOKE.md) (same Brain `DATABASE_URL`, schema `os`, do not clobber `seo-*`).

## Layout

| Package | Path | Role |
|---|---|---|
| `@shopify-brain/os` | `apps/os` | Umbrella scripts |
| `@tharros/api` | `apps/os/api` | Hono HTTP API |
| `@tharros/web` | `apps/os/web` | Next.js operator shell |
| `@tharros/shared` | `apps/os/shared` | Drizzle schema (`os`), migrate/seed, Inngest client |
| `@tharros/workers` | `apps/os/workers` | Serves `/api/inngest`; OS orchestration + paid job registration |
| `@shopify-brain/jobs-meta-ads` | `jobs/meta/ads` | `meta/ads/*` read/mock sync |
| `@shopify-brain/jobs-google-ads` | `jobs/google/ads` | `google/ads/*` read/mock sync |
| `@shopify-brain/contracts` | `packages/contracts` | Shared envelopes (merged; do not fork) |

`jobs/meta/organic` remains a reserved stub.

## Isolation (week one)

- **OS Neon:** schema `os`. Do not write OS tables into Brain `public` / pgvector.
- **OS auth:** email/password + JWT in `apps/os`. Separate from Brain `APP_PASSWORD`.
- **Inngest:** local app id `tharros-os` (override with `OS_INNGEST_APP_ID`) so Brain `seo-*` sync is not overwritten. Use the **same** Inngest Cloud keys when granted — do not provision a second org.
- **No duplicate** Neon / Railway project for OS. Local docker Postgres (`:54329`) is for OS-only development until shared Neon smoke (M3 held).
- **No Tavily.**

## Local run

From the **repo root** (npm workspaces). Requires Node 20+ and Docker for the OS Postgres.

```bash
npm install

cp apps/os/.env.example apps/os/.env
# Optional: also copy to repo root if you prefer a single .env

npm run os:db:up        # docker compose in apps/os (Postgres :54329)
npm run os:db:migrate   # applies Drizzle SQL into schema os
npm run os:db:seed
npm run os:dev          # api :43180, web :43181, worker :43182, Inngest Dev :43183
```

Or from this directory: `npm run db:up && npm run db:migrate && npm run db:seed && npm run dev` (still uses root workspaces).

Sign in at http://127.0.0.1:43181 as the seeded owner:

- email: `SEED_OWNER_EMAIL` (default `adam@tharrosmedia.com`)
- password: `SEED_OWNER_PASSWORD` (default `local-dev-only`)

Pilots: **Got Ductless**, **KC Prestige**, **Elmar HVAC**. Mock-connect Meta/Google when app IDs are empty, then **Sync now**.

Health:

- API: `GET http://127.0.0.1:43180/health`
- Worker: `GET http://127.0.0.1:43182/health`
- Inngest Dev UI: http://127.0.0.1:43183

## Environment

See `apps/os/.env.example`. Never commit `.env`. Brain env stays in `apps/brain/.env`.

Local compose (`:54329`) is OS-only development. Shared Neon smoke (M3 gate) reuses the **existing Brain `DATABASE_URL`** (same Neon project) and writes only to schema `os` — see [SMOKE.md](./SMOKE.md). Do not provision a second Neon project. Do not run `os:db:seed` against production Brain Neon.

## Inngest names (locked)

| Event | Function ID | Package |
|---|---|---|
| `os/stub.ping` | `os-stub-ping` | `apps/os/workers` |
| `os/stub.sync` | `os-stub-sync` | `apps/os/workers` |
| `os/apply.requested` | `os-apply-requested` | `apps/os/workers` (kill switch + authorize; **no writes**) |
| `meta/ads/account.sync` | `meta-ads-account-sync` | `jobs/meta/ads` |
| `google/ads/account.sync` | `google-ads-account-sync` | `jobs/google/ads` |

Brain `seo/*` / `seo-*` are untouched.

## Tests

```bash
npm run os:db:migrate && npm run os:db:seed
npm run test --workspace=@tharros/api
```

## npm vs pnpm

Origin shipped as a pnpm monorepo. This repo uses **npm workspaces**. Do not add `pnpm-lock.yaml`. `workspace:*` was rewritten to `*`.

## Railway / Neon / Inngest Cloud

Blocked until Adam grants access. Do not invent credentials. Do not provision a second Neon/Railway/Inngest product.

See [SCHEMA.md](./SCHEMA.md) and [Accelerated Merge Plan 1.5](../../docs/accelerated-merge-plan-1.5.md).
