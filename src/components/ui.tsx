import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { ApiError } from "../lib/api";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";
const base = "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-bg hover:bg-white",
  secondary: "border border-line bg-surface text-ink hover:border-accent hover:bg-raised",
  ghost: "text-muted hover:bg-raised hover:text-ink",
  danger: "border border-bad/50 text-bad hover:bg-bad/10",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "primary", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} className={cx(base, variants[variant], className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = "primary", className, ...rest }: LinkProps & { variant?: Variant }) {
  return <Link className={cx(base, variants[variant], className)} {...rest} />;
}

const tones = {
  neutral: "border-line text-muted",
  accent: "border-accent/40 bg-accent/10 text-accent",
  ok: "border-ok/40 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  bad: "border-bad/40 bg-bad/10 text-bad",
} as const;
export type Tone = keyof typeof tones;
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}
export const DemoBadge = ({ label = "Demo content" }: { label?: string }) => <Badge tone="warn">{label}</Badge>;

export function Card({ children, className, as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" | "li" }) {
  return <Tag className={cx("rounded-[var(--radius-card)] border border-line bg-surface", className)}>{children}</Tag>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-xs font-semibold uppercase tracking-[0.16em] text-accent", className)}>{children}</p>;
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="enter mb-10 flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-3xl">
        {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
        <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl">{title}</h1>
        {children && <div className="mt-4 text-lg text-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
}
function useField(error?: string, hint?: string) {
  const id = useId();
  return { id, errId: error ? `${id}-err` : undefined, hintId: hint ? `${id}-hint` : undefined };
}
const control = "w-full rounded-[var(--radius-control)] border bg-bg px-4 py-3 text-base text-ink placeholder:text-muted/70 focus-visible:border-accent";

export function TextField({ label, hint, error, className, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const { id, errId, hintId } = useField(error, hint);
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input id={id} aria-invalid={!!error || undefined} aria-describedby={cx(hintId, errId) || undefined} className={cx(control, error ? "border-bad" : "border-line")} {...rest} />
      {hint && <p id={hintId} className="mt-1.5 text-sm text-muted">{hint}</p>}
      {error && <p id={errId} role="alert" className="mt-1.5 text-sm text-bad">{error}</p>}
    </div>
  );
}
export function TextArea({ label, hint, error, className, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { id, errId, hintId } = useField(error, hint);
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <textarea id={id} aria-invalid={!!error || undefined} aria-describedby={cx(hintId, errId) || undefined} className={cx(control, "min-h-32 resize-y", error ? "border-bad" : "border-line")} {...rest} />
      {hint && <p id={hintId} className="mt-1.5 text-sm text-muted">{hint}</p>}
      {error && <p id={errId} role="alert" className="mt-1.5 text-sm text-bad">{error}</p>}
    </div>
  );
}
export function SelectField({ label, hint, error, className, children, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const { id, errId, hintId } = useField(error, hint);
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <select id={id} aria-invalid={!!error || undefined} aria-describedby={cx(hintId, errId) || undefined} className={cx(control, error ? "border-bad" : "border-line")} {...rest}>
        {children}
      </select>
      {hint && <p id={hintId} className="mt-1.5 text-sm text-muted">{hint}</p>}
      {error && <p id={errId} role="alert" className="mt-1.5 text-sm text-bad">{error}</p>}
    </div>
  );
}

export function Notice({ tone = "neutral", title, children, className }: { tone?: "neutral" | "ok" | "warn" | "bad"; title?: string; children?: ReactNode; className?: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "neutral" ? Info : AlertTriangle;
  const color = tone === "ok" ? "text-ok border-ok/30" : tone === "warn" ? "text-warn border-warn/30" : tone === "bad" ? "text-bad border-bad/30" : "text-accent border-line";
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cx("flex gap-3 rounded-[var(--radius-control)] border bg-surface p-4", color, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="text-sm text-ink">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx("text-muted", title && "mt-1")}>{children}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-[pulse-soft_1.6s_ease-in-out_infinite] rounded-[var(--radius-control)] bg-raised", className)} />;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-4">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line px-6 py-12 text-center">
      <p className="font-display text-2xl">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-md text-muted">{children}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div role="alert" className="rounded-[var(--radius-card)] border border-bad/40 bg-bad/5 px-6 py-10 text-center">
      <p className="font-display text-2xl text-bad">That did not load</p>
      <p className="mx-auto mt-2 max-w-md text-muted">{msg}</p>
      {onRetry && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function Stat({ value, label, note }: { value: ReactNode; label: string; note?: string }) {
  return (
    <div>
      <p className="tnum font-display text-4xl font-semibold leading-none">{value}</p>
      <p className="mt-2 text-sm font-medium">{label}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}
