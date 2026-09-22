# `@shopify-brain/contracts`

Shared TypeScript contracts for the Cerevex console (Brain) + ads module. Merged from Plan 1.5 plus Origin tharros-os (now Cerevex ads module) M1/M2 (richer tenancy / decision / grant / Neon notes). One package — do not fork `@tharros/contracts`.

Import from `@shopify-brain/contracts`.

## Tenancy

- **Client 1→N Store** via `store_id` (`ClientStoreLink`).
- **AdAccounts hang off Client**, not `store_id`.
- OS rows also carry `workspaceId`.

See `src/tenancy.ts`.

## Decision / authorization

| Envelope | Owner | Meaning |
|---|---|---|
| `os.authorize-to-apply` | OS | OS decides whether a proposed write may be applied |
| `brain.approve-to-publish` | Brain | Human-in-the-loop SEO/content publish |
| `DecisionRecord` | both | `authorize\|deny\|snooze` (OS) ≡ `approve\|reject\|snooze` (Brain) |
| `AuthorizationGrant` | both | `isGrantActive` checks expiry / revoke |

OS auth is **separate** from Brain `APP_PASSWORD` week one.

## Audit

`AuditEventEnvelope` (Brain-friendly) and Origin `AuditEvent` (workspace-scoped). OS `audit_log` is append-only on schema `os`.

## Inngest prefixes

| Prefix | Status |
|---|---|
| `seo/*` | **Keep.** Function IDs `seo-*`. |
| `os/*` | Shared OS orchestration (`os/stub.*`, `os/audit.requested`, `os/apply.requested`) |
| `meta/ads/*` | `jobs/meta/ads` (read/mock sync) |
| `google/ads/*` | `jobs/google/ads` (read/mock sync) |
| `meta/organic/*` | Reserved stub |

## Isolation

- Ads Neon schema = `os` (`OS_DB_SCHEMA` — name stays). Brain = `public` + pgvector.
- Shared `DATABASE_URL` is allowed. **M3 held until shared Neon smoke.** Checklist: `apps/ads/SMOKE.md`.
- No duplicate Neon / Railway / Inngest org for the ads module. Distinct Inngest app ids: Brain `shopify-brain`, ads module `cerevex-ads` (share Cloud keys; do not sync ads onto `shopify-brain`). Env key remains `OS_INNGEST_APP_ID`.
- No Tavily for the ads module.
