# OFFBEAT — Status

_Last updated: 2026-10-10. Facts below are things that were actually run in this repository; anything unverified is labelled._

## Headline
The application, API, database schema and smart contract are built and tested. **Nothing is deployed to Monad Testnet yet, and no testnet transaction exists**, because the dedicated deployer wallet has 0 MON and funding needs the faucet (a human step). Until that is done the live-product requirement is **not met**.

## Verified (commands were run; results are real)
| Check | Result |
|---|---|
| `npm run typecheck` | pass (0 errors) |
| `npm run lint` | pass (0 problems) |
| `npm test` (Vitest) | **79 / 79 pass**: scoring (10), allocation incl. 200-case property test (10), DB constraints + RLS roles (11), API journey incl. receipt verification with synthetic logs (41), UI (7) |
| `forge test` | **27 / 27 pass**, incl. reentrancy attacker, rejecting receiver, 256-run solvency fuzz |
| `npm run build` | pass |
| Monad RPC | `https://testnet-rpc.monad.xyz` reports chain ID **10143** (queried live) |
| Browser journey (Playwright, real Chromium) | referral link → door QR code → check-in → replay rejected → dashboards; no console errors; no horizontal scroll at 390 px |
| **Local on-chain rehearsal** | Real contract deployed to a **local Anvil node configured with chain ID 10143**; `chain:seed` and a browser run with an injected mock wallet completed create → fund → approve → allocate → claim through the real UI/API, with the server verifying each receipt. **This is not testnet evidence.** It proves the code path, not a live deployment. |

## Not done / not verified
- **Contract not deployed to Monad Testnet. No explorer-verified transaction exists.** Contract address: _none_.
- Real browser wallets (MetaMask etc.) were not used; wallet flows were exercised with a scripted EIP-1193 mock against Anvil. Expect small differences on first real use.
- Not deployed anywhere; Dockerfile not built (no Docker daemon available); hosting steps in `docs/DEPLOYMENT.md` are untested.
- Supabase was **not** used (see decision below), so Supabase Auth/RLS-through-PostgREST are untested. The SQL schema and RLS policies were tested on embedded Postgres using `anon`/`authenticated` roles.
- No accessibility audit beyond semantic HTML, labels, focus styles, reduced-motion CSS and a skip link. Not tested with a screen reader.
- Demo and pitch videos not recorded.

## Decisions that deviate from the written plan
1. **Embedded PostgreSQL (PGlite) + a Node API instead of Supabase.** No Supabase credentials or CLI were available, and unexecuted Edge Functions cannot be verified. The schema is plain Postgres (`db/migrations/001_init.sql`) with RLS policies, so it runs unchanged on Supabase; only the API's database adapter and auth would change. Trade-off: a single instance with an on-disk database.
2. **Demo auth.** Personas and guest accounts sign in without passwords (signed, expiring session token). Fine for judging; not a production identity system.
3. **Wallet linking by signature.** A wallet is bound to a profile only after signing a server-issued nonce.
4. **Only attendees can rate**, and only recommendations tied to an event can be rated. This ties the quality score to real check-ins and blunts rating spam.
5. **Distribution is per event.** A pool rewards recommendations of its event; the allocation is frozen at approval and the contract call carries exactly those numbers.
6. **Admin demo route** exists only as `POST /api/admin/reset`, disabled unless `DEMO_ADMIN_TOKEN` is set; there is no admin UI.

## Next steps (in order)
1. **You:** fund the deployer address printed by `npm run chain:wallet` at https://faucet.monad.xyz (≈0.3 MON). Deployer: `0x0fe077DBA2597B5CcE0c3f8D086a61A07089e28C` (testnet only).
2. `npm run chain:balance` → `npm run chain:deploy` → record the address here and in the README.
3. `npm start` + `npm run chain:seed` → real hashes appear on `/impact`; paste 2–3 explorer links here.
4. Deploy (see `docs/DEPLOYMENT.md`), run Path B from `/judge` with a real wallet, record videos.
