# Accelerated Merge Plan 1.5

Accepted by Adam. This repo is being reshaped **in place** (no force-push of `main`).

**Current product name:** Cerevex. Ads work is the Cerevex ads module at `apps/ads` (formerly `apps/os` / Tharros OS). Neon schema **`os` stays `os`**. Inngest ads app id default is `cerevex-ads` (env key `OS_INNGEST_APP_ID` unchanged). Brain SEO Inngest app id stays `shopify-brain`. GitHub repo rename is out of scope.

## Day 1–2 (this PR)

Monorepo reshape of `tharrosmedia/Shopify-Brain` to the locked tree:

```
apps/brain
apps/ads
jobs/meta/ads
jobs/meta/organic
jobs/google/ads
jobs/seo
packages/contracts
packages/db
packages/shared
```

- Introduce an npm workspace root without breaking Brain.
- Move today's Next.js app to `apps/brain/` (including the App Router `app/` dir).
- Move Inngest SEO functions to `jobs/seo/`. **Keep** event names `seo/*` and function IDs `seo-*`.
- Re-wire serve so Brain `/api/inngest` still registers those functions.
- Placeholder dirs for Meta/Google jobs (prefixes only).
- `packages/contracts` types for tenancy, authz envelopes, audit, Inngest prefixes.
- Thin `packages/db` and `packages/shared` stubs.
- `apps/ads` placeholder for the upcoming Origin **tharros-os M1/M2** import. Do not invent product features.
- Path-filtered CI so Brain + `jobs/seo` stay green independently of `apps/ads`.

## Follow-up (landed on this PR)

Origin tharros-os (now Cerevex ads module) M1/M2 is imported into `apps/ads` (api/web/shared/workers). Paid sync mapped to `jobs/meta/ads` and `jobs/google/ads`.

Still held: shared Neon smoke (M3), live Meta/Google mutate, Railway/Neon provisioning.

## Held

**M3 is held until shared Neon smoke.**

## Hard constraints

- No duplicate Neon / Railway / Inngest for OS.
- No unsupervised ad writes / no Meta-Google mutate.
- No Tavily requirement for OS.
- Do not mass-rename `seo/*` → `brain/*`.
- Do not bolt OS RBAC onto Brain `APP_PASSWORD`.
- Do not merge OS tables into Brain `public` / pgvector.
- Prefer the smallest safe move; preserve the Brain SEO path.

## Isolation (week one)

- OS Neon: isolated schema.
- OS auth: separate from Brain `APP_PASSWORD`.
- Shared Inngest **Cloud keys** (same org). Distinct app ids so OS sync cannot clobber SEO: Brain `shopify-brain` (`seo/*` / `seo-*`), OS `cerevex-ads` (`os/*`, `meta/ads/*`, `google/ads/*`). Checklist: [`apps/ads/SMOKE.md`](../apps/ads/SMOKE.md).
