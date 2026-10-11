import type { Db } from "../db";
import type { Viewer } from "../auth";
import { HttpError, newToken, sha256Hex } from "../util";
import { audit } from "./data";

export const TOKEN_TTL_SECONDS = 90;

/** Organiser's door screen asks for a fresh, short-lived, single-use token. Raw token is returned once; only its hash is stored. */
export async function issueDoorToken(db: Db, viewer: Viewer, eventId: string) {
  const ev = (await db.query<{ id: string; organizer_id: string }>("SELECT id, organizer_id FROM events WHERE id = $1", [eventId]))[0];
  if (!ev) throw new HttpError(404, "Event not found.");
  if (ev.organizer_id !== viewer.id) throw new HttpError(403, "Only the event organiser can issue door tokens.", "forbidden");
  const token = newToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);
  await db.query("INSERT INTO checkin_tokens (event_id, token_hash, issued_by, expires_at) VALUES ($1,$2,$3,$4)", [eventId, sha256Hex(token), viewer.id, expiresAt]);
  // housekeeping: drop stale unused tokens
  await db.query("DELETE FROM checkin_tokens WHERE used_at IS NULL AND expires_at < now() - interval '1 hour'");
  return { token, expiresAt: expiresAt.toISOString(), ttlSeconds: TOKEN_TTL_SECONDS };
}

export type CheckinOutcome = {
  status: "verified" | "excluded_self_referral";
  attribution: { recommendationId: string; recommendationSlug: string; title: string; curatorName: string } | null;
  note: string;
};

type Reject = "invalid_token" | "token_expired" | "token_used" | "duplicate_checkin" | "window_closed" | "window_not_open" | "organizer_cannot_checkin";
const MESSAGES: Record<Reject, [HttpError["status"], string]> = {
  invalid_token: [400, "That check-in code is not valid for this event."],
  token_expired: [410, "That check-in code has expired. Ask the organiser to refresh the QR code."],
  token_used: [409, "That check-in code was already used. Each code works once."],
  duplicate_checkin: [409, "You have already checked in to this event."],
  window_closed: [410, "Check-in for this event has closed."],
  window_not_open: [409, "Check-in for this event has not opened yet."],
  organizer_cannot_checkin: [403, "Organisers cannot check in to their own event."],
};
const reject = (code: Reject) => new HttpError(MESSAGES[code][0], MESSAGES[code][1], code);

/**
 * Server-side validation of a check-in. Everything authoritative happens here, in one transaction:
 * the token is consumed atomically (`UPDATE ... WHERE used_at IS NULL`), the unique (event_id,user_id)
 * constraint stops duplicates, and a failed insert rolls the token consumption back.
 */
export async function performCheckin(db: Db, viewer: Viewer, input: { eventId: string; token: string; referralCode?: string | null }): Promise<CheckinOutcome> {
  try {
    const outcome = await db.tx(async (t) => {
      const ev = (await t.query<{ id: string; organizer_id: string; opens: Date; closes: Date }>("SELECT id, organizer_id, check_in_opens_at AS opens, check_in_closes_at AS closes FROM events WHERE id = $1", [input.eventId]))[0];
      if (!ev) throw new HttpError(404, "Event not found.");
      if (ev.organizer_id === viewer.id) throw reject("organizer_cannot_checkin");
      const now = Date.now();
      if (now < ev.opens.getTime()) throw reject("window_not_open");
      if (now > ev.closes.getTime()) throw reject("window_closed");

      const hash = sha256Hex(input.token);
      const tok = (await t.query<{ id: string; expires_at: Date; used_at: Date | null }>("SELECT id, expires_at, used_at FROM checkin_tokens WHERE token_hash = $1 AND event_id = $2", [hash, input.eventId]))[0];
      if (!tok) throw reject("invalid_token");
      if (tok.used_at) throw reject("token_used");
      if (tok.expires_at.getTime() <= now) throw reject("token_expired");

      const prior = await t.query("SELECT 1 FROM checkins WHERE event_id = $1 AND user_id = $2", [input.eventId, viewer.id]);
      if (prior.length) throw reject("duplicate_checkin");

      const consumed = await t.query("UPDATE checkin_tokens SET used_at = now(), used_by = $1 WHERE id = $2 AND used_at IS NULL AND expires_at > now() RETURNING id", [viewer.id, tok.id]);
      if (!consumed.length) throw reject("token_used"); // lost a race

      let rec: { id: string; slug: string; title: string; curator_id: string; curator_name: string } | undefined;
      let note = "Checked in. No referral link was used, so no recommendation is credited.";
      if (input.referralCode) {
        rec = (
          await t.query<{ id: string; slug: string; title: string; curator_id: string; curator_name: string }>(
            "SELECT r.id, r.slug, r.title, r.curator_id, p.display_name AS curator_name FROM recommendations r JOIN profiles p ON p.id = r.curator_id WHERE r.referral_code = $1 AND r.status = 'published' AND r.event_id = $2",
            [input.referralCode.toUpperCase(), input.eventId],
          )
        )[0];
        if (!rec) note = "Checked in. The referral code does not match a published recommendation for this event, so no recommendation is credited.";
      }

      const selfReferral = rec?.curator_id === viewer.id;
      const status = selfReferral ? "excluded_self_referral" : "verified";
      try {
        await t.query("INSERT INTO checkins (event_id, user_id, recommendation_id, token_id, status) VALUES ($1,$2,$3,$4,$5)", [input.eventId, viewer.id, rec?.id ?? null, tok.id, status]);
      } catch (e) {
        if (/checkins_event_id_user_id_key|duplicate key/i.test((e as Error).message)) throw reject("duplicate_checkin");
        throw e;
      }
      if (rec) note = selfReferral ? "Checked in, but you cannot earn credit for your own recommendation, so this does not count toward its score." : `Verified. Credited as a recorded referral from ${rec.curator_name}'s recommendation. This is evidence of a referral, not proof that it caused you to attend.`;
      return {
        status: status as CheckinOutcome["status"],
        attribution: rec ? { recommendationId: rec.id, recommendationSlug: rec.slug, title: rec.title, curatorName: rec.curator_name } : null,
        note,
      } satisfies CheckinOutcome;
    });
    await audit(db, viewer.id, "checkin.accepted", "event", input.eventId, { status: outcome.status, attributed: Boolean(outcome.attribution) });
    return outcome;
  } catch (e) {
    if (e instanceof HttpError && e.code) await audit(db, viewer.id, "checkin.rejected", "event", input.eventId, { reason: e.code });
    throw e;
  }
}
