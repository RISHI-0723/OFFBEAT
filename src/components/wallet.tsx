import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { Link2, LogOut, Wallet } from "lucide-react";
import { MONAD_TESTNET_ID } from "../../shared/chain";
import { api, ApiError } from "../lib/api";
import { shortAddr } from "../lib/format";
import { useSession } from "../lib/session";
import { addrUrl, useChainConfig } from "../lib/useChainConfig";
import { Badge, Button, Notice, cx } from "./ui";

export function useWalletStatus() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const hasProvider = typeof window !== "undefined" && "ethereum" in window;
  return {
    address: address?.toLowerCase(),
    connected: isConnected,
    onRightChain: chainId === MONAD_TESTNET_ID,
    hasProvider,
    connecting: isPending,
    switching,
    error,
    connect: () => connectors[0] && connect({ connector: connectors[0] }),
    disconnect,
    switchToMonad: () => switchChain({ chainId: MONAD_TESTNET_ID }),
  };
}

/** Compact header control. */
export function WalletButton() {
  const w = useWalletStatus();
  if (!w.connected)
    return (
      <Button variant="secondary" className="min-h-10 px-4" onClick={w.connect} loading={w.connecting} disabled={!w.hasProvider} title={w.hasProvider ? undefined : "No browser wallet detected. Install MetaMask or a compatible wallet."}>
        <Wallet className="size-4" aria-hidden /> {w.hasProvider ? "Connect wallet" : "No wallet found"}
      </Button>
    );
  return (
    <div className="flex items-center gap-2">
      {!w.onRightChain ? (
        <Button variant="danger" className="min-h-10 px-4" onClick={w.switchToMonad} loading={w.switching}>
          Switch to Monad Testnet
        </Button>
      ) : (
        <Badge tone="ok">Monad Testnet</Badge>
      )}
      <span className="tnum hidden rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm sm:inline">{shortAddr(w.address ?? "")}</span>
      <button onClick={() => w.disconnect()} aria-label="Disconnect wallet" className="grid size-10 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-raised hover:text-ink">
        <LogOut className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Explains and gates a wallet-dependent action. Renders children only when connected on Monad Testnet. */
export function WalletGate({ children, expectAddress, why }: { children: React.ReactNode; expectAddress?: string | null; why: string }) {
  const w = useWalletStatus();
  const cfg = useChainConfig();
  if (cfg.data && !cfg.data.chainEnabled) return <Notice tone="warn" title="On-chain actions are disabled on this deployment">No RewardPool contract address is configured, so nothing here can touch Monad. Everything else works.</Notice>;
  if (!w.hasProvider) return <Notice tone="warn" title="Browser wallet required">{why} Install MetaMask (or another EVM wallet) and reload.</Notice>;
  if (!w.connected)
    return (
      <div className="grid gap-3">
        <Notice title="Connect a wallet">{why} You will be asked to approve each transaction; OFFBEAT never holds your keys.</Notice>
        <div>
          <Button onClick={w.connect} loading={w.connecting}>
            <Wallet className="size-4" aria-hidden /> Connect wallet
          </Button>
          {w.error && <p role="alert" className="mt-3 text-sm text-bad">Could not connect: {w.error.message}</p>}
        </div>
      </div>
    );
  if (!w.onRightChain)
    return (
      <div className="grid gap-3">
        <Notice tone="warn" title="Wrong network">Switch your wallet to Monad Testnet (chain {MONAD_TESTNET_ID}) before signing.</Notice>
        <div>
          <Button onClick={w.switchToMonad} loading={w.switching}>
            Switch to Monad Testnet
          </Button>
        </div>
      </div>
    );
  if (expectAddress && w.address !== expectAddress.toLowerCase())
    return (
      <Notice tone="warn" title="Connected wallet does not match">
        This action needs the wallet <span className="tnum font-mono">{shortAddr(expectAddress)}</span>, but <span className="tnum font-mono">{shortAddr(w.address ?? "")}</span> is connected. Switch accounts in your wallet.
      </Notice>
    );
  return <>{children}</>;
}

/** Lets the signed-in user bind a wallet to their profile by signing a server-issued message (no funds move). */
export function LinkWalletPanel({ className }: { className?: string }) {
  const { viewer, refresh } = useSession();
  const w = useWalletStatus();
  const cfg = useChainConfig();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!viewer) return null;

  const link = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { message } = await api.post<{ message: string }>("/api/me/wallet/nonce");
      const signature = await signMessageAsync({ message });
      await api.post("/api/me/wallet", { address: w.address, signature });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error && /reject|denied/i.test(e.message) ? "You declined the signature request. Nothing was changed." : "Could not link the wallet.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cx("rounded-[var(--radius-card)] border border-line bg-surface p-5", className)} aria-labelledby="wallet-link-h">
      <h2 id="wallet-link-h" className="text-xl">Payout wallet</h2>
      {viewer.wallet_address ? (
        <p className="mt-2 text-sm text-muted">
          Linked: <a className="tnum font-mono text-ink underline decoration-line underline-offset-4 hover:decoration-accent" href={addrUrl(cfg.data, viewer.wallet_address)} target="_blank" rel="noreferrer">{shortAddr(viewer.wallet_address)}</a>
          {w.connected && w.address !== viewer.wallet_address && <span className="ml-2 text-warn">(a different wallet is currently connected)</span>}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">Rewards can only be allocated to a wallet you have proven you control. Linking asks you to sign a message; it does not move funds.</p>
      )}
      {!viewer.wallet_address || (w.connected && w.address !== viewer.wallet_address) ? (
        <div className="mt-4">
          <WalletGate why="Linking a wallet requires signing a short message.">
            <Button variant="secondary" onClick={link} loading={busy}>
              <Link2 className="size-4" aria-hidden /> {viewer.wallet_address ? "Replace linked wallet with this one" : `Link ${shortAddr(w.address ?? "")}`}
            </Button>
          </WalletGate>
          {err && <p role="alert" className="mt-3 text-sm text-bad">{err}</p>}
        </div>
      ) : null}
    </section>
  );
}
