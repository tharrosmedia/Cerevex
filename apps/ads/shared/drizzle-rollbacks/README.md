# Drizzle rollbacks

These files are not migrations. drizzle-kit (`out: ./drizzle`) and `migrate.ts` read only `apps/ads/shared/drizzle/`. Nothing in that folder applies a file from here.

Apply one by hand against the database that ran that migration:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/ads/shared/drizzle-rollbacks/<tag>_rollback.sql
```

`0008_client_audit_log_rollback.sql` drops `os.client_audit_log`, the append-only function, and `recommendations.approval_json` (that drop removes the legacy lifecycle backfill with the column), then deletes the `os.__drizzle_migrations` row for that file. The hash is the sha256 of `apps/ads/shared/drizzle/0008_client_audit_log.sql`, and `created_at` is the journal `when` (`1791200000000`). Do not pass this file to `drizzle migrate`. The table owner or a superuser can bypass the append-only triggers with `DISABLE TRIGGER` or `session_replication_role = replica`.

`0009_monthly_usage_rollback.sql` drops `os.usage_events` and `os.usage_counters`, then deletes the `os.__drizzle_migrations` row for that file. The hash is the sha256 of `apps/ads/shared/drizzle/0009_monthly_usage.sql`, and `created_at` is the journal `when` (`1791300000000`). Do not pass this file to `drizzle migrate`.

`0010_recommendation_scope_rollback.sql` refuses if any `os.recommendations` row is not `ad_account` with `ad_account_id` set and `store_id` null. Otherwise it drops `recommendations_store_idx`, `recommendations_scope_client_idx`, both scope CHECKs, `store_id`, and `scope`, sets `ad_account_id` NOT NULL again, then deletes the `os.__drizzle_migrations` row for that file. The hash is the sha256 of `apps/ads/shared/drizzle/0010_recommendation_scope.sql`, and `created_at` is the journal `when` (`1791400000000`). `client_id` is left as it has been since `0000_m1_spine`. Do not pass this file to `drizzle migrate`.
