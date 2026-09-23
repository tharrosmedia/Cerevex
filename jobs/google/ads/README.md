# `jobs/google/ads`

Origin M2 Google account sync. R5 / G7 canonical event is **`ads/account.sync`** with `platform: "google"` in the payload (registered on the ads worker as `ads-account-sync`).

This package keeps the **legacy** listener for one release so in-flight jobs finish:

| Legacy event | Legacy function id |
|---|---|
| `google/ads/account.sync` | `google-ads-account-sync` |

Do not emit the legacy name from new producers. Folder path stays.
