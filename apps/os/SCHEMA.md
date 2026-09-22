# Tharros OS schema (M1)

Tenancy is two-level: **workspace** then **client**. Every business row carries `workspace_id`. Client-scoped rows also carry `client_id`. The API never trusts a client-supplied scope without checking memberships.

## Roles

| Role | Workspace membership | Client membership | Can see |
|---|---|---|---|
| `owner` | required | optional | every client in that workspace |
| `operator` | required | optional | every client in that workspace |
| `client_readonly` | required | required for each visible client | only those `client_memberships` rows |

A user with `client_readonly` on the workspace and a membership on Got Ductless cannot read KC Prestige or Elmar HVAC. The automated tenancy test locks that in.

## Core tables

### workspaces
`id`, `name` (unique), `settings_json`, `apply_kill_switch` (default **true**), `created_at`

The kill switch is a hard product control (default **true** / ON). M3 still does not execute Meta/Google writes even if it is flipped.

### users
`id`, `email` (unique), `name`, `password_hash`, `created_at`

Email/password only in M1. No Meta/Google OAuth.

### memberships
`(user_id, workspace_id)` PK, `role`

### clients
`id`, `workspace_id`, `name`, `pilot_flag`, `status`, `created_at`

Unique `(workspace_id, name)`. Seed: Got Ductless, KC Prestige, Elmar HVAC with `pilot_flag=true`.

### client_memberships
`(user_id, client_id)` PK, `role`

Used to scope `client_readonly` users. Owners and operators do not need a row per client.

### ad_accounts
`id`, `workspace_id`, `client_id`, `platform` (`meta` \| `google`), `external_id`, `connection_status`, `last_sync_at`, `last_error`, `scopes_json`

`connection_status`: `disconnected` | `pending` | `syncing` | `connected` | `error`. Sync is Inngest-only; HTTP never blocks on a platform pull.

### ad_entities / ad_metrics
Pulled campaigns, ad sets / ad groups, ads, keywords, plus 7d/30d performance. Workspace- and client-scoped. No tokens.

### oauth_credentials
`id`, `workspace_id`, `client_id`, `ad_account_id`, `platform`, `label`, `encrypted_payload`, timestamps.

`encrypted_payload` is AES-256-GCM (`TOKEN_ENCRYPTION_KEY`). Never returned to the web client. Mock tokens are stored the same way so local/CI work without live apps.

### audit_runs
`id`, `workspace_id`, `client_id`, `status` (`queued` \| `running` \| `completed` \| `failed`), `started_at`, `finished_at`, `summary_json`, `created_at`

M3 orchestration creates a run, evaluates **local** `ad_entities` / `ad_metrics` (no platform API), and writes `summary_json.writes = false`.

### findings
`id`, `workspace_id`, `client_id`, `audit_run_id`, `severity`, `title`, `body_json`, `created_at`

`body_json` always includes `ruleId` and `writes: false`. Linkage to ad accounts lives in JSON (no new columns).

### recommendations
`id`, `workspace_id`, `client_id`, `ad_account_id`, `type`, `title`, `rationale`, `estimated_impact_usd`, `risk`, `confidence`, `evidence_json`, `proposed_mutations_json`, `status`, `schema_version`, `created_at`

Validated with Zod (`schema_version = 1`) before insert. Every proposed mutation has `execute: false`. Status starts as `proposed`. Authorize/deny/snooze is a separate decision; apply is a third step.

### decisions
`id`, `workspace_id`, `client_id`, `recommendation_id`, `user_id`, `action` (`authorize` \| `deny` \| `snooze`), `note`, `created_at`

### authorizations
`id`, `workspace_id`, `client_id`, `recommendation_id`, `decision_id`, `scope_json`, `expires_at`, `revoked_at`

### apply_jobs
`id`, `workspace_id`, `client_id`, `authorization_id`, `status`, `attempts`, `request_json`, `response_json`, `error`, `created_at`, `finished_at`

Table exists. HTTP `POST /recommendations/:id/apply` and Inngest `os/apply.requested` both run `evaluateApplyGate`: kill switch ON (default) blocks; missing/revoked/expired authorization blocks; even a clean grant returns `apply_not_implemented`. No Meta/Google writes. No spend.

### audit_log
`id`, `workspace_id`, `actor_type`, `actor_id`, `action`, `entity_type`, `entity_id`, `payload_json`, `created_at`

Append-only: `UPDATE` and `DELETE` are blocked by database rules.

## Stub tables

Present so later milestones do not require a new tenancy pass:

- `brainstorm_sessions`, `brainstorm_ideas`
- `workflows`, `workflow_runs`
- `oauth_credentials` — used in M2; payload is encrypted, never committed in plaintext

## Enforcement

`packages/api/src/tenancy.ts` is the only list/get path for clients:

1. Collect workspace IDs from `memberships`.
2. If the role is `owner` or `operator`, return all clients in those workspaces.
3. Otherwise return only clients in `client_memberships`.
4. Direct `GET /clients/:id` uses the same rule and returns **404** (not 200 with another tenant's payload) on miss.

Async work is Inngest events. `meta/ads/account.sync` and `google/ads/account.sync` pull entities (mock unless live app keys are set). Audits (`os/audit.requested`) read those local tables and emit findings + recommendations. Apply (`os/apply.requested`) still refuses without authorization and when the kill switch is on. No platform writes. No Zapier. No Tavily. No BullMQ/Redis.

Migrations target isolated schema **`os`**. Do not create these tables in Brain `public` / pgvector.
