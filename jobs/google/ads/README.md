# `jobs/google/ads`

Legacy-thin re-export of `@cerevex/jobs-ads-google` (`jobs/ads/google`). Do not add product logic here.

The listener stays registered for one release so in-flight jobs finish:

| Legacy event | Legacy function id |
|---|---|
| `google/ads/account.sync` | `google-ads-account-sync` |

Canonical event is **`ads/account.sync`** with `platform: "google"` (`ads-account-sync` in `@cerevex/jobs-ads-shared`). Do not emit the legacy name from new producers.

The ads worker serves `@cerevex/jobs-ads-google` directly. Do not also serve this package — the function id would be registered twice. Remove this package when the dual-compat window closes.
