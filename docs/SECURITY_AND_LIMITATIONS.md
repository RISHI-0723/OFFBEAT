# Security, Trust, and Limitations

## Never claim
- “Fraud-proof”
- “Guaranteed causal attribution”
- “Guaranteed creator growth”
- “Real payouts” if only testnet or demo credits are used
- “Onchain” if the operation is only stored in Postgres
- “Deployed” without verifying the contract and app

## Check-in safety
- Generate cryptographically random tokens on the server.
- Store a hash of the token, not the raw reusable token.
- Use short expiration and single-use semantics.
- Bind token to an event.
- Require an authenticated eligible user.
- Enforce unique (event_id, user_id) in the database.
- Rate-limit validation attempts.
- Treat QR as one layer of evidence, not identity proof.

## Reward integrity
- Compute score and eligibility server-side.
- Record score formula version and evidence.
- Use deterministic reward allocation and rounding rules.
- Prevent allocations exceeding pool balance.
- Keep audit events append-only where practical.
- Provide a pending-review state for suspicious patterns.
- Do not let a curator self-refer or rate their own recommendation.

## Wallet and contract
- Testnet only for hackathon.
- Never expose private keys to frontend.
- Use dedicated wallet with only test funds.
- Confirm chain ID before writes.
- Verify contract address and explorer URL.
- Use safe Solidity patterns and tests.
- Explain that offchain score computation is trusted by the pool manager in this prototype.
- If using a centralized manager, disclose that the system is not fully decentralized.

## Privacy
- Collect only necessary profile and check-in data.
- Do not publicly reveal sensitive personal information.
- Do not expose access tokens in URLs or logs.
- Configure Supabase RLS before connecting the public frontend.
- Keep secrets out of commits and screenshots.

## Known product limitations
- Quality and novelty are subjective proxies.
- A referral trail is not proof the recommendation caused an action.
- A QR can be shared; rate limits and one-time tokens reduce but do not eliminate abuse.
- Demo users and seeded content must be labelled.
- Testnet assets have no promised monetary value.

---

## Implemented controls and how they were tested (2026-10-10)
| Control | Where | Test |
|---|---|---|
| Random, hashed, expiring, single-use door tokens | `server/services/checkin.ts` | `tests/api.test.ts` (replay, expiry, invalid, wrong event) |
| One check-in per user/event; token reuse impossible | DB `UNIQUE` constraints | `tests/db.test.ts` |
| Self-referral cannot be verified; self-rating forbidden | DB triggers + API | `tests/db.test.ts`, `tests/api.test.ts` |
| Rate limits (check-in, sign-up, writes, verification) | `server/ratelimit.ts` | `tests/api.test.ts` (check-in limiter) |
| Scores/allocations server-side only; caps; no over-allocation | `shared/*`, `services/rewards.ts` | `tests/scoring.test.ts`, `tests/allocation.test.ts` (incl. 200-case property test) |
| Client cannot write verified data | RLS: no write policies for API roles | `tests/db.test.ts` (anon writes denied) |
| Transactions recorded only after server reads the receipt; spoofed logs from other contracts ignored | `server/services/chainRecord.ts` | `tests/api.test.ts` |
| Contract: access control, bounds, reentrancy guard, CEI | `contracts/src/RewardPool.sol` | 27 Foundry tests |
| Wallet ownership proven by signature | `/api/me/wallet` | `tests/api.test.ts` (forged signature rejected) |
| Audit log append-only | DB trigger | `tests/db.test.ts` |

### Still true after all of the above
- Rate limiting is in-memory and per-process.
- One person can create many accounts; nothing here proves personhood. A shared QR can be passed on within its 90-second life.
- The sponsor wallet is a trusted manager; the contract does not verify scores.
- Demo sign-in is intentionally passwordless.
- Session tokens live in `localStorage` (XSS would expose them); a production build would use httpOnly cookies and CSRF protection.
- The contract is **unaudited** and has only been tested locally; do not use it with value.
