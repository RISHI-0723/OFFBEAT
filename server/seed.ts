import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import { newReferralCode, sha256Hex } from "./util";

/**
 * Seeds FICTIONAL demo content. Every creator, event, profile and check-in created here is flagged
 * (is_demo / is_seed) and labelled as demo in the UI. No real people, venues or organisations are depicted.
 */
export async function seedDemo(db: Db): Promise<boolean> {
  const existing = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM profiles");
  if (existing[0]!.n > 0) return false;

  await db.tx(async (t) => {
    const profile = async (name: string, role: string, persona: boolean) =>
      (await t.query<{ id: string }>("INSERT INTO profiles (display_name, role, is_demo, is_persona) VALUES ($1,$2,true,$3) RETURNING id", [name, role, persona]))[0]!.id;

    const noor = await profile("Noor Hadley", "curator", true);
    const teo = await profile("Teo Marchetti", "curator", true);
    const ines = await profile("Ines Valdivia", "curator", true);
    const sponsor = await profile("Harbourlight Arts Fund (demo)", "sponsor", true);
    const attendees: string[] = [];
    for (let i = 1; i <= 12; i++) attendees.push(await profile(`Seed attendee ${String(i).padStart(2, "0")}`, "participant", false));
    await profile("Sam Okafor (demo attendee)", "participant", true);

    const creator = async (slug: string, name: string, category: string, bio: string, url: string | null) =>
      (await t.query<{ id: string }>("INSERT INTO creators (slug, name, category, bio, external_url, art_seed, is_demo) VALUES ($1,$2,$3,$4,$5,$1,true) RETURNING id", [slug, name, category, bio, url]))[0]!.id;

    const sable = await creator("sable-quartet", "Sable Quartet", "music", "A string quartet that scores field recordings: tide tables, ferry horns and rigging hum become written parts. Fictional demo artist.", "https://example.org/sable-quartet");
    const lumen = await creator("lumen-and-loam", "Lumen & Loam", "craft", "Three dyers working with mud, madder and onion skins to make hand-dyed cloth in small, unrepeatable batches. Fictional demo collective.", null);
    const pilar = await creator("pilar-restrepo", "Pilar Restrepo", "visual-art", "Risograph printmaker making two-colour posters for gigs that never get posters. Fictional demo artist.", null);
    const orchard = await creator("the-paper-orchard", "The Paper Orchard", "performance", "A shadow-theatre company performing in courtyards with cut paper, desk lamps and a live accordion. Fictional demo company.", null);
    const anwar = await creator("anwar-beyene", "Anwar Beyene", "writing", "Poet-in-residence of a laundromat reading series; short, plain, funny poems about shared machines. Fictional demo writer.", null);
    const cinder = await creator("cinder-street-cine-club", "Cinder Street Cine-Club", "film", "A volunteer cine-club projecting 16mm shorts from donated reels, followed by an unmoderated argument. Fictional demo collective.", null);
    const kasi = await creator("kasis-fermentation-table", "Kasi's Fermentation Table", "food", "A pop-up table of ferments, pickles and shrubs with handwritten tasting notes. Fictional demo project.", null);
    const mireille = await creator("mireille-and-the-slow-machines", "Mireille & the Slow Machines", "music", "An analogue synth duo building eight-minute pieces from drifting oscillators and tape hiss. Fictional demo act.", null);

    const day = 86_400_000;
    const now = Date.now();
    const event = async (slug: string, creatorId: string, title: string, venue: string, city: string, description: string, startsInDays: number) =>
      (
        await t.query<{ id: string }>(
          "INSERT INTO events (slug, creator_id, organizer_id, title, venue, city, description, starts_at, check_in_opens_at, check_in_closes_at, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING id",
          [slug, creatorId, sponsor, title, venue, city, description, new Date(now + startsInDays * day), new Date(now - day), new Date(now + 60 * day)],
        )
      )[0]!.id;

    const e1 = await event("harbour-field-recordings", sable, "Harbour Field Recordings: A Listening Night", "Dockside Annex (fictional venue)", "Demo City", "Sable Quartet perform scores written from a season of harbour recordings. Seated, unamplified, 70 minutes. Demo event: check-in window is held open for judging.", 3);
    const e2 = await event("lantern-nights", orchard, "Lantern Nights: Shadow Theatre in the Courtyard", "The Brick Courtyard (fictional venue)", "Demo City", "The Paper Orchard perform two short shadow plays by lamplight. Bring a cushion. Demo event: check-in window is held open for judging.", 6);
    const e3 = await event("16mm-night", cinder, "16mm Night: Three Shorts, No Trailers", "Cinder Street Back Room (fictional venue)", "Demo City", "Three donated 16mm shorts, then an unmoderated argument about them. Demo event: check-in window is held open for judging.", 9);

    const rec = async (slug: string, curator: string, creatorId: string, eventId: string | null, title: string, reason: string, ageDays: number) =>
      (
        await t.query<{ id: string }>(
          "INSERT INTO recommendations (slug, curator_id, creator_id, event_id, title, reason, referral_code, created_at, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id",
          [slug, curator, creatorId, eventId, title, reason, newReferralCode(), new Date(now - ageDays * day)],
        )
      )[0]!.id;

    const r1 = await rec("four-strings-one-tide-table", noor, sable, e1, "Four strings, one tide table", "I heard them play a ferry horn as a cello line and could not stop thinking about it for a week. They write parts from real harbour recordings, so every concert sounds like only this one place. Go early; the room is small and silent.", 9);
    const r2 = await rec("the-quartet-that-listens-to-the-docks", teo, sable, e1, "The quartet that listens to the docks", "Most contemporary string music asks you to admire it. This asks you to listen to the city differently afterwards. I took two sceptical friends and both bought the score booklet.", 6);
    const r3 = await rec("shadow-plays-by-desk-lamp", ines, orchard, e2, "Shadow plays by desk lamp", "Cut paper, desk lamps and one accordion, and somehow a courtyard of adults goes completely quiet. It is the most handmade theatre I have seen, and it will not stay this small for long.", 5);
    const r4 = await rec("an-argument-after-the-reel", noor, cinder, e3, "An argument after the reel", "They screen donated 16mm shorts nobody else would show, then let the room argue about them. It is how I found two filmmakers I now follow, and it costs almost nothing to attend.", 4);
    await rec("mud-madder-and-onion-skins", teo, lumen, null, "Mud, madder and onion skins", "The colours are not repeatable, which is the point. Each batch is documented on a handwritten card, so you can see the dye pot that your scarf came from.", 8);
    await rec("poems-about-shared-machines", ines, anwar, null, "Poems about shared machines", "Short plain poems read between spin cycles. The laundromat series is free, mostly attended by neighbours, and quietly one of the best writing nights in the city.", 7);
    await rec("eight-minutes-of-drift", noor, mireille, null, "Eight minutes of drift", "Their pieces use detuned analogue oscillators and tape hiss and take about three minutes before you realise nothing is repeating. Headphones recommended.", 3);
    await rec("two-colour-posters-for-small-gigs", ines, pilar, null, "Two-colour posters for small gigs", "She prints posters for the gigs that never get posters, in two colours, by hand. The back catalogue is a map of the city's smaller rooms.", 2);
    await rec("ferments-with-handwritten-notes", teo, kasi, null, "Ferments with handwritten notes", "A folding table of pickles and shrubs, each with a tasting note in pencil. The sour plum shrub was the best thing I ate all month.", 1);

    const checkin = async (user: string, eventId: string, recId: string | null) => {
      const tokenId = (
        await t.query<{ id: string }>("INSERT INTO checkin_tokens (event_id, token_hash, issued_by, expires_at, used_at, used_by) VALUES ($1,$2,$3,$4,now(),$5) RETURNING id", [eventId, sha256Hex(randomBytes(16).toString("hex")), sponsor, new Date(now + day), user])
      )[0]!.id;
      await t.query("INSERT INTO checkins (event_id, user_id, recommendation_id, token_id, status, is_seed) VALUES ($1,$2,$3,$4,'verified',true)", [eventId, user, recId, tokenId]);
    };
    const a = attendees;
    for (const i of [0, 1, 2, 3, 4]) await checkin(a[i]!, e1, r1);
    for (const i of [5, 6, 7]) await checkin(a[i]!, e1, r2);
    for (const i of [8, 9, 10]) await checkin(a[i]!, e2, r3);
    await checkin(a[11]!, e3, r4);
    await checkin(a[4]!, e3, r4);

    const rate = async (recId: string, user: string, stars: number) => t.query("INSERT INTO ratings (recommendation_id, rater_id, stars, is_seed) VALUES ($1,$2,$3,true)", [recId, user, stars]);
    for (const [i, s] of [[0, 5], [1, 4], [2, 5], [3, 4]] as const) await rate(r1, a[i]!, s);
    for (const [i, s] of [[5, 4], [6, 4], [7, 3]] as const) await rate(r2, a[i]!, s);
    for (const [i, s] of [[8, 5], [9, 5], [10, 4]] as const) await rate(r3, a[i]!, s);
    await rate(r4, a[11]!, 4);

    const pool = (title: string, description: string, eventId: string, mon: string) =>
      t.query("INSERT INTO reward_pools (sponsor_id, event_id, title, description, budget_wei, chain_id, is_demo) VALUES ($1,$2,$3,$4,$5,10143,true)", [sponsor, eventId, title, description, (BigInt(Math.round(Number(mon) * 1e6)) * 10n ** 12n).toString()]);
    await pool("Harbour Listening Night: Discovery Fund (demo)", "Rewards curators whose recommendations brought verified attendees to the listening night. Testnet MON only.", e1, "0.2");
    await pool("Lantern Nights: Discovery Fund (demo)", "A second demo pool, left open so you can walk through create, fund, approve and allocate yourself. Testnet MON only.", e2, "0.1");
  });
  return true;
}
