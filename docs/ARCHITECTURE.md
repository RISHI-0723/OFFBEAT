# OFFBEAT Architecture

## Guiding principle
Use the simplest architecture that can demonstrate one reliable end-to-end discovery-to-reward cycle in a solo hackathon build.

## Logical architecture

```text
React + Vite + TypeScript
  ├── Discovery feed and recommendation forms
  ├── Curator dashboard
  ├── Sponsor dashboard
  ├── Event check-in UI
  └── Impact ledger / wallet UI
          |
          v
Supabase
  ├── Postgres: users, communities, recommendations, events, check-ins, pools, reward history
  ├── Auth: judge/curator/sponsor sessions
  ├── Row Level Security (RLS)
  └── Edge Functions: check-in validation, scoring, eligibility, reward-round preparation
          |
          v
Monad Testnet smart contract
  ├── Create pool
  ├── Fund pool with testnet MON
  ├── Manager allocates claimable balances
  ├── Curator claims reward
  └── Events provide transaction audit trail
```

## Recommended stack
- UI: React, Vite, TypeScript, Tailwind CSS.
- Data/auth: Supabase.
- Contract: Solidity, Foundry, OpenZeppelin utilities only if needed.
- Chain client: viem; wagmi if wallet UI benefits from it.
- Deployment: Vercel + Supabase + Monad Testnet.
- Tests: Vitest and Foundry.

## Data model (minimum)
- `profiles`: id, display_name, role, created_at.
- `communities`: id, name, description, created_by.
- `community_members`: community_id, user_id, role.
- `creators`: id, name, category, bio, external_url, image_url, demo_label.
- `recommendations`: id, curator_id, creator_id, community_id, title, reason, source_url, status, created_at.
- `events`: id, creator_id, title, starts_at, checkin_expires_at, token_hash, status.
- `checkins`: id, event_id, user_id, recommendation_id, verified_at, status. Unique constraint on (event_id, user_id).
- `reward_pools`: id, community_id, title, budget_target, chain_id, contract_pool_id, status.
- `contribution_scores`: id, recommendation_id, quality_score, novelty_score, impact_score, total_score, formula_version, computed_at.
- `reward_transactions`: id, pool_id, curator_id, amount_wei, status, tx_hash, reason, created_at.
- `audit_events`: id, actor_id, action, entity_type, entity_id, metadata, created_at.

Use foreign keys, indexes for feed sorting and lookup, and RLS policies. Never let clients directly insert a verified check-in or set authoritative scores/reward amounts.

## Scoring model
Prototype formula, normalized to 0–100:
`total = 0.30 * quality + 0.25 * novelty + 0.45 * verifiedImpact`

- Quality: average community rating only after a minimum number of distinct raters; otherwise use a neutral/pending state.
- Novelty: explainable heuristic based on category/creator duplication and existing recommendation history. Do not pretend it measures objective cultural novelty.
- Verified impact: unique eligible check-ins attributed to the recommendation, normalized and capped.
- Record formula version and evidence counts with each score.
- Scores are calculated on the server. UI can explain but cannot authoritatively modify scores.
- Apply reward caps and a minimum eligibility threshold. Ensure total allocations never exceed the available pool balance.

## Smart contract outline
Build a small native MON testnet pool contract. Suggested functions:
- `createPool(...)`
- `fundPool(poolId)` payable
- `allocateRewards(poolId, recipients[], amounts[])` restricted to authorized manager; validate equal lengths, positive amounts, pool balance, and total allocations.
- `claimReward(poolId)` lets a recipient claim only their own claimable balance.
- Emit `PoolCreated`, `PoolFunded`, `RewardAllocated`, and `RewardClaimed`.
- Use checks-effects-interactions and reentrancy protection.
- Include tests for unauthorized access, insufficient funds, duplicate allocation edge cases, claim behavior, and reentrancy safety.

The backend score calculation remains off-chain; the contract settles only explicitly approved amounts. Document this trust boundary.

## Transaction flow
1. Sponsor connects wallet and funds a pool.
2. Contract emits funding event; UI waits for receipt and confirms it.
3. Backend computes eligible scores from validated records.
4. Sponsor reviews a distribution preview.
5. Authorized manager submits allocations to the contract.
6. Curators claim their balances.
7. UI records transaction hashes and links to the official Monad explorer.

Do not say a transaction succeeded until a receipt is confirmed. Keep pending, success, and failure states separate.

## Security boundaries
- Never store private keys in browser code.
- Vite `VITE_*` variables are public; only public config belongs there.
- Keep deployer secrets in local ignored environment files or a secure secret manager.
- Use a dedicated test wallet and testnet only.
- Validate wallet/network before write calls.
- RLS and Edge Functions must enforce permissions.
- QR check-in token must be random, expiring, single-use, and validated server-side.
- Do not expose admin/demo reset endpoints publicly without protection.

---

## As built (2026-10-10)
The plan above is the target; this section records what the repository actually does where it differs.

- **Database/API:** a Hono API on Node with an embedded PostgreSQL (PGlite). The same SQL (`db/migrations/001_init.sql`, including RLS policies for `anon`/`authenticated`) is intended to run on Supabase Postgres. Supabase Auth and Edge Functions were **not** used; server logic lives in `server/services/*`. See `docs/STATUS.md` for why.
- **Auth:** demo personas and guest accounts, HMAC-signed 12-hour session tokens. Wallets are linked by signing a server nonce.
- **Check-in:** the door screen requests tokens from `POST /api/events/:id/tokens` (organiser only). Tokens are 192-bit random, TTL 90 s, stored as SHA-256, consumed with an atomic `UPDATE … WHERE used_at IS NULL`. `UNIQUE(event_id, user_id)` and `UNIQUE(token_id)` back this up in the database. A trigger forbids a verified self-referral.
- **Scoring/allocation:** pure functions in `shared/scoring.ts` and `shared/allocation.ts` (bigint maths, water-filling cap). The server imports them; the browser only displays results.
- **Chain trust path:** wallet signs → browser reports a tx hash → `POST /api/chain/record` → server fetches the receipt via its own RPC client, requires `status == success`, `to == contract`, decodes only logs from the contract address, matches them to the expected pool/distribution, then writes `chain_transactions`. Pool balances come from `getPool` on-chain, never from the client.
- **Contract:** `RewardPool.sol` adds `closePool` (manager recovers unallocated MON; claims remain open), a 50-recipient cap per allocation call, and a one-allocation-per-recipient-per-pool rule that matches the single live distribution per pool in the database.
- **Frontend:** Vite + React Router + Tailwind v4 + TanStack Query; wagmi/viem with the injected connector only.
