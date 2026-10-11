import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { HttpError } from "./util";
import type { Db } from "./db";

export interface Session {
  uid: string;
  exp: number;
}
export interface Viewer {
  id: string;
  display_name: string;
  role: "curator" | "participant" | "sponsor";
  wallet_address: string | null;
  is_demo: boolean;
}

const TTL_MS = 1000 * 60 * 60 * 12;

export function signSession(secret: string, uid: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ uid, exp: now + TTL_MS } satisfies Session)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(secret: string, token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    return s.exp > now && typeof s.uid === "string" ? s : null;
  } catch {
    return null;
  }
}

export type AppEnv = { Variables: { viewer: Viewer | null } };

export function sessionMiddleware(db: Db, secret: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const h = c.req.header("authorization");
    const token = h?.startsWith("Bearer ") ? h.slice(7) : undefined;
    const s = verifySession(secret, token);
    let viewer: Viewer | null = null;
    if (s) {
      const rows = await db.query<Viewer>("SELECT id, display_name, role, wallet_address, is_demo FROM profiles WHERE id = $1", [s.uid]);
      viewer = rows[0] ?? null;
    }
    c.set("viewer", viewer);
    await next();
  };
}

export function requireViewer(c: Context<AppEnv>, ...roles: Viewer["role"][]): Viewer {
  const v = c.get("viewer");
  if (!v) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  if (roles.length && !roles.includes(v.role)) throw new HttpError(403, `This action requires the ${roles.join(" or ")} role.`, "forbidden");
  return v;
}
