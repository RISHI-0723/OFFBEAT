import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RecommendationDto } from "../../server/services/data";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { score as fmtScore } from "../lib/format";
import { useTxRunner } from "../lib/txRunner";
import { Mon, TxLink, TxStatus } from "../components/chain";
import { LinkWalletPanel, WalletGate } from "../components/wallet";
import { Badge, ButtonLink, Button, Card, EmptyState, ErrorState, Eyebrow, Loading, PageHeader, Stat } from "../components/ui";

interface Reward {
  itemId: string;
  amountWei: string;
  scoreTotal: number;
  wallet: string;
  distributionId: string;
  distributionStatus: string;
  poolId: string;
  poolTitle: string;
  contractPoolId: number | null;
  recommendation: { slug: string; title: string };
  claimTx: string | null;
  claimable: boolean;
}
interface Dash {
  wallet: string | null;
  chainEnabled: boolean;
  recommendations: RecommendationDto[];
  summary: { recommendations: number; verifiedCheckins: number; eligible: number; bestScore: number | null };
  rewards: Reward[];
  formula: { version: string; minVerifiedCheckins: number; impactCap: number; minRaters: number };
}

function ClaimRow({ r }: { r: Reward }) {
  const qc = useQueryClient();
  const tx = useTxRunner();
  const claim = () =>
    tx.run({
      label: `Claim ${r.recommendation.title}`,
      functionName: "claimReward",
      args: [BigInt(r.contractPoolId ?? 0)],
      record: async (hash) => {
        await api.post("/api/chain/record", { kind: "claim", txHash: hash });
        await qc.invalidateQueries();
      },
    });
  return (
    <li className="grid gap-4 border-b border-line py-5 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-display text-xl">{r.recommendation.title}</p>
          <p className="mt-1 text-sm text-muted">
            {r.poolTitle} · score <span className="tnum">{fmtScore(r.scoreTotal)}</span>
          </p>
        </div>
        <div className="text-right">
          <Mon wei={r.amountWei} className="font-display text-2xl" />
          <div className="mt-1">
            {r.claimTx ? <Badge tone="ok">Claimed</Badge> : r.distributionStatus === "confirmed" ? <Badge tone="accent">Ready to claim</Badge> : <Badge tone="warn">Awaiting on-chain confirmation</Badge>}
          </div>
        </div>
      </div>
      {r.claimTx && <p className="text-sm text-muted">Claim transaction: <TxLink hash={r.claimTx} /></p>}
      {r.claimable && (
        <div className="grid gap-3">
          <WalletGate expectAddress={r.wallet} why="Claiming sends the reward from the contract to the wallet it was allocated to.">
            <div>
              <Button onClick={claim} loading={tx.busy}>Claim <Mon wei={r.amountWei} className="font-semibold" /></Button>
            </div>
          </WalletGate>
          <TxStatus state={tx.state} />
        </div>
      )}
    </li>
  );
}

export default function CuratorDashboard() {
  const { viewer, loading } = useSession();
  const q = useQuery({ queryKey: ["curator-dash", viewer?.id], queryFn: () => api.get<Dash>("/api/me/curator"), enabled: viewer?.role === "curator" });

  if (loading) return <Loading />;
  if (!viewer) return <EmptyState title="Sign in to see your dashboard" action={<ButtonLink to="/signin?next=/dashboard/curator">Sign in</ButtonLink>}>Choose the “Noor Hadley” demo curator for a populated example.</EmptyState>;
  if (viewer.role !== "curator") return <EmptyState title="This dashboard is for curators" action={<ButtonLink to="/signin?next=/dashboard/curator" variant="secondary">Switch account</ButtonLink>}>You are signed in as a {viewer.role}.</EmptyState>;
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;

  return (
    <div className="grid gap-14">
      <PageHeader eyebrow="Curator dashboard" title={`${viewer.display_name}'s discoveries`} actions={<ButtonLink to="/recommendations/new">New recommendation</ButtonLink>}>
        Your reputation here is built from evidence: verified check-ins that came through your links, ratings from people who attended, and how few others had recommended the same creator first.
      </PageHeader>

      <section aria-label="Summary" className="grid grid-cols-2 gap-8 border-y border-line py-8 md:grid-cols-4">
        <Stat value={d.summary.recommendations} label="Recommendations" />
        <Stat value={d.summary.verifiedCheckins} label="Verified check-ins" note="through your referral links" />
        <Stat value={d.summary.eligible} label="Reward-eligible" note={`needs ≥ ${d.formula.minVerifiedCheckins} verified check-ins`} />
        <Stat value={d.summary.bestScore === null ? "–" : fmtScore(d.summary.bestScore)} label="Best score" note="out of 100, prototype" />
      </section>

      <LinkWalletPanel />

      <section aria-labelledby="recs-h">
        <Eyebrow className="mb-2">Score evidence</Eyebrow>
        <h2 id="recs-h" className="mb-6 text-3xl">Your recommendations</h2>
        {d.recommendations.length === 0 ? (
          <EmptyState title="You have not recommended anything yet" action={<ButtonLink to="/recommendations/new">Make your first recommendation</ButtonLink>}>Choose something you have actually experienced and explain why it matters.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">Your recommendations with their score components</caption>
              <thead className="bg-surface text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Recommendation</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Check-ins</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Quality</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Novelty</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Impact</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                  <th scope="col" className="px-4 py-3 font-medium">Reward status</th>
                </tr>
              </thead>
              <tbody>
                {d.recommendations.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <th scope="row" className="px-4 py-4 font-normal">
                      <Link to={`/recommendations/${r.slug}`} className="font-display text-lg hover:text-accent">{r.title}</Link>
                      <div className="mt-1 text-muted">{r.creator.name}{r.isDemo && " · demo"}{r.status !== "published" && ` · ${r.status.replace("_", " ")}`}</div>
                    </th>
                    <td className="tnum px-4 py-4 text-right">{r.stats.verifiedCheckins}</td>
                    <td className="tnum px-4 py-4 text-right">{fmtScore(r.score.quality.value)}{r.score.quality.status === "provisional" && <span className="block text-xs text-warn">provisional</span>}</td>
                    <td className="tnum px-4 py-4 text-right">{fmtScore(r.score.novelty.value)}<span className="block text-xs text-muted">proxy</span></td>
                    <td className="tnum px-4 py-4 text-right">{fmtScore(r.score.impact.value)}</td>
                    <td className="tnum px-4 py-4 text-right font-semibold">{fmtScore(r.score.total)}</td>
                    <td className="px-4 py-4">
                      {r.score.eligible ? <Badge tone="ok">Eligible</Badge> : <Badge tone="warn">Not yet</Badge>}
                      {r.score.ineligibleReason && <p className="mt-1.5 max-w-52 text-xs text-muted">{r.score.ineligibleReason}</p>}
                      {!d.wallet && r.score.eligible && <p className="mt-1.5 max-w-52 text-xs text-warn">Link a wallet to be payable.</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details className="mt-5 text-sm text-muted">
          <summary className="cursor-pointer font-medium text-ink">How scores are computed</summary>
          <div className="mt-3 grid gap-2">
            <p><strong className="text-ink">Quality (30%)</strong>: mean attendee rating mapped to 0–100, once ≥ {d.formula.minRaters} distinct raters have rated. Before that it is a neutral 50 and labelled provisional.</p>
            <p><strong className="text-ink">Novelty (25%)</strong>: higher when few others recommended this creator earlier and the category is less crowded. A prototype proxy, not a measure of cultural value.</p>
            <p><strong className="text-ink">Verified impact (45%)</strong>: unique verified check-ins through your link, capped at {d.formula.impactCap} so farming has diminishing returns. Your own check-ins never count.</p>
            <p>Everything is calculated on the server (<span className="font-mono">{d.formula.version}</span>). This page only displays it.</p>
          </div>
        </details>
      </section>

      <section aria-labelledby="rew-h">
        <Eyebrow className="mb-2">Rewards</Eyebrow>
        <h2 id="rew-h" className="mb-6 text-3xl">Reward history</h2>
        {d.rewards.length === 0 ? (
          <EmptyState title="No rewards allocated yet">When a sponsor approves a distribution for an event you recommended, it will appear here with its score evidence and claim button. Testnet MON only.</EmptyState>
        ) : (
          <Card className="px-6">
            <ul>
              {d.rewards.map((r) => (
                <ClaimRow key={r.itemId} r={r} />
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
