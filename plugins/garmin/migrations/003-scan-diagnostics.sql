ALTER TABLE garmin.coverage
  ADD COLUMN scan_state text NOT NULL DEFAULT 'unscanned',
  ADD COLUMN scanned_at timestamptz,
  ADD COLUMN rejected_records integer NOT NULL DEFAULT 0,
  ADD COLUMN diagnostics jsonb NOT NULL DEFAULT '[]';
-- Health windows finish in one request. Nonempty legacy activity pages do not prove exhaustion.
UPDATE garmin.coverage SET scan_state='scanned',scanned_at=updated_at
WHERE (stream IN ('sleep','daily','hrv','steps','stress','bodyBattery') AND status IN ('available','partial','no-data','complete'))
   OR (stream='activities' AND status IN ('complete','no-data'));
UPDATE garmin.coverage SET scan_state=status WHERE status IN ('failed','unavailable');
