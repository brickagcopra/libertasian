-- Phase 2: capture login events + IP + geo, surface in admin Users
-- All new columns/table are additive and nullable; no backfill (no historical IP exists).

ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(64);
ALTER TABLE users ADD COLUMN last_login_country VARCHAR(8);

CREATE TABLE login_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type          VARCHAR(40) NOT NULL,
  ip_address          VARCHAR(64),
  user_agent          TEXT,
  country             VARCHAR(8),
  region              VARCHAR(64),
  city                VARCHAR(128),
  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,
  device_fingerprint  VARCHAR(500),
  failure_reason      VARCHAR(255),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_event_user_created ON login_events(user_id, created_at DESC);
CREATE INDEX idx_login_event_created      ON login_events(created_at);
CREATE INDEX idx_login_event_ip           ON login_events(ip_address);
