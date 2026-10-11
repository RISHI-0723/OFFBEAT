import { ExternalLink, Loader2 } from "lucide-react";
import { formatMon, shortHash } from "../lib/format";
import { txUrl, useChainConfig } from "../lib/useChainConfig";
import type { TxState } from "../lib/txRunner";
import { Badge, Notice } from "./ui";

export function Mon({ wei, dp = 4, className }: { wei: string | bigint | number; dp?: number; className?: string }) {
  return (
    <span className={`tnum ${className ?? ""}`}>
      {formatMon(wei, dp)} <span className="text-muted">MON</span>
    </span>
  );
}

export function TxLink({ hash, className }: { hash: string; className?: string }) {
  const cfg = useChainConfig();
  return (
    <a href={txUrl(cfg.data, hash)} target="_blank" rel="noreferrer" className={`tnum inline-flex items-center gap-1 font-mono text-sm text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent ${className ?? ""}`}>
      {shortHash(hash)} <ExternalLink className="size-3.5" aria-hidden />
      <span className="sr-only">view transaction on the block explorer (opens in a new tab)</span>
    </a>
  );
}

/** Pending / confirmed / failed are always distinct. A hash is only shown as confirmed after server verification. */
export function TxStatus({ state }: { state: TxState }) {
  if (state.phase === "idle") return null;
  const steps = [
    { id: "wallet", text: "Approve in your wallet" },
    { id: "confirming", text: "Waiting for Monad to confirm" },
    { id: "verifying", text: "OFFBEAT is verifying the receipt" },
    { id: "done", text: "Confirmed and recorded" },
  ] as const;
  const idx = steps.findIndex((s) => s.id === state.phase);
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-surface p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{state.label}</p>
        {state.phase === "done" && <Badge tone="ok">Confirmed</Badge>}
        {state.phase === "error" && <Badge tone="bad">Failed</Badge>}
        {state.phase !== "done" && state.phase !== "error" && (
          <Badge tone="warn">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Pending
          </Badge>
        )}
      </div>
      {state.phase !== "error" && (
        <ol className="mt-3 grid gap-1.5 text-sm">
          {steps.map((s, i) => (
            <li key={s.id} className={i < idx || state.phase === "done" ? "text-ok" : i === idx ? "text-ink" : "text-muted"}>
              {i < idx || state.phase === "done" ? "✓" : i === idx ? "●" : "○"} {s.text}
            </li>
          ))}
        </ol>
      )}
      {state.phase === "error" && <Notice tone="bad" className="mt-3">{state.message}</Notice>}
      {state.hash && (
        <p className="mt-3 text-sm text-muted">
          Transaction: <TxLink hash={state.hash} />
        </p>
      )}
    </div>
  );
}
