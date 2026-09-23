# `jobs/meta/ads`

Origin M2 Meta account sync. R5 / G7 canonical event is **`ads/account.sync`** with `platform: "meta"` in the payload (registered on the ads worker as `ads-account-sync`).

This package keeps the **legacy** listener for one release so in-flight jobs finish:

| Legacy event | Legacy function id |
|---|---|
| `meta/ads/account.sync` | `meta-ads-account-sync` |

Do not emit the legacy name from new producers. Folder path stays.
