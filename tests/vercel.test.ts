import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { openDb } from "../server/db";
import { seedDemo } from "../server/seed";
import { createApp } from "../server/app";
import { FakeChain, testConfig } from "./helpers";

describe("api/index.ts (Vercel function)", () => {
  afterEach(() => vi.resetModules());

  it("routes methods, bodies and errors through the Hono app as JSON", async () => {
    const db = await openDb("");
    await seedDemo(db);
    const app = createApp({ db, config: testConfig, chain: new FakeChain() });
    vi.doMock("../server/runtime", () => ({ getRuntime: async () => ({ app }) }));
    const h = await import("../api/index");

    const health = await h.GET(new Request("https://x.test/api/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const cfg = (await (await h.GET(new Request("https://x.test/api/config"))).json()) as { chainId: number };
    expect(cfg.chainId).toBe(10143);

    const missing = await h.GET(new Request("https://x.test/api/nope"));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");

    const bad = await h.POST(new Request("https://x.test/api/auth/guest", { method: "POST", body: "{", headers: { "content-type": "application/json" } }));
    expect(bad.status).toBe(400);

    const ok = await h.POST(new Request("https://x.test/api/auth/guest", { method: "POST", body: JSON.stringify({ displayName: "Vercel Test", role: "participant" }), headers: { "content-type": "application/json", "x-forwarded-for": "10.7.7.7" } }));
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { token: string }).token).toContain(".");
  });

  it("returns a JSON 503 (no secrets) when the runtime cannot start", async () => {
    vi.doMock("../server/runtime", () => ({ getRuntime: async () => { throw new Error("DATABASE_URL is required"); } }));
    const h = await import("../api/index");
    const res = await h.GET(new Request("https://x.test/api/health"));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("DATABASE_URL");
  });
});

describe("vercel.json", () => {
  const v = JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] };
  const match = (path: string) => v.rewrites.find((r) => new RegExp(`^${r.source.replace(/:path\*/, ".*")}$`).test(path))?.destination;

  it("sends /api/* to the function and everything else to the SPA", () => {
    expect(match("/api/health")).toBe("/api");
    expect(match("/api/events/some-slug")).toBe("/api");
    expect(match("/discover")).toBe("/index.html");
    expect(match("/events/harbour-field-recordings")).toBe("/index.html");
    expect(match("/r/ABCDEFGH")).toBe("/index.html");
  });
});

describe("config guards", () => {
  const load = async (env: Record<string, string>) => {
    vi.resetModules();
    for (const k of ["DATABASE_URL", "DB_DRIVER", "SESSION_SECRET", "NODE_ENV", "ENV_FILE"]) vi.stubEnv(k, "");
    for (const [k, val] of Object.entries(env)) vi.stubEnv(k, val);
    vi.stubEnv("ENV_FILE", "does-not-exist.env");
    return import("../server/config");
  };
  afterEach(() => vi.unstubAllEnvs());
  const secret = "s".repeat(40);

  it("production without DATABASE_URL fails fast instead of using PGlite", async () => {
    await expect(load({ NODE_ENV: "production", SESSION_SECRET: secret })).rejects.toThrow(/DATABASE_URL is required in production/);
  });
  it("production with DATABASE_URL selects postgres", async () => {
    const { config } = await load({ NODE_ENV: "production", SESSION_SECRET: secret, DATABASE_URL: "postgresql://u:p@h:6543/postgres" });
    expect(config.dbDriver).toBe("postgres");
  });
  it("production requires SESSION_SECRET", async () => {
    await expect(load({ NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@h:6543/postgres" })).rejects.toThrow(/SESSION_SECRET/);
  });
  it("development defaults to PGlite", async () => {
    expect((await load({})).config.dbDriver).toBe("pglite");
  });
  it("the error messages never contain the connection string", async () => {
    const url = "postgresql://u:topsecret@h:6543/postgres";
    await expect(load({ NODE_ENV: "production", DATABASE_URL: url })).rejects.not.toThrow(/topsecret/);
  });
});
