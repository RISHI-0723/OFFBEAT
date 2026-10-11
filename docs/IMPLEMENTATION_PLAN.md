# OFFBEAT 48-Hour Implementation Plan

## Rule
Do not build everything at once. Deliver a complete vertical slice before adding polish or optional features.

## Phase 0 — Inspect and scaffold (0–2 hours)
- Inspect repository, package manager, existing code, and deployment status.
- Create/verify `CLAUDE.md`, environment example, docs and gitignore.
- Set up the app and confirm a production build.
**Exit criteria:** app runs locally; build passes.

## Phase 1 — Visual foundation (2–7 hours)
- Implement design tokens, typography, app shell, navigation, responsive layout.
- Build landing/discovery feed with seed data.
- Create recommendation cards and detail page.
**Exit criteria:** polished feed works on desktop/mobile with loading/empty states.

## Phase 2 — Core data and curator journey (7–13 hours)
- Create schema and RLS policies.
- Implement recommendation submission and curator attribution.
- Implement curator dashboard.
**Exit criteria:** recommendation persists and appears in feed/dashboard.

## Phase 3 — Proof of Discovery (13–20 hours)
- Create event and one-time QR/token flow.
- Validate tokens server-side; expire and mark used.
- Enforce unique check-in per event/user.
- Update impact evidence and scoring preview.
**Exit criteria:** valid check-in succeeds; duplicate/expired check-in fails.

## Phase 4 — Reward pool (20–27 hours)
- Build sponsor dashboard and reward preview.
- Implement formula on server and add test cases.
- Ensure total allocation <= available funds and cap individual rewards.
**Exit criteria:** same evidence always yields reproducible score; client cannot set payout.

## Phase 5 — Monad Testnet (27–34 hours)
- Verify official chain config and RPC.
- Implement minimal contract and Foundry tests.
- Deploy with dedicated test wallet; record contract address and explorer link.
- Integrate wallet/network states, fund pool, allocation, and claim where feasible.
**Exit criteria:** at least one verified testnet transaction works end-to-end.
**Fallback:** if the contract integration is not stable, isolate it, do not fake it, and use remaining time to harden the app. The submission's live product still needs to satisfy the event's stated chain requirement, so escalate any blocker immediately.

## Phase 6 — Hardening (34–39 hours)
- Run frontend tests, contract tests, typecheck, lint, production build.
- Test invalid wallet/network, expired QR, duplicate check-in, insufficient pool balance, failed transaction.
- Test judge flow in a clean browser.
**Exit criteria:** no blocker in the primary demo journey.

## Phase 7 — Deployment and presentation (39–48 hours)
- Deploy frontend/backend and verify production environment variables.
- Publish repository and setup docs.
- Record technical demo <= 3 minutes and pitch <= 2 minutes.
- Verify all links and judge instructions.
- Freeze features; fix only critical bugs.

## Scope cuts if behind
Cut in this order:
1. Fancy motion.
2. Search refinements and category filter.
3. Extra dashboard charts.
4. Novelty heuristic sophistication.
5. Optional wallet conveniences.

Do not cut:
- A working core journey.
- Server-side check-in validation.
- Transparent reward calculation.
- Actual verified Monad interaction required by the event.
- Error handling and demo reliability.
