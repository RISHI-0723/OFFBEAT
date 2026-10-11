import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, MapPin, QrCode } from "lucide-react";
import type { EventDto, RecommendationDto } from "../../server/services/data";
import type { CheckinOutcome } from "../../server/services/checkin";
import { api, ApiError } from "../lib/api";
import { fmtDate } from "../lib/format";
import { recallReferral, rememberReferral } from "../lib/referral";
import { useSession } from "../lib/session";
import { Artwork } from "../components/Artwork";
import { RecommendationCard } from "../components/recommendation";
import { Badge, Button, ButtonLink, Card, DemoBadge, EmptyState, ErrorState, Loading, Notice, TextField } from "../components/ui";

interface EventPayload {
  event: EventDto;
  recommendations: RecommendationDto[];
  checkinWindow: "open" | "closed" | "not_open";
  checkinCounts: Record<string, number>;
  myCheckin: { status: string } | null;
  isOrganizer: boolean;
}

const REJECTION_HELP: Record<string, string> = {
  token_used: "Each door code works once. Ask the organiser for the current code.",
  token_expired: "Door codes expire after about 90 seconds. Scan the QR code again.",
  invalid_token: "That code is not valid for this event. Check you are on the right event page.",
  duplicate_checkin: "One check-in per person per event.",
};

function CheckinPanel({ data }: { data: EventPayload }) {
  const { viewer } = useSession();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const loc = useLocation();
  const slug = data.event.slug;
  const urlRef = params.get("ref") ?? "";
  const [token, setToken] = useState(params.get("t") ?? "");
  const [ref, setRef] = useState((urlRef || recallReferral(slug)).toUpperCase());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckinOutcome | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  useEffect(() => {
    if (urlRef) rememberReferral(slug, urlRef);
  }, [urlRef, slug]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setResult(await api.post<CheckinOutcome>("/api/checkins", { eventId: data.event.id, token: token.trim(), referralCode: ref.trim() || undefined }));
      await qc.invalidateQueries();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError("Check-in failed.", 0));
    } finally {
      setBusy(false);
    }
  };

  const here = `${loc.pathname}${loc.search}`;
  let body;
  if (result) {
    body = (
      <Notice tone={result.status === "verified" ? "ok" : "warn"} title={result.status === "verified" ? "You are checked in" : "Checked in, but not counted for that recommendation"}>
        {result.note}
        {result.attribution && (
          <>
            {" "}
            <Link className="text-accent underline" to={`/recommendations/${result.attribution.recommendationSlug}`}>View “{result.attribution.title}”</Link>, now with one more verified check-in.
          </>
        )}
      </Notice>
    );
  } else if (data.isOrganizer) {
    body = (
      <div className="grid gap-4">
        <Notice title="You run this door">Organisers cannot check in to their own event. Open the door screen to show attendees a fresh QR code.</Notice>
        <div><ButtonLink to={`/events/${slug}/door`}><QrCode className="size-4" aria-hidden /> Open door screen</ButtonLink></div>
      </div>
    );
  } else if (data.myCheckin) {
    body = <Notice tone="ok" title="You have already checked in">{data.myCheckin.status === "verified" ? "Your check-in is verified." : "Your check-in was recorded but did not count toward a recommendation."}</Notice>;
  } else if (data.checkinWindow !== "open") {
    body = <Notice tone="warn" title={data.checkinWindow === "closed" ? "Check-in has closed" : "Check-in is not open yet"}>Check-in is only available during the event&apos;s window.</Notice>;
  } else if (!viewer) {
    body = (
      <div className="grid gap-4">
        <Notice title="Sign in to check in">Check-ins are tied to one account per event, so we need to know who you are. Your referral code is kept.</Notice>
        <div><ButtonLink to={`/signin?next=${encodeURIComponent(here)}`}>Sign in to continue</ButtonLink></div>
      </div>
    );
  } else {
    body = (
      <form onSubmit={submit} className="grid gap-5" noValidate>
        <TextField label="Door code" value={token} onChange={(e) => setToken(e.target.value)} required autoComplete="off" spellCheck={false} className="font-mono" hint="Scan the organiser's QR code, or paste the code shown on the door screen. Codes work once and expire in about 90 seconds." />
        <TextField label="Referral code (optional)" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} maxLength={8} autoComplete="off" spellCheck={false} hint={ref ? "This credits the curator whose link brought you here." : "Filled automatically if you arrived through a curator's link."} />
        {err && (
          <Notice tone="bad" title={err.message}>
            {err.code && REJECTION_HELP[err.code]}
          </Notice>
        )}
        <div>
          <Button type="submit" loading={busy} disabled={!token.trim()}>
            Check in
          </Button>
        </div>
      </form>
    );
  }

  return (
    <Card className="p-6" as="section">
      <h2 className="text-2xl">Check in</h2>
      <p className="mb-5 mt-1 text-sm text-muted">Proof of Discovery: a verified check-in made through a curator&apos;s link is the evidence behind their score.</p>
      {body}
      <details className="mt-6 text-sm text-muted">
        <summary className="cursor-pointer font-medium text-ink">How is this validated?</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>The door code is random, expires in ~90 seconds, works once, and only its hash is stored.</li>
          <li>The server, not your browser, decides if a check-in is valid. A database rule allows one check-in per person per event.</li>
          <li>You cannot earn credit for your own recommendation.</li>
          <li>Limits: a code can be shared inside its short window, and one person can make several accounts. Rate limits and caps reduce this but do not eliminate it.</li>
        </ul>
      </details>
    </Card>
  );
}

export default function EventPage() {
  const { slug = "" } = useParams();
  const { viewer } = useSession();
  const q = useQuery({ queryKey: ["event", slug, viewer?.id ?? "anon"], queryFn: () => api.get<EventPayload>(`/api/events/${slug}`) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const e = d.event;
  const verified = d.checkinCounts["verified"] ?? 0;

  return (
    <div className="grid gap-14">
      <header className="grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-end">
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone={d.checkinWindow === "open" ? "ok" : "warn"}>Check-in {d.checkinWindow === "open" ? "open" : d.checkinWindow === "closed" ? "closed" : "not open"}</Badge>
            {e.isDemo && <DemoBadge label="Fictional demo event" />}
          </div>
          <h1 className="text-4xl font-semibold leading-[1.05] sm:text-6xl">{e.title}</h1>
          <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-muted">
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden />{fmtDate(e.startsAt, { weekday: "long", day: "numeric", month: "long" })}</span>
            <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden />{e.venue}, {e.city}</span>
          </p>
          <p className="mt-5 max-w-xl text-lg text-muted">{e.description}</p>
          <p className="mt-4 text-sm text-muted">
            By <Link className="text-ink underline decoration-line underline-offset-4 hover:decoration-accent" to={`/creators/${e.creator.slug}`}>{e.creator.name}</Link> · <span className="tnum">{verified}</span> verified check-in{verified === 1 ? "" : "s"} so far
          </p>
        </div>
        <Artwork seed={e.creator.artSeed} category={e.creator.category} label={`Generated artwork for ${e.creator.name}`} className="aspect-[5/4] rounded-[var(--radius-card)] border border-line" />
      </header>

      <CheckinPanel data={d} />

      <section aria-labelledby="recs-h">
        <h2 id="recs-h" className="mb-2 text-3xl">Recommended by</h2>
        <p className="mb-6 text-muted">Every check-in made through one of these links is credited to its curator.</p>
        {d.recommendations.length === 0 ? (
          <EmptyState title="No recommendations for this event yet" action={<ButtonLink to="/recommendations/new">Recommend it</ButtonLink>}>Curators who send people here will earn credit for verified check-ins.</EmptyState>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {d.recommendations.map((r) => (
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
