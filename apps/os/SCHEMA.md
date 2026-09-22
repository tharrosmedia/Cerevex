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

The kill switch is a hard product control. M1 does not execute apply jobs even if it is flipped.

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

### recommendations
`id`, `workspace_id`, `client_id`, `ad_account_id`, `type`, `title`, `rationale`, `estimated_impact_usd`, `risk`, `confidence`, `evidence_json`, `proposed_mutations_json`, `status`, `schema_version`, `created_at`

### decisions
`id`, `workspace_id`, `client_id`, `recommendation_id`, `user_id`, `action` (`authorize` \| `deny` \| `snooze`), `note`, `created_at`

### authorizations
`id`, `workspace_id`, `client_id`, `recommendation_id`, `decision_id`, `scope_json`, `expires_at`, `revoked_at`

### apply_jobs
`id`, `workspace_id`, `client_id`, `authorization_id`, `status`, `attempts`, `request_json`, `response_json`, `error`, `created_at`, `finished_at`

Table exists. The Inngest `os/apply.requested` function refuses to apply unless an authorization exists and the workspace kill switch is off — and still does not write to Meta or Google. No spend.

### audit_log
`id`, `workspace_id`, `actor_type`, `actor_id`, `action`, `entity_type`, `entity_id`, `payload_json`, `created_at`

Append-only: `UPDATE` and `DELETE` are blocked by database rules.

## Stub tables

Present so later milestones do not require a new tenancy pass:

- `audit_runs`, `findings`
- `brainstorm_sessions`, `brainstorm_ideas`
- `workflows`, `workflow_runs`
- `oauth_credentials` — used in M2; payload is encrypted, never committed in plaintext

## Enforcement

`packages/api/src/tenancy.ts` is the only list/get path for clients:

1. Collect workspace IDs from `memberships`.
2. If the role is `owner` or `operator`, return all clients in those workspaces.
3. Otherwise return only clients in `client_memberships`.
4. Direct `GET /clients/:id` uses the same rule and returns **404** (not 200 with another tenant's payload) on miss.

Async work is Inngest events. `meta/ads/account.sync` and `google/ads/account.sync` pull entities (mock unless live app keys are set). Apply (`os/apply.requested`) still refuses without authorization and when the kill switch is on. No platform writes. No Zapier. No Tavily. No BullMQ/Redis.

Migrations target isolated schema **`os`**. Do not create these tables in Brain `public` / pgvector.
