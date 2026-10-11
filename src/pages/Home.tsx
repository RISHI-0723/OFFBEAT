import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { RecommendationDto } from "../../server/services/data";
import { api } from "../lib/api";
import { RecommendationCard } from "../components/recommendation";
import { ButtonLink, ErrorState, Eyebrow, Skeleton } from "../components/ui";

const steps = [
  { n: "01", title: "Recommend", body: "A curator explains why an overlooked artist or event deserves attention, and gets a personal referral link." },
  { n: "02", title: "Follow", body: "Someone opens that link and is taken to the event. OFFBEAT remembers which recommendation led them there." },
  { n: "03", title: "Check in", body: "At the door they scan a short-lived, single-use code. The server validates it; duplicates and replays are rejected." },
  { n: "04", title: "Score", body: "Quality, novelty and verified impact become one explainable score, computed on the server from recorded evidence." },
  { n: "05", title: "Settle", body: "A sponsor funds a pool, approves a bounded distribution, and curators claim on Monad Testnet. Every transaction is public." },
];

export default function Home() {
  const feed = useQuery({ queryKey: ["feed", "", ""], queryFn: () => api.get<{ items: RecommendationDto[] }>("/api/feed") });
  const items = feed.data?.items ?? [];
  const featured = [...items].sort((a, b) => b.score.total - a.score.total)[0];
  const latest = items.filter((i) => i.id !== featured?.id).slice(0, 6);

  return (
    <div className="grid gap-24">
      <section aria-labelledby="hero-h" className="enter grid gap-10 lg:grid-cols-[1.25fr_1fr] lg:items-end">
        <div>
          <Eyebrow className="mb-5">Independent culture · Monad Testnet prototype</Eyebrow>
          <h1 id="hero-h" className="text-5xl font-semibold leading-[0.98] sm:text-6xl lg:text-[5.5rem]">
            Discover <em className="font-medium text-accent">differently.</em>
            <br />
            Reward discovery.
          </h1>
          <p className="mt-7 max-w-xl text-lg text-muted">
            Most platforms pay for popularity. OFFBEAT pays the people whose recommendations genuinely bring audiences to independent artists and small cultural events, and shows its working at every step.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink to="/discover">Explore discoveries</ButtonLink>
            <ButtonLink to="/judge" variant="secondary">
              Walk through the demo
            </ButtonLink>
          </div>
        </div>
        <aside className="enter enter-2 border-l border-line pl-6 text-sm text-muted">
          <p className="font-display text-2xl text-ink">A referral is evidence, not proof.</p>
          <p className="mt-3">
            A verified check-in tells us a person followed a recommendation and attended. It cannot prove the recommendation caused it. OFFBEAT records the evidence, caps its influence, and says so wherever a score appears.
          </p>
        </aside>
      </section>

      <section aria-labelledby="feat-h" className="enter enter-3">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <Eyebrow className="mb-2">Highest scoring right now</Eyebrow>
            <h2 id="feat-h" className="text-3xl sm:text-4xl">The discovery doing the most work</h2>
          </div>
        </div>
        {feed.isLoading && <Skeleton className="h-96" />}
        {feed.isError && <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />}
        {featured && <RecommendationCard rec={featured} feature />}
      </section>

      <section aria-labelledby="how-h">
        <Eyebrow className="mb-2">How it works</Eyebrow>
        <h2 id="how-h" className="max-w-2xl text-3xl sm:text-4xl">From a recommendation to a settled reward, in five visible steps</h2>
        <ol className="mt-10 grid gap-0 border-t border-line md:grid-cols-5">
          {steps.map((s) => (
            <li key={s.n} className="border-b border-line py-6 md:border-b-0 md:border-r md:px-5 md:first:pl-0 md:last:border-r-0">
              <p className="tnum font-display text-4xl text-accent/80">{s.n}</p>
              <h3 className="mt-3 text-xl">{s.title}</h3>
              <p className="mt-2 text-sm text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="latest-h">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 id="latest-h" className="text-3xl sm:text-4xl">Fresh from our curators</h2>
          <Link to="/discover" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            See all <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        {feed.isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-96" />
            ))}
          </div>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {latest.map((r) => (
              <li key={r.id}>
                <RecommendationCard rec={r} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="honest-h" className="grid gap-10 border-t border-line pt-14 md:grid-cols-2">
        <div>
          <Eyebrow className="mb-2">Straight talk</Eyebrow>
          <h2 id="honest-h" className="text-3xl sm:text-4xl">What this prototype does and does not claim</h2>
        </div>
        <ul className="grid gap-4 text-muted">
          <li><strong className="text-ink">Scores are prototype proxies.</strong> Quality, novelty and impact use simple, published rules. They are illustrative until validated with real users.</li>
          <li><strong className="text-ink">The sponsor is trusted.</strong> Scoring happens off-chain; the contract only guarantees that payouts never exceed the funded pool and can only be claimed by the allocated wallet. It is not a decentralised judge.</li>
          <li><strong className="text-ink">Check-ins reduce abuse; they do not end it.</strong> A QR can be shared and one person can make several accounts. Single-use codes, rate limits and caps limit the damage.</li>
          <li><strong className="text-ink">Testnet only.</strong> MON here has no monetary value. Seeded creators and attendees are fictional and always labelled.</li>
        </ul>
      </section>
    </div>
  );
}
