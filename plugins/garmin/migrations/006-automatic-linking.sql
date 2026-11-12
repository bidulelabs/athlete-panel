-- Only new imports are staged. Existing activity history is deliberately not backfilled.
CREATE TABLE garmin.activity_matches (
  activity_id uuid PRIMARY KEY,
  import_job_id uuid NOT NULL,
  phase text NOT NULL,
  source_account_id text NOT NULL,
  local_date date NOT NULL,
  ready boolean NOT NULL DEFAULT false
);
CREATE INDEX activity_matches_scan ON garmin.activity_matches(import_job_id, phase);
CREATE INDEX activity_matches_ready ON garmin.activity_matches(local_date) WHERE ready;
