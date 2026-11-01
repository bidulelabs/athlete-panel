-- Final pre-release historical reads: plugin-owned facts, transactional statement counters.
CREATE TABLE activity_records.history_version (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL DEFAULT 0);
INSERT INTO activity_records.history_version(singleton) VALUES(true);
CREATE FUNCTION activity_records.advance_history_version() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE INDEX history_kind_date_id ON activity_records.records (kind, (data->>'localDate'), id) WHERE deleted=false;
CREATE INDEX history_sport_date_id ON activity_records.records ((data->>'sport'), (data->>'localDate'), id) WHERE deleted=false AND kind='activity';
CREATE INDEX history_metric_date_id ON activity_records.records ((data->>'metric'), (data->>'localDate'), id) WHERE deleted=false AND kind='health';
