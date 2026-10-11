# OFFBEAT — Discover differently. Reward discovery.

OFFBEAT is a community discovery platform that rewards useful recommendations of independent artists and cultural events. Its loop:

**recommendation → referral link → server-validated event check-in → explainable score → bounded reward pool → settlement on Monad Testnet → public ledger.**

> **Prototype status, stated plainly.** Testnet only; MON has no monetary value. Scores are illustrative proxies. Seeded creators, venues and attendees are **fictional** and labelled as demo content. A referral is evidence of a recorded action, never proof that a recommendation caused it. See [docs/STATUS.md](docs/STATUS.md) for what is and is not verified today.

## What is implemented

| Area | What exists |
|---|---|
| Discovery | Editorial feed with search and category filters, recommendation and creator pages, generated artwork, loading/empty/error states |
| Curators | Recommendation form with server validation and duplicate detection, personal referral link, dashboard with score evidence and rewards |
| Proof of Discovery | Door screen issues random, ~90 s, single-use QR codes (hash stored); server validates and atomically consumes them; one check-in per person per event (DB constraint); self-referrals excluded; rejections logged and rate-limited |
| Scoring | `0.30·quality + 0.25·novelty + 0.45·verifiedImpact`, each 0–100, pure and deterministic, computed only on the server; provisional/proxy components labelled |
| Rewards | Deterministic integer-math allocation, bounded by on-chain funding, per-curator cap (50 %), rounding dust stays in the pool; preview → approve (frozen snapshot) → allocate |
| Contract | `contracts/src/RewardPool.sol`: native-MON pools, `createPool / fundPool / allocateRewards / claimReward / closePool`, access control, reentrancy guard, checks-effects-interactions, events |
| Verification | The server reads each transaction receipt itself, requires success, the right contract and matching decoded events before writing to the ledger. The client only reports a hash. |
| Ledger | `/impact`: seeded vs live evidence counted separately, pools, allocations, claims, abuse signals, explorer links |

## Quick start (local)

Requirements: Node 24+, npm. (Foundry only for contract work.)

```bash
npm install
npm run dev            # API on :8787, web on http://localhost:5173
```
The embedded database is seeded with fictional demo content on first start (`data/` is git-ignored; `npm run db:reset` re-seeds).
Open **/judge** for a guided walkthrough, or use the one-click demo personas on **/signin**.

Production-style run: `npm run build && npm start` → http://localhost:8787.

### Checks
```bash
npm run typecheck && npm run lint && npm test     # 79 tests: scoring, allocation, DB constraints + RLS, API journey, UI
npm run test:contracts                            # 27 Foundry tests (needs forge)
npm run build
```

### Monad Testnet
Chain ID **10143** · RPC `https://testnet-rpc.monad.xyz` · explorer `https://testnet.monadvision.com` · faucet `https://faucet.monad.xyz` (verified against docs.monad.xyz).
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) to create a test wallet, deploy the contract and seed a real settlement.

**Contract address:** *not yet deployed* — see STATUS. The app shows an explicit "contract not configured" state until `REWARD_POOL_ADDRESS` is set; it never shows invented hashes.

## Architecture in one screen
```
React + Vite + TS + Tailwind ──/api──▶ Hono API (Node)
  wagmi/viem wallet                      ├─ PostgreSQL (PGlite embedded; same SQL as Supabase Postgres)
  injected wallets only                  ├─ services: checkin · scoring · rewards · chain verification
                                         └─ viem public client ──▶ Monad Testnet ◀── RewardPool.sol
```
Trust boundary: scoring is off-chain and the pool manager (the sponsor's wallet) is trusted to allocate what the server previewed. The contract guarantees only bounds, ownership and an audit trail. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SECURITY_AND_LIMITATIONS.md](docs/SECURITY_AND_LIMITATIONS.md).

## Repository map
`src/` frontend · `server/` API, services, scripts · `shared/` pure domain logic (scoring, allocation, ABI) · `db/migrations/` schema + RLS · `contracts/` Foundry project · `tests/` · `docs/`

## Known limitations
See [docs/SECURITY_AND_LIMITATIONS.md](docs/SECURITY_AND_LIMITATIONS.md). In short: sybil accounts and shared QR codes are mitigated, not prevented; novelty is a crude proxy; demo sign-in has no passwords; the sponsor wallet is a trusted manager; one server instance with an embedded database.
