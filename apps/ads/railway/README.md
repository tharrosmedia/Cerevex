# Ads Railway service notes

In-repo record of the **post-rename** (`apps/os` → `apps/ads`) start/build commands that are already live on the `cerevex.store` Railway project.

These files are **notes**, not Config as Code. Railway Config as Code (`railway.toml` / `railway.json`) is deprecated. Do **not**:

- add a repo-root `railway.toml` (would apply to `Site Brain` too)
- set each service’s `railwayConfigFile` to these paths
- “re-detect” start commands from `package.json` (web’s `start` binds `127.0.0.1:43181`)

Dashboard source of truth (hotfix after PR #10):

| Railway service | File |
|---|---|
| `cerevex-ads-api` | [`cerevex-ads-api.toml`](./cerevex-ads-api.toml) |
| `cerevex-ads-workers` | [`cerevex-ads-workers.toml`](./cerevex-ads-workers.toml) |
| `cerevex-web` | [`cerevex-web.toml`](./cerevex-web.toml) |

Stale names that crash the workspace: `@tharros/api`, `@tharros/workers`, `@tharros/web`, `apps/os`.
