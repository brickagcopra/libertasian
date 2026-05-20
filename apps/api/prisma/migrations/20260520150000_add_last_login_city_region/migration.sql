-- Phase 2.1 polish: surface full IP location (city · region · country) in admin Users page.
-- Additive nullable columns. No backfill — no historical city/region exists for users who
-- haven't logged in since PR #159 landed; they'll be filled on next login_success.

ALTER TABLE users ADD COLUMN last_login_city VARCHAR(128);
ALTER TABLE users ADD COLUMN last_login_region VARCHAR(64);
