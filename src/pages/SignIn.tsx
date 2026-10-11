import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useSession } from "../lib/session";
import { Badge, Button, Card, ErrorState, Notice, PageHeader, Skeleton, TextField, cx } from "../components/ui";

interface Persona {
  id: string;
  displayName: string;
  role: "curator" | "participant" | "sponsor";
}
const roleCopy = {
  curator: { label: "Curator", blurb: "Recommends creators, earns a referral link, sees scores and claims rewards." },
  participant: { label: "Participant", blurb: "Follows recommendations and checks in to events." },
  sponsor: { label: "Sponsor / organiser", blurb: "Runs the event door screen, funds pools and approves distributions." },
} as const;

export function useAfterSignIn() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  return (role: Persona["role"]) => {
    const next = params.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) return nav(next);
    nav(role === "curator" ? "/dashboard/curator" : role === "sponsor" ? "/dashboard/sponsor" : "/discover");
  };
}

export function PersonaPicker({ compact = false }: { compact?: boolean }) {
  const { signInWithToken } = useSession();
  const after = useAfterSignIn();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["personas"], queryFn: () => api.get<Persona[]>("/api/auth/personas") });

  const go = async (p: Persona) => {
    setBusy(p.id);
    setErr(null);
    try {
      const { token } = await api.post<{ token: string }>("/api/auth/demo", { profileId: p.id });
      await signInWithToken(token);
      after(p.role);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not sign in.");
      setBusy(null);
    }
  };

  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div>
      <ul className={cx("grid gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
        {q.data!.map((p) => (
          <li key={p.id}>
            <button onClick={() => void go(p)} disabled={busy !== null} className="flex h-full w-full flex-col items-start gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-left transition-colors hover:border-accent disabled:opacity-60">
              <span className="flex items-center gap-2">
                <span className="font-semibold">{p.displayName}</span>
                <Badge tone="warn">demo</Badge>
              </span>
              <span className="text-sm text-accent">{roleCopy[p.role].label}</span>
              {!compact && <span className="text-sm text-muted">{roleCopy[p.role].blurb}</span>}
              {busy === p.id && <span className="text-sm text-muted">Signing in…</span>}
            </button>
          </li>
        ))}
      </ul>
      {err && <p role="alert" className="mt-3 text-sm text-bad">{err}</p>}
    </div>
  );
}

export default function SignIn() {
  const { signInWithToken } = useSession();
  const after = useAfterSignIn();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Persona["role"]>("curator");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { token } = await api.post<{ token: string }>("/api/auth/guest", { displayName: name, role });
      await signInWithToken(token);
      after(role);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError("Could not create the account.", 0));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-14">
      <PageHeader eyebrow="Sign in" title="Pick a role to try OFFBEAT">
        This prototype uses demo sign-in, not passwords. Nothing here protects real accounts, so please do not enter personal information.
      </PageHeader>

      <section aria-labelledby="personas-h">
        <h2 id="personas-h" className="mb-4 text-2xl">Continue as a demo persona</h2>
        <PersonaPicker />
      </section>

      <section aria-labelledby="guest-h" className="max-w-xl">
        <h2 id="guest-h" className="mb-1 text-2xl">Or create your own guest account</h2>
        <p className="mb-5 text-muted">Needed to try the full loop with your own wallet: your own recommendation, your own check-in, your own pool.</p>
        <Card className="p-6">
          <form onSubmit={submit} className="grid gap-5" noValidate>
            <TextField label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoComplete="nickname" error={err?.fields?.displayName} hint="Shown publicly next to your recommendations." />
            <fieldset>
              <legend className="mb-2 text-sm font-medium">I want to be a…</legend>
              <div className="grid gap-2">
                {(Object.keys(roleCopy) as Persona["role"][]).map((r) => (
                  <label key={r} className={cx("flex cursor-pointer gap-3 rounded-[var(--radius-control)] border p-3 transition-colors", role === r ? "border-accent bg-accent/10" : "border-line hover:border-accent/50")}>
                    <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-1 accent-[var(--color-accent)]" />
                    <span>
                      <span className="block text-sm font-semibold">{roleCopy[r].label}</span>
                      <span className="block text-sm text-muted">{roleCopy[r].blurb}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {err && !err.fields && <Notice tone="bad">{err.message}</Notice>}
            <Button type="submit" loading={busy}>
              Create account and continue
            </Button>
          </form>
        </Card>
      </section>
    </div>
  );
}
