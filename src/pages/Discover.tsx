import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { RecommendationDto } from "../../server/services/data";
import { api } from "../lib/api";
import { CATEGORY_LABELS } from "../lib/format";
import { RecommendationCard } from "../components/recommendation";
import { ButtonLink, EmptyState, ErrorState, PageHeader, Skeleton, cx } from "../components/ui";

export default function Discover() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);

  useEffect(() => {
    const t = setTimeout(() => {
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (text) n.set("q", text);
          else n.delete("q");
          return n;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [text, setParams]);

  const feed = useQuery({
    queryKey: ["feed", category, q],
    queryFn: () => api.get<{ items: RecommendationDto[]; categories: string[] }>(`/api/feed?${new URLSearchParams({ ...(category && { category }), ...(q && { q }) })}`),
  });
  const cats = feed.data?.categories ?? Object.keys(CATEGORY_LABELS);

  const setCategory = (c: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (c) n.set("category", c);
      else n.delete("category");
      return n;
    });

  return (
    <div>
      <PageHeader eyebrow="Discover" title="Recommendations worth following" actions={<ButtonLink to="/recommendations/new">Recommend something</ButtonLink>}>
        Ranked by what they achieved, not how loud they were. Every score opens into the evidence behind it.
      </PageHeader>

      <div className="mb-8 grid gap-4">
        <div className="relative max-w-md">
          <label htmlFor="search" className="sr-only">
            Search recommendations
          </label>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input id="search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search creators, titles, reasons…" className="w-full rounded-[var(--radius-control)] border border-line bg-bg py-3 pl-11 pr-4 placeholder:text-muted/70 focus-visible:border-accent" />
        </div>
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
          {["", ...cats].map((c) => (
            <button key={c || "all"} aria-pressed={category === c} onClick={() => setCategory(c)} className={cx("min-h-10 rounded-full border px-4 text-sm font-medium transition-colors", category === c ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:border-accent/50 hover:text-ink")}>
              {c ? (CATEGORY_LABELS[c] ?? c) : "All"}
            </button>
          ))}
        </div>
      </div>

      <div aria-live="polite">
        {feed.isLoading && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-96" />
            ))}
          </div>
        )}
        {feed.isError && <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />}
        {feed.data && feed.data.items.length === 0 && (
          <EmptyState title="Nothing matches yet" action={<ButtonLink to="/recommendations/new">Be the first to recommend</ButtonLink>}>
            Try a different category or search. If you know something this city is missing, that is exactly what OFFBEAT is for.
          </EmptyState>
        )}
        {feed.data && feed.data.items.length > 0 && (
          <>
            <p className="sr-only">{feed.data.items.length} recommendations</p>
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {feed.data.items.map((r) => (
                <li key={r.id}>
                  <RecommendationCard rec={r} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
