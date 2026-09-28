# `jobs/ads`

Ads Inngest packages. Shape B: one package per platform under `jobs/ads/{platform}`, plus a soft cross-platform package. Not one flat `jobs/ads` package that owns every platform.

| Path | Package | Owns |
|---|---|---|
| `jobs/ads/shared` | `@cerevex/jobs-ads-shared` | Cross-platform stubs, apply, audit, and the single canonical `ads/account.sync` registration |
| `jobs/ads/meta` | `@cerevex/jobs-ads-meta` | Meta pull entry + legacy `meta/ads/*` listener |
| `jobs/ads/google` | `@cerevex/jobs-ads-google` | Google pull entry + legacy `google/ads/*` listener |

`jobs/meta/ads` (`@cerevex/jobs-meta-ads`) and `jobs/google/ads` (`@cerevex/jobs-google-ads`) stay legacy-thin re-exports until dual-compat removal. Do not add product logic there.

Connector, apply-gate, audit, and sync implementations stay in `@tharros/ads-shared`. These packages are the Inngest registration shape only.

## Host

`apps/ads/workers` is the Tharros-owned serve host (env, health, `/api/inngest`). It imports `@cerevex/jobs-ads-shared`, `@cerevex/jobs-ads-meta`, and `@cerevex/jobs-ads-google`.

Do not also spread the legacy package function arrays into that serve list. They re-export the same functions; registering both would duplicate ids.

## Locked names

- Ads app id stays **`cerevex-ads`** (`OS_INNGEST_APP_ID` on the ads client in `@tharros/ads-shared/inngest`). Do not register these functions on Brain’s Cerevex app.
- Canonical events stay `ads/*`. Canonical function ids stay `ads-*`.
- Customers never install Inngest. No customer job-runner setup.

## SEO

SEO stays `jobs/seo` (`@cerevex/jobs-seo`) on the Brain app. A later split of SEO into LLMs vs search engines is future work and out of this slice — do not implement it here.
