-- Shared fixed-window rate limiting for serverless (in-memory counters are per-instance and ineffective there).
-- Additive only. Server-side access only: RLS on, no policies, no grants for API roles.
CREATE TABLE rate_limits (
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         int         NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rate_limits FROM anon, authenticated;
