CREATE SCHEMA IF NOT EXISTS apple_health;

CREATE TABLE apple_health.connection (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  token_hash text,
  tested_at timestamptz,
  last_upload_at timestamptz,
  imported_from date,
  imported_to date,
  last_batch jsonb,
  last_error text
);
INSERT INTO apple_health.connection DEFAULT VALUES;

CREATE TABLE apple_health.sources (
  name text PRIMARY KEY,
  excluded boolean NOT NULL DEFAULT false
);

CREATE TABLE apple_health.workouts (
  uuid uuid PRIMARY KEY,
  activity_id uuid NOT NULL UNIQUE,
  sent_at timestamptz NOT NULL,
  deleted boolean NOT NULL DEFAULT false
);
