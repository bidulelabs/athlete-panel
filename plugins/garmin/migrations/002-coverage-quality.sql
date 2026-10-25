ALTER TABLE garmin.coverage ADD COLUMN missing_days integer NOT NULL DEFAULT 0;
ALTER TABLE garmin.coverage ADD COLUMN unknown_metrics integer NOT NULL DEFAULT 0;
