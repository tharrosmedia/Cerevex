-- Service actor: pending OAuth may have no users.id, and one apply job per authorization.
-- IF EXISTS covers a journal that has not created the pending-connection table yet.
-- Duplicate apply jobs: never delete or change a succeeded job, or any job that
-- recorded platform writes or outcomes. Two of those for one authorization abort
-- this migration. Otherwise keep the succeeded job when one exists, else the
-- newest non-terminal or failed job, and delete only the rest.
ALTER TABLE IF EXISTS "os"."oauth_pending_connections" ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
DO $dedup$
DECLARE
  conflict text;
BEGIN
  SELECT string_agg(
           format('%s (%s)', authorization_id::text, job_ids),
           '; ' ORDER BY authorization_id::text
         )
    INTO conflict
  FROM (
    SELECT authorization_id,
           string_agg(id::text, ', ' ORDER BY id::text) AS job_ids
    FROM "os"."apply_jobs"
    WHERE status = 'succeeded'
    GROUP BY authorization_id
    HAVING count(*) > 1
  ) duplicates;

  IF conflict IS NOT NULL THEN
    RAISE EXCEPTION
      '0007_service_actor_constraints: multiple succeeded apply jobs share an authorization: %',
      conflict;
  END IF;

  SELECT string_agg(
           format('%s (%s)', authorization_id::text, job_ids),
           '; ' ORDER BY authorization_id::text
         )
    INTO conflict
  FROM (
    SELECT authorization_id,
           string_agg(id::text, ', ' ORDER BY id::text) AS job_ids
    FROM "os"."apply_jobs"
    WHERE status = 'succeeded'
       OR response_json->'writes' = 'true'::jsonb
       OR (
         jsonb_typeof(response_json->'outcomes') = 'array'
         AND jsonb_array_length(response_json->'outcomes') > 0
       )
    GROUP BY authorization_id
    HAVING count(*) > 1
  ) duplicates;

  IF conflict IS NOT NULL THEN
    RAISE EXCEPTION
      '0007_service_actor_constraints: multiple apply jobs recorded platform writes or outcomes for one authorization: %',
      conflict;
  END IF;

  DELETE FROM "os"."apply_jobs" AS extra
  WHERE extra.id IN (
    SELECT id
    FROM (
      SELECT id,
             row_number() OVER (
               PARTITION BY authorization_id
               ORDER BY
                 CASE
                   WHEN status = 'succeeded'
                     OR response_json->'writes' = 'true'::jsonb
                     OR (
                       jsonb_typeof(response_json->'outcomes') = 'array'
                       AND jsonb_array_length(response_json->'outcomes') > 0
                     )
                   THEN 0
                   ELSE 1
                 END,
                 created_at DESC,
                 id DESC
             ) AS n
      FROM "os"."apply_jobs"
    ) ranked
    WHERE n > 1
  )
  AND extra.status IS DISTINCT FROM 'succeeded'
  AND extra.response_json->'writes' IS DISTINCT FROM 'true'::jsonb
  AND NOT COALESCE(
    jsonb_typeof(extra.response_json->'outcomes') = 'array'
    AND jsonb_array_length(extra.response_json->'outcomes') > 0,
    false
  );
END
$dedup$;
--> statement-breakpoint
CREATE UNIQUE INDEX "apply_jobs_authorization_uidx" ON "os"."apply_jobs" USING btree ("authorization_id");
