import { useId } from "react";
import { cx } from "./ui";

/**
 * Deterministic generative artwork. Every creator gets a unique, stable composition from its seed, so the
 * feed has real visual identity without hotlinked or stock photos. Clearly artwork, never a depiction of a real person.
 */

const PALETTES = [
  { bg: "#170f2e", a: "#a78bfa", b: "#f4f1f8", c: "#5b34d6" },
  { bg: "#1c0f0c", a: "#f08a4b", b: "#f4e3cf", c: "#b5472a" },
  { bg: "#071819", a: "#4fd1c5", b: "#efe3c8", c: "#1f6f78" },
  { bg: "#1b0d17", a: "#f27ba5", b: "#f7d9e3", c: "#8c2f5d" },
  { bg: "#0e180f", a: "#9ccf7a", b: "#e8efd9", c: "#3e6b3a" },
  { bg: "#0a1030", a: "#6c8cff", b: "#e8ecff", c: "#2a3fb5" },
] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type P = (typeof PALETTES)[number];
const W = 400;
const H = 500;

function Music({ r, p }: { r: () => number; p: P }) {
  const cx0 = 80 + r() * 240;
  const cy0 = 120 + r() * 120;
  const rings = Array.from({ length: 9 }, (_, i) => 28 + i * (18 + r() * 8));
  const bars = Array.from({ length: 28 }, (_, i) => ({ x: 14 + i * 13.6, h: 20 + r() * 150 }));
  return (
    <>
      {rings.map((rad, i) => (
        <circle key={i} cx={cx0} cy={cy0} r={rad} fill="none" stroke={i % 3 === 0 ? p.a : p.c} strokeWidth={i % 3 === 0 ? 3 : 1.4} opacity={0.95 - i * 0.07} />
      ))}
      <circle cx={cx0} cy={cy0} r={14} fill={p.b} />
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={H - b.h} width={7} height={b.h} fill={i % 4 === 0 ? p.a : p.c} opacity={0.9} />
      ))}
    </>
  );
}
function VisualArt({ r, p }: { r: () => number; p: P }) {
  const dots = Array.from({ length: 11 * 9 }, (_, i) => ({ x: 24 + (i % 11) * 35, y: 270 + Math.floor(i / 11) * 26, s: 1 + r() * 4.5 }));
  return (
    <>
      <circle cx={150 + r() * 40} cy={170} r={120} fill={p.a} />
      <circle cx={250 + r() * 40} cy={200} r={105} fill={p.c} style={{ mixBlendMode: "screen" }} opacity={0.9} />
      <circle cx={200} cy={140} r={46} fill={p.b} opacity={0.92} />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.s} fill={p.b} opacity={0.7} />
      ))}
    </>
  );
}
function Performance({ r, p }: { r: () => number; p: P }) {
  const lamp = 120 + r() * 160;
  return (
    <>
      <polygon points={`${lamp - 14},120 ${lamp + 14},120 ${lamp + 150},${H} ${lamp - 150},${H}`} fill={p.a} opacity={0.2} />
      <path d={`M60 ${H} V210 A140 140 0 0 1 340 210 V${H} Z`} fill={p.c} />
      <path d={`M100 ${H} V220 A100 100 0 0 1 300 220 V${H} Z`} fill={p.bg} />
      <circle cx={lamp} cy={116} r={24} fill={p.b} />
      <rect x={lamp - 2} y={140} width={4} height={90} fill={p.b} opacity={0.7} />
      <ellipse cx={200} cy={H - 6} rx={90} ry={14} fill={p.a} opacity={0.6} />
    </>
  );
}
function Craft({ r, p }: { r: () => number; p: P }) {
  const stripes = Array.from({ length: 22 }, (_, i) => i);
  const flip = r() > 0.5;
  return (
    <>
      {stripes.map((i) => (
        <rect key={`h${i}`} x={0} y={i * 24 + (r() * 6 - 3)} width={W} height={10 + r() * 8} fill={i % 3 === 0 ? p.a : p.c} opacity={0.85} transform={flip ? "skewY(-6)" : "skewY(6)"} />
      ))}
      {stripes.slice(0, 14).map((i) => (
        <rect key={`v${i}`} x={i * 31 + r() * 6} y={0} width={8 + r() * 10} height={H} fill={p.b} opacity={0.35} transform={flip ? "skewY(-6)" : "skewY(6)"} />
      ))}
      <circle cx={280} cy={120} r={52} fill={p.bg} opacity={0.9} />
      <circle cx={280} cy={120} r={34} fill={p.b} />
    </>
  );
}
function Film({ r, p }: { r: () => number; p: P }) {
  const frames = Array.from({ length: 5 }, (_, i) => ({ y: 20 + i * 96, tint: r() > 0.5 ? p.a : p.c }));
  return (
    <>
      <rect x={70} y={0} width={260} height={H} fill="#000" opacity={0.55} />
      {frames.map((f, i) => (
        <g key={i}>
          <rect x={92} y={f.y} width={216} height={78} fill={f.tint} opacity={0.9} />
          <circle cx={150 + r() * 100} cy={f.y + 39} r={14 + r() * 16} fill={p.b} opacity={0.85} />
        </g>
      ))}
      {Array.from({ length: 24 }, (_, i) => (
        <g key={i}>
          <rect x={78} y={8 + i * 21} width={8} height={11} rx={2} fill={p.bg} />
          <rect x={314} y={8 + i * 21} width={8} height={11} rx={2} fill={p.bg} />
        </g>
      ))}
    </>
  );
}
function Writing({ r, p }: { r: () => number; p: P }) {
  const lines = Array.from({ length: 15 }, (_, i) => ({ y: 190 + i * 20, w: 120 + r() * 220, hot: r() > 0.8 }));
  return (
    <>
      <circle cx={260} cy={112} r={74} fill={p.a} />
      <circle cx={232} cy={100} r={74} fill={p.bg} opacity={0.35} />
      {lines.map((l, i) => (
        <rect key={i} x={36} y={l.y} width={l.w} height={6} rx={3} fill={l.hot ? p.a : p.b} opacity={l.hot ? 1 : 0.55} />
      ))}
    </>
  );
}
function Food({ r, p }: { r: () => number; p: P }) {
  const bubbles = Array.from({ length: 22 }, () => ({ x: 20 + r() * 360, y: 20 + r() * 460, s: 8 + r() * 56, hue: r() }));
  return (
    <>
      {bubbles.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r={b.s} fill={b.hue > 0.66 ? p.a : b.hue > 0.33 ? p.c : p.b} opacity={0.35 + b.hue * 0.5} />
      ))}
      <rect x={60} y={380} width={280} height={14} rx={7} fill={p.b} opacity={0.8} />
    </>
  );
}

const MOTIFS = { music: Music, "visual-art": VisualArt, performance: Performance, craft: Craft, film: Film, writing: Writing, food: Food } as const;

export function Artwork({ seed, category, label, className }: { seed: string; category: string; label: string; className?: string }) {
  const id = useId();
  const h = hash(seed);
  const p = PALETTES[h % PALETTES.length]!;
  const r = rng(h);
  const Motif = MOTIFS[category as keyof typeof MOTIFS] ?? Music;
  return (
    <div className={cx("grain relative isolate overflow-hidden bg-bg", className)}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={p.bg} />
            <stop offset="1" stopColor={p.c} stopOpacity={0.45} />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#${id}-g)`} />
        <Motif r={r} p={p} />
      </svg>
    </div>
  );
}
