import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { addrUrl, useChainConfig } from "../lib/useChainConfig";
import { Badge, Card, Eyebrow, Notice, PageHeader } from "../components/ui";
import { PersonaPicker } from "./SignIn";

const live = [
  "Recommendations persist; referral codes are unique per recommendation; duplicates are rejected.",
  "Door codes are random, expire in ~90 seconds, work once and are stored hashed. Replayed, expired, invalid and duplicate check-ins are rejected by the server and logged.",
  "Scores and payouts are computed on the server with a deterministic formula, integer money maths and a per-curator cap. The client cannot influence them.",
  "A Solidity pool contract on Monad Testnet: create, fund, allocate (bounded by balance), claim (own balance only), close. 27 Foundry tests including a reentrancy attacker.",
  "Transactions appear in the ledger only after the OFFBEAT server reads the receipt and checks the events match what it expects.",
];
const seeded = [
  "All creators, events, venues and 12 “Seed attendee” profiles are fictional. Their check-ins and ratings are flagged as seeded and counted separately on the impact ledger.",
  "Artwork is generated from each creator's name; it is not a photograph of anyone.",
  "Demo sign-in has no passwords. Anyone can sign in as a demo persona, so it is not a security model.",
];
const limits = [
  "The pool manager (the sponsor wallet) is trusted. Scoring is off-chain; the contract does not verify scores, check-ins or identities. It only enforces bounds and ownership.",
  "A door code can be shared inside its 90-second window, and one person can make many accounts. Single-use codes, rate limits, one-per-event and caps reduce this; they do not eliminate it.",
  "Novelty is a simple proxy. Quality needs ≥ 3 attendee ratings, otherwise a neutral 50 is used and labelled provisional.",
  "Referral attribution is evidence of a recorded referral, never proof of causation.",
];

export default function Judge() {
  const cfg = useChainConfig();
  const c = cfg.data;
  return (
    <div className="grid gap-16">
      <PageHeader eyebrow="Judge guide" title="Try OFFBEAT in about three minutes">
        Everything below works without buying anything. Testnet MON is free from the faucet if you want to run the on-chain steps with your own wallet.
      </PageHeader>

      <section aria-labelledby="chain-h" className="grid gap-4">
        <h2 id="chain-h" className="text-3xl">Verify the chain facts yourself</h2>
        <Card className="grid gap-3 p-6 text-sm">
          <p><span className="text-muted">Network:</span> {c?.networkName ?? "Monad Testnet"} (chain ID <span className="tnum">{c?.chainId ?? 10143}</span>)</p>
          <p>
            <span className="text-muted">RewardPool contract:</span>{" "}
            {c?.contractAddress ? (
              <a className="break-all font-mono text-accent hover:underline" href={addrUrl(c, c.contractAddress)} target="_blank" rel="noreferrer">
                {c.contractAddress} <ExternalLink className="inline size-3.5" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <Badge tone="warn">Not deployed on this environment</Badge>
            )}
          </p>
          <p><span className="text-muted">Faucet:</span> <a className="text-accent hover:underline" href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">faucet.monad.xyz ↗</a></p>
          <p><span className="text-muted">All verified transactions:</span> <Link className="text-accent hover:underline" to="/impact">Impact ledger</Link></p>
        </Card>
      </section>

      <section aria-labelledby="path-h" className="grid gap-6">
        <div>
          <Eyebrow className="mb-2">Path A · 90 seconds · no wallet needed</Eyebrow>
          <h2 id="path-h" className="text-3xl">Read the finished story</h2>
        </div>
        <ol className="grid gap-3 text-muted">
          <li><strong className="text-ink">1.</strong> Open <Link className="text-accent hover:underline" to="/impact">the impact ledger</Link>: scores, check-in evidence, pools, and every transaction with a block-explorer link.</li>
          <li><strong className="text-ink">2.</strong> Open a recommendation from <Link className="text-accent hover:underline" to="/discover">Discover</Link> and read “How this was scored”.</li>
          <li><strong className="text-ink">3.</strong> Open a pool from the ledger to see the exact distribution preview and who was paid.</li>
        </ol>
      </section>

      <section aria-labelledby="pathb-h" className="grid gap-6">
        <div>
          <Eyebrow className="mb-2">Path B · about 3 minutes · two browser windows</Eyebrow>
          <h2 id="pathb-h" className="text-3xl">Run the full loop yourself</h2>
        </div>
        <ol className="grid gap-4 text-muted">
          <li><strong className="text-ink">1. Curator.</strong> Sign in as <em>Teo Marchetti</em> below (or create a guest curator) and open “Recommend”. Publish a recommendation for an event and copy its referral link.</li>
          <li><strong className="text-ink">2. Door.</strong> In a second window sign in as <em>Harbourlight Arts Fund (demo)</em> and open the event&apos;s <strong>door screen</strong> (event page → Open door screen). Click <em>Copy check-in link</em>.</li>
          <li><strong className="text-ink">3. Participant.</strong> In a third private window open your referral link first (it remembers the code), then paste the check-in link, sign in as <em>Sam Okafor (demo attendee)</em> and check in. The recommendation&apos;s check-in count rises by one. Try the same link again to see the replay rejection.</li>
          <li><strong className="text-ink">4. Sponsor.</strong> Create a guest <em>sponsor</em> account, connect your wallet, create a pool for that event, create and fund it on-chain, approve the distribution and submit the allocation.</li>
          <li><strong className="text-ink">5. Claim.</strong> As a guest curator with your wallet linked, your reward shows on your dashboard with a Claim button.</li>
        </ol>
        <Notice title="Why a guest sponsor?">The pool manager on-chain is the wallet that created the pool, so you need your own wallet to be the sponsor. The seeded demo pools were settled with throwaway test wallets and are viewable on the ledger.</Notice>
      </section>

      <section aria-labelledby="persona-h" className="grid gap-4">
        <h2 id="persona-h" className="text-3xl">One-click demo personas</h2>
        <PersonaPicker compact />
      </section>

      <section aria-labelledby="honest-h" className="grid gap-10 border-t border-line pt-12 lg:grid-cols-3">
        <div>
          <h2 id="honest-h" className="mb-4 text-2xl">Live and verified</h2>
          <ul className="grid gap-3 text-sm text-muted">{live.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div>
          <h2 className="mb-4 text-2xl">Seeded or simulated</h2>
          <ul className="grid gap-3 text-sm text-muted">{seeded.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div>
          <h2 className="mb-4 text-2xl">Known limitations</h2>
          <ul className="grid gap-3 text-sm text-muted">{limits.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </section>
    </div>
  );
}
