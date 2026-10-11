import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Copy, ExternalLink, MapPin, Star } from "lucide-react";
import type { RecommendationDto } from "../../server/services/data";
import { api, ApiError } from "../lib/api";
import { CATEGORY_LABELS, fmtDate } from "../lib/format";
import { rememberReferral } from "../lib/referral";
import { useSession } from "../lib/session";
import { Artwork } from "../components/Artwork";
import { ScoreBreakdown } from "../components/recommendation";
import { Badge, Button, Card, DemoBadge, ErrorState, Loading, Notice, cx } from "../components/ui";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      className="min-h-10"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          window.prompt("Copy this link:", text);
        }
      }}
    >
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {done ? "Copied" : label}
    </Button>
  );
}

function RatePanel({ rec }: { rec: RecommendationDto }) {
  const { viewer } = useSession();
  const qc = useQueryClient();
  const [hover, setHover] = useState(0);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!rec.event) return null;
  const isCurator = viewer?.id === rec.curator.id;

  const rate = async (stars: number) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/api/recommendations/${rec.id}/ratings`, { stars });
      await qc.invalidateQueries({ queryKey: ["recommendation", rec.slug] });
      setMsg({ tone: "ok", text: `Thanks. Your ${stars}-star rating was recorded.` });
    } catch (e) {
      setMsg({ tone: "warn", text: e instanceof ApiError ? e.message : "Could not save the rating." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <h3 className="text-xl">Rate this recommendation</h3>
      <p className="mt-1 text-sm text-muted">Only people who checked in to the event can rate, and curators cannot rate their own work. That keeps the quality score tied to real attendance.</p>
      {!viewer ? (
        <p className="mt-3 text-sm">
          <Link className="text-accent underline" to={`/signin?next=/recommendations/${rec.slug}`}>Sign in</Link> to rate.
        </p>
      ) : isCurator ? (
        <p className="mt-3 text-sm text-muted">This is your recommendation, so you cannot rate it.</p>
      ) : (
        <div className="mt-4 flex items-center gap-1" role="group" aria-label="Star rating" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} disabled={busy} onMouseEnter={() => setHover(n)} onClick={() => void rate(n)} aria-label={`${n} star${n > 1 ? "s" : ""}`} className="grid size-11 place-items-center rounded-[var(--radius-control)] hover:bg-raised">
              <Star className={cx("size-6", n <= hover ? "fill-accent text-accent" : "text-muted")} aria-hidden />
            </button>
          ))}
        </div>
      )}
      {msg && <p role="status" className={cx("mt-3 text-sm", msg.tone === "ok" ? "text-ok" : "text-warn")}>{msg.text}</p>}
    </Card>
  );
}

export default function RecommendationDetail() {
  const { slug = "" } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const justPublished = (loc.state as { justPublished?: boolean } | null)?.justPublished;
  const q = useQuery({ queryKey: ["recommendation", slug], queryFn: () => api.get<RecommendationDto>(`/api/recommendations/${slug}`) });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const rec = q.data!;
  const referralUrl = `${window.location.origin}/r/${rec.referralCode}`;

  const follow = () => {
    if (!rec.event) return;
    rememberReferral(rec.event.slug, rec.referralCode);
    nav(`/events/${rec.event.slug}?ref=${rec.referralCode}`);
  };

  return (
    <article className="grid gap-12 lg:grid-cols-[1fr_1.1fr]">
      <div className="lg:sticky lg:top-24 lg:self-start">
        <Artwork seed={rec.creator.artSeed} category={rec.creator.category} label={`Generated artwork for ${rec.creator.name}`} className="aspect-[4/5] rounded-[var(--radius-card)] border border-line" />
        {rec.isDemo && <p className="mt-3 text-xs text-muted">Artwork is generated for this demo; creator, venue and people are fictional.</p>}
      </div>

      <div className="grid gap-8">
        {justPublished && <Notice tone="ok" title="Published">Your recommendation is live. Share the referral link below; check-ins that arrive through it are credited to you.</Notice>}
        <header>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone="accent">{CATEGORY_LABELS[rec.creator.category] ?? rec.creator.category}</Badge>
            {rec.isDemo && <DemoBadge />}
            {rec.status !== "published" && <Badge tone="warn">{rec.status.replace("_", " ")}</Badge>}
          </div>
          <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl">{rec.title}</h1>
          <p className="mt-4 text-muted">
            <Link className="text-ink underline decoration-line underline-offset-4 hover:decoration-accent" to={`/creators/${rec.creator.slug}`}>
              {rec.creator.name}
            </Link>{" "}
            · recommended by <strong className="text-ink">{rec.curator.displayName}</strong> on {fmtDate(rec.createdAt)}
          </p>
        </header>

        <blockquote className="border-l-2 border-accent pl-5 font-display text-xl leading-relaxed sm:text-2xl">“{rec.reason}”</blockquote>

        {rec.sourceUrl && (
          <a href={rec.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex w-fit items-center gap-2 text-sm text-accent hover:underline">
            Learn more about {rec.creator.name} <ExternalLink className="size-4" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}

        {rec.event ? (
          <Card className="p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Go and see for yourself</p>
            <h2 className="mt-2 text-2xl">{rec.event.title}</h2>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden />{fmtDate(rec.event.startsAt, { weekday: "short", day: "numeric", month: "short" })}</span>
              <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden />{rec.event.venue}</span>
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={follow}>Follow this recommendation to the event</Button>
              <CopyButton text={referralUrl} label="Copy referral link" />
            </div>
            <p className="mt-4 text-sm text-muted">
              Opening the referral link remembers <span className="font-mono text-ink">{rec.referralCode}</span> in your browser. When you check in at the door, that code is submitted so {rec.curator.displayName} is credited. It is evidence of a referral, not proof it caused you to attend.
            </p>
          </Card>
        ) : (
          <Notice title="No event attached">This recommendation is pure discovery. Without an event it cannot earn verified check-ins, be rated, or be rewarded.</Notice>
        )}

        <Card className="p-6">
          <h2 className="text-2xl">How this was scored</h2>
          <p className="mb-5 mt-1 text-sm text-muted">{rec.stats.verifiedCheckins} verified check-in{rec.stats.verifiedCheckins === 1 ? "" : "s"} · {rec.stats.raters} rating{rec.stats.raters === 1 ? "" : "s"}{rec.stats.averageStars ? ` (avg ${rec.stats.averageStars}/5)` : ""}</p>
          <ScoreBreakdown score={rec.score} />
        </Card>

        <RatePanel rec={rec} />
      </div>
    </article>
  );
}
