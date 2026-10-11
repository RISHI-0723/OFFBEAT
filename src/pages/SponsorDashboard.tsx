import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventDto } from "../../server/services/data";
import { api, ApiError } from "../lib/api";
import { fmtDate } from "../lib/format";
import { useSession } from "../lib/session";
import { Mon } from "../components/chain";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Eyebrow, Loading, Notice, PageHeader, SelectField, TextArea, TextField, type Tone } from "../components/ui";

export interface PoolSummary {
  id: string;
  title: string;
  event_title: string;
  budget_wei: string;
  funded_wei: string;
  status: "draft" | "open" | "allocated" | "closed";
  contract_pool_id: number | null;
  is_demo: boolean;
  created_at: string;
}
export const POOL_STATUS: Record<PoolSummary["status"], { tone: Tone; label: string }> = {
  draft: { tone: "warn", label: "Not yet on-chain" },
  open: { tone: "accent", label: "Open for funding" },
  allocated: { tone: "ok", label: "Allocated" },
  closed: { tone: "neutral", label: "Closed" },
};

export default function SponsorDashboard() {
  const { viewer, loading } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const pools = useQuery({ queryKey: ["my-pools", viewer?.id], queryFn: () => api.get<PoolSummary[]>("/api/me/pools"), enabled: viewer?.role === "sponsor" });
  const events = useQuery({ queryKey: ["events"], queryFn: () => api.get<EventDto[]>("/api/events") });
  const [form, setForm] = useState({ title: "", eventId: "", budgetMon: "0.1", description: "" });
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (!viewer) return <EmptyState title="Sign in as a sponsor" action={<ButtonLink to="/signin?next=/dashboard/sponsor">Sign in</ButtonLink>}>Choose “Harbourlight Arts Fund (demo)” to see a populated example, or create your own sponsor account to fund a pool with your wallet.</EmptyState>;
  if (viewer.role !== "sponsor") return <EmptyState title="This dashboard is for sponsors" action={<ButtonLink to="/signin?next=/dashboard/sponsor" variant="secondary">Switch account</ButtonLink>}>You are signed in as a {viewer.role}.</EmptyState>;
  if (pools.isLoading || events.isLoading) return <Loading />;
  if (pools.isError) return <ErrorState error={pools.error} onRetry={() => void pools.refetch()} />;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const p = await api.post<{ id: string }>("/api/pools", form);
      await qc.invalidateQueries();
      nav(`/pools/${p.id}`);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError("Could not create the pool.", 0));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-14">
      <PageHeader eyebrow="Sponsor dashboard" title="Fund discovery, then show your working">
        A pool rewards the curators whose recommendations brought verified attendees to one event. You review a deterministic preview before anything is allocated, and the contract refuses to pay out more than the pool holds.
      </PageHeader>
      <Notice tone="warn" title="Testnet only">Pools use testnet MON, which has no monetary value. Nothing on this page is a real payment or a financial promise.</Notice>

      <section aria-labelledby="mine-h">
        <Eyebrow className="mb-2">Your pools</Eyebrow>
        <h2 id="mine-h" className="mb-6 text-3xl">Campaigns</h2>
        {pools.data!.length === 0 ? (
          <EmptyState title="No pools yet">Create one below. Demo sponsors can open the seeded pools through the public ledger.</EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {pools.data!.map((p) => (
              <li key={p.id}>
                <Card className="grid gap-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={POOL_STATUS[p.status].tone}>{POOL_STATUS[p.status].label}</Badge>
                    {p.is_demo && <Badge tone="warn">Demo content</Badge>}
                  </div>
                  <h3 className="text-xl"><Link to={`/pools/${p.id}`} className="hover:text-accent">{p.title}</Link></h3>
                  <p className="text-sm text-muted">For {p.event_title} · created {fmtDate(p.created_at)}</p>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-muted">Target budget</dt><dd><Mon wei={p.budget_wei} /></dd></div>
                    <div><dt className="text-muted">Funded on-chain</dt><dd><Mon wei={p.funded_wei} /></dd></div>
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-h" className="max-w-2xl">
        <h2 id="new-h" className="mb-2 text-3xl">Create a pool</h2>
        <p className="mb-6 text-muted">This creates the campaign record. You will create and fund its on-chain pool from your own wallet on the next page.</p>
        <Card className="p-6">
          <form onSubmit={create} className="grid gap-5" noValidate>
            <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} required error={err?.fields?.title} />
            <SelectField label="Event" value={form.eventId} onChange={(e) => setForm({ ...form, eventId: e.target.value })} required error={err?.fields?.eventId} hint="Only verified check-ins at this event, through recommendations of it, are rewarded.">
              <option value="">Choose an event…</option>
              {events.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </SelectField>
            <TextField label="Target budget (testnet MON)" inputMode="decimal" value={form.budgetMon} onChange={(e) => setForm({ ...form, budgetMon: e.target.value })} required hint="Distribution is capped at the lower of this target and what is actually funded on-chain. Maximum 100." />
            <TextArea label="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={400} className="" />
            {err && !err.fields && <Notice tone="bad">{err.message}</Notice>}
            {err?.fields && <Notice tone="bad">Please fix the highlighted fields.</Notice>}
            <div>
              <Button type="submit" loading={busy}>Create pool</Button>
            </div>
          </form>
        </Card>
      </section>
    </div>
  );
}
