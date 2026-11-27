ALTER TABLE apple_health.workouts
  ADD COLUMN recording_source text,
  ADD COLUMN issues jsonb NOT NULL DEFAULT '{}';

CREATE INDEX workouts_with_issues ON apple_health.workouts (sent_at DESC, uuid)
  WHERE issues <> '{}';

-- The phone can delete a sample before its first workout payload arrives.
-- A fingerprint is enough to recognize a retry without retaining the unknown sample ID.
CREATE TABLE apple_health.deleted_samples (uuid_hash text PRIMARY KEY);

UPDATE apple_health.connection SET last_upload_at = NULL
WHERE imported_from IS NULL
  AND NOT EXISTS (SELECT FROM apple_health.workouts)
  AND NOT EXISTS (SELECT FROM apple_health.sources);
