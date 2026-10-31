-- Transactional, plugin-owned invalidation: no historical data copies or cross-schema triggers.
CREATE TABLE activity_records.history_version (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL DEFAULT 0);
INSERT INTO activity_records.history_version(singleton) VALUES(true);
CREATE FUNCTION activity_records.advance_history_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE activity_records.history_version SET revision=revision+1 WHERE singleton=true;
  RETURN NULL;
END $$;
CREATE TRIGGER history_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON activity_records.records
FOR EACH STATEMENT EXECUTE FUNCTION activity_records.advance_history_version();
CREATE INDEX history_kind_date_id ON activity_records.records (kind, (data->>'localDate'), id) WHERE deleted=false;
CREATE INDEX history_sport_date_id ON activity_records.records ((data->>'sport'), (data->>'localDate'), id) WHERE deleted=false AND kind='activity';
CREATE INDEX history_metric_date_id ON activity_records.records ((data->>'metric'), (data->>'localDate'), id) WHERE deleted=false AND kind='health';
