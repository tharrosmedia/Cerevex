# `@shopify-brain/db`

Thin stub (Plan 1.5 Day 1–2). No shared code yet.

## Where data lives today

- **Brain** keeps its own Neon access in `apps/brain/src/lib/db` and migrations in `apps/brain/db/migrations` (public schema + pgvector).
- **Ads module** Drizzle lives in `apps/ads/shared` and targets isolated schema **`os`** (name stays). Do not merge ads tables into Brain `public` / pgvector.

## What this package is for

Shared helpers *after* M3 shared Neon smoke (held). Until then, do not move Brain queries here and do not invent an OS schema.

## Hard constraints

- No duplicate Neon project for OS.
- No merging OS tables into Brain public/pgvector.
- M3 held until shared Neon smoke exists.
