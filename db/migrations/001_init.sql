-- OFFBEAT schema. Plain PostgreSQL: runs unchanged on Supabase Postgres and on embedded PGlite.
-- Writes happen only through the OFFBEAT API (service/owner role). Anonymous API roles are read-only
-- on public tables via RLS; nothing authoritative (scores, check-in validity, payouts) can be written by clients.

-- ---------- roles used by Supabase (created only if missing, e.g. on local PGlite) ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;

-- ---------- profiles ----------
CREATE TABLE profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name   text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 40),
  role           text NOT NULL CHECK (role IN ('curator','participant','sponsor')),
  wallet_address text UNIQUE CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  wallet_nonce   text,
  is_demo        boolean NOT NULL DEFAULT false,
  is_persona     boolean NOT NULL DEFAULT false, -- demo sign-in personas offered on the judge page
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------- creators & events ----------
CREATE TABLE creators (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  category     text NOT NULL CHECK (category IN ('music','visual-art','performance','craft','film','writing','food')),
  bio          text NOT NULL CHECK (char_length(bio) BETWEEN 10 AND 600),
  external_url text CHECK (external_url IS NULL OR external_url ~ '^https?://'),
  art_seed     text NOT NULL,
  is_demo      boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  creator_id        uuid NOT NULL REFERENCES creators(id),
  organizer_id      uuid NOT NULL REFERENCES profiles(id),
  title             text NOT NULL,
  venue             text NOT NULL,
  city              text NOT NULL,
  description       text NOT NULL,
  starts_at         timestamptz NOT NULL,
  check_in_opens_at timestamptz NOT NULL,
  check_in_closes_at timestamptz NOT NULL,
  is_demo           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (check_in_closes_at > check_in_opens_at)
);

-- ---------- recommendations & ratings ----------
CREATE TABLE recommendations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,100}$'),
  curator_id    uuid NOT NULL REFERENCES profiles(id),
  creator_id    uuid NOT NULL REFERENCES creators(id),
  event_id      uuid REFERENCES events(id),
  title         text NOT NULL CHECK (char_length(title) BETWEEN 4 AND 120),
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 40 AND 800),
  source_url    text CHECK (source_url IS NULL OR source_url ~ '^https?://'),
  referral_code text NOT NULL UNIQUE CHECK (referral_code ~ '^[A-Z2-9]{8}$'),
  status        text NOT NULL DEFAULT 'published' CHECK (status IN ('published','pending_review','rejected')),
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- duplicate detection: a curator cannot recommend the same creator+event twice
CREATE UNIQUE INDEX recommendations_no_dupes
  ON recommendations (curator_id, creator_id, COALESCE(event_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX recommendations_feed_idx ON recommendations (status, created_at DESC);
CREATE INDEX recommendations_creator_idx ON recommendations (creator_id, created_at);

CREATE TABLE ratings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  rater_id          uuid NOT NULL REFERENCES profiles(id),
  stars             int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  is_seed           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recommendation_id, rater_id)
);

CREATE FUNCTION forbid_self_rating() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rater_id = (SELECT curator_id FROM recommendations WHERE id = NEW.recommendation_id) THEN
    RAISE EXCEPTION 'curators cannot rate their own recommendation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ratings_no_self BEFORE INSERT OR UPDATE ON ratings FOR EACH ROW EXECUTE FUNCTION forbid_self_rating();

-- ---------- proof of discovery ----------
-- Door tokens: random, short-lived, single-use. Only the SHA-256 hash is stored.
CREATE TABLE checkin_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES events(id),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  issued_by  uuid NOT NULL REFERENCES profiles(id),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  used_by    uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((used_at IS NULL) = (used_by IS NULL))
);

CREATE TABLE checkins (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES events(id),
  user_id           uuid NOT NULL REFERENCES profiles(id),
  recommendation_id uuid REFERENCES recommendations(id),
  token_id          uuid NOT NULL UNIQUE REFERENCES checkin_tokens(id),
  status            text NOT NULL CHECK (status IN ('verified','excluded_self_referral','pending_review')),
  is_seed           boolean NOT NULL DEFAULT false, -- true only for seeded demo evidence
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX checkins_rec_idx ON checkins (recommendation_id) WHERE status = 'verified';

-- Defence in depth: a curator can never hold a 'verified' check-in on their own recommendation.
CREATE FUNCTION forbid_verified_self_referral() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'verified' AND NEW.recommendation_id IS NOT NULL
     AND NEW.user_id = (SELECT curator_id FROM recommendations WHERE id = NEW.recommendation_id) THEN
    RAISE EXCEPTION 'self-referral cannot be verified' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checkins_no_self_referral BEFORE INSERT OR UPDATE ON checkins FOR EACH ROW EXECUTE FUNCTION forbid_verified_self_referral();

-- ---------- rewards ----------
CREATE TABLE reward_pools (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id       uuid NOT NULL REFERENCES profiles(id),
  event_id         uuid NOT NULL REFERENCES events(id),
  title            text NOT NULL CHECK (char_length(title) BETWEEN 4 AND 120),
  description      text NOT NULL DEFAULT '',
  budget_wei       numeric(78,0) NOT NULL CHECK (budget_wei > 0),
  funded_wei       numeric(78,0) NOT NULL DEFAULT 0 CHECK (funded_wei >= 0),
  chain_id         int NOT NULL,
  contract_address text CHECK (contract_address IS NULL OR contract_address ~ '^0x[0-9a-f]{40}$'),
  contract_pool_id bigint,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','allocated','closed')),
  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((contract_address IS NULL) = (contract_pool_id IS NULL)),
  UNIQUE (contract_address, contract_pool_id)
);

CREATE TABLE distributions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id         uuid NOT NULL REFERENCES reward_pools(id),
  status          text NOT NULL CHECK (status IN ('approved','submitted','confirmed','failed')),
  budget_wei      numeric(78,0) NOT NULL CHECK (budget_wei >= 0),
  total_wei       numeric(78,0) NOT NULL CHECK (total_wei >= 0 AND total_wei <= budget_wei),
  formula_version text NOT NULL,
  snapshot        jsonb NOT NULL,
  approved_by     uuid NOT NULL REFERENCES profiles(id),
  tx_hash         text CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
  is_demo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- At most one live distribution per pool (the contract allows one allocation per recipient per pool).
CREATE UNIQUE INDEX distributions_one_live_per_pool ON distributions (pool_id) WHERE status IN ('approved','submitted','confirmed');

CREATE TABLE distribution_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id   uuid NOT NULL REFERENCES distributions(id) ON DELETE CASCADE,
  recommendation_id uuid NOT NULL REFERENCES recommendations(id),
  curator_id        uuid NOT NULL REFERENCES profiles(id),
  wallet_address    text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  amount_wei        numeric(78,0) NOT NULL CHECK (amount_wei > 0),
  score_total       numeric(6,2) NOT NULL,
  breakdown         jsonb NOT NULL,
  UNIQUE (distribution_id, recommendation_id)
);

-- Real, receipt-verified chain activity only. Rows are inserted by the server AFTER it reads the receipt.
CREATE TABLE chain_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('create_pool','fund_pool','allocate','claim','close_pool')),
  tx_hash       text NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  chain_id      int NOT NULL,
  pool_id       uuid REFERENCES reward_pools(id),
  distribution_id uuid REFERENCES distributions(id),
  actor_address text NOT NULL CHECK (actor_address ~ '^0x[0-9a-f]{40}$'),
  amount_wei    numeric(78,0) NOT NULL DEFAULT 0,
  block_number  bigint NOT NULL,
  status        text NOT NULL CHECK (status IN ('confirmed','failed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tx_hash, kind, actor_address)
);

-- ---------- audit (append-only) ----------
CREATE TABLE audit_events (
  id          bigserial PRIMARY KEY,
  actor_id    uuid,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_events is append-only'; END $$;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_append_only();

-- ---------- RLS: public read of public data only; no client writes ----------
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE creators           ENABLE ROW LEVEL SECURITY;
ALTER TABLE events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_tokens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins           ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_pools       ENABLE ROW LEVEL SECURITY;
ALTER TABLE distributions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribution_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE chain_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events       ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT ON creators, events, recommendations, reward_pools, distributions, distribution_items, chain_transactions TO anon, authenticated;

CREATE POLICY public_read_creators ON creators FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY public_read_events ON events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY public_read_published_recs ON recommendations FOR SELECT TO anon, authenticated USING (status = 'published');
CREATE POLICY public_read_pools ON reward_pools FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY public_read_distributions ON distributions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY public_read_distribution_items ON distribution_items FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY public_read_chain_tx ON chain_transactions FOR SELECT TO anon, authenticated USING (true);
-- profiles, ratings, checkin_tokens, checkins, audit_events: NO policies => unreadable/unwritable by anon/authenticated.

-- Wallet nonces and token hashes are never exposed; this view is the public face of a profile.
CREATE VIEW public_profiles AS SELECT id, display_name, role, wallet_address, is_demo FROM profiles;
GRANT SELECT ON public_profiles TO anon, authenticated;
