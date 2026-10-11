export { formatMon, parseMon } from "../../shared/chain";

export const CATEGORY_LABELS: Record<string, string> = {
  music: "Music",
  "visual-art": "Visual art",
  performance: "Performance",
  craft: "Craft",
  film: "Film",
  writing: "Writing",
  food: "Food culture",
};

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => new Date(iso).toLocaleDateString(undefined, opts);
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const score = (n: number) => n.toFixed(1);
