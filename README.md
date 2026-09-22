# Cerevex

**Cerevex** is the client OS for Shopify stores: a modular AI agent system that manages SEO, content, and ads for one or more stores.

Ads work is the **Cerevex ads module** at `apps/ads` (formerly Tharros OS). The Cerevex console (SEO command center) still lives at `apps/brain` in this PR — a same-day follow-up can move it to `apps/web` after Railway dashboard paths are updated outside this repo.

This repository is an **npm workspace monorepo** per [Accelerated Merge Plan 1.5](docs/accelerated-merge-plan-1.5.md). The GitHub repo is now `tharrosmedia/Cerevex` (Eng/Adam renamed it separately from this PR).

**No unsupervised ad spend.** Authorize-to-apply and workspace kill switches are unchanged (kill switch ON by default). No Meta/Google mutate from this tree.

**M3 is held until shared Neon smoke.** Neon Postgres schema **`os` stays `os`** — do not rename it in production.

## Canonical tree

```
apps/brain                 # Cerevex console (SEO command center + App Router)
apps/ads                   # Cerevex ads module: api, web, shared, workers
jobs/meta/ads              # meta/ads/* read/mock sync
jobs/meta/organic          # Stub. Inngest prefix: meta/organic/*
jobs/google/ads            # google/ads/* read/mock sync
jobs/seo                   # Existing SEO Inngest functions (seo/* / seo-*)
packages/contracts         # Shared TypeScript contracts
packages/db                # Stub. Brain Neon stays in apps/brain
packages/shared            # Stub. No shared runtime yet
```

The Cerevex console is still runnable from `apps/brain`. Root scripts (`npm run dev`, `npm run build`, `npm start`) proxy there so Railway / local workflows stay the same. Railway service names and URLs are **not** changed in this PR.

## Vision

Build a shared per-store Cerevex with specialized agent teams (SEO & Content first; ads as a separate module). Agents use tools (Shopify Admin GraphQL + external APIs). High-stakes actions require human approval by default. After approval, agents execute (create + publish live content, etc.). Same codebase supports single-store today and multi-store tomorrow via `store_id`.

Success for Stage A: trigger SEO job for a keyword → research → draft → human approve → create + publish live Collection/Page/Blog in Shopify. Everything scoped by `store_id`.

## Tech Stack (Limited & Explicit)

| Layer              | Choice                                      |
|--------------------|---------------------------------------------|
| Runtime            | Node.js 22+ + TypeScript                    |
| Workspace          | npm workspaces                              |
| Durability         | Inngest (durable steps + wait-for-approval) |
| LLM / tools        | Vercel AI SDK (`ai`)                        |
| LLM provider       | xAI (`grok-4.6`) via OpenAI compat          |
| Embeddings         | OpenAI `text-embedding-3-small` (1536)      |
| Search (research)  | Tavily (Brain SEO only; **not required for the ads module**) |
| HTTP               | Hono                                        |
| Shopify            | `@shopify/shopify-api` (GraphQL Admin)      |
| Database + Vector  | Neon (Brain: Postgres + pgvector; ads: isolated schema `os`) |
| Validation         | Zod                                         |

**Principles:** Reusable modules, no heavy agent frameworks, human-in-the-loop default, `store_id` everywhere, no unsupervised ad spend.

## Isolation (week one)

- **No duplicate** Neon / Railway / Inngest for the ads module.
- Ads Neon = isolated schema **`os`** (name stays — renaming would break Neon prod). Do **not** merge ads tables into Brain `public` / pgvector.
- Ads auth is **separate** from Brain `APP_PASSWORD`. Do not bolt ads RBAC onto Brain login.
- No unsupervised ad writes / no Meta-Google mutate.
- Keep Inngest event names `seo/*` and function IDs `seo-*`. Do not rename to `brain/*`.
- Ads Inngest **app id** default is `cerevex-ads` (env key remains `OS_INNGEST_APP_ID` so Railway env names are not clobbered mid-flight). Brain SEO stays on `shopify-brain`.

## Getting Started

### Prerequisites

- Node 22+
- Neon project (enable `vector` extension) — existing Brain project
- Keys: XAI, OpenAI (embeddings), Tavily (Brain SEO research), Inngest, Shopify Admin token

### Steps

```bash
# 1. Clone
git clone https://github.com/tharrosmedia/Cerevex.git
cd Cerevex

# 2. Install (workspace root)
npm install

# 3. Env (Cerevex console)
cp apps/brain/.env.example apps/brain/.env
# Edit apps/brain/.env with your keys + APP_PASSWORD

# 4. Database (Brain Neon only)
npm run db:migrate

# 5. Run the Cerevex console from the workspace root (or from apps/brain)
npm run dev
# In another terminal for Inngest dev:
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

`/api/inngest` still registers `jobs/seo` functions under the original `seo/*` names.

### Ads module (local)

```bash
cp apps/ads/.env.example apps/ads/.env
npm run ads:db:up
npm run ads:db:migrate   # schema os only — does not touch Brain public
npm run ads:db:seed      # local docker only — never seed production Neon
npm run ads:dev          # api :43180, web :43181, worker :43182, Inngest Dev :43183
```

See [`apps/ads/README.md`](apps/ads/README.md). Do not run `ads:db:seed` against production Brain Neon.

## Production (Railway + custom domain)

Root `npm run build` / `npm start` still build and serve `apps/brain` (`Site Brain` on the `cerevex.store` Railway project). Do **not** add a repo-root `railway.toml`.

Ads services on the **same** project (`cerevex-ads-api`, `cerevex-ads-workers`, `cerevex-web`) must keep the post-rename workspace commands after `apps/os` → `apps/ads`. Canonical start/build strings: [`apps/ads/README.md`](apps/ads/README.md#railway-deploy-cerevexstore). Never use `@tharros/api`, `@tharros/workers`, `@tharros/web`, or `apps/os` in Railway commands.

- Set env vars on your host (no auto-detection):
  - `PUBLIC_URL=https://cerevex.store` (base only)
  - `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
  - `INNGEST_API_KEY` (management key for resync)
  - Optionally `INNGEST_APP_ID` (Brain SEO default remains `shopify-brain`)
  - Ads worker: set `OS_INNGEST_APP_ID=cerevex-ads` (key name stays; value/docs are `cerevex-ads`)
- Redeploy/restart after changing vars.
- Use `/settings` → "Resync Inngest" button (temporary; will be removed).
- Or run: `npm run inngest:sync` (with env loaded).
- Handler lives at `https://<your-domain>/api/inngest`.
- Resync posts to Inngest using the resolved URL.

Do not provision a second Inngest / Neon / Railway app for the ads module. Do not sync the ads worker onto `shopify-brain`.

## Usage

1. Visit http://localhost:3000 (login with `APP_PASSWORD`)
2. Use the Cerevex wordmark for home. Ads is a module at `/ads` (live workspace at `app.cerevex.store` when that origin is set). First-run onboarding picks a business type; Settings → Modules can change which Ads modules appear in the menu.
3. Use Dashboard to trigger SEO jobs by keyword (`/seo/create` and other `/seo/*` routes still ship).
4. Go to Review Queue to view/approve/edit drafts.
5. History shows all jobs.

Scripts still work from the repo root: `npm run trigger:seo`

On approval, draft Collection created in Shopify.

All Brain operations are scoped by `storeId`. Audit events are written for everything.

## Implementation Plan & Roadmap

- **[Accelerated Merge Plan 1.5](docs/accelerated-merge-plan-1.5.md)** — accepted monorepo reshape (this tree).
- Brain Stage A details: `apps/brain/store-brain-implementation-plan.md`
- Ads module local run: [`apps/ads/README.md`](apps/ads/README.md)
- Shared Neon smoke checklist (M3 gate): [`apps/ads/SMOKE.md`](apps/ads/SMOKE.md)
- **M3 held until shared Neon smoke.**
- **Follow-up (same day, not this PR):** `apps/brain` → `apps/web` after Railway dashboard `rootDirectory` / watch paths are updated outside the repo. Do not half-break the console.

## Contributing

- Keep functions small/pure, explicit `storeId` on the Brain SEO path.
- Prompts live in `apps/brain/src/lib/prompts/`.
- Use Zod for all LLM structured outputs.
- Human-in-the-loop by default.
- Do not add Meta/Google mutate jobs in this reshape.
- No unsupervised ad spend. Authorize-to-apply + kill switches stay on.

## License

MIT (placeholder — update as needed)

---

*Last updated: 2026-09-22. Built for Shopify stores.*
