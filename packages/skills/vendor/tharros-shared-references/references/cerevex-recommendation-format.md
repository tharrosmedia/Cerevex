# Cerevex recommendation format

> Format version 1.1 · 2026-10-03 · amends 1.0 per Cerevex Skills Integration Brief 1.0 (ACCEPTED 2026-10-03) §4.3 (approve-and-apply record, audit log) and §1.1 (source tag, version tags, dedupe). Backward compatible: every 1.0 record is still a valid 1.1 record (see "Version and compatibility" at the end).

Every skill that proposes a change (to an ad account, budget, listing, page, feed, message flow, or tracking setup) returns it in this format. Cerevex ingests the YAML block. Keep the human-readable table as well.

## The approval rule

- A skill always writes `approval.status: PENDING_APPROVAL`.
- No skill ever changes that status. Only a person in Cerevex sets it to `approved` or `rejected`, outside the skill.
- No skill makes the change itself. After Approve, the change is executed either by Cerevex's apply job (Tier A, `executed_by: cerevex_apply`) or by a person (Tier D or any manual action, `executed_by: human`). Cerevex fills that field when the change is executed, not the skill.
- The lifecycle fields `approved_by`, `approved_at`, `executed_by`, `executed_at`, `apply_result`, `rolled_back_by`, and `rolled_back_at` are filled by Cerevex (or the person acting in Cerevex). A skill writes them as `null` or leaves them out, and never fills them.
- `approval.approver` comes from the client profile (`approval_owner`). If the profile says `approval_owner: TBD`, the approver is the agency owner (Adam), the default approver and admin for every client until he names someone else (brief §3.3). The skill never sends the record to the client or anyone else; a person does.
- Every approval, rejection, apply, and rollback lands in the client's append-only Cerevex audit log (brief §4.3). Skills don't write to it.

## YAML record

```yaml
- id: REC-<client-slug>-<yyyymmdd>-<n>
  format: "1.1"                     # optional; absent = 1.0
  client: <client-slug>
  store: <store_id or "all">        # optional; the client's store (site or location) the change applies to. Absent = "all".
  source: agent:<agent name>        # who wrote it: agent:<agent name> for a Tharros agent, native:<job> for a Cerevex job
  versions: {skill: "<skill>@<version>", pack: "<pack>@<version>", layer: "<client>[/<store>]@<version>"}   # each when known, else "unknown"; layer is "none" when no prompt layer was loaded
  target: "<platform object id or URL the change acts on>"   # e.g. google_ads:campaign:123, gbp:location:abc, https://site/page, layer:<client>[/<store>]
  dedupe_key: "<store>|<target>|<channel>|<change.to, normalized>"   # same store + target + change within 7 days = one rec (brief §1.1)
  vertical: <from profile>          # home-service|ecommerce-dtc|saas-b2b|local-other
  skill: <skill-name>
  channel: google_search            # google_search|google_pmax|google_shopping|google_demand_gen|youtube|lsa|gbp|merchant_center|meta|tiktok|bing|openai_ads|linkedin|seo|site|feed|email|sms|tracking|crm|co_op|all
  segment: <outcome segment>        # from the profile value model: a job type, product line, plan tier, or "all"
  group: do_now                     # do_now|test|needs_data
  finding: "One sentence: what is true now"
  evidence: ["<report name + date range>", "<file or screenshot + date>"]
  metric: cost_per_qualified_outcome   # cost_per_qualified_outcome|cac|roas|margin_roas|conv_value_per_cost|qualified_rate|junk_lead_pct|mention_rate|organic_qualified_outcomes|... never cpl or cpc alone
  outcome_definition: "<profile qualified_outcome, e.g. booked job | purchase | demo booked | trial started>"
  baseline: <number or "unknown">
  expected_delta: {low: "-10%", high: "-25%", basis: "what the range rests on"}
  expected_monthly_dollars: {low: <n>, high: <n>, basis: "how computed"}   # used for sorting
  confidence: low                   # low|medium|high
  confidence_reason: "One line"
  effort: "1h"
  risk: "What could go wrong"
  why_plain: "At most two sentences, no jargon."
  change: {from: "current state", to: "proposed state"}
  rollback: "Exact steps to undo"
  requires: [conversion-tracking-audit:pass]   # gates; empty list if none
  capacity_check: "n/a | pass: <evidence> | fail: <reason>"   # required on any spend increase
  claims_check: "n/a | pass | fail: <claim>"                   # required on any copy change
  kpi_node: "<step in the client's KPI tree>"                  # required from client-marketing-plan
  recheck_date: <yyyy-mm-dd>
  approval:
    status: PENDING_APPROVAL        # skills always write this; only a person in Cerevex sets approved | rejected
    approver: <profile approval_owner; TBD resolves to the agency owner>
    path: tharros
    approved_by: null               # Cerevex: the person who pressed Approve (or rejected)
    approved_at: null               # Cerevex: when
    executed_by: null               # Cerevex: cerevex_apply (Tier A, applied by Cerevex) | human (Tier D or manual action)
    executed_at: null               # Cerevex: apply time, or the time a person marks it done
    apply_result: null              # Cerevex, Tier A only: platform response or change id, success | error
    rolled_back_by: null            # Cerevex: filled if the rollback runs (Tier A); n/a for Tier D
    rolled_back_at: null
```

## Rules

1. `why_plain` is at most two sentences, has no jargon, and passes a `no-slop-copy` Detect run.
2. `expected_delta` is a range with its basis stated. With no data, set `confidence: low` and never quote a point estimate.
3. `metric` is never CPL or CPC alone. Use cost per qualified outcome, CAC, ROAS, or margin ROAS as the client profile defines them (`outcome-economics.md`). CPL can appear in `evidence`.
4. Any recommendation that raises spend fills `capacity_check` using the capacity definition in the profile (crews, inventory, sales or onboarding capacity, or "not capacity-bound" with a reason).
5. Any recommendation that changes copy fills `claims_check` from a `claims-check` run.
6. `requires` lists gates. If a gate has not passed, the record goes to `needs_data` and says which gate is missing.
7. Group as **Do now / Test / Needs data**. Inside each group, sort by the midpoint of `expected_monthly_dollars`, highest first.
8. Nothing flips from `PENDING_APPROVAL` inside a skill, and no skill fills the lifecycle fields (`approved_by` through `rolled_back_at`).
9. `source` is required on every new record: `agent:<agent name>` when a Tharros agent writes it (Cerevex ingests it after validating the schema and running the same guards, gates, and Approve rules as native recs; an invalid record is rejected with a reason), `native:<job>` when a Cerevex job writes it. Fill `versions` with the skill version from the skill's header line, the vertical pack id and version (or `unknown`), and the client prompt layer version from its header when one was loaded (`none` otherwise). See `/home/box/agent-data/workflows/tharros-shared-references/references/prompt-layer.md`.
10. `target` names the one object the change acts on, as specifically as the evidence allows. `dedupe_key` joins store, target, channel, and the proposed end state (`change.to`, lowercased, whitespace collapsed). Cerevex merges a native rec and an ingested rec with the same store, target, and change within 7 days into one rec that lists both sources (Cerevex adds a `sources` list on the merged rec); native platform numbers win when the two disagree. Don't pre-merge; just fill the key.
11. A proposed change to a client's prompt layer is a normal record with `channel: all`, `skill: <the skill whose behavior it changes>`, `target: layer:<client>[/<store>]`, `change: {from: <current layer rule>, to: <new rule>}`, evidence, confidence, and rollback. It never adds a fact (facts go to the profile) and never loosens a compliance, claims, or hard-limit rule.

## Human-readable table (same records)

| # | Group | Channel · segment | Finding | Change (from → to) | Expected (range, metric) | $/mo (range) | Confidence | Requires | Approval path | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|

The table is unchanged from 1.0. `source`, `versions`, `target`, and `dedupe_key` live in the YAML only.

## Outcome record (written later by client-monthly-report)

After a recommendation is executed in Cerevex (by `cerevex_apply` or by a person who marks it done), `client-monthly-report` adds a separate outcome record. It does not edit the original.

```yaml
- outcome_for: REC-<client>-<yyyymmdd>-<n>
  measured_period: <start>..<end>
  metric: <same metric>
  actual: <number>
  expected_delta: {low: ..., high: ...}
  verdict: within_range | better | worse | inconclusive
  notes: "Seasonality, tracking changes, sample size, conversion lag"
```

## Version and compatibility

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-09-29 | v4.1 install. `executed_by` always `human`. |
| 1.1 | 2026-10-03 | Brief 1.0 §4.3 and §1.1: `approval.approved_by` / `approved_at`, `executed_by: cerevex_apply \| human`, `executed_at`, `apply_result`, `rolled_back_by` / `rolled_back_at` (all filled by Cerevex, never by a skill); `source`, `versions` (skill, pack, layer), `store`, `target`, `dedupe_key`; optional `format`; approver TBD resolves to the agency owner; layer-change records (rule 11). |

Backward compatibility:
- A 1.0 record (no `format`, no new fields, `approval.executed_by: human` written at creation) is still valid. Cerevex reads a missing `format` as 1.0, a missing `store` as `all`, a missing `source` as `agent:unknown`, missing `versions` as `unknown`, and a creation-time `executed_by: human` as "not yet executed".
- Every new field is additive; no 1.0 field was removed or renamed. The lifecycle fields stay inside the `approval` block, where `executed_by` already lived in 1.0.
- New records written by skills from 2026-10-03 on use 1.1 and fill `source`, `versions`, `target`, and `dedupe_key`.
