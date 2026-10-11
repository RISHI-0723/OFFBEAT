import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Check, Copy } from "lucide-react";
import type { EventDto } from "../../server/services/data";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, ButtonLink, Card, EmptyState, ErrorState, Loading, Notice } from "../components/ui";

interface Issued {
  token: string;
  expiresAt: string;
  ttlSeconds: number;
}

/** Organiser's door screen: shows a QR that rotates before it expires. Each code is single-use. */
export default function Door() {
  const { slug = "" } = useParams();
  const { viewer, loading } = useSession();
  const ev = useQuery({
    queryKey: ["door-event", slug, viewer?.id ?? "anon"],
    queryFn: () => api.get<{ event: EventDto; checkinCounts: Record<string, number>; isOrganizer: boolean }>(`/api/events/${slug}`),
    refetchInterval: 5000,
  });
  const eventId = ev.data?.event.id;
  const isOrganizer = ev.data?.isOrganizer;

  // A fresh single-use code every 60s (codes live 90s), so a scanned code is never about to expire.
  const tokenQ = useQuery({
    queryKey: ["door-token", eventId],
    queryFn: () => api.post<Issued>(`/api/events/${eventId}/tokens`),
    enabled: Boolean(isOrganizer && eventId),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
  });
  const issued = tokenQ.data;
  const link = issued ? `${window.location.origin}/events/${slug}?t=${issued.token}` : "";
  const qrQ = useQuery({
    queryKey: ["door-qr", link],
    queryFn: () => QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: "#0B0B0F", light: "#F4F1F8" } }),
    enabled: Boolean(link),
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const secs = issued ? Math.max(0, Math.round((new Date(issued.expiresAt).getTime() - now) / 1000)) : 0;
  const [copied, setCopied] = useState(false);

  if (loading || ev.isLoading) return <Loading />;
  if (ev.isError) return <ErrorState error={ev.error} onRetry={() => void ev.refetch()} />;
  if (!viewer) return <EmptyState title="Sign in as the organiser" action={<ButtonLink to={`/signin?next=/events/${slug}/door`}>Sign in</ButtonLink>}>The door screen is only for the person running the event. In the demo, that is the “Harbourlight Arts Fund (demo)” persona.</EmptyState>;
  if (!isOrganizer)
    return (
      <EmptyState title="Only the organiser can open the door screen" action={<ButtonLink to={`/events/${slug}`} variant="secondary">Back to the event</ButtonLink>}>
        You are signed in as {viewer.display_name}. In the demo, sign in as “Harbourlight Arts Fund (demo)”.
      </EmptyState>
    );

  const e = ev.data!.event;
  const counts = ev.data!.checkinCounts;
  return (
    <div className="mx-auto grid max-w-3xl gap-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Door screen</p>
        <h1 className="mt-2 text-4xl font-semibold">{e.title}</h1>
        <p className="mt-3 text-muted">Show this to arriving guests. The code refreshes automatically and each code works exactly once.</p>
      </header>

      <Card className="grid gap-6 p-6 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="mx-auto grid size-64 place-items-center overflow-hidden rounded-[var(--radius-control)] bg-ink sm:size-72">
          {qrQ.data ? <img src={qrQ.data} alt="QR code containing a single-use check-in link" className="size-full" /> : <span className="text-bg">Preparing…</span>}
        </div>
        <div className="grid gap-4">
          <p className="text-sm text-muted">
            This code expires in <span className="tnum font-semibold text-ink">{secs}s</span> and is replaced before then.
          </p>
          <p className="break-all rounded-[var(--radius-control)] border border-line bg-bg p-3 font-mono text-xs" aria-label="Current door code">
            {issued?.token ?? "…"}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  window.prompt("Copy this check-in link:", link);
                }
              }}
              disabled={!issued}
            >
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy check-in link"}
            </Button>
            <Button variant="ghost" onClick={() => void tokenQ.refetch()} loading={tokenQ.isFetching}>
              New code now
            </Button>
          </div>
          <p className="text-xs text-muted">Testing alone? Copy the link and open it in a second browser or private window signed in as a different participant.</p>
        </div>
      </Card>
      {tokenQ.isError && <Notice tone="bad">{tokenQ.error instanceof Error ? tokenQ.error.message : "Could not issue a door code."}</Notice>}

      <Card className="p-6">
        <h2 className="text-2xl">Live check-ins</h2>
        <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <div><dt className="text-muted">Verified</dt><dd className="tnum font-display text-3xl">{counts["verified"] ?? 0}</dd></div>
          <div><dt className="text-muted">Self-referrals excluded</dt><dd className="tnum font-display text-3xl">{counts["excluded_self_referral"] ?? 0}</dd></div>
          <div><dt className="text-muted">Pending review</dt><dd className="tnum font-display text-3xl">{counts["pending_review"] ?? 0}</dd></div>
        </dl>
      </Card>
      <p className="text-sm"><Link className="text-accent hover:underline" to={`/events/${slug}`}>← Back to the event page</Link></p>
    </div>
  );
}
