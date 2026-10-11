import { createHash, randomBytes, randomInt } from "node:crypto";

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 502 | 503,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/** 192-bit URL-safe random token. */
export const newToken = () => randomBytes(24).toString("base64url");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I; matches /^[A-Z2-9]{8}$/
export function newReferralCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

export const isAddress = (s: unknown): s is string => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
export const isTxHash = (s: unknown): s is string => typeof s === "string" && /^0x[0-9a-fA-F]{64}$/.test(s);

/** Postgres numeric(78,0) arrives as string; convert safely to bigint. */
export const big = (v: unknown): bigint => BigInt(String(v).split(".")[0] ?? "0");
