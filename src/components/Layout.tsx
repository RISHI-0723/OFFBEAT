import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useSession } from "../lib/session";
import { useChainConfig } from "../lib/useChainConfig";
import { WalletButton } from "./wallet";
import { Badge, Button, ButtonLink, cx } from "./ui";

const nav = [
  { to: "/discover", label: "Discover" },
  { to: "/impact", label: "Impact ledger" },
  { to: "/judge", label: "Judge guide" },
];

const linkClass = ({ isActive }: { isActive: boolean }) => cx("rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium transition-colors", isActive ? "bg-raised text-ink" : "text-muted hover:text-ink");

function Header() {
  const { viewer, signOut } = useSession();
  const loc = useLocation();
  // The menu is open only for the page it was opened on, so navigating closes it without an effect.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === loc.pathname;
  const setOpen = (fn: (o: boolean) => boolean) => setOpenFor(fn(open) ? loc.pathname : null);

  const dash = viewer?.role === "curator" ? { to: "/dashboard/curator", label: "My dashboard" } : viewer?.role === "sponsor" ? { to: "/dashboard/sponsor", label: "Sponsor dashboard" } : null;
  const links = [...nav, ...(dash ? [dash] : [])];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <Link to="/" className="flex items-center gap-3" aria-label="OFFBEAT home">
          <img src="/brand/offbeat-symbol-192.png" alt="" width={36} height={36} className="size-9 rounded-lg" />
          <span className="font-display text-xl font-semibold tracking-tight">OFFBEAT</span>
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            <WalletButton />
          </div>
          {viewer ? (
            <div className="hidden items-center gap-2 sm:flex">
              <span className="max-w-40 truncate text-sm text-muted" title={viewer.display_name}>
                {viewer.display_name}
              </span>
              <Button variant="ghost" className="min-h-10 px-3" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          ) : (
            <ButtonLink to="/signin" variant="primary" className="min-h-10 px-4">
              Sign in
            </ButtonLink>
          )}
          <button className="grid size-10 place-items-center rounded-[var(--radius-control)] border border-line lg:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}>
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-line bg-bg px-5 py-4 lg:hidden">
          <div className="grid gap-1">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
          </div>
          <div className="mt-4 grid gap-3 border-t border-line pt-4">
            <WalletButton />
            {viewer && (
              <Button variant="ghost" onClick={() => void signOut()}>
                Sign out ({viewer.display_name})
              </Button>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}

function Footer() {
  const cfg = useChainConfig();
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-display text-2xl">OFFBEAT</p>
          <p className="mt-2 max-w-sm text-muted">Discover differently. Reward discovery.</p>
          <p className="mt-4 max-w-md text-sm text-muted">A hackathon prototype running on Monad Testnet. Rewards are testnet MON with no monetary value. Scores are illustrative. Seeded creators, events and attendees are fictional and labelled as demo content.</p>
        </div>
        <nav aria-label="Product" className="grid content-start gap-2 text-sm">
          <p className="mb-1 font-semibold">Product</p>
          <Link className="text-muted hover:text-ink" to="/discover">Discover</Link>
          <Link className="text-muted hover:text-ink" to="/recommendations/new">Recommend something</Link>
          <Link className="text-muted hover:text-ink" to="/impact">Impact ledger</Link>
          <Link className="text-muted hover:text-ink" to="/judge">Judge guide</Link>
        </nav>
        <div className="grid content-start gap-2 text-sm">
          <p className="mb-1 font-semibold">Network</p>
          <p className="text-muted">{cfg.data?.networkName ?? "Monad Testnet"} · chain {cfg.data?.chainId ?? 10143}</p>
          {cfg.data?.contractAddress ? (
            <a className="tnum break-all font-mono text-accent hover:underline" href={`${cfg.data.explorerUrl}/address/${cfg.data.contractAddress}`} target="_blank" rel="noreferrer">
              {cfg.data.contractAddress}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <Badge tone="warn">Contract not configured</Badge>
          )}
          <a className="text-muted hover:text-ink" href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">Get testnet MON ↗</a>
        </div>
      </div>
    </footer>
  );
}

export function Layout() {
  const loc = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  // Move focus to the page content on navigation so keyboard and screen-reader users land in the new view.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    main.current?.focus({ preventScroll: true });
  }, [loc.pathname]);

  return (
    <>
      <a href="#main" className="sr-only z-50 rounded-[var(--radius-control)] bg-accent px-4 py-2 font-semibold text-bg focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <div className="border-b border-warn/30 bg-warn/10 px-5 py-2 text-center text-xs text-warn">
        Hackathon prototype on <strong>Monad Testnet</strong>. Testnet MON has no monetary value. Seeded content is fictional demo data.
      </div>
      <Header />
      <main id="main" ref={main} tabIndex={-1} className="mx-auto max-w-[1280px] px-5 pt-10 outline-none sm:px-8 sm:pt-14">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
