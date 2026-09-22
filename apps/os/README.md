# `apps/os`

Placeholder package for **tharros-os**.

## Upcoming import

A follow-up will import Origin **tharros-os M1/M2** source into this directory.

Do not invent product features here. This package exists so the monorepo tree is locked and CI can path-filter OS independently of Brain.

## Isolation (week one)

- **OS Neon:** isolated schema. Do not merge OS tables into Brain `public` / pgvector.
- **OS auth:** separate from Brain `APP_PASSWORD`. Do not bolt OS RBAC onto Brain login.
- **No duplicate** Neon / Railway / Inngest apps for OS. OS jobs will register on the existing Inngest app (`shopify-brain`) when they exist.
- **No Tavily** requirement for OS.
- **M3 held** until shared Neon smoke.

See [Accelerated Merge Plan 1.5](../../docs/accelerated-merge-plan-1.5.md) and `@shopify-brain/contracts`.
