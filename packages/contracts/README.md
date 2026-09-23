# `@cerevex/contracts`

Shared TypeScript contracts for the Cerevex console (Brain) + ads module. Merged from Plan 1.5 plus Origin tharros-os (now Cerevex ads module) M1/M2 (richer tenancy / decision / grant / Neon notes). One package — do not fork `@tharros/contracts`.

Import from `@cerevex/contracts`. Formerly `@shopify-brain/contracts`.

## Tenancy

- **Client 1→N Store** via `store_id` (`ClientStoreLink`).
- **AdAccounts hang off Client**, not `store_id`.
- Ads rows also carry `workspaceId`.

See `src/tenancy.ts`.

## Decision / authorization

| Envelope | Owner | Meaning |
|---|---|---|
| `os.authorize-to-apply` | Ads | Ads decides whether a proposed write may be applied |
| `brain.approve-to-publish` | Brain | Human-in-the-loop SEO/content publish |
| `DecisionRecord` | both | `authorize\|deny\|snooze` (ads) ≡ `approve\|reject\|snooze` (Brain) |
| `AuthorizationGrant` | both | `isGrantActive` checks expiry / revoke |

Ads auth is **separate** from Brain `APP_PASSWORD` week one.

## Audit

`AuditEventEnvelope` (Brain-friendly) and Origin `AuditEvent` (workspace-scoped). Ads `audit_log` is append-only on schema `os` (`ADS_DB_SCHEMA`).

## Inngest prefixes (R5 / G7)

| Prefix | Status |
|---|---|
| `seo/*` | **Keep.** Function IDs `seo-*`. |
| `ads/*` | Canonical ads orchestration + paid sync (`ads/stub.*`, `ads/audit.requested`, `ads/apply.requested`, `ads/account.sync`). Platform is data. |
| `os/*` | Legacy alias for one release (`LEGACY_ADS_EVENTS`). Do not emit. |
| `meta/ads/*` | Legacy alias for one release. Do not emit. |
| `google/ads/*` | Legacy alias for one release. Do not emit. |
| `meta/organic/*` | Reserved stub |

## Isolation

- Ads Neon schema = `os` (`ADS_DB_SCHEMA` — name stays; quarantined, not renamed). Brain = `public` + pgvector.
- Shared `DATABASE_URL` is allowed. **M3 held until shared Neon smoke.** Checklist: `apps/ads/SMOKE.md`.
- No duplicate Neon / Railway / Inngest org for the ads module. Distinct Inngest app ids: Brain `shopify-brain`, ads module `cerevex-ads` (share Cloud keys; do not sync ads onto `shopify-brain`). Env key remains `OS_INNGEST_APP_ID`.
- No Tavily for the ads module.
