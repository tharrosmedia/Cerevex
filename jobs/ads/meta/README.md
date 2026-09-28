# `jobs/ads/meta`

Meta ads Inngest package. Package name: **`@cerevex/jobs-ads-meta`**.

Platform analysis and Meta sync/pull land here. There is no separate analysis job in this slice. Canonical account sync stays the single `ads-account-sync` function in `@cerevex/jobs-ads-shared`; that handler calls `pullMetaAdAccount` when `platform` is `meta`.

Do not duplicate apply, audit, or stubs in this package.

## Locked names (do not rename)

| Event | Function id | File |
|---|---|---|
| `meta/ads/account.sync` | `meta-ads-account-sync` | `src/functions/legacy-account-sync.ts` |

That listener is one-release dual-compat. Do not emit `meta/ads/*` from new producers. Canonical sync is `ads/account.sync` with `platform: "meta"` (`ads-account-sync`).

`pullMetaAdAccount` (`src/pull.ts`) is the Meta pull entry. It calls `runAdAccountSync` in `@tharros/ads-shared`. Connector code stays there.

## Registration

```ts
// apps/ads/workers/src/register.ts
import { functions, FUNCTION_IDS } from "@cerevex/jobs-ads-meta";
```

Served on app id **`cerevex-ads`** (`OS_INNGEST_APP_ID`). Do not register on Brain’s Cerevex app.

`@cerevex/jobs-meta-ads` (`jobs/meta/ads`) re-exports this package so existing imports keep the same ids. The worker must not serve both.

Customers never install Inngest.

## SEO

SEO stays `jobs/seo`. Splitting SEO into LLMs vs search engines is future work and out of this slice.
