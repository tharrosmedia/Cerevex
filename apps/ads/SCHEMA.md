# Cerevex ads module schema (Neon `os`)

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

The kill switch is a hard product control (default **true** / ON). Approve is blocked while it is on. M5 apply executes only after Approve, with the switch off and the ad account not frozen.

`settings_json` also holds Modules & Nav IA 1.1 workspace flags **and** the modularity capability registry (no extra table, schema `os` only):

```json
{
  "businessType": "home_service" | "agency" | "ecommerce",
  "modules": { "leads": true, "clients": false, "sales": false, "workflows": true },
  "onboardingCompletedAt": "ISO-8601",
  "capabilities": {
    "cockpit": "on",
    "apply": "on",
    "connect.meta": "on",
    "connect.google": "on",
    "audits": "on",
    "apply.bid": "on",
    "apply.budget": "on",
    "apply.create_entity": "hidden",
    "shell.legacy_ads_web": "hidden",
    "m51.budget_shift": "hidden",
    "m51.grok_creatives": "hidden",
    "m51.lp_congruence": "hidden",
    "m51.ga4_connect": "hidden",
    "m51.brainstorm": "hidden"
  }
}
```

Defaults: Leads ON for all; Clients ON only for agency; Sales ON only for ecommerce; Workflows ON for v1. Settings can override flags later. Existing keys such as `vertical` stay in the same JSON object.

`modules.leads` is IA only. The Leads / leftover brainstorm placeholder (`/ads/leads`, `/app/brainstorm`) also requires `capabilities["m51.brainstorm"]` to be `on` or `recommend_only`. While that capability is unfinished, Settings hides the Leads toggle (value is preserved) and hides all unfinished `m51.*` flags. `PATCH /workspace` refuses `m51.*: "on"` until `unfinished` is cleared.

Capability states are `on` | `hidden` | `recommend_only`. Unfinished / M5.1 units stay hidden. Optional env global kill (`CAPABILITY_KILL=apply,connect.meta` or `CAPABILITY_KILL_APPLY=1`) hides a capability for every workspace without redeploying Site Brain. Legacy `FEATURE_BID_MUTATIONS=0` / `FEATURE_BUDGET_MUTATIONS=0` map to `apply.bid` / `apply.budget`. Core GET paths (cockpit, clients, audits, recommendations) never throw when a flag is off.

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

`connection_status`: `disconnected` | `pending` | `syncing` | `connected` | `needs_reconnect` | `error`. `frozen` (boolean, default false) blocks Approve per account. Sync is Inngest-only; HTTP never blocks on a platform pull.

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

Validated with Zod (`schema_version = 1`) before insert. Every proposed mutation has `execute: false`. Status starts as `proposed`. Approve (authorize) creates an authorization and enqueues apply. Deny/Snooze never write platforms.

### decisions
`id`, `workspace_id`, `client_id`, `recommendation_id`, `user_id`, `action` (`authorize` \| `deny` \| `snooze`), `note`, `created_at`

### authorizations
`id`, `workspace_id`, `client_id`, `recommendation_id`, `decision_id`, `scope_json`, `expires_at`, `revoked_at`

### apply_jobs
`id`, `workspace_id`, `client_id`, `authorization_id`, `status`, `attempts`, `request_json`, `response_json`, `error`, `created_at`, `finished_at`

HTTP Approve and Inngest `os/apply.requested` run `evaluateApplyGate`: kill switch ON (default) blocks; frozen ad account blocks; missing/revoked/expired authorization blocks. When the gate allows, the worker executes schema-valid mutate-existing `proposed_mutations` (pause, negatives, placement exclude, bid, budget). Create-new (`create_ad`, `add_keyword`) is skipped. Job statuses: `queued` / `applying` / `succeeded` / `failed`. `idempotency_key` is unique (`apply:<recommendationId>`).

### audit_log
`id`, `workspace_id`, `actor_type`, `actor_id`, `action`, `entity_type`, `entity_id`, `payload_json`, `created_at`

Append-only: `UPDATE` and `DELETE` are blocked by database rules.

## Stub tables

Present so later milestones do not require a new tenancy pass:

- `brainstorm_sessions`, `brainstorm_ideas`
- `workflows`, `workflow_runs`
- `oauth_credentials` — used in M2; payload is encrypted, never committed in plaintext

## Enforcement

`apps/ads/api/src/tenancy.ts` is the only list/get path for clients:

1. Collect workspace IDs from `memberships`.
2. If the role is `owner` or `operator`, return all clients in those workspaces.
3. Otherwise return only clients in `client_memberships`.
4. Direct `GET /clients/:id` uses the same rule and returns **404** (not 200 with another tenant's payload) on miss.

Async work is Inngest events. `meta/ads/account.sync` and `google/ads/account.sync` pull entities (mock unless live app keys are set). Audits (`os/audit.requested`) read those local tables and emit findings + recommendations. Apply (`os/apply.requested`) still refuses without authorization and when the kill switch is on. No platform writes. No Zapier. No Tavily. No BullMQ/Redis.

Migrations target isolated schema **`os`**. The schema name stays `os` (renaming would break Neon prod). Do not create these tables in Brain `public` / pgvector.
