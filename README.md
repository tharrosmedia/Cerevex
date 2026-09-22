# Shopify Brain

**Store Brain** — a modular AI agent system that manages every major aspect of one or more Shopify stores.

This repository is now an **npm workspace monorepo** per [Accelerated Merge Plan 1.5](docs/accelerated-merge-plan-1.5.md).

**M3 is held until shared Neon smoke.**

## Canonical tree (locked)

```
apps/brain                 # Next.js Brain (SEO command center + App Router)
apps/os                    # Tharros OS (Origin M1/M2): api, web, shared, workers
jobs/meta/ads              # meta/ads/* read/mock sync
jobs/meta/organic          # Stub. Inngest prefix: meta/organic/*
jobs/google/ads            # google/ads/* read/mock sync
jobs/seo                   # Existing SEO Inngest functions (seo/* / seo-*)
packages/contracts         # Shared TypeScript contracts
packages/db                # Stub. Brain Neon stays in apps/brain
packages/shared            # Stub. No shared runtime yet
```

Brain is still runnable from `apps/brain`. Root scripts (`npm run dev`, `npm run build`, `npm start`) proxy there so Railway / local workflows stay the same.

## Vision

Build a shared per-store "Brain" with specialized agent teams (SEO & Content first). Agents use tools (Shopify Admin GraphQL + external APIs). High-stakes actions require human approval by default. After approval, agents execute (create + publish live content, etc.). Same codebase supports single-store today and multi-store tomorrow via `store_id`.

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
| Search (research)  | Tavily (Brain SEO only; **not required for OS**) |
| HTTP               | Hono                                        |
| Shopify            | `@shopify/shopify-api` (GraphQL Admin)      |
| Database + Vector  | Neon (Brain: Postgres + pgvector)           |
| Validation         | Zod                                         |

**Principles:** Reusable modules, no heavy agent frameworks, human-in-the-loop default, `store_id` everywhere.

## Isolation (week one)

- **No duplicate** Neon / Railway / Inngest for OS.
- OS Neon = isolated schema. Do **not** merge OS tables into Brain `public` / pgvector.
- OS auth is **separate** from Brain `APP_PASSWORD`. Do not bolt OS RBAC onto Brain login.
- No unsupervised ad writes / no Meta-Google mutate.
- Keep Inngest event names `seo/*` and function IDs `seo-*`. Do not rename to `brain/*`.

## Getting Started

### Prerequisites

- Node 22+
- Neon project (enable `vector` extension) — existing Brain project
- Keys: XAI, OpenAI (embeddings), Tavily (Brain SEO research), Inngest, Shopify Admin token

### Steps

```bash
# 1. Clone
git clone https://github.com/tharrosmedia/Shopify-Brain.git
cd Shopify-Brain

# 2. Install (workspace root)
npm install

# 3. Env (Brain app)
cp apps/brain/.env.example apps/brain/.env
# Edit apps/brain/.env with your keys + APP_PASSWORD

# 4. Database (Brain Neon only)
npm run db:migrate

# 5. Run Brain from the workspace root (or from apps/brain)
npm run dev
# In another terminal for Inngest dev:
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

`/api/inngest` still registers `jobs/seo` functions under the original `seo/*` names.

## Production (Railway + custom domain)

Root `npm run build` / `npm start` still build and serve `apps/brain`.

- Set env vars on your host (no auto-detection):
  - `PUBLIC_URL=https://cerevex.store` (base only)
  - `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
  - `INNGEST_API_KEY` (management key for resync)
  - Optionally `INNGEST_APP_ID` (if not `shopify-brain`)
- Redeploy/restart after changing vars.
- Use `/settings` → "Resync Inngest" button (temporary; will be removed).
- Or run: `npm run inngest:sync` (with env loaded).
- Handler lives at `https://<your-domain>/api/inngest`.
- Resync posts to Inngest using the resolved URL.

Do not provision a second Inngest / Neon / Railway app for OS.

## Usage

1. Visit http://localhost:3000 (login with `APP_PASSWORD`)
2. Use Dashboard to trigger SEO jobs by keyword (`/seo/create` and other `/seo/*` routes still ship).
3. Go to Review Queue to view/approve/edit drafts.
4. History shows all jobs.

Scripts still work from the repo root: `npm run trigger:seo`

On approval, draft Collection created in Shopify.

All Brain operations are scoped by `storeId`. Audit events are written for everything.

## Implementation Plan & Roadmap

- **[Accelerated Merge Plan 1.5](docs/accelerated-merge-plan-1.5.md)** — accepted monorepo reshape (this tree).
- Brain Stage A details: `apps/brain/store-brain-implementation-plan.md`
- OS local run: `apps/os/README.md`
- **M3 held until shared Neon smoke.**

## Contributing

- Keep functions small/pure, explicit `storeId` on the Brain SEO path.
- Prompts live in `apps/brain/src/lib/prompts/`.
- Use Zod for all LLM structured outputs.
- Human-in-the-loop by default.
- Do not add Meta/Google mutate jobs in this reshape.

## License

MIT (placeholder — update as needed)

---

*Last updated: 2026-09-22. Built for Shopify stores.*
