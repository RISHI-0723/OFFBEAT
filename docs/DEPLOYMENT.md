# Deployment: Vercel (free) + Supabase Postgres (free)

**Status:** code adapted and tested locally (adapter, migrations, import, handler, routing). Nothing is live until the steps below are done and the smoke test in section 6 passes.

## Architecture
- Frontend: Vite build in `dist/`, served by Vercel's CDN. `vercel.json` rewrites non-API paths to `/index.html` (direct URLs, refresh, back/forward).
- API: `api/index.ts` is a Vercel Node.js function wrapping the same Hono app (`server/app.ts`). `/api/*` is rewritten to it with the original URL preserved.
- Database: Supabase Postgres through the **transaction pooler** (port 6543) using the `postgres` driver with `prepare: false`, one connection per function instance.
- The function never migrates and never seeds. Both are explicit commands you run from your machine.
- Rate limits are stored in the `rate_limits` table (migration 002) so they hold across instances (fixed windows).
- Chain: the existing Monad Testnet contract is only *read* and receipts verified. Nothing here deploys, funds, allocates or claims.

## 1. Put the database URL in a git-ignored file (never in chat)
Supabase dashboard > Connect > **Transaction pooler** > URI. Create `.env.supabase` in the project root with:
```
DATABASE_URL=postgresql://postgres.<project-ref>:<YOUR-PASSWORD>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres
```
(`.env.*` is git-ignored.) Special characters in the password must be URL-encoded.

## 2. Apply migrations (additive, safe to re-run)
```powershell
$env:ENV_FILE=".env.supabase"; npm run db:migrate
```
Creates the tables, RLS (anon/authenticated are read-only on public data only) and `rate_limits`. Re-running is a no-op. Nothing is dropped.

## 3. Load data (choose ONE; both refuse to run on a non-empty database)
**A. Preserve the existing local data (recommended; keeps the contract-linked pool, wallet links and the 5 verified transactions):**
```powershell
$env:ENV_FILE=".env.supabase"
npm run db:import-local            # dry run: prints row counts only
npm run db:import-local -- --apply # copies ./data/pg into the empty database in one transaction
```
Stop the local dev server first, and copy `data/pg` somewhere as a backup. Use `$env:SOURCE_DATA_DIR` to read from the copy.
**B. Fresh fictional demo content only (no chain history):** `npm run db:seed`.

## 4. Vercel environment variables (Project > Settings > Environment Variables, Production)
| Variable | Value |
|---|---|
| `DATABASE_URL` | the pooler URI (mark Sensitive) |
| `SESSION_SECRET` | 32+ random bytes: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (paste straight into Vercel; do not save it) |
| `MONAD_RPC_URL` | `https://testnet-rpc.monad.xyz` |
| `CHAIN_ID` | `10143` |
| `EXPLORER_URL` | `https://testnet.monadvision.com` |
| `REWARD_POOL_ADDRESS` | `0xd62a8a1e2f39895f9cf810882fff57e97b4f47fa` |

`NODE_ENV=production` is set by Vercel. Leave `DEMO_ADMIN_TOKEN` and `ALLOW_PROD_RESET` unset. Never set the deployer or demo-curator private keys. Changing any variable needs a **redeploy** to take effect.

## 5. Vercel project settings
Import `RISHI-0723/OFFBEAT`, branch `main`. Framework preset: Vite. Root directory: `./`. Build command `npm run build`, output `dist` (already in `vercel.json`). Install command: default.

## 6. Smoke test (read-only; no transactions)
`/api/health` returns `{"ok":true}`; `/api/config` shows chain 10143 and the contract; `/discover` and a deep link refresh load; demo persona sign-in works; `/impact` lists the five existing transactions.

## Troubleshooting
- `503 Service is not configured correctly`: see the function logs; usually a missing `DATABASE_URL` or `SESSION_SECRET`.
- `prepared statement ... does not exist`: a driver without `prepare:false` is in use (should not happen here).
- Password errors: URL-encode special characters; the pooler username is `postgres.<project-ref>`.
- Local dev is unchanged: `npm run dev` uses embedded PGlite when `DATABASE_URL` is unset.

## Legacy single-container hosting
`Dockerfile` still works with `DB_DRIVER=pglite` and a persistent volume at `/app/data`.
