# `jobs/seo`

Brain SEO Inngest functions. Moved here on Plan 1.5 Day 1–2.

## Locked names (do not rename)

Event names stay `seo/*`. Function IDs stay `seo-*`.

Examples: `seo/job.requested` → `seo-job`, `seo/research` → `seo-research`, `seo/publish` → `seo-publish`.

Do **not** mass-rename to `brain/*`.

## Registration

Brain still serves these functions at `/api/inngest`:

```ts
// apps/brain/app/api/inngest/route.ts
import { functions, inngest } from '@cerevex/jobs-seo';
```

(The Brain files re-export that package so existing `@/src/inngest/*` imports keep working.)

## Dependencies

Functions call Brain agents/db via the `@brain/*` path alias (`apps/brain/src/*`). That is intentional for the smallest safe move — SEO agents stay in Brain.

Helper IDs `update-job-status` and `log-event` moved with this package because `seo-job` invokes them. IDs unchanged.
