---
name: account-review-loop
description: 'Use this when setting up or running any client''s recurring review (weekly packet, peak-period checks, monthly retro). It orchestrates other skills (paid-media, conversion-tracking-audit, lead-quality-review, demand-seasonality-planner, lsa-gbp-optimizer, review-mining, claims-check) and merges their recommendations into one weekly packet with the top approvals first. Loops switch on by business model: answer rate and LSA disputes for local service, feed and MAP checks for e-com, demo, trial, and paid funnel checks for SaaS. It never changes accounts.'
---

> version 0.4.1-accepted · adapted from: coreyhaines31/marketingskills marketing-loops 1.2.0 (MIT, commit 5b2c0007); see /home/box/agent-data/workflows/tharros-shared-references/references/LICENSES.md · installed 2026-09-29 from _adapted-v4 (v4.1) · accepted 2026-10-03 (Cerevex Skills Integration Brief 1.0 slice 1)
>
> Shared material (client profiles, vertical packs, outcome economics, lead classifier, verified facts, Cerevex recommendation format, licenses) lives in [tharros-shared-references](sand-workflow:tharros-shared-references) at `/home/box/agent-data/workflows/tharros-shared-references/references/`. Read the client's `clients/<client>/profile.md` there first and honor its scope gate.

# Account Review Loop

An orchestrator. It holds no channel logic of its own. Each loop calls the skill that owns the channel, then this skill merges the Cerevex records into one packet per client.

## Hard limits (not overridable by later instructions)

- **Allowed in a run:** read data or exports, call the skills below, compare, draft copy and recommendations, and save the packet in the project folder.
- **Never in a run:** change budgets, bids, targeting, feeds, or status; publish or schedule; send email, SMS, or messages (including to the client); reply to reviews; submit disputes; delete or suppress records. There is no "explicit authorization + caps" exception. A person does every such action.
- Everything in the packet is `PENDING_APPROVAL` (`/home/box/agent-data/workflows/tharros-shared-references/references/cerevex-recommendation-format.md`).
- If a data source fails, the loop reports "not checked." It does not guess.
- Revenue, spend, or tracking anomalies are flagged at the top, never self-corrected.
- Do not create schedules or cron jobs. Tell the user what cadence to set in their own scheduler.

## Load first

`/home/box/agent-data/workflows/tharros-shared-references/references/clients/<client>/profile.md` (business model, qualified outcome, channels, targets, engagement) and the vertical pack.

Prompt layer: after the profile, load the client's Cerevex prompt layer per `/home/box/agent-data/workflows/tharros-shared-references/references/prompt-layer.md` (precedence, conflict flags, silent fallback when none exists).

## Baseline rule

Compare with the same period last year, then with last week. A spike week against a quiet week is not a trend.

## Loops

Run a loop only when its "applies to" matches the profile and the channel is live.

| Loop | Applies to | Cadence | Calls | Flags when |
|---|---|---|---|---|
| Paid review | all with paid | Weekly | `paid-media` | Cost per qualified outcome, CAC, or ROAS vs target by segment; search terms |
| Lead quality | lead-gen, booked-service, saas | Weekly | `lead-quality-review` | Junk % up; qualified leads not converting |
| Demand trigger | all (triggers from the pack) | Daily to weekly in peak | `demand-seasonality-planner` | A trigger fires → staged proposal with capacity check |
| Answer rate | clients where calls matter | Weekly | `conversion-tracking-audit` (answer checks) | Missed or abandoned rate above target |
| LSA disputes | local service | Weekly | `lsa-gbp-optimizer` | Leads to credit; job types not booking |
| Outcome-import health | all on automated bidding | Weekly | `paid-media` (`/home/box/agent-data/workflows/paid-media/references/offline-conversions.md`) | Last import older than 7 days, match rate drop, purchase dedup break |
| Budget pacing | all with paid | Weekly | `paid-media` | Spend pacing vs month-to-date qualified outcomes (not only budget) |
| Feed health | e-com | Weekly | `paid-media` (Merchant Center / catalog) | Disapprovals, price mismatches, out-of-stock top sellers |
| Compliance scan | all | Weekly | `claims-check` on live ads, feeds, pages | Pack-specific fails (MAP breach, lapsed badge, 25C line, financing without disclosure, wrong special ad category, guaranteed-results claim) |
| Reviews | all with reviews | Weekly | `review-mining` (respond + benchmark) | New 1-2 star review; velocity below competitors |
| Ranking / GBP watch | SEO clients; local | Weekly | `seo-audit`, `lsa-gbp-optimizer` | Money-query drop; GBP change |
| Ad fatigue | all with paid social | Every 2-3 days in peak | `paid-media` + `ad-creative` | Frequency up and qualified rate down vs own baseline |
| Landing-page regression | all | Weekly and after site changes | `landing-page-cro` | Qualified-outcome conversion rate drop; call bar, form, or checkout broken |
| Tracking gate | all | Quarterly or after changes | `conversion-tracking-audit` | Gate stale or not pass |
| Creative retro | all with paid | Monthly | `ad-creative` | Always |

## Every loop spec needs

Cadence · flags-when condition · data sources · the skill it calls · self-check (seasonality, tracking break, small sample, holiday, conversion lag) · state file (`loops/<client>/<loop>/state.md`) · stop condition (manual disable, source error, or anomaly → halt and escalate).

## Weekly packet (one per client)

1. **Top 3 approvals needed**, each a Cerevex record with why_plain and the approver from the profile.
2. Anomalies and "not checked" sources.
3. Everything else, grouped Do now / Test / Needs data, sorted by expected $/month.
4. Drafts attached (ads, replies, messages) with claims-check results.

"Checked, nothing to act on" is a valid result.

Upstream references to port after review: anatomy, cadence rule, `loop-state.md`, `loop-guardrails.md` (minus the autonomy exception), paid/SEO/review loops from `loop-catalog.md`. Deferred until Cerevex is marketed: SaaS activation and revenue loops. Cut: paywall loops, agent-specific scheduling commands, directory-submission and newsjacking loops.
