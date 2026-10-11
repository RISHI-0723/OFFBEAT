import { scoreRecommendation, type ScoreResult } from "../../shared/scoring";
import type { Db } from "../db";

export interface CreatorDto {
  id: string;
  slug: string;
  name: string;
  category: string;
  bio: string;
  artSeed: string;
  externalUrl: string | null;
  isDemo: boolean;
}
export interface EventDto {
  id: string;
  slug: string;
  title: string;
  venue: string;
  city: string;
  description: string;
  startsAt: string;
  checkInOpensAt: string;
  checkInClosesAt: string;
  isDemo: boolean;
  creator: CreatorDto;
  organizerId: string;
}
export interface RecommendationDto {
  id: string;
  slug: string;
  title: string;
  reason: string;
  sourceUrl: string | null;
  referralCode: string;
  status: string;
  isDemo: boolean;
  createdAt: string;
  curator: { id: string; displayName: string; isDemo: boolean };
  creator: CreatorDto;
  event: { id: string; slug: string; title: string; venue: string; city: string; startsAt: string } | null;
  stats: { verifiedCheckins: number; raters: number; averageStars: number | null };
  score: ScoreResult;
}

interface RecRow {
  id: string;
  slug: string;
  title: string;
  reason: string;
  source_url: string | null;
  referral_code: string;
  status: "published" | "pending_review" | "rejected";
  is_demo: boolean;
  created_at: Date;
  curator_id: string;
  curator_name: string;
  curator_demo: boolean;
  creator_id: string;
  creator_slug: string;
  creator_name: string;
  creator_category: string;
  creator_bio: string;
  creator_art_seed: string;
  creator_url: string | null;
  creator_demo: boolean;
  event_id: string | null;
  event_slug: string | null;
  event_title: string | null;
  event_venue: string | null;
  event_city: string | null;
  event_starts_at: Date | null;
}

const REC_SELECT = `
  SELECT r.id, r.slug, r.title, r.reason, r.source_url, r.referral_code, r.status, r.is_demo, r.created_at,
         p.id AS curator_id, p.display_name AS curator_name, p.is_demo AS curator_demo,
         c.id AS creator_id, c.slug AS creator_slug, c.name AS creator_name, c.category AS creator_category,
         c.bio AS creator_bio, c.art_seed AS creator_art_seed, c.external_url AS creator_url, c.is_demo AS creator_demo,
         e.id AS event_id, e.slug AS event_slug, e.title AS event_title, e.venue AS event_venue, e.city AS event_city, e.starts_at AS event_starts_at
  FROM recommendations r
  JOIN profiles p ON p.id = r.curator_id
  JOIN creators c ON c.id = r.creator_id
  LEFT JOIN events e ON e.id = r.event_id`;

export const toCreator = (r: { id: string; slug: string; name: string; category: string; bio: string; art_seed: string; external_url: string | null; is_demo: boolean }): CreatorDto => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  category: r.category,
  bio: r.bio,
  artSeed: r.art_seed,
  externalUrl: r.external_url,
  isDemo: r.is_demo,
});

/** Evidence loaded once for the whole platform; scores are then computed by the pure function. */
async function loadEvidence(db: Db) {
  const [ratings, checkins, recs] = await Promise.all([
    db.query<{ recommendation_id: string; stars: number }>("SELECT recommendation_id, stars FROM ratings ORDER BY created_at, id"),
    db.query<{ recommendation_id: string; n: number }>(
      "SELECT recommendation_id, count(*)::int AS n FROM checkins WHERE status = 'verified' AND recommendation_id IS NOT NULL GROUP BY recommendation_id",
    ),
    db.query<{ id: string; creator_id: string; category: string; status: RecRow["status"]; created_at: Date }>(
      "SELECT r.id, r.creator_id, c.category, r.status, r.created_at FROM recommendations r JOIN creators c ON c.id = r.creator_id ORDER BY r.created_at, r.id",
    ),
  ]);
  const ratingsBy = new Map<string, number[]>();
  for (const r of ratings) ratingsBy.set(r.recommendation_id, [...(ratingsBy.get(r.recommendation_id) ?? []), r.stars]);
  const checkinsBy = new Map(checkins.map((c) => [c.recommendation_id, c.n]));
  const published = recs.filter((r) => r.status === "published");
  const categoryCount = new Map<string, number>();
  for (const r of published) categoryCount.set(r.category, (categoryCount.get(r.category) ?? 0) + 1);
  const seenByCreator = new Map<string, number>();
  const priorBy = new Map<string, number>();
  for (const r of recs) {
    priorBy.set(r.id, seenByCreator.get(r.creator_id) ?? 0);
    seenByCreator.set(r.creator_id, (seenByCreator.get(r.creator_id) ?? 0) + 1);
  }
  return { ratingsBy, checkinsBy, categoryCount, priorBy, total: published.length, categoryOf: new Map(recs.map((r) => [r.id, r.category])), statusOf: new Map(recs.map((r) => [r.id, r.status])) };
}

export type Evidence = Awaited<ReturnType<typeof loadEvidence>>;

export function scoreFor(ev: Evidence, recId: string): ScoreResult {
  const category = ev.categoryOf.get(recId) ?? "";
  return scoreRecommendation({
    ratings: ev.ratingsBy.get(recId) ?? [],
    verifiedCheckins: ev.checkinsBy.get(recId) ?? 0,
    priorRecommendationsForCreator: ev.priorBy.get(recId) ?? 0,
    categoryRecommendationCount: ev.categoryCount.get(category) ?? 0,
    totalRecommendationCount: ev.total,
    status: ev.statusOf.get(recId) ?? "rejected",
  });
}

function toRec(r: RecRow, ev: Evidence): RecommendationDto {
  const ratings = ev.ratingsBy.get(r.id) ?? [];
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    reason: r.reason,
    sourceUrl: r.source_url,
    referralCode: r.referral_code,
    status: r.status,
    isDemo: r.is_demo,
    createdAt: r.created_at.toISOString(),
    curator: { id: r.curator_id, displayName: r.curator_name, isDemo: r.curator_demo },
    creator: toCreator({ id: r.creator_id, slug: r.creator_slug, name: r.creator_name, category: r.creator_category, bio: r.creator_bio, art_seed: r.creator_art_seed, external_url: r.creator_url, is_demo: r.creator_demo }),
    event: r.event_id ? { id: r.event_id, slug: r.event_slug!, title: r.event_title!, venue: r.event_venue!, city: r.event_city!, startsAt: r.event_starts_at!.toISOString() } : null,
    stats: {
      verifiedCheckins: ev.checkinsBy.get(r.id) ?? 0,
      raters: ratings.length,
      averageStars: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    },
    score: scoreFor(ev, r.id),
  };
}

export async function listRecommendations(db: Db, opts: { category?: string; q?: string; curatorId?: string; includeUnpublished?: boolean; eventId?: string; creatorId?: string } = {}): Promise<RecommendationDto[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!opts.includeUnpublished) where.push("r.status = 'published'");
  const add = (value: unknown, clause: (n: number) => string) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (opts.category) add(opts.category, (n) => `c.category = $${n}`);
  if (opts.curatorId) add(opts.curatorId, (n) => `r.curator_id = $${n}`);
  if (opts.eventId) add(opts.eventId, (n) => `r.event_id = $${n}`);
  if (opts.creatorId) add(opts.creatorId, (n) => `r.creator_id = $${n}`);
  if (opts.q) add(`%${opts.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`, (n) => `(r.title ILIKE $${n} OR r.reason ILIKE $${n} OR c.name ILIKE $${n})`);
  const [rows, ev] = await Promise.all([
    db.query<RecRow>(`${REC_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY r.created_at DESC, r.id`, params),
    loadEvidence(db),
  ]);
  return rows.map((r) => toRec(r, ev));
}

export async function getRecommendation(db: Db, slugOrId: string): Promise<RecommendationDto | null> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId);
  const [rows, ev] = await Promise.all([db.query<RecRow>(`${REC_SELECT} WHERE ${isUuid ? "r.id" : "r.slug"} = $1`, [slugOrId]), loadEvidence(db)]);
  return rows[0] ? toRec(rows[0], ev) : null;
}

export async function getEvidence(db: Db): Promise<Evidence> {
  return loadEvidence(db);
}

const EVENT_SELECT = `SELECT e.*, c.id AS c_id, c.slug AS c_slug, c.name AS c_name, c.category AS c_category, c.bio AS c_bio, c.art_seed AS c_art_seed, c.external_url AS c_url, c.is_demo AS c_demo
  FROM events e JOIN creators c ON c.id = e.creator_id`;

interface EventRow {
  id: string;
  slug: string;
  title: string;
  venue: string;
  city: string;
  description: string;
  starts_at: Date;
  check_in_opens_at: Date;
  check_in_closes_at: Date;
  is_demo: boolean;
  organizer_id: string;
  c_id: string;
  c_slug: string;
  c_name: string;
  c_category: string;
  c_bio: string;
  c_art_seed: string;
  c_url: string | null;
  c_demo: boolean;
}
const toEvent = (e: EventRow): EventDto => ({
  id: e.id,
  slug: e.slug,
  title: e.title,
  venue: e.venue,
  city: e.city,
  description: e.description,
  startsAt: e.starts_at.toISOString(),
  checkInOpensAt: e.check_in_opens_at.toISOString(),
  checkInClosesAt: e.check_in_closes_at.toISOString(),
  isDemo: e.is_demo,
  organizerId: e.organizer_id,
  creator: toCreator({ id: e.c_id, slug: e.c_slug, name: e.c_name, category: e.c_category, bio: e.c_bio, art_seed: e.c_art_seed, external_url: e.c_url, is_demo: e.c_demo }),
});

export async function listEvents(db: Db): Promise<EventDto[]> {
  return (await db.query<EventRow>(`${EVENT_SELECT} ORDER BY e.starts_at`)).map(toEvent);
}
export async function getEvent(db: Db, slugOrId: string): Promise<EventDto | null> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId);
  const rows = await db.query<EventRow>(`${EVENT_SELECT} WHERE ${isUuid ? "e.id" : "e.slug"} = $1`, [slugOrId]);
  return rows[0] ? toEvent(rows[0]) : null;
}

export async function listCreators(db: Db): Promise<CreatorDto[]> {
  const rows = await db.query<{ id: string; slug: string; name: string; category: string; bio: string; art_seed: string; external_url: string | null; is_demo: boolean }>("SELECT * FROM creators ORDER BY name");
  return rows.map(toCreator);
}
export async function getCreator(db: Db, slugOrId: string): Promise<CreatorDto | null> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId);
  const rows = await db.query<{ id: string; slug: string; name: string; category: string; bio: string; art_seed: string; external_url: string | null; is_demo: boolean }>(`SELECT * FROM creators WHERE ${isUuid ? "id" : "slug"} = $1`, [slugOrId]);
  return rows[0] ? toCreator(rows[0]) : null;
}

export async function audit(db: Db, actorId: string | null, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
  await db.query("INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5::jsonb)", [actorId, action, entityType, entityId, JSON.stringify(metadata)]);
}
