// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScoreBreakdown } from "../src/components/recommendation";
import { SessionProvider } from "../src/lib/session";
import { friendlyError } from "../src/lib/txRunner";
import { ApiError } from "../src/lib/api";
import { formatMon, parseMon } from "../src/lib/format";
import { recallReferral, rememberReferral } from "../src/lib/referral";
import EventPage from "../src/pages/Event";
import { scoreRecommendation } from "../shared/scoring";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ScoreBreakdown", () => {
  it("labels provisional and proxy components and states the causation caveat", () => {
    const s = scoreRecommendation({ ratings: [5], verifiedCheckins: 3, priorRecommendationsForCreator: 0, categoryRecommendationCount: 1, totalRecommendationCount: 8, status: "published" });
    render(<ScoreBreakdown score={s} />);
    expect(screen.getByText("Provisional")).toBeInTheDocument();
    expect(screen.getByText("Prototype proxy")).toBeInTheDocument();
    expect(screen.getByText(/not proof that the recommendation caused it/i)).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: /verified impact/i })).toHaveAttribute("aria-valuenow", "30");
  });

  it("explains why a recommendation is not yet eligible", () => {
    const s = scoreRecommendation({ ratings: [], verifiedCheckins: 0, priorRecommendationsForCreator: 0, categoryRecommendationCount: 1, totalRecommendationCount: 8, status: "published" });
    render(<ScoreBreakdown score={s} />);
    expect(screen.getByText("Not yet eligible")).toBeInTheDocument();
    expect(screen.getByText(/at least 2 verified check-ins/i)).toBeInTheDocument();
  });
});

describe("formatting and errors", () => {
  it("parses and formats MON without floating point error", () => {
    expect(parseMon("0.1")).toBe(100_000_000_000_000_000n);
    expect(parseMon("1.123456789012345678")).toBe(1_123_456_789_012_345_678n);
    expect(parseMon("abc")).toBeNull();
    expect(parseMon("1.1234567890123456789")).toBeNull();
    expect(formatMon(25_000_000_000_000_000n)).toBe("0.025");
    expect(formatMon(10n ** 18n)).toBe("1");
  });

  it("turns raw wallet and contract failures into actionable messages", () => {
    expect(friendlyError({ name: "UserRejectedRequestError", message: "User rejected the request." })).toMatch(/Nothing was sent/);
    expect(friendlyError({ message: "insufficient funds for gas" })).toMatch(/faucet/);
    expect(friendlyError({ shortMessage: "reverted: NotManager()" })).toMatch(/created this pool/);
    expect(friendlyError(new ApiError("Server said no", 409))).toBe("Server said no");
  });

  it("remembers a referral per event in this browser", () => {
    rememberReferral("harbour", "abcd2345");
    expect(recallReferral("harbour")).toBe("ABCD2345");
    expect(recallReferral("other")).toBe("");
  });
});

describe("event check-in form", () => {
  const event = {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "harbour",
    title: "Harbour Night",
    venue: "Annex",
    city: "Demo City",
    description: "A demo.",
    startsAt: new Date().toISOString(),
    checkInOpensAt: new Date(Date.now() - 1000).toISOString(),
    checkInClosesAt: new Date(Date.now() + 1e7).toISOString(),
    isDemo: true,
    organizerId: "org",
    creator: { id: "c", slug: "c", name: "Sable", category: "music", bio: "bio", artSeed: "c", externalUrl: null, isDemo: true },
  };
  const payload = { event, recommendations: [], checkinWindow: "open", checkinCounts: {}, myCheckin: null, isOrganizer: false };

  function mount(checkinResponse: { status: number; body: unknown }) {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body as string | undefined });
        const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
        if (url === "/api/me") return json(200, { viewer: { id: "u1", display_name: "Sam", role: "participant", wallet_address: null, is_demo: true } });
        if (url.startsWith("/api/events/")) return json(200, payload);
        if (url === "/api/checkins") return json(checkinResponse.status, checkinResponse.body);
        return json(404, { error: { message: "unexpected " + url } });
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/events/harbour?t=tok_abcdefghijklmnop&ref=abcd2345"]}>
          <SessionProvider>
            <Routes>
              <Route path="events/:slug" element={<EventPage />} />
            </Routes>
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return calls;
  }

  it("prefills the door code and referral from the link and submits them to the server", async () => {
    const calls = mount({ status: 201, body: { status: "verified", attribution: null, note: "Verified. Credited as a recorded referral." } });
    const user = userEvent.setup();
    await screen.findByLabelText("Door code");
    expect(screen.getByLabelText("Door code")).toHaveValue("tok_abcdefghijklmnop");
    expect(screen.getByLabelText(/Referral code/)).toHaveValue("ABCD2345");
    await user.click(screen.getByRole("button", { name: "Check in" }));
    await screen.findByText("You are checked in");
    const sent = JSON.parse(calls.find((c) => c.url === "/api/checkins")!.body!);
    expect(sent).toEqual({ eventId: event.id, token: "tok_abcdefghijklmnop", referralCode: "ABCD2345" });
  });

  it("shows a clear, specific message when the server rejects a replayed code", async () => {
    mount({ status: 409, body: { error: { message: "That check-in code was already used. Each code works once.", code: "token_used" } } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Check in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/already used/));
    expect(screen.getByRole("alert")).toHaveTextContent(/Ask the organiser for the current code/);
    expect(screen.queryByText("You are checked in")).not.toBeInTheDocument();
  });
});
