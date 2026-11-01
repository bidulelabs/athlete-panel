-- Refine invalidation without rewriting the applied history migration.
-- Transition tables retain one counter write per changed statement/event, not per row.
DROP TRIGGER history_changed ON garmin.coverage;
CREATE OR REPLACE FUNCTION garmin.advance_history_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  has_changes boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    has_changes := EXISTS (SELECT 1 FROM new_rows);
  ELSIF TG_OP='DELETE' THEN
    has_changes := EXISTS (SELECT 1 FROM old_rows);
  ELSIF TG_OP='UPDATE' THEN
    -- Compare review facts; operational timestamps are deliberately excluded.
    has_changes := EXISTS (
      SELECT stream, start_date, end_date, status, (scanned_at IS NOT NULL),
        CASE WHEN scan_state='in-progress' AND scanned_at IS NOT NULL THEN 'scanned' ELSE scan_state END FROM new_rows
      EXCEPT
      SELECT stream, start_date, end_date, status, (scanned_at IS NOT NULL),
        CASE WHEN scan_state='in-progress' AND scanned_at IS NOT NULL THEN 'scanned' ELSE scan_state END FROM old_rows
    );
  ELSE
    -- BEFORE TRUNCATE can distinguish an empty table; rollback also rolls back the counter.
    has_changes := EXISTS (SELECT 1 FROM garmin.coverage);
  END IF;
  IF has_changes THEN
    UPDATE garmin.history_version SET revision=revision+1 WHERE singleton=true;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER history_inserted AFTER INSERT ON garmin.coverage
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION garmin.advance_history_version();
CREATE TRIGGER history_updated AFTER UPDATE ON garmin.coverage
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION garmin.advance_history_version();
CREATE TRIGGER history_deleted AFTER DELETE ON garmin.coverage
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION garmin.advance_history_version();
CREATE TRIGGER history_truncated BEFORE TRUNCATE ON garmin.coverage
FOR EACH STATEMENT EXECUTE FUNCTION garmin.advance_history_version();
-- Existing review tokens must restart once across the coordinated protocol update.
UPDATE garmin.history_version SET revision=revision+1 WHERE singleton=true;
