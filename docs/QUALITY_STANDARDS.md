# Cerevex — PR Quality Standards (thin in-repo copy)

> **Light self-check only.** This file lets Engineering and Cursor cloud agents skim the must-haves before opening a draft PR. The **canonical** standards for full Code Quality audits are Cos's box file `/workspace/pr-quality/QUALITY_STANDARDS.md`. If the two ever differ, the canonical file wins.
>
> Code Quality (CQ) stays the real gate. Eng does **not** run a full Quality-style audit before every draft.

Product: **Cerevex**. Primary repo: `tharrosmedia/Cerevex` (renamed from `tharrosmedia/Shopify-Brain`). Apps: `apps/brain` (Cerevex console) and `apps/ads` (ads module, formerly `apps/os` / Tharros OS).

Gate: Engineering opens a **draft** → Code Quality reviews → Adam merges. A FAIL or required P0–P1 keeps the PR in draft. Do not mark ready-for-review before a CQ PASS.

---

## Severity

| Level | Meaning | Gate |
|-------|---------|------|
| **P0** | Hard-rule / security / spend / data-integrity violation | **FAIL**, must fix |
| **P1** | Correctness, reliability, or contract break that should not ship | **FAIL**, must fix |
| **P2** | Style, cleanup, nice-to-have | Optional; PASS allowed with residual P2s listed |

---

## P0 — Hard rules (always FAIL if violated)

1. **No unsupervised Meta/Google writes or ad spend.** The kill switch stays **default ON** for apply paths.
2. **Authorize ≠ apply.** Authorization flows must not silently apply changes or spend.
3. **Schema boundary.** The ads module (`apps/ads`, formerly `apps/os`) writes only to Postgres schema **`os`**. It never mutates the Brain **public** schema.
4. **No prod seed.** Never run `ads:db:seed` (formerly `os:db:seed`) against prod.
5. **No secrets** in chat, commits, or PR bodies (tokens, keys, credentials, connection strings with passwords).

---

## Eng self-check before opening a draft

- No dead code left behind (unused functions, files, flags, commented-out blocks).
- Reuse existing helpers instead of adding near-duplicates.
- P0 hard rules above hold.
- **No Shopify live publish from Eng.**
- PR scope stays focused on the stated outcome.

---

## P1 / P2 pointers

P1 (must fix before ready): broken types/tests/CI the PR owns; Neon / Railway / Inngest contracts that don't match the agreed spec or eng brief; unsafe defaults (apply enabled without the kill switch, missing authz on write paths); migrations or public API changes that could lock or corrupt prod without a rollback story; missing env/config docs for new required secrets (names only, never values).

P2 (optional): naming, file layout, or refactors unrelated to the PR goal; comment/log noise; test gaps that don't leave a P0/P1 hole.

Full review process and output format live in the canonical file.

---

## Checklist (quick)

- [ ] Draft PR (not already ready-for-review)
- [ ] Diff scoped to stated outcome
- [ ] P0 hard rules hold
- [ ] No secrets in diff or PR body
- [ ] Kill switch default ON on Meta/Google apply paths
- [ ] Authorize path does not imply apply
- [ ] `apps/ads` does not write Brain public schema (schema `os` only)
- [ ] No prod seed
