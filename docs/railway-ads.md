# Cerevex ads — Railway production commands

**Incident (after PR #10):** Railway start commands still used pre-rename workspace names `@tharros/api` and `@tharros/workers`. Those packages no longer exist. Production start/build must use `@tharros/ads-api`, `@tharros/ads-workers`, and `@tharros/ads-web`.

Live dashboard commands on project **cerevex.store** (already corrected). There is **no** `railway.toml` / `nixpacks.toml` in this repo — do not add a repo-root config that would overwrite per-service commands. Builder is Railpack. Root directory is the monorepo root.

Do not provision a second Railway project. Do not change Neon schema `os`. Do not sync ads onto Inngest app `shopify-brain`.

## Locked production commands

| Railway service | Command | Value |
|---|---|---|
| **cerevex-ads-api** | start | `API_HOST=0.0.0.0 API_PORT=$PORT npm run start --workspace=@tharros/ads-api` |
| **cerevex-ads-api** | build | `npm install` |
| **cerevex-ads-workers** | start | `API_HOST=0.0.0.0 WORKER_PORT=$PORT npm run start --workspace=@tharros/ads-workers` |
| **cerevex-ads-workers** | build | `npm install` |
| **cerevex-web** | build | `npm install && npm run build --workspace=@tharros/ads-web` |
| **cerevex-web** | start | `cd apps/ads/web && npx next start --hostname 0.0.0.0 --port $PORT` |

`$PORT` is Railway’s assigned listen port. The API binds `API_PORT`; the worker binds `WORKER_PORT`; both also need `API_HOST=0.0.0.0` so they accept public/private traffic.

## Workspace names (post-rename)

| Correct | Stale — do not use |
|---|---|
| `@tharros/ads-api` | `@tharros/api` |
| `@tharros/ads-workers` | `@tharros/workers` |
| `@tharros/ads-web` | `@tharros/web` |

`npm run start --workspace=@tharros/api` (and the workers equivalent) fails the deploy because those workspaces were renamed in PR #10.

## Why web start is not `npm run start --workspace=@tharros/ads-web`

The package script is `next start --port 43181 --hostname 127.0.0.1`. Production must bind `0.0.0.0` and Railway `$PORT`. Keep the `cd apps/ads/web && npx next start …` start command.

## Site Brain (unchanged)

`apps/brain` is a separate Railway service (`Site Brain`). Root `npm run build` / `npm start` still target `@shopify-brain/brain`. Do not point that service at ads workspaces.

## Regression checklist

1. After any package rename, update **all three** ads services’ start/build commands in the Railway dashboard **in the same change**.
2. Confirm the start command string contains `@tharros/ads-api` / `@tharros/ads-workers` / `@tharros/ads-web` — never `@tharros/api` or `@tharros/workers`.
3. Do not add a root `railway.toml` unless each service is given its own config file path in the dashboard (`railwayConfigFile`). A shared file would apply one start command to every ads service.
