# `@shopify-brain/contracts`

Shared TypeScript contracts for Brain + OS. Day one of Accelerated Merge Plan 1.5.

Import from `@shopify-brain/contracts`. These types are the contract surface; Brain SEO persistence is unchanged.

## Tenancy

- **Client 1→N Store** via `store_id`.
- **AdAccounts hang off Client**, not `store_id`. A client may have many stores and many ad accounts; they are not 1:1.

See `src/tenancy.ts`.

## Decision / authorization envelopes

Two gates. Do not collapse them.

| Envelope | Owner | Meaning |
|---|---|---|
| `os.authorize-to-apply` | OS | OS decides whether a proposed write may be applied |
| `brain.approve-to-publish` | Brain | Human-in-the-loop SEO/content publish (existing path) |

OS auth is **separate** from Brain `APP_PASSWORD` week one. Do not bolt OS RBAC onto Brain login.

See `src/authorization.ts`.

## Audit event envelope

Shared shape for audit rows. Brain events today are store-scoped on Brain Neon (`public` + pgvector). OS events will use the **isolated OS Neon schema**. Do not merge OS tables into Brain public/pgvector.

See `src/audit.ts`.

## Inngest prefixes

| Prefix | Status |
|---|---|
| `seo/*` | **Keep.** Existing Brain SEO path. Function IDs stay `seo-*`. Do not rename to `brain/*`. |
| `meta/ads/*` | Reserved. Placeholder only (`jobs/meta/ads`). |
| `meta/organic/*` | Reserved. Placeholder only (`jobs/meta/organic`). |
| `google/ads/*` | Reserved. Placeholder only (`jobs/google/ads`). |

No unsupervised ad writes. No Meta/Google mutate in this reshape.

See `src/inngest.ts`.

## Isolation (week one)

- OS Neon = isolated schema. Brain Neon = existing public + pgvector.
- OS auth ≠ Brain `APP_PASSWORD`.
- No duplicate Neon / Railway / Inngest for OS.
- No Tavily requirement for OS.
- **M3 held until shared Neon smoke.**

See `src/isolation.ts`.
