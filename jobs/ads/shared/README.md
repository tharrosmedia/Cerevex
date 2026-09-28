# `jobs/ads/shared`

Cross-platform ads Inngest functions. Package name: **`@cerevex/jobs-ads-shared`**.

This is not `@tharros/ads-shared`. Connectors, the apply gate, audit evaluation, and `runAdAccountSync` stay in `@tharros/ads-shared`. This package only registers Inngest functions.

## Locked names (do not rename)

Canonical events stay `ads/*`. Canonical function ids stay `ads-*`.

| Event | Function id | File |
|---|---|---|
| `ads/stub.ping` | `ads-stub-ping` | `src/functions/stub-ping.ts` |
| `ads/stub.sync` | `ads-stub-sync` | `src/functions/stub-sync.ts` |
| `ads/apply.requested` | `ads-apply-requested` | `src/functions/apply-requested.ts` |
| `ads/audit.requested` | `ads-audit-requested` | `src/functions/audit-requested.ts` |
| `ads/account.sync` | `ads-account-sync` | `src/functions/account-sync.ts` |

`ads/account.sync` stays **one** function. Platform is payload data (`meta` | `google`), matching R5/G7. The handler calls `pullMetaAdAccount` / `pullGoogleAdAccount` in the platform packages, then the same `@tharros/ads-shared` sync implementation. Do not register a second `ads-account-sync`.

One-release `os/*` twins (do not emit; still registered):

| Legacy event | Legacy function id | File |
|---|---|---|
| `os/stub.ping` | `os-stub-ping` | `src/functions/legacy/stub-ping.ts` |
| `os/stub.sync` | `os-stub-sync` | `src/functions/legacy/stub-sync.ts` |
| `os/apply.requested` | `os-apply-requested` | `src/functions/legacy/apply-requested.ts` |
| `os/audit.requested` | `os-audit-requested` | `src/functions/legacy/audit-requested.ts` |

Apply still runs `runApplyJob` (kill switch + authorize + freeze). Audit still runs `runAuditRun` and does not write platforms by itself.

## Registration

The ads worker serves these functions at `/api/inngest` on app id **`cerevex-ads`**:

```ts
// apps/ads/workers/src/register.ts
import { functions, FUNCTION_IDS } from "@cerevex/jobs-ads-shared";
```

Client: `@tharros/ads-shared/inngest` (`OS_INNGEST_APP_ID`, default `cerevex-ads`). Do not register this package on Brain’s Cerevex app.

Customers never install Inngest.

## SEO

SEO stays `jobs/seo`. Splitting SEO into LLMs vs search engines is future work and out of this slice.
