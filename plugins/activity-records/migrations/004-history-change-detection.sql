-- Refine invalidation without rewriting the applied history migration.
-- Transition tables retain one counter write per changed statement/event, not per row.
DROP TRIGGER history_changed ON activity_records.records;
CREATE OR REPLACE FUNCTION activity_records.advance_history_version() RETURNS trigger LANGUAGE plpgsql AS $$
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
      SELECT kind, id, revision, data, deleted FROM new_rows
      EXCEPT
      SELECT kind, id, revision, data, deleted FROM old_rows
    );
  ELSE
    -- BEFORE TRUNCATE can distinguish an empty table; rollback also rolls back the counter.
    has_changes := EXISTS (SELECT 1 FROM activity_records.records);
  END IF;
  IF has_changes THEN
    UPDATE activity_records.history_version SET revision=revision+1 WHERE singleton=true;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER history_inserted AFTER INSERT ON activity_records.records
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION activity_records.advance_history_version();
CREATE TRIGGER history_updated AFTER UPDATE ON activity_records.records
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION activity_records.advance_history_version();
CREATE TRIGGER history_deleted AFTER DELETE ON activity_records.records
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION activity_records.advance_history_version();
CREATE TRIGGER history_truncated BEFORE TRUNCATE ON activity_records.records
FOR EACH STATEMENT EXECUTE FUNCTION activity_records.advance_history_version();
-- Existing review tokens must restart once across the coordinated protocol update.
UPDATE activity_records.history_version SET revision=revision+1 WHERE singleton=true;
