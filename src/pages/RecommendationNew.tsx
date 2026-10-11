import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreatorDto, EventDto, RecommendationDto } from "../../server/services/data";
import { api, ApiError } from "../lib/api";
import { CATEGORY_LABELS } from "../lib/format";
import { useSession } from "../lib/session";
import { Button, ButtonLink, Card, EmptyState, ErrorState, Loading, Notice, PageHeader, SelectField, TextArea, TextField, cx } from "../components/ui";

export default function RecommendationNew() {
  const { viewer, loading } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const creators = useQuery({ queryKey: ["creators"], queryFn: () => api.get<CreatorDto[]>("/api/creators") });
  const events = useQuery({ queryKey: ["events"], queryFn: () => api.get<EventDto[]>("/api/events") });

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [creatorId, setCreatorId] = useState("");
  const [eventId, setEventId] = useState("");
  const [newCreator, setNewCreator] = useState({ name: "", category: "music", bio: "", externalUrl: "" });
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const creatorEvents = useMemo(() => (mode === "existing" ? (events.data ?? []).filter((e) => e.creator.id === creatorId) : []), [events.data, creatorId, mode]);

  if (loading) return <Loading />;
  if (!viewer)
    return (
      <EmptyState title="Sign in as a curator to recommend" action={<ButtonLink to="/signin?next=/recommendations/new">Sign in</ButtonLink>}>
        Recommendations are attributed to a curator so that rewards can reach the right person.
      </EmptyState>
    );
  if (viewer.role !== "curator")
    return (
      <EmptyState title="Only curators can recommend" action={<ButtonLink to="/signin?next=/recommendations/new" variant="secondary">Switch account</ButtonLink>}>
        You are signed in as a {viewer.role}. Create or choose a curator account to submit.
      </EmptyState>
    );

  const validate = () => {
    const e: Record<string, string> = {};
    if (title.trim().length < 4) e.title = "Give it a title of at least 4 characters.";
    if (reason.trim().length < 40) e.reason = `Explain why it matters in at least 40 characters (${reason.trim().length} so far).`;
    if (sourceUrl && !/^https?:\/\/\S+\.\S+/.test(sourceUrl)) e.sourceUrl = "Use a full link starting with http:// or https://";
    if (mode === "existing" && !creatorId) e.creator = "Choose a creator, or switch to adding a new one.";
    if (mode === "new") {
      if (newCreator.name.trim().length < 2) e.creatorName = "Enter the creator's name.";
      if (newCreator.bio.trim().length < 10) e.creatorBio = "Add a short bio (at least 10 characters).";
      if (newCreator.externalUrl && !/^https?:\/\/\S+\.\S+/.test(newCreator.externalUrl)) e.creatorUrl = "Use a full link starting with http:// or https://";
    }
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length) {
      document.getElementById("form-summary")?.focus();
      return;
    }
    setBusy(true);
    try {
      const rec = await api.post<RecommendationDto>("/api/recommendations", {
        title,
        reason,
        sourceUrl: sourceUrl || undefined,
        eventId: eventId || undefined,
        creator: mode === "existing" ? { existingId: creatorId } : { name: newCreator.name, category: newCreator.category, bio: newCreator.bio, externalUrl: newCreator.externalUrl || undefined },
      });
      await qc.invalidateQueries();
      nav(`/recommendations/${rec.slug}`, { state: { justPublished: true } });
    } catch (err) {
      const a = err instanceof ApiError ? err : null;
      setFormError(a?.message ?? "Could not publish. Please try again.");
      if (a?.fields) setErrors(Object.fromEntries(Object.entries(a.fields).map(([k, v]) => [k === "creator.name" ? "creatorName" : k === "creator.bio" ? "creatorBio" : k, v])));
      document.getElementById("form-summary")?.focus();
    } finally {
      setBusy(false);
    }
  };

  if (creators.isLoading || events.isLoading) return <Loading />;
  if (creators.isError) return <ErrorState error={creators.error} onRetry={() => void creators.refetch()} />;

  return (
    <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <PageHeader eyebrow="Recommend" title="Tell people why this deserves attention">
          Be specific. A good recommendation names what you experienced and why it was worth the trip. Scores later reward recommendations that actually bring people to a real event.
        </PageHeader>
        <form onSubmit={submit} noValidate className="grid gap-8">
          <div id="form-summary" tabIndex={-1} className="outline-none">
            {(formError || Object.keys(errors).length > 0) && <Notice tone="bad" title="Please fix the following">{formError ?? "Some fields need attention; they are marked below."}</Notice>}
          </div>

          <fieldset className="grid gap-4">
            <legend className="mb-1 text-xl font-display">1. The creator</legend>
            <div className="flex gap-2" role="radiogroup" aria-label="Creator source">
              {(["existing", "new"] as const).map((m) => (
                <button type="button" role="radio" aria-checked={mode === m} key={m} onClick={() => { setMode(m); setEventId(""); }} className={cx("min-h-10 rounded-full border px-4 text-sm font-medium", mode === m ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink")}>
                  {m === "existing" ? "Someone already on OFFBEAT" : "Add someone new"}
                </button>
              ))}
            </div>
            {mode === "existing" ? (
              <>
                <SelectField label="Creator" value={creatorId} onChange={(e) => { setCreatorId(e.target.value); setEventId(""); }} error={errors.creator} required>
                  <option value="">Choose…</option>
                  {creators.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {CATEGORY_LABELS[c.category]}
                    </option>
                  ))}
                </SelectField>
                <SelectField label="Event to send people to (optional)" value={eventId} onChange={(e) => setEventId(e.target.value)} disabled={!creatorId || creatorEvents.length === 0} hint={creatorId && creatorEvents.length === 0 ? "This creator has no listed events. Without an event your recommendation can be rated by no one and earn no verified check-ins." : "Only recommendations tied to an event can earn verified check-ins and rewards."}>
                  <option value="">No event</option>
                  {creatorEvents.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title}
                    </option>
                  ))}
                </SelectField>
              </>
            ) : (
              <div className="grid gap-4">
                <TextField label="Name" value={newCreator.name} onChange={(e) => setNewCreator({ ...newCreator, name: e.target.value })} maxLength={80} error={errors.creatorName} required />
                <SelectField label="Category" value={newCreator.category} onChange={(e) => setNewCreator({ ...newCreator, category: e.target.value })}>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </SelectField>
                <TextArea label="Short bio" value={newCreator.bio} onChange={(e) => setNewCreator({ ...newCreator, bio: e.target.value })} maxLength={600} className="" error={errors.creatorBio} required />
                <TextField label="Their website or page (optional)" type="url" inputMode="url" value={newCreator.externalUrl} onChange={(e) => setNewCreator({ ...newCreator, externalUrl: e.target.value })} error={errors.creatorUrl} />
                <p className="text-sm text-muted">New creators have no listed events yet, so this recommendation starts as discovery without verified check-ins.</p>
              </div>
            )}
          </fieldset>

          <fieldset className="grid gap-4">
            <legend className="mb-1 text-xl font-display">2. Your recommendation</legend>
            <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} error={errors.title} required hint="A line that makes someone curious." />
            <TextArea label="Why does this deserve attention?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={800} error={errors.reason} required hint={`${reason.trim().length}/800 · minimum 40 characters`} />
            <TextField label="A link to learn more (optional)" type="url" inputMode="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} error={errors.sourceUrl} />
          </fieldset>

          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" loading={busy}>
              Publish recommendation
            </Button>
            <Link to="/discover" className="text-sm text-muted hover:text-ink">
              Cancel
            </Link>
          </div>
        </form>
      </div>
      <aside className="lg:pt-24">
        <Card className="sticky top-24 p-6">
          <h2 className="text-xl">What happens next</h2>
          <ol className="mt-4 grid gap-3 text-sm text-muted">
            <li><strong className="text-ink">1.</strong> You get a personal referral link for this recommendation.</li>
            <li><strong className="text-ink">2.</strong> People who follow it and check in at the event are recorded as attributed, verified check-ins.</li>
            <li><strong className="text-ink">3.</strong> Attendees can rate it. Your own check-ins and ratings never count.</li>
            <li><strong className="text-ink">4.</strong> Your score updates from that evidence, and a sponsor&apos;s pool can reward it.</li>
          </ol>
          <p className="mt-5 text-xs text-muted">Duplicates (same creator and event, or the same link) are rejected. Recommendations are public and attributed to your display name.</p>
        </Card>
      </aside>
    </div>
  );
}
