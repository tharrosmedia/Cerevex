# `jobs/meta/ads`

Origin M2 Meta account sync, remapped to Plan 1.5 prefix **`meta/ads/*`**.

| Event | Function ID |
|---|---|
| `meta/ads/account.sync` | `meta-ads-account-sync` |

Read / mock pull only. **No Meta mutate.** AdAccounts hang off Client, not `store_id`.

Registered by `apps/ads/workers` `/api/inngest` (same serve URL as ads-module orchestration).
