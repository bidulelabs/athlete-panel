-- Final pre-release historical reads: plugin-owned facts, transactional statement counters.
CREATE TABLE training.history_version (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL DEFAULT 0);
INSERT INTO training.history_version(singleton) VALUES(true);
CREATE FUNCTION training.advance_history_version() RETURNS trigger LANGUAGE plpgsql AS $$
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
    has_changes := EXISTS (SELECT 1 FROM training.records);
  END IF;
  IF has_changes THEN
    UPDATE training.history_version SET revision=revision+1 WHERE singleton=true;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER history_inserted AFTER INSERT ON training.records
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION training.advance_history_version();
CREATE TRIGGER history_updated AFTER UPDATE ON training.records
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION training.advance_history_version();
CREATE TRIGGER history_deleted AFTER DELETE ON training.records
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION training.advance_history_version();
CREATE TRIGGER history_truncated BEFORE TRUNCATE ON training.records
FOR EACH STATEMENT EXECUTE FUNCTION training.advance_history_version();
CREATE INDEX history_independent_date ON training.records (kind, (data#>>'{schedule,date}'), id) WHERE deleted=false;
CREATE INDEX history_plan_day ON training.records ((data#>>'{schedule,planId}'), ((data#>>'{schedule,day}')::integer), id) WHERE deleted=false AND data#>>'{schedule,kind}'='plan';
CREATE INDEX history_performed_date ON training.records ((data#>>'{completion,performedDate}'), id) WHERE deleted=false AND kind='workout';
CREATE INDEX history_plan_start ON training.records ((data->>'startDate'), id) WHERE deleted=false AND kind='plan';
