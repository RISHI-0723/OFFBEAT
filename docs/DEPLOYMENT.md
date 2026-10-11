# Deployment

OFFBEAT is one Node process: it serves the built React app and the `/api` routes, and embeds PostgreSQL (PGlite) with its data on disk.
**Status: nothing has been deployed by this project yet.** The steps below are untested against a hosting provider; the Dockerfile has not been built in this environment (no Docker daemon was running).

## 1. Contract (Monad Testnet only)
```bash
npm run chain:wallet      # creates testnet-only keys in .env, prints addresses (never prints keys)
# fund the DEPLOYER address at https://faucet.monad.xyz  (about 0.3 MON is plenty)
npm run chain:balance     # confirm funds and that the RPC reports chain 10143
cd contracts && forge test && forge build && cd ..
npm run chain:deploy      # refuses any chain other than 10143; writes REWARD_POOL_ADDRESS to .env
```
Verify the contract on the explorer and note the address and deploy transaction.

## 2. Seed one real, verifiable settlement
```bash
npm start                 # in one terminal (loads .env, seeds fictional demo content)
npm run chain:seed        # in another: link wallets → create → fund → approve → allocate → claim
```
This uses only public API routes, so the server verifies every receipt exactly as it does for a judge. The resulting hashes appear on `/impact`.

## 3. Host the app
Any host that runs a container or `npm start` with a **persistent disk**:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | 32+ random bytes (required in production) |
| `DATA_DIR` | a path on the persistent volume, e.g. `/app/data/pg` |
| `MONAD_RPC_URL`, `CHAIN_ID`, `EXPLORER_URL` | see `.env.example` |
| `REWARD_POOL_ADDRESS` | from step 1 |
| `DEMO_ADMIN_TOKEN` | leave empty to keep `/api/admin/reset` disabled |

Never set `DEPLOYER_PRIVATE_KEY` or the demo-curator keys on the host; they are only for running scripts from your own machine.
If the database volume is lost the on-chain data remains, but OFFBEAT's records of it do not: re-run step 2 against a fresh pool.

Run the one-off seed from your machine with `API_URL=https://your-host npm run chain:seed` **against a database that has the same contract address configured**.

## 4. Pre-submission checklist
- [ ] Open the public URL in a clean browser profile; `/judge` loads and demo personas sign in.
- [ ] `/impact` shows receipt-verified transactions whose explorer links open and match.
- [ ] Contract address in the footer matches the deployed contract.
- [ ] Complete Path B in `/judge` once with your own wallet.
- [ ] Demo video ≤ 3 min and pitch ≤ 2 min recorded against the live URL.
