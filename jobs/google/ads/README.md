# `jobs/google/ads`

Origin M2 Google account sync, remapped to Plan 1.5 prefix **`google/ads/*`**.

| Event | Function ID |
|---|---|
| `google/ads/account.sync` | `google-ads-account-sync` |

Read / mock pull only. **No Google Ads mutate.** AdAccounts hang off Client, not `store_id`.

Registered by `apps/ads/workers` `/api/inngest`.
