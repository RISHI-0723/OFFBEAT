import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DistributionPreview, PoolRow } from "../../server/services/rewards";
import type { EventDto } from "../../server/services/data";
import { api, ApiError } from "../lib/api";
import { fmtDateTime, parseMon, score as fmtScore } from "../lib/format";
import { useSession } from "../lib/session";
import { useTxRunner } from "../lib/txRunner";
import { useChainConfig } from "../lib/useChainConfig";
import { Mon, TxLink, TxStatus } from "../components/chain";
import { LinkWalletPanel, WalletGate } from "../components/wallet";
import { Badge, Button, Card, DemoBadge, ErrorState, Eyebrow, Loading, Notice, TextField } from "../components/ui";
import { POOL_STATUS } from "./SponsorDashboard";

interface PoolPayload {
  pool: PoolRow;
  preview: DistributionPreview;
  distributions: { id: string; status: string; total_wei: string; tx_hash: string | null; created_at: string }[];
  transactions: { kind: string; tx_hash: string; actor_address: string; amount_wei: string; block_number: string; created_at: string }[];
  event: EventDto;
  sponsor: { display_name: string; wallet_address: string | null };
}

const KIND_LABEL: Record<string, string> = { create_pool: "Pool created", fund_pool: "Pool funded", allocate: "Rewards allocated", claim: "Reward claimed", close_pool: "Pool closed" };
const ROW_STATUS = {
  payable: { tone: "ok", label: "Payable" },
  blocked_no_wallet: { tone: "warn", label: "No wallet linked" },
  ineligible: { tone: "neutral", label: "Not eligible" },
  no_payout: { tone: "neutral", label: "No payout" },
} as const;

function Preview({ p }: { p: DistributionPreview }) {
  return (
    <div className="grid gap-5">
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
        <table className="w-full min-w-[860px] text-left text-sm">
          <caption className="sr-only">Distribution preview with score components and payouts</caption>
          <thead className="bg-surface text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Recommendation</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Check-ins</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Quality</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Novelty</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Impact</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Score</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Payout</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.recommendationId} className="border-t border-line align-top">
                <th scope="row" className="px-4 py-3 font-normal">
                  <Link to={`/recommendations/${r.recommendationSlug}`} className="hover:text-accent">{r.title}</Link>
                  <div className="text-muted">{r.curatorName}</div>
                </th>
                <td className="tnum px-4 py-3 text-right">{r.score.evidence.verifiedCheckins}</td>
                <td className="tnum px-4 py-3 text-right">{fmtScore(r.score.quality.value)}{r.score.quality.status === "provisional" && <span className="block text-xs text-warn">provisional</span>}</td>
                <td className="tnum px-4 py-3 text-right">{fmtScore(r.score.novelty.value)}</td>
                <td className="tnum px-4 py-3 text-right">{fmtScore(r.score.impact.value)}</td>
                <td className="tnum px-4 py-3 text-right font-semibold">{fmtScore(r.score.total)}</td>
                <td className="px-4 py-3">
                  <Badge tone={ROW_STATUS[r.status].tone}>{ROW_STATUS[r.status].label}</Badge>
                  <p className="mt-1.5 max-w-56 text-xs text-muted">{r.note}</p>
                </td>
                <td className="px-4 py-3 text-right">{r.status === "payable" ? <Mon wei={r.payoutWei} /> : <span className="text-muted">–</span>}</td>
              </tr>
            ))}
            {p.rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">No published recommendations are attached to this event yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-4">
        <div><dt className="text-muted">Distributable</dt><dd className="font-display text-xl"><Mon wei={p.distributableWei} /></dd><dd className="text-xs text-muted">lower of target budget and on-chain funding</dd></div>
        <div><dt className="text-muted">Would be allocated</dt><dd className="font-display text-xl"><Mon wei={p.totalAllocatedWei} /></dd></div>
        <div><dt className="text-muted">Stays in pool</dt><dd className="font-display text-xl"><Mon wei={p.unallocatedWei} /></dd><dd className="text-xs text-muted">rounding dust and share withheld by the cap</dd></div>
        <div><dt className="text-muted">Per-curator cap</dt><dd className="tnum font-display text-xl">{p.rules.maxShareBps / 100}%</dd><dd className="text-xs text-muted">of the distributable amount</dd></div>
      </dl>
      <p className="text-xs text-muted">
        Formula <span className="font-mono">{p.formulaVersion}</span>. Eligibility needs ≥ {p.rules.minVerifiedCheckins} verified check-ins. Payouts are proportional to total score using integer arithmetic, so the same evidence always produces the same numbers. This preview is computed by the server; nothing on this page can change it.
      </p>
    </div>
  );
}

function SponsorControls({ data }: { data: PoolPayload }) {
  const { viewer } = useSession();
  const qc = useQueryClient();
  const tx = useTxRunner();
  const cfg = useChainConfig();
  const { pool, preview } = data;
  const [fund, setFund] = useState("0.1");
  const [fundErr, setFundErr] = useState<string | null>(null);
  const [apiErr, setApiErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries();
  const live = data.distributions.find((d) => d.status === "approved" || d.status === "submitted" || d.status === "confirmed");
  const wallet = viewer?.wallet_address ?? null;

  const wrap = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setApiErr(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setApiErr(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const createOnchain = () =>
    tx.run({ label: "Create pool on Monad", functionName: "createPool", args: [pool.title], record: async (h) => { await api.post("/api/chain/record", { kind: "create_pool", txHash: h, poolId: pool.id }); await refresh(); } });

  const fundOnchain = () => {
    const wei = parseMon(fund);
    if (!wei || wei <= 0n) return setFundErr("Enter a positive amount, e.g. 0.1");
    setFundErr(null);
    return tx.run({ label: `Fund pool with ${fund} MON`, functionName: "fundPool", args: [BigInt(pool.contract_pool_id!)], value: wei, record: async (h) => { await api.post("/api/chain/record", { kind: "fund_pool", txHash: h, poolId: pool.id }); await refresh(); } });
  };

  const submitAllocation = async () => {
    if (!live) return;
    const args = await api.get<{ contractPoolId: number; recipients: string[]; amounts: string[] }>(`/api/distributions/${live.id}/onchain-args`);
    await tx.run({
      label: "Allocate rewards on Monad",
      functionName: "allocateRewards",
      args: [BigInt(args.contractPoolId), args.recipients, args.amounts.map((a) => BigInt(a))],
      record: async (h) => { await api.post("/api/chain/record", { kind: "allocate", txHash: h, poolId: pool.id, distributionId: live.id }); await refresh(); },
    });
  };

  const closeOnchain = () =>
    tx.run({ label: "Close pool and recover unallocated MON", functionName: "closePool", args: [BigInt(pool.contract_pool_id!)], record: async (h) => { await api.post("/api/chain/record", { kind: "close_pool", txHash: h, poolId: pool.id }); await refresh(); } });

  if (cfg.data && !cfg.data.chainEnabled) return <Notice tone="warn" title="On-chain actions are disabled on this deployment">No RewardPool contract address is configured, so funding and allocation cannot run here. The preview above still shows exactly what would be paid.</Notice>;
  if (!wallet) return <div className="grid gap-4"><Notice tone="warn" title="Link your wallet first">The pool manager on-chain must be a wallet you have proven you control.</Notice><LinkWalletPanel /></div>;

  return (
    <div className="grid gap-8">
      <ol className="grid gap-8">
        <li className="grid gap-3">
          <h3 className="text-xl">1. Create the pool on Monad</h3>
          {pool.contract_pool_id != null ? (
            <p className="text-sm text-ok">✓ Created on-chain as pool #{pool.contract_pool_id}. Your wallet is its manager.</p>
          ) : (
            <WalletGate expectAddress={wallet} why="Creating the pool makes your wallet its manager: the only address that can allocate or close it.">
              <div><Button onClick={createOnchain} loading={tx.busy}>Create pool on-chain</Button></div>
            </WalletGate>
          )}
        </li>

        <li className="grid gap-3">
          <h3 className="text-xl">2. Fund it with testnet MON</h3>
          {pool.contract_pool_id == null ? (
            <p className="text-sm text-muted">Available after step 1.</p>
          ) : pool.status === "closed" ? (
            <p className="text-sm text-muted">Closed pools cannot be funded.</p>
          ) : (
            <WalletGate expectAddress={wallet} why="Funding sends testnet MON from your wallet into the contract.">
              <div className="flex flex-wrap items-end gap-3">
                <TextField label="Amount (MON)" inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value)} error={fundErr ?? undefined} className="w-44" />
                <Button onClick={() => void fundOnchain()} loading={tx.busy}>Fund pool</Button>
              </div>
              <p className="text-sm text-muted">On-chain balance (read from the contract): <Mon wei={pool.funded_wei} /></p>
            </WalletGate>
          )}
        </li>

        <li className="grid gap-3">
          <h3 className="text-xl">3. Review and approve the distribution</h3>
          {preview.blockers.length > 0 && !live ? (
            <Notice title="Not ready to approve yet">{preview.blockers.join(" ")}</Notice>
          ) : live ? (
            <p className="text-sm text-ok">✓ Distribution approved (<Mon wei={live.total_wei} />). It is frozen: the exact amounts below are what the contract call will carry.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void wrap(() => api.post(`/api/pools/${pool.id}/approve`))} loading={busy}>Approve this distribution</Button>
              <span className="text-sm text-muted">Freezes the preview above as the allocation to submit.</span>
            </div>
          )}
        </li>

        <li className="grid gap-3">
          <h3 className="text-xl">4. Allocate on Monad</h3>
          {!live ? (
            <p className="text-sm text-muted">Available after step 3.</p>
          ) : live.status === "confirmed" ? (
            <p className="text-sm text-ok">✓ Allocated on-chain. Curators can now claim from their dashboards. {live.tx_hash && <TxLink hash={live.tx_hash} />}</p>
          ) : (
            <WalletGate expectAddress={wallet} why="Only the pool manager wallet can allocate. The contract rejects any total above the funded balance.">
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void submitAllocation()} loading={tx.busy}>Submit allocation</Button>
                <Button variant="ghost" onClick={() => void wrap(() => api.post(`/api/distributions/${live.id}/cancel`))} disabled={tx.busy}>Cancel approved distribution</Button>
              </div>
            </WalletGate>
          )}
        </li>

        {pool.status === "allocated" && (
          <li className="grid gap-3">
            <h3 className="text-xl">5. Close and recover leftovers (optional)</h3>
            <p className="text-sm text-muted">Returns MON that was never allocated to your wallet. Curators can still claim after closing.</p>
            <WalletGate expectAddress={wallet} why="Only the pool manager can close the pool.">
              <div><Button variant="secondary" onClick={closeOnchain} loading={tx.busy}>Close pool</Button></div>
            </WalletGate>
          </li>
        )}
      </ol>
      {apiErr && <Notice tone="bad">{apiErr}</Notice>}
      <TxStatus state={tx.state} />
    </div>
  );
}

export default function PoolDetail() {
  const { id = "" } = useParams();
  const { viewer } = useSession();
  const q = useQuery({ queryKey: ["pool", id, viewer?.id ?? "anon"], queryFn: () => api.get<PoolPayload>(`/api/pools/${id}?sync=1`) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const owner = viewer?.id === d.pool.sponsor_id;
  const st = POOL_STATUS[d.pool.status];

  return (
    <div className="grid gap-12">
      <header>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={st.tone}>{st.label}</Badge>
          {d.pool.is_demo && <DemoBadge />}
          <Badge>Testnet MON, no monetary value</Badge>
        </div>
        <h1 className="max-w-4xl text-4xl font-semibold leading-[1.05] sm:text-5xl">{d.pool.title}</h1>
        <p className="mt-4 text-muted">
          Funds discovery for <Link className="text-ink underline decoration-line underline-offset-4 hover:decoration-accent" to={`/events/${d.event.slug}`}>{d.event.title}</Link> · sponsored by {d.sponsor.display_name} · created {fmtDateTime(d.pool.created_at as unknown as string)}
        </p>
        {d.pool.description && <p className="mt-3 max-w-2xl text-muted">{d.pool.description}</p>}
        <dl className="mt-8 grid max-w-2xl grid-cols-3 gap-6 text-sm">
          <div><dt className="text-muted">Target budget</dt><dd className="font-display text-2xl"><Mon wei={d.pool.budget_wei} /></dd></div>
          <div><dt className="text-muted">Funded on-chain</dt><dd className="font-display text-2xl"><Mon wei={d.pool.funded_wei} /></dd></div>
          <div><dt className="text-muted">On-chain pool</dt><dd className="tnum font-display text-2xl">{d.pool.contract_pool_id != null ? `#${d.pool.contract_pool_id}` : "none yet"}</dd></div>
        </dl>
      </header>

      <section aria-labelledby="prev-h">
        <Eyebrow className="mb-2">Distribution preview</Eyebrow>
        <h2 id="prev-h" className="mb-6 text-3xl">Who would be paid, and why</h2>
        <Preview p={d.preview} />
      </section>

      {owner ? (
        <section aria-labelledby="ctl-h">
          <Eyebrow className="mb-2">Your controls</Eyebrow>
          <h2 id="ctl-h" className="mb-6 text-3xl">Run this pool</h2>
          <Card className="p-6"><SponsorControls data={d} /></Card>
        </section>
      ) : (
        <Notice title="Read-only view">Only the sponsor who created this pool can fund or allocate it. Everything above is public so anyone can check the working.</Notice>
      )}

      <section aria-labelledby="tx-h">
        <Eyebrow className="mb-2">Audit trail</Eyebrow>
        <h2 id="tx-h" className="mb-6 text-3xl">On-chain transactions</h2>
        {d.transactions.length === 0 ? (
          <p className="text-muted">No verified transactions yet. Entries appear here only after the server has read the receipt from Monad Testnet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
            {d.transactions.map((t) => (
              <li key={`${t.tx_hash}-${t.kind}-${t.actor_address}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
                <span className="font-medium">{KIND_LABEL[t.kind] ?? t.kind}</span>
                {BigInt(t.amount_wei) > 0n && <Mon wei={t.amount_wei} />}
                <span className="text-muted">block <span className="tnum">{t.block_number}</span></span>
                <TxLink hash={t.tx_hash} />
                <Badge tone="ok">Confirmed</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
