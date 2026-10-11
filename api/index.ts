import { handle } from "hono/vercel";
import { Hono } from "hono";
import { getRuntime } from "../server/runtime";

// Vercel Node.js function. vercel.json rewrites every /api/* request here; the original URL is preserved.
const entry = new Hono();
entry.all("*", async (c) => {
  try {
    const { app } = await getRuntime();
    return app.fetch(c.req.raw);
  } catch (e) {
    console.error("[offbeat] startup failure:", e instanceof Error ? e.message : "unknown"); // message only: never log connection strings
    return c.json({ error: { message: "Service is not configured correctly." } }, 503);
  }
});

export const GET = handle(entry);
export const POST = handle(entry);
export const PUT = handle(entry);
export const PATCH = handle(entry);
export const DELETE = handle(entry);
export const OPTIONS = handle(entry);
export const HEAD = handle(entry);
