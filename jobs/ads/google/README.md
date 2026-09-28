# `jobs/ads/google`

Google ads Inngest package. Package name: **`@cerevex/jobs-ads-google`**.

Platform analysis and Google sync/pull land here. There is no separate analysis job in this slice. Canonical account sync stays the single `ads-account-sync` function in `@cerevex/jobs-ads-shared`; that handler calls `pullGoogleAdAccount` when `platform` is `google`.

Do not duplicate apply, audit, or stubs in this package.

## Locked names (do not rename)

| Event | Function id | File |
|---|---|---|
| `google/ads/account.sync` | `google-ads-account-sync` | `src/functions/legacy-account-sync.ts` |

That listener is one-release dual-compat. Do not emit `google/ads/*` from new producers. Canonical sync is `ads/account.sync` with `platform: "google"` (`ads-account-sync`).

`pullGoogleAdAccount` (`src/pull.ts`) is the Google pull entry. It calls `runAdAccountSync` in `@tharros/ads-shared`. Connector code stays there.

## Registration

```ts
// apps/ads/workers/src/register.ts
import { functions, FUNCTION_IDS } from "@cerevex/jobs-ads-google";
```

Served on app id **`cerevex-ads`** (`OS_INNGEST_APP_ID`). Do not register on Brain’s Cerevex app.

`@cerevex/jobs-google-ads` (`jobs/google/ads`) re-exports this package so existing imports keep the same ids. The worker must not serve both.

Customers never install Inngest.

## SEO

SEO stays `jobs/seo`. Splitting SEO into LLMs vs search engines is future work and out of this slice.
