import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { buildImpact } from "../../server/services/views";
import { api } from "../lib/api";
import { CATEGORY_LABELS, fmtDateTime, score as fmtScore } from "../lib/format";
import { addrUrl, useChainConfig } from "../lib/useChainConfig";
import { Mon, TxLink } from "../components/chain";
import { Badge, Card, DemoBadge, EmptyState, ErrorState, Eyebrow, Loading, PageHeader, Stat } from "../components/ui";
import { POOL_STATUS, type PoolSummary } from "./SponsorDashboard";

type Impact = Awaited<ReturnType<typeof buildImpact>>;
const KIND: Record<string, string> = { create_pool: "Pool created", fund_pool: "Pool funded", allocate: "Rewards allocated", claim: "Reward claimed", close_pool: "Pool closed" };

export default function ImpactPage() {
  const q = useQuery({ queryKey: ["impact"], queryFn: () => api.get<Impact>("/api/impact") });
  const cfg = useChainConfig();
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const s = d.stats;

  return (
    <div className="grid gap-16">
      <PageHeader eyebrow="Impact ledger" title="The evidence behind every reward">
        Public by design. Seeded demo evidence and live activity are counted separately so you can tell which is which, and a transaction only appears here after the server has read its receipt from Monad Testnet.
      </PageHeader>

      <section aria-label="Evidence totals" className="grid gap-10 border-y border-line py-10 md:grid-cols-4">
        <Stat value={s.recommendations} label="Published recommendations" note={`${s.curators} curators`} />
        <Stat value={s.verifiedCheckins.live} label="Live verified check-ins" note={`${s.verifiedCheckins.seeded} more are seeded demo evidence`} />
        <Stat value={s.ratings.live} label="Live attendee ratings" note={`${s.ratings.seeded} seeded`} />
        <Stat value={s.confirmedTransactions} label="Receipt-verified transactions" note="Monad Testnet" />
      </section>

      <section aria-labelledby="board-h">
        <Eyebrow className="mb-2">Leaderboard</Eyebrow>
        <h2 id="board-h" className="mb-2 text-3xl">Highest scoring recommendations</h2>
        <p className="mb-6 max-w-2xl text-muted">Scores follow <span className="font-mono">{d.method.formulaVersion}</span>: 0.30 × quality + 0.25 × novelty + 0.45 × verified impact. Prototype proxies, illustrative until validated.</p>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Top recommendations by prototype score</caption>
            <thead className="bg-surface text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Recommendation</th>
                <th scope="col" className="px-4 py-3 font-medium">Category</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Check-ins</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Quality</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Novelty</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Impact</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody>
              {d.leaderboard.map((r) => (
                <tr key={r.slug} className="border-t border-line">
                  <th scope="row" className="px-4 py-3 font-normal">
                    <Link to={`/recommendations/${r.slug}`} className="hover:text-accent">{r.title}</Link>
                    <div className="text-muted">{r.curator}{r.isDemo && " · demo"}</div>
                  </th>
                  <td className="px-4 py-3 text-muted">{CATEGORY_LABELS[r.category] ?? r.category}</td>
                  <td className="tnum px-4 py-3 text-right">{r.verifiedCheckins}</td>
                  <td className="tnum px-4 py-3 text-right">{fmtScore(r.score.quality.value)}{r.score.quality.status === "provisional" && <span className="block text-xs text-warn">provisional</span>}</td>
                  <td className="tnum px-4 py-3 text-right">{fmtScore(r.score.novelty.value)}</td>
                  <td className="tnum px-4 py-3 text-right">{fmtScore(r.score.impact.value)}</td>
                  <td className="tnum px-4 py-3 text-right font-semibold">{fmtScore(r.score.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="pools-h">
        <Eyebrow className="mb-2">Reward pools</Eyebrow>
        <h2 id="pools-h" className="mb-6 text-3xl">Funding, allocation and claims</h2>
        {d.pools.length === 0 ? (
          <EmptyState title="No pools yet" />
        ) : (
          <ul className="grid gap-6">
            {d.pools.map((p) => {
              const st = POOL_STATUS[p.status as PoolSummary["status"]];
              return (
                <li key={p.id}>
                  <Card className="p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {p.isDemo && <DemoBadge />}
                        </div>
                        <h3 className="text-2xl"><Link to={`/pools/${p.id}`} className="hover:text-accent">{p.title}</Link></h3>
                        <p className="mt-1 text-sm text-muted">{p.eventTitle} · {p.sponsorName}</p>
                      </div>
                      <dl className="grid grid-cols-2 gap-6 text-sm">
                        <div><dt className="text-muted">Funded on-chain</dt><dd className="font-display text-xl"><Mon wei={p.fundedWei} /></dd></div>
                        <div><dt className="text-muted">Pool</dt><dd className="tnum font-display text-xl">{p.contractPoolId != null ? `#${p.contractPoolId}` : "not on-chain"}</dd></div>
                      </dl>
                    </div>
                    {p.allocations.length > 0 ? (
                      <div className="mt-6 overflow-x-auto">
                        <table className="w-full min-w-[640px] text-left text-sm">
                          <caption className="sr-only">Allocations for {p.title}</caption>
                          <thead className="text-muted">
                            <tr>
                              <th scope="col" className="py-2 pr-4 font-medium">Curator</th>
                              <th scope="col" className="py-2 pr-4 font-medium">For</th>
                              <th scope="col" className="py-2 pr-4 text-right font-medium">Score</th>
                              <th scope="col" className="py-2 pr-4 text-right font-medium">Allocated</th>
                              <th scope="col" className="py-2 font-medium">Claim</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.allocations.map((a) => (
                              <tr key={a.recommendation.slug + a.wallet} className="border-t border-line">
                                <td className="py-3 pr-4">{a.curatorName}<div className="font-mono text-xs text-muted"><a className="hover:text-accent" href={addrUrl(cfg.data, a.wallet)} target="_blank" rel="noreferrer">{a.wallet.slice(0, 8)}…{a.wallet.slice(-4)}</a></div></td>
                                <td className="py-3 pr-4"><Link to={`/recommendations/${a.recommendation.slug}`} className="hover:text-accent">{a.recommendation.title}</Link></td>
                                <td className="tnum py-3 pr-4 text-right">{fmtScore(a.scoreTotal)}</td>
                                <td className="py-3 pr-4 text-right"><Mon wei={a.amountWei} /></td>
                                <td className="py-3">{a.claimTx ? <span className="flex items-center gap-2"><Badge tone="ok">Claimed</Badge><TxLink hash={a.claimTx} /></span> : a.distributionStatus === "confirmed" ? <Badge tone="accent">Unclaimed</Badge> : <Badge tone="warn">Pending</Badge>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="mt-5 text-sm text-muted">Nothing allocated yet.</p>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="tx-h">
        <Eyebrow className="mb-2">Transactions</Eyebrow>
        <h2 id="tx-h" className="mb-6 text-3xl">Receipt-verified history</h2>
        {d.transactions.length === 0 ? (
          <EmptyState title="No verified transactions on this deployment yet">
            Seeded demo pools carry no fabricated hashes. Entries appear here after a pool is created, funded, allocated or claimed on Monad Testnet and the server has verified the receipt.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
            {d.transactions.map((t) => (
              <li key={`${t.txHash}-${t.kind}-${t.actor}`} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4 text-sm">
                <span className="min-w-36 font-medium">{KIND[t.kind] ?? t.kind}</span>
                <span className="text-muted">{t.poolTitle ?? ""}</span>
                {BigInt(t.amountWei) > 0n ? <Mon wei={t.amountWei} /> : <span />}
                <span className="text-muted">{fmtDateTime(t.createdAt)}</span>
                <TxLink hash={t.txHash} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="gates-h" className="grid gap-8 border-t border-line pt-12 md:grid-cols-2">
        <div>
          <Eyebrow className="mb-2">Abuse signals</Eyebrow>
          <h2 id="gates-h" className="text-3xl">What the gates have caught</h2>
          <p className="mt-3 text-muted">Rejections are logged, not hidden. They show the validation working, and a rising count would be a signal to investigate.</p>
        </div>
        <div>
          {s.rejectedAttempts.length === 0 && s.excludedSelfReferrals === 0 ? (
            <p className="text-muted">No rejected attempts recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {s.rejectedAttempts.map((r) => (
                <li key={r.reason} className="flex justify-between py-2.5"><span>Rejected check-in: <span className="font-mono">{r.reason}</span></span><span className="tnum font-semibold">{r.count}</span></li>
              ))}
              <li className="flex justify-between py-2.5"><span>Self-referral check-ins excluded from scoring</span><span className="tnum font-semibold">{s.excludedSelfReferrals}</span></li>
              <li className="flex justify-between py-2.5"><span>Check-ins made without a referral (not credited)</span><span className="tnum font-semibold">{s.unattributedCheckins}</span></li>
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
