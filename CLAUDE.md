# OFFBEAT — Project Instructions for Claude Code

## Product mission
OFFBEAT is a community-powered discovery platform for independent artists, cultural experiences, and overlooked creators. It rewards useful discovery rather than raw popularity. The core demo loop is: curator recommends a creator/event → participant follows the recommendation and checks in to a demo event → backend validates the check-in and calculates contribution scores → sponsor allocates a reward pool → a Monad Testnet transaction records funding/allocation/claim.

Tagline: **Discover differently. Reward discovery.**

## Hackathon constraints
- Solo build; optimize for a reliable, polished end-to-end demo.
- The submission form requires the live product to run on Monad Mainnet or Testnet. Target Monad Testnet first.
- Never claim an onchain interaction works unless it has been tested against the deployed contract and its transaction hash can be verified.
- Use testnet MON only. No real-money promises, production claims, or token speculation.
- Do not build a DAO, token launch, NFT collection, chat system, complex recommendation AI, or multi-chain system for the MVP.

## Product principles
1. Discovery quality matters more than follower count.
2. Every score and reward calculation must be explainable in the UI.
3. Label demo/seeded data honestly.
4. Treat event check-ins as evidence of a referral action, not perfect proof that a recommendation caused attendance.
5. A QR code alone does not prove a real person attended. Use expiring, single-use codes and server-side validation in the demo.
6. Never trust client-provided scores, payout amounts, role assignments, or check-in validity.
7. Keep the app usable for judges without requiring them to purchase anything.
8. Accessibility, responsive layout, empty states, loading states, and error states are part of done.

## Preferred stack
- Frontend: React + Vite + TypeScript.
- Styling: Tailwind CSS; use a small, consistent design system and accessible primitives.
- Data/auth: Supabase (Postgres + Auth + Edge Functions) unless the existing repository already has a working equivalent.
- Web3: Solidity + Foundry; viem/wagmi for wallet and contract interaction.
- Network: Monad Testnet, chain ID 10143. Verify current official docs before configuring RPC/explorer URLs.
- Deployment: Vercel for frontend; Supabase for data/functions; contract deployed to Monad Testnet.
- Tests: Vitest/React Testing Library for frontend logic; Foundry tests for contracts; basic API/data validation tests.

If the repository already has a functioning stack, inspect it before changing dependencies. Prefer the smallest viable implementation over rewriting working code.

## MVP routes
- `/` — landing page and discovery feed.
- `/discover` — recommendations with category and community filters.
- `/recommendations/new` — submit recommendation.
- `/creators/:id` — creator detail and related recommendations.
- `/events/:id` — event detail and check-in entry.
- `/dashboard/curator` — reputation, contributions, reward history.
- `/dashboard/sponsor` — create/view reward pool and inspect impact.
- `/impact` — public impact and reward ledger.
- `/admin/demo` — optional resettable demo controls; never expose dangerous controls in production.

## Core features, in priority order
P0:
1. Beautiful responsive landing/discovery feed with realistic seeded cultural content.
2. Recommendation submission with creator/event, category, URL, and explanation.
3. Recommendation detail and curator attribution.
4. One-time, expiring event check-in flow backed by server-side validation.
5. Explainable scoring and curator dashboard.
6. Sponsor reward pool dashboard with explicit demo/testnet labels.
7. Onchain Monad Testnet integration that demonstrably works, or a clearly labelled disabled state until it does.
8. Public transaction history with explorer links and clear statuses.
9. Judge-ready seeded accounts/content and a reliable reset path.
10. README with setup, architecture, contract address, chain ID, test commands, and known limitations.

P1 only after P0 works:
- Search and category filtering.
- Wallet connect/disconnect.
- CSV export of impact.
- Subtle motion and polished empty states.

Do not add:
- AI-generated scores unless explicitly requested and validated.
- Production payments, fiat payments, real creator payouts, or financial claims.
- Unverified “bot-proof”, “fraud-proof”, or causal-attribution claims.
- Fake transaction hashes, fake contract addresses, or fake analytics.

## Reward scoring
Use an explainable prototype score with normalized values 0–100:
`score = 0.30 * quality + 0.25 * novelty + 0.45 * verifiedImpact`
- quality: community feedback score, with a minimum sample threshold or a neutral fallback.
- novelty: simple category/creator recency and existing-platform-popularity heuristic; label as a prototype proxy.
- verifiedImpact: capped unique eligible check-ins attributed to a recommendation, normalized to 0–100.
- Apply anti-abuse rules: one check-in per user/event, one-time expiring token, no self-referrals, duplicate recommendation detection, minimum eligibility threshold, reward caps, and manual review state.
- Scores are illustrative until validated with real users. Document weights and limitations.
- Calculate scores server-side. The client may display, never determine, authoritative values.

## Smart contract requirements
- Minimal native testnet-MON reward pool contract; no custom ERC-20 token.
- Pools have an owner/creator, balance, and state.
- Only authorized pool manager can allocate claimable rewards.
- A curator can claim only their own claimable balance.
- Checks-effects-interactions, reentrancy protection, events, explicit access control, and Solidity tests.
- Never put private keys in source, Vite environment variables, frontend code, or Git.
- Use a dedicated test wallet and `.env` ignored by Git.
- Do not deploy to Mainnet during the hackathon.
- If contract work threatens the end-to-end demo, ship a functional app with the contract integration isolated and clearly report what is live versus simulated. Do not fake the onchain part.

## Engineering workflow
1. Inspect the current repository, package manager, and existing implementation before editing.
2. Write a concise plan and identify blockers; then implement in small vertical slices.
3. Before adding a dependency, explain why it is needed and check if an installed package already solves the problem.
4. Run relevant tests, typecheck, lint, and production build after meaningful changes.
5. Fix errors rather than hiding them. Do not disable lint/type checks just to make a build pass.
6. Never delete user work or rewrite the whole project without explaining why.
7. Keep components small and typed. Use shared components for buttons, cards, badges, forms, dialogs, loading, errors, and empty states.
8. Use accessible labels, keyboard focus, contrast, semantic HTML, and responsive layouts.
9. Use environment variables for secrets; provide `.env.example` with placeholders only.
10. Update `docs/STATUS.md` after each major milestone with completed work, test results, blockers, and next steps.
11. Do not claim tests, deployments, or transactions passed unless you actually ran/verified them.
12. Do not ask the user to manually paste huge code blocks when you can create/edit files directly.

## Visual design direction
- Brand: OFFBEAT — independent culture, hidden gems, community discovery.
- Tone: editorial, confident, creative, premium; not generic “AI SaaS” and not casino-like Web3.
- Background: near-black / charcoal; surfaces slightly lighter; text warm white; muted grey secondary text.
- Accent: electric violet/lavender used sparingly; optional acid-lime for verified status only.
- Typography: strong editorial display face for headlines + highly legible sans-serif for UI. Prefer locally bundled/open-source fonts or safe fallbacks.
- Layout: spacious, asymmetrical editorial grid; large artwork; clear hierarchy; purposeful whitespace.
- Cards: creator artwork, category label, short curator note, meaningful action, attribution.
- Motion: subtle, short, reduced-motion friendly. No excessive glow or constant animation.
- Avoid: generic gradients everywhere, glassmorphism overload, neon borders on every card, fake 3D coins, oversized stats without evidence, template-looking dashboard.
- Logo: use the provided OFFBEAT logo asset if available; preserve clear space and contrast. Make a symbol-only favicon if time allows.

## Definition of done for any feature
- It works end-to-end in the browser.
- It handles loading, success, empty, and error states.
- It is responsive and keyboard-usable.
- Server-side validation protects critical actions.
- Relevant tests pass.
- No secrets or fake data claims are introduced.
- Docs and demo steps are updated.

## Final submission checklist
- Public GitHub repository or explicitly shared with the organizer.
- Live deployed app on Monad Testnet or Mainnet as required by the event.
- Verified contract address and explorer link.
- Technical demo video <= 3 minutes showing the working product.
- Pitch video <= 2 minutes.
- Judge instructions with the exact steps and any demo account details.
- Final review of every URL from a clean browser session.
