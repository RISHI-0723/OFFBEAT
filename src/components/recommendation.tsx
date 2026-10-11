import { Link } from "react-router-dom";
import { ArrowUpRight, Users } from "lucide-react";
import type { RecommendationDto } from "../../server/services/data";
import type { ScoreResult, ComponentScore } from "../../shared/scoring";
import { CATEGORY_LABELS, score as fmtScore } from "../lib/format";
import { Artwork } from "./Artwork";
import { Badge, DemoBadge, cx } from "./ui";

const statusTone = { measured: "ok", provisional: "warn", "prototype-proxy": "neutral" } as const;
const statusText = { measured: "Measured", provisional: "Provisional", "prototype-proxy": "Prototype proxy" } as const;

function Bar({ name, weight, c }: { name: string; weight: string; c: ComponentScore }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">
          {name} <span className="text-xs font-normal text-muted">× {weight}</span>
        </p>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone[c.status]}>{statusText[c.status]}</Badge>
          <span className="tnum w-12 text-right text-sm font-semibold">{fmtScore(c.value)}</span>
        </div>
      </div>
      <div role="meter" aria-label={`${name} score`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.value} className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-accent" style={{ width: `${c.value}%` }} />
      </div>
      <p className="mt-1.5 text-sm text-muted">{c.explanation}</p>
    </div>
  );
}

export function ScoreBreakdown({ score, className }: { score: ScoreResult; className?: string }) {
  return (
    <div className={cx("grid gap-5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="tnum font-display text-5xl font-semibold leading-none">{fmtScore(score.total)}</p>
          <p className="mt-1 text-sm text-muted">of 100 · prototype score, computed on the server</p>
        </div>
        {score.eligible ? <Badge tone="ok">Reward-eligible</Badge> : <Badge tone="warn">Not yet eligible</Badge>}
      </div>
      {!score.eligible && score.ineligibleReason && <p className="text-sm text-muted">{score.ineligibleReason}</p>}
      <Bar name="Quality" weight="0.30" c={score.quality} />
      <Bar name="Novelty" weight="0.25" c={score.novelty} />
      <Bar name="Verified impact" weight="0.45" c={score.impact} />
      <p className="text-xs text-muted">
        Formula <span className="font-mono">{score.formulaVersion}</span>: 0.30 × quality + 0.25 × novelty + 0.45 × verified impact. Illustrative until validated with real users. A referral record is evidence of a recorded action, not proof that the recommendation caused it.
      </p>
    </div>
  );
}

export function RecommendationCard({ rec, feature = false }: { rec: RecommendationDto; feature?: boolean }) {
  return (
    <article className={cx("group relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface transition-colors hover:border-accent/60", feature && "grid md:grid-cols-[1.1fr_1fr]")}>
      <Artwork seed={rec.creator.artSeed} category={rec.creator.category} label={`Generated artwork for ${rec.creator.name}`} className={cx(feature ? "min-h-72 md:min-h-[26rem]" : "aspect-[5/4]")} />
      <div className={cx("flex flex-col gap-3 p-5", feature && "justify-center p-8")}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{CATEGORY_LABELS[rec.creator.category] ?? rec.creator.category}</Badge>
          {rec.isDemo && <DemoBadge />}
        </div>
        <h3 className={cx("leading-tight", feature ? "text-3xl sm:text-4xl" : "text-2xl")}>
          <Link to={`/recommendations/${rec.slug}`} className="after:absolute after:inset-0 focus-visible:after:rounded-[var(--radius-card)]">
            {rec.title}
          </Link>
        </h3>
        <p className="text-sm text-muted">
          <span className="text-ink">{rec.creator.name}</span> · recommended by {rec.curator.displayName}
        </p>
        <p className={cx("text-muted", feature ? "line-clamp-5" : "line-clamp-3 text-sm")}>“{rec.reason}”</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2 text-sm">
          <span className="inline-flex items-center gap-1.5" title="Verified check-ins attributed to this recommendation (a recorded referral, not proof of causation)">
            <Users className="size-4 text-accent" aria-hidden />
            <span className="tnum font-semibold">{rec.stats.verifiedCheckins}</span> verified {rec.stats.verifiedCheckins === 1 ? "check-in" : "check-ins"}
          </span>
          <span className="tnum text-muted">
            Score <span className="font-semibold text-ink">{fmtScore(rec.score.total)}</span>
          </span>
          <ArrowUpRight className="size-4 text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
        </div>
      </div>
    </article>
  );
}
