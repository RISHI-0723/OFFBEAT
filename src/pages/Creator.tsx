import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ExternalLink, MapPin } from "lucide-react";
import type { CreatorDto, EventDto, RecommendationDto } from "../../server/services/data";
import { api } from "../lib/api";
import { CATEGORY_LABELS, fmtDate } from "../lib/format";
import { Artwork } from "../components/Artwork";
import { RecommendationCard } from "../components/recommendation";
import { Badge, Card, DemoBadge, EmptyState, ErrorState, Loading } from "../components/ui";

export default function Creator() {
  const { slug = "" } = useParams();
  const q = useQuery({ queryKey: ["creator", slug], queryFn: () => api.get<{ creator: CreatorDto; recommendations: RecommendationDto[]; events: EventDto[] }>(`/api/creators/${slug}`) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { creator, recommendations, events } = q.data!;

  return (
    <div className="grid gap-14">
      <header className="grid gap-8 md:grid-cols-[1fr_1.4fr] md:items-end">
        <Artwork seed={creator.artSeed} category={creator.category} label={`Generated artwork for ${creator.name}`} className="aspect-[5/4] rounded-[var(--radius-card)] border border-line" />
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone="accent">{CATEGORY_LABELS[creator.category] ?? creator.category}</Badge>
            {creator.isDemo && <DemoBadge label="Fictional demo creator" />}
          </div>
          <h1 className="text-5xl font-semibold leading-none sm:text-6xl">{creator.name}</h1>
          <p className="mt-5 max-w-xl text-lg text-muted">{creator.bio}</p>
          {creator.externalUrl && !creator.isDemo && (
            <a href={creator.externalUrl} target="_blank" rel="noreferrer noopener" className="mt-4 inline-flex items-center gap-2 text-sm text-accent hover:underline">
              Visit their page <ExternalLink className="size-4" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>
      </header>

      {events.length > 0 && (
        <section aria-labelledby="ev-h">
          <h2 id="ev-h" className="mb-5 text-3xl">Events</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {events.map((e) => (
              <li key={e.id}>
                <Card className="p-5">
                  <h3 className="text-xl"><Link to={`/events/${e.slug}`} className="hover:text-accent">{e.title}</Link></h3>
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                    <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden />{fmtDate(e.startsAt, { weekday: "short", day: "numeric", month: "short" })}</span>
                    <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden />{e.venue}</span>
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="rec-h">
        <h2 id="rec-h" className="mb-5 text-3xl">Recommendations</h2>
        {recommendations.length === 0 ? (
          <EmptyState title="No one has recommended them yet">Know their work? Be the first curator to explain why it matters.</EmptyState>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {recommendations.map((r) => (
              <li key={r.id}>
                <RecommendationCard rec={r} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
