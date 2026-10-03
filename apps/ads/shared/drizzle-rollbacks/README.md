# Drizzle rollbacks

These files are not migrations. drizzle-kit (`out: ./drizzle`) and `migrate.ts` read only `apps/ads/shared/drizzle/`. Nothing in that folder applies a file from here.

Apply one by hand against the database that ran that migration:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/ads/shared/drizzle-rollbacks/<tag>_rollback.sql
```

`0007_client_audit_log_rollback.sql` drops `os.client_audit_log`, the append-only function, and `recommendations.approval_json`, then deletes the `drizzle.__drizzle_migrations` row for that file. The hash is the sha256 of `apps/ads/shared/drizzle/0007_client_audit_log.sql`, and `created_at` is the journal `when` (`1791200000000`). Do not pass this file to `drizzle migrate`.
