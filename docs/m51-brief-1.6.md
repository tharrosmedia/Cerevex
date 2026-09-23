# M5.1 Brief 1.6 — operator notes

Day-job loop on Meta + Google v0: see creatives → analyze → recommend → optional Grok build → Approve to apply.

## Capability flags (default hidden)

| Id | What turns on |
|---|---|
| `m51.budget_shift` | Recs when `on` or `recommend_only`. Approve/apply writes **only** when `on`. `recommend_only` emits `review` and never queues `update_budget`. |
| `m51.grok_creatives` | Creatives viewer, Adapt / make another, Promote |
| `m51.lp_congruence` | Landing-page match recs (recommend-only) |
| `m51.ga4_connect` | Funnel connect (GA4 + pixel) |
| `m51.brainstorm` | Leads / brainstorm nav + idea inbox |
| `apply.create_entity` | Live/mock `create_ad` under Approve |

Soft-launch: leave them hidden until Adam enables per workspace. Deny / Snooze / kill switch / freeze never write.

## Site apply decision

**Live LP apply is deferred.** There is no Site connector, WordPress, or Multi-CMS mutation family on main. LP recs use `action: review` + `siteApply: "later"`. The UI says Cerevex cannot change the website in this slice.

## Funnel approach

**Both** GA4 connect (property / measurement id stored on `analytics_connections`) and a Cerevex first-party pixel (`funnel_events`).

Privacy / retention / attribution:

- Events: `page_view`, `view_content`, `generate_lead`, `purchase` only
- No session replay, heatmaps, mouse trails, or visitor video
- No names, emails, or phone numbers required
- Last-touch: `utm_source` / `utm_campaign` / `gclid` / `fbclid` on the landing URL
- Retention: 30-day window for rec strengthening; product intent is 90 days
- GA4: property id only in this slice. No user-level Data API export

Funnel signal, when a campaign has page views and at least one lead, is appended to budget-shift and creative-test rationales.

## Grok

Uses `XAI_API_KEY` (same env as Brain SEO). Image via xAI images API. Video via xAI videos API when present; otherwise a storyboard + script is stored. No keys in the repo.

## QA (supervised Adam path)

1. Settings → Capabilities: turn on the `m51.*` flags you want (and `apply.create_entity` to test create).
2. Kill switch off, account not frozen, Adam allowlist.
3. Mock-connect Meta + Google, Sync, Check ads.
4. Suggestions inbox: Budget / Creative test / Landing page.
5. Approve a budget rec → Applying… → apply job. Deny/Snooze another → no write.
6. Creatives → Adapt / make another → Leads → Promote → Approve (create stays paused on live Meta).
7. Funnel → Connect GA4 and pixel. Load pixel URL once, re-check ads — rec copy mentions pixel when events exist.
